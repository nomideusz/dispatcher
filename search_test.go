package main

import "testing"

func TestBuildSearch(t *testing.T) {
	market := []MarketTemplate{
		{ID: "a", Creator: "x", Category: "CRM", RecentProjects: 30},
		{ID: "b", Creator: "y", RecentProjects: 10},
		{ID: "o", RecentProjects: 0},
	}
	ours := map[string]bool{"o": true}
	latest := []SearchRank{
		{Query: "crm", Source: "ours", Position: 2, TemplateID: "o"},
		{Query: "crm", Source: "ours", Position: 1, TemplateID: "a"},
		{Query: "crm", Source: "ours", Position: 3, TemplateID: "b"},
		{Query: "ghost", Source: "market", Position: 1, TemplateID: "b"},
		{Query: "nothing", Source: "manual"},
	}
	prev := []SearchRank{
		{Query: "crm", Position: 5, TemplateID: "o"},
		{Query: "ghost", Position: 1, TemplateID: "b"},
	}
	rows, curve := buildSearch(latest, prev, market, ours)

	if len(rows) != 3 || rows[0].Query != "crm" || rows[1].Query != "ghost" || rows[2].Query != "nothing" {
		t.Fatalf("rows not ordered by demand: %+v", rows)
	}
	crm := rows[0]
	if crm.Demand != 40 || crm.Results != 3 || crm.Best == nil || *crm.Best != 2 || crm.PrevBest == nil || *crm.PrevBest != 5 {
		t.Errorf("crm = demand %d results %d best %v prev %v", crm.Demand, crm.Results, crm.Best, crm.PrevBest)
	}
	if crm.Top[0].TemplateID != "a" || !crm.Top[1].Ours || crm.Top[0].Creator != "x" || crm.Category != "CRM" {
		t.Errorf("crm top not sorted or annotated: %+v", crm.Top)
	}
	ghost := rows[1]
	if ghost.Best != nil || ghost.PrevBest != nil || !ghost.Searched {
		t.Errorf("ghost: we are absent now and then, but it was searched: %+v", ghost)
	}
	if n := rows[2]; n.Results != 0 || n.Searched || len(n.Top) != 0 {
		t.Errorf("empty keyword: %+v", n)
	}
	// Position 1: crm 30/40 and ghost 10/10 → 0.875; position 2: 0; 3: 0.25.
	want := map[int]float64{1: 0.875, 2: 0, 3: 0.25}
	if len(curve) != 3 {
		t.Fatalf("curve = %+v", curve)
	}
	for _, c := range curve {
		if c.Share != want[c.Position] {
			t.Errorf("position %d share = %v, want %v", c.Position, c.Share, want[c.Position])
		}
	}
}

func TestNormalizeKeyword(t *testing.T) {
	for in, want := range map[string]string{"  Hermes Agent 🤖 ": "hermes agent", "Node.js": "node.js", "C++ IDE": "c++ ide"} {
		if got := normalizeKeyword(in); got != want {
			t.Errorf("normalizeKeyword(%q) = %q, want %q", in, got, want)
		}
	}
}
