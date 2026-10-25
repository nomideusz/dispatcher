package main

import (
	"encoding/json"
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
	if g := by["postiz app"]; g.Similar != "postiz" {
		t.Errorf("postiz app similar = %q", g.Similar)
	}
	if g := by["laya"]; g.Rivals != 0 {
		t.Errorf("laya rivals = %d, want an original", g.Rivals)
	}
}

func TestOurRepo(t *testing.T) {
	for config, want := range map[string]string{
		`{"services":{"a":{"source":{"repo":"https://github.com/two-workspaces/edge"}}}}`:                                       "github.com/two-workspaces/edge",
		`{"services":{"a":{"source":{"image":"postgres:17"}},"b":{"source":{"repo":"https://github.com/NomiDeusz/dino.git"}}}}`: "github.com/NomiDeusz/dino.git",
		`{"services":{"a":{"source":{"repo":"https://github.com/someone/edge"}}}}`:                                              "",
		`"not an object"`: "",
		`null`:            "",
	} {
		if got := ourRepo(json.RawMessage(config)); got != want {
			t.Errorf("ourRepo(%s) = %q, want %q", config, got, want)
		}
	}
}
