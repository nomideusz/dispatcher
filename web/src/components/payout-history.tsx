import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Clock,
} from "lucide-react";
import { useState } from "react";
import { Delta } from "~/components/delta";
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
import { dayDate, fmtCents, fmtNum } from "~/lib/format";
import {
  type PayerChain,
  type Payout,
  type PayoutHistory as PayoutHistoryData,
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

/** Three readings of the same payer list: who matters (rank by lifetime
 * total, the server's order), who is alive (returning, then new, then
 * lapsed; more invoices first; most recent first), and who is due next
 * (soonest next-due first; lapsed last, since nothing is expected). */
type PayerSort = "rank" | "status" | "due";
const STATUS_ORDER: Record<PayerChain["status"], number> = { returning: 0, new: 1, lapsed: 2 };
function sortPayers(payers: PayerChain[], by: PayerSort): PayerChain[] {
  if (by === "rank") return payers;
  if (by === "due") {
    return [...payers].sort(
      (a, b) =>
        Number(a.status === "lapsed") - Number(b.status === "lapsed") ||
        a.nextDueAt.localeCompare(b.nextDueAt),
    );
  }
  return [...payers].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.invoices - a.invoices ||
      b.lastAt.localeCompare(a.lastAt),
  );
}
const PAYER_SORT_LABELS: Record<PayerSort, string> = { rank: "By total", status: "By status", due: "By next due" };

type PayoutView = "payers" | "ledger";
const STICKY_HEAD = "w-full text-sm [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card";

/** Money out of Railway, who is paying, and the raw ledger, for the range
 * the dashboard header picks, in one card: the figures and the cumulative
 * line on top, then payers or the ledger. Per-template totals live in the
 * templates table. */
export function PayoutHistory({ days }: { days: number }) {
  const [payerSort, setPayerSort] = useState<PayerSort>("rank");
  const [view, setView] = useState<PayoutView>("payers");
  const history = useQuery(payoutHistoryQuery(days));
  const data = history.data;
  const statusCount = (s: PayerChain["status"]) =>
    data?.payers.filter((c) => c.status === s).length ?? 0;
  const hasPayers = (data?.payers.length ?? 0) > 0;
  const current: PayoutView = hasPayers ? view : "ledger";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash and credits</CardTitle>
        <CardDescription>
          Paid out over the range. Kickback still in the Railway balance counts as earned
          above, not here.
        </CardDescription>
        {data && data.totalRows > 0 && (
          <CardAction>
            {hasPayers && (
              <Button
                size="xs"
                aria-pressed={current === "payers"}
                variant={current === "payers" ? "secondary" : "ghost"}
                onClick={() => setView("payers")}
              >
                Payers
                <span className="tabular-nums text-muted-foreground">{fmtNum(data.payers.length)}</span>
              </Button>
            )}
            <Button
              size="xs"
              aria-pressed={current === "ledger"}
              variant={current === "ledger" ? "secondary" : "ghost"}
              onClick={() => setView("ledger")}
            >
              Ledger
              <span className="tabular-nums text-muted-foreground">{fmtNum(data.payouts.length)}</span>
            </Button>
          </CardAction>
        )}
      </CardHeader>

      {history.isPending && (
        <CardContent>
          <Skeleton className="h-64 w-full" />
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
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
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
              {data.window.count === 0 && (
                <p className="max-w-md self-center text-sm text-muted-foreground">
                  Nothing paid out in the last {days} days
                  {data.totals.lastPayoutAt &&
                    ` — the last payout was ${dayFmt.format(new Date(data.totals.lastPayoutAt))}`}
                  . Kickback is accruing in the Railway balance instead.
                </p>
              )}
            </div>
            {data.window.count > 0 && <PayoutHistoryChart points={data.points} />}
          </CardContent>

          <CardContent className="space-y-3 border-t pt-4">
            {current === "payers" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {fmtNum(statusCount("returning"))} returning · {fmtNum(statusCount("new"))} new ·{" "}
                    {fmtNum(statusCount("lapsed"))} lapsed. One line per deployer, under a stable
                    pseudonym: returning paid again on their billing date, lapsed missed a due
                    invoice.
                  </p>
                  <div role="group" aria-label="Sort payers" className="flex gap-1">
                    {(["rank", "status", "due"] as const).map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        aria-pressed={s === payerSort}
                        variant={s === payerSort ? "secondary" : "ghost"}
                        onClick={() => setPayerSort(s)}
                      >
                        {PAYER_SORT_LABELS[s]}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="scroll-fade max-h-[32rem] overflow-auto">
                  <table className={STICKY_HEAD}>
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 text-right font-medium">#</th>
                        <th className="pb-2 pl-3 font-medium">Payer</th>
                        <th className="pb-2 pl-3 font-medium">Template</th>
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
                      {sortPayers(data.payers, payerSort).map((c) => (
                        <PayerRow key={`${c.templateId}-${c.firstAt}`} chain={c} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {fmtNum(data.payouts.length)} payouts and balance accruals in the last {days}{" "}
                  days, newest first
                  {data.totalRows > data.payouts.length &&
                    `; ${fmtNum(data.totalRows - data.payouts.length)} more before that`}
                  .
                </p>
                <div className="scroll-fade max-h-[32rem] overflow-auto">
                  <table className={STICKY_HEAD}>
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
                </div>
              </>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}

/** The headline for the selected range, with the same "vs previous period"
 * treatment the dashboard's stat tiles use. */
function WindowFigure({ days, data }: { days: number; data: PayoutHistoryData }) {
  const { totalCents, count } = data.window;
  // Only against a previous range that payouts had already begun by.
  const previousStart = dayDate(data.points[0]?.date ?? "").getTime() - days * 86_400_000;
  const changePct =
    data.totals.firstPayoutAt && Date.parse(data.totals.firstPayoutAt) <= previousStart
      ? data.window.changePct
      : null;
  return (
    <div>
      <div className="text-xs text-muted-foreground">Paid out · last {days}d</div>
      <div className="text-xl font-semibold">{fmtCents(totalCents)}</div>
      {changePct != null ? (
        <Delta pct={changePct} suffix={`vs previous ${days}d`} />
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
      <td className="py-2 text-right tabular-nums text-muted-foreground">{chain.rank}</td>
      <td className="py-2 pl-3 font-medium capitalize">{chain.name}</td>
      <td
        className={
          PSEUDO_TEMPLATE_IDS.has(chain.templateId)
            ? "py-2 pl-3 text-muted-foreground"
            : "py-2 pl-3"
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
