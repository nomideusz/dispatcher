import { type ReactNode, useMemo } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, Tip, tick } from "~/components/chart-kit";
import { Section } from "~/components/page";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { fmtNum, fmtUsd } from "~/lib/format";
import { KINDS, ORIGINS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";

const DAY = 86_400_000;
/** A first invoice can take a month to arrive, so by this age a template has
 * had a fair chance to show use. */
export const FAIR_CHANCE_DAYS = 45;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Whole days from publishing to the first kickback; null if it never paid. */
export const daysToPay = (t: TimelineTemplate) =>
  t.publishedAt && t.firstPaidAt
    ? Math.max(0, Math.floor((Date.parse(t.firstPaidAt) - Date.parse(t.publishedAt)) / DAY))
    : null;

export type Life = { age: number; paid: number | null };
export const lifeOf = (t: TimelineTemplate, now: number): Life | null =>
  t.publishedAt ? { age: Math.floor((now - Date.parse(t.publishedAt)) / DAY), paid: daysToPay(t) } : null;

/** Share paid by each day 0..last after publishing, Kaplan–Meier: each
 * day's payers over the templates still unpaid and at least that old, so a
 * young template that already paid counts now instead of once it ages past
 * the day. n is how many are that old; under min the share is null. */
export function paidCurve(life: Life[], last: number, min = 5) {
  let unpaid = 1;
  return Array.from({ length: last + 1 }, (_, day) => {
    const old = life.filter((l) => l.age >= day);
    const atRisk = old.filter((l) => l.paid == null || l.paid >= day).length;
    if (atRisk > 0) unpaid *= 1 - old.filter((l) => l.paid === day).length / atRisk;
    return { share: old.length < min ? null : 1 - unpaid, n: old.length };
  });
}

function useWhatToPublish(data: TimelineResponse) {
  return useMemo(() => {
    const { templates } = data;
    // Share paid by each day after publishing, over the templates' whole life.
    // A group's line stops once fewer than 15 templates are that old: past
    // that one payer moves it 7+ points.
    const now = Date.parse(data.sampledAt);
    const byGroup = GROUPS.map((_, g) =>
      paidCurve(templates.filter((t) => groupOf(t) === g).flatMap((t) => lifeOf(t, now) ?? []), 90, 15),
    );
    const curve = byGroup[0]
      .map((_, day) => {
        const row: Record<string, number | null> = { day };
        byGroup.forEach((c, g) => {
          row[`g${g}`] = c[day].share;
          row[`n${g}`] = c[day].n;
        });
        return row;
      })
      .filter((r) => r.g0 != null || r.g1 != null || r.g2 != null);
    return { curve, ...segmentsOf(data) };
  }, [data]);
}

/** The catalog cut by kind, size and origin. */
export function segmentsOf(data: TimelineResponse) {
  const { templates } = data;
  const now = Date.parse(data.sampledAt);
  const kindOrder = (k: string) => (k === "" ? KINDS.length : KINDS.findIndex((x) => x.key === k));
  const seg = (keyOf: (t: TimelineTemplate) => string) => segment(templates, keyOf, now);
  return {
    byKind: seg((t) => t.kind).sort((a, b) => kindOrder(a.key) - kindOrder(b.key)),
    bySize: seg((t) => String(groupOf(t))),
    byOrigin: seg((t) => t.origin),
  };
}

export const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? "Unsorted";
export const sizeLabel = (k: string) => GROUPS[Number(k)].label;

/** The segment whose typical template pays most in its first 45 days; typical
 * leaves out the top earner, so one hit (Twenty) doesn't set the verdict. */
export function best(rows: Segment[], skip?: string) {
  const fair = rows.filter((r): r is Segment & { typical: number } => r.typical != null && r.key !== skip);
  return fair.length ? fair.reduce((a, b) => (b.typical > a.typical ? b : a)) : null;
}

/** How soon a new template starts paying, by size. */
export function PaidBySize({ data }: { data: TimelineResponse }) {
  const { curve } = useWhatToPublish(data);
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">How soon a new one pays, by size</h3>
      <Key items={GROUPS.map((g) => ({ label: g.label, color: g.color, line: true }))} />
      <ChartContainer config={{}} className="aspect-auto h-56 w-full lg:h-64">
        <LineChart aria-label="Share of templates paid within days of publishing, by size" data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" {...tick} tickMargin={8} tickFormatter={(d) => `Day ${d}`} minTickGap={32} />
          <YAxis width={44} {...tick} tickCount={3} domain={[0, "auto"]} tickFormatter={pct} />
          <Tooltip
            isAnimationActive={false}
            cursor={cursor}
            content={(p) => (
              <Tip
                {...p}
                title={(l) => `${l} days after publishing`}
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
        a line stops where fewer than 15 are that old. Where it flattens, waiting longer doesn&apos;t help.
      </p>
    </section>
  );
}

/** What earns: kind, origin and size against the typical template's first 45 days. */
export function Segments({ data }: { data: TimelineResponse }) {
  const { byKind, bySize, byOrigin } = useWhatToPublish(data);
  return (
    <Section
      id="segments"
      title="What earns"
      text="Kind, origin and size against what a typical template of each brings in over its first 45 days, best-paying first. Point at a column name for what it counts; set kind and origin under a template's name on Templates."
    >
      {/* What a template is on the left, its origin and shape on the right;
          each table under its own heading so short ones don't read as
          more rows of the one above. */}
      <div className="grid gap-x-8 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Block title="What it's for">
            <SegmentTable title="Kind" rows={byKind} format={kindLabel} />
          </Block>
        </div>
        <div className="space-y-8 max-xl:mt-8 max-xl:border-t max-xl:pt-6 xl:col-span-5 xl:border-l xl:pl-8">
          <Block title="Original or competitive">
            <SegmentTable title="Origin" rows={byOrigin} format={(k) => ORIGINS.find((x) => x.key === k)?.label ?? "Unsorted"} />
          </Block>
          <Block title="How many services">
            <SegmentTable
              title="Services"
              rows={bySize}
              format={(k) => (
                <span className="flex items-center gap-1.5">
                  <span className="size-2" style={{ background: GROUPS[Number(k)].color }} />
                  {sizeLabel(k)}
                </span>
              )}
            />
          </Block>
        </div>
      </div>
    </Section>
  );
}

export type Segment = {
  key: string;
  templates: number;
  earning: number;
  running: number;
  earned: number;
  /** Templates at least FAIR_CHANCE_DAYS old, the ones typical averages. */
  mature: number;
  /** Mean kickback in a template's first FAIR_CHANCE_DAYS, over the mature
   * ones less the top earner; null under MIN_MATURE. Every template is read
   * over the same days of its own life, so an old one's repeat invoices
   * don't count for it what a young one hasn't had time to collect. */
  typical: number | null;
  top: { name: string; earned: number } | null;
  /** Share paid within 30 days of publishing, by paidCurve. */
  paid30: number | null;
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

function segment(templates: TimelineTemplate[], keyOf: (t: TimelineTemplate) => string, now: number): Segment[] {
  const mature = (t: TimelineTemplate) => !!t.publishedAt && (now - Date.parse(t.publishedAt)) / DAY >= FAIR_CHANCE_DAYS;
  const by = new Map<string, TimelineTemplate[]>();
  for (const t of templates) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  return [...by.entries()]
    .map(([key, ts]) => {
      const earned = ts.reduce((s, t) => s + (t.earned30d ?? 0), 0);
      const hit = ts.reduce((a, b) => ((b.earned30d ?? 0) > (a.earned30d ?? 0) ? b : a));
      const firsts = ts.filter(mature).map(firstDays).sort((a, b) => b - a);
      const rest = firsts.slice(1);
      return {
        key,
        templates: ts.length,
        earning: ts.filter((t) => (t.earned30d ?? 0) > 0).length,
        running: ts.reduce((s, t) => s + (t.running ?? 0), 0),
        earned,
        mature: firsts.length,
        typical: firsts.length >= MIN_MATURE ? rest.reduce((s, v) => s + v, 0) / rest.length : null,
        top: (hit.earned30d ?? 0) > 0 ? { name: hit.name.split(" | ")[0], earned: hit.earned30d ?? 0 } : null,
        paid30: paidCurve(ts.flatMap((t) => lifeOf(t, now) ?? []), 30)[30].share,
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

type SegmentKey = "key" | "earning" | "earned" | "per" | "paid30";

/** Five columns, the per-template rate first: the row's top earner shows
 * under its name only when it is most of the row (75%+); most rows lean on
 * one hit, so a lower bar puts a second line on nearly all of them. */
function SegmentTable({
  title,
  rows,
  format,
  by = "per",
}: {
  title: string;
  rows: Segment[];
  format: (key: string) => ReactNode;
  /** Months read in order; everything else best-paying first. */
  by?: SegmentKey;
}) {
  const best = Math.max(0, ...rows.map((r) => r.typical ?? 0));
  const order = new Map(rows.map((r, i) => [r.key, i]));
  const { rows: sorted, head } = useSort(
    rows,
    (r, key: SegmentKey) =>
      ({
        key: order.get(r.key),
        earning: r.earning / r.templates,
        earned: r.earned,
        per: r.typical,
        paid30: r.paid30,
      })[key],
    by,
    ["key"],
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {/* One name width, so stacked tables line their columns up. */}
          {head("key", title, { className: "sm:w-44" })}
          {head("per", "First 45d", { hint: "Typical kickback in a template's first 45 days, over templates at least that old, the row's top earner left out; blank under three that old" })}
          {head("paid30", "Paid by 30d", { numeric: true, hint: "Share that earned within 30 days of publishing; blank under five templates that old" })}
          {head("earned", "30d", { numeric: true, hint: "All kickback in the last 30 days", className: "max-sm:hidden" })}
          {head("earning", "Earning", { numeric: true, hint: "Templates that earned in the last 30 days, of all in the row", className: "max-sm:hidden" })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const carried = r.top && r.top.earned / r.earned >= 0.75 && r.templates > 1;
          return (
            <TableRow key={r.key}>
              <TableRowHead>
                <div className="whitespace-nowrap">{format(r.key)}</div>
                {carried && (
                  <div className="max-w-48 truncate text-xs text-muted-foreground" title={r.top!.name}>
                    {r.top!.name} <span className="tabular-nums">{pct(r.top!.earned / r.earned)}</span> of 30d
                  </div>
                )}
              </TableRowHead>
              <TableCell className="w-[40%]">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-right tabular-nums">{r.typical == null ? "—" : fmtUsd(r.typical)}</span>
                  <TableMeter value={best > 0 && r.typical != null ? r.typical / best : 0} className="w-auto min-w-10 flex-1" />
                </div>
              </TableCell>
              <TableCell numeric className="text-muted-foreground">{r.paid30 == null ? "—" : pct(r.paid30)}</TableCell>
              <TableCell numeric className="max-sm:hidden">{fmtUsd(r.earned)}</TableCell>
              <TableCell numeric className="text-muted-foreground max-sm:hidden">
                {fmtNum(r.earning)}/{fmtNum(r.templates)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
