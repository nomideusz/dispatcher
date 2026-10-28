package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Marketplace search is read once a day, after the market read it takes
// its app keywords from.
const searchFetchSpec = "40 6 * * *"

// marketKeywords is how many of the most deployed marketplace apps are
// searched for besides our own: where the demand is, and who ranks there.
const marketKeywords = 150

// SearchRank is one result of one marketplace search, appended on every
// daily run. A keyword with no results gets one row at Position 0 so it
// still shows as searched.
type SearchRank struct {
	ID         uint `gorm:"primaryKey"`
	SampledAt  time.Time
	Query      string
	Source     string // "manual" | "ours" | "market"
	Position   int
	TemplateID string
	Code       string
	Name       string
}

// SearchKeyword is a keyword added by hand. Keywords from our templates and
// the market are derived on every run instead of stored.
type SearchKeyword struct {
	Query     string    `gorm:"primaryKey" json:"query"`
	CreatedAt time.Time `json:"createdAt"`
}

const searchQuery = `query($q: String!) { templateSearch(query: $q) { edges { node { id code name } } } }`

// searchMarket returns Railway's marketplace results for q, best first.
// The endpoint is public and caps results at 20.
func searchMarket(ctx context.Context, q string) ([]SearchRank, error) {
	var data struct {
		TemplateSearch struct {
			Edges []struct {
				Node struct{ ID, Code, Name string } `json:"node"`
			} `json:"edges"`
		} `json:"templateSearch"`
	}
	if err := graphqlRequest(ctx, railwayGraphQLURL, "", searchQuery, map[string]any{"q": q}, &data); err != nil {
		return nil, err
	}
	rows := make([]SearchRank, 0, len(data.TemplateSearch.Edges))
	for i, e := range data.TemplateSearch.Edges {
		rows = append(rows, SearchRank{Query: q, Position: i + 1, TemplateID: e.Node.ID, Code: e.Node.Code, Name: e.Node.Name})
	}
	return rows, nil
}

// normalizeKeyword lowercases q and drops emoji and other pictographs,
// which market names carry ("Hermes Agent 🤖") and nobody types.
func normalizeKeyword(q string) string {
	q = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.So, r) {
			return -1
		}
		return r
	}, strings.ToLower(q))
	return strings.Join(strings.Fields(q), " ")
}

// searchKeywords lists what to search, each with the first source that
// asked for it: manual, then our templates (name and code), then the most
// deployed apps on the market that aren't skipped.
func searchKeywords(ctx context.Context, db *gorm.DB) (map[string]string, error) {
	out := map[string]string{}
	add := func(q, source string) {
		if q = normalizeKeyword(q); len(q) >= 2 && out[q] == "" {
			out[q] = source
		}
	}
	var manual []SearchKeyword
	if err := db.WithContext(ctx).Find(&manual).Error; err != nil {
		return nil, err
	}
	for _, k := range manual {
		add(k.Query, "manual")
	}
	var ours []struct{ Name, Code string }
	if err := db.WithContext(ctx).Raw(`SELECT name, code FROM template_snapshots
		WHERE sampled_at = (SELECT MAX(sampled_at) FROM template_snapshots) AND status = 'PUBLISHED'`).Scan(&ours).Error; err != nil {
		return nil, err
	}
	for _, t := range ours {
		add(marketKey(t.Name), "ours")
		add(strings.ReplaceAll(t.Code, "-", " "), "ours")
	}
	var rows []MarketTemplate
	if err := db.WithContext(ctx).Find(&rows).Error; err != nil {
		return nil, err
	}
	var skipped []string
	if err := db.WithContext(ctx).Raw(`SELECT "key" FROM candidate_marks WHERE status = 'skip'`).Scan(&skipped).Error; err != nil {
		return nil, err
	}
	skip := map[string]bool{}
	for _, k := range skipped {
		skip[k] = true
	}
	n := 0
	for _, g := range groupMarket(rows, nil) { // most deployed first
		if n == marketKeywords {
			break
		}
		if !skip[g.Key] {
			add(g.Key, "market")
			n++
		}
	}
	return out, nil
}

