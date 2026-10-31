import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cursor, GROUPS, groupOf, Key, perDay, Tip, tick } from "~/components/chart-kit";
import { ChartContainer } from "~/components/ui/chart";
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import type { TimelineResponse } from "~/queries/analytics";

const MONEY = "var(--chart-1)";
const AVG = "var(--muted-foreground)";
/** Published ⊇ deployed ⊇ active ⊇ earning: each line is a subset of the
 * one before, so they never cross. */
const COUNTS = [
  { key: "published", label: "Published", color: "var(--chart-other)", dashed: true },
  { key: "deployed", label: "Deployed", color: "var(--chart-5)" },
  { key: "active", label: "Running", color: "var(--chart-3)" },
  { key: "earning", label: "Earning (30d)", color: "var(--chart-4)" },
] as const;

type Row = {
  date: string;
  life: number | null;
  published: number;
  deployed: number | null;
  active: number | null;
  earning: number | null;
  running: number | null;
  earned: number;
  avg7: number | null;
  e0: number; e1: number; e2: number;
};

function useEarnings(data: TimelineResponse) {
  return useMemo(() => {
    const { points, templates } = data;
    const index = new Map(points.map((p, i) => [p.date, i]));
    const rows: Row[] = points.map((p) => ({
      date: p.date,
      life: p.lifetimeCents == null ? null : p.lifetimeCents / 100,
      published: p.published,
      deployed: p.deployedTemplates,
      active: p.activeTemplates,
      earning: p.earningTemplates,
      running: p.running,
      earned: p.earnedCents / 100,
      avg7: null,
      e0: 0, e1: 0, e2: 0,
    }));
    const name = shortNames(templates.map((t) => t.name));
    const earners: [string, number][][] = points.map(() => []);
    for (const t of templates) {
      const g = groupOf(t);
      for (const a of t.activity) {
        const i = index.get(a.date);
        if (i == null || a.earnedCents <= 0) continue;
        rows[i][`e${g}`] += a.earnedCents / 100;
        earners[i].push([name(t.name), a.earnedCents / 100]);
      }
    }
    for (const e of earners) e.sort((a, b) => b[1] - a[1]);
    rows.forEach((r, i) => {
      if (i >= 6) r.avg7 = rows.slice(i - 6, i + 1).reduce((s, x) => s + x.earned, 0) / 7;
    });
    const sampled = rows.filter((r) => r.life != null);
    return { rows, earners, first: sampled[0], last: sampled[sampled.length - 1] };
  }, [data]);
}

