package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// railwayCreditWithdrawalTypename is the union arm Railway uses for payouts
// taken as Railway credits instead of cash.
const railwayCreditWithdrawalTypename = "CreditWithdrawalInfo"

const (
	// dayKeyLayout is both the daily bucket key and the wire format for a
	// point on the chart.
	dayKeyLayout = "2006-01-02"
	// defaultPayoutWindowDays matches the analytics chart's default range.
	defaultPayoutWindowDays = 30
	maxPayoutWindowDays     = 365
)

// voidPayoutStatuses are the withdrawal states where no money actually moved.
// Everything else — COMPLETED, PENDING, and any state Railway adds later —
// counts toward the totals, so an unrecognized status never silently drops a
// payout out of the chart.
var voidPayoutStatuses = map[string]bool{
	"FAILED":    true,
	"CANCELLED": true,
	"CANCELED":  true,
	"REJECTED":  true,
}

func isVoidPayout(status string) bool { return voidPayoutStatuses[status] }

// payoutPoint is one day of the chart. Amounts are cumulative from the start
// of the selected window, so the line only ever climbs; Count is the running
// number of payouts behind it. Deployments is net-new template deploys in
// the same window (see applyWindowDeployments), for a count-vs-cash overlay.
type payoutPoint struct {
	Date         string `json:"date"` // YYYY-MM-DD
	CashCents    int64  `json:"cashCents"`
	CreditsCents int64  `json:"creditsCents"`
	Count        int    `json:"count"`
	Deployments  int64  `json:"deployments"`
}

// payoutWindow summarizes the selected range against the range of equal length
// immediately before it, for a "+8.4% vs previous 30d" read.
type payoutWindow struct {
	Days          int      `json:"days"`
	TotalCents    int64    `json:"totalCents"`
	PreviousCents int64    `json:"previousCents"`
	ChangePct     *float64 `json:"changePct"`
	Count         int      `json:"count"`
}

// payoutTotals carries the lifetime figures the chart deliberately does not
// plot. The chart is scoped to the selected window; a cumulative line that
// also spanned all time would need a second y-scale, whose alignment is
// arbitrary and invents a trend.
type payoutTotals struct {
	LifetimeCents int64      `json:"lifetimeCents"`
	CashCents     int64      `json:"cashCents"`
	CreditsCents  int64      `json:"creditsCents"`
	PendingCents  int64      `json:"pendingCents"`
	PendingCount  int        `json:"pendingCount"`
	Count         int        `json:"count"`
	FirstPayoutAt *time.Time `json:"firstPayoutAt"`
	LastPayoutAt  *time.Time `json:"lastPayoutAt"`
}

// payoutTemplateTotal is one line of the per-template breakdown: how many
// credit payouts a template earned in the selected window, what they added up
// to, and how many deployers that looks like. Payouts still awaiting
// attribution group under "pending", ones the matcher gave up on under
// "unknown" (see attribute.go).
//
// Railway writes one kickback row per billed service, and a deployer's
// services are billed together: a single-service template pays out one row
// at a time, a four-service template four rows within a couple of seconds.
// A run of rows for one template closer together than payerBatchGap is
// therefore one deployer's invoice, and since Railway invoices each customer
// once per billing cycle, invoices in one cycle (payerCycleDays) ≈ paying
// deployers. That is why Payers is always measured over the trailing cycle,
// whatever range the chart shows: a 7-day range only sees the deployers whose
// billing date fell that week, a 90-day range sees each deployer three times.
// Two deployers invoiced in the same billing run would merge into one
// (undercount); a deployer charged more than once a cycle would split
// (overcount). Estimate, not census.
type payoutTemplateTotal struct {
	TemplateID   string `json:"templateId"`
	TemplateName string `json:"templateName"`
	// Count, Cents and Invoices cover the selected range; InvoicesPrevious
	// the range of equal length before it.
	Count            int   `json:"count"`
	Cents            int64 `json:"cents"`
	Invoices         int   `json:"invoices"`
	InvoicesPrevious int   `json:"invoicesPrevious"`
	// Payers is the invoice count over the trailing payerCycleDays,
	// PayersPrevious over the cycle before that, and PayerCents what the
	// trailing cycle's invoices added up to — so PayerCents/Payers is what one
	// paying deployer is worth per cycle.
	Payers         int   `json:"payers"`
	PayersPrevious int   `json:"payersPrevious"`
	PayerCents     int64 `json:"payerCents"`
	// New, Returning and Lapsed count payer chains (see chainPayers) as of
	// now: new = one invoice so far, returning = paid again on cycle, lapsed
	// = a return fell due within the trailing cycle and never came.
	New       int `json:"new"`
	Returning int `json:"returning"`
	Lapsed    int `json:"lapsed"`
	// LifetimeCents is the template's all-time payout from the latest
	// snapshot. It is what lists a template whose earnings all predate
	// tracking, and it keeps the breakdown honest against the "before
	// tracking" line.
	LifetimeCents int64 `json:"lifetimeCents"`
}

