package main

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestMarketKey(t *testing.T) {
	for name, want := range map[string]string{
		"Ghost (Production)":         "ghost",
		"Ghost v5":                   "ghost",
		"Ghost - blog":               "ghost",
		"Ghost + MySQL":              "ghost + mysql",
		"n8n | Self-hosted workflow": "n8n",
		"Twenty CRM Production":      "twenty crm",
		"Moodle 5.2":                 "moodle",
	} {
		if got := marketKey(name); got != want {
			t.Errorf("marketKey(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestGroupMarket(t *testing.T) {
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := []MarketTemplate{
		{ID: "a", Name: "Ghost", Code: "ghost", Creator: "x", ActiveProjects: 300, RecentProjects: 40, CreatedAt: day},
		{ID: "b", Name: "Ghost (Production)", Code: "g2", Creator: "y", ActiveProjects: 10, RecentProjects: 12, CreatedAt: day.AddDate(0, 3, 0)},
		{ID: "ours1", Name: "Postiz", Code: "postiz", ActiveProjects: 5, RecentProjects: 3, CreatedAt: day},
		{ID: "c", Name: "Postiz App", Code: "pa", Creator: "z", ActiveProjects: 150, RecentProjects: 30, CreatedAt: day},
		{ID: "ours2", Name: "Laya", Code: "laya", ActiveProjects: 2, RecentProjects: 1, CreatedAt: day},
	}
	groups := groupMarket(rows, map[string]bool{"ours1": true, "ours2": true})
	by := map[string]*candidateGroup{}
	for _, g := range groups {
		by[g.Key] = g
	}
	if g := by["ghost"]; g.Templates != 2 || g.Active != 310 || g.Recent != 52 || g.Leader.Code != "ghost" || !g.Newest.Equal(day.AddDate(0, 3, 0)) || g.Rivals != 2 {
		t.Errorf("ghost = %+v", g)
	}
	if groups[0].Key != "ghost" {
		t.Errorf("first group %q, want the most recent projects first", groups[0].Key)
	}
	if g := by["postiz"]; len(g.Ours) != 1 || g.Rivals != 1 || g.Leader.Name != "" {
		t.Errorf("postiz = %+v, want ours with the Postiz App rival", g)
	}
	if g := by["postiz app"]; g.Similar != "postiz" || g.Rivals != 1 {
		t.Errorf("postiz app = %+v, want similar to ours and only its own rival", g)
	}
	if g := by["laya"]; g.Rivals != 0 {
		t.Errorf("laya rivals = %d, want an original", g.Rivals)
	}
}

// A candidate counts the templates of a similar group as rivals too, even
// when neither group holds one of ours.
func TestGroupMarketCandidateRivals(t *testing.T) {
	groups := groupMarket([]MarketTemplate{
		{ID: "a", Name: "Instatic CMS - SQLite", Creator: "Instatic", ActiveProjects: 1122},
		{ID: "b", Name: "Instatic CMS - Postgres", Creator: "Instatic", ActiveProjects: 124},
		{ID: "c", Name: "Instatic", Creator: "x", ActiveProjects: 21},
		{ID: "d", Name: "instatic", Creator: "y", ActiveProjects: 2},
		{ID: "e", Name: "Ghost", Creator: "z"},
	}, map[string]bool{})
	by := map[string]*candidateGroup{}
	for _, g := range groups {
		by[g.Key] = g
	}
	if g := by["instatic cms"]; g.Templates != 2 || g.Rivals != 4 || g.Similar != "" {
		t.Errorf("instatic cms = %+v, want 2 templates, 4 rivals, no similar of ours", g)
	}
	if g := by["instatic"]; g.Rivals != 4 {
		t.Errorf("instatic rivals = %d, want 4", g.Rivals)
	}
	if g := by["ghost"]; g.Rivals != 1 {
		t.Errorf("ghost rivals = %d, want 1", g.Rivals)
	}
}

func TestOurRepo(t *testing.T) {
	for config, want := range map[string]string{
		`{"services":{"a":{"source":{"repo":"https://github.com/two-workspaces/edge"}}}}`:                                       "github.com/two-workspaces/edge",
		`{"services":{"a":{"source":{"image":"postgres:17"}},"b":{"source":{"repo":"https://github.com/NomiDeusz/dino.git"}}}}`: "github.com/NomiDeusz/dino.git",
		`{"services":{"a":{"source":{"repo":"https://github.com/someone/edge"}}}}`:                                              "",
		`{"services":{"a":{"source":{"image":"ghcr.io/two-workspaces/laya:671e888"}}}}`:                                         "github.com/two-workspaces/laya",
		`"not an object"`: "",
		`null`:            "",
	} {
		if got := ourRepo(json.RawMessage(config)); got != want {
			t.Errorf("ourRepo(%s) = %q, want %q", config, got, want)
		}
	}
}

// A template published since the daily market read joins its group by name.
func TestAddCatalog(t *testing.T) {
	groups := groupMarket([]MarketTemplate{{ID: "x", Name: "Metabase (2022)"}}, map[string]bool{})
	addCatalog(groups, []struct{ TemplateID, Name string }{
		{"ours", "Metabase | Open-Source BI and Dashboards with Postgres"},
		{"other", "Typebot | Chatbot Builder"},
	})
	if len(groups) != 1 || fmt.Sprint(groups[0].Ours) != "[ours]" {
		t.Errorf("groups = %+v, want metabase with ours", groups[0])
	}
}
