import { type ReactNode, useMemo } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, median, perDay, Tip, tick } from "~/components/chart-kit";
import { Section } from "~/components/page";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { dayKey, fmtDay, fmtNum, fmtUsd } from "~/lib/format";
import { KINDS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";

const DAY = 86_400_000;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Whole days from publishing to the first kickback; null if it never paid. */
const daysToPay = (t: TimelineTemplate) =>
  t.publishedAt && t.firstPaidAt
    ? Math.max(0, Math.floor((Date.parse(t.firstPaidAt) - Date.parse(t.publishedAt)) / DAY))
    : null;

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

    // Share of the templates at least that old that had paid by each day,
    // over their whole life: the range picker does not apply. A group's line
    // stops once fewer than five templates are that old.
    const now = Date.parse(data.sampledAt);
    const life = templates
      .filter((t) => t.publishedAt)
      .map((t) => ({ g: groupOf(t), age: Math.floor((now - Date.parse(t.publishedAt!)) / DAY), paid: daysToPay(t) }));
    const curve = Array.from({ length: 31 }, (_, k) => {
      const day = k * 3;
      const row: Record<string, number | null> = { day };
      GROUPS.forEach((_, g) => {
        const old = life.filter((l) => l.g === g && l.age >= day);
        row[`g${g}`] = old.length < 5 ? null : old.filter((l) => l.paid != null && l.paid <= day).length / old.length;
      });
      return row;
    }).filter((r) => r.g0 != null || r.g1 != null || r.g2 != null);

    const kindOrder = (k: string) => (k === "" ? KINDS.length : KINDS.findIndex((x) => x.key === k));
    const byKind = segment(templates, (t) => t.kind).sort((a, b) => kindOrder(a.key) - kindOrder(b.key));
    const bySize = segment(templates, (t) => String(groupOf(t)));
    const byMonth = segment(templates, (t) => t.publishedAt?.slice(0, 7) ?? "unknown");
    return { trend, curve, byKind, bySize, byMonth };
  }, [data]);
}

/** The segment that pays most per template over 30 days, among those with
 * at least three templates, so one lucky template doesn't set the verdict. */
function best(rows: Segment[], skip?: string) {
  const fair = rows.filter((r) => r.templates >= 3 && r.key !== skip);
  return fair.length ? fair.reduce((a, b) => (b.earned / b.templates > a.earned / a.templates ? b : a)) : null;
}

/** Template size and age against what they earn and how soon: the numbers
 * for deciding what to build next, opened by the decision itself. */
export function WhatToPublish({ data }: { data: TimelineResponse }) {
  const { trend, curve, byKind, bySize, byMonth } = useWhatToPublish(data);
  const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? "Unsorted";
  const per = (r: Segment) => perDay(r.earned / r.templates);
  const topKind = best(byKind, "");
  const topSize = best(bySize);
  const lowKind = (() => {
    const fair = byKind.filter((r) => r.templates >= 3 && r.key !== "" && r !== topKind);
    return fair.length ? fair.reduce((a, b) => (b.earned / b.templates < a.earned / a.templates ? b : a)) : null;
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
            Over the last 30 days a {kindLabel(topKind.key)} template paid <span className="tabular-nums text-foreground">{per(topKind)}</span>{" "}
            and one with {GROUPS[Number(topSize.key)].label} <span className="tabular-nums text-foreground">{per(topSize)}</span>
            {lowKind && (
              <>
                ; {kindLabel(lowKind.key)} paid <span className="tabular-nums text-foreground">{per(lowKind)}</span>
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
                  content={(p) => <Tip {...p} title={(l) => `${l} days after publishing`} format={(v) => `${pct(v)} paid`} />}
                />
                {GROUPS.map((g, i) => (
                  <Line key={g.label} name={g.label} type="stepAfter" dataKey={`g${i}`} stroke={g.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              Share of templates at least that old that have earned any kickback. Where a line
              flattens, waiting longer doesn&apos;t help.
            </p>
          </section>
        </div>
      </Section>

      <Section
        id="segments"
        title="By kind, size and age"
        text="Earning and 30d cover the last 30 days. Per template splits that across every template in the row, earning or not. First paid: median wait among those that paid. Set a template's kind under its name on Templates."
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
            title="Published"
            rows={byMonth}
            format={(k) => (k === "unknown" ? k : monthFmt.format(new Date(`${k}-01T00:00:00Z`)))}
          />
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
  firstPaid: number | null;
};

function segment(templates: TimelineTemplate[], keyOf: (t: TimelineTemplate) => string): Segment[] {
  const by = new Map<string, TimelineTemplate[]>();
  for (const t of templates) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  return [...by.entries()]
    .map(([key, ts]) => ({
      key,
      templates: ts.length,
      earning: ts.filter((t) => (t.earned30d ?? 0) > 0).length,
      running: ts.reduce((s, t) => s + (t.running ?? 0), 0),
      earned: ts.reduce((s, t) => s + (t.earned30d ?? 0), 0),
      firstPaid: median(ts.flatMap((t) => daysToPay(t) ?? [])),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

type SegmentKey = "key" | "templates" | "earning" | "earned" | "per" | "perRunning" | "firstPaid";

function SegmentTable({
  title,
  rows,
  format,
}: {
  title: string;
  rows: Segment[];
  format: (key: string) => ReactNode;
}) {
  const best = Math.max(0, ...rows.map((r) => r.earned / r.templates));
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
        per: r.earned / r.templates,
        perRunning: r.running > 0 ? r.earned / r.running : null,
        firstPaid: r.firstPaid,
      })[key],
    "key",
    ["key", "firstPaid"],
  );
  return (
    <Table className="sm:min-w-[34rem]">
      <TableHeader>
        <TableRow>
          {head("key", title)}
          {head("templates", "Templates", { numeric: true, className: "max-sm:hidden" })}
          {head("earning", "Earning", { numeric: true, className: "max-sm:hidden" })}
          {head("earned", "30d", { numeric: true })}
          {head("per", "Per template", { className: "pl-6" })}
          {head("perRunning", "Per running instance", { numeric: true, className: "max-sm:hidden" })}
          {head("firstPaid", "First paid", { numeric: true, hint: "Shortest wait first", className: "max-sm:hidden" })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const per = r.earned / r.templates;
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
              <TableCell numeric className="text-muted-foreground max-sm:hidden">
                {r.running > 0 ? fmtUsd(r.earned / r.running) : "—"}
              </TableCell>
              <TableCell numeric className="text-muted-foreground max-sm:hidden">
                {r.firstPaid == null ? "—" : `${r.firstPaid}d`}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
