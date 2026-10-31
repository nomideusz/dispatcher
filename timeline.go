package main

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// timelineEvent is one rise a template showed between two consecutive
// snapshots: kickback booked (totalPayout rose) or projects added (projects
// rose). SampledAt is the snapshot that saw it and PreviousAt the one before,
// so the change happened in between — after a collection gap that spans days.
// Ledger rows are credit payouts from Railway's history, at their exact time;
// they cover the money earned before the first snapshot.
type timelineEvent struct {
	TemplateID  string
	SampledAt   time.Time
	PreviousAt  time.Time
	EarnedCents int64
	NewProjects int64
	Ledger      bool
}

// usageSample is the workspace's project counts at one collector sample,
// and how many published templates had projects at all (Deployed), live
// projects (Active) and kickback in Railway's trailing 30 days (Earning).
// Running is nil on samples taken before templateMetrics was collected,
// Earning on those before earningsLast30Days was. LifetimeCents is what the
// published templates had earned by then.
type usageSample struct {
	SampledAt         time.Time
	Projects          int64
	ActiveProjects    int64
	Running           *int64
	DeployedTemplates int64
	ActiveTemplates   int64
	EarningTemplates  *int64
	LifetimeCents     int64
}

// timelinePoint is one UTC day. EarnedCents and NewProjects are what the
// day's snapshots saw arrive; the counts are the day's last sample, nil on a
// day without one (before tracking, or during a collection gap). Published
// and Services are the catalog as of the end of the day.
type timelinePoint struct {
	Date              string `json:"date"`
	EarnedCents       int64  `json:"earnedCents"`
	NewProjects       int64  `json:"newProjects"`
	Projects          *int64 `json:"projects"`
	ActiveProjects    *int64 `json:"activeProjects"`
	Running           *int64 `json:"running"`
	DeployedTemplates *int64 `json:"deployedTemplates"`
	ActiveTemplates   *int64 `json:"activeTemplates"`
	EarningTemplates  *int64 `json:"earningTemplates"`
	LifetimeCents     *int64 `json:"lifetimeCents"`
	Published         int    `json:"published"`
	Services          int    `json:"services"`
}

type timelineActivity struct {
	Date        string `json:"date"`
	EarnedCents int64  `json:"earnedCents"`
	NewProjects int64  `json:"newProjects"`
}

// timelineTemplate is a template's latest snapshot plus what the timeline
// knows about it: the window's projects and kickback, day by day in Activity,
// and the dates it was last deployed and first/last paid (all time).
type timelineTemplate struct {
	TemplateID     string     `json:"templateId"`
	Name           string     `json:"name"`
	Code           string     `json:"code"`
	Kind           string     `json:"kind"`
	Origin         string     `json:"origin"`
	FixedOn        string     `json:"fixedOn"`
	PublishedAt    *time.Time `json:"publishedAt"`
	FirstSeenAt    time.Time  `json:"firstSeenAt"`
	Services       int64      `json:"services"`
	Projects       int64      `json:"projects"`
	ActiveProjects int64      `json:"activeProjects"`
	Running        *int64     `json:"running"`
	Deployments    *int64     `json:"deployments"`
	Health         *float64   `json:"health"`
	SupportHealth  *float64   `json:"supportHealth"`
	Earned30d      *float64   `json:"earned30d"`
	LifetimeCents  int64      `json:"lifetimeCents"`

	EarnedCents int64              `json:"earnedCents" gorm:"-"`
	NewProjects int64              `json:"newProjects" gorm:"-"`
	Activity    []timelineActivity `json:"activity" gorm:"-"`
	// LastDeployAt is the snapshot that saw the latest new project and
	// LastDeployAfter the one before it: the project arrived in between.
	LastDeployAt    *time.Time `json:"lastDeployAt" gorm:"-"`
	LastDeployAfter *time.Time `json:"lastDeployAfter" gorm:"-"`
	FirstPaidAt     *time.Time `json:"firstPaidAt" gorm:"-"`
	LastPaidAt      *time.Time `json:"lastPaidAt" gorm:"-"`
}

