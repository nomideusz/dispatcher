package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Proposal is an app the owner suggests building, usually a GitHub link.
// The owner adds it with a note; the routine (Claude, through dispatcherctl)
// answers with a status and a reply, so the conversation lives here rather
// than in a terminal session.
type Proposal struct {
	URL       string    `gorm:"primaryKey" json:"url"`
	Note      string    `json:"note"`
	Status    string    `json:"status"`
	Reply     string    `json:"reply"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// "" is new: waiting for a verdict.
var proposalStatuses = map[string]bool{"": true, "building": true, "published": true, "skipped": true}

var proposalURL = regexp.MustCompile(`https?://[^\s<>"'()]+`)

// proposalURLs pulls every link out of pasted text (a list, a sentence,
// markdown), trimmed of trailing punctuation and a trailing slash or .git,
// so the same repo pasted twice is one proposal.
func proposalURLs(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, u := range proposalURL.FindAllString(text, -1) {
		u = strings.TrimRight(u, ".,;:!?")
		u = strings.TrimSuffix(strings.TrimSuffix(u, "/"), ".git")
		if strings.HasPrefix(u, "http://github.com/") {
			u = "https://" + strings.TrimPrefix(u, "http://")
		}
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

func handleProposals(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var ps []Proposal
		// New ones first, then the latest answered.
		if err := db.WithContext(r.Context()).Order("status = '' DESC, updated_at DESC").Find(&ps).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"proposals": ps})
	}
}

func handleAddProposals(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
			Note string `json:"note"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		urls := proposalURLs(body.Text)
		if len(urls) == 0 || len(urls) > 50 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "paste 1 to 50 links"})
			return
		}
		now := time.Now().UTC()
		note := strings.TrimSpace(body.Note)
		err := db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			for _, u := range urls {
				// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
				// A repo proposed again keeps its verdict.
				if err := tx.Exec(`INSERT OR IGNORE INTO proposals (url, note, status, reply, created_at, updated_at) VALUES (?, ?, '', '', ?, ?)`,
					u, note, now, now).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"added": urls})
	}
}

func handleAnswerProposal(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			URL    string `json:"url"`
			Status string `json:"status"`
			Reply  string `json:"reply"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !proposalStatuses[body.Status] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status must be building, published, skipped, or empty"})
			return
		}
		res := db.WithContext(r.Context()).Model(&Proposal{}).Where("url = ?", body.URL).
			Updates(map[string]any{"status": body.Status, "reply": strings.TrimSpace(body.Reply), "updated_at": time.Now().UTC()})
		if res.Error != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": res.Error.Error()})
			return
		}
		if res.RowsAffected == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such proposal"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": body.URL, "status": body.Status})
	}
}

func handleRemoveProposal(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.WithContext(r.Context()).Where("url = ?", r.URL.Query().Get("url")).Delete(&Proposal{}).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