// payerChain is one deployer's run of invoices for one template, linked by
// billing rhythm: Railway invoices a customer on a fixed cadence at a fixed
// time of day, so two invoices of the same template exactly one calendar month
// or thirty days apart, within payerCycleTolerance, are the same deployer
// (observed: Jul 25 00:08 → Aug 25 00:07, Aug 2 15:13 → Sep 2 15:14, and a
// 30-day pair 13 minutes off, while unrelated invoices were hours off). A
// missed cycle ends the chain; paying again later starts a new one.
type payerChain struct {
	// Name is a stable pseudonym derived from the template and first invoice
	// (see payerName); Rank orders every chain by TotalCents, 1 = biggest.
	Name         string    `json:"name"`
	Rank         int       `json:"rank"`
	TemplateID   string    `json:"templateId"`
	TemplateName string    `json:"templateName"`
	FirstAt      time.Time `json:"firstAt"`
	LastAt       time.Time `json:"lastAt"`
	NextDueAt    time.Time `json:"nextDueAt"`
	Invoices     int       `json:"invoices"`
	TotalCents   int64     `json:"totalCents"`
	LastCents    int64     `json:"lastCents"`
	// Status is "new" (one invoice, next not yet due), "returning" (paid on
	// cycle at least once, next not yet due) or "lapsed" (a due invoice never
	// came, allowing payerLapseGrace).
	Status string `json:"status"`
}

const (
	payerCycleTolerance = 20 * time.Minute
	payerLapseGrace     = 3 * 24 * time.Hour
)

// invoice is one deployer's batch of service rows for one template.
type invoice struct {
	Start time.Time
	Cents int64
}

// templateLifetime is one template's all-time payout as of the latest
// snapshot, keyed by template id when passed to buildPayoutHistory.
type templateLifetime struct {
	TemplateID  string
	Name        string
	TotalPayout float64
}

// payerCycleDays is Railway's billing cycle: each customer is invoiced once
// per month, so one cycle of invoices counts each paying deployer once.
const payerCycleDays = 30

// payerBatchGap separates one deployer's invoice rows from the next
// invoice. Rows of one invoice land ~1s apart; distinct invoices for the same
// template have been hours apart.
const payerBatchGap = 5 * time.Minute

type payoutHistoryResponse struct {
	Points []payoutPoint `json:"points"`
	Window payoutWindow  `json:"window"`
	Totals payoutTotals  `json:"totals"`
	// Payouts is every row in the selected window, newest first, and TotalRows
	// how many exist in all — so the table can say what lies outside the window.
	Payouts   []Payout `json:"payouts"`
	TotalRows int      `json:"totalRows"`
	// ByTemplate breaks the window's credit payouts down per template, largest
	// earner first.
	ByTemplate []payoutTemplateTotal `json:"byTemplate"`
	// Payers lists every payer chain (see payerChain) in rank order, biggest
	// lifetime total first.
	Payers []payerChain `json:"payers"`
}

