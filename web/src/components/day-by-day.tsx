import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "~/components/ui/chart";
import { dayKey, fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import type { TimelineResponse, TimelineTemplate } from "~/queries/analytics";

const DAY = 86_400_000;

/** Template size buckets: the question is whether to publish more
 * single-service templates or more stacks. */
const GROUPS = [
  { label: "1 service", short: "1", color: "var(--chart-3)", has: (s: number) => s === 1 },
  { label: "2–3 services", short: "2–3", color: "var(--chart-5)", has: (s: number) => s >= 2 && s <= 3 },
  { label: "4+ services", short: "4+", color: "var(--chart-4)", has: (s: number) => s >= 4 },
] as const;
const groupOf = (t: TimelineTemplate) => GROUPS.findIndex((g) => g.has(t.services)) as 0 | 1 | 2;

const AVG = "var(--muted-foreground)";
const CATALOG = "var(--chart-other)";
const EARNING = "var(--chart-1)";

type DayRow = {
  date: string;
  earned: number;
  avg7: number | null;
  published: number;
  /** Templates that earned at least once in the 7 days ending here. */
  earning: number;
  /** Per group: kickback that day, templates published by then, and the
   * 7-day average kickback per published template. */
  e0: number; e1: number; e2: number;
  n0: number; n1: number; n2: number;
  p0: number | null; p1: number | null; p2: number | null;
};

type GroupStat = {
  templates: number;
  earnedRange: number;
  earningNow: number;
  medianDays: number | null;
};

function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function useDayByDay(data: TimelineResponse) {
  return useMemo(() => {
    const { points, templates } = data;
    const index = new Map(points.map((p, i) => [p.date, i]));
    const rows: DayRow[] = points.map((p) => ({
      date: p.date,
      earned: p.earnedCents / 100,
      avg7: null,
      published: p.published,
      earning: 0,
      e0: 0, e1: 0, e2: 0, n0: 0, n1: 0, n2: 0, p0: null, p1: null, p2: null,
    }));
    const name = shortNames(templates.map((t) => t.name));
    const earners: [string, number][][] = points.map(() => []);

    for (const t of templates) {
      const g = groupOf(t);
      const pub = t.publishedAt ? dayKey(t.publishedAt) : null;
      for (const r of rows) if (pub && r.date >= pub) r[`n${g}`]++;
      const hit = new Set<number>();
      for (const a of t.activity) {
        const i = index.get(a.date);
        if (i == null || a.earnedCents <= 0) continue;
        rows[i][`e${g}`] += a.earnedCents / 100;
        earners[i].push([name(t.name), a.earnedCents / 100]);
        for (let j = i; j < Math.min(rows.length, i + 7); j++) hit.add(j);
      }
      for (const j of hit) rows[j].earning++;
    }

    rows.forEach((r, i) => {
      if (i < 6) return;
      const w = rows.slice(i - 6, i + 1);
      r.avg7 = w.reduce((s, x) => s + x.earned, 0) / 7;
      for (const g of [0, 1, 2] as const) {
        const n = r[`n${g}`];
        r[`p${g}`] = n > 0 ? w.reduce((s, x) => s + x[`e${g}`], 0) / 7 / n : null;
      }
    });
    for (const e of earners) e.sort((a, b) => b[1] - a[1]);

    // Days from publishing to first kickback, lifetime, per size: the
    // range picker does not apply.
    const now = Date.parse(data.sampledAt);
    const life = templates
      .filter((t) => t.publishedAt)
      .map((t) => {
        const pub = Date.parse(t.publishedAt!);
        return {
          g: groupOf(t),
          age: Math.floor((now - pub) / DAY),
          paid: t.firstPaidAt ? Math.max(0, Math.floor((Date.parse(t.firstPaidAt) - pub) / DAY)) : null,
        };
      });
    const groups: GroupStat[] = GROUPS.map((_, g) => {
      const mine = templates.filter((t) => groupOf(t) === g);
      return {
        templates: mine.length,
        earnedRange: mine.reduce((s, t) => s + t.earnedCents, 0) / 100,
        earningNow: mine.filter((t) => (t.earned30d ?? 0) > 0).length,
        medianDays: median(life.flatMap((l) => (l.g === g && l.paid != null ? [l.paid] : []))),
      };
    });
    // Share of the templates at least that old that had paid by each day;
    // a group's line stops once fewer than five templates are that old.
    const curve = Array.from({ length: 31 }, (_, k) => {
      const day = k * 3;
      const row: Record<string, number | null> = { day };
      GROUPS.forEach((_, g) => {
        const old = life.filter((l) => l.g === g && l.age >= day);
        row[`g${g}`] = old.length < 5 ? null : old.filter((l) => l.paid != null && l.paid <= day).length / old.length;
      });
      return row;
    }).filter((r) => r.g0 != null || r.g1 != null || r.g2 != null);

    const withAvg = rows.filter((r) => r.avg7 != null);
    return { rows, earners, groups, curve, first: withAvg[0], last: withAvg[withAvg.length - 1] };
  }, [data]);
}

const tick = { tickLine: false, axisLine: false } as const;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const perDay = (v: number) => (v >= 1 ? fmtUsd(v) : `${Math.round(v * 100)}¢`);
const change = (from: number, to: number) =>
  from > 0 ? `${to >= from ? "+" : ""}${Math.round(((to - from) / from) * 100)}%` : "new";

type TipItem = { name?: string | number; value?: unknown; color?: string; dataKey?: unknown };

/** One tooltip for every chart here: the day (or day count), each series
 * formatted by the chart that owns it, and optionally what earned. */
function Tip({
  active,
  payload,
  label,
  title,
  format,
  extra,
}: {
  active?: boolean;
  payload?: readonly TipItem[];
  label?: string | number;
  title: (label: string | number) => string;
  format: (v: number, key: string) => string;
  extra?: (label: string | number) => [string, number][];
}) {
  if (!active || !payload?.length || label == null) return null;
  const top = extra?.(label) ?? [];
  return (
    <div className="min-w-48 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
      <div className="mb-1 font-medium">{title(label)}</div>
      {payload
        .filter((p) => typeof p.value === "number")
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular-nums">{format(p.value as number, String(p.dataKey))}</span>
          </div>
        ))}
      {top.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t pt-1.5 text-muted-foreground">
          {top.slice(0, 4).map(([n, v], i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="max-w-40 truncate">{n}</span>
              <span className="tabular-nums">{fmtUsd(v)}</span>
            </div>
          ))}
          {top.length > 4 && <div>+{top.length - 4} more</div>}
        </div>
      )}
    </div>
  );
}

