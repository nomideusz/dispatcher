package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseFix(t *testing.T) {
	now := time.Date(2026, 11, 18, 17, 55, 0, 0, time.UTC)
	cases := []struct {
		in, on string
		at     *time.Time
		bad    bool
	}{
		{in: ""},
		{in: "2026-11-17", on: "2026-11-17"},
		{in: "2026-11-18", on: "2026-11-18", at: &now},
		{in: "2026-11-17T08:40:00+01:00", on: "2026-11-17", at: pointerTo(time.Date(2026, 11, 17, 7, 40, 0, 0, time.UTC))},
		{in: "2026-11-19T00:00:00Z", bad: true},
		{in: "Nov 17", bad: true},
	}
	for _, c := range cases {
		on, at, err := parseFix(c.in, now)
		if (err != nil) != c.bad {
			t.Fatalf("parseFix(%q) err = %v", c.in, err)
		}
		if c.bad {
			continue
		}
		if on != c.on || (at == nil) != (c.at == nil) || (at != nil && !at.Equal(*c.at)) {
			t.Fatalf("parseFix(%q) = %q, %v; want %q, %v", c.in, on, at, c.on, c.at)
		}
	}
}

// A fix is judged by the projects made after it went out: with a time,
// from that moment; without one, from the end of its day. Deploys earlier
// on the fix day are not credited to it.
func TestTimelineCountsProjectsSinceFix(t *testing.T) {
	db := openDB(filepath.Join(t.TempDir(), "fixes.duckdb"))
	today := time.Now().UTC().Truncate(24 * time.Hour)
	fixDay := today.AddDate(0, 0, -2)
	published := today.AddDate(0, 0, -10)
	rows := []TemplateSnapshot{}
	for _, id := range []string{"timed", "untimed"} {
		snap := func(at time.Time, projects int64, health float64) TemplateSnapshot {
			return TemplateSnapshot{
				SampledAt: at, TemplateID: id, Name: id, Status: "PUBLISHED", PublishedAt: &published,
				Services: 1, Projects: projects, ActiveProjects: projects, TemplateHealth: pointerTo(health),
			}
		}
		rows = append(rows,
			snap(fixDay.Add(-2*time.Hour), 100, 96), // the day before
			snap(fixDay.Add(6*time.Hour), 104, 92),  // the fix day, before the fix
			snap(fixDay.Add(9*time.Hour), 105, 92),  // just after the fix
			snap(fixDay.Add(23*time.Hour), 108, 92), // late on the fix day
			snap(today.Add(-time.Minute*0), 110, 88),
		)
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	fixAt := fixDay.Add(8 * time.Hour)
	if err := db.Create(&[]TemplateFix{
		{TemplateID: "timed", FixedOn: fixDay.Format(time.DateOnly), FixedAt: &fixAt},
		{TemplateID: "untimed", FixedOn: fixDay.Format(time.DateOnly)},
	}).Error; err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	handleTimeline(db)(rec, httptest.NewRequest("GET", "/api/analytics/timeline?days=30", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var got timelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string][2]float64{"timed": {6, 92}, "untimed": {2, 96}}
	for _, tt := range got.Templates {
		w, ok := want[tt.TemplateID]
		if !ok {
			continue
		}
		if tt.FixNewProjects == nil || float64(*tt.FixNewProjects) != w[0] || tt.FixHealthThen == nil || *tt.FixHealthThen != w[1] {
			t.Fatalf("%s: new %v, health then %v; want %v", tt.TemplateID, tt.FixNewProjects, tt.FixHealthThen, w)
		}
		delete(want, tt.TemplateID)
	}
	if len(want) > 0 {
		t.Fatalf("missing %v in %s", want, strings.TrimSpace(rec.Body.String())[:200])
	}
}