// handlePayoutHistory serves the payout dashboard straight from DuckDB.
// Railway is still the source of truth, but its history is a paginated
// connection with no aggregate resolver, so it is mirrored by the collector
// (see syncPayouts) and read locally. ?days=N bounds the chart window.
func handlePayoutHistory(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days := defaultPayoutWindowDays
		if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v >= 1 && v <= maxPayoutWindowDays {
			days = v
		}
		payouts := []Payout{}
		err := db.WithContext(r.Context()).Raw(`
			SELECT id, created_at, amount_cents, status, kind, destination, template_id, template_name
			FROM payouts
			ORDER BY created_at DESC`).Scan(&payouts).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		lifetime := []templateLifetime{}
		err = db.WithContext(r.Context()).Raw(`
			SELECT template_id, name, total_payout
			FROM template_snapshots
			WHERE sampled_at = (SELECT MAX(sampled_at) FROM template_snapshots) AND total_payout > 0`).Scan(&lifetime).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		now := time.Now().UTC()
		today := now.Truncate(24 * time.Hour)
		windowStart := today.AddDate(0, 0, -(days - 1))
		deploys := []deployObservation{}
		err = db.WithContext(r.Context()).Raw(`
			SELECT sampled_at, template_id, total_deployments AS deployments
			FROM template_snapshots
			WHERE total_deployments IS NOT NULL AND sampled_at >= ?
			ORDER BY sampled_at`, windowStart.AddDate(0, 0, -3)).Scan(&deploys).Error
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		hist := buildPayoutHistory(payouts, lifetime, days, now)
		applyWindowDeployments(hist.Points, deploys, windowStart)
		writeJSON(w, http.StatusOK, hist)
	}
}