// searchAll runs every keyword at sampledAt, paced so a few hundred
// searches don't hammer the public API. A keyword that fails twice is
// left out of this run rather than recorded as unranked.
func searchAll(ctx context.Context, keywords map[string]string, sampledAt time.Time) []SearchRank {
	qs := make([]string, 0, len(keywords))
	for q := range keywords {
		qs = append(qs, q)
	}
	sort.Strings(qs)
	var out []SearchRank
	failed := 0
	for _, q := range qs {
		rows, err := searchMarket(ctx, q)
		if err != nil && ctx.Err() == nil {
			time.Sleep(2 * time.Second)
			rows, err = searchMarket(ctx, q)
		}
		if err != nil {
			failed++
			if ctx.Err() != nil {
				break
			}
			continue
		}
		if len(rows) == 0 {
			rows = []SearchRank{{Query: q}}
		}
		for i := range rows {
			rows[i].SampledAt, rows[i].Source = sampledAt, keywords[q]
		}
		out = append(out, rows...)
		time.Sleep(300 * time.Millisecond)
	}
	if failed > 0 {
		log.Printf("search fetch: %d of %d keywords failed", failed, len(qs))
	}
	return out
}

func saveRanks(db *gorm.DB, rows []SearchRank) error {
	// Silent: GORM logs each large batch as a slow query.
	return db.Session(&gorm.Session{SkipDefaultTransaction: true, Logger: logger.Discard}).CreateInBatches(&rows, 500).Error
}

func runSearchFetch(db *gorm.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	keywords, err := searchKeywords(ctx, db)
	if err != nil {
		log.Printf("search fetch: keywords: %v", err)
		return
	}
	if rows := searchAll(ctx, keywords, time.Now().UTC()); len(rows) > 0 {
		if err := saveRanks(db, rows); err != nil {
			log.Printf("search fetch: save: %v", err)
		}
	}
}