// timelineWindow sums the selected range against the one before it.
// PreviousNewProjects is nil when that range began before tracking did, since
// projects before the first snapshot were never observed arriving.
type timelineWindow struct {
	Days                int    `json:"days"`
	EarnedCents         int64  `json:"earnedCents"`
	PreviousEarnedCents int64  `json:"previousEarnedCents"`
	NewProjects         int64  `json:"newProjects"`
	PreviousNewProjects *int64 `json:"previousNewProjects"`
}

// timelineGap is a stretch of more than a day without a usage sample. Counts
// are missing inside it, and whatever arrived during it lands on To.
type timelineGap struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type timelineResponse struct {
	SampledAt    time.Time          `json:"sampledAt"`
	TrackedSince time.Time          `json:"trackedSince"`
	Window       timelineWindow     `json:"window"`
	Gaps         []timelineGap      `json:"gaps"`
	Points       []timelinePoint    `json:"points"`
	Templates    []timelineTemplate `json:"templates"`
}

const timelineGapThreshold = 24 * time.Hour

// handleTimeline serves the daily workspace timeline and per-template
// activity for ?days=N (default 30). Responds null until the first snapshot.
func handleTimeline(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days := defaultPayoutWindowDays
		if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v >= 1 && v <= maxPayoutWindowDays {
			days = v
		}
		fail := func(err error) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		ctx := r.Context()
		trackedSince, err := scanTime(ctx, db, "SELECT MIN(sampled_at) FROM template_snapshots")
		if err != nil {
			fail(err)
			return
		}
		sampledAt, err := scanTime(ctx, db, "SELECT MAX(sampled_at) FROM template_snapshots WHERE status = 'PUBLISHED'")
		if err != nil {
			fail(err)
			return
		}
		if trackedSince == nil || sampledAt == nil {
			writeJSON(w, http.StatusOK, nil)
			return
		}

		templates := []timelineTemplate{}
		err = db.WithContext(ctx).Raw(`
			WITH seen AS (
				SELECT template_id, MIN(sampled_at) AS first_seen_at
				FROM template_snapshots WHERE status = 'PUBLISHED' GROUP BY template_id
			)
			SELECT s.template_id, s.name, s.code, COALESCE(k.kind, '') AS kind, COALESCE(o.origin, '') AS origin, COALESCE(f.fixed_on, '') AS fixed_on, s.published_at, seen.first_seen_at,
			       s.services, s.projects, s.active_projects,
			       s.active_deployments AS running, s.total_deployments AS deployments,
			       s.template_health AS health, s.support_health,
			       s.earnings_last30_days AS earned30d,
			       CAST(ROUND(s.total_payout * 100) AS BIGINT) AS lifetime_cents
			FROM template_snapshots s JOIN seen USING (template_id)
			LEFT JOIN template_kinds k USING (template_id)
			LEFT JOIN template_origins o USING (template_id)
			LEFT JOIN template_fixes f USING (template_id)
			WHERE s.sampled_at = ? AND s.status = 'PUBLISHED'
			ORDER BY s.total_payout DESC, s.name`, *sampledAt).Scan(&templates).Error
		if err != nil {
			fail(err)
			return
		}

		// Money rises read every snapshot, the backfilled ones included;
		// project rises only published ones, whose counts are real.
		events := []timelineEvent{}
		err = db.WithContext(ctx).Raw(`
			WITH money AS (
				SELECT template_id, sampled_at, LAG(sampled_at) OVER w AS previous_at,
				       CAST(ROUND((total_payout - LAG(total_payout) OVER w) * 100) AS BIGINT) AS earned_cents
				FROM template_snapshots
				WINDOW w AS (PARTITION BY template_id ORDER BY sampled_at)
			), usage AS (
				SELECT template_id, sampled_at, LAG(sampled_at) OVER w AS previous_at,
				       projects - LAG(projects) OVER w AS new_projects
				FROM template_snapshots WHERE status = 'PUBLISHED'
				WINDOW w AS (PARTITION BY template_id ORDER BY sampled_at)
			)
			SELECT template_id, sampled_at, previous_at, earned_cents, 0 AS new_projects, false AS ledger
			FROM money WHERE earned_cents > 0
			UNION ALL
			SELECT template_id, sampled_at, previous_at, 0, new_projects, false
			FROM usage WHERE new_projects > 0
			UNION ALL
			SELECT template_id, created_at, created_at, amount_cents, 0, true
			FROM payouts WHERE kind = 'credits'`).Scan(&events).Error
		if err != nil {
			fail(err)
			return
		}

		now := time.Now().UTC()
		samples := []usageSample{}
		err = db.WithContext(ctx).Raw(`
			SELECT sampled_at,
			       CAST(SUM(projects) AS BIGINT) AS projects,
			       CAST(SUM(active_projects) AS BIGINT) AS active_projects,
			       CAST(SUM(active_deployments) AS BIGINT) AS running,
			       COUNT(*) FILTER (WHERE projects > 0) AS deployed_templates,
			       -- Running instances where the sample has them: a project can stay
			       -- "active" with every service down, and a live service earns.
			       COUNT(*) FILTER (WHERE COALESCE(active_deployments, active_projects) > 0) AS active_templates,
			       CASE WHEN COUNT(earnings_last30_days) > 0
			            THEN COUNT(*) FILTER (WHERE earnings_last30_days > 0) END AS earning_templates,
			       CAST(ROUND(SUM(total_payout) * 100) AS BIGINT) AS lifetime_cents
			FROM template_snapshots
			WHERE status = 'PUBLISHED' AND sampled_at >= ?
			GROUP BY sampled_at ORDER BY sampled_at`, timelineStart(now, days).AddDate(0, 0, -days)).Scan(&samples).Error
		if err != nil {
			fail(err)
			return
		}
		publishes, err := loadTemplatePublishes(ctx, db)
		if err != nil {
			fail(err)
			return
		}

		resp := buildTimeline(days, now, trackedSince.UTC(), events, samples, templates, publishes)
		resp.SampledAt = sampledAt.UTC()
		writeJSON(w, http.StatusOK, resp)
	}
}

