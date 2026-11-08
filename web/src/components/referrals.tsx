import { useQuery } from "@tanstack/react-query";
import { DOCKET, DocketCell, Fig } from "~/components/page";
import { fmtCents, fmtDay, fmtDayTime, fmtNum } from "~/lib/format";
import { cn } from "~/lib/utils";
import { referralsQuery } from "~/queries/referrals";

/** Referral earnings: Railway's totals, the referred users behind them, and
 * each credit the hourly readings have seen land. */
export function ReferralEarnings() {
  const q = useQuery(referralsQuery);
  if (q.isError) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t load referral earnings.</p>;
  }
  const r = q.data;
  if (r && !r.sampledAt) {
    return (
      <p className="text-sm text-muted-foreground">
        Not read from Railway yet. The collector reads it every hour.
      </p>
    );
  }
  const share =
    r && r.template30dCents + r.last30Cents > 0
      ? (r.last30Cents / (r.template30dCents + r.last30Cents)) * 100
      : null;
  const link = r?.code ? `https://railway.com?referralCode=${r.code}` : null;

  return (
    <div className="space-y-3">
      <section aria-label="Referral figures" className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
        <DocketCell small label="Lifetime" value={r ? fmtCents(r.lifetimeCents) : null}>
          {r && r.bountyLifetimeCents + r.threadLifetimeCents > 0 && (
            <p>
              Bounties <Fig>{fmtCents(r.bountyLifetimeCents)}</Fig> · threads{" "}
              <Fig>{fmtCents(r.threadLifetimeCents)}</Fig>
            </p>
          )}
        </DocketCell>
        <DocketCell small label="Last 30 days" value={r ? fmtCents(r.last30Cents) : null}>
          {share != null && (
            <p>
              <Fig>{share < 1 && share > 0 ? share.toFixed(1) : share.toFixed(0)}%</Fig> of the 30 days&apos; earnings
            </p>
          )}
        </DocketCell>
        <DocketCell small label="Referred users" value={r ? (r.credited != null ? fmtNum(r.credited) : "—") : null}>
          {r?.pending != null && (
            <p>
              credited · <Fig>{fmtNum(r.pending)}</Fig> pending
            </p>
          )}
        </DocketCell>
        <DocketCell small label="Referral link" value={r ? (r.code || "—") : null}>
          {link && (
            <p className="truncate">
              <a href={link} className="text-primary underline" target="_blank" rel="noreferrer">
                {link.replace("https://", "")}
              </a>
            </p>
          )}
        </DocketCell>
      </section>
      {r && (
        <div className="text-sm">
          {r.credits.length > 0 ? (
            <ul className="divide-y border-y">
              {r.credits.map((c) => (
                <li key={c.at} className="flex justify-between gap-4 py-1.5">
                  <span>{fmtDayTime(c.at)}</span>
                  <Fig>+{fmtCents(c.cents)}</Fig>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No new credit since tracking began on {fmtDay(r.trackedSince!)}
              {r.beforeTrackingCents > 0 && (
                <>
                  ; the <Fig>{fmtCents(r.beforeTrackingCents)}</Fig> came before it
                </>
              )}
              .
            </p>
          )}
          {r.credits.length > 0 && r.beforeTrackingCents > 0 && (
            <p className="mt-1.5 text-muted-foreground">
              Plus <Fig>{fmtCents(r.beforeTrackingCents)}</Fig> earned before {fmtDay(r.trackedSince!)}, when tracking
              began.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
