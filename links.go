package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
)

// The link check: every link in every template's marketplace readme (the
// body Railway shows, which publish.py copies from the repo's README), read
// daily. A docs site that moves its pages, a domain that lapses, or a deploy
// button left on a template code that no longer exists all fail silently
// otherwise: the last one also knocked a batch of 50 templates off zaur.app,
// since Railway answers a query with one unknown code with no data at all.

const linkCheckSpec = "38 6 * * *"

// Link problems. Broken ones are certain; unverified is a site that would
// not answer a script (a bot wall, a rate limit, a timeout or a 5xx) and
// usually opens fine in a browser.
const (
	linkNotFound   = "not-found"  // 404 or 410, twice
	linkGone       = "gone"       // the host does not resolve, twice
	linkDeploy     = "deploy"     // a deploy button on a code Railway has no published template for
	linkRelative   = "relative"   // a relative link, which leads nowhere on Railway's page
	linkUnverified = "unverified" // see above
)

// ReadmeLink is one link of one template's readme as of the last check.
// Each run replaces the table.
type ReadmeLink struct {
	ID           uint      `gorm:"primaryKey" json:"-"`
	CheckedAt    time.Time `json:"checkedAt"`
	TemplateID   string    `json:"templateId"`
	TemplateName string    `json:"name"`
	TemplateCode string    `json:"code"`
	URL          string    `json:"url"`
	// Status is the HTTP status of the last answer, 0 when there was none.
	Status int `json:"status"`
	// Problem is empty for a working link, else one of the link* values.
	Problem string `json:"problem"`
	Detail  string `json:"detail"`
}

var (
	fencedCodeRe = regexp.MustCompile("(?s)```.*?```|~~~.*?~~~")
	inlineCodeRe = regexp.MustCompile("`[^`\n]*`")
	mdLinkRe     = regexp.MustCompile(`\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)`)
	htmlLinkRe   = regexp.MustCompile(`(?i)(?:href|src)\s*=\s*["']([^"']+)["']`)
	refLinkRe    = regexp.MustCompile(`(?m)^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?(\S+?)>?(?:\s|$)`)
	bareURLRe    = regexp.MustCompile("https?://[^\\s<>()\\[\\]\"'`]+")
	deployLinkRe = regexp.MustCompile(`^https?://(?:www\.)?railway\.(?:com|app)/(?:new/template|deploy|template)/([\w-]+)`)
)

// readmeLinks lists the distinct links of a readme in order, leaving out
// code (examples, not links), in-page anchors and mailto.
func readmeLinks(md string) []string {
	text := fencedCodeRe.ReplaceAllString(md, "")
	text = inlineCodeRe.ReplaceAllString(text, "")
	seen := map[string]bool{}
	out := []string{}
	add := func(u string) {
		u = strings.TrimRight(strings.TrimSpace(u), ".,;:!?*_")
		if u == "" || seen[u] || strings.HasPrefix(u, "#") || strings.HasPrefix(strings.ToLower(u), "mailto:") {
			return
		}
		seen[u] = true
		out = append(out, u)
	}
	// Explicit links first, then cut out so the bare-URL pass cannot add a
	// truncated copy of one holding parentheses.
	for _, re := range []*regexp.Regexp{mdLinkRe, htmlLinkRe, refLinkRe} {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			add(m[1])
		}
		text = re.ReplaceAllString(text, " ")
	}
	for _, u := range bareURLRe.FindAllString(text, -1) {
		add(u)
	}
	return out
}

