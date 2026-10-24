package main

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"gorm.io/gorm"
)

// TemplateKind is what a template is for, set by hand: Railway's own
// category is "Other" for most of them. Size says nothing about who pays;
// kind does (business apps earn about $2 per active project a month,
// browser desktops a cent).
type TemplateKind struct {
	TemplateID string `gorm:"primaryKey" json:"templateId"`
	Kind       string `json:"kind"`
}

var templateKinds = []string{"business", "ai", "media", "desktop", "agent", "devtools"}

// seedKinds sorts the catalog as of 2026-10-25 by name, the part before
// " | ". Templates published later start unsorted and are set from the
// dashboard.
var seedKinds = map[string][]string{
	"business": {"Twenty CRM Production", "Chatwoot", "Dittofeed", "CRM", "ERPNext 16", "Moodle 5.2", "Invoice Ninja 5", "Odoo 19", "Plane Community", "Zammad 7", "Mautic Production", "Lago Production", "Documenso", "Cal.com", "Outline", "OpenProject", "Teable", "Rocket.Chat", "Huly", "AFFiNE", "Penpot", "Formbricks", "Postiz", "Medusa v2", "OpenEMR", "WordPress Pro", "Inbox Zero", "Fluxer", "Evo CRM", "evolution-n8n", "REI3", "Directus", "Lowcoder", "DataLens", "Windmill", "Activepieces", "n8n-queue", "GoAlert"},
	"ai":       {"Dify Production", "RAGFlow", "Opik", "Laminar", "Airweave", "Morphik", "Sim", "Langflow", "Firecrawl", "Langfuse 4", "Open WebUI + LiteLLM", "Ollama", "LobeHub (Lobe Chat)", "Flowise", "SkillHub", "Paperclip", "OpenConnector", "AI Memory Server", "VoiceStudio", "Moli", "OpenWorker", "Laya"},
	"media":    {"AzuraCast", "Owncast", "MediaCMS", "Pixelfed", "PeerTube", "Invidious", "Audiobookshelf", "Navidrome", "Funkwhale", "TubeArchivist", "Chevereto", "Oryx (SRS Stack)", "SUB/WAVE", "Baby Buddy", "Minecraft Server", "MCSManager", "LNbits"},
	"desktop":  {"Chromium", "Google Chrome", "Firefox", "Linux Desktop", "LibreWolf", "Mullvad Browser", "Microsoft Edge", "Brave", "Opera", "Vivaldi", "Ungoogled Chromium", "Linux Terminal", "Obsidian", "GIMP", "Blender", "LibreOffice", "Thunderbird", "FileZilla", "VSCodium", "Neko", "GenOffice", "Cockpit"},
	"agent":    {"Claude Code", "OpenCode", "T3 Code", "Orca Server", "Hermes Agent", "AionUi", "Codewhale"},
	"devtools": {"OpenReplay", "HyperDX", "Appwrite 2", "SvelteKit + Better Auth Starter", "Infisical", "Stalwart", "Rustrak", "Dependency-Track 5", "JMAP Webmail", "Uptrace", "WAHA", "Temporal"},
}

// seedTemplateKinds gives each known template its kind once; a kind set
// from the dashboard, unsorted included, is never overwritten.
func seedTemplateKinds(db *gorm.DB) error {
	for kind, names := range seedKinds {
		lower := make([]string, len(names))
		for i, n := range names {
			lower[i] = strings.ToLower(n)
		}
		err := db.Exec(`
			INSERT INTO template_kinds (template_id, kind)
			SELECT DISTINCT template_id, ? FROM template_snapshots WHERE lower(split_part(name, ' | ', 1)) IN ?
			ON CONFLICT DO NOTHING`, kind, lower).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func handleSetTemplateKind(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Kind string `json:"kind"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Kind != "" && !slices.Contains(templateKinds, body.Kind)) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kind must be one of " + strings.Join(templateKinds, ", ") + ", or empty"})
			return
		}
		row := TemplateKind{TemplateID: r.PathValue("id"), Kind: body.Kind}
		// Raw SQL: the DuckDB dialect drops GORM's OnConflict clause.
		err := db.WithContext(r.Context()).Exec("INSERT OR REPLACE INTO template_kinds (template_id, kind) VALUES (?, ?)", row.TemplateID, row.Kind).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
