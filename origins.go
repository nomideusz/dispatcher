package main

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"gorm.io/gorm"
)

// TemplateOrigin says whether a template was an original (nothing like it
// on Railway when it was published) or a competitive pick, set by hand. Its
// own table: the kind write replaces whole rows, and would wipe it.
type TemplateOrigin struct {
	TemplateID string `gorm:"primaryKey" json:"templateId"`
	Origin     string `json:"origin"`
}

var templateOrigins = []string{"original", "competitive"}

func handleSetTemplateOrigin(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Origin string `json:"origin"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Origin != "" && !slices.Contains(templateOrigins, body.Origin)) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "origin must be one of " + strings.Join(templateOrigins, ", ") + ", or empty"})
			return
		}
		row := TemplateOrigin{TemplateID: r.PathValue("id"), Origin: body.Origin}
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		err := db.WithContext(r.Context()).Exec("INSERT OR REPLACE INTO template_origins (template_id, origin) VALUES (?, ?)", row.TemplateID, row.Origin).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
