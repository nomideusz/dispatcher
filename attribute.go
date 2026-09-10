package main

import (
	"context"
	"log"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
)

// Railway's ledger says how much each kickback payout was worth but not which
// template earned it; templateMetrics says how much each template has earned
// in total but keeps no history. Between two snapshots the two must agree: the
// credit payouts that arrived sum, per template, to that template's earnings
// delta. So each new payout is matched to a template by finding the partition
// of the window's payouts whose per-template sums equal those deltas.
//
// Windows are one snapshot apart (hourly), so they almost always hold a single
// billing batch from one or two templates and the partition is unique. When
// several templates move in the same window and more than one partition fits,
// the per-template sums are still exact; only which row carries which label
// may be swapped between those templates.

// unattributedTemplateID marks a payout the matcher gave up on, so it stops
// holding the window open for everything after it.
const unattributedTemplateID = "unknown"

// attributionGiveUpAfter bounds how long an unmatched payout may block the
// window before it is marked unattributed. Earnings and ledger normally agree
// within one snapshot; days of disagreement mean Railway's figures moved in a
// way snapshots cannot explain (a refund, a manual adjustment).
const attributionGiveUpAfter = 48 * time.Hour

// maxPartitionSteps caps the search so a pathological window can never stall
// the collector. Real windows resolve in a few dozen steps.
const maxPartitionSteps = 2_000_000

type pendingPayout struct {
	ID          string
	CreatedAt   time.Time
	AmountCents int64
}

type templateDelta struct {
	TemplateID string
	Name       string
	Cents      int64
}

// runAttribution is the cron entrypoint: attribute and just log.
func runAttribution(db *gorm.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	n, err := attributePayouts(ctx, db)
	if err != nil {
		log.Printf("payout attribution: %v", err)
		return
	}
	if n > 0 {
		log.Printf("payout attribution: %d payouts matched to templates", n)
	}
}

// attributePayouts assigns a template to every credit payout it can prove and
// returns how many it assigned. Payouts it cannot prove yet stay pending and
// are retried after the next snapshot; the baseline stays anchored to the
// oldest pending payout, so a window only grows until it resolves.
func attributePayouts(ctx context.Context, db *gorm.DB) (int, error) {
	first, err := scanTime(ctx, db, `SELECT MIN(sampled_at) FROM template_snapshots WHERE total_earnings IS NOT NULL`)
	if err != nil || first == nil {
		return 0, err
	}
	pending := []pendingPayout{}
	if err := db.WithContext(ctx).Raw(`
		SELECT id, created_at, amount_cents FROM payouts
		WHERE kind = 'credits' AND COALESCE(template_id, '') = '' AND created_at >= ?
		ORDER BY created_at, id`, *first).Scan(&pending).Error; err != nil || len(pending) == 0 {
		return 0, err
	}
	baseAt, err := scanTime(ctx, db, `SELECT MAX(sampled_at) FROM template_snapshots WHERE sampled_at <= ?`, pending[0].CreatedAt)
	if err != nil || baseAt == nil {
		return 0, err
	}
	latestAt, err := scanTime(ctx, db, `SELECT MAX(sampled_at) FROM template_snapshots`)
	if err != nil || latestAt == nil || !latestAt.After(*baseAt) {
		return 0, err
	}
	base, _, err := earningsAt(ctx, db, *baseAt)
	if err != nil {
		return 0, err
	}
	current, names, err := earningsAt(ctx, db, *latestAt)
	if err != nil {
		return 0, err
	}
	var deltas []templateDelta
	var deltaSum, payoutSum int64
	for id, earned := range current {
		if cents := int64(math.Round((earned - base[id]) * 100)); cents > 0 {
			deltas = append(deltas, templateDelta{TemplateID: id, Name: names[id], Cents: cents})
			deltaSum += cents
		}
	}
	for _, p := range pending {
		payoutSum += p.AmountCents
	}
	assignment := map[string]string(nil)
	if deltaSum == payoutSum {
		assignment = partitionPayouts(pending, deltas)
	}
	if assignment == nil {
		if time.Since(pending[0].CreatedAt) > attributionGiveUpAfter {
			// ponytail: drop only the oldest blocker; the rest get a fresh, tighter window next run
			err := db.WithContext(ctx).Exec(`UPDATE payouts SET template_id = ? WHERE id = ?`, unattributedTemplateID, pending[0].ID).Error
			return 0, err
		}
		return 0, nil
	}
	byTemplate := map[string][]string{}
	for payoutID, templateID := range assignment {
		byTemplate[templateID] = append(byTemplate[templateID], payoutID)
	}
	for templateID, ids := range byTemplate {
		if err := db.WithContext(ctx).Exec(`UPDATE payouts SET template_id = ?, template_name = ? WHERE id IN ?`,
			templateID, names[templateID], ids).Error; err != nil {
			return 0, err
		}
	}
	return len(assignment), nil
}

// earningsAt returns total_earnings (dollars) and name per template for the
// snapshot taken at exactly `at`. Every template in one collection shares the
// same sampled_at, so this reads one whole snapshot.
func earningsAt(ctx context.Context, db *gorm.DB, at time.Time) (map[string]float64, map[string]string, error) {
	rows := []struct {
		TemplateID    string
		Name          string
		TotalEarnings *float64
	}{}
	err := db.WithContext(ctx).Raw(`SELECT template_id, name, total_earnings FROM template_snapshots WHERE sampled_at = ?`, at).Scan(&rows).Error
	earnings, names := map[string]float64{}, map[string]string{}
	for _, r := range rows {
		if r.TotalEarnings != nil {
			earnings[r.TemplateID] = *r.TotalEarnings
			names[r.TemplateID] = r.Name
		}
	}
	return earnings, names, err
}

// partitionPayouts finds an assignment payout id → template id such that each
// template's payouts sum exactly to its delta, or nil if none exists.
// Depth-first, largest payout first, largest delta first; deterministic.
func partitionPayouts(payouts []pendingPayout, deltas []templateDelta) map[string]string {
	ps := append([]pendingPayout(nil), payouts...)
	sort.Slice(ps, func(i, j int) bool {
		if ps[i].AmountCents != ps[j].AmountCents {
			return ps[i].AmountCents > ps[j].AmountCents
		}
		return ps[i].ID < ps[j].ID
	})
	ds := append([]templateDelta(nil), deltas...)
	sort.Slice(ds, func(i, j int) bool {
		if ds[i].Cents != ds[j].Cents {
			return ds[i].Cents > ds[j].Cents
		}
		return ds[i].TemplateID < ds[j].TemplateID
	})
	remaining := make([]int64, len(ds))
	for i, d := range ds {
		remaining[i] = d.Cents
	}
	out := map[string]string{}
	steps := 0
	var walk func(i int) bool
	walk = func(i int) bool {
		steps++
		if steps > maxPartitionSteps {
			return false
		}
		if i == len(ps) {
			for _, r := range remaining {
				if r != 0 {
					return false
				}
			}
			return true
		}
		for j := range ds {
			if remaining[j] < ps[i].AmountCents {
				continue
			}
			remaining[j] -= ps[i].AmountCents
			out[ps[i].ID] = ds[j].TemplateID
			if walk(i + 1) {
				return true
			}
			remaining[j] += ps[i].AmountCents
			delete(out, ps[i].ID)
		}
		return false
	}
	if !walk(0) {
		return nil
	}
	return out
}
