import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { RangeToggle } from "~/components/range-toggle";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import { DAY, HEALTH_FLOOR } from "~/lib/catalog";
import { fmtDay, fmtDayTime, fmtNum, fmtUsd } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type ProjectPoint, templateProjectsQuery } from "~/queries/analytics";

const hourMinute = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

type MetricKey = "health" | "projects" | "recentProjects" | "activeProjects" | "running" | "kickback";
type Metric = {
  key: MetricKey;
  label: string;
  note?: string;
  /** The figure, and a y tick: ticks drop the cents once they'd crowd. */
  fmt: (v: number) => string;
  tick?: (v: number, top: number) => string;
  /** A change, unsigned, in the metric's unit. */
  delta: (d: number) => string;
  /** Counts: whole ticks, and a percentage beside a change off a real base. */
  count?: boolean;
  /** A fixed scale with a line to read against; the rest fit their own range. */
  scale?: { top: number; line: number };
};

const count = { fmt: fmtNum, delta: fmtNum, count: true } as const;
/** In the catalog table's column order, so a row reads across and then
 * down into its own history. */
const METRICS: Metric[] = [
  {
    key: "health",
    label: "Health",
    note: `deploys that came up; the line is ${HEALTH_FLOOR}%`,
    fmt: (v) => `${v.toFixed(0)}%`,
    delta: (d) => `${d.toFixed(0)} pts`,
    scale: { top: 100, line: HEALTH_FLOOR },
  },
  { key: "projects", label: "Projects", note: "Railway's count; it dips when Railway takes one out", ...count },
  { key: "recentProjects", label: "Recent projects", note: "made in the 90 days before each day", ...count },
  { key: "activeProjects", label: "Active projects", ...count },
  { key: "running", label: "Running instances", note: "services up, what earns", ...count },
  {
    key: "kickback",
    label: "Kickback",
    note: "lifetime; a step is an invoice",
    fmt: fmtUsd,
    tick: (v, top) => (top >= 10 ? `$${fmtNum(Math.round(v))}` : fmtUsd(v)),
    delta: fmtUsd,
  },
];

type Row = { t: number; sampledAt: string } & Record<MetricKey, number | null>;
/** The newest reading against the oldest the range holds. A metric can
 * start later than the range (running instances weren't collected at
 * first), so each carries the sample it is measured from. */
type Change = { current: number; previous: number | null; since: string };

function changeOf(rows: Row[], key: MetricKey): Change | null {
  const have = rows.filter((r) => r[key] != null);
  if (have.length === 0) return null;
  const first = have[0];
  const last = have[have.length - 1];
  return { current: last[key]!, previous: have.length > 1 ? first[key]! : null, since: first.sampledAt };
}

/** UTC midnights inside the range, thinned to about `want`. */
function dayTicks(min: number, max: number, want: number) {
  const first = Math.ceil(min / DAY) * DAY;
  const n = Math.floor((max - first) / DAY) + 1;
  if (n < 2) return undefined;
  const step = Math.ceil(n / want);
  return Array.from({ length: Math.ceil(n / step) }, (_, i) => first + i * step * DAY);
}

/** A template's history as small multiples in the table's column order:
 * health, projects, active projects, running instances and lifetime
 * kickback. Each panel has its own scale (projects is close to all-time and
 * would flatten the rest), and the crosshair is synced so they read as one
 * moment. The x axis is real time, so a stretch where collection was down
 * shows as wide as it was. Projects is Railway's count, not ours, and not
 * strictly cumulative: a stopped project stays in it, but now and then
 * Railway takes one out (19 of 139 templates had dipped by 2026-11-10), so a
 * step down is real data. Recent projects only shows once it differs from
 * projects, which takes a template over 90 days old.
 * Ported from upstream ThallesP/dispatcher#12, reading our template-list
 * project counts rather than the inflated templateMetrics deployments. */
