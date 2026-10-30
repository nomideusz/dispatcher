package main

import (
	"encoding/json"
	"net/http"
	"time"

	"gorm.io/gorm"
)

// TemplateFix is the day a health fix for a template was pushed, set by
// hand. Health scores the deploys already running, so it lags a fix until
// deployers take the update or new deploys land; the routine check reads
// this to stop naming a template that is already fixed.
type TemplateFix struct {
	TemplateID string `gorm:"primaryKey" json:"templateId"`
	FixedOn    string `json:"fixedOn"`
}

func handleSetTemplateFix(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Fixed string `json:"fixed"`
		}
		err := json.NewDecoder(r.Body).Decode(&body)
		if err == nil && body.Fixed != "" {
			_, err = time.Parse(time.DateOnly, body.Fixed)
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fixed must be a date (YYYY-MM-DD), or empty"})
			return
		}
		row := TemplateFix{TemplateID: r.PathValue("id"), FixedOn: body.Fixed}
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		err = db.WithContext(r.Context()).Exec("INSERT OR REPLACE INTO template_fixes (template_id, fixed_on) VALUES (?, ?)", row.TemplateID, row.FixedOn).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