// placeholderHost says a link is an example the reader fills in (their own
// Railway domain, localhost), not a page to check.
func placeholderHost(host string) bool {
	host = strings.ToLower(host)
	if host == "" || host == "localhost" || strings.HasPrefix(host, "127.") || strings.HasPrefix(host, "0.0.0.0") {
		return true
	}
	for _, s := range []string{".up.railway.app", ".railway.internal", ".railway.app.internal"} {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	for _, d := range []string{"example.com", "example.org", "example.net"} {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return strings.ContainsAny(host, "<>{}‹›$") || strings.Contains(host, "your-") || strings.Contains(host, "yourdomain")
}

var linkClient = &http.Client{Timeout: 20 * time.Second}

const linkUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

// probe asks for a page once: HEAD, then GET when HEAD is refused or fails,
// since plenty of servers answer HEAD wrongly.
func probe(ctx context.Context, u string) (int, error) {
	status, err := 0, error(nil)
	for _, method := range []string{http.MethodHead, http.MethodGet} {
		var req *http.Request
		req, err = http.NewRequestWithContext(ctx, method, u, nil)
		if err != nil {
			return 0, err
		}
		req.Header.Set("User-Agent", linkUserAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
		var resp *http.Response
		resp, err = linkClient.Do(req)
		if err != nil {
			status = 0
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		status = resp.StatusCode
		if status < 400 {
			return status, nil
		}
	}
	return status, err
}

// judge turns a probe's answer into a problem and its detail.
func judge(status int, err error) (problem, detail string) {
	var dnsErr *net.DNSError
	switch {
	case err != nil && errors.As(err, &dnsErr) && dnsErr.IsNotFound:
		return linkGone, "the domain does not resolve"
	case err != nil:
		msg := err.Error()
		if i := strings.LastIndex(msg, ": "); i >= 0 {
			msg = msg[i+2:]
		}
		return linkUnverified, msg
	case status == http.StatusNotFound || status == http.StatusGone:
		return linkNotFound, http.StatusText(status)
	case status >= 400:
		return linkUnverified, fmt.Sprintf("%d %s", status, http.StatusText(status))
	}
	return "", ""
}

// checkURL judges one external link; a broken answer is asked again once,
// so one bad moment of a site does not count.
func checkURL(ctx context.Context, u string) (int, string, string) {
	status, err := probe(ctx, u)
	problem, detail := judge(status, err)
	if problem == linkNotFound || problem == linkGone {
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
			status, err = probe(ctx, u)
			problem, detail = judge(status, err)
		}
	}
	return status, problem, detail
}

// templateStatus is a template code's status on Railway, or "" when Railway
// has no template with that code. The public query needs no token.
func templateStatus(ctx context.Context, code string) (string, error) {
	var data struct {
		Template *struct {
			Status string `json:"status"`
		} `json:"template"`
	}
	err := graphqlRequest(ctx, railwayGraphQLURL, "", `query ($code: String!) { template(code: $code) { status } }`, map[string]any{"code": code}, &data)
	if err != nil {
		if strings.Contains(err.Error(), "Template not found") {
			return "", nil
		}
		return "", err
	}
	if data.Template == nil {
		return "", nil
	}
	return data.Template.Status, nil
}

const workspaceReadmesQuery = `query ($workspaceId: String!) {
  workspaceTemplates(workspaceId: $workspaceId) {
    edges { node { id name code status readme } }
  }
}`

type templateReadme struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Code   string `json:"code"`
	Status string `json:"status"`
	Readme string `json:"readme"`
}

var linkCheckMu sync.Mutex

func runLinkCheck(db *gorm.DB) {
	if err := checkReadmeLinks(db); err != nil {
		log.Printf("link check: %v", err)
	}
}

// checkReadmeLinks reads every published template's readme, checks each
// distinct link once, and replaces the readme_links table.
func checkReadmeLinks(db *gorm.DB) error {
	linkCheckMu.Lock()
	defer linkCheckMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	token, err := workspaceToken(ctx, db)
	if err != nil {
		return err
	}
	workspaceID, err := getWorkspaceID(ctx, token)
	if err != nil {
		return err
	}
	rows, err := collectReadmeLinks(ctx, token, workspaceID)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM readme_links").Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.CreateInBatches(&rows, 500).Error
	})
}

