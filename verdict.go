package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
)

// The day-14 verdict (docs/designs/day-14-template-verdict.md): read every
// template at day 14, test against day 45 (later day 90) whether that
// reading told which ones went on to earn, and call a template keep or
// watch only while a stored checkpoint says its predictor passed.

const (
	verdictReadDay      = 14
	verdictTolerance    = 24 * time.Hour // a reading is the real row closest to its day, at most a day off
	verdictMinN         = 20
	verdictMinPositives = 4
	verdictMinGroup     = 5
	// minOutcomeRise is the dollars of lifetime earnings a template must add
	// between its day-14 and outcome readings to count as having paid off.
	minOutcomeRise = 1.0
	// Twenty CRM is half of all lifetime kickback; left in, it would decide
	// the originals-vs-competitive split by itself.
	twentyTemplateID = "387e1172-7620-4700-806a-fa92d03b16f4"
)

// verdictHorizons are the outcome days, earliest first. Each gets judged
// once, when that many days have passed for verdictMinN templates and
// verdictMinPositives of them rose. Short of that, a judgment could only say
// "not enough data", so the horizon waits for a bigger cohort instead.
var verdictHorizons = []int{45, 90}

// VerdictCheckpoint is a backtest judged once and kept. Judging live on
// every request would re-roll small samples until a predictor passed by
// chance; the verdicts read the latest checkpoint instead.
type VerdictCheckpoint struct {
	Horizon  int `gorm:"primaryKey"`
	JudgedAt time.Time
	Result   string // the verdictBacktest as judged, JSON
}

// verdictSubject is a template as the verdict sees it. Day 0 is the first
// sample that saw it published, not Railway's createdAt.
type verdictSubject struct {
	TemplateID  string
	Name        string
	Origin      string
	FirstSeenAt time.Time
	// Published: still in the catalog at the latest sample.
	Published bool
	// Services from the first snapshot at or after day 14 that recorded
	// them, so it stays fixed like the day-14 reading.
	Services int64
	rows     []verdictRow
}

// verdictRow is a snapshot where templateMetrics came back; rows where it
// failed carry payout copied into total_earnings and are never read.
type verdictRow struct {
	TemplateID     string
	SampledAt      time.Time
	TotalEarnings  float64
	ActiveProjects int64
}

type verdictReading struct {
	At             time.Time `json:"at"`
	Earnings       float64   `json:"earnings"`
	ActiveProjects int64     `json:"activeProjects"`
}

type predictorResult struct {
	TrueN          int      `json:"trueN"`
	TruePositives  int      `json:"truePositives"`
	TrueRate       *float64 `json:"trueRate"`
	FalseN         int      `json:"falseN"`
	FalsePositives int      `json:"falsePositives"`
	FalseRate      *float64 `json:"falseRate"`
	Result         string   `json:"result"` // pass, fail, not enough data
}

type originGroup struct {
	N         int `json:"n"`
	Positives int `json:"positives"`
}

// verdictExcluded counts templates old enough to score that were left out,
// so a pass can't hide that only survivors were counted.
type verdictExcluded struct {
	PreTracking int `json:"preTracking"`
	Unpublished int `json:"unpublished"`
	NoDay14     int `json:"noDay14"`
	NoOutcome   int `json:"noOutcome"`
}

type verdictBacktest struct {
	Horizon   int             `json:"horizon"`
	N         int             `json:"n"`
	Positives int             `json:"positives"`
	P1        predictorResult `json:"p1"`
	P2        predictorResult `json:"p2"`
	// Origins splits n by the owner-set origin, Twenty CRM left out;
	// Unmarked are scored templates with no origin set yet.
	Origins  map[string]*originGroup `json:"origins"`
	Unmarked int                     `json:"unmarked"`
	Excluded verdictExcluded         `json:"excluded"`
}

type templateVerdict struct {
	TemplateID string          `json:"templateId"`
	State      string          `json:"state"` // too early, pre-tracking, keep, watch, no signal
	Day14      *verdictReading `json:"day14"`
	P1         *bool           `json:"p1"`
	P2         *bool           `json:"p2"`
}

type judgedCheckpoint struct {
	JudgedAt time.Time `json:"judgedAt"`
	verdictBacktest
}

type verdictsResponse struct {
	TrackedSince   time.Time `json:"trackedSince"`
	MinOutcomeRise float64   `json:"minOutcomeRise"`
	// Checkpoint is the latest judged backtest, the one states follow; nil
	// until the day-45 cohort first reaches verdictMinN and verdictMinPositives.
	Checkpoint *judgedCheckpoint `json:"checkpoint"`
	// Provisional is every horizon recomputed now. It moves hour to hour
	// and decides nothing.
	Provisional []verdictBacktest `json:"provisional"`
	Templates   []templateVerdict `json:"templates"`
}

func days(n int) time.Duration { return time.Duration(n) * 24 * time.Hour }

