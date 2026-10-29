package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

var vT0 = time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)

// at is d days (fractions allowed) after vT0.
func at(d float64) time.Time { return vT0.Add(time.Duration(d * float64(24*time.Hour))) }

// subject is a template first seen at vT0 with one real row per
// day → earnings entry.
func subject(id string, rows map[float64]float64) verdictSubject {
	s := verdictSubject{TemplateID: id, FirstSeenAt: vT0, Published: true, Services: 1}
	for d, e := range rows {
		s.rows = append(s.rows, verdictRow{TemplateID: id, SampledAt: at(d), TotalEarnings: e})
	}
	return s
}

func TestVerdictReadingsAndStates(t *testing.T) {
	tracked := vT0.Add(-30 * 24 * time.Hour)
	pass := &verdictBacktest{P1: predictorResult{Result: "pass"}, P2: predictorResult{Result: "pass"}}
	heavy := subject("heavy", map[float64]float64{14: 0})
	heavy.Services, heavy.rows[0].ActiveProjects = 3, 2
	old := subject("old", map[float64]float64{14: 50})
	for _, c := range []struct {
		name       string
		s          verdictSubject
		now        float64
		checkpoint *verdictBacktest
		tracked    time.Time
		want       string
		wantAt     float64 // day of the day-14 reading, 0 for none
	}{
		{"window still open at day 14.5", subject("a", map[float64]float64{14: 1}), 14.5, pass, tracked, "too early", 0},
		{"final after day 15", subject("a", map[float64]float64{14: 1}), 15.1, pass, tracked, "keep", 14},
		{"closest row in the window wins", subject("a", map[float64]float64{13.2: 0, 14.1: 1}), 30, pass, tracked, "keep", 14.1},
		{"collection gap over day 14", subject("a", map[float64]float64{12: 1, 16: 1}), 30, pass, tracked, "pre-tracking", 0},
		{"live before tracking began", old, 30, pass, vT0, "pre-tracking", 14},
		{"no checkpoint yet", subject("a", map[float64]float64{14: 1}), 30, nil, tracked, "no signal", 14},
		{"P1 failed at the checkpoint", subject("a", map[float64]float64{14: 1}), 30, &verdictBacktest{P1: predictorResult{Result: "fail"}}, tracked, "no signal", 14},
		{"heavy and used", heavy, 30, &verdictBacktest{P2: predictorResult{Result: "pass"}}, tracked, "watch", 14},
	} {
		got := verdictStates([]verdictSubject{c.s}, c.tracked, at(c.now), c.checkpoint)[0]
		if got.State != c.want {
			t.Errorf("%s: state = %q, want %q", c.name, got.State, c.want)
		}
		if c.wantAt == 0 && c.want != "pre-tracking" && got.Day14 != nil {
			t.Errorf("%s: day-14 reading shown while its window is open", c.name)
		}
		if c.wantAt != 0 && (got.Day14 == nil || !got.Day14.At.Equal(at(c.wantAt))) {
			t.Errorf("%s: day-14 reading = %+v, want at day %v", c.name, got.Day14, c.wantAt)
		}
	}
}

// cohort builds n templates read at day 14 and 45: trueN of them earning at
// day 14 (truePos rising $1+ by day 45), the rest not (falsePos rising).
func cohort(trueN, truePos, falseN, falsePos int) []verdictSubject {
	var out []verdictSubject
	add := func(id string, start, end float64) {
		out = append(out, subject(id, map[float64]float64{14: start, 45: end}))
	}
	for i := range trueN {
		add("t"+string(rune('a'+i)), 2, map[bool]float64{true: 3, false: 2.5}[i < truePos])
	}
	for i := range falseN {
		add("f"+string(rune('a'+i)), 0, map[bool]float64{true: 1, false: 0.99}[i < falsePos])
	}
	return out
}

func TestBacktestPassRule(t *testing.T) {
	tracked, now := vT0.Add(-time.Hour), at(60)
	for _, c := range []struct {
		name string
		sub  []verdictSubject
		want string
	}{
		{"separates", cohort(5, 4, 15, 2), "pass"},
		{"true rate under 50%", cohort(5, 2, 15, 2), "fail"},
		{"true rate under twice false", cohort(6, 3, 14, 4), "fail"},
		{"true group under 5", cohort(4, 4, 16, 2), "not enough data"},
		{"n under 20", cohort(5, 4, 14, 2), "not enough data"},
		{"fewer than 4 positives ($0.99 rises don't count)", cohort(5, 3, 15, 0), "not enough data"},
	} {
		b := backtestAt(c.sub, tracked, now, 45)
		if b.P1.Result != c.want {
			t.Errorf("%s: P1 = %q (%+v), want %q", c.name, b.P1.Result, b.P1, c.want)
		}
	}
}

