package main

import (
	"testing"
	"time"
)

// cashRecord builds a Withdrawal-arm Railway record with a bank destination.
func cashRecord(at time.Time, cents int64, status, bankLast4 string) payoutRecord {
	rec := payoutRecord{Typename: "Withdrawal", ID: "w-" + at.Format(time.RFC3339), Amount: cents, Status: status, CreatedAt: at}
	rec.Account.ID = "acct-1"
	rec.Account.Platform = "STRIPE_CONNECT"
	rec.Account.StripeConnect.BankLast4 = bankLast4
	return rec
}

// creditRecord builds a CreditWithdrawalInfo-arm record, which Railway returns
// with only an amount and a date.
func creditRecord(at time.Time, cents int64) payoutRecord {
	return payoutRecord{Typename: railwayCreditWithdrawalTypename, Amount: cents, CreatedAt: at}
}

func cashPayout(at time.Time, cents int64, status string) Payout {
	return Payout{ID: "w-" + at.Format(time.RFC3339Nano), CreatedAt: at, AmountCents: cents, Status: status, Kind: "cash", Destination: "Bank ••8149"}
}

func TestBuildPayoutHistoryAccumulatesAcrossTheWindow(t *testing.T) {
	now := time.Date(2026, 8, 30, 15, 0, 0, 0, time.UTC)
	day := func(d int) time.Time { return time.Date(2026, 8, d, 9, 0, 0, 0, time.UTC) }

	// A 7-day window covers Aug 24..30. Aug 20 falls in the previous window,
	// and Aug 25-27 are payout-free so the line must hold its level there.
	got := buildPayoutHistory([]Payout{
		cashPayout(day(20), 40000, "COMPLETED"), // previous window
		cashPayout(day(24), 10000, "COMPLETED"),
		cashPayout(day(28), 15000, "COMPLETED"),
		cashPayout(day(30), 12000, "PENDING"),
	}, nil, 7, now)

	if len(got.Points) != 7 {
		t.Fatalf("points = %d, want 7", len(got.Points))
	}
	if first := got.Points[0]; first.Date != "2026-08-24" || first.CashCents != 10000 || first.Count != 1 {
		t.Errorf("points[0] = %+v, want Aug 24 / 10000 / 1", first)
	}
	// The three quiet days hold the running total rather than dropping to zero.
	for i, date := range []string{"2026-08-25", "2026-08-26", "2026-08-27"} {
		p := got.Points[i+1]
		if p.Date != date || p.CashCents != 10000 || p.Count != 1 {
			t.Errorf("points[%d] = %+v, want %s holding 10000 / 1", i+1, p, date)
		}
	}
	if last := got.Points[6]; last.Date != "2026-08-30" || last.CashCents != 37000 || last.Count != 3 {
		t.Errorf("points[last] = %+v, want Aug 30 / 37000 / 3", last)
	}

	want := payoutWindow{Days: 7, TotalCents: 37000, PreviousCents: 40000, Count: 3}
	gotWindow := got.Window
	if gotWindow.ChangePct == nil {
		t.Fatalf("window.ChangePct = nil, want a comparison against the previous 7d")
	}
	if pct := *gotWindow.ChangePct; pct > -7.4 || pct < -7.6 {
		t.Errorf("window.ChangePct = %v, want ≈-7.5%%", pct)
	}
	gotWindow.ChangePct = nil
	if gotWindow != want {
		t.Errorf("window = %+v, want %+v", gotWindow, want)
	}

	// Lifetime spans everything, including the payout outside the window.
	if got.Totals.LifetimeCents != 77000 || got.Totals.Count != 4 {
		t.Errorf("totals = %+v, want lifetime 77000 across 4 payouts", got.Totals)
	}
	if got.Totals.PendingCents != 12000 || got.Totals.PendingCount != 1 {
		t.Errorf("pending = %d/%d, want 12000/1", got.Totals.PendingCents, got.Totals.PendingCount)
	}
}