// reading is the real row closest to day n, at most verdictTolerance off,
// or nil while that window is still open: a row arriving later could be
// closer, and a shown reading must never move.
func (s verdictSubject) reading(n int, now time.Time) *verdictReading {
	target := s.FirstSeenAt.Add(days(n))
	if now.Before(target.Add(verdictTolerance)) {
		return nil
	}
	var best *verdictRow
	for i := range s.rows {
		d := s.rows[i].SampledAt.Sub(target).Abs()
		if d <= verdictTolerance && (best == nil || d < best.SampledAt.Sub(target).Abs()) {
			best = &s.rows[i]
		}
	}
	if best == nil {
		return nil
	}
	return &verdictReading{At: best.SampledAt, Earnings: best.TotalEarnings, ActiveProjects: best.ActiveProjects}
}

// preTracking: already live when tracking began, so its first sample is not
// its day 0 and its "day 14" would hold months of earnings.
func (s verdictSubject) preTracking(trackedSince time.Time) bool {
	return s.FirstSeenAt.Equal(trackedSince)
}

// P1: accruing at day 14. P2: heavy (2+ services) and in use.
func p1(r *verdictReading) bool                   { return r.Earnings > 0 }
func p2(s verdictSubject, r *verdictReading) bool { return r.ActiveProjects > 0 && s.Services >= 2 }

func backtestAt(subjects []verdictSubject, trackedSince, now time.Time, horizon int) verdictBacktest {
	b := verdictBacktest{Horizon: horizon, Origins: map[string]*originGroup{}}
	for _, o := range templateOrigins {
		b.Origins[o] = &originGroup{}
	}
	var p1Groups, p2Groups [2][2]int // [predictor true?][n, positives]
	idx := func(v bool) int {
		if v {
			return 1
		}
		return 0
	}
	for _, s := range subjects {
		if now.Before(s.FirstSeenAt.Add(days(horizon)).Add(verdictTolerance)) {
			continue // outcome window still open
		}
		if s.preTracking(trackedSince) {
			b.Excluded.PreTracking++
			continue
		}
		day14, outcome := s.reading(verdictReadDay, now), s.reading(horizon, now)
		switch {
		case (day14 == nil || outcome == nil) && !s.Published:
			b.Excluded.Unpublished++
			continue
		case day14 == nil:
			b.Excluded.NoDay14++
			continue
		case outcome == nil:
			b.Excluded.NoOutcome++
			continue
		}
		positive := outcome.Earnings >= day14.Earnings+minOutcomeRise
		pos := idx(positive)
		b.N++
		b.Positives += pos
		p1Groups[idx(p1(day14))][0]++
		p1Groups[idx(p1(day14))][1] += pos
		p2Groups[idx(p2(s, day14))][0]++
		p2Groups[idx(p2(s, day14))][1] += pos
		if s.TemplateID == twentyTemplateID {
			continue
		}
		if g, ok := b.Origins[s.Origin]; ok {
			g.N++
			g.Positives += pos
		} else {
			b.Unmarked++
		}
	}
	enough := b.N >= verdictMinN && b.Positives >= verdictMinPositives
	b.P1 = judgePredictor(p1Groups, enough)
	b.P2 = judgePredictor(p2Groups, enough)
	return b
}

// judgePredictor applies the pass rule fixed before the first run: the
// true group's rise rate is at least 50% and at least twice the false
// group's, each group holding verdictMinGroup templates or more.
func judgePredictor(g [2][2]int, enough bool) predictorResult {
	rate := func(n, pos int) *float64 {
		if n == 0 {
			return nil
		}
		r := float64(pos) / float64(n)
		return &r
	}
	p := predictorResult{
		TrueN: g[1][0], TruePositives: g[1][1], TrueRate: rate(g[1][0], g[1][1]),
		FalseN: g[0][0], FalsePositives: g[0][1], FalseRate: rate(g[0][0], g[0][1]),
	}
	switch {
	case !enough || p.TrueN < verdictMinGroup || p.FalseN < verdictMinGroup:
		p.Result = "not enough data"
	case *p.TrueRate >= 0.5 && *p.TrueRate >= 2**p.FalseRate:
		p.Result = "pass"
	default:
		p.Result = "fail"
	}
	return p
}

// verdictStates gives every template one state, first match wins. keep and
// watch follow the judged checkpoint, never the live numbers.
func verdictStates(subjects []verdictSubject, trackedSince, now time.Time, checkpoint *verdictBacktest) []templateVerdict {
	out := make([]templateVerdict, 0, len(subjects))
	for _, s := range subjects {
		v := templateVerdict{TemplateID: s.TemplateID}
		v.Day14 = s.reading(verdictReadDay, now)
		if v.Day14 != nil && !s.preTracking(trackedSince) {
			a, b := p1(v.Day14), p2(s, v.Day14)
			v.P1, v.P2 = &a, &b
		}
		switch {
		case now.Before(s.FirstSeenAt.Add(days(verdictReadDay)).Add(verdictTolerance)):
			v.State = "too early"
		case v.P1 == nil:
			v.State = "pre-tracking"
		case *v.P1 && checkpoint != nil && checkpoint.P1.Result == "pass":
			v.State = "keep"
		case *v.P2 && checkpoint != nil && checkpoint.P2.Result == "pass":
			v.State = "watch"
		default:
			v.State = "no signal"
		}
		out = append(out, v)
	}
	return out
}

