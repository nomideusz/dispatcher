import { type ReactNode, useMemo } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, shareTop, Tip, tick } from "~/components/chart-kit";
import { DOCKET, DocketCell, Fig, Section } from "~/components/page";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHeader, TableMeter, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { DAY, EDGE_CODE, earned30, FAIR_CHANCE_DAYS, inUse, lifeOf, notTakenUp, paidCurve, payerStats } from "~/lib/catalog";
import { fmtNum, fmtUsd, shortName } from "~/lib/format";
import { cn } from "~/lib/utils";
import { KINDS, ORIGINS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";
import type { PayerChain } from "~/queries/payouts";

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** The size chart runs this far; past it only the oldest templates are left. */
const SIZE_DAYS = 90;
/** A size's line stops once fewer templates than this are that old: past
 * that one payer moves it 7+ points. */
const MIN_SIZE = 15;

/** The catalog cut by kind, size and origin. Payers add who pays in each;
 * without them those columns are empty. */
export function segmentsOf(data: TimelineResponse, payers: PayerChain[] = []) {
  const { templates } = data;
  const now = Date.parse(data.sampledAt);
  const kindOrder = (k: string) => (k === "" ? KINDS.length : KINDS.findIndex((x) => x.key === k));
  const seg = (keyOf: (t: TimelineTemplate) => string) => segment(templates, keyOf, now, payers);
  return {
    byKind: seg((t) => t.kind).sort((a, b) => kindOrder(a.key) - kindOrder(b.key)),
    bySize: seg((t) => String(groupOf(t))),
    byOrigin: seg((t) => t.origin),
  };
}

export const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? "Unsorted";
export const sizeLabel = (k: string) => GROUPS[Number(k)].label;
const originLabel = (k: string) => ORIGINS.find((x) => x.key === k)?.label ?? "Unsorted";

/** The segment whose typical template pays most in its first 45 days; typical
 * leaves out the top earner, so one hit (Twenty) doesn't set the verdict. */
export function best(rows: Segment[], skip?: string) {
  const fair = rows.filter((r): r is Segment & { typical: number } => r.typical != null && r.key !== skip);
  return fair.length ? fair.reduce((a, b) => (b.typical > a.typical ? b : a)) : null;
}

/** How soon a new template starts paying, by size. */
export function PaidBySize({ data }: { data: TimelineResponse }) {
  const curve = useMemo(() => {
    const now = Date.parse(data.sampledAt);
    const byGroup = GROUPS.map((_, g) =>
      paidCurve(data.templates.filter((t) => groupOf(t) === g).flatMap((t) => lifeOf(t, now) ?? []), SIZE_DAYS, MIN_SIZE),
    );
    return byGroup[0]
      .map((_, day) => {
        const row: Record<string, number | null> = { day };
        byGroup.forEach((c, g) => {
          row[`g${g}`] = c[day].share;
          row[`n${g}`] = c[day].n;
        });
        return row;
      })
      .filter((r) => GROUPS.some((_, g) => r[`g${g}`] != null));
  }, [data]);
  const last = curve.length ? (curve[curve.length - 1].day as number) : 0;
  const reach = (g: number) => [...curve].reverse().find((r) => r[`g${g}`] != null);
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">How soon a new one pays, by size</h3>
      <Key
        items={GROUPS.map((g, i) => {
          const r = reach(i);
          return {
            label: g.label,
            color: g.color,
            line: true,
            value: r ? (
              <>
                {pct(r[`g${i}`]!)}
                <span className="font-sans font-normal text-muted-foreground"> by day {r.day}</span>
              </>
            ) : undefined,
          };
        })}
      />
      <ChartContainer config={{}} className="aspect-auto h-56 w-full lg:h-64">
        <LineChart aria-label="Share of templates paid within days of publishing, by size" data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            type="number"
            domain={[0, last]}
            ticks={Array.from({ length: Math.floor(last / 15) + 1 }, (_, i) => i * 15)}
            {...tick}
            tickMargin={6}
            tickFormatter={(d) => `Day ${d}`}
          />
          <YAxis width={44} {...tick} tickCount={4} domain={[0, shareTop]} tickFormatter={pct} />
          <Tooltip
            isAnimationActive={false}
            cursor={cursor}
            content={(p) => (
              <Tip
                {...p}
                title={(l) => `Day ${l} after publishing`}
                format={(v, k) => `${pct(v)} paid · of ${p.payload?.[0]?.payload?.[`n${k.slice(1)}`]}`}
              />
            )}
          />
          {GROUPS.map((g, i) => (
            <Line key={g.label} name={g.label} type="stepAfter" dataKey={`g${i}`} stroke={g.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Share of templates that have paid anything, by days since publishing. Young templates count for the days they&apos;ve been live;
        a line stops where fewer than {MIN_SIZE} are that old, and the key reads its last day. Where it flattens, waiting longer doesn&apos;t help.
      </p>
    </section>
  );
}

/** What earns: each kind, size and origin from use to money. */
export function Segments({ data, payers }: { data: TimelineResponse; payers: PayerChain[] }) {
  const { byKind, bySize, byOrigin } = useMemo(() => segmentsOf(data, payers), [data, payers]);
  const edge = data.templates.find((t) => t.code === EDGE_CODE);
  return (
    <Section
      id="segments"
      title="What earns"
      text="Each kind, size and origin from use to money: who runs it, who pays, what an invoice is worth and whether the payer comes back. Point at a column name for what it counts; set kind and origin under a template's name on Templates."
    >
      {/* One table per cut, each under its own heading and all on the same
          columns, so a figure sits in the same place in every one. */}
      <div className="space-y-8">
        <Block title="What it's for">
          <SegmentTable title="Kind" rows={byKind} label={kindLabel} />
        </Block>
        <Block title="How many services">
          <SegmentTable title="Services" rows={bySize} label={sizeLabel} swatch={(k) => GROUPS[Number(k)].color} />
        </Block>
        <Block title="Original or competitive">
          <SegmentTable title="Origin" rows={byOrigin} label={originLabel} />
        </Block>
      </div>
      <p className="text-xs text-muted-foreground">
        Running counts every instance, whether or not its deployer is ever invoiced, so a row can hold most of the use and
        little of the kickback. Per instance is the figure that says how much of a row&apos;s use pays.
        {edge?.running ? (
          <>
            {" "}Running leaves out {shortName(edge.name)}&apos;s <Fig>{fmtNum(edge.running)}</Fig>, a surge that has yet to earn.
          </>
        ) : null}
      </p>
    </Section>
  );
}

/** Do payers stay: how often an invoice is followed by the next, and what
 * one is worth. The per-row rates sit in the segment tables above. */
export function Payers({ payers }: { payers: PayerChain[] }) {
  const s = payerStats(payers);
  const last = payers
    .filter((p) => p.status !== "lapsed")
    .map((p) => p.lastCents / 100)
    .sort((a, b) => a - b);
  const sum = last.reduce((a, b) => a + b, 0);
  const top = last.slice(-5).reduce((a, b) => a + b, 0);
  return (
    <Section
      id="payers"
      title="Do payers stay?"
      text="Kickback repeats only while a deployer keeps paying Railway for the project. How often one invoice is followed by the next, and what an invoice is worth."
    >
      <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
        <DocketCell small label="Paying now" value={fmtNum(s.active)}>
          of <Fig>{fmtNum(s.payers)}</Fig> deployers who ever paid; <Fig>{fmtNum(s.payers - s.active)}</Fig> lapsed
        </DocketCell>
        <DocketCell small label="Pay a second invoice" value={s.due ? pct(s.returned / s.due) : "—"}>
          <Fig>{fmtNum(s.returned)}</Fig> of the <Fig>{fmtNum(s.due)}</Fig> whose second fell due
        </DocketCell>
        <DocketCell small label="Then keep paying" value={s.keptDue ? pct(s.kept / s.keptDue) : "—"}>
          <Fig>{fmtNum(s.kept)}</Fig> of the <Fig>{fmtNum(s.keptDue)}</Fig> later invoices that fell due were paid
        </DocketCell>
        <DocketCell small label="A typical invoice" value={last.length ? fmtUsd(last[Math.floor(last.length / 2)]) : "—"}>
          kickback, the median of what each payer last paid
          {sum > 0 && last.length > 5 && (
            <>
              ; the <Fig>5</Fig> biggest are <Fig>{pct(top / sum)}</Fig> of the total
            </>
          )}
        </DocketCell>
      </div>
      <p className="text-xs text-muted-foreground">
        A payer is one deployer&apos;s run of invoices for one template, a month apart; Railway doesn&apos;t name them.
        {s.due > 0 && s.keptDue > 0 && s.kept / s.keptDue > s.returned / s.due + 0.15 &&
          " The first month decides: a deployer who pays twice mostly keeps paying, so a kind whose payers come back is worth more than its first invoices show."}
        {" "}Come back in the tables above is the second-invoice rate for each row.
      </p>
    </Section>
  );
}

export type Segment = {
  key: string;
  templates: number;
  earning: number;
  /** Running instances, Edge's surge left out. */
  running: number;
  earned: number;
  /** Templates at least FAIR_CHANCE_DAYS old, the ones typical averages. */
  mature: number;
  /** Of the mature ones, those with nothing running and nothing earned. */
  dead: number;
  /** Mean kickback in a template's first FAIR_CHANCE_DAYS, over the mature
   * ones less the top earner; null under MIN_MATURE. Every template is read
   * over the same days of its own life, so an old one's repeat invoices
   * don't count for it what a young one hasn't had time to collect. */
  typical: number | null;
  top: { name: string; earned: number } | null;
  /** Share paid within 30 days of publishing, by paidCurve. */
  paid30: number | null;
  /** Payers not lapsed, mean kickback per invoice, and how many of the
   * payers whose second invoice fell due paid it. */
  paying: number;
  perInvoice: number | null;
  returned: number;
  due: number;
};

/** Under this many templates old enough, a row has no typical figure. */
const MIN_MATURE = 3;

/** Kickback in a template's first FAIR_CHANCE_DAYS, from its daily activity
 * (which needs the whole-life timeline, days=0). */
const firstDays = (t: TimelineTemplate) => {
  const pub = Date.parse(`${t.publishedAt!.slice(0, 10)}T00:00:00Z`);
  return t.activity.reduce(
    (n, a) => ((Date.parse(`${a.date}T00:00:00Z`) - pub) / DAY < FAIR_CHANCE_DAYS ? n + a.earnedCents / 100 : n),
    0,
  );
};

function segment(templates: TimelineTemplate[], keyOf: (t: TimelineTemplate) => string, now: number, payers: PayerChain[]): Segment[] {
  const mature = (t: TimelineTemplate) => !!t.publishedAt && (now - Date.parse(t.publishedAt)) / DAY >= FAIR_CHANCE_DAYS;
  const by = new Map<string, TimelineTemplate[]>();
  for (const t of templates) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  return [...by.entries()]
    .map(([key, ts]) => {
      const earned = ts.reduce((s, t) => s + earned30(t), 0);
      const hit = ts.reduce((a, b) => (earned30(b) > earned30(a) ? b : a));
      const old = ts.filter(mature);
      const firsts = old.map(firstDays).sort((a, b) => b - a);
      const rest = firsts.slice(1);
      const ids = new Set(ts.map((t) => t.templateId));
      const p = payerStats(payers.filter((c) => ids.has(c.templateId)));
      return {
        key,
        templates: ts.length,
        earning: ts.filter((t) => earned30(t) > 0).length,
        running: ts.reduce((s, t) => s + inUse(t), 0),
        earned,
        mature: old.length,
        dead: old.filter((t) => notTakenUp(t, now)).length,
        typical: firsts.length >= MIN_MATURE ? rest.reduce((s, v) => s + v, 0) / rest.length : null,
        top: earned30(hit) > 0 ? { name: shortName(hit.name), earned: earned30(hit) } : null,
        paid30: paidCurve(ts.flatMap((t) => lifeOf(t, now) ?? []), 30)[30].share,
        paying: p.active,
        perInvoice: p.perInvoice,
        returned: p.returned,
        due: p.due,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** A titled sub-block inside a section (DESIGN.md: subtitle, 16px 600). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** The row that holds the most use for the least money against the one that
 * does the reverse, when the gap is wide enough to act on. */
function readout(rows: Segment[], label: (key: string) => string) {
  const use = rows.reduce((s, r) => s + r.running, 0);
  const money = rows.reduce((s, r) => s + r.earned, 0);
  if (rows.length < 2 || use === 0 || money === 0) return null;
  const gap = (r: Segment) => r.running / use - r.earned / money;
  const idle = rows.reduce((a, b) => (gap(b) > gap(a) ? b : a));
  const paying = rows.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  if (gap(idle) < 0.1) return null;
  const shares = (r: Segment) => (
    <>
      {label(r.key)}: <Fig>{pct(r.running / use)}</Fig> of the running instances, <Fig>{pct(r.earned / money)}</Fig> of the kickback
    </>
  );
  return (
    <>
      {shares(idle)}. {shares(paying)}.
    </>
  );
}

type SegmentKey = "key" | "earned" | "earning" | "running" | "perRun" | "paying" | "perInvoice" | "back" | "paid30" | "per" | "dead";

/** One cut of the catalog, money first, then the path to it: templates,
 * running instances, what an instance brings, payers, their invoice and
 * whether they come back, then what a new template of the row does early
 * and how many nobody took up. The row's top earner shows under its name
 * only when it is most of the row (75%+); most rows lean on one hit, so a
 * lower bar puts a second line on nearly all of them. */
function SegmentTable({
  title,
  rows,
  label,
  swatch,
}: {
  title: string;
  rows: Segment[];
  label: (key: string) => string;
  swatch?: (key: string) => string;
}) {
  const maxEarned = Math.max(0, ...rows.map((r) => r.earned));
  const maxRunning = Math.max(0, ...rows.map((r) => r.running));
  const order = new Map(rows.map((r, i) => [r.key, i]));
  const { rows: sorted, head } = useSort(
    rows,
    (r, key: SegmentKey) =>
      ({
        key: order.get(r.key),
        earned: r.earned,
        earning: r.earning / r.templates,
        running: r.running,
        perRun: r.running > 0 ? r.earned / r.running : null,
        paying: r.paying,
        perInvoice: r.perInvoice,
        back: r.due > 0 ? r.returned / r.due : null,
        paid30: r.paid30,
        per: r.typical,
        dead: r.mature > 0 ? r.dead / r.mature : null,
      })[key],
    "earned",
    ["key"],
  );
  const line = readout(rows, label);
  const few = "max-sm:hidden";
  return (
    <div className="space-y-2">
      {/* Fixed layout from sm, so the three tables line their columns up. */}
      <Table className="min-w-[36rem] sm:min-w-[72rem] sm:table-fixed">
        <TableHeader>
          <TableRow>
            {head("key", title, { className: "sm:w-52" })}
            {head("earned", "Kickback 30d", { hint: "All kickback in the last 30 days", className: "sm:w-[15%]" })}
            {head("earning", "Earning", { numeric: true, hint: "Templates that earned in the last 30 days, of all in the row" })}
            {head("running", "Running", { hint: "Service instances running now, whoever deployed them", className: "sm:w-[13%]" })}
            {head("perRun", "Per instance", { numeric: true, hint: "Kickback in the last 30 days for each running instance: how much of the use pays" })}
            {head("paying", "Paying", { numeric: true, hint: "Deployers with an invoice in their current billing month", className: few })}
            {head("perInvoice", "Per invoice", { numeric: true, hint: "Average kickback from one monthly invoice, all time", className: few })}
            {head("back", "Come back", { numeric: true, hint: "Payers who paid a second invoice, of those whose second fell due" })}
            {head("paid30", "Paid by 30d", { numeric: true, hint: "Share of templates that earned within 30 days of publishing; blank under five templates that old", className: few })}
            {head("per", "First 45d", { numeric: true, hint: "Typical kickback in a template's first 45 days, over templates at least that old, the row's top earner left out; blank under three that old", className: few })}
            {head("dead", "Not taken up", { numeric: true, hint: "Templates 45+ days old with nothing running and nothing earned, of all that old", className: few })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const carried = r.top && r.top.earned / r.earned >= 0.75 && r.templates > 1;
            return (
              <TableRow key={r.key}>
                <TableRowHead>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {swatch && <span className="size-2" style={{ background: swatch(r.key) }} />}
                    {label(r.key)}
                  </div>
                  {carried && (
                    <div className="truncate text-xs text-muted-foreground" title={r.top!.name}>
                      {r.top!.name} <span className="tabular-nums">{pct(r.top!.earned / r.earned)}</span> of 30d
                    </div>
                  )}
                </TableRowHead>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-right tabular-nums">{fmtUsd(r.earned)}</span>
                    <TableMeter value={maxEarned > 0 ? r.earned / maxEarned : 0} className="w-auto min-w-6 flex-1" />
                  </div>
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmtNum(r.earning)}/{fmtNum(r.templates)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-right tabular-nums">{fmtNum(r.running)}</span>
                    <TableMeter value={maxRunning > 0 ? r.running / maxRunning : 0} color="var(--chart-other)" className="w-auto min-w-6 flex-1" />
                  </div>
                </TableCell>
                <TableCell numeric>{r.running > 0 ? fmtUsd(r.earned / r.running) : "—"}</TableCell>
                <TableCell numeric className={few}>{fmtNum(r.paying)}</TableCell>
                <TableCell numeric className={few}>{r.perInvoice == null ? "—" : fmtUsd(r.perInvoice)}</TableCell>
                <TableCell numeric>
                  {r.due > 0 ? (
                    <>
                      {pct(r.returned / r.due)}
                      <span className="text-xs text-muted-foreground"> {fmtNum(r.returned)}/{fmtNum(r.due)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell numeric className={cn("text-muted-foreground", few)}>{r.paid30 == null ? "—" : pct(r.paid30)}</TableCell>
                <TableCell numeric className={few}>{r.typical == null ? "—" : fmtUsd(r.typical)}</TableCell>
                <TableCell numeric className={cn(r.dead === 0 && "text-muted-foreground", few)}>
                  {r.mature > 0 ? `${fmtNum(r.dead)}/${fmtNum(r.mature)}` : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {line && <p className="text-sm">{line}</p>}
    </div>
  );
}
