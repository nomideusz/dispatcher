import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Clock,
} from "lucide-react";
import { useState } from "react";
import { PayoutHistoryChart } from "~/components/payout-history-chart";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtCents, fmtNum, fmtSignedPct } from "~/lib/format";
import {
  type PayerChain,
  type Payout,
  PSEUDO_TEMPLATE_IDS,
  payoutHistoryQuery,
} from "~/queries/payouts";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
// Hover detail for date cells: billing rhythm is a time-of-day fingerprint, so
// the exact minute matters when reading payer chains. Local time plus UTC.
const timeFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const utcFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
function DateCell({ iso, className }: { iso: string; className: string }) {
  const d = new Date(iso);
  return (
    <td className={className} title={`${timeFmt.format(d)} (${utcFmt.format(d)} UTC)`}>
      {dayFmt.format(d)}
    </td>
  );
}
const monthLong = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

/** Matches the ranges on the Total payout chart, so the two read as one pair
 * of controls rather than two unrelated pickers. */
const RANGES = [7, 30, 90] as const;

export function PayoutHistory() {
  const [days, setDays] = useState<number>(30);
  const history = useQuery(payoutHistoryQuery(days));
  const data = history.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payouts</CardTitle>
        <CardDescription>
          Withdrawals from your Railway balance, cumulative over the range
        </CardDescription>
        <CardAction className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="xs"
              variant={r === days ? "secondary" : "ghost"}
              onClick={() => setDays(r)}
            >
              {r}d
            </Button>
          ))}
        </CardAction>
      </CardHeader>

      {history.isPending && (
        <CardContent className="space-y-3">
          <Skeleton className="h-64 w-full" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      )}

      {history.isError && (
        <CardContent>
          <p className="text-sm text-(--viz-critical)">
            Couldn&apos;t load payout history — check the server logs.
          </p>
        </CardContent>
      )}

      {data && data.totalRows === 0 && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No payouts recorded yet. Railway pays out once your balance clears{" "}
            {fmtCents(10000)}; the collector picks them up on each refresh.
          </p>
        </CardContent>
      )}

      {data && data.totalRows > 0 && (
        <>
          <CardContent className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <WindowFigure days={days} data={data} />
            <Figure
              label="Total paid out"
              value={fmtCents(data.totals.lifetimeCents)}
              note={
                data.totals.firstPayoutAt
                  ? `since ${monthLong.format(new Date(data.totals.firstPayoutAt))}`
                  : undefined
              }
            />
            {data.totals.pendingCount > 0 && (
              <Figure
                label="In flight"
                value={fmtCents(data.totals.pendingCents)}
                note={`${data.totals.pendingCount} pending`}
              />
            )}
          </CardContent>

          <CardContent>
            {data.window.count > 0 ? (
              <PayoutHistoryChart points={data.points} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No payouts in the last {days} days.
              </p>
            )}
          </CardContent>

          {data.byTemplate.length > 0 && (
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="pb-2 text-left text-xs text-muted-foreground">
                  Credit payouts by template. Payers is an estimate over the
                  trailing 30 days whatever the range: Railway pays out one row
                  per billed service, so a burst of rows is one deployer&apos;s
                  invoice, and one billing cycle of invoices counts each paying
                  deployer once. New, returning and lapsed follow each payer by
                  billing rhythm: invoices of one template exactly a month or 30
                  days apart, to within minutes, are the same deployer. Amount
                  follows the selected range; lifetime is the template&apos;s
                  all-time payout, which is how templates that only earned
                  before tracking still appear.
                </caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Template</th>
                    <th className="pb-2 pl-3 text-right font-medium">Payers 30d</th>
                    <th className="pb-2 pl-3 text-right font-medium">New</th>
                    <th className="pb-2 pl-3 text-right font-medium">Returning</th>
                    <th className="pb-2 pl-3 text-right font-medium">Lapsed</th>
                    <th className="pb-2 pl-3 text-right font-medium">$/payer</th>
                    {days <= 7 && (
                      <th className="pb-2 pl-3 text-right font-medium">Invoices {days}d</th>
                    )}
                    <th className="pb-2 pl-3 text-right font-medium">Amount</th>
                    <th className="pb-2 pl-3 text-right font-medium">Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byTemplate.map((t) => (
                    <tr key={t.templateId} className="border-b border-border/50 last:border-0">
                      <td
                        className={
                          PSEUDO_TEMPLATE_IDS.has(t.templateId)
                            ? "py-2 text-muted-foreground"
                            : "py-2"
                        }
                      >
                        {t.templateName}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(t.payers)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums">{t.new || "—"}</td>
                      <td className={`py-2 pl-3 text-right tabular-nums ${t.returning ? "text-(--viz-up)" : ""}`}>
                        {t.returning || "—"}
                      </td>
                      <td className={`py-2 pl-3 text-right tabular-nums ${t.lapsed ? "text-(--viz-down)" : ""}`}>
                        {t.lapsed || "—"}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {t.payers > 0 ? fmtCents(Math.round(t.payerCents / t.payers)) : "—"}
                      </td>
                      {days <= 7 && (
                        <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(t.invoices)}</td>
                      )}
                      <td className="py-2 pl-3 text-right tabular-nums">{fmtCents(t.cents)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                        {t.lifetimeCents > 0 ? fmtCents(t.lifetimeCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          )}

          {data.payers.length > 0 && (
            <CardContent className="max-h-[24rem] overflow-auto">
              <table className="w-full text-sm">
                <caption className="pb-2 text-left text-xs text-muted-foreground">
                  Payers, one line per deployer. Returning means they paid again
                  on their billing date; lapsed means a due invoice never came.
                </caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Template</th>
                    <th className="pb-2 pl-3 font-medium">Status</th>
                    <th className="pb-2 pl-3 font-medium">First</th>
                    <th className="pb-2 pl-3 font-medium">Last</th>
                    <th className="pb-2 pl-3 font-medium">Next due</th>
                    <th className="pb-2 pl-3 text-right font-medium">Invoices</th>
                    <th className="pb-2 pl-3 text-right font-medium">Last amount</th>
                    <th className="pb-2 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payers.map((c) => (
                    <PayerRow key={`${c.templateId}-${c.firstAt}`} chain={c} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          )}

          <CardContent className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Payouts in the last {days} days, newest first
              </caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 pl-3 font-medium">Template</th>
                  <th className="pb-2 pl-3 font-medium">Destination</th>
                  <th className="pb-2 pl-3 font-medium">Status</th>
                  <th className="pb-2 pl-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((p) => (
                  <PayoutRow key={p.id} payout={p} />
                ))}
              </tbody>
            </table>
            {data.totalRows > data.payouts.length && (
              <p className="pt-3 text-xs text-muted-foreground">
                {fmtNum(data.payouts.length)} payouts in the last {days} days;{" "}
                {fmtNum(data.totalRows - data.payouts.length)} more before that.
              </p>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}

/** The headline for the selected range, with the same "vs previous period"
 * treatment the dashboard's stat tiles use. */
function WindowFigure({
  days,
  data,
}: {
  days: number;
  data: { window: { totalCents: number; changePct: number | null; count: number } };
}) {
  const { totalCents, changePct, count } = data.window;
  return (
    <div>
      <div className="text-xs text-muted-foreground">Paid out · last {days}d</div>
      <div className="text-xl font-semibold">{fmtCents(totalCents)}</div>
      {changePct != null ? (
        <div className="flex items-center gap-1 text-xs">
          <span
            className={`flex items-center gap-0.5 font-medium ${
              changePct >= 0 ? "text-(--viz-up)" : "text-(--viz-down)"
            }`}
          >
            {changePct >= 0 ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownRight className="size-3.5" />
            )}
            {fmtSignedPct(changePct)}
          </span>
          <span className="text-muted-foreground">vs previous {days}d</span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {count} {count === 1 ? "payout" : "payouts"}
        </div>
      )}
    </div>
  );
}

/** Inline stat figure. Proportional (not tabular) digits — these sit alone,
 * not in a column, and equal-width digits read loose at this size. */
function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function PayerRow({ chain }: { chain: PayerChain }) {
  const tone =
    chain.status === "returning"
      ? "text-(--viz-up)"
      : chain.status === "lapsed"
        ? "text-(--viz-down)"
        : "text-muted-foreground";
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td
        className={
          PSEUDO_TEMPLATE_IDS.has(chain.templateId)
            ? "py-2 text-muted-foreground"
            : "py-2"
        }
      >
        {chain.templateName}
      </td>
      <td className={`py-2 pl-3 ${tone}`}>{chain.status}</td>
      <DateCell iso={chain.firstAt} className="whitespace-nowrap py-2 pl-3 tabular-nums" />
      <DateCell iso={chain.lastAt} className="whitespace-nowrap py-2 pl-3 tabular-nums" />
      {chain.status === "lapsed" ? (
        <td className="whitespace-nowrap py-2 pl-3 tabular-nums text-muted-foreground">—</td>
      ) : (
        <DateCell iso={chain.nextDueAt} className="whitespace-nowrap py-2 pl-3 tabular-nums text-muted-foreground" />
      )}
      <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(chain.invoices)}</td>
      <td className="py-2 pl-3 text-right tabular-nums">{fmtCents(chain.lastCents)}</td>
      <td className="py-2 pl-3 text-right tabular-nums">{fmtCents(chain.totalCents)}</td>
    </tr>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <DateCell iso={payout.createdAt} className="whitespace-nowrap py-2.5 pr-4 tabular-nums" />
      <td
        className={
          PSEUDO_TEMPLATE_IDS.has(payout.templateId) || !payout.templateName
            ? "py-2.5 pl-3 text-muted-foreground"
            : "py-2.5 pl-3"
        }
      >
        {payout.templateName ||
          (payout.templateId === "unknown"
            ? "unknown"
            : payout.kind === "credits"
              ? "pending"
              : "—")}
      </td>
      <td className="py-2.5 pl-3 text-muted-foreground">{payout.destination}</td>
      <td className="py-2.5 pl-3">
        <PayoutStatus status={payout.status} />
      </td>
      <td className="whitespace-nowrap py-2.5 pl-3 text-right font-medium tabular-nums">
        {fmtCents(payout.amountCents)}
      </td>
    </tr>
  );
}

/** Status always ships as icon + word, never colour alone. */
function PayoutStatus({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  if (status === "PENDING") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Clock className="size-3.5" />
        {label}
      </span>
    );
  }
  if (status === "COMPLETED") {
    return (
      <span className="flex items-center gap-1 text-(--viz-up)">
        <CircleCheck className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-(--viz-critical)">
      <CircleAlert className="size-3.5" />
      {label}
    </span>
  );
}