type searchResult struct {
	Position   int    `json:"position"`
	TemplateID string `json:"templateId"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Creator    string `json:"creator"`
	Ours       bool   `json:"ours"`
	// Recent is the template's projects in the last 90 days, from the
	// market read; Active its active projects.
	Recent int64 `json:"recent"`
	Active int64 `json:"active"`
}

type searchKeywordRow struct {
	Query  string `json:"query"`
	Source string `json:"source"`
	// Category is Railway's category of the first result.
	Category string `json:"category"`
	// Demand is the 90-day projects of every template the search returns:
	// what people deploy among the things this keyword finds.
	Demand  int64 `json:"demand"`
	Results int   `json:"results"`
	// Best is our best position now, nil when none of ours shows; PrevBest
	// the same a week earlier, nil when absent or not searched then.
	Best     *int           `json:"best"`
	PrevBest *int           `json:"prevBest"`
	Searched bool           `json:"searchedBefore"`
	Top      []searchResult `json:"top"`
}

// positionShare is how much of a keyword's demand the template at a
// position holds, averaged over the keywords with any demand.
type positionShare struct {
	Position int     `json:"position"`
	Share    float64 `json:"share"`
	Keywords int     `json:"keywords"`
}

type searchResponse struct {
	SampledAt *time.Time         `json:"sampledAt"`
	PrevAt    *time.Time         `json:"prevAt"`
	Keywords  []searchKeywordRow `json:"keywords"`
	Curve     []positionShare    `json:"curve"`
}

// buildSearch folds one run of ranks into a row per keyword, with our
// best position against prev (an earlier run, possibly empty).
func buildSearch(latest, prev []SearchRank, market []MarketTemplate, ours map[string]bool) ([]searchKeywordRow, []positionShare) {
	byID := make(map[string]MarketTemplate, len(market))
	for _, t := range market {
		byID[t.ID] = t
	}
	prevBest := map[string]*int{}
	for _, r := range prev {
		if _, ok := prevBest[r.Query]; !ok {
			prevBest[r.Query] = nil
		}
		if ours[r.TemplateID] && r.Position > 0 && (prevBest[r.Query] == nil || r.Position < *prevBest[r.Query]) {
			prevBest[r.Query] = pointerTo(r.Position)
		}
	}
	by := map[string]*searchKeywordRow{}
	var order []string
	for _, r := range latest {
		k := by[r.Query]
		if k == nil {
			pb, seen := prevBest[r.Query]
			k = &searchKeywordRow{Query: r.Query, Source: r.Source, PrevBest: pb, Searched: seen, Top: []searchResult{}}
			by[r.Query] = k
			order = append(order, r.Query)
		}
		if r.Position == 0 {
			continue
		}
		m := byID[r.TemplateID]
		res := searchResult{Position: r.Position, TemplateID: r.TemplateID, Code: r.Code, Name: r.Name, Creator: m.Creator,
			Ours: ours[r.TemplateID], Recent: m.RecentProjects, Active: m.ActiveProjects}
		k.Top = append(k.Top, res)
		k.Results++
		k.Demand += m.RecentProjects
		if res.Ours && k.Best == nil {
			k.Best = pointerTo(r.Position)
		}
	}
	rows := make([]searchKeywordRow, 0, len(order))
	share := map[int]*positionShare{}
	for _, q := range order {
		k := by[q]
		sort.Slice(k.Top, func(i, j int) bool { return k.Top[i].Position < k.Top[j].Position })
		if len(k.Top) > 0 {
			k.Category = byID[k.Top[0].TemplateID].Category
		}
		rows = append(rows, *k)
		if k.Demand == 0 {
			continue
		}
		for _, r := range k.Top {
			s := share[r.Position]
			if s == nil {
				s = &positionShare{Position: r.Position}
				share[r.Position] = s
			}
			s.Share += float64(r.Recent) / float64(k.Demand)
			s.Keywords++
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Demand > rows[j].Demand })
	curve := make([]positionShare, 0, len(share))
	for _, s := range share {
		s.Share /= float64(s.Keywords)
		curve = append(curve, *s)
	}
	sort.Slice(curve, func(i, j int) bool { return curve[i].Position < curve[j].Position })
	return rows, curve
}

func handleSearch(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(err error) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		ctx := r.Context()
		resp := searchResponse{Keywords: []searchKeywordRow{}, Curve: []positionShare{}}
		var latestAt, prevAt sql.NullTime
		if err := db.WithContext(ctx).Raw("SELECT MAX(sampled_at) FROM search_ranks").Row().Scan(&latestAt); err != nil {
			fail(err)
			return
		}
		if !latestAt.Valid {
			writeJSON(w, http.StatusOK, resp)
			return
		}
		// A week back, give or take a late run.
		if err := db.WithContext(ctx).Raw("SELECT MAX(sampled_at) FROM search_ranks WHERE sampled_at <= ?", latestAt.Time.Add(-6*24*time.Hour)).Row().Scan(&prevAt); err != nil {
			fail(err)
			return
		}
		var latest, prev []SearchRank
		if err := db.WithContext(ctx).Where("sampled_at = ?", latestAt.Time).Find(&latest).Error; err != nil {
			fail(err)
			return
		}
		if prevAt.Valid {
			if err := db.WithContext(ctx).Where("sampled_at = ?", prevAt.Time).Find(&prev).Error; err != nil {
				fail(err)
				return
			}
		}
		var market []MarketTemplate
		if err := db.WithContext(ctx).Find(&market).Error; err != nil {
			fail(err)
			return
		}
		var ids []string
		if err := db.WithContext(ctx).Raw("SELECT DISTINCT template_id FROM template_snapshots").Scan(&ids).Error; err != nil {
			fail(err)
			return
		}
		ours := make(map[string]bool, len(ids))
		for _, id := range ids {
			ours[id] = true
		}
		resp.SampledAt = &latestAt.Time
		if prevAt.Valid {
			resp.PrevAt = &prevAt.Time
		}
		resp.Keywords, resp.Curve = buildSearch(latest, prev, market, ours)
		writeJSON(w, http.StatusOK, resp)
	}
}

// handleAddSearchKeyword stores a keyword and searches it right away,
// filed under the latest run so it shows beside the rest.
func handleAddSearchKeyword(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		q := normalizeKeyword(body.Query)
		if len(q) < 2 || len(q) > 80 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "keyword must be 2 to 80 characters"})
			return
		}
		ctx := r.Context()
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		if err := db.WithContext(ctx).Exec(`INSERT OR IGNORE INTO search_keywords (query, created_at) VALUES (?, ?)`, q, time.Now().UTC()).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		var last sql.NullTime
		if err := db.WithContext(ctx).Raw("SELECT MAX(sampled_at) FROM search_ranks").Row().Scan(&last); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		at := time.Now().UTC()
		if last.Valid {
			at = last.Time
		}
		rows := searchAll(ctx, map[string]string{q: "manual"}, at)
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("sampled_at = ? AND query = ?", at, q).Delete(&SearchRank{}).Error; err != nil {
				return err
			}
			if len(rows) == 0 {
				return nil
			}
			return saveRanks(tx, rows)
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"query": q, "searched": len(rows) > 0})
	}
}

// handleRemoveSearchKeyword stops searching a manual keyword; its history
// stays.
func handleRemoveSearchKeyword(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := normalizeKeyword(r.PathValue("query"))
		if err := db.WithContext(r.Context()).Where("query = ?", q).Delete(&SearchKeyword{}).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"query": q})
	}
}
