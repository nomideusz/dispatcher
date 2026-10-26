import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RangeToggle } from "~/components/range-toggle";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtNum, fmtSignedPct } from "~/lib/format";
import {
  type MetricChange,
  type ProjectPoint,
  templateProjectsQuery,
} from "~/queries/analytics";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const fullFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const METRICS = [
  { key: "activeProjects", label: "Active projects" },
  { key: "recentProjects", label: "Recent projects", note: "made in the 90 days before each day" },
  { key: "projects", label: "Total projects" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

/** A template's project counts over time, as small multiples: total projects
 * is cumulative and dwarfs the other two, so one shared y-scale would flatten
 * active and recent into the floor. Each metric gets its own panel and scale;
 * the crosshair is synced so the panels still read as one moment in time.
 * Ported from upstream ThallesP/dispatcher#12, reading our template-list
 * project counts rather than the inflated templateMetrics deployments. */
export function TemplateProjects({ templateId }: { templateId: string }) {
  const [days, setDays] = useState<number>(30);
  const projects = useQuery(templateProjectsQuery(templateId, days));
  const data = projects.data;
  const first = data?.points[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Projects over time</div>
          <div className="text-xs text-muted-foreground">
            {first
              ? `Change since ${fullFmt.format(new Date(first.sampledAt))}`
              : `Last ${days} days`}
          </div>
        </div>
        {/* This chart's own range, apart from the page's. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          This chart
          <RangeToggle value={days} onChange={setDays} />
        </div>
      </div>

      {projects.isPending && (
        <div className="grid gap-6 sm:grid-cols-3">
          {METRICS.map((m) => (
            <div key={m.key} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      )}

      {projects.isError && (
        <p className="text-sm text-(--viz-critical)">
          Couldn&apos;t load project history — check the server logs.
        </p>
      )}

      {data && data.points.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No published samples in the last {days} days.
        </p>
      )}

      {data?.change && data.points.length > 0 && (
        <div
          className={`grid gap-6 transition-opacity sm:grid-cols-3 ${
            projects.isPlaceholderData ? "opacity-60" : ""
          }`}
        >
          {METRICS.map((m) => (
            <MetricPanel
              key={m.key}
              syncId={templateId}
              metric={m}
              points={data.points}
              change={data.change![m.key]}
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
  points,
  change,
}: {
  syncId: string;
  metric: (typeof METRICS)[number];
  points: ProjectPoint[];
  change: MetricChange;
}) {
  const key: MetricKey = metric.key;
  const chartConfig = {
    [key]: { label: metric.label, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  // Each panel zooms to its own range so the trend is visible; the y-ticks
  // and the absolute delta keep the zoom honest. Size the gutter to the
  // widest tick label.
  const max = Math.max(...points.map((p) => p[key]));
  const yAxisWidth = Math.max(32, fmtNum(max * 1.2).length * 7 + 14);
  const spansDays =
    points.length > 1 &&
    new Date(points[points.length - 1].sampledAt).getTime() -
      new Date(points[0].sampledAt).getTime() >
      3 * 24 * 60 * 60 * 1000;

  return (
    <div className="min-w-0 space-y-2">
      <div>
        <div className="text-xs text-muted-foreground">
          {metric.label}
          {"note" in metric && ` · ${metric.note}`}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">
            {fmtNum(change.current)}
          </span>
          <ProjectDelta change={change} />
        </div>
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
        <AreaChart
          title="Projects over time"
          accessibilityLayer
          data={points}
          syncId={syncId}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="sampledAt"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
            tickFormatter={(v: string) =>
              (spansDays ? dayFmt : timeFmt).format(new Date(v))
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={yAxisWidth}
            tickCount={3}
            allowDecimals={false}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label, payload) =>
                  fullFmt.format(
                    new Date(payload?.[0]?.payload?.sampledAt ?? String(label)),
                  )
                }
                formatter={(value) => (
                  <>
                    <div
                      className="h-2.5 w-1 shrink-0 rounded-[2px]"
                      style={{ background: "var(--chart-1)" }}
                    />
                    <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">
                        {metric.label}
                      </span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {fmtNum(Number(value))}
                      </span>
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
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

/** Absolute change since the start of the range, with the percentage when
 * there is a non-zero baseline. Arrow + sign, never colour alone. */
function ProjectDelta({ change }: { change: MetricChange }) {
  if (change.previous == null) {
    return <span className="text-xs text-muted-foreground">no change yet</span>;
  }
  const diff = change.current - change.previous;
  if (diff === 0) {
    return <span className="text-xs text-muted-foreground">no change</span>;
  }
  const up = diff > 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        up ? "text-(--viz-up)" : "text-(--viz-down)"
      }`}
    >
      {up ? (
        <ArrowUpRight className="size-3.5" />
      ) : (
        <ArrowDownRight className="size-3.5" />
      )}
      {up ? "+" : "−"}
      {fmtNum(Math.abs(diff))}
      {change.changePct != null && ` (${fmtSignedPct(change.changePct)})`}
    </span>
  );
}
