package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

// The upgrade queue: for every image-based service in the workspace's
// templates, the tag the template pins next to the newest tag of the same
// shape in the image's registry. "Same shape" keeps 17.9.2-slim comparing
// against other x.y.z-slim tags only, so variants and pre-releases never
// count as upgrades.

const upgradeCheckSpec = "8 6 * * *"

// ServiceImage is one service's pinned image as of the last check. Each run
// replaces the whole table; history lives in git, not here.
type ServiceImage struct {
	ID         uint      `gorm:"primaryKey" json:"-"`
	CheckedAt  time.Time `json:"checkedAt"`
	TemplateID string    `json:"templateId"`
	Service    string    `json:"service"`
	// Image is the repository as written in the template, without the tag.
	Image string `json:"image"`
	Tag   string `json:"tag"`
	// Latest is the newest tag shaped like Tag on the same major version.
	Latest string `json:"latest"`
	// Behind is minor or patch; empty when Tag is the newest on its major
	// line; "floating" for tags like latest or a digest; "unknown" when the
	// registry could not be read (see Error).
	Behind string `json:"behind"`
	// Major is the newest tag of a later major version, empty if none.
	Major string `json:"major"`
	Error string `json:"error,omitempty"`
}

type serviceImageRef struct {
	Service string
	Image   string
	Tag     string
}

// templateImages lists the image-based services of a template. Services
// built from a repo have no image to compare and are skipped.
func (t workspaceTemplate) templateImages() []serviceImageRef {
	refs := []serviceImageRef{}
	for _, raw := range t.SerializedConfig.Services {
		var svc struct {
			Name   string `json:"name"`
			Source struct {
				Image string `json:"image"`
			} `json:"source"`
		}
		if json.Unmarshal(raw, &svc) != nil || svc.Source.Image == "" {
			continue
		}
		image, tag := splitImageTag(svc.Source.Image)
		refs = append(refs, serviceImageRef{Service: svc.Name, Image: image, Tag: tag})
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].Service < refs[j].Service })
	return refs
}

// splitImageTag separates "ghcr.io/o/r:1.2" into repository and tag. A
// missing tag means latest; a digest is returned whole as the tag.
func splitImageTag(ref string) (image, tag string) {
	if at := strings.Index(ref, "@"); at >= 0 {
		return ref[:at], ref[at:]
	}
	slash := strings.LastIndex(ref, "/")
	if colon := strings.LastIndex(ref, ":"); colon > slash {
		return ref[:colon], ref[colon+1:]
	}
	return ref, "latest"
}

// registryRepo maps an image repository to its registry host and path,
// applying Docker Hub's defaults (registry-1.docker.io, library/).
func registryRepo(image string) (host, repo string) {
	first, rest, found := strings.Cut(image, "/")
	if found && (strings.ContainsAny(first, ".:") || first == "localhost") {
		host, repo = first, rest
	} else {
		host, repo = "docker.io", image
	}
	if host == "docker.io" || host == "index.docker.io" {
		host = "registry-1.docker.io"
		if !strings.Contains(repo, "/") {
			repo = "library/" + repo
		}
	}
	return host, repo
}

var tagShapeRe = regexp.MustCompile(`^(\D*?)(\d+(?:\.\d+)*)(.*)$`)
var digitsRe = regexp.MustCompile(`\d+`)

// tagVersion splits a tag into a shape key and its numbers: the version core
// followed by any numbers in the suffix (alpine3.20 → 3, 20). ok is false for
// tags with no version (latest, main).
func tagVersion(tag string) (shape string, nums []int, ok bool) {
	m := tagShapeRe.FindStringSubmatch(tag)
	if m == nil || strings.HasPrefix(tag, "@") {
		return "", nil, false
	}
	core := strings.Split(m[2], ".")
	for _, part := range core {
		n, err := strconv.Atoi(part)
		if err != nil {
			return "", nil, false
		}
		nums = append(nums, n)
	}
	for _, part := range digitsRe.FindAllString(m[3], -1) {
		n, err := strconv.Atoi(part)
		if err != nil {
			return "", nil, false
		}
		nums = append(nums, n)
	}
	shape = m[1] + "|" + strconv.Itoa(len(core)) + "|" + digitsRe.ReplaceAllString(m[3], "#")
	return shape, nums, true
}