func TestBuildPayoutHistoryExcludesVoidPayoutsButStillListsThem(t *testing.T) {
	now := time.Date(2026, 8, 30, 15, 0, 0, 0, time.UTC)
	at := time.Date(2026, 8, 29, 9, 0, 0, 0, time.UTC)

	got := buildPayoutHistory([]Payout{
		cashPayout(at, 99900, "FAILED"),
		cashPayout(at.Add(-time.Hour), 10000, "COMPLETED"),
	}, nil, 7, now)

	// The failed request explains a gap, so it stays in the table...
	if len(got.Payouts) != 2 {
		t.Fatalf("payouts = %d, want both rows listed", len(got.Payouts))
	}
	if got.Payouts[0].Status != "FAILED" {
		t.Errorf("payouts[0].Status = %q, want the newest (failed) row first", got.Payouts[0].Status)
	}
	// ...but no money moved, so it counts nowhere.
	if got.Window.TotalCents != 10000 || got.Totals.LifetimeCents != 10000 || got.Window.Count != 1 {
		t.Errorf("window %+v / totals %+v, want only the completed 10000 counted", got.Window, got.Totals)
	}
}

func TestBuildPayoutHistoryBreaksTheWindowDownByTemplate(t *testing.T) {
	now := time.Date(2026, 8, 30, 15, 0, 0, 0, time.UTC)
	creditAt := func(at time.Time, cents int64, status, templateID, name string) Payout {
		return Payout{ID: "c-" + at.Format(time.RFC3339Nano), CreatedAt: at, AmountCents: cents, Status: status, Kind: "credits", Destination: "Railway credits", TemplateID: templateID, TemplateName: name}
	}
	credit := func(hoursAgo int, cents int64, status, templateID, name string) Payout {
		return creditAt(now.Add(-time.Duration(hoursAgo)*time.Hour), cents, status, templateID, name)
	}
	invoice := now.Add(-time.Hour) // one Twenty deployer: four service rows a second apart
	payouts := []Payout{
		creditAt(invoice, 125, "COMPLETED", "twenty", "Twenty CRM"),
		creditAt(invoice.Add(time.Second), 13, "COMPLETED", "twenty", "Twenty CRM"),
		creditAt(invoice.Add(2*time.Second), 118, "COMPLETED", "twenty", "Twenty CRM"),
		creditAt(invoice.Add(3*time.Second), 5, "COMPLETED", "twenty", "Twenty CRM"),
		credit(24*10, 84, "COMPLETED", "twenty", "Twenty CRM"), // another Twenty deployer, ten days earlier
		credit(3, 204, "COMPLETED", "owncast", "Owncast"),
		credit(4, 5, "COMPLETED", "", ""),
		credit(5, 3, "COMPLETED", unattributedTemplateID, ""),
		credit(6, 50, "FAILED", "owncast", "Owncast"),           // void: not counted anywhere
		credit(24*40, 999, "COMPLETED", "twenty", "Twenty CRM"), // previous cycle: a payer then, not now
		credit(24*41, 7, "COMPLETED", "dify", "Dify"),           // previous cycle only
		credit(24*80, 7, "COMPLETED", "old", "Old"),             // beyond every window: not listed
		cashPayout(now.Add(-7*time.Hour), 10000, "COMPLETED"),   // cash: never attributed
	}

	// Lifetime totals from the latest snapshot: twenty's covers more than the
	// payouts on file; azuracast earned everything before tracking began.
	lifetime := []templateLifetime{
		{TemplateID: "twenty", Name: "Twenty CRM", TotalPayout: 52.39},
		{TemplateID: "azuracast", Name: "AzuraCast", TotalPayout: 9.86},
	}
	got := buildPayoutHistory(payouts, lifetime, 30, now)
	want := []payoutTemplateTotal{
		// twenty's 40-days-ago and 10-days-ago invoices are exactly 30 days apart: one returning payer; the fresh one is new.
		{TemplateID: "twenty", TemplateName: "Twenty CRM", Count: 5, Cents: 345, Invoices: 2, InvoicesPrevious: 1, Payers: 2, PayersPrevious: 1, PayerCents: 345, New: 1, Returning: 1, LifetimeCents: 5239},
		{TemplateID: "owncast", TemplateName: "Owncast", Count: 1, Cents: 204, Invoices: 1, Payers: 1, PayerCents: 204, New: 1},
		{TemplateID: "pending", TemplateName: "pending", Count: 1, Cents: 5, Invoices: 1, Payers: 1, PayerCents: 5, New: 1},
		{TemplateID: unattributedTemplateID, TemplateName: unattributedTemplateID, Count: 1, Cents: 3, Invoices: 1, Payers: 1, PayerCents: 3, New: 1},
		{TemplateID: "azuracast", TemplateName: "AzuraCast", LifetimeCents: 986},
		// dify's only invoice fell due 10 days ago and nothing came: lapsed this cycle.
		{TemplateID: "dify", TemplateName: "Dify", InvoicesPrevious: 1, PayersPrevious: 1, Lapsed: 1},
	}
	if len(got.ByTemplate) != len(want) {
		t.Fatalf("byTemplate = %+v, want %+v", got.ByTemplate, want)
	}
	for i := range want {
		if got.ByTemplate[i] != want[i] {
			t.Errorf("byTemplate[%d] = %+v, want %+v", i, got.ByTemplate[i], want[i])
		}
	}

	// A 7-day range only sees this week's invoices, but payers still cover
	// the trailing billing cycle — a short range must not read as churn.
	week := buildPayoutHistory(payouts, lifetime, 7, now)
	var twenty payoutTemplateTotal
	for _, row := range week.ByTemplate {
		if row.TemplateID == "twenty" {
			twenty = row
		}
	}
	if twenty.Invoices != 1 || twenty.InvoicesPrevious != 1 || twenty.Payers != 2 || twenty.PayersPrevious != 1 || twenty.PayerCents != 345 {
		t.Errorf("7-day twenty = %+v, want 1 invoice this week, 1 the week before, 2 payers over the cycle", twenty)
	}
}

