import { type ReactNode, useMemo } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, perDay, Tip, tick } from "~/components/chart-kit";
import { Section } from "~/components/page";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { dayKey, fmtDay, fmtNum, fmtUsd } from "~/lib/format";
import { KINDS, ORIGINS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";

const DAY = 86_400_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

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
 * the day. n is how many are that old; under five the share is null. */
export function paidCurve(life: Life[], last: number) {
  let unpaid = 1;
  return Array.from({ length: last + 1 }, (_, day) => {
    const old = life.filter((l) => l.age >= day);
    const atRisk = old.filter((l) => l.paid == null || l.paid >= day).length;
    if (atRisk > 0) unpaid *= 1 - old.filter((l) => l.paid === day).length / atRisk;
    return { share: old.length < 5 ? null : 1 - unpaid, n: old.length };
  });
}

function useWhatToPublish(data: TimelineResponse) {
  return useMemo(() => {
    const { points, templates } = data;
    const index = new Map(points.map((p, i) => [p.date, i]));
    // Per group and day: templates published by then and that day's kickback,
    // so each line is what one template of that size brings in.
    const rows = points.map((p) => ({ date: p.date, n: [0, 0, 0], e: [0, 0, 0] }));
    for (const t of templates) {
      const g = groupOf(t);
      const pub = t.publishedAt ? dayKey(t.publishedAt) : null;
      for (const r of rows) if (pub && r.date >= pub) r.n[g]++;
      for (const a of t.activity) {
        const i = index.get(a.date);
        if (i != null) rows[i].e[g] += a.earnedCents / 100;
      }
    }
    const trend = rows.slice(6).map((r, k) => {
      const w = rows.slice(k, k + 7);
      const out: Record<string, number | string | null> = { date: r.date };
      GROUPS.forEach((_, g) => {
        out[`p${g}`] = r.n[g] > 0 ? w.reduce((s, x) => s + x.e[g], 0) / 7 / r.n[g] : null;
      });
      return out;
    });

    // Share paid by each day after publishing, over the templates' whole life
    // (the range picker does not apply). A group's line stops once fewer
    // than five templates are that old.
    const now = Date.parse(data.sampledAt);
    const byGroup = GROUPS.map((_, g) =>
      paidCurve(templates.filter((t) => groupOf(t) === g).flatMap((t) => lifeOf(t, now) ?? []), 90),
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

    const kindOrder = (k: string) => (k === "" ? KINDS.length : KINDS.findIndex((x) => x.key === k));
    const seg = (keyOf: (t: TimelineTemplate) => string) => segment(templates, keyOf, now);
    const byKind = seg((t) => t.kind).sort((a, b) => kindOrder(a.key) - kindOrder(b.key));
    const bySize = seg((t) => String(groupOf(t)));
    const byOrigin = seg((t) => t.origin);
    const byMonth = seg((t) => t.publishedAt?.slice(0, 7) ?? "unknown");
    return { trend, curve, byKind, bySize, byOrigin, byMonth };
  }, [data]);
}

/** The segment whose typical template pays most, among those with at least
 * three templates; typical leaves out the top earner, so one hit (Twenty)
 * doesn't set the verdict. */
function best(rows: Segment[], skip?: string) {
  const fair = rows.filter((r) => r.templates >= 3 && r.key !== skip);
  return fair.length ? fair.reduce((a, b) => (b.typical > a.typical ? b : a)) : null;
}

/** Template size and age against what they earn and how soon: the numbers
 * for deciding what to build next, opened by the decision itself. */
export function WhatToPublish({ data }: { data: TimelineResponse }) {
  const { trend, curve, byKind, bySize, byOrigin, byMonth } = useWhatToPublish(data);
  const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? "Unsorted";
  const per = (r: Segment) => perDay(r.typical);
  const topKind = best(byKind, "");
  const topSize = best(bySize);
  const lowKind = (() => {
    const fair = byKind.filter((r) => r.templates >= 3 && r.key !== "" && r !== topKind);
    return fair.length ? fair.reduce((a, b) => (b.typical < a.typical ? b : a)) : null;
  })();
  const key = <Key items={GROUPS.map((g) => ({ label: g.label, color: g.color, line: true }))} />;

  return (
    <>
      {topKind && topSize && (
        <p className="max-w-[75ch] text-lg leading-snug">
          <span className="font-semibold">
            Build {kindLabel(topKind.key)} templates with {GROUPS[Number(topSize.key)].label}.
          </span>{" "}
          <span className="text-muted-foreground">
            Per 30 days live, a typical {kindLabel(topKind.key)} template paid <span className="tabular-nums text-foreground">{per(topKind)}</span>{" "}
            and one with {GROUPS[Number(topSize.key)].label} <span className="tabular-nums text-foreground">{per(topSize)}</span>
            {lowKind && (
              <>
                ; {kindLabel(lowKind.key)} paid <span className="tabular-nums text-foreground">{per(lowKind)}</span>
              </>
            )}
            {topKind.top && topKind.top.earned / topKind.earned >= 0.4 && (
              <>
                . {topKind.top.name} alone brought {pct(topKind.top.earned / topKind.earned)} of {kindLabel(topKind.key)}, so
                it&apos;s left out of these
              </>
            )}
            .
          </span>
        </p>
      )}

      <Section
        id="trend"
        title="Earning by size"
        text="What one template of each size brings in, and how soon a new one starts paying."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">Kickback per published template, 7-day average, last 90 days</h3>
            {key}
            <ChartContainer config={{}} className="aspect-auto h-44 w-full">
              <LineChart title="Kickback per published template by size, 7-day average" data={trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" {...tick} tickMargin={8} minTickGap={40} tickFormatter={fmtDay} />
                <YAxis width={44} {...tick} tickCount={3} tickFormatter={perDay} />
                <Tooltip
                  isAnimationActive={false}
                  cursor={cursor}
                  content={(p) => <Tip {...p} title={(l) => fmtDay(String(l))} format={(v) => `${perDay(v)} a day`} />}
                />
                {GROUPS.map((g, i) => (
                  <Line key={g.label} name={g.label} dataKey={`p${i}`} stroke={g.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              Daily kickback per published template of that size. If it falls while the catalog
              grows, new templates of that size earn less than older ones.
            </p>
          </section>

          <section className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">Paid within days of publishing</h3>
            {key}
            <ChartContainer config={{}} className="aspect-auto h-44 w-full">
              <LineChart title="Share of templates paid within days of publishing, by size" data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" {...tick} tickMargin={8} tickFormatter={(d) => `${d}d`} minTickGap={24} />
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
              Estimated share of templates that have earned any kickback by that day, counting
              young templates for the days they&apos;ve been live. The tooltip shows how many
              templates are that old; under 15 the line is noisy. Where a line flattens, waiting
              longer doesn&apos;t help.
            </p>
          </section>
        </div>
      </Section>

      <Section
        id="segments"
        title="By kind, size, origin and age"
        text="Earning and 30d cover the last 30 days. Per template is what a typical one earns per 30 days live: young templates count only the days they've been up, and the row's top earner is left out so one hit doesn't carry it. Paid by 30d: share that earned within 30 days of publishing, estimated like the curve above; blank under five templates that old. Set a template's kind and origin under its name on Templates."
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="xl:col-span-2">
            <SegmentTable title="Kind" rows={byKind} format={kindLabel} />
          </div>
          <SegmentTable
            title="Services"
            rows={bySize}
            format={(k) => (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: GROUPS[Number(k)].color }} />
                {GROUPS[Number(k)].label}
              </span>
            )}
          />
          <SegmentTable
            title="Origin"
            rows={byOrigin}
            format={(k) => ORIGINS.find((x) => x.key === k)?.label ?? "Unsorted"}
          />
          <div className="xl:col-span-2">
            <SegmentTable
              title="Published"
              rows={byMonth}
              format={(k) => (k === "unknown" ? k : monthFmt.format(new Date(`${k}-01T00:00:00Z`)))}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

type Segment = {
  key: string;
  templates: number;
  earning: number;
  running: number;
  earned: number;
  /** 30-day kickback per 30 days live, leaving out the top earner. */
  typical: number;
  top: { name: string; earned: number } | null;
  /** Share paid within 30 days of publishing, by paidCurve. */
  paid30: number | null;
};

function segment(templates: TimelineTemplate[], keyOf: (t: TimelineTemplate) => string, now: number): Segment[] {
  // Days of the 30-day window each template was live, at least one so a
  // template's first-day cents don't read as a monthly fortune.
  const live = (t: TimelineTemplate) =>
    t.publishedAt ? Math.min(30, Math.max(1, (now - Date.parse(t.publishedAt)) / DAY)) : 30;
  const by = new Map<string, TimelineTemplate[]>();
  for (const t of templates) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  return [...by.entries()]
    .map(([key, ts]) => {
      const earned = ts.reduce((s, t) => s + (t.earned30d ?? 0), 0);
      const hit = ts.reduce((a, b) => ((b.earned30d ?? 0) > (a.earned30d ?? 0) ? b : a));
      const rest = ts.length > 1 ? ts.filter((t) => t !== hit) : ts;
      return {
        key,
        templates: ts.length,
        earning: ts.filter((t) => (t.earned30d ?? 0) > 0).length,
        running: ts.reduce((s, t) => s + (t.running ?? 0), 0),
        earned,
        typical: (rest.reduce((s, t) => s + (t.earned30d ?? 0), 0) / rest.reduce((s, t) => s + live(t), 0)) * 30,
        top: (hit.earned30d ?? 0) > 0 ? { name: hit.name.split(" | ")[0], earned: hit.earned30d ?? 0 } : null,
        paid30: paidCurve(ts.flatMap((t) => lifeOf(t, now) ?? []), 30)[30].share,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

type SegmentKey = "key" | "templates" | "earning" | "earned" | "per" | "top" | "perRunning" | "paid30";

function SegmentTable({
  title,
  rows,
  format,
}: {
  title: string;
  rows: Segment[];
  format: (key: string) => ReactNode;
}) {
  const best = Math.max(0, ...rows.map((r) => r.typical));
  // The label column keeps the segments' own order: kinds as listed, sizes
  // small to large, months oldest first.
  const order = new Map(rows.map((r, i) => [r.key, i]));
  const { rows: sorted, head } = useSort(
    rows,
    (r, key: SegmentKey) =>
      ({
        key: order.get(r.key),
        templates: r.templates,
        earning: r.earning,
        earned: r.earned,
        per: r.typical,
        top: r.top ? r.top.earned / r.earned : null,
        perRunning: r.running > 0 ? r.earned / r.running : null,
        paid30: r.paid30,
      })[key],
    "key",
    ["key"],
  );
  return (
    <Table className="sm:min-w-[34rem]">
      <TableHeader>
        <TableRow>
          {head("key", title)}
          {head("templates", "Templates", { numeric: true, className: "max-sm:hidden" })}
          {head("earning", "Earning", { numeric: true, className: "max-sm:hidden" })}
          {head("earned", "30d", { numeric: true })}
          {head("per", "Per template", { className: "pl-6", hint: "Typical, per 30 days live, top earner left out" })}
          {head("top", "Top earner", { hint: "Its share of the row's 30d", className: "max-sm:hidden" })}
          {head("perRunning", "Per running instance", { numeric: true, className: "max-sm:hidden" })}
          {head("paid30", "Paid by 30d", { numeric: true, hint: "Share paid within 30 days of publishing, young templates counted for the days they've been up", className: "max-sm:hidden" })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const per = r.typical;
          return (
            <TableRow key={r.key}>
              <TableRowHead className="whitespace-nowrap">{format(r.key)}</TableRowHead>
              <TableCell numeric className="max-sm:hidden">{fmtNum(r.templates)}</TableCell>
              <TableCell numeric className="text-muted-foreground max-sm:hidden">{fmtNum(r.earning)}</TableCell>
              <TableCell numeric>{fmtUsd(r.earned)}</TableCell>
              <TableCell className="pl-6">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-right tabular-nums">{fmtUsd(per)}</span>
                  <TableMeter value={best > 0 ? per / best : 0} className="w-auto min-w-10 flex-1" />
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground max-sm:hidden">
                {r.top ? (
                  <span className="flex items-center justify-between gap-2 whitespace-nowrap">
                    <span className="max-w-32 truncate" title={r.top.name}>{r.top.name}</span>
                    <span className="tabular-nums">{pct(r.top.earned / r.earned)}</span>
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell numeric className="text-muted-foreground max-sm:hidden">
                {r.running > 0 ? fmtUsd(r.earned / r.running) : "—"}
              </TableCell>
              <TableCell numeric className="text-muted-foreground max-sm:hidden">
                {r.paid30 == null ? "—" : pct(r.paid30)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