// buildPayoutHistory turns the stored payouts into the windowed cumulative
// series, the window/previous-window comparison, lifetime totals, the recent
// rows the table shows and the per-template breakdown of the window. lifetime
// (all-time payout per template from the latest snapshot) adds the templates
// whose earnings predate the payouts on file.
func buildPayoutHistory(payouts []Payout, lifetime []templateLifetime, days int, now time.Time) payoutHistoryResponse {
	resp := payoutHistoryResponse{
		Points:     []payoutPoint{},
		Payouts:    []Payout{},
		ByTemplate: []payoutTemplateTotal{},
		Payers:     []payerChain{},
		Window:     payoutWindow{Days: days},
		TotalRows:  len(payouts),
	}

	// The window is the last N whole UTC days including today, so the axis
	// lines up with the daily buckets rather than a ragged clock time.
	today := now.UTC().Truncate(24 * time.Hour)
	windowStart := today.AddDate(0, 0, -(days - 1))
	previousStart := windowStart.AddDate(0, 0, -days)

	// Newest first for the table, which lists the whole window: the range
	// picker scopes the chart, so it scopes the rows too. The SQL already
	// orders this way, but the pure function must not depend on its caller.
	sorted := slices.Clone(payouts)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].CreatedAt.After(sorted[j].CreatedAt) })
	for _, p := range sorted {
		if p.CreatedAt.UTC().Before(windowStart) {
			continue
		}
		p.CreatedAt = p.CreatedAt.UTC()
		resp.Payouts = append(resp.Payouts, p)
	}

	perDayCash := map[string]int64{}
	perDayCredits := map[string]int64{}
	perDayCount := map[string]int{}
	byTemplate := map[string]*payoutTemplateTotal{}
	invoices := map[string][]invoice{} // per template key, newest first; Start = earliest row of the batch
	cycleStart := today.AddDate(0, 0, -(payerCycleDays - 1))
	previousCycleStart := cycleStart.AddDate(0, 0, -payerCycleDays)
	lastCreditAt := map[string]time.Time{} // per template key, for batch detection
	templateKey := func(p Payout) (key, name string) {
		key, name = p.TemplateID, p.TemplateName
		if key == "" {
			return "pending", "pending"
		}
		if name == "" {
			name = key
		}
		return key, name
	}
	// newInvoice reports whether this credit row starts a new batch for its
	// template. Rows arrive newest first, so a gap is measured backwards.
	newInvoice := func(key string, at time.Time) bool {
		last, seen := lastCreditAt[key]
		lastCreditAt[key] = at
		return !seen || last.Sub(at) > payerBatchGap
	}

	for _, p := range sorted {
		at := p.CreatedAt.UTC()
		if isVoidPayout(p.Status) {
			continue
		}
		credits := p.Kind == "credits"

		resp.Totals.Count++
		resp.Totals.LifetimeCents += p.AmountCents
		if credits {
			resp.Totals.CreditsCents += p.AmountCents
		} else {
			resp.Totals.CashCents += p.AmountCents
		}
		if p.Status == "PENDING" {
			resp.Totals.PendingCount++
			resp.Totals.PendingCents += p.AmountCents
		}
		if resp.Totals.LastPayoutAt == nil || at.After(*resp.Totals.LastPayoutAt) {
			resp.Totals.LastPayoutAt = &at
		}
		if resp.Totals.FirstPayoutAt == nil || at.Before(*resp.Totals.FirstPayoutAt) {
			resp.Totals.FirstPayoutAt = &at
		}

		switch {
		case !at.Before(windowStart):
			key := at.Format(dayKeyLayout)
			perDayCount[key]++
			if credits {
				perDayCredits[key] += p.AmountCents
			} else {
				perDayCash[key] += p.AmountCents
			}
			resp.Window.TotalCents += p.AmountCents
			resp.Window.Count++
		case !at.Before(previousStart):
			resp.Window.PreviousCents += p.AmountCents
		}

		if !credits {
			continue
		}
		// Batches are detected over the whole history so an invoice straddling
		// a window edge is still one invoice; the counters then pick windows.
		key, name := templateKey(p)
		if byTemplate[key] == nil {
			byTemplate[key] = &payoutTemplateTotal{TemplateID: key, TemplateName: name}
		}
		t := byTemplate[key]
		isNew := newInvoice(key, at)
		if isNew {
			invoices[key] = append(invoices[key], invoice{Start: at, Cents: p.AmountCents})
		} else {
			last := &invoices[key][len(invoices[key])-1]
			last.Start, last.Cents = at, last.Cents+p.AmountCents
		}
		switch {
		case !at.Before(windowStart):
			t.Count++
			t.Cents += p.AmountCents
			if isNew {
				t.Invoices++
			}
		case !at.Before(previousStart):
			if isNew {
				t.InvoicesPrevious++
			}
		}
		switch {
		case !at.Before(cycleStart):
			t.PayerCents += p.AmountCents
			if isNew {
				t.Payers++
			}
		case !at.Before(previousCycleStart):
			if isNew {
				t.PayersPrevious++
			}
		}
	}

	if resp.Window.PreviousCents > 0 {
		pct := float64(resp.Window.TotalCents-resp.Window.PreviousCents) / float64(resp.Window.PreviousCents) * 100
		resp.Window.ChangePct = &pct
	}
	for key, t := range byTemplate {
		chains := chainPayers(key, t.TemplateName, invoices[key], now)
		for _, c := range chains {
			switch c.Status {
			case "new":
				t.New++
			case "returning":
				t.Returning++
			case "lapsed":
				if !c.NextDueAt.Before(cycleStart) {
					t.Lapsed++
				}
			}
		}
		resp.Payers = append(resp.Payers, chains...)
	}
	sort.Slice(resp.Payers, func(i, j int) bool {
		a, b := resp.Payers[i], resp.Payers[j]
		if a.TotalCents != b.TotalCents {
			return a.TotalCents > b.TotalCents
		}
		return a.FirstAt.Before(b.FirstAt)
	})
	for i := range resp.Payers {
		resp.Payers[i].Rank = i + 1
	}
	for _, l := range lifetime {
		if byTemplate[l.TemplateID] == nil {
			byTemplate[l.TemplateID] = &payoutTemplateTotal{TemplateID: l.TemplateID, TemplateName: l.Name}
		}
		byTemplate[l.TemplateID].LifetimeCents = int64(math.Round(l.TotalPayout * 100))
	}
	for _, t := range byTemplate {
		if t.Count > 0 || t.InvoicesPrevious > 0 || t.Payers > 0 || t.PayersPrevious > 0 || t.LifetimeCents > 0 {
			resp.ByTemplate = append(resp.ByTemplate, *t)
		}
	}
	sort.Slice(resp.ByTemplate, func(i, j int) bool {
		a, b := resp.ByTemplate[i], resp.ByTemplate[j]
		if a.Cents != b.Cents {
			return a.Cents > b.Cents
		}
		if a.LifetimeCents != b.LifetimeCents {
			return a.LifetimeCents > b.LifetimeCents
		}
		return a.TemplateName < b.TemplateName
	})

	// Walk every day in the window, including the empty ones, accumulating as
	// we go: a cumulative line must not jump over a payout-free stretch.
	var cash, credits int64
	var count int
	for d := windowStart; !d.After(today); d = d.AddDate(0, 0, 1) {
		key := d.Format(dayKeyLayout)
		cash += perDayCash[key]
		credits += perDayCredits[key]
		count += perDayCount[key]
		resp.Points = append(resp.Points, payoutPoint{
			Date: key, CashCents: cash, CreditsCents: credits, Count: count,
		})
	}
	return resp
}

