package main

import (
	"context"
	"log"
	"math"
	"net/http"
	"time"

	"gorm.io/gorm"
)

// EarningSnapshot is one reading of Railway's earnings breakdown: what the
// account earned from referrals, templates, bounties and threads, lifetime
// and over Railway's trailing 30 days, plus how many referred users have been
// credited or are still pending. Template kickbacks are tracked per template
// in template_snapshots; this table is the only record of the rest, since
// Railway writes no ledger row for a referral reward. Amounts are cents.
type EarningSnapshot struct {
	SampledAt             time.Time `gorm:"primaryKey"`
	ReferralLifetimeCents int64
	Referral30dCents      int64
	TemplateLifetimeCents int64
	Template30dCents      int64
	BountyLifetimeCents   int64
	ThreadLifetimeCents   int64
	// ReferralsCredited and ReferralsPending come from referralInfo, which
	// may fail on its own; -1 means it wasn't read.
	ReferralsCredited int
	ReferralsPending  int
	ReferralCode      string
}

// earningDetails is the internal endpoint's breakdown. The fields are
// floats on the wire to be safe, but Railway returns whole cents.
type earningDetails struct {
	ReferralEarningsLifetime float64 `json:"referralEarningsLifetime"`
	ReferralEarnings30d      float64 `json:"referralEarnings30d"`
	TemplateEarningsLifetime float64 `json:"templateEarningsLifetime"`
	TemplateEarnings30d      float64 `json:"templateEarnings30d"`
	BountyEarningsLifetime   float64 `json:"bountyEarningsLifetime"`
	ThreadEarningsLifetime   float64 `json:"threadEarningsLifetime"`
}

const earningDetailsQuery = `query ($customerId: String!) {
  earningDetails(customerId: $customerId) {
    referralEarningsLifetime referralEarnings30d
    templateEarningsLifetime templateEarnings30d
    bountyEarningsLifetime threadEarningsLifetime
  }
}`

func getEarningDetails(ctx context.Context, accessToken, customerID string) (earningDetails, error) {
	var data struct {
		Details earningDetails `json:"earningDetails"`
	}
	err := graphqlRequest(ctx, railwayGraphQLInternalURL+"?q=earningDetails", accessToken, earningDetailsQuery,
		map[string]any{"customerId": customerID}, &data)
	return data.Details, err
}

type referralInfo struct {
	Code  string `json:"code"`
	Stats struct {
		Pending  int `json:"pending"`
		Credited int `json:"credited"`
	} `json:"referralStats"`
}

func getReferralInfo(ctx context.Context, accessToken, workspaceID string) (referralInfo, error) {
	var data struct {
		Info referralInfo `json:"referralInfo"`
	}
	query := "query ($workspaceId: String!) { referralInfo(workspaceId: $workspaceId) { code referralStats { pending credited } } }"
	err := graphqlRequest(ctx, railwayGraphQLURL, accessToken, query, map[string]any{"workspaceId": workspaceID}, &data)
	return data.Info, err
}

func cents(v float64) int64 { return int64(math.Round(v)) }

// collectEarnings stores one EarningSnapshot. It rides the hourly collector;
// a failure is logged, since the rest of the dashboard doesn't need it.
func collectEarnings(ctx context.Context, db *gorm.DB) error {
	token, err := workspaceToken(ctx, db)
	if err != nil {
		return err
	}
	workspaceID, err := getWorkspaceID(ctx, token)
	if err != nil {
		return err
	}
	customerID, err := getWorkspaceCustomerID(ctx, token, workspaceID)
	if err != nil {
		return err
	}
	d, err := getEarningDetails(ctx, token, customerID)
	if err != nil {
		return err
	}
	snap := EarningSnapshot{
		SampledAt:             time.Now().UTC().Truncate(time.Second),
		ReferralLifetimeCents: cents(d.ReferralEarningsLifetime),
		Referral30dCents:      cents(d.ReferralEarnings30d),
		TemplateLifetimeCents: cents(d.TemplateEarningsLifetime),
		Template30dCents:      cents(d.TemplateEarnings30d),
		BountyLifetimeCents:   cents(d.BountyEarningsLifetime),
		ThreadLifetimeCents:   cents(d.ThreadEarningsLifetime),
		ReferralsCredited:     -1,
		ReferralsPending:      -1,
	}
	if info, err := getReferralInfo(ctx, token, workspaceID); err != nil {
		log.Printf("referral info: %v", err)
	} else {
		snap.ReferralsCredited, snap.ReferralsPending, snap.ReferralCode = info.Stats.Credited, info.Stats.Pending, info.Code
	}
	return db.WithContext(ctx).Create(&snap).Error
}

