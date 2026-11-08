package main

import (
	"testing"
	"time"
)

func TestBuildReferrals(t *testing.T) {
	at := func(h int) time.Time { return time.Date(2026, 11, 8, h, 0, 0, 0, time.UTC) }
	snaps := []EarningSnapshot{
		{SampledAt: at(1), ReferralLifetimeCents: 165, Referral30dCents: 165, ReferralsCredited: 1, ReferralsPending: 19, ReferralCode: "abc"},
		{SampledAt: at(2), ReferralLifetimeCents: 165, Referral30dCents: 165, ReferralsCredited: -1, ReferralsPending: -1},
		{SampledAt: at(3), ReferralLifetimeCents: 665, Referral30dCents: 665, ReferralsCredited: -1, ReferralsPending: -1},
		{SampledAt: at(4), ReferralLifetimeCents: 600, Referral30dCents: 600, ReferralsCredited: -1, ReferralsPending: -1},
		{SampledAt: at(5), ReferralLifetimeCents: 700, Referral30dCents: 700, ReferralsCredited: 2, ReferralsPending: 18, ReferralCode: "abc"},
	}
	r := buildReferrals(snaps)
	if r.LifetimeCents != 700 || r.Last30Cents != 700 || r.BeforeTrackingCents != 165 {
		t.Fatalf("totals = %d/%d/%d", r.LifetimeCents, r.Last30Cents, r.BeforeTrackingCents)
	}
	if r.Credited == nil || *r.Credited != 2 || *r.Pending != 18 || r.Code != "abc" {
		t.Fatalf("counts = %v/%v %q", r.Credited, r.Pending, r.Code)
	}
	// Rises only, newest first; the fall at 4:00 is no row.
	if len(r.Credits) != 2 || r.Credits[0].Cents != 100 || !r.Credits[0].At.Equal(at(5)) || r.Credits[1].Cents != 500 {
		t.Fatalf("credits = %+v", r.Credits)
	}

	// A latest snapshot without counts falls back to the last that had them.
	r = buildReferrals(snaps[:3])
	if r.Credited == nil || *r.Credited != 1 {
		t.Fatalf("fallback credited = %v", r.Credited)
	}
	if empty := buildReferrals(nil); empty.SampledAt != nil || empty.Credits == nil {
		t.Fatalf("empty = %+v", empty)
	}
}
