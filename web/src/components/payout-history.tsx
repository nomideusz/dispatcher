import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Clock,
} from "lucide-react";
import { useState } from "react";
import { Delta } from "~/components/delta";
import { DOCKET, DocketCell, Fig } from "~/components/page";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead, useSort } from "~/components/ui/table";
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
/** "today", "tomorrow", or the date. */
function relDay(iso: string): string {
  const day = (d: Date) => d.toDateString();
  const d = new Date(iso);
  if (day(d) === day(new Date())) return "today";
  if (day(d) === day(new Date(Date.now() + 86_400_000))) return "tomorrow";
  return fmtDate(d);
}
const monthLong = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

/** Payer columns sort on these; ties keep the server's order, biggest
 * total first. Lapsed payers have no next due date, so they sort last. */
type PayerKey = "rank" | "name" | "template" | "status" | "first" | "last" | "due" | "invoices" | "lastAmount" | "total";
const STATUS_ORDER: Record<PayerChain["status"], number> = { returning: 0, new: 1, lapsed: 2 };
const payerValue = (c: PayerChain, key: PayerKey) =>
  ({
    rank: c.rank,
    name: c.name,
    template: c.templateName,
    status: STATUS_ORDER[c.status],
    first: c.firstAt,
    last: c.lastAt,
    due: c.status === "lapsed" ? null : c.nextDueAt,
    invoices: c.invoices,
    lastAmount: c.lastCents,
    total: c.totalCents,
  })[key];

type LedgerKey = "date" | "template" | "destination" | "status" | "amount";
const ledgerValue = (p: Payout, key: LedgerKey) =>
  ({
    date: p.createdAt,
    template: p.templateName || null,
    destination: p.destination || null,
    status: p.status,
    amount: p.amountCents,
  })[key];

type PayoutView = "payers" | "ledger";
/** Money out of Railway, who is paying, and the raw ledger, for the range
 * the dashboard header picks, in one card: the figures and the cumulative
 * line on top, then payers or the ledger. Per-template totals live in the
 * templates table. */
export function PayoutHistory({ days }: { days: number }) {
  const [view, setView] = useState<PayoutView>("payers");
  const history = useQuery(payoutHistoryQuery(days));
  const data = history.data;
  const statusCount = (s: PayerChain["status"]) =>
    data?.payers.filter((c) => c.status === s).length ?? 0;
  const hasPayers = (data?.payers.length ?? 0) > 0;
  const current: PayoutView = hasPayers ? view : "ledger";
  const payers = useSort(data?.payers ?? [], payerValue, "total", ["rank", "name", "template", "status", "due"]);
  const ledger = useSort(data?.payouts ?? [], ledgerValue, "date", ["template", "destination", "status"]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash and credits</CardTitle>
        <CardDescription>
          Withdrawn from Railway in this range, as cash or credits, and who pays the kickback. Kickback not yet
          withdrawn is the balance on the docket above.
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
            {/* An odd last cell spans the phone's two columns instead of leaving a hole. */}
            <div className={cn(DOCKET, "grid-cols-2 max-lg:[&>:last-child:nth-child(odd)]:col-span-2 lg:auto-cols-fr lg:grid-flow-col")}>
              <WindowFigure days={days} data={data} />
              <DocketCell label="Withdrawn in all" value={fmtCents(data.totals.lifetimeCents)} small>
                {data.totals.firstPayoutAt && `since ${monthLong.format(new Date(data.totals.firstPayoutAt))}`}
              </DocketCell>
              {data.totals.pendingCount > 0 && (
                <DocketCell label="In flight" value={fmtCents(data.totals.pendingCents)} small>
                  <Fig>{data.totals.pendingCount}</Fig> pending
                </DocketCell>
              )}
              <DueFigure payers={data.payers} />
            </div>
            {data.window.count > 0 && <PayoutHistoryChart points={data.points} />}
          </CardContent>

          <CardContent className="space-y-3 border-t pt-4">
            {current === "payers" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  <Fig>{fmtNum(statusCount("returning"))}</Fig> returning · <Fig>{fmtNum(statusCount("new"))}</Fig> new ·{" "}
                  <Fig>{fmtNum(statusCount("lapsed"))}</Fig> lapsed. One row per deployer, under a made-up name.
                  Returning: paid again on their billing date. Lapsed: missed a due invoice.
                </p>
                <Table rows={data.payers.length}>
                  <TableHeader>
                    <TableRow>
                      {payers.head("rank", "#", { numeric: true, className: "max-sm:hidden" })}
                      {payers.head("name", "Payer", { className: "max-sm:pl-0" })}
                      {payers.head("template", "Template", { className: "max-sm:hidden" })}
                      {payers.head("status", "Status", { hint: "Returning, then new, then lapsed", className: "max-sm:hidden" })}
                      {payers.head("first", "First", { className: "max-sm:hidden" })}
                      {payers.head("last", "Last", { className: "max-sm:hidden" })}
                      {payers.head("due", "Next due", { hint: "Soonest first; lapsed payers last", className: "max-sm:hidden" })}
                      {payers.head("invoices", "Invoices", { numeric: true, className: "max-sm:hidden" })}
                      {payers.head("lastAmount", "Last amount", { numeric: true, className: "max-sm:hidden" })}
                      {payers.head("total", "Total", { hint: "Paid in all", numeric: true })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payers.rows.map((c) => (
                      <PayerRow key={`${c.templateId}-${c.firstAt}`} chain={c} />
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  <Fig>{fmtNum(data.payouts.length)}</Fig> payouts and balance accruals in the last <Fig>{days}</Fig>{" "}
                  days, newest first
                  {data.totalRows > data.payouts.length &&
                    `; ${fmtNum(data.totalRows - data.payouts.length)} more before that`}
                  .
                </p>
                <Table rows={data.payouts.length}>
                  <TableHeader>
                    <TableRow>
                      {ledger.head("date", "Date")}
                      {ledger.head("template", "Template")}
                      {ledger.head("destination", "Destination", { className: "max-sm:hidden" })}
                      {ledger.head("status", "Status")}
                      {ledger.head("amount", "Amount", { numeric: true })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.rows.map((p) => (
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
    <DocketCell label={`Withdrawn · last ${days}d`} value={fmtCents(totalCents)} small>
      {count === 0 ? (
        data.totals.lastPayoutAt ? (
          `last ${fmtDate(new Date(data.totals.lastPayoutAt))}; kickback waits in the balance`
        ) : (
          "nothing withdrawn yet"
        )
      ) : changePct != null ? (
        <Delta pct={changePct} suffix={`vs previous ${days}d`} />
      ) : (
        <>
          <Fig>{count}</Fig> {count === 1 ? "payout" : "payouts"}
        </>
      )}
    </DocketCell>
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
    <DocketCell label="Expected from payers, 30 days" value={`~${fmtCents(due.reduce((s, p) => s + p.lastCents, 0))}`} small>
      <Fig>{due.length}</Fig> {due.length === 1 ? "payer" : "payers"}
      {next ? `, next ${relDay(next.nextDueAt)}` : ""}
    </DocketCell>
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
