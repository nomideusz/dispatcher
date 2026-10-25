import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Clock,
} from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { dayDate, fmtCents, fmtNum } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  type PayerChain,
  type Payout,
  type PayoutHistory as PayoutHistoryData,
  PSEUDO_TEMPLATE_IDS,
  payoutHistoryQuery,
} from "~/queries/payouts";

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const yearFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
/** "Aug 17", with the year only when it isn't this one. */
const fmtDate = (d: Date) =>
  (d.getFullYear() === new Date().getFullYear() ? dayFmt : yearFmt).format(d);
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
function DateCell({ iso, className }: { iso: string; className?: string }) {
  const d = new Date(iso);
  return (
    <TableCell className={cn("whitespace-nowrap tabular-nums", className)} title={`${timeFmt.format(d)} (${utcFmt.format(d)} UTC)`}>
      {fmtDate(d)}
    </TableCell>
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
          Paid out in this range. The balance still in Railway is on the docket above.
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
            No payouts yet. Railway pays out once your balance is over {fmtCents(10000)}; payouts
            show up here on the next refresh.
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
              <DueFigure payers={data.payers} />
            </div>
            {data.window.count > 0 && <PayoutHistoryChart points={data.points} />}
          </CardContent>

          <CardContent className="space-y-3 border-t pt-4">
            {current === "payers" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {fmtNum(statusCount("returning"))} returning · {fmtNum(statusCount("new"))} new ·{" "}
                    {fmtNum(statusCount("lapsed"))} lapsed. One row per deployer, under a made-up name.
                    Returning: paid again on their billing date. Lapsed: missed a due invoice.
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead numeric className="max-sm:hidden">#</TableHead>
                      <TableHead className="max-sm:pl-0">Payer</TableHead>
                      <TableHead className="max-sm:hidden">Template</TableHead>
                      <TableHead className="max-sm:hidden">Status</TableHead>
                      <TableHead className="max-sm:hidden">First</TableHead>
                      <TableHead className="max-sm:hidden">Last</TableHead>
                      <TableHead className="max-sm:hidden">Next due</TableHead>
                      <TableHead numeric className="max-sm:hidden">Invoices</TableHead>
                      <TableHead numeric className="max-sm:hidden">Last amount</TableHead>
                      <TableHead numeric>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortPayers(data.payers, payerSort).map((c) => (
                      <PayerRow key={`${c.templateId}-${c.firstAt}`} chain={c} />
                    ))}
                  </TableBody>
                </Table>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead className="max-sm:hidden">Destination</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead numeric>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payouts.map((p) => (
                      <PayoutRow key={p.id} payout={p} />
                    ))}
                  </TableBody>
                </Table>
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
      <div className="text-xl font-semibold tabular-nums">{fmtCents(totalCents)}</div>
      {count === 0 ? (
        <div className="text-xs text-muted-foreground">
          {data.totals.lastPayoutAt
            ? `last payout ${fmtDate(new Date(data.totals.lastPayoutAt))}`
            : "no payouts yet"}
        </div>
      ) : changePct != null ? (
        <Delta pct={changePct} suffix={`vs previous ${days}d`} />
      ) : (
        <div className="text-xs text-muted-foreground">
          {count} {count === 1 ? "payout" : "payouts"}
        </div>
      )}
    </div>
  );
}

/** Inline stat figure, in mono like every figure. */
function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Kickback the current payers should bring in over the next 30 days: each
 * one's last amount, if they're due again in that time. */
function DueFigure({ payers }: { payers: PayerChain[] }) {
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const due = payers.filter((p) => p.status !== "lapsed" && p.nextDueAt <= horizon);
  if (due.length === 0) return null;
  const now = new Date().toISOString();
  const upcoming = due.filter((p) => p.nextDueAt >= now);
  const next = upcoming.length ? upcoming.reduce((a, b) => (a.nextDueAt < b.nextDueAt ? a : b)) : null;
  return (
    <Figure
      label="Due in the next 30 days"
      value={`~${fmtCents(due.reduce((s, p) => s + p.lastCents, 0))}`}
      note={`${due.length} ${due.length === 1 ? "payer" : "payers"}${next ? `, next ${fmtDate(new Date(next.nextDueAt))}` : ""}`}
    />
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
    <TableRow>
      <TableCell numeric className="text-muted-foreground max-sm:hidden">{chain.rank}</TableCell>
      <TableRowHead className="max-sm:pl-0">
        <div className="font-medium capitalize">{chain.name}</div>
        {/* A phone shows only payer and total; the rest rides here. */}
        <div className="text-xs text-muted-foreground sm:hidden">
          {chain.templateName} · <span className={tone}>{chain.status}</span>
        </div>
      </TableRowHead>
      <TableCell className={cn("max-sm:hidden", PSEUDO_TEMPLATE_IDS.has(chain.templateId) && "text-muted-foreground")}>
        {chain.templateName}
      </TableCell>
      <TableCell className={cn("max-sm:hidden", tone)}>{chain.status}</TableCell>
      <DateCell iso={chain.firstAt} className="max-sm:hidden" />
      <DateCell iso={chain.lastAt} className="max-sm:hidden" />
      {chain.status === "lapsed" ? (
        <TableCell className="text-muted-foreground max-sm:hidden">—</TableCell>
      ) : (
        <DateCell iso={chain.nextDueAt} className="text-muted-foreground max-sm:hidden" />
      )}
      <TableCell numeric className="max-sm:hidden">{fmtNum(chain.invoices)}</TableCell>
      <TableCell numeric className="max-sm:hidden">{fmtCents(chain.lastCents)}</TableCell>
      <TableCell numeric>{fmtCents(chain.totalCents)}</TableCell>
    </TableRow>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <TableRow>
      <DateCell iso={payout.createdAt} />
      <TableCell className={cn((PSEUDO_TEMPLATE_IDS.has(payout.templateId) || !payout.templateName) && "text-muted-foreground")}>
        {payout.templateName ||
          (payout.templateId === "unknown"
            ? "unknown"
            : payout.kind === "credits"
              ? "pending"
              : "—")}
      </TableCell>
      <TableCell className="text-muted-foreground max-sm:hidden">{payout.destination}</TableCell>
      <TableCell>
        <PayoutStatus status={payout.status} />
      </TableCell>
      <TableCell numeric className="font-medium">
        {fmtCents(payout.amountCents)}
      </TableCell>
    </TableRow>
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
