import { useMemo } from "react";
import { GROUPS, groupOf } from "~/components/chart-kit";
import { DOCKET, DocketCell, Fig } from "~/components/page";
import { daysToPay, lifeOf, paidCurve } from "~/lib/catalog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { fmtCents, fmtNum } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { TimelineResponse } from "~/queries/analytics";
import type { PayerChain } from "~/queries/payouts";

const DAY = 86_400_000;
const H = 30;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ratio = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0);

/** Kickback over the next 30 days, in three parts:
 * - payers due again, each weighted by how often a payer at that step renews;
 * - new payers on templates that already pay, at the last 30 days' rate;
 * - templates yet to pay: per service group, the chance each one starts
 *   within 30 days at its age (Kaplan–Meier, as on Patterns), times what
 *   the last 30 days' first-time templates brought in each.
 * ponytail: rates are pooled across templates and the last 30 days stand in
 * for the next; per-template renewal odds if the total keeps missing. */
function useForecast(data: TimelineResponse, payers: PayerChain[]) {
  return useMemo(() => {
    const now = Date.parse(data.sampledAt);
    const monthAgo = now - H * DAY;
    const firstPaid = new Map(data.templates.map((t) => [t.templateId, t.firstPaidAt ? Date.parse(t.firstPaidAt) : null]));

    // A step's renewal rate: chains that made it past it over those plus the
    // ones that lapsed at it.
    const first = ratio(
      payers.filter((p) => p.invoices >= 2).length,
      payers.filter((p) => p.invoices === 1 && p.status === "lapsed").length,
    );
    const keep = ratio(
      payers.reduce((s, p) => s + Math.max(0, p.invoices - 2), 0),
      payers.filter((p) => p.invoices >= 2 && p.status === "lapsed").length,
    );
    const due = payers.filter((p) => p.status !== "lapsed" && Date.parse(p.nextDueAt) <= now + H * DAY);
    const existing = due.reduce((s, p) => s + p.lastCents * (p.invoices >= 2 ? keep : first), 0);

    // New chains of the last 30 days: on a template that had paid before, or
    // the template's first.
    const fresh = payers.filter((p) => Date.parse(p.firstAt) >= monthAgo);
    const onPaying = fresh.filter((p) => (firstPaid.get(p.templateId) ?? Infinity) < Date.parse(p.firstAt));
    const newPayers = onPaying.reduce((s, p) => s + p.totalCents, 0);
    const starterCents = fresh.reduce((s, p) => s + p.totalCents, 0) - newPayers;
    const starters = data.templates.filter((t) => t.firstPaidAt && Date.parse(t.firstPaidAt) >= monthAgo).length;
    const perStarter = starters > 0 ? starterCents / starters : 0;

    const groups = GROUPS.map((g, i) => {
      const ts = data.templates.filter((t) => groupOf(t) === i);
      const life = ts.flatMap((t) => lifeOf(t, now) ?? []);
      const curve = paidCurve(life, Math.max(0, ...life.map((l) => l.age)) + H);
      // Past the last day with enough templates (n only falls with the day),
      // assume nobody else pays.
      const thin = curve.findIndex((c) => c.share == null);
      const unpaidAt = (d: number) => 1 - (curve[thin < 0 ? d : Math.min(d, thin - 1)]?.share ?? 0);
      const unpaid = life.filter((l) => l.paid == null);
      const expected = unpaid.reduce((s, l) => {
        const now = unpaidAt(l.age);
        return s + (now > 0 ? (now - unpaidAt(l.age + H)) / now : 0);
      }, 0);
      const days = ts.flatMap((t) => daysToPay(t) ?? []).sort((a, b) => a - b);
      return {
        label: g.label,
        templates: ts.length,
        unpaid: unpaid.length,
        paid30: curve[H]?.share ?? null,
        medianDays: days.length ? days[Math.floor(days.length / 2)] : null,
        expected,
        cents: expected * perStarter,
      };
    });
    const expected = groups.reduce((s, g) => s + g.expected, 0);
    const later = expected * perStarter;
    return {
      first, keep, due: due.length, existing,
      onPaying: onPaying.length, newPayers,
      starters, perStarter, expected, later, groups,
      total: existing + newPayers + later,
    };
  }, [data, payers]);
}

export function Forecast({ data, payers }: { data: TimelineResponse; payers: PayerChain[] }) {
  const f = useForecast(data, payers);
  return (
    <div className="space-y-4">
      <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
        <DocketCell label="Next 30 days" value={`~${fmtCents(f.total)}`} small>
          rough; the last 30 days stand in for the next
        </DocketCell>
        <DocketCell label="Payers due again" value={fmtCents(f.existing)} small>
          <Fig>{f.due}</Fig> due; first payers renew {pct(f.first)}, returning {pct(f.keep)}
        </DocketCell>
        <DocketCell label="New payers, paying templates" value={fmtCents(f.newPayers)} small>
          <Fig>{f.onPaying}</Fig> joined in the last 30 days
        </DocketCell>
        <DocketCell label="Templates yet to pay" value={fmtCents(f.later)} small>
          ~<Fig>{f.expected.toFixed(0)}</Fig> start (<Fig>{f.starters}</Fig> did last 30 days), {fmtCents(f.perStarter)} each
        </DocketCell>
      </div>
      <Table className="sm:min-w-[34rem] lg:max-w-4xl">
        <TableHeader>
          <TableRow>
            <TableHead>Size</TableHead>
            <TableHead className="text-right max-sm:hidden">Templates</TableHead>
            <TableHead className="text-right">Unpaid</TableHead>
            <TableHead className="text-right max-sm:hidden" title="Share paid within 30 days of publishing, young templates counted for the days they've been up">
              Paid by 30d
            </TableHead>
            <TableHead className="text-right max-sm:hidden" title="Median days from publishing to the first kickback, among templates that paid">
              Typical wait
            </TableHead>
            <TableHead className="text-right" title="Unpaid templates expected to pay for the first time within 30 days, at their age">
              Start next 30d
            </TableHead>
            <TableHead className="text-right">Worth</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {f.groups.map((g) => (
            <TableRow key={g.label}>
              <TableRowHead className="whitespace-nowrap">{g.label}</TableRowHead>
              <TableCell numeric className="max-sm:hidden">{fmtNum(g.templates)}</TableCell>
              <TableCell numeric>{fmtNum(g.unpaid)}</TableCell>
              <TableCell numeric className="max-sm:hidden">{g.paid30 == null ? "—" : pct(g.paid30)}</TableCell>
              <TableCell numeric className="max-sm:hidden">{g.medianDays == null ? "—" : `${g.medianDays}d`}</TableCell>
              <TableCell numeric>{g.expected.toFixed(1)}</TableCell>
              <TableCell numeric>{fmtCents(g.cents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
