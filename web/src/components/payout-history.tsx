import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Clock,
} from "lucide-react";
import { Delta } from "~/components/delta";
import { DOCKET, DocketCell, Fig } from "~/components/page";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { dayDate, fmtCents, fmtNum, shortNames } from "~/lib/format";
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
type PayerKey = "rank" | "template" | "status" | "first" | "last" | "due" | "invoices" | "lastAmount" | "total";
const STATUS_ORDER: Record<PayerChain["status"], number> = { returning: 0, new: 1, lapsed: 2 };
const payerValue = (c: PayerChain, key: PayerKey) =>
  ({
    rank: c.rank,
    template: c.templateName,
    status: STATUS_ORDER[c.status],
    first: c.firstAt,
    last: c.lastAt,
    due: c.status === "lapsed" ? null : c.nextDueAt,
    invoices: c.invoices,
    lastAmount: c.lastCents,
    total: c.totalCents,
  })[key];

/** Money out of Railway and who is paying it, in one card: the withdrawn
 * figures for the range the dashboard header picks, the range's withdrawals, then every payer, latest invoice first. Payers replace the raw
 * ledger: its kickback rows are their invoices, so only withdrawals to a bank
 * or card are listed apart. Per-template totals live in the templates table. */
export function PayoutHistory({ days }: { days: number }) {
  const history = useQuery(payoutHistoryQuery(days));
  const data = history.data;
  const statusCount = (s: PayerChain["status"]) =>
    data?.payers.filter((c) => c.status === s).length ?? 0;
  const hasPayers = (data?.payers.length ?? 0) > 0;
  const payers = useSort(data?.payers ?? [], payerValue, "last", ["rank", "template", "status", "due"]);
  const withdrawals = data?.payouts.filter((p) => p.kind === "cash") ?? [];

  const short = shortNames(data?.payers.map((p) => p.templateName) ?? []);

  return (
    <Card>

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
          <CardContent>
            {/* An odd last cell spans the phone's two columns instead of leaving a hole. */}
            <div className={cn(DOCKET, "grid-cols-2 max-lg:[&>:last-child:nth-child(odd)]:col-span-2 lg:auto-cols-fr lg:grid-flow-col")}>
              <WindowFigure days={data.window.days} data={data} />
              <DocketCell label="Withdrawn in all" value={fmtCents(data.totals.lifetimeCents)} small>
                {data.totals.firstPayoutAt && `since ${monthLong.format(new Date(data.totals.firstPayoutAt))}`}
              </DocketCell>
              {data.totals.pendingCount > 0 && (
                <DocketCell label="In flight" value={fmtCents(data.totals.pendingCents)} small>
                  <Fig>{data.totals.pendingCount}</Fig> pending
                </DocketCell>
              )}
            </div>
          </CardContent>

          <CardContent className="space-y-3 border-t pt-4">
            <Withdrawals rows={withdrawals} days={data.window.days} />
            {hasPayers && (
              <>
                <p className="text-xs text-muted-foreground">
                  <span className="mr-3 whitespace-nowrap">
                    <Fig>{fmtNum(data.payers.length)}</Fig> payers
                  </span>
                  {(["returning", "new", "lapsed"] as const).map((st) => (
                    <span key={st} className="mr-3 inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Mark status={st} kind={st === "lapsed" ? "missed" : "paid"} />
                      <Fig>{fmtNum(statusCount(st))}</Fig> {st}
                    </span>
                  ))}
                  <span className="inline-block">
                    One row per deployer, pieced together from invoices since Railway doesn&apos;t say who. Every payer so far, whatever the range, latest invoice first. Returning: paid again on their billing date.
                    Lapsed: missed a due invoice.
                  </span>
                </p>
                <Table rows={data.payers.length} limit={50}>
                  <TableHeader>
                    <TableRow>
                      {payers.head("rank", "#", { hint: "By total, 1 = biggest", numeric: true, className: "max-sm:hidden" })}
                      {payers.head("template", "Template", { className: "max-sm:pl-0" })}
                      {payers.head("status", "Status", { hint: "Returning, then new, then lapsed", className: "max-sm:hidden" })}
                      {payers.head("first", "First", { className: "max-sm:hidden" })}
                      {payers.head("last", "Last", { hint: "Latest invoice", className: "max-sm:hidden" })}
                      {payers.head("due", "Next due", { hint: "Soonest first; lapsed payers last", className: "max-sm:hidden" })}
                      {payers.head("invoices", "Invoices", { hint: "One square per invoice paid; outlined is the next one due, dashed one that was missed", numeric: true, className: "max-sm:hidden" })}
                      {payers.head("lastAmount", "Last amount", { numeric: true, className: "max-sm:hidden" })}
                      {payers.head("total", "Total", { hint: "Paid in all", numeric: true })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payers.rows.map((c) => (
                      <PayerRow key={`${c.templateId}-${c.firstAt}`} chain={c} short={short} />
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

/** A payer's colour says whether they are still paying: returning in the
 * running green, new in ink, lapsed faded back. */
const PAYER_TONE: Record<PayerChain["status"], string> = {
  returning: "var(--viz-up)",
  new: "var(--foreground)",
  lapsed: "var(--muted-foreground)",
};

/** One mark, three states, used by the status, the invoice strip and the
 * legend: filled is an invoice paid, outlined the next one due, dashed one
 * that never came. */
function Mark({ status, kind = "paid" }: { status: PayerChain["status"]; kind?: "paid" | "due" | "missed" }) {
  const tone = PAYER_TONE[status];
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0", kind !== "paid" && "border", kind === "missed" && "border-dashed")}
      style={kind === "paid" ? { background: tone } : { borderColor: tone }}
    />
  );
}

/** The status as its mark and word, never colour alone. */
function PayerStatus({ status }: { status: PayerChain["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color: status === "lapsed" ? undefined : PAYER_TONE[status] }}>
      <Mark status={status} kind={status === "lapsed" ? "missed" : "paid"} />
      {status}
    </span>
  );
}

/** Invoices as a strip: one square per invoice paid, then the next one,
 * outlined while it is due and dashed once it was missed. */
function InvoiceStrip({ chain }: { chain: PayerChain }) {
  const shown = Math.min(chain.invoices, 8);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="flex gap-0.5">
        {Array.from({ length: shown }, (_, i) => (
          <Mark key={i} status={chain.status} />
        ))}
        <Mark status={chain.status} kind={chain.status === "lapsed" ? "missed" : "due"} />
      </span>
      <span className="w-4">{fmtNum(chain.invoices)}</span>
    </span>
  );
}

const WEEK = 7 * 86_400_000;

function PayerRow({ chain, short }: { chain: PayerChain; short: (name: string) => string }) {
  const lapsed = chain.status === "lapsed";
  const dueSoon = !lapsed && Date.parse(chain.nextDueAt) - Date.now() < WEEK;
  return (
    <TableRow className={cn(lapsed && "text-muted-foreground")}>
      <TableCell numeric className="text-muted-foreground max-sm:hidden">{chain.rank}</TableCell>
      <TableRowHead className="max-w-64 max-sm:pl-0" title={chain.templateName}>
        <div className={cn("truncate", !lapsed && "font-medium", PSEUDO_TEMPLATE_IDS.has(chain.templateId) && "text-muted-foreground")}>
          {short(chain.templateName)}
        </div>
        {/* A phone shows only template and total; status and the latest invoice, which the rows sort by, ride here. */}
        <div className="text-xs text-muted-foreground sm:hidden">
          <PayerStatus status={chain.status} /> · last {fmtDate(new Date(chain.lastAt))}
        </div>
      </TableRowHead>
      <TableCell className="max-sm:hidden">
        <PayerStatus status={chain.status} />
      </TableCell>
      <DateCell iso={chain.firstAt} className="max-sm:hidden" />
      <DateCell iso={chain.lastAt} className="max-sm:hidden" />
      {lapsed ? (
        <TableCell className="max-sm:hidden">—</TableCell>
      ) : (
        // Due within the week: money about to land, so it reads at full ink.
        <DateCell iso={chain.nextDueAt} className={cn("max-sm:hidden", dueSoon ? "font-medium text-foreground" : "text-muted-foreground")} />
      )}
      <TableCell numeric className="max-sm:hidden">
        <InvoiceStrip chain={chain} />
      </TableCell>
      <TableCell numeric className="max-sm:hidden">{fmtCents(chain.lastCents)}</TableCell>
      <TableCell numeric className={cn(!lapsed && "font-medium")}>{fmtCents(chain.totalCents)}</TableCell>
    </TableRow>
  );
}

/** The range's withdrawals to a bank or card, the one part of the old
 * ledger the payers don't carry. Completed ones read as plain text; pending
 * and failed ones carry their status. */
function Withdrawals({ rows, days }: { rows: Payout[]; days: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      {rows.length === 0 ? (
        <>No withdrawals in the last <Fig>{days}</Fig> days.</>
      ) : (
        <>
          Withdrawn in the last <Fig>{days}</Fig> days:{" "}
          {rows.map((p, i) => (
            <span key={p.id} className="inline-flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <span aria-hidden className="mx-1">·</span>}
              <span title={`${timeFmt.format(new Date(p.createdAt))} (${utcFmt.format(new Date(p.createdAt))} UTC)`}>
                {fmtDate(new Date(p.createdAt))}
              </span>
              <Fig>{fmtCents(p.amountCents)}</Fig>
              to {p.destination}
              {p.status !== "COMPLETED" && <PayoutStatus status={p.status} />}
            </span>
          ))}
        </>
      )}
    </p>
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
