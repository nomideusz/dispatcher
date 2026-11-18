package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"gorm.io/gorm"
)

// TemplateFix is the day a health fix for a template was pushed, set by
// hand. Health scores the deploys already running, so it lags a fix until
// deployers take the update or new deploys land; the routine check reads
// this to stop naming a template that is already fixed.
//
// FixedAt is the moment it went out, when known: a fix recorded on its own
// day takes the time it was recorded, and a timestamp gives it exactly. The
// projects that judge a fix are counted from it, so a busy morning before a
// fix isn't credited to it. Without it they count from the end of FixedOn.
type TemplateFix struct {
	TemplateID string     `gorm:"primaryKey" json:"templateId"`
	FixedOn    string     `json:"fixedOn"`
	FixedAt    *time.Time `json:"fixedAt"`
}

// parseFix reads a recorded fix: "" clears it, a date is that day (at now
// when it is today), and an RFC 3339 timestamp is that moment.
func parseFix(value string, now time.Time) (fixedOn string, fixedAt *time.Time, err error) {
	if value == "" {
		return "", nil, nil
	}
	now = now.UTC()
	if day, err := time.Parse(time.DateOnly, value); err == nil {
		if day.Format(time.DateOnly) == now.Format(time.DateOnly) {
			return value, &now, nil
		}
		return value, nil, nil
	}
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "", nil, err
	}
	at = at.UTC()
	if at.After(now.Add(time.Minute)) {
		return "", nil, fmt.Errorf("fix time %s is in the future", value)
	}
	return at.Format(time.DateOnly), &at, nil
}

func handleSetTemplateFix(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Fixed string `json:"fixed"`
		}
		row := TemplateFix{TemplateID: r.PathValue("id")}
		err := json.NewDecoder(r.Body).Decode(&body)
		if err == nil {
			row.FixedOn, row.FixedAt, err = parseFix(body.Fixed, time.Now())
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fixed must be a date (YYYY-MM-DD), a time it went out (RFC 3339, e.g. 2026-11-17T07:40:00Z), or empty"})
			return
		}
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		err = db.WithContext(r.Context()).Exec("INSERT OR REPLACE INTO template_fixes (template_id, fixed_on, fixed_at) VALUES (?, ?, ?)", row.TemplateID, row.FixedOn, row.FixedAt).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