const sharePct = (n: number | null, of: number) => (n != null && of > 0 ? `${Math.round((n / of) * 100)}%` : null);
const signed = (v: number, fmt: (v: number) => string) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}`;

/** Money in, two readings on one day axis: everything earned so far against
 * how much of the catalog is deployed, live and paying, then what each day
 * added, by template size. Hovering either panel marks the day in both. */
export function Earnings({ data }: { data: TimelineResponse }) {
  const { rows, earners, first, last } = useEarnings(data);
  const dayIndex = new Map(rows.map((r, i) => [r.date, i]));
  const sync = { data: rows, syncId: "earnings", margin: { top: 6, right: 0, left: 0, bottom: 4 } };
  const perTemplate = (r: Row | undefined) => (r?.life != null && r.published > 0 ? r.life / r.published : null);
  const nowPer = perTemplate(last);
  const thenPer = perTemplate(first);
  const sinceStart = first && last && first !== last;

  const change = (key: (typeof COUNTS)[number]["key"]) => {
    const to = last?.[key];
    const from = first?.[key];
    return sinceStart && to != null && from != null && to !== from ? signed(to - from, fmtNum) : null;
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-medium">Lifetime kickback against the catalog</h3>
          {nowPer != null && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{fmtUsd(nowPer)}</span> per
              published template
              {sinceStart && thenPer != null && (
                <>
                  , <span className="tabular-nums">{fmtUsd(thenPer)}</span> on {fmtDay(first.date)}
                </>
              )}
            </span>
          )}
        </div>
        <Key
          items={[
            {
              label: "Lifetime kickback",
              color: MONEY,
              value:
                last?.life != null ? (
                  <>
                    {fmtUsd(last.life)}
                    {sinceStart && first.life != null && (
                      <span className="font-normal text-muted-foreground"> {signed(last.life - first.life, fmtUsd)}</span>
                    )}
                  </>
                ) : undefined,
            },
            ...COUNTS.map((c) => {
              const v = c.key === "published" ? (last?.published ?? null) : (last?.[c.key] ?? null);
              const share = c.key === "published" ? null : sharePct(v, last?.published ?? 0);
              const d = change(c.key);
              return {
                label: c.label,
                color: c.color,
                line: true,
                dashed: "dashed" in c,
                value:
                  v == null ? undefined : (
                    <>
                      {fmtNum(v)}
                      {(share || d) && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          {[share, d].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </>
                  ),
              };
            }),
          ]}
        />
        <ChartContainer config={{}} className="aspect-auto h-72 w-full lg:h-[26rem]">
          <ComposedChart {...sync} title="Lifetime kickback against the catalog, day by day">
            <defs>
              <linearGradient id="life-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={MONEY} stopOpacity={0.22} />
                <stop offset="100%" stopColor={MONEY} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" scale="band" hide />
            <YAxis yAxisId="usd" width={52} {...tick} tickCount={4} domain={[0, "auto"]} tickFormatter={fmtUsdTick} />
            <YAxis yAxisId="n" orientation="right" width={36} {...tick} tickCount={4} allowDecimals={false} domain={[0, "auto"]} />
            <Tooltip
              isAnimationActive={false}
              cursor={cursor}
              content={(p) => (
                <Tip
                  {...p}
                  title={(l) => fmtDay(String(l))}
                  format={(v, k) => (k === "life" ? fmtUsd(v) : fmtNum(v))}
                  footer={(l) => {
                    const r = rows[dayIndex.get(String(l)) ?? -1];
                    return r?.running != null ? `${fmtNum(r.running)} running instances` : null;
                  }}
                />
              )}
            />
            <Area
              yAxisId="usd"
              name="Lifetime kickback"
              dataKey="life"
              stroke={MONEY}
              strokeWidth={2}
              fill="url(#life-fill)"
              connectNulls
              isAnimationActive={false}
            />
            {COUNTS.map((c) => (
              <Line
                key={c.key}
                yAxisId="n"
                name={c.label}
                type="stepAfter"
                dataKey={c.key}
                stroke={c.color}
                strokeWidth={c.key === "earning" ? 2 : 1.5}
                strokeDasharray={"dashed" in c ? "4 3" : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ChartContainer>
        <p className="text-xs text-muted-foreground">
          Left axis: kickback. Right axis: templates, not projects. Deployed: someone other than you
          made a project from it. Running: it has a service up that day (before metrics, an active project). Earning: it paid in the
          last 30 days.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-medium">Kickback per day</h3>
          <Key
            items={[
              ...GROUPS.map((g) => ({ label: g.label, color: g.color })),
              {
                label: "7-day average",
                color: AVG,
                line: true,
                value: rows[rows.length - 1]?.avg7 != null ? `${perDay(rows[rows.length - 1].avg7!)} a day` : undefined,
              },
            ]}
          />
        </div>
        <ChartContainer config={{}} className="aspect-auto h-52 w-full lg:h-72">
          {/* The right margin stands in for the template axis above, so the
              panels line up day for day; a hidden axis takes no width. */}
          <ComposedChart {...sync} margin={{ ...sync.margin, right: 36 }} title="Kickback per day, by template size">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" scale="band" {...tick} tickMargin={8} minTickGap={40} tickFormatter={fmtDay} />
            <YAxis width={52} {...tick} tickCount={3} tickFormatter={fmtUsdTick} />
            <Tooltip
              isAnimationActive={false}
              cursor={cursor}
              content={(p) => (
                <Tip
                  {...p}
                  title={(l) => fmtDay(String(l))}
                  format={(v) => fmtUsd(v)}
                  extra={(l) => earners[dayIndex.get(String(l)) ?? -1] ?? []}
                />
              )}
            />
            {GROUPS.map((g, i) => (
              <Bar key={g.label} name={g.label} dataKey={`e${i}`} stackId="k" fill={g.color} maxBarSize={22} isAnimationActive={false} />
            ))}
            <Line name="7-day average" dataKey="avg7" stroke={AVG} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ChartContainer>
      </section>
    </div>
  );
}
