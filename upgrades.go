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
	"os"
	"path"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
)

// The upgrade queue: for every image-based service in the workspace's
// templates, the tag the template pins next to the newest tag of the same
// shape in the image's registry. "Same shape" keeps 17.9.2-slim comparing
// against other x.y.z-slim tags only, so variants and pre-releases never
// count as upgrades. Services built from a GitHub repo are read through
// their Dockerfile: its FROM images, and any ARG marked with where its
// releases live (see dockerfilePins).

const upgradeCheckSpec = "8 6 * * *"

// ServiceImage is one service's pinned image as of the last check. Each run
// replaces the whole table; history lives in git, not here.
type ServiceImage struct {
	ID         uint      `gorm:"primaryKey" json:"-"`
	CheckedAt  time.Time `json:"checkedAt"`
	TemplateID string    `json:"templateId"`
	Service    string    `json:"service"`
	// Image is the repository as written in the template, without the tag,
	// or "github:owner/repo" / "npm:package" / "pypi:package" for a marked
	// Dockerfile ARG.
	Image string `json:"image"`
	Tag   string `json:"tag"`
	// Latest is the newest tag shaped like Tag on the same major version.
	Latest string `json:"latest"`
	// Behind is minor or patch; empty when Tag is the newest on its major
	// line; "floating" for tags like latest or a digest; "unknown" when the
	// registry could not be read (see Error). "unchecked" only in
	// /api/upgrades, for a template with nothing to compare.
	Behind string `json:"behind"`
	// Major is the newest tag of a later major version, empty if none.
	Major string `json:"major"`
	// HA is the Railway template the service converts to a cluster with
	// (its haTemplateCode, e.g. redis-ha), empty when it has none.
	HA string `json:"ha"`
	// HABlock says why that conversion fails or would: "tag" when the
	// pinned tag names no major, which Railway refuses; "pinned" when the
	// companion does not support the pinned major; "major" when it does not
	// support Major, so bumping to it drops the convert option.
	HABlock string `json:"haBlock"`
	Error   string `json:"error,omitempty"`
}

// serviceImageRef is one pinned image, or, with Repo set, a service built
// from a repo whose Dockerfile still has to be read for its pins.
type serviceImageRef struct {
	Service string
	Image   string
	Tag     string
	Repo    string
	Root    string
	// Dockerfile is the service's build.dockerfilePath under Root, empty
	// for the default Dockerfile.
	Dockerfile string
	HA         string
}