// deployObservation is one template's totalDeployments at a collector sample.
// The withdrawals chart overlays the window's net-new deploys — the same
// reading the weekly mail calls NetNewProjects — so cash out and usage share
// an axis of time without pretending they share a unit.
type deployObservation struct {
	SampledAt   time.Time
	TemplateID  string
	Deployments int64
}

// applyWindowDeployments writes cumulative net-new template deployments onto
// each chart point. Per template, the last reading at or before the window
// start is the baseline (first in-window reading if none). Each day holds
// that template's peak gain so a revised or dropped count cannot pull the
// overlay down — same plateau shape as the payout line.
func applyWindowDeployments(points []payoutPoint, observations []deployObservation, windowStart time.Time) {
	if len(points) == 0 || len(observations) == 0 {
		return
	}
	obs := slices.Clone(observations)
	sort.SliceStable(obs, func(i, j int) bool {
		if obs[i].SampledAt.Equal(obs[j].SampledAt) {
			return obs[i].TemplateID < obs[j].TemplateID
		}
		return obs[i].SampledAt.Before(obs[j].SampledAt)
	})

	baseline := map[string]int64{}
	haveBaseline := map[string]bool{}
	peak := map[string]int64{}
	for _, o := range obs {
		if !o.SampledAt.After(windowStart) {
			baseline[o.TemplateID] = o.Deployments
			haveBaseline[o.TemplateID] = true
		}
	}

	oi := 0
	for i := range points {
		day, err := time.Parse(dayKeyLayout, points[i].Date)
		if err != nil {
			continue
		}
		dayEnd := day.AddDate(0, 0, 1)
		for oi < len(obs) && obs[oi].SampledAt.Before(dayEnd) {
			o := obs[oi]
			if !haveBaseline[o.TemplateID] {
				baseline[o.TemplateID] = o.Deployments
				haveBaseline[o.TemplateID] = true
			}
			if delta := o.Deployments - baseline[o.TemplateID]; delta > peak[o.TemplateID] {
				peak[o.TemplateID] = delta
			}
			oi++
		}
		var added int64
		for _, d := range peak {
			added += d
		}
		points[i].Deployments = added
	}
}

// onCycle reports whether `next` falls one billing cycle after `prev`: exactly
// one calendar month or exactly thirty days later, within payerCycleTolerance.
func onCycle(prev, next time.Time) bool {
	for _, due := range []time.Time{prev.AddDate(0, 1, 0), prev.Add(payerCycleDays * 24 * time.Hour)} {
		if d := next.Sub(due); d > -payerCycleTolerance && d < payerCycleTolerance {
			return true
		}
	}
	return false
}

// chainPayers links a template's invoices into payer chains (see payerChain)
// and grades each chain as of now. invoices may be in any order.
func chainPayers(templateID, name string, invs []invoice, now time.Time) []payerChain {
	sorted := append([]invoice(nil), invs...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start.Before(sorted[j].Start) })
	chains := []*payerChain{}
	for _, inv := range sorted {
		var best *payerChain
		for _, c := range chains {
			if onCycle(c.LastAt, inv.Start) && (best == nil || c.LastAt.After(best.LastAt)) {
				best = c
			}
		}
		if best == nil {
			chains = append(chains, &payerChain{TemplateID: templateID, TemplateName: name, FirstAt: inv.Start, LastAt: inv.Start, Invoices: 1, TotalCents: inv.Cents, LastCents: inv.Cents})
			continue
		}
		best.LastAt, best.Invoices, best.TotalCents, best.LastCents = inv.Start, best.Invoices+1, best.TotalCents+inv.Cents, inv.Cents
	}
	out := make([]payerChain, 0, len(chains))
	for _, c := range chains {
		c.Name = payerName(templateID, c.FirstAt)
		c.NextDueAt = c.LastAt.AddDate(0, 1, 0)
		switch {
		case now.After(c.NextDueAt.Add(payerLapseGrace)):
			c.Status = "lapsed"
		case c.Invoices > 1:
			c.Status = "returning"
		default:
			c.Status = "new"
		}
		out = append(out, *c)
	}
	return out
}

// payoutRowID is the primary key a Railway record is stored under. Cash
// withdrawals have their own id; credit payouts expose none, so they get a
// deterministic key from the only fields they do carry — re-syncing the same
// credit then updates its row instead of inserting a duplicate.
func payoutRowID(rec payoutRecord) string {
	if rec.ID != "" {
		return rec.ID
	}
	return fmt.Sprintf("credit:%s:%d", rec.CreatedAt.UTC().Format(time.RFC3339Nano), rec.Amount)
}

