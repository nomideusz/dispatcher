package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Railway publishes template stats around the hour; the marketplace is read
// once a day, after the upgrade check.
const marketFetchSpec = "20 6 * * *"

// MarketTemplate is one marketplace template as of the last daily read of
// Railway's public catalog. Each run replaces the table.
type MarketTemplate struct {
	ID             string `gorm:"primaryKey"`
	FetchedAt      time.Time
	Name           string
	Code           string
	Category       string
	Creator        string
	ActiveProjects int64
	RecentProjects int64
	Health         *float64
	CreatedAt      time.Time
}

// CandidateMark is a verdict on a marketplace group: shortlist or skip,
// with a note. Keyed by the group's normalized name.
type CandidateMark struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	Status    string    `json:"status"`
	Note      string    `json:"note"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// seedCandidates is the 2026-10-25 shortlist: team and business apps with
// demand on Railway, where the leading template is old or unhealthy.
var seedCandidates = map[string]string{
	"ghost":               "Publishing and newsletters; the leading template is unhealthy",
	"typebot":             "Chatbot builder for businesses; big demand on a 2023 template",
	"discourse":           "Community forum; few templates, the leader is unhealthy",
	"metabase":            "Team BI; steady demand, one 2022 leader",
	"mattermost":          "Team chat; the same buyers as Rocket.Chat",
	"nextcloud":           "Team files and office",
	"docmost":             "Team wiki, Confluence alternative",
	"keycloak":            "SSO for business stacks",
	"listmonk":            "Newsletters; one 2022 leader",
	"baserow":             "Airtable alternative, like Teable",
	"nocodb":              "Airtable alternative, like Teable",
	"plausible analytics": "Privacy analytics for business sites",
	"umami":               "Web analytics; one 2022 leader holds it",
	"payload cms":         "Headless CMS for agencies",
}

// seedSkips clears the top of the market as of 2026-10-25: Linux boxes,
// proxies and relays (ToS-gray), databases and tests, none an app to build.
var seedSkips = []string{
	"9router", "omniroute", "buzz relay", "buzz", "telegram mtproxy", "telegram proxy", "teleproxy",
	"ubuntu", "ubuntu-linux", "ubuntu lts", "ubuntu sshd", "ubuntu ssh + claude",
	"debian", "debian-linux", "debian linux", "debian linux web terminal", "kali linux",
	"postgres ha", "vc / selfbot", "masterxtest", "设备事件记录 device event logger",
}

const marketQuery = `query($after: String) {
	templates(first: 500, after: $after) {
		pageInfo { hasNextPage endCursor }
		edges { node { id name code category activeProjects recentProjects health createdAt creator { name } } }
	}
}`

func fetchMarket(ctx context.Context) ([]MarketTemplate, error) {
	fetchedAt := time.Now().UTC()
	var rows []MarketTemplate
	var after any
	for {
		var data struct {
			Templates struct {
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
				Edges []struct {
					Node struct {
						ID             string    `json:"id"`
						Name           string    `json:"name"`
						Code           string    `json:"code"`
						Category       *string   `json:"category"`
						ActiveProjects int64     `json:"activeProjects"`
						RecentProjects int64     `json:"recentProjects"`
						Health         *float64  `json:"health"`
						CreatedAt      time.Time `json:"createdAt"`
						Creator        *struct {
							Name string `json:"name"`
						} `json:"creator"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"templates"`
		}
		// The catalog is public: no token.
		if err := graphqlRequest(ctx, railwayGraphQLURL, "", marketQuery, map[string]any{"after": after}, &data); err != nil {
			return nil, err
		}
		for _, e := range data.Templates.Edges {
			n := e.Node
			t := MarketTemplate{ID: n.ID, FetchedAt: fetchedAt, Name: n.Name, Code: n.Code, ActiveProjects: n.ActiveProjects, RecentProjects: n.RecentProjects, Health: n.Health, CreatedAt: n.CreatedAt}
			if n.Category != nil {
				t.Category = *n.Category
			}
			if n.Creator != nil {
				t.Creator = n.Creator.Name
			}
			rows = append(rows, t)
		}
		if !data.Templates.PageInfo.HasNextPage {
			return rows, nil
		}
		after = data.Templates.PageInfo.EndCursor
	}
}

func runMarketFetch(db *gorm.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	rows, err := fetchMarket(ctx)
	if err != nil {
		log.Printf("market fetch: %v", err)
		return
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM market_templates").Error; err != nil {
			return err
		}
		// Silent: each 500-row batch takes ~600 ms and GORM logs the whole
		// statement as a slow query.
		return tx.Session(&gorm.Session{SkipDefaultTransaction: true, Logger: logger.Discard}).CreateInBatches(&rows, 500).Error
	})
	if err != nil {
		log.Printf("market fetch: save: %v", err)
	}
}

var (
	marketCut   = regexp.MustCompile(`[(\[–—:|]| - `)
	marketNoise = regexp.MustCompile(`\b(production|prod|self[- ]?hosted|template|railway|latest|official|community|edition|v?\d+(\.\d+)*)\b`)
	marketSpace = regexp.MustCompile(`\s+`)
	marketPunct = regexp.MustCompile(`[^a-z0-9]`)
)

// marketKey groups templates of the same app: "Ghost (Production)",
// "ghost v5" and "Ghost - blog" all read "ghost". Stacks keep their extras
// ("ghost + mysql"), which is what sets them apart.
func marketKey(name string) string {
	n := strings.ToLower(name)
	n = marketCut.Split(n, 2)[0]
	n = marketNoise.ReplaceAllString(n, "")
	return strings.TrimSpace(marketSpace.ReplaceAllString(n, " "))
}

// squash drops everything but letters and digits, for alike.
func squash(key string) string { return marketPunct.ReplaceAllString(key, "") }

// alike says whether two squashed group keys look like the same app, one
// name inside the other: "postiz" and "postiz app", "n8n" and "n8n queue".
// ponytail: substring match; misses renames (medusa.js vs medusa v2) and
// can pair short names with longer ones, fine for a hint.
func alike(a, b string) bool {
	if len(a) < 3 || len(b) < 3 {
		return false
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

type candidateLeader struct {
	Name      string    `json:"name"`
	Code      string    `json:"code"`
	Creator   string    `json:"creator"`
	Active    int64     `json:"active"`
	Health    *float64  `json:"health"`
	CreatedAt time.Time `json:"createdAt"`
}

type candidateGroup struct {
	Key       string          `json:"key"`
	Category  string          `json:"category"`
	Templates int             `json:"templates"`
	Active    int64           `json:"active"`
	Recent    int64           `json:"recent"`
	Newest    time.Time       `json:"newest"`
	Leader    candidateLeader `json:"leader"`
	// Ours lists our template ids in the group; Similar names one of ours
	// that looks like the same app, for groups we have none in.
	Ours    []string `json:"ours"`
	Similar string   `json:"similar,omitempty"`
	// Rivals counts other creators' templates of the same or a similar app.
	Rivals int    `json:"rivals"`
	Status string `json:"status"`
	Note   string `json:"note"`
}

// groupMarket folds the catalog into one row per app.
func groupMarket(rows []MarketTemplate, ours map[string]bool) []*candidateGroup {
	by := map[string]*candidateGroup{}
	var keys []string
	for _, t := range rows {
		k := marketKey(t.Name)
		if k == "" {
			continue
		}
		g := by[k]
		if g == nil {
			g = &candidateGroup{Key: k, Ours: []string{}}
			by[k] = g
			keys = append(keys, k)
		}
		g.Templates++
		g.Active += t.ActiveProjects
		g.Recent += t.RecentProjects
		if t.CreatedAt.After(g.Newest) {
			g.Newest = t.CreatedAt
		}
		if ours[t.ID] {
			g.Ours = append(g.Ours, t.ID)
		} else if g.Leader.Name == "" || t.ActiveProjects > g.Leader.Active {
			g.Leader = candidateLeader{Name: t.Name, Code: t.Code, Creator: t.Creator, Active: t.ActiveProjects, Health: t.Health, CreatedAt: t.CreatedAt}
			g.Category = t.Category
		}
	}
	groups := make([]*candidateGroup, 0, len(keys))
	for _, k := range keys {
		groups = append(groups, by[k])
	}
	squashed := make(map[*candidateGroup]string, len(groups))
	for _, g := range groups {
		g.Rivals = g.Templates - len(g.Ours)
		squashed[g] = squash(g.Key)
	}
	// Similar apps across groups: ours count the other side as rivals, the
	// others learn we already have one.
	for _, o := range groups {
		if len(o.Ours) == 0 {
			continue
		}
		for _, g := range groups {
			if g == o || !alike(squashed[o], squashed[g]) {
				continue
			}
			o.Rivals += g.Templates - len(g.Ours)
			if len(g.Ours) == 0 && g.Similar == "" {
				g.Similar = o.Key
			}
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Recent > groups[j].Recent })
	return groups
}

type candidatesResponse struct {
	FetchedAt *time.Time        `json:"fetchedAt"`
	Groups    []*candidateGroup `json:"groups"`
}

// maxCandidates bounds the market list: past it, groups have a handful of
// recent projects between them.
const maxCandidates = 400

func handleCandidates(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(err error) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		ctx := r.Context()
		var rows []MarketTemplate
		if err := db.WithContext(ctx).Find(&rows).Error; err != nil {
			fail(err)
			return
		}
		var ids []string
		if err := db.WithContext(ctx).Raw("SELECT DISTINCT template_id FROM template_snapshots").Scan(&ids).Error; err != nil {
			fail(err)
			return
		}
		var marks []CandidateMark
		if err := db.WithContext(ctx).Find(&marks).Error; err != nil {
			fail(err)
			return
		}
		ours := make(map[string]bool, len(ids))
		for _, id := range ids {
			ours[id] = true
		}
		marked := make(map[string]CandidateMark, len(marks))
		for _, m := range marks {
			marked[m.Key] = m
		}

		resp := candidatesResponse{Groups: []*candidateGroup{}}
		if len(rows) > 0 {
			resp.FetchedAt = &rows[0].FetchedAt
		}
		for i, g := range groupMarket(rows, ours) {
			m, ok := marked[g.Key]
			if i >= maxCandidates && !ok && len(g.Ours) == 0 {
				continue
			}
			g.Status, g.Note = m.Status, m.Note
			resp.Groups = append(resp.Groups, g)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func handleMarkCandidate(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Status string `json:"status"`
			Note   string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Status != "" && body.Status != "shortlist" && body.Status != "skip") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status must be shortlist, skip, or empty"})
			return
		}
		m := CandidateMark{Key: r.PathValue("key"), Status: body.Status, Note: strings.TrimSpace(body.Note), UpdatedAt: time.Now().UTC()}
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		err := db.WithContext(r.Context()).Exec(`INSERT OR REPLACE INTO candidate_marks ("key", status, note, updated_at) VALUES (?, ?, ?, ?)`,
			m.Key, m.Status, m.Note, m.UpdatedAt).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, m)
	}
}

func seedCandidateMarks(db *gorm.DB) error {
	for k, note := range seedCandidates {
		err := db.Exec(`INSERT OR IGNORE INTO candidate_marks ("key", status, note, updated_at) VALUES (?, 'shortlist', ?, ?)`,
			k, note, time.Now().UTC()).Error
		if err != nil {
			return err
		}
	}
	for _, k := range seedSkips {
		err := db.Exec(`INSERT OR IGNORE INTO candidate_marks ("key", status, note, updated_at) VALUES (?, 'skip', 'Linux box, relay, database or test', ?)`,
			k, time.Now().UTC()).Error
		if err != nil {
			return err
		}
	}
	return nil
}