// collectReadmeLinks reads the workspace's published readmes and judges
// every link in them.
func collectReadmeLinks(ctx context.Context, token, workspaceID string) ([]ReadmeLink, error) {
	var data struct {
		WorkspaceTemplates struct {
			Edges []struct {
				Node templateReadme `json:"node"`
			} `json:"edges"`
		} `json:"workspaceTemplates"`
	}
	if err := graphqlRequest(ctx, railwayGraphQLURL, token, workspaceReadmesQuery, map[string]any{"workspaceId": workspaceID}, &data); err != nil {
		return nil, err
	}
	published := map[string]bool{}
	templates := []templateReadme{}
	for _, e := range data.WorkspaceTemplates.Edges {
		if e.Node.Status == "PUBLISHED" {
			published[e.Node.Code] = true
			templates = append(templates, e.Node)
		}
	}

	checkedAt := time.Now().UTC()
	rows := []ReadmeLink{}
	type verdict struct {
		status          int
		problem, detail string
	}
	verdicts := map[string]*verdict{} // by URL, or "code:" + template code
	for _, t := range templates {
		for _, u := range readmeLinks(t.Readme) {
			row := ReadmeLink{CheckedAt: checkedAt, TemplateID: t.ID, TemplateName: t.Name, TemplateCode: t.Code, URL: u}
			parsed, err := url.Parse(u)
			switch {
			case err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https" && parsed.Scheme != ""):
				continue // ftp:, tel: and the like
			case parsed.Scheme == "":
				row.Problem, row.Detail = linkRelative, "a relative link leads nowhere on Railway's page; use a full URL"
			case placeholderHost(parsed.Hostname()):
				continue
			default:
				key := u
				if m := deployLinkRe.FindStringSubmatch(u); m != nil {
					key = "code:" + m[1]
					if published[m[1]] {
						verdicts[key] = &verdict{}
					}
				}
				if verdicts[key] == nil {
					verdicts[key] = nil // to check
				}
			}
			rows = append(rows, row)
		}
	}

	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(12)
	for key, v := range verdicts {
		if v != nil {
			continue
		}
		g.Go(func() error {
			res := &verdict{}
			if code, ok := strings.CutPrefix(key, "code:"); ok {
				status, err := templateStatus(ctx, code)
				switch {
				case err != nil:
					res.problem, res.detail = linkUnverified, err.Error()
				case status == "":
					res.problem, res.detail = linkDeploy, fmt.Sprintf("Railway has no template %q", code)
				case status != "PUBLISHED":
					res.problem, res.detail = linkDeploy, fmt.Sprintf("template %q is %s", code, strings.ToLower(status))
				}
			} else {
				res.status, res.problem, res.detail = checkURL(ctx, key)
			}
			mu.Lock()
			verdicts[key] = res
			mu.Unlock()
			return nil
		})
	}
	g.Wait()

	for i := range rows {
		r := &rows[i]
		if r.Problem != "" {
			continue
		}
		key := r.URL
		if m := deployLinkRe.FindStringSubmatch(r.URL); m != nil {
			key = "code:" + m[1]
		}
		if v := verdicts[key]; v != nil {
			r.Status, r.Problem, r.Detail = v.status, v.problem, v.detail
		}
	}
	return rows, nil
}

type linksResponse struct {
	CheckedAt *time.Time `json:"checkedAt"`
	// Readmes and Links count what the last run read; Problems holds only
	// the links that are broken or could not be verified, broken first.
	Readmes  int          `json:"readmes"`
	Links    int          `json:"links"`
	Problems []ReadmeLink `json:"problems"`
}

func linkReport(ctx context.Context, db *gorm.DB) (linksResponse, error) {
	out := linksResponse{Problems: []ReadmeLink{}}
	rows := []ReadmeLink{}
	if err := db.WithContext(ctx).Order("template_name, url").Find(&rows).Error; err != nil {
		return out, err
	}
	readmes := map[string]bool{}
	for _, r := range rows {
		readmes[r.TemplateID] = true
		if out.CheckedAt == nil || r.CheckedAt.After(*out.CheckedAt) {
			at := r.CheckedAt
			out.CheckedAt = &at
		}
		if r.Problem != "" {
			out.Problems = append(out.Problems, r)
		}
	}
	out.Readmes, out.Links = len(readmes), len(rows)
	sort.SliceStable(out.Problems, func(i, j int) bool {
		return (out.Problems[i].Problem == linkUnverified) != (out.Problems[j].Problem == linkUnverified) && out.Problems[j].Problem == linkUnverified
	})
	return out, nil
}

func handleLinks(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rep, err := linkReport(r.Context(), db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}
}

func handleRefreshLinks(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := checkReadmeLinks(db); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}