function Key({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((k) => (
        <span key={k.label} className="flex items-center gap-1.5">
          <span
            className={k.line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: k.color }}
          />
          {k.label}
        </span>
      ))}
    </div>
  );
}

const cursor = { stroke: "var(--border)", fill: "var(--foreground)", fillOpacity: 0.05 };

/** Kickback by template size with the catalog and the templates earning on
 * the same days, what one published template brings in, and how long a
 * template takes to pay at all. */
export function DayByDay({ data }: { data: TimelineResponse }) {
  const { rows, earners, groups, curve, first, last } = useDayByDay(data);
  const dayIndex = new Map(rows.map((r, i) => [r.date, i]));
  const sync = { data: rows, syncId: "day-by-day", margin: { top: 6, right: 0, left: 0, bottom: 4 } };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-5">
        <section className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Kickback per day against the catalog</h3>
            {first && last && (
              <span className="text-xs text-muted-foreground tabular-nums">
                7-day average {perDay(last.avg7!)} a day, {change(first.avg7!, last.avg7!)} since{" "}
                {fmtDay(first.date)}
              </span>
            )}
          </div>
          <Key
            items={[
              ...GROUPS.map((g) => ({ label: g.label, color: g.color })),
              { label: "7-day average", color: AVG, line: true },
              { label: "Published templates", color: CATALOG, line: true },
              { label: "Earned in the last 7 days", color: EARNING, line: true },
            ]}
          />
          <ChartContainer config={{}} className="aspect-auto h-52 w-full">
            <ComposedChart {...sync}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" scale="band" hide />
              <YAxis yAxisId="usd" width={44} {...tick} tickCount={4} tickFormatter={fmtUsdTick} />
              <YAxis yAxisId="n" orientation="right" width={36} {...tick} tickCount={4} allowDecimals={false} />
              <Tooltip
                isAnimationActive={false}
                cursor={cursor}
                content={(p) => (
                  <Tip
                    {...p}
                    title={(l) => fmtDay(String(l))}
                    format={(v, k) => (k === "published" || k === "earning" ? fmtNum(v) : fmtUsd(v))}
                    extra={(l) => earners[dayIndex.get(String(l)) ?? -1] ?? []}
                  />
                )}
              />
              {GROUPS.map((g, i) => (
                <Bar key={g.label} yAxisId="usd" name={g.label} dataKey={`e${i}`} stackId="k" fill={g.color} maxBarSize={22} isAnimationActive={false} />
              ))}
              <Line yAxisId="usd" name="7-day average" dataKey="avg7" stroke={AVG} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line yAxisId="n" name="Published templates" type="stepAfter" dataKey="published" stroke={CATALOG} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line yAxisId="n" name="Earned in the last 7 days" dataKey="earning" stroke={EARNING} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
          <p className="text-xs text-muted-foreground">
            Bars and the average read on the left axis; the two template counts on the right.
          </p>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">Kickback per published template, 7-day average</h3>
          <Key items={GROUPS.map((g) => ({ label: g.label, color: g.color, line: true }))} />
          <ChartContainer config={{}} className="aspect-auto h-40 w-full">
            <LineChart {...sync}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" scale="band" {...tick} tickMargin={8} minTickGap={40} tickFormatter={fmtDay} />
              <YAxis width={44} {...tick} tickCount={3} tickFormatter={perDay} />
              {/* Matches the right axis above, so the plots line up day for day. */}
              <YAxis yAxisId="pad" orientation="right" width={36} hide />
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
        </section>
      </div>

      <aside className="space-y-5 border-t pt-4 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <div className="space-y-2">
          <h3 className="font-medium">By template size</h3>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="pb-1.5 font-medium">Size</th>
                <th className="pb-1.5 text-right font-medium">Templates</th>
                <th className="pb-1.5 text-right font-medium">Earning</th>
                <th className="pb-1.5 text-right font-medium">Per template</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {groups.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ background: GROUPS[i].color }} />
                      {GROUPS[i].short}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{fmtNum(s.templates)}</td>
                  <td className="py-1.5 text-right">{fmtNum(s.earningNow)}</td>
                  <td className="py-1.5 text-right">{fmtUsd(s.templates ? s.earnedRange / s.templates : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Earning: kickback in the last 30 days. Per template: kickback over the selected range,
            divided across every template of that size.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">Paid within days of publishing</h3>
          <ChartContainer config={{}} className="aspect-auto h-36 w-full">
            <LineChart data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" {...tick} tickMargin={6} tickFormatter={(d) => `${d}d`} minTickGap={24} />
              <YAxis width={36} {...tick} tickCount={3} domain={[0, "auto"]} tickFormatter={pct} />
              <Tooltip
                isAnimationActive={false}
                content={(p) => <Tip {...p} title={(l) => `${l} days after publishing`} format={(v) => `${pct(v)} paid`} />}
              />
              {GROUPS.map((g, i) => (
                <Line key={g.label} name={g.label} type="stepAfter" dataKey={`g${i}`} stroke={g.color} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ChartContainer>
          <p className="text-xs text-muted-foreground">
            Median wait for the first kickback:{" "}
            {groups
              .map((s, i) => `${i === 0 ? GROUPS[i].label : GROUPS[i].short}: ${s.medianDays ?? "–"}${i === 0 ? " days" : ""}`)
              .join(" · ")}
            . Each line is
            the share of templates at least that old that have paid, over their whole life.
          </p>
        </div>
      </aside>
    </div>
  );
}