// payoutFromRecord maps a Railway history entry onto the stored row.
func payoutFromRecord(rec payoutRecord, syncedAt time.Time) Payout {
	credits := rec.Typename == railwayCreditWithdrawalTypename
	// Credit payouts carry no status field; they are settled the moment they
	// exist, so normalize them onto the cash vocabulary.
	status := rec.Status
	if status == "" {
		status = "COMPLETED"
	}
	kind := "cash"
	if credits {
		kind = "credits"
	}
	return Payout{
		ID:          payoutRowID(rec),
		CreatedAt:   rec.CreatedAt.UTC(),
		AmountCents: rec.Amount,
		Status:      status,
		Kind:        kind,
		Destination: payoutDestination(rec, credits),
		AccountID:   rec.Account.ID,
		SyncedAt:    syncedAt,
	}
}

// payoutDestination labels where a payout landed: the last four of the bank
// account or card behind the Stripe Connect destination, falling back to the
// platform name when Railway exposes neither.
func payoutDestination(rec payoutRecord, credits bool) string {
	if credits {
		return "Railway credits"
	}
	switch {
	case rec.Account.StripeConnect.BankLast4 != "":
		return "Bank ••" + rec.Account.StripeConnect.BankLast4
	case rec.Account.StripeConnect.CardLast4 != "":
		return "Card ••" + rec.Account.StripeConnect.CardLast4
	case rec.Account.Platform != "":
		// STRIPE_CONNECT reads as "Stripe connect" — sentence case, like the
		// rest of the UI.
		label := strings.ToLower(strings.ReplaceAll(rec.Account.Platform, "_", " "))
		return strings.ToUpper(label[:1]) + label[1:]
	}
	return "Unknown account"
}

// diffPayouts splits freshly fetched rows into the ones missing locally and
// the ones whose mutable fields moved (a PENDING withdrawal settling, mainly).
// Rows that are byte-identical are left alone so a sync of unchanged history
// writes nothing.
func diffPayouts(fetched []Payout, existing map[string]Payout) (inserts, updates []Payout) {
	for _, p := range fetched {
		prev, ok := existing[p.ID]
		if !ok {
			inserts = append(inserts, p)
			continue
		}
		if prev.Status != p.Status || prev.AmountCents != p.AmountCents || prev.Destination != p.Destination {
			updates = append(updates, p)
		}
	}
	return inserts, updates
}

// syncPayouts mirrors Railway's payout history into DuckDB. It is an upsert
// rather than a replace: a truncated page walk must never delete history it
// simply did not read this time.
func syncPayouts(ctx context.Context, db *gorm.DB) (inserted, updated int, err error) {
	token, customerID, err := workspaceCustomer(ctx, db)
	if err != nil {
		return 0, 0, err
	}
	records, truncated, err := getPayoutHistory(ctx, token, customerID)
	if err != nil {
		return 0, 0, err
	}
	if truncated {
		log.Printf("payout sync: history longer than the page walk, oldest payouts not read")
	}

	syncedAt := time.Now().UTC()
	fetched := make([]Payout, 0, len(records))
	for _, rec := range records {
		fetched = append(fetched, payoutFromRecord(rec, syncedAt))
	}

	stored := []Payout{}
	if err := db.WithContext(ctx).Raw(
		`SELECT id, created_at, amount_cents, status, kind, destination FROM payouts`).
		Scan(&stored).Error; err != nil {
		return 0, 0, err
	}
	existing := make(map[string]Payout, len(stored))
	for _, p := range stored {
		existing[p.ID] = p
	}

	inserts, updates := diffPayouts(fetched, existing)
	if len(inserts) > 0 {
		if err := gorm.G[Payout](db).CreateInBatches(ctx, &inserts, 100); err != nil {
			return 0, 0, err
		}
	}
	for _, p := range updates {
		if _, err := gorm.G[Payout](db).Where("id = ?", p.ID).Updates(ctx, Payout{
			Status: p.Status, AmountCents: p.AmountCents, Destination: p.Destination, SyncedAt: syncedAt,
		}); err != nil {
			return len(inserts), 0, err
		}
	}
	return len(inserts), len(updates), nil
}