// handleVerdicts serves the backtest and each template's verdict, judging
// and storing a horizon's checkpoint the first time verdictMinN templates
// have reached it with verdictMinPositives rises among them. Responds null until the first snapshot.
func handleVerdicts(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(err error) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		ctx := r.Context()
		trackedSince, err := scanTime(ctx, db, "SELECT MIN(sampled_at) FROM template_snapshots")
		if err != nil {
			fail(err)
			return
		}
		if trackedSince == nil {
			writeJSON(w, http.StatusOK, nil)
			return
		}
		subjects, err := loadVerdictSubjects(db.WithContext(ctx))
		if err != nil {
			fail(err)
			return
		}
		// DuckDB keeps microseconds; a checkpoint judged now must read back equal.
		now := time.Now().UTC().Truncate(time.Microsecond)

		var stored []VerdictCheckpoint
		if err := db.WithContext(ctx).Order("horizon").Find(&stored).Error; err != nil {
			fail(err)
			return
		}
		judged := map[int]judgedCheckpoint{}
		for _, c := range stored {
			var b verdictBacktest
			if err := json.Unmarshal([]byte(c.Result), &b); err != nil {
				fail(err)
				return
			}
			judged[c.Horizon] = judgedCheckpoint{JudgedAt: c.JudgedAt, verdictBacktest: b}
		}
		resp := verdictsResponse{TrackedSince: *trackedSince, MinOutcomeRise: minOutcomeRise}
		for _, h := range verdictHorizons {
			b := backtestAt(subjects, *trackedSince, now, h)
			resp.Provisional = append(resp.Provisional, b)
			if _, ok := judged[h]; ok || b.N < verdictMinN || b.Positives < verdictMinPositives {
				continue
			}
			result, _ := json.Marshal(b)
			// ON CONFLICT DO NOTHING: two requests racing to judge keep the first.
			if err := db.WithContext(ctx).Exec("INSERT INTO verdict_checkpoints (horizon, judged_at, result) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", h, now, string(result)).Error; err != nil {
				fail(err)
				return
			}
			judged[h] = judgedCheckpoint{JudgedAt: now, verdictBacktest: b}
		}
		var latest *verdictBacktest
		for _, h := range verdictHorizons {
			if c, ok := judged[h]; ok {
				resp.Checkpoint = &c
				latest = &c.verdictBacktest
			}
		}
		resp.Templates = verdictStates(subjects, *trackedSince, now, latest)
		writeJSON(w, http.StatusOK, resp)
	}
}

func loadVerdictSubjects(db *gorm.DB) ([]verdictSubject, error) {
	var subjects []verdictSubject
	err := db.Raw(`
		WITH seen AS (
			SELECT template_id, MIN(sampled_at) AS first_seen_at, MAX(sampled_at) AS last_seen_at,
			       arg_max(name, sampled_at) AS name
			FROM template_snapshots WHERE status = 'PUBLISHED' GROUP BY template_id
		)
		SELECT seen.template_id, seen.name, COALESCE(o.origin, '') AS origin, seen.first_seen_at,
		       seen.last_seen_at = (SELECT MAX(last_seen_at) FROM seen) AS published,
		       COALESCE((SELECT arg_min(s.services, s.sampled_at) FROM template_snapshots s
		                 WHERE s.template_id = seen.template_id AND s.services > 0
		                   AND s.sampled_at >= seen.first_seen_at + INTERVAL 14 DAY), 0) AS services
		FROM seen LEFT JOIN template_origins o USING (template_id)
		ORDER BY seen.first_seen_at, seen.template_id`).Scan(&subjects).Error
	if err != nil {
		return nil, err
	}
	// Only rows inside a reading window: at most two days of hourly rows
	// per window per template.
	windows := []string{}
	for _, d := range append([]int{verdictReadDay}, verdictHorizons...) {
		windows = append(windows, fmt.Sprintf("s.sampled_at BETWEEN seen.d0 + INTERVAL %d DAY AND seen.d0 + INTERVAL %d DAY", d-1, d+1))
	}
	var rows []verdictRow
	err = db.Raw(`
		WITH seen AS (
			SELECT template_id, MIN(sampled_at) AS d0
			FROM template_snapshots WHERE status = 'PUBLISHED' GROUP BY template_id
		)
		SELECT s.template_id, s.sampled_at, s.total_earnings, s.active_projects
		FROM template_snapshots s JOIN seen USING (template_id)
		WHERE s.total_deployments IS NOT NULL AND s.total_earnings IS NOT NULL
		  AND (` + strings.Join(windows, " OR ") + `)`).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	byID := map[string]*verdictSubject{}
	for i := range subjects {
		byID[subjects[i].TemplateID] = &subjects[i]
	}
	for _, row := range rows {
		if s := byID[row.TemplateID]; s != nil {
			s.rows = append(s.rows, row)
		}
	}
	return subjects, nil
}
