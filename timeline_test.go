package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// The handler end to end, so the SQL (window deltas, the backfilled-row
// filter, BIGINT casts) is exercised along with the day bucketing.
func TestTimelineBucketsDeltasGapsAndLedger(t *testing.T) {
	db := openDB(filepath.Join(t.TempDir(), "timeline.duckdb"))
	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	day := func(d int) time.Time { return today.AddDate(0, 0, d) }
	t1 := day(-3).Add(10 * time.Hour)
	t2 := day(-2).Add(10 * time.Hour)
	t3 := day(-2).Add(12 * time.Hour) // backfilled: payout only
	t4 := now.Add(-time.Minute).Truncate(time.Second) // DuckDB keeps microseconds
	if t4.Before(today) {
		t4 = today
	}
	published := day(-10)
	snap := func(at time.Time, status string, projects, active int64, payout float64) TemplateSnapshot {
		return TemplateSnapshot{
			SampledAt: at, TemplateID: "a", Name: "A", Status: status, PublishedAt: &published,
			Services: 2, Projects: projects, ActiveProjects: active,
			ActiveDeployments: pointerTo(active + 1), TotalPayout: payout,
		}
	}
	rows := []TemplateSnapshot{
		snap(t1, "PUBLISHED", 5, 3, 1.00),
		snap(t2, "PUBLISHED", 7, 4, 1.50),
		snap(t3, "IMPORTED", 0, 0, 2.00),
		snap(t4, "PUBLISHED", 8, 4, 2.00),
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	payouts := []Payout{
		// Before tracking: only the ledger saw this money.
		{ID: "c1", CreatedAt: day(-20), AmountCents: 300, Status: "COMPLETED", Kind: "credits", TemplateID: "a"},
		// After tracking: the snapshots saw it too, so it must not count twice.
		{ID: "c2", CreatedAt: t2.Add(-time.Hour), AmountCents: 50, Status: "COMPLETED", Kind: "credits", TemplateID: "a"},
	}
	if err := db.Create(&payouts).Error; err != nil {
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

	// Published inside the window: the 5 projects the first snapshot found
	// were made in it too, if not seen arriving.
	if got.Window.EarnedCents != 400 || got.Window.NewProjects != 8 {
		t.Errorf("window = %+v, want 400¢ earned (300 ledger + 50 + 50) and 8 new projects", got.Window)
	}
	if got.Window.PreviousNewProjects != nil {
		t.Errorf("previous new projects = %d, want nil: tracking began inside the window", *got.Window.PreviousNewProjects)
	}
	if len(got.Gaps) != 1 || !got.Gaps[0].From.Equal(t2) || !got.Gaps[0].To.Equal(t4) {
		t.Errorf("gaps = %+v, want one from the %v sample to the %v one", got.Gaps, t2, t4)
	}
	points := map[string]timelinePoint{}
	for _, p := range got.Points {
		points[p.Date] = p
	}
	key := func(t time.Time) string { return t.Format(dayKeyLayout) }
	if p := points[key(t2)]; p.EarnedCents != 100 || p.NewProjects != 2 || p.ActiveProjects == nil || *p.ActiveProjects != 4 || *p.Running != 5 {
		t.Errorf("%s = %+v, want 100¢, 2 new, 4 active, 5 running", key(t2), p)
	}
	if p := points[key(t2)]; p.DeployedTemplates == nil || *p.DeployedTemplates != 1 || *p.ActiveTemplates != 1 ||
		p.EarningTemplates != nil || *p.LifetimeCents != 150 {
		t.Errorf("%s templates = %+v, want 1 deployed, 1 active, earning unknown, 150¢ lifetime", key(t2), p)
	}
	if p := points[key(day(-1))]; p.ActiveProjects != nil {
		t.Errorf("%s active = %d, want nil inside the gap", key(day(-1)), *p.ActiveProjects)
	}
	if p := points[key(t4)]; p.NewProjects != 1 {
		t.Errorf("%s new = %d, want 1, landing on the sample after the gap", key(t4), p.NewProjects)
	}
	if p := points[key(day(-20))]; p.EarnedCents != 300 || p.Published != 0 {
		t.Errorf("%s = %+v, want the 300¢ ledger payout and nothing published yet", key(day(-20)), p)
	}
	// Before tracking, lifetime walks back from the first sample through the
	// ledger, never below zero.
	if p := points[key(day(-20))]; p.LifetimeCents == nil || *p.LifetimeCents != 100 {
		t.Errorf("%s lifetime = %v, want 100¢ carried back from the first sample", key(day(-20)), p.LifetimeCents)
	}
	if p := points[key(day(-21))]; p.LifetimeCents == nil || *p.LifetimeCents != 0 {
		t.Errorf("%s lifetime = %v, want 0¢ before the 300¢ ledger payout", key(day(-21)), p.LifetimeCents)
	}
	if p := points[key(t1)]; p.Published != 1 || p.Services != 2 {
		t.Errorf("%s catalog = %d/%d, want 1 template with 2 services", key(t1), p.Published, p.Services)
	}

	if len(got.Templates) != 1 {
		t.Fatalf("templates = %d, want 1", len(got.Templates))
	}
	a := got.Templates[0]
	if a.LifetimeCents != 200 || a.EarnedCents != 400 || a.NewProjects != 8 || len(a.Activity) != 3 {
		t.Errorf("template = %+v, want 200¢ lifetime, 400¢ earned, 8 new (3 over 3 active days)", a)
	}
	if a.LastDeployAt == nil || !a.LastDeployAt.Equal(t4) || !a.LastDeployAfter.Equal(t2) {
		t.Errorf("last deploy = %v after %v, want %v after %v", a.LastDeployAt, a.LastDeployAfter, t4, t2)
	}
	if a.FirstPaidAt == nil || !a.FirstPaidAt.Equal(day(-20)) || !a.LastPaidAt.Equal(t3) {
		t.Errorf("paid = %v…%v, want %v…%v", a.FirstPaidAt, a.LastPaidAt, day(-20), t3)
	}
	if !a.FirstSeenAt.Equal(t1) {
		t.Errorf("first seen = %v, want %v", a.FirstSeenAt, t1)
	}
	// Railway reported no 30-day earnings; the payouts seen in the last 30
	// days stand in for its lag.
	if a.Earned30d == nil || *a.Earned30d != 4 {
		t.Errorf("earned30d = %v, want 4 from the payouts seen", a.Earned30d)
	}

	// days=0 is all-time: back to the first publish, ten days ago.
	rec = httptest.NewRecorder()
	handleTimeline(db)(rec, httptest.NewRequest("GET", "/api/analytics/timeline?days=0", nil))
	var all timelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &all); err != nil {
		t.Fatal(err)
	}
	if all.Window.Days != 11 || len(all.Points) != 11 || all.Points[0].Date != key(published) {
		t.Errorf("all-time = %d days from %s, want 11 from %s", all.Window.Days, all.Points[0].Date, key(published))
	}

	// A week starts after the publish: only the projects seen arriving.
	rec = httptest.NewRecorder()
	handleTimeline(db)(rec, httptest.NewRequest("GET", "/api/analytics/timeline?days=7", nil))
	var week timelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &week); err != nil {
		t.Fatal(err)
	}
	if week.Window.NewProjects != 3 || week.Templates[0].NewProjects != 3 {
		t.Errorf("week new = %d/%d, want 3/3", week.Window.NewProjects, week.Templates[0].NewProjects)
	}
}

// The previous range stops as far into its last day as the window has run
// into today, so a morning doesn't read as a drop.
func TestTimelinePreviousMatchesElapsed(t *testing.T) {
	now := time.Date(2026, 11, 1, 6, 0, 0, 0, time.UTC)
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	events := []timelineEvent{
		{TemplateID: "a", SampledAt: at("2026-10-20T10:00:00Z"), EarnedCents: 100},
		{TemplateID: "a", SampledAt: at("2026-10-25T12:00:00Z"), EarnedCents: 40}, // past 06:00 of the range's last day
		{TemplateID: "a", SampledAt: at("2026-10-31T10:00:00Z"), EarnedCents: 70},
	}
	got := buildTimeline(7, now, at("2026-01-01T00:00:00Z"), events, nil, []timelineTemplate{{TemplateID: "a"}}, nil)
	if got.Window.EarnedCents != 70 || got.Window.PreviousEarnedCents != 100 {
		t.Errorf("window = %d¢, previous = %d¢; want 70¢ and 100¢", got.Window.EarnedCents, got.Window.PreviousEarnedCents)
	}
}
