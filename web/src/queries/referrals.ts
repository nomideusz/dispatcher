import { queryOptions } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** A rise in lifetime referral earnings between two hourly readings: a
 * referred user's reward landing. */
export interface ReferralCredit {
  at: string;
  cents: number;
}

/** Railway's earnings breakdown as the collector last read it. Railway
 * writes no ledger row for a referral reward, so credits are the rises
 * between readings, and beforeTrackingCents is what the first reading
 * already held. credited/pending are referred users, null if never read. */
export interface Referrals {
  sampledAt: string | null;
  trackedSince: string | null;
  lifetimeCents: number;
  last30Cents: number;
  beforeTrackingCents: number;
  credited: number | null;
  pending: number | null;
  code: string;
  templateLifetimeCents: number;
  template30dCents: number;
  bountyLifetimeCents: number;
  threadLifetimeCents: number;
  credits: ReferralCredit[];
}

export const referralsQuery = queryOptions({
  queryKey: ["referrals"],
  queryFn: ({ signal }) => api.get("referrals", { signal }).json<Referrals>(),
});