export function TemplateProjects({ templateId }: { templateId: string }) {
  const [days, setDays] = useState<number>(30);
  const projects = useQuery(templateProjectsQuery(templateId, days));
  const data = projects.data;
  const rows: Row[] = (data?.points ?? []).map((p: ProjectPoint) => ({
    t: Date.parse(p.sampledAt),
    sampledAt: p.sampledAt,
    health: p.health ?? null,
    projects: p.projects,
    recentProjects: p.recentProjects,
    activeProjects: p.activeProjects,
    running: p.running ?? null,
    kickback: p.kickback ?? null,
  }));
  const first = rows[0];
  const panels = METRICS.flatMap((metric) => {
    if (metric.key === "recentProjects" && rows.every((r) => r.recentProjects === r.projects)) return [];
    const change = changeOf(rows, metric.key);
    return change ? [{ metric, change }] : [];
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Over time</div>
          <div className="text-xs text-muted-foreground">
            {first ? `Change since ${fmtDayTime(first.sampledAt)} UTC` : `Last ${data?.days ?? days} days`}
          </div>
        </div>
        {/* This chart's own range, apart from the page's. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          These charts
          <RangeToggle value={days} onChange={setDays} />
        </div>
      </div>

      {projects.isPending && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      )}

      {projects.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load this template&apos;s history. Reload to try again.
        </p>
      )}

      {data && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No published samples in the last {data.days} days.</p>
      )}

      {panels.length > 0 && (
        <div
          className={cn(
            "grid gap-6 transition-opacity sm:grid-cols-2",
            panels.length >= 6 ? "lg:grid-cols-3 xl:grid-cols-6" : panels.length === 5 ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4",
            projects.isPlaceholderData && "opacity-60",
          )}
        >
          {panels.map(({ metric, change }) => (
            <MetricPanel
              key={metric.key}
              syncId={templateId}
              metric={metric}
              rows={rows}
              change={change}
              // A metric that starts with the range needs no date of its own.
              since={change.since === first.sampledAt ? null : change.since}
              ticks={panels.length >= 5 ? 3 : 4}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricPanel({
  syncId,
  metric,
  rows,
  change,
  since,
  ticks,
}: {
  syncId: string;
  metric: Metric;
  rows: Row[];
  change: Change;
  since: string | null;
  ticks: number;
}) {
  const key = metric.key;
  const chartConfig = { [key]: { label: metric.label, color: "var(--chart-1)" } } satisfies ChartConfig;

  const values = rows.flatMap((r) => r[key] ?? []);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A filled area has to stand on zero, or a step from 6 to 7 fills the
  // panel. Small figures, and ones that move a lot, start there; a big
  // figure that barely moves (594 projects, three more) zooms to its own
  // range and is drawn as a line alone.
  const zero = metric.scale != null || hi <= 10 || lo <= hi / 2;
  const top = metric.scale?.top ?? hi;
  const domain: [number | "auto", number | "auto"] = metric.scale ? [0, metric.scale.top] : zero ? [0, hi === 0 ? 1 : "auto"] : ["auto", "auto"];
  const tick = (v: number) => (metric.tick ?? metric.fmt)(v, top);
  // Size the gutter to the widest tick label.
  const yAxisWidth = Math.max(32, tick(top * 1.2).length * 7 + 14);

  const min = rows[0].t;
  const max = rows[rows.length - 1].t;
  const spansDays = max - min > 3 * DAY;

  return (
    <div className="min-w-0 space-y-2">
      <div>
        <div className="text-xs text-muted-foreground">
          {metric.label}
          {metric.note && ` · ${metric.note}`}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xl font-semibold tabular-nums">{metric.fmt(change.current)}</span>
          <Delta metric={metric} change={change} since={since} />
        </div>
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
        <AreaChart title={`${metric.label} over time`} accessibilityLayer data={rows} syncId={syncId} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={spansDays ? dayTicks(min, max, ticks) : undefined}
            tickCount={3}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: number) => (spansDays ? fmtDay(new Date(v).toISOString()) : hourMinute.format(new Date(v)))}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={yAxisWidth}
            tickCount={3}
            ticks={metric.scale ? [0, metric.scale.top / 2, metric.scale.top] : undefined}
            allowDecimals={!metric.count}
            domain={domain}
            tickFormatter={tick}
          />
          {metric.scale && <ReferenceLine y={metric.scale.line} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.6} />}
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label, payload) => {
                  const at = payload?.[0]?.payload?.sampledAt;
                  return at ? `${fmtDayTime(at)} UTC` : String(label);
                }}
                formatter={(value) => (
                  <>
                    <div className="h-2.5 w-1 shrink-0 rounded-[2px]" style={{ background: "var(--chart-1)" }} />
                    <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">{metric.label}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">{metric.fmt(Number(value))}</span>
                    </div>
                  </>
                )}
              />
            }
          />
          <Area
            dataKey={key}
            type="stepAfter"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="var(--chart-1)"
            fillOpacity={zero ? 0.1 : 0}
            // One sample makes no line; a dot says it is there.
            dot={values.length === 1 ? { r: 3, fill: "var(--chart-1)", strokeWidth: 0 } : false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

/** The change since the start of the range in the metric's own unit, and
 * the date it is measured from when that isn't the range's start. A count
 * adds a percentage once its base is big enough to mean something: one
 * project to seven is +6, not +600%. Arrow and sign, never colour alone. */
function Delta({ metric, change, since }: { metric: Metric; change: Change; since: string | null }) {
  const from = since && <span className="font-normal text-muted-foreground"> since {fmtDay(since)}</span>;
  if (change.previous == null) return <span className="text-xs text-muted-foreground">one sample so far</span>;
  const diff = change.current - change.previous;
  // Under what the unit shows (half a health point) is no change either.
  if (metric.delta(Math.abs(diff)) === metric.delta(0)) return <span className="text-xs text-muted-foreground">no change{from}</span>;
  const up = diff > 0;
  const pct = metric.count && change.previous >= 10 ? ` (${up ? "+" : "−"}${Math.abs(Math.round((diff / change.previous) * 100))}%)` : "";
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-medium tabular-nums", up ? "text-(--viz-up)" : "text-(--viz-down)")}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {up ? "+" : "−"}
      {metric.delta(Math.abs(diff))}
      {pct}
      {from}
    </span>
  );
}