// templateImages lists the image-based and repo-built services of a template.
func (t workspaceTemplate) templateImages() []serviceImageRef {
	refs := []serviceImageRef{}
	for _, raw := range t.SerializedConfig.Services {
		var svc struct {
			Name   string `json:"name"`
			Source struct {
				Image         string `json:"image"`
				Repo          string `json:"repo"`
				RootDirectory string `json:"rootDirectory"`
			} `json:"source"`
			Build struct {
				DockerfilePath string `json:"dockerfilePath"`
			} `json:"build"`
			HATemplateCode string `json:"haTemplateCode"`
		}
		if json.Unmarshal(raw, &svc) != nil {
			continue
		}
		if svc.Source.Image != "" {
			image, tag := splitImageTag(svc.Source.Image)
			refs = append(refs, serviceImageRef{Service: svc.Name, Image: image, Tag: tag, HA: svc.HATemplateCode})
		} else if svc.Source.Repo != "" {
			refs = append(refs, serviceImageRef{Service: svc.Name, Repo: svc.Source.Repo, Root: svc.Source.RootDirectory, Dockerfile: svc.Build.DockerfilePath})
		}
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

// pgSuffixRe matches a Postgres major in a suffix (pgvector's 0.8.7-pg17),
// which is part of the shape: pg17 → pg18 is a database major, not a patch.
var pgSuffixRe = regexp.MustCompile(`pg\d+`)

// tagVersion splits a tag into a shape key and its numbers: the version core
// followed by any numbers in the suffix (alpine3.20 → 3, 20), except a pgNN
// suffix, which stays in the shape. ok is false for
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
	pg := pgSuffixRe.FindString(m[3])
	suffix := pgSuffixRe.ReplaceAllString(m[3], "pg")
	for _, part := range digitsRe.FindAllString(suffix, -1) {
		n, err := strconv.Atoi(part)
		if err != nil {
			return "", nil, false
		}
		nums = append(nums, n)
	}
	shape = m[1] + "|" + strconv.Itoa(len(core)) + "|" + digitsRe.ReplaceAllString(suffix, "#") + "|" + pg
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

// haMajors reads the image majors an HA companion template converts:
// supportedImageMajorVersions on its root service's haConversionConfig.
func haMajors(ctx context.Context, accessToken, code string) ([]int, error) {
	var data struct {
		Template struct {
			SerializedConfig struct {
				Services map[string]struct {
					ClusterRole        string `json:"clusterRole"`
					HAConversionConfig struct {
						SupportedImageMajorVersions []int `json:"supportedImageMajorVersions"`
					} `json:"haConversionConfig"`
				} `json:"services"`
			} `json:"serializedConfig"`
		} `json:"template"`
	}
	query := "query ($code: String!) { template(code: $code) { serializedConfig } }"
	if err := graphqlRequest(ctx, railwayGraphQLURL, accessToken, query, map[string]any{"code": code}, &data); err != nil {
		return nil, err
	}
	for _, svc := range data.Template.SerializedConfig.Services {
		if svc.ClusterRole == "root" {
			return svc.HAConversionConfig.SupportedImageMajorVersions, nil
		}
	}
	return nil, fmt.Errorf("HA template %s has no root service", code)
}

// haBlock places a pinned tag and its later major against the majors an HA
// companion supports (see ServiceImage.HABlock). supported is nil when the
// companion could not be read; only the tag is judged then.
func haBlock(tag, major string, supported []int) string {
	_, nums, ok := tagVersion(tag)
	switch {
	case !ok:
		return "tag"
	case supported == nil:
		return ""
	case !slices.Contains(supported, nums[0]):
		return "pinned"
	}
	if _, m, ok := tagVersion(major); ok && !slices.Contains(supported, m[0]) {
		return "major"
	}
	return ""
}

var upgradeMarkerRe = regexp.MustCompile(`^#\s*upgrade:\s*(?:(skip)\b|(github|npm|pypi)\s+(\S+))`)

// dockerfilePins reads the upstream pins of a Dockerfile: every FROM image
// that is not an earlier stage, with ARG defaults substituted, and every ARG
// whose comment block names where its releases live:
//
//	# upgrade: github pingdotgg/t3code
//	ARG T3_VERSION=0.1.0
//
// (or "# upgrade: npm @anthropic-ai/claude-code", "# upgrade: pypi laya"),
// returned with Image "github:pingdotgg/t3code", "npm:@anthropic-ai/claude-code"
// or "pypi:laya". A FROM
// under "# upgrade: skip" is left out: a base held back on purpose.
func dockerfilePins(service, dockerfile string) []serviceImageRef {
	refs := []serviceImageRef{}
	args := map[string]string{}
	stages := map[string]bool{"scratch": true}
	seen := map[string]bool{}
	add := func(image, tag string) {
		if !seen[image+":"+tag] {
			seen[image+":"+tag] = true
			refs = append(refs, serviceImageRef{Service: service, Image: image, Tag: tag})
		}
	}
	marker := ""
	for _, line := range strings.Split(dockerfile, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			if m := upgradeMarkerRe.FindStringSubmatch(line); m != nil {
				marker = m[1]
				if marker == "" {
					marker = m[2] + ":" + m[3]
				}
			}
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			marker = ""
			continue
		}
		switch strings.ToUpper(fields[0]) {
		case "ARG":
			name, value, _ := strings.Cut(fields[1], "=")
			value = strings.Trim(value, `"'`)
			args[name] = value
			if marker != "" && marker != "skip" && value != "" {
				add(marker, value)
			}
		case "FROM":
			from := fields[1:]
			for len(from) > 1 && strings.HasPrefix(from[0], "--") {
				from = from[1:]
			}
			image := os.Expand(from[0], func(k string) string { return args[k] })
			if len(from) == 3 && strings.EqualFold(from[1], "AS") {
				stages[strings.ToLower(from[2])] = true
			}
			if marker != "skip" && !stages[strings.ToLower(image)] {
				add(splitImageTag(image))
			}
		}
		marker = ""
	}
	return refs
}

var githubRepoRe = regexp.MustCompile(`^https://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$`)

// fetchDockerfile reads the Dockerfile of a GitHub repo's default branch
// under root: name (a build.dockerfilePath such as apps/web/Dockerfile or
// Dockerfile.ui), or Dockerfile when empty. ok is false for repos with none (non-GitHub, or built without
// a Dockerfile), which have nothing to compare.
func fetchDockerfile(ctx context.Context, repo, root, name string) (dockerfile string, ok bool, err error) {
	m := githubRepoRe.FindStringSubmatch(repo)
	if m == nil {
		return "", false, nil
	}
	if name == "" {
		name = "Dockerfile"
	}
	file := path.Join("/", root, name)
	resp, err := registryGet(ctx, "https://raw.githubusercontent.com/"+m[1]+"/HEAD"+file, "")
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("%s%s: %s", repo, file, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return string(body), err == nil, err
}

// listTags lists the versions behind an Image: registry tags, or for a
// marked Dockerfile ARG the latest stable GitHub release, npm or PyPI version.
// Only the latest is fetched for those, which is enough for newestTags to
// place it on the pinned line or a later major.
func listTags(ctx context.Context, image string) ([]string, error) {
	if repo, ok := strings.CutPrefix(image, "github:"); ok {
		var release struct {
			TagName string `json:"tag_name"`
		}
		if err := getJSON(ctx, "https://api.github.com/repos/"+repo+"/releases/latest", &release); err != nil {
			return nil, err
		}
		// v0.1.2 also as 0.1.2, so a pin written either way finds it.
		return []string{release.TagName, strings.TrimPrefix(release.TagName, "v")}, nil
	}
	if pkg, ok := strings.CutPrefix(image, "npm:"); ok {
		var latest struct {
			Version string `json:"version"`
		}
		if err := getJSON(ctx, "https://registry.npmjs.org/"+pkg+"/latest", &latest); err != nil {
			return nil, err
		}
		return []string{latest.Version}, nil
	}
	if pkg, ok := strings.CutPrefix(image, "pypi:"); ok {
		var project struct {
			Info struct {
				Version string `json:"version"`
			} `json:"info"`
		}
		if err := getJSON(ctx, "https://pypi.org/pypi/"+pkg+"/json", &project); err != nil {
			return nil, err
		}
		return []string{project.Info.Version}, nil
	}
	tags, err := listRegistryTags(ctx, image)
	if image == "ubuntu" {
		// Interim releases (24.10) are not upgrades from an LTS (24.04).
		tags = slices.DeleteFunc(tags, func(tag string) bool { return !ubuntuLTSRe.MatchString(tag) })
	}
	return tags, err
}

var ubuntuLTSRe = regexp.MustCompile(`^\d*[02468]\.04`)

func getJSON(ctx context.Context, rawURL string, v any) error {
	resp, err := registryGet(ctx, rawURL, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", rawURL, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

var registryClient = &http.Client{Timeout: 30 * time.Second}

const registryWorkers = 16

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

// checkTemplateUpgrades reads every template's images, including those in
// repo-built services' Dockerfiles, and compares them with their registries,
// then replaces the service_images table. Each repository
// is listed once per run however many templates share it.
func checkTemplateUpgrades(db *gorm.DB) error {
	upgradeCheckMu.Lock()
	defer upgradeCheckMu.Unlock()

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
	templates, err := getWorkspaceTemplates(ctx, token, workspaceID)
	if err != nil {
		return err
	}

	// Dockerfiles and then registries are read registryWorkers at a time:
	// one by one, ~140 repositories at a second per page of tags overran the
	// timeout from Contabo (8 at a time took 7 minutes for 190).
	var g errgroup.Group
	g.SetLimit(registryWorkers)
	checkedAt := time.Now().UTC()
	refs := make([][]serviceImageRef, len(templates))
	failed := make([][]ServiceImage, len(templates))
	for i, t := range templates {
		for _, ref := range t.templateImages() {
			if ref.Repo == "" {
				refs[i] = append(refs[i], ref)
			}
		}
		g.Go(func() error {
			for _, ref := range t.templateImages() {
				if ref.Repo == "" {
					continue
				}
				dockerfile, ok, err := fetchDockerfile(ctx, ref.Repo, ref.Root, ref.Dockerfile)
				if err != nil {
					failed[i] = append(failed[i], ServiceImage{CheckedAt: checkedAt, TemplateID: t.ID, Service: ref.Service, Image: ref.Repo, Behind: "unknown", Error: err.Error()})
				} else if ok {
					refs[i] = append(refs[i], dockerfilePins(ref.Service, dockerfile)...)
				}
			}
			return nil
		})
	}
	g.Wait()

	type tagResult struct {
		tags []string
		err  error
	}
	cache := map[string]*tagResult{}
	for _, tRefs := range refs {
		for _, ref := range tRefs {
			if _, _, ok := tagVersion(ref.Tag); ok && cache[ref.Image] == nil {
				cache[ref.Image] = &tagResult{}
			}
		}
	}
	for image, res := range cache {
		g.Go(func() error {
			res.tags, res.err = listTags(ctx, image)
			return nil
		})
	}
	g.Wait()

	// A handful of Railway companions (redis-ha, mysql-ha, postgres-ha),
	// read once each. An unreadable one only loses the major checks.
	haSupported := map[string][]int{}
	for _, tRefs := range refs {
		for _, ref := range tRefs {
			if _, done := haSupported[ref.HA]; ref.HA != "" && !done {
				majors, err := haMajors(ctx, token, ref.HA)
				if err != nil {
					log.Printf("upgrade check: HA template %s: %v", ref.HA, err)
				}
				haSupported[ref.HA] = majors
			}
		}
	}

	rows := []ServiceImage{}
	for i, t := range templates {
		rows = append(rows, failed[i]...)
		for _, ref := range refs[i] {
			row := ServiceImage{CheckedAt: checkedAt, TemplateID: t.ID, Service: ref.Service, Image: ref.Image, Tag: ref.Tag, HA: ref.HA}
			if res := cache[ref.Image]; res == nil {
				row.Behind = "floating"
			} else if res.err != nil {
				row.Behind, row.Error = "unknown", res.err.Error()
			} else {
				row.Latest, row.Behind, row.Major = newestTags(ref.Tag, res.tags)
			}
			if ref.HA != "" {
				row.HABlock = haBlock(ref.Tag, row.Major, haSupported[ref.HA])
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

// upgradeRows lists every checked service with its template's latest
// snapshot, behind-first and then by 30-day earnings, so the top of the list
// is the upgrade that matters most. Templates in the latest snapshot run
// with nothing checked come back as one row with behind "unchecked", so
// the list covers the whole catalog.
func upgradeRows(db *gorm.DB) ([]upgradeRow, error) {
	rows := []upgradeRow{}
	err := db.Raw(`
		WITH latest AS (
			SELECT * FROM template_snapshots
			QUALIFY ROW_NUMBER() OVER (PARTITION BY template_id ORDER BY sampled_at DESC, id DESC) = 1
		)
		SELECT si.checked_at, COALESCE(si.template_id, l.template_id) AS template_id,
		       COALESCE(si.service, '') AS service, COALESCE(si.image, '') AS image, COALESCE(si.tag, '') AS tag,
		       COALESCE(si.latest, '') AS latest, COALESCE(si.behind, 'unchecked') AS behind,
		       COALESCE(si.major, '') AS major, COALESCE(si.ha, '') AS ha,
		       COALESCE(si.ha_block, '') AS ha_block, COALESCE(si.error, '') AS error,
		       l.name, l.code, l.status, l.earnings_last30_days, l.active_projects
		FROM service_images si
		FULL JOIN latest l ON l.template_id = si.template_id
		WHERE si.template_id IS NOT NULL OR l.sampled_at = (SELECT max(sampled_at) FROM template_snapshots)
		ORDER BY CASE si.behind WHEN 'minor' THEN 0 WHEN 'patch' THEN 0 ELSE 1 END,
		         l.earnings_last30_days DESC NULLS LAST, l.name, si.service`).Scan(&rows).Error
	return rows, err
}

func handleUpgrades(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := upgradeRows(db.WithContext(r.Context()))
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