func runEarningsSnapshot(db *gorm.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := collectEarnings(ctx, db); err != nil {
		log.Printf("earnings snapshot: %v", err)
	}
}

// referralCredit is a rise in lifetime referral earnings between two
// snapshots: a referred user's reward landing. At is the snapshot that saw it.
type referralCredit struct {
	At    time.Time `json:"at"`
	Cents int64     `json:"cents"`
}

type referralsResponse struct {
	// SampledAt is nil until the collector has read Railway once.
	SampledAt     *time.Time `json:"sampledAt"`
	TrackedSince  *time.Time `json:"trackedSince"`
	LifetimeCents int64      `json:"lifetimeCents"`
	Last30Cents   int64      `json:"last30Cents"`
	// BeforeTrackingCents is what the first snapshot already held, so the
	// credits below plus it add up to LifetimeCents.
	BeforeTrackingCents   int64            `json:"beforeTrackingCents"`
	Credited              *int             `json:"credited"`
	Pending               *int             `json:"pending"`
	Code                  string           `json:"code"`
	TemplateLifetimeCents int64            `json:"templateLifetimeCents"`
	Template30dCents      int64            `json:"template30dCents"`
	BountyLifetimeCents   int64            `json:"bountyLifetimeCents"`
	ThreadLifetimeCents   int64            `json:"threadLifetimeCents"`
	Credits               []referralCredit `json:"credits"`
}

// buildReferrals reads the snapshots, oldest first, into the response.
func buildReferrals(snaps []EarningSnapshot) referralsResponse {
	resp := referralsResponse{Credits: []referralCredit{}}
	if len(snaps) == 0 {
		return resp
	}
	first, last := snaps[0], snaps[len(snaps)-1]
	resp.SampledAt, resp.TrackedSince = &last.SampledAt, &first.SampledAt
	resp.LifetimeCents, resp.Last30Cents = last.ReferralLifetimeCents, last.Referral30dCents
	resp.BeforeTrackingCents = first.ReferralLifetimeCents
	resp.TemplateLifetimeCents, resp.Template30dCents = last.TemplateLifetimeCents, last.Template30dCents
	resp.BountyLifetimeCents, resp.ThreadLifetimeCents = last.BountyLifetimeCents, last.ThreadLifetimeCents
	// The referral counts come from a separate call that can fail on its own:
	// report the latest reading that has them.
	for i := len(snaps) - 1; i >= 0; i-- {
		if s := snaps[i]; s.ReferralsCredited >= 0 {
			resp.Credited, resp.Pending, resp.Code = &s.ReferralsCredited, &s.ReferralsPending, s.ReferralCode
			break
		}
	}
	for i := 1; i < len(snaps); i++ {
		// A fall (a clawback, or Railway recounting) lowers the baseline
		// without a row; only rises are credits.
		if d := snaps[i].ReferralLifetimeCents - snaps[i-1].ReferralLifetimeCents; d > 0 {
			resp.Credits = append(resp.Credits, referralCredit{At: snaps[i].SampledAt.UTC(), Cents: d})
		}
	}
	// Newest first, like the payout ledger.
	for i, j := 0, len(resp.Credits)-1; i < j; i, j = i+1, j-1 {
		resp.Credits[i], resp.Credits[j] = resp.Credits[j], resp.Credits[i]
	}
	return resp
}

// handleReferrals serves the referral figures from the stored snapshots.
func handleReferrals(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		snaps := []EarningSnapshot{}
		if err := db.WithContext(r.Context()).Order("sampled_at").Find(&snaps).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, buildReferrals(snaps))
	}
}