func TestBacktestExclusionsAndOrigins(t *testing.T) {
	tracked, now := vT0.Add(-time.Hour), at(60)
	original := subject("orig", map[float64]float64{14: 0, 45: 5})
	original.Origin = "original"
	twenty := subject(twentyTemplateID, map[float64]float64{14: 10, 45: 50})
	twenty.Origin = "competitive"
	unmarked := subject("unmarked", map[float64]float64{14: 0, 45: 0})
	gone := subject("gone", map[float64]float64{14: 0})
	gone.Published = false
	noOutcome := subject("no-outcome", map[float64]float64{14: 0})
	noDay14 := subject("no-day14", map[float64]float64{45: 0})
	young := subject("young", map[float64]float64{14: 0})
	young.FirstSeenAt = at(30)
	pre := subject("pre", map[float64]float64{14: 0, 45: 9})
	pre.FirstSeenAt = tracked
	pre.rows = []verdictRow{{SampledAt: tracked.Add(days(14))}, {SampledAt: tracked.Add(days(45)), TotalEarnings: 9}}

	b := backtestAt([]verdictSubject{original, twenty, unmarked, gone, noOutcome, noDay14, young, pre}, tracked, now, 45)
	if b.N != 3 || b.Positives != 2 {
		t.Errorf("n = %d, positives = %d, want 3 and 2", b.N, b.Positives)
	}
	want := verdictExcluded{PreTracking: 1, Unpublished: 1, NoDay14: 1, NoOutcome: 1}
	if b.Excluded != want {
		t.Errorf("excluded = %+v, want %+v", b.Excluded, want)
	}
	if o, c := *b.Origins["original"], *b.Origins["competitive"]; o != (originGroup{1, 1}) || c != (originGroup{}) || b.Unmarked != 1 {
		t.Errorf("origins = %+v / %+v, unmarked %d; want original 1/1, Twenty left out, 1 unmarked", o, c, b.Unmarked)
	}
}

func verdictDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "verdicts.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TemplateSnapshot{}, &TemplateOrigin{}, &VerdictCheckpoint{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func getVerdicts(t *testing.T, db *gorm.DB) verdictsResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	handleVerdicts(db)(rec, httptest.NewRequest(http.MethodGet, "/api/analytics/verdicts", nil))
	var resp verdictsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("status %d, %v: %s", rec.Code, err, rec.Body)
	}
	return resp
}