func TestBuildPayoutHistoryListsTheWholeWindow(t *testing.T) {
	now := time.Date(2026, 8, 30, 15, 0, 0, 0, time.UTC)
	payouts := []Payout{}
	for i := range 20 {
		payouts = append(payouts, cashPayout(now.Add(-time.Duration(i)*time.Hour), 10000, "COMPLETED"))
	}
	// Outside the 30-day window: counted in the lifetime figures, not listed.
	payouts = append(payouts, cashPayout(now.AddDate(0, 0, -40), 10000, "COMPLETED"))

	got := buildPayoutHistory(payouts, nil, 30, now)

	if len(got.Payouts) != 20 {
		t.Errorf("payouts = %d, want every row inside the window", len(got.Payouts))
	}
	if got.TotalRows != 21 {
		t.Errorf("totalRows = %d, want 21 so the table can say what lies outside the window", got.TotalRows)
	}
	if got.Totals.Count != 21 || got.Window.Count != 20 {
		t.Errorf("counts = %d/%d, want 21 lifetime and 20 in the window", got.Totals.Count, got.Window.Count)
	}
}

func TestPayoutFromRecordNormalizesCreditsAndDestinations(t *testing.T) {
	at := time.Date(2026, 8, 2, 9, 0, 0, 0, time.UTC)
	syncedAt := time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC)

	// Credits arrive with no id and no status: they need a deterministic key
	// so a re-sync updates rather than duplicates, and settle on creation.
	credit := payoutFromRecord(creditRecord(at, 2500), syncedAt)
	if credit.Kind != "credits" || credit.Status != "COMPLETED" || credit.Destination != "Railway credits" {
		t.Errorf("credit = %+v, want kind=credits status=COMPLETED destination=Railway credits", credit)
	}
	if again := payoutFromRecord(creditRecord(at, 2500), syncedAt.Add(time.Hour)); again.ID != credit.ID {
		t.Errorf("credit id = %q then %q, want a stable synthetic key", credit.ID, again.ID)
	}
	if other := payoutFromRecord(creditRecord(at, 9900), syncedAt); other.ID == credit.ID {
		t.Errorf("two different credits share id %q", other.ID)
	}

	card := cashRecord(at, 10000, "COMPLETED", "")
	card.Account.StripeConnect.CardLast4 = "4242"
	bare := cashRecord(at, 10000, "COMPLETED", "")
	bare.Account.StripeConnect.CardLast4 = ""

	for _, tc := range []struct {
		name string
		rec  payoutRecord
		want string
	}{
		{"bank", cashRecord(at, 10000, "COMPLETED", "8149"), "Bank ••8149"},
		{"card", card, "Card ••4242"},
		{"platform only", bare, "Stripe connect"},
	} {
		if got := payoutDestination(tc.rec, false); got != tc.want {
			t.Errorf("%s destination = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDiffPayoutsOnlyWritesWhatChanged(t *testing.T) {
	at := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)
	settled := cashPayout(at, 10000, "COMPLETED")
	pending := cashPayout(at.Add(time.Hour), 15000, "PENDING")
	fresh := cashPayout(at.Add(2*time.Hour), 12000, "COMPLETED")

	// The pending row has since settled; the completed one is untouched.
	nowSettled := pending
	nowSettled.Status = "COMPLETED"

	inserts, updates := diffPayouts(
		[]Payout{settled, nowSettled, fresh},
		map[string]Payout{settled.ID: settled, pending.ID: pending},
	)

	if len(inserts) != 1 || inserts[0].ID != fresh.ID {
		t.Errorf("inserts = %+v, want only the unseen payout", inserts)
	}
	if len(updates) != 1 || updates[0].ID != pending.ID || updates[0].Status != "COMPLETED" {
		t.Errorf("updates = %+v, want only the pending row settling", updates)
	}
}

func TestChainPayersLinksInvoicesOnBillingCycle(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse("2006-01-02 15:04", s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	invs := []invoice{
		{Start: at("2026-07-25 00:08"), Cents: 197}, {Start: at("2026-08-25 00:07"), Cents: 417}, // calendar month, -1 min
		{Start: at("2026-08-11 15:11"), Cents: 371}, {Start: at("2026-09-10 14:58"), Cents: 261}, // 30 days, -13 min
		{Start: at("2026-08-03 14:46"), Cents: 210}, {Start: at("2026-09-02 12:58"), Cents: 836}, // 1h48m off: different deployers
	}
	now := at("2026-09-11 12:00")
	chains := chainPayers("twenty", "Twenty", invs, now)
	byFirst := map[string]payerChain{}
	for _, c := range chains {
		byFirst[c.FirstAt.Format("01-02 15:04")] = c
	}
	if len(chains) != 4 {
		t.Fatalf("want 4 chains (2 returning, 2 singles), got %d: %+v", len(chains), chains)
	}
	if c := byFirst["07-25 00:08"]; c.Invoices != 2 || c.Status != "returning" || c.TotalCents != 614 || c.LastCents != 417 {
		t.Errorf("calendar-month pair not chained: %+v", c)
	}
	if c := byFirst["08-11 15:11"]; c.Invoices != 2 || c.Status != "returning" {
		t.Errorf("30-day pair not chained: %+v", c)
	}
	// Aug 3 was due Sep 3 and nothing came within grace by Sep 11: lapsed. Sep 2 is a new payer.
	if c := byFirst["08-03 14:46"]; c.Invoices != 1 || c.Status != "lapsed" || !c.NextDueAt.Equal(at("2026-09-03 14:46")) {
		t.Errorf("unmatched old invoice should be lapsed: %+v", c)
	}
	if c := byFirst["09-02 12:58"]; c.Invoices != 1 || c.Status != "new" {
		t.Errorf("unmatched recent invoice should be new: %+v", c)
	}
	// Within grace the same chain is still "new", not lapsed.
	if c := chainPayers("t", "T", invs[4:5], at("2026-09-05 12:00"))[0]; c.Status != "new" {
		t.Errorf("want new within grace, got %s", c.Status)
	}
}

func TestPayerNameIsStableAndDistinct(t *testing.T) {
	at := time.Date(2026, 7, 25, 0, 8, 0, 0, time.UTC)
	a, b := payerName("chatwoot", at), payerName("chatwoot", at.In(time.FixedZone("x", 3600)))
	if a != b {
		t.Errorf("name must not depend on zone: %q vs %q", a, b)
	}
	if payerName("chatwoot", at) == payerName("twenty", at) || payerName("chatwoot", at) == payerName("chatwoot", at.Add(time.Minute)) {
		t.Error("different template or first invoice should (almost always) name differently")
	}
	if a == "" || len(a) < 5 {
		t.Errorf("odd name %q", a)
	}
}
