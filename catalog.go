package main

import (
	"context"
	"net/http"
	"time"

	"gorm.io/gorm"
)

// catalogTemplate is one published template as a public page lists it.
// Everything here is already on Railway's marketplace; earnings, health and
// payouts stay behind login.
type catalogTemplate struct {
	Code        string     `json:"code"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	PublishedAt *time.Time `json:"publishedAt"`
	// Projects and ActiveProjects are Railway's public counts: projects
	// other users started from the template, and those still live.
	Projects       int64 `json:"projects"`
	ActiveProjects int64 `json:"activeProjects"`
}

type catalogResponse struct {
	SampledAt *time.Time        `json:"sampledAt"`
	Templates []catalogTemplate `json:"templates"`
}

// publishedCatalog is the latest hourly sample's published templates with
// the kind set on the dashboard, newest first.
func publishedCatalog(ctx context.Context, db *gorm.DB) (catalogResponse, error) {
	out := catalogResponse{Templates: []catalogTemplate{}}
	latest, err := scanTime(ctx, db, "SELECT max(sampled_at) FROM template_snapshots")
	if err != nil || latest == nil {
		return out, err
	}
	out.SampledAt = latest
	err = db.WithContext(ctx).Raw(`
		SELECT s.code, s.name, coalesce(k.kind, '') AS kind, s.published_at,
		       coalesce(s.projects, 0) AS projects, coalesce(s.active_projects, 0) AS active_projects
		FROM template_snapshots s
		LEFT JOIN template_kinds k ON k.template_id = s.template_id
		WHERE s.sampled_at = ? AND s.status = 'PUBLISHED' AND coalesce(s.code, '') <> ''
		ORDER BY s.published_at DESC NULLS LAST, s.code`, *latest).Scan(&out.Templates).Error
	return out, err
}

// handleCatalog serves the public catalog that zaur.app builds its templates
// table from. No login: it carries nothing Railway does not already show.
func handleCatalog(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cat, err := publishedCatalog(r.Context(), db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, cat)
	}
}