// The SQL side: day 0 is the first PUBLISHED sample, rows where the metrics
// fetch failed (total_earnings backfilled from payout) are never read, and
// a horizon is judged once and then kept.
func TestHandleVerdictsReadsRealRowsAndKeepsCheckpoints(t *testing.T) {
	db := verdictDB(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	d0 := now.Add(-days(50))
	earned := func(v float64) *float64 { return &v }
	one := pointerTo[int64](1)
	var snaps []TemplateSnapshot
	// Already live when tracking began: its first sample is trackedSince.
	snaps = append(snaps, TemplateSnapshot{SampledAt: d0.Add(-days(30)), TemplateID: "old", Status: "PUBLISHED", TotalDeployments: one, TotalEarnings: earned(80)})
	// "probe": a draft first, created well before it was published; a
	// backfilled row sits exactly on day 14 with payout copied in.
	snaps = append(snaps,
		TemplateSnapshot{SampledAt: d0.Add(-days(5)), TemplateID: "probe", Status: "UNPUBLISHED", PublishedAt: &d0},
		TemplateSnapshot{SampledAt: d0, TemplateID: "probe", Status: "PUBLISHED", PublishedAt: pointerTo(d0.Add(-days(5)))},
		TemplateSnapshot{SampledAt: d0.Add(days(14)), TemplateID: "probe", Status: "PUBLISHED", TotalEarnings: earned(40)},
		TemplateSnapshot{SampledAt: d0.Add(days(14) + 6*time.Hour), TemplateID: "probe", Status: "PUBLISHED", TotalDeployments: one, TotalEarnings: earned(0)},
		TemplateSnapshot{SampledAt: d0.Add(days(45)), TemplateID: "probe", Status: "PUBLISHED", TotalDeployments: one, TotalEarnings: earned(0)},
	)
	// 20 more templates: 5 earning at day 14 (4 rising), 15 not (2 rising).
	for _, s := range cohort(5, 4, 15, 2) {
		for _, r := range s.rows {
			snaps = append(snaps, TemplateSnapshot{
				SampledAt: d0.Add(r.SampledAt.Sub(vT0)), TemplateID: s.TemplateID, Status: "PUBLISHED",
				TotalDeployments: one, TotalEarnings: earned(r.TotalEarnings),
			})
		}
		snaps = append(snaps, TemplateSnapshot{SampledAt: d0, TemplateID: s.TemplateID, Status: "PUBLISHED"})
	}
	// Everyone still published at the latest sample.
	for _, id := range []string{"old", "probe"} {
		snaps = append(snaps, TemplateSnapshot{SampledAt: now.Add(-time.Hour), TemplateID: id, Status: "PUBLISHED"})
	}
	for _, s := range cohort(5, 4, 15, 2) {
		snaps = append(snaps, TemplateSnapshot{SampledAt: now.Add(-time.Hour), TemplateID: s.TemplateID, Status: "PUBLISHED"})
	}
	if err := db.Create(&snaps).Error; err != nil {
		t.Fatal(err)
	}

	resp := getVerdicts(t, db)
	states := map[string]templateVerdict{}
	for _, v := range resp.Templates {
		states[v.TemplateID] = v
	}
	probe := states["probe"]
	if probe.Day14 == nil || probe.Day14.Earnings != 0 || !probe.Day14.At.Equal(d0.Add(days(14)+6*time.Hour)) {
		t.Errorf("probe day 14 = %+v, want the real row 6h after day 14 (backfilled row ignored, day 0 = first PUBLISHED)", probe.Day14)
	}
	if states["old"].State != "pre-tracking" {
		t.Errorf("old = %q, want pre-tracking", states["old"].State)
	}
	if resp.Checkpoint == nil || resp.Checkpoint.Horizon != 45 || resp.Checkpoint.N != 21 || resp.Checkpoint.P1.Result != "pass" {
		t.Fatalf("checkpoint = %+v, want day 45 judged on n = 21 with P1 passing", resp.Checkpoint)
	}
	if states["ta"].State != "keep" || states["fa"].State != "no signal" {
		t.Errorf("states ta=%q fa=%q, want keep and no signal", states["ta"].State, states["fa"].State)
	}

	// Later data that would fail P1 doesn't touch the judged checkpoint.
	judgedAt := resp.Checkpoint.JudgedAt
	if err := db.Exec("UPDATE template_snapshots SET total_earnings = 0 WHERE template_id LIKE 't%'").Error; err != nil {
		t.Fatal(err)
	}
	again := getVerdicts(t, db)
	if !again.Checkpoint.JudgedAt.Equal(judgedAt) || again.Checkpoint.P1.Result != "pass" {
		t.Errorf("checkpoint changed: %+v", again.Checkpoint)
	}
	if again.Provisional[0].P1.Result == "pass" {
		t.Errorf("provisional numbers should follow the new data")
	}
	var count int64
	db.Model(&VerdictCheckpoint{}).Count(&count)
	if count != 1 {
		t.Errorf("%d checkpoints stored, want 1", count)
	}
}

func TestHandleVerdictsWaitsForEnoughPositives(t *testing.T) {
	db := verdictDB(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	d0 := now.Add(-days(50))
	one := pointerTo[int64](1)
	// Tracking began before the cohort, so none of it is pre-tracking.
	snaps := []TemplateSnapshot{{SampledAt: d0.Add(-days(30)), TemplateID: "old", Status: "PUBLISHED", TotalDeployments: one}}
	// n = 20 but only 3 rises: under verdictMinPositives.
	for _, s := range cohort(5, 1, 15, 2) {
		snaps = append(snaps, TemplateSnapshot{SampledAt: d0, TemplateID: s.TemplateID, Status: "PUBLISHED"})
		for _, r := range s.rows {
			snaps = append(snaps, TemplateSnapshot{
				SampledAt: d0.Add(r.SampledAt.Sub(vT0)), TemplateID: s.TemplateID, Status: "PUBLISHED",
				TotalDeployments: one, TotalEarnings: pointerTo(r.TotalEarnings),
			})
		}
	}
	if err := db.Create(&snaps).Error; err != nil {
		t.Fatal(err)
	}
	if resp := getVerdicts(t, db); resp.Checkpoint != nil || resp.Provisional[0].N != 20 {
		t.Fatalf("checkpoint = %+v, provisional n = %d; want none stored on n = 20 with 3 rises", resp.Checkpoint, resp.Provisional[0].N)
	}
	// A fourth rise makes the backtest decisive, and day 45 gets judged.
	if err := db.Exec("UPDATE template_snapshots SET total_earnings = 3 WHERE template_id = 'tb' AND total_earnings = 2.5").Error; err != nil {
		t.Fatal(err)
	}
	if resp := getVerdicts(t, db); resp.Checkpoint == nil || resp.Checkpoint.Positives != 4 {
		t.Fatalf("checkpoint = %+v, want day 45 judged with 4 rises", resp.Checkpoint)
	}
}

func TestSetTemplateOriginValidates(t *testing.T) {
	db := verdictDB(t)
	put := func(body string) int {
		req := httptest.NewRequest(http.MethodPut, "/api/templates/x/origin", strings.NewReader(body))
		req.SetPathValue("id", "x")
		rec := httptest.NewRecorder()
		handleSetTemplateOrigin(db)(rec, req)
		return rec.Code
	}
	stored := func() string {
		var o TemplateOrigin
		db.Find(&o, "template_id = ?", "x")
		return o.Origin
	}
	if code := put(`{"origin":"original"}`); code != http.StatusOK || stored() != "original" {
		t.Errorf("original: %d, stored %q", code, stored())
	}
	if code := put(`{"origin":"other"}`); code != http.StatusBadRequest || stored() != "original" {
		t.Errorf("other: %d, stored %q; want 400 and unchanged", code, stored())
	}
	if code := put(`{"origin":""}`); code != http.StatusOK || stored() != "" {
		t.Errorf("clear: %d, stored %q", code, stored())
	}
}