func compareVersions(a, b []int) int {
	for i := range min(len(a), len(b)) {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return len(a) - len(b)
}

// newestTags compares pinned with a repository's tags of the same shape.
// latest is the newest tag on pinned's major line and behind says how far
// pinned trails it (minor, patch, or "" when current); major is the newest
// tag of a later major version, if any. Majors are reported apart because
// templates often hold them back on purpose (Postgres 17, Redis 7).
func newestTags(pinned string, tags []string) (latest, behind, major string) {
	shape, pinnedNums, ok := tagVersion(pinned)
	if !ok {
		return "", "floating", ""
	}
	latest, latestNums := pinned, pinnedNums
	var majorNums []int
	for _, tag := range tags {
		s, nums, ok := tagVersion(tag)
		if !ok || s != shape {
			continue
		}
		if nums[0] == pinnedNums[0] {
			if compareVersions(nums, latestNums) > 0 {
				latest, latestNums = tag, nums
			}
		} else if nums[0] > pinnedNums[0] && (majorNums == nil || compareVersions(nums, majorNums) > 0) {
			major, majorNums = tag, nums
		}
	}
	switch {
	case latest == pinned:
		behind = ""
	case len(pinnedNums) > 1 && len(latestNums) > 1 && pinnedNums[1] != latestNums[1]:
		behind = "minor"
	default:
		behind = "patch"
	}
	return latest, behind, major
}

var registryClient = &http.Client{Timeout: 30 * time.Second}

// maxTagPages bounds pagination for repositories with thousands of tags.
const maxTagPages = 30

// listRegistryTags reads every tag of a repository through the OCI
// distribution API, fetching an anonymous bearer token when the registry
// challenges (Docker Hub, GHCR, Quay all do).
func listRegistryTags(ctx context.Context, image string) ([]string, error) {
	host, repo := registryRepo(image)
	next := fmt.Sprintf("https://%s/v2/%s/tags/list?n=1000", host, repo)
	token := ""
	tags := []string{}
	for page := 0; next != "" && page < maxTagPages; page++ {
		resp, err := registryGet(ctx, next, token)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusUnauthorized && token == "" {
			challenge := resp.Header.Get("WWW-Authenticate")
			resp.Body.Close()
			if token, err = registryToken(ctx, challenge); err != nil {
				return nil, err
			}
			page--
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("%s: tags list: %s", image, resp.Status)
		}
		var body struct {
			Tags []string `json:"tags"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: tags list: %w", image, err)
		}
		tags = append(tags, body.Tags...)
		next = nextPageURL(next, resp.Header.Get("Link"))
	}
	return tags, nil
}

func registryGet(ctx context.Context, rawURL, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return registryClient.Do(req)
}

var challengeParamRe = regexp.MustCompile(`(\w+)="([^"]*)"`)

// registryToken answers a `Bearer realm="…",service="…",scope="…"`
// challenge with an anonymous token request.
func registryToken(ctx context.Context, challenge string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(challenge), "bearer ") {
		return "", fmt.Errorf("unsupported registry auth %q", challenge)
	}
	params := map[string]string{}
	for _, m := range challengeParamRe.FindAllStringSubmatch(challenge, -1) {
		params[m[1]] = m[2]
	}
	realm, err := url.Parse(params["realm"])
	if err != nil || realm.Scheme != "https" {
		return "", fmt.Errorf("bad token realm %q", params["realm"])
	}
	q := realm.Query()
	for _, k := range []string{"service", "scope"} {
		if params[k] != "" {
			q.Set(k, params[k])
		}
	}
	realm.RawQuery = q.Encode()
	resp, err := registryGet(ctx, realm.String(), "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return "", fmt.Errorf("registry token: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var tok struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.Token != "" {
		return tok.Token, nil
	}
	return tok.AccessToken, nil
}

// nextPageURL resolves a `Link: </v2/…?last=x>; rel="next"` header against
// the current page URL.
func nextPageURL(current, link string) string {
	start, end := strings.Index(link, "<"), strings.Index(link, ">")
	if start < 0 || end <= start || !strings.Contains(link, `rel="next"`) {
		return ""
	}
	base, err := url.Parse(current)
	if err != nil {
		return ""
	}
	ref, err := url.Parse(link[start+1 : end])
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

var upgradeCheckMu sync.Mutex

func runUpgradeCheck(db *gorm.DB) {
	if err := checkTemplateUpgrades(db); err != nil {
		log.Printf("upgrade check: %v", err)
	}
}

// checkTemplateUpgrades reads every template's images and compares them with
// their registries, then replaces the service_images table. Each repository
// is listed once per run however many templates share it.
func checkTemplateUpgrades(db *gorm.DB) error {
	upgradeCheckMu.Lock()
	defer upgradeCheckMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	token, err := workspaceToken(ctx, db)
	if err != nil {
		return err
	}
	workspaceID, err := getWorkspaceID(ctx, token)
	if err != nil {
		return err
	}
	templates, err := getWorkspaceTemplates(ctx, token, workspaceID)
	if err != nil {
		return err
	}

	type tagResult struct {
		tags []string
		err  error
	}
	cache := map[string]tagResult{}
	checkedAt := time.Now().UTC()
	rows := []ServiceImage{}
	for _, t := range templates {
		for _, ref := range t.templateImages() {
			row := ServiceImage{CheckedAt: checkedAt, TemplateID: t.ID, Service: ref.Service, Image: ref.Image, Tag: ref.Tag}
			if _, _, ok := tagVersion(ref.Tag); !ok {
				row.Behind = "floating"
				rows = append(rows, row)
				continue
			}
			res, seen := cache[ref.Image]
			if !seen {
				res.tags, res.err = listRegistryTags(ctx, ref.Image)
				cache[ref.Image] = res
			}
			if res.err != nil {
				row.Behind, row.Error = "unknown", res.err.Error()
			} else {
				row.Latest, row.Behind, row.Major = newestTags(ref.Tag, res.tags)
			}
			rows = append(rows, row)
		}
	}
	if ctx.Err() != nil {
		return errors.New("timed out reading registries")
	}
	if err := replaceServiceImages(db, rows); err != nil {
		return err
	}
	log.Printf("upgrade check: %d services across %d templates, %d repositories", len(rows), len(templates), len(cache))
	return nil
}

// replaceServiceImages swaps in a run's rows in one transaction. Batches run
// without GORM's own nested transaction, whose SAVEPOINT DuckDB rejects.
func replaceServiceImages(db *gorm.DB, rows []ServiceImage) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM service_images").Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Session(&gorm.Session{SkipDefaultTransaction: true}).CreateInBatches(&rows, 100).Error
	})
}

type upgradeRow struct {
	ServiceImage
	Name               string   `json:"name"`
	Code               string   `json:"code"`
	Status             string   `json:"status"`
	EarningsLast30Days *float64 `json:"earningsLast30Days"`
	ActiveProjects     int64    `json:"activeProjects"`
}

// handleUpgrades lists every checked service with its template's latest
// snapshot, behind-first and then by 30-day earnings, so the top of the list
// is the upgrade that matters most.
func handleUpgrades(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows := []upgradeRow{}
		err := db.WithContext(r.Context()).Raw(`
			WITH latest AS (
				SELECT * FROM template_snapshots
				QUALIFY ROW_NUMBER() OVER (PARTITION BY template_id ORDER BY sampled_at DESC, id DESC) = 1
			)
			SELECT si.*, l.name, l.code, l.status, l.earnings_last30_days, l.active_projects
			FROM service_images si
			LEFT JOIN latest l ON l.template_id = si.template_id
			ORDER BY CASE si.behind WHEN 'minor' THEN 0 WHEN 'patch' THEN 0 ELSE 1 END,
			         l.earnings_last30_days DESC NULLS LAST, l.name, si.service`).Scan(&rows).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

func handleRefreshUpgrades(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := checkTemplateUpgrades(db); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}
