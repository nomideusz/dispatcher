package main

import (
	"context"
	"net/http"
	"sort"
	"time"

	"gorm.io/gorm"
)

// healthDayRow is one template's last reading of a UTC day.
type healthDayRow struct {
	TemplateID  string
	LastAt      time.Time
	Health      *float64
	Projects    *int64
	Deployments *int64
}

// templateHealthSeries is one template day by day, aligned to the
// response's Days; nil where the day has no sample or no score.
type templateHealthSeries struct {
	TemplateID  string     `json:"templateId"`
	Health      []*float64 `json:"health"`
	Projects    []*int64   `json:"projects"`
	Deployments []*int64   `json:"deployments"`
}

// healthSeriesResponse is every template's health beside its project and
// deploy counts, one value a day. Health scores the instances already
// running, so it falls without a new deploy and a fix shows only once new
// deploys land: the counts beside it say which of the two is happening.
type healthSeriesResponse struct {
	Days      []string               `json:"days"`
	Templates []templateHealthSeries `json:"templates"`
}

// handleTemplateHealth serves the daily health series for ?days=N (default
// 30): each day's last scored health, and its last project and deploy counts.
func handleTemplateHealth(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days := windowDays(r, db, time.Now())
		since := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
		rows, err := healthDayRows(r.Context(), db, since)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, buildHealthSeries(rows))
	}
}

// healthDayRows reads one row per template and day. Only PUBLISHED rows
// count, as in templateProjectPoints. The day comes back as the day's last
// sample time, so the UTC day key is cut in Go and not by the database's
// time zone.
func healthDayRows(ctx context.Context, db *gorm.DB, since time.Time) ([]healthDayRow, error) {
	rows := []healthDayRow{}
	err := db.WithContext(ctx).Raw(`
		SELECT template_id, MAX(sampled_at) AS last_at,
		       arg_max(template_health, sampled_at) FILTER (WHERE template_health IS NOT NULL) AS health,
		       arg_max(projects, sampled_at) AS projects,
		       arg_max(total_deployments, sampled_at) FILTER (WHERE total_deployments IS NOT NULL) AS deployments
		FROM template_snapshots
		WHERE status = 'PUBLISHED' AND sampled_at >= ?
		GROUP BY template_id, CAST(sampled_at AS DATE)
		ORDER BY template_id, last_at`, since).Scan(&rows).Error
	return rows, err
}

func buildHealthSeries(rows []healthDayRow) healthSeriesResponse {
	out := healthSeriesResponse{Days: []string{}, Templates: []templateHealthSeries{}}
	dayOf := func(r healthDayRow) string { return r.LastAt.UTC().Format(time.DateOnly) }
	index := map[string]int{}
	for _, r := range rows {
		if _, ok := index[dayOf(r)]; !ok {
			index[dayOf(r)] = 0
			out.Days = append(out.Days, dayOf(r))
		}
	}
	sort.Strings(out.Days)
	for i, d := range out.Days {
		index[d] = i
	}
	at := map[string]int{}
	for _, r := range rows {
		i, ok := at[r.TemplateID]
		if !ok {
			i = len(out.Templates)
			at[r.TemplateID] = i
			out.Templates = append(out.Templates, templateHealthSeries{
				TemplateID:  r.TemplateID,
				Health:      make([]*float64, len(out.Days)),
				Projects:    make([]*int64, len(out.Days)),
				Deployments: make([]*int64, len(out.Days)),
			})
		}
		d := index[dayOf(r)]
		out.Templates[i].Health[d] = r.Health
		out.Templates[i].Projects[d] = r.Projects
		out.Templates[i].Deployments[d] = r.Deployments
	}
	return out
}