// timelineStart is the first day of a days-long window ending today (UTC),
// the same whole-day window the payout chart uses.
func timelineStart(now time.Time, days int) time.Time {
	return now.UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
}

// buildTimeline buckets events and samples into UTC days over the window and
// fills in each template's window figures and all-time dates. Ledger events
// count toward sums only before trackedSince: after it the snapshots see the
// same money arrive. For first/last paid they count throughout, since their
// times are exact.
func buildTimeline(days int, now, trackedSince time.Time, events []timelineEvent, samples []usageSample, templates []timelineTemplate, publishes []templatePublish) timelineResponse {
	today := now.UTC().Truncate(24 * time.Hour)
	windowStart := timelineStart(now, days)
	previousStart := windowStart.AddDate(0, 0, -days)
	resp := timelineResponse{
		TrackedSince: trackedSince,
		Window:       timelineWindow{Days: days},
		Gaps:         []timelineGap{},
		Points:       []timelinePoint{},
		Templates:    templates,
	}

	byID := make(map[string]*timelineTemplate, len(templates))
	for i := range resp.Templates {
		t := &resp.Templates[i]
		t.Activity = []timelineActivity{}
		byID[t.TemplateID] = t
	}

	// Railway's earningsLast30Days lags the payouts the snapshots see (a
	// template's first cents can read $0 for a day), so Earned30d is
	// whichever is larger.
	monthAgo := now.Add(-30 * 24 * time.Hour)
	own30 := map[*timelineTemplate]int64{}
	perDay := map[string]*timelinePoint{}
	perTemplateDay := map[string]map[string]*timelineActivity{}
	var previousNew int64
	for _, e := range events {
		at := e.SampledAt.UTC()
		t := byID[e.TemplateID]
		if t != nil && e.EarnedCents > 0 {
			if t.FirstPaidAt == nil || at.Before(*t.FirstPaidAt) {
				t.FirstPaidAt = &at
			}
			if t.LastPaidAt == nil || at.After(*t.LastPaidAt) {
				t.LastPaidAt = &at
			}
		}
		if t != nil && e.NewProjects > 0 && (t.LastDeployAt == nil || at.After(*t.LastDeployAt)) {
			after := e.PreviousAt.UTC()
			t.LastDeployAt, t.LastDeployAfter = &at, &after
		}
		if e.Ledger && !at.Before(trackedSince) {
			continue
		}
		if t != nil && at.After(monthAgo) {
			own30[t] += e.EarnedCents
		}

		if at.Before(windowStart) {
			if !at.Before(previousStart) {
				resp.Window.PreviousEarnedCents += e.EarnedCents
				previousNew += e.NewProjects
			}
			continue
		}
		resp.Window.EarnedCents += e.EarnedCents
		resp.Window.NewProjects += e.NewProjects
		key := at.Format(dayKeyLayout)
		if perDay[key] == nil {
			perDay[key] = &timelinePoint{}
		}
		perDay[key].EarnedCents += e.EarnedCents
		perDay[key].NewProjects += e.NewProjects
		if t == nil {
			continue
		}
		t.EarnedCents += e.EarnedCents
		t.NewProjects += e.NewProjects
		if perTemplateDay[e.TemplateID] == nil {
			perTemplateDay[e.TemplateID] = map[string]*timelineActivity{}
		}
		a := perTemplateDay[e.TemplateID][key]
		if a == nil {
			a = &timelineActivity{Date: key}
			perTemplateDay[e.TemplateID][key] = a
		}
		a.EarnedCents += e.EarnedCents
		a.NewProjects += e.NewProjects
	}
	for t, cents := range own30 {
		if own := float64(cents) / 100; t.Earned30d == nil || own > *t.Earned30d {
			t.Earned30d = &own
		}
	}
	if !trackedSince.After(previousStart) {
		resp.Window.PreviousNewProjects = &previousNew
	}
	for id, byDay := range perTemplateDay {
		t := byID[id]
		for _, a := range byDay {
			t.Activity = append(t.Activity, *a)
		}
		sort.Slice(t.Activity, func(i, j int) bool { return t.Activity[i].Date < t.Activity[j].Date })
	}

	// Samples arrive oldest first: the last one of a day overwrites the rest.
	lastOfDay := map[string]usageSample{}
	var previous *usageSample
	for i, s := range samples {
		lastOfDay[s.SampledAt.UTC().Format(dayKeyLayout)] = s
		if previous != nil && s.SampledAt.Sub(previous.SampledAt) > timelineGapThreshold && s.SampledAt.After(windowStart) {
			resp.Gaps = append(resp.Gaps, timelineGap{From: previous.SampledAt.UTC(), To: s.SampledAt.UTC()})
		}
		previous = &samples[i]
	}
	// A collector that has stopped is a gap still open at now.
	if previous != nil && now.Sub(previous.SampledAt) > timelineGapThreshold {
		resp.Gaps = append(resp.Gaps, timelineGap{From: previous.SampledAt.UTC(), To: now.UTC()})
	}

	for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
		key := d.Format(dayKeyLayout)
		p := timelinePoint{Date: key}
		if sums := perDay[key]; sums != nil {
			p.EarnedCents, p.NewProjects = sums.EarnedCents, sums.NewProjects
		}
		if s, ok := lastOfDay[key]; ok {
			p.Projects, p.ActiveProjects, p.Running = &s.Projects, &s.ActiveProjects, s.Running
			p.DeployedTemplates, p.ActiveTemplates, p.EarningTemplates = &s.DeployedTemplates, &s.ActiveTemplates, s.EarningTemplates
			p.LifetimeCents = &s.LifetimeCents
		}
		p.Published, p.Services = catalogAsOf(publishes, d.Add(24*time.Hour-time.Nanosecond))
		resp.Points = append(resp.Points, p)
	}
	return resp
}
