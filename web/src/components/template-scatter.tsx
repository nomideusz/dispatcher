import {
  CartesianGrid,
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartContainer } from "~/components/ui/chart";
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import type { TimelineTemplate } from "~/queries/analytics";

/** Tick values that read well on a square-root axis: dense near zero, where
 * most templates sit, sparse at the top, where the one big earner does. */
const NICE = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const niceTop = (max: number) => NICE.find((n) => n >= max) ?? max;

type Dot = TimelineTemplate & {
  earned: number;
  payers: number | undefined;
  label?: string;
  /** Same name, drawn left of the dot: near the right edge it would clip. */
  labelLeft?: string;
};

/** One dot per template: live projects across, money up, services as size.
 * Both axes are square-root so the long tail near zero spreads out instead
 * of piling into the corner. */
export function TemplateScatter({
  templates,
  payers,
}: {
  templates: TimelineTemplate[];
  payers: Map<string, number>;
}) {
  const dots: Dot[] = templates
    .filter((t) => t.activeProjects > 0 || (t.earned30d ?? 0) > 0)
    .map((t) => ({ ...t, earned: t.earned30d ?? 0, payers: payers.get(t.templateId) }));
  const hidden = templates.length - dots.length;

  const xTop = niceTop(Math.max(1, ...dots.map((d) => d.activeProjects)));
  const yTop = niceTop(Math.max(1, ...dots.map((d) => d.earned)));

  // Name the templates that make the argument (top earners, then the widest
  // reach) wherever the name fits: a label that would land on one already
  // placed, in the chart's square-root space, is left to the tooltip.
  const name = shortNames(templates.map((t) => t.name));
  const placed: [number, number][] = [];
  const pos = (d: Dot) => [Math.sqrt(d.activeProjects / xTop), Math.sqrt(d.earned / yTop)];
  for (const d of [
    ...[...dots].sort((a, b) => b.earned - a.earned).slice(0, 5),
    ...[...dots].sort((a, b) => b.activeProjects - a.activeProjects).slice(0, 5),
  ]) {
    const [x, y] = pos(d);
    if (d.label || d.labelLeft || placed.some(([px, py]) => Math.abs(px - x) < 0.18 && Math.abs(py - y) < 0.06)) continue;
    placed.push([x, y]);
    if (x > 0.8) d.labelLeft = name(d.name);
    else d.label = name(d.name);
  }
  const diagonal = Math.min(xTop, yTop);
  const maxServices = Math.max(1, ...dots.map((d) => d.services));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-(--chart-1)" />
          Earned in the last 30 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-(--chart-other)" />
          Nothing yet
        </span>
        <span>Size: services per template, 1–{maxServices}</span>
      </div>
      <ChartContainer config={{}} className="aspect-auto h-80 w-full">
        <ScatterChart margin={{ top: 12, right: 24, bottom: 20, left: 0 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="activeProjects"
            scale="sqrt"
            domain={[0, xTop]}
            ticks={NICE.filter((n) => n <= xTop)}
            padding={{ left: 14, right: 8 }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            label={{
              value: "Active projects",
              position: "insideBottom",
              offset: -14,
              fill: "var(--muted-foreground)",
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="earned"
            scale="sqrt"
            width={52}
            domain={[0, yTop]}
            ticks={NICE.filter((n) => n <= yTop)}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtUsdTick}
          />
          <ZAxis type="number" dataKey="services" domain={[1, maxServices]} range={[40, 400]} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: diagonal, y: diagonal },
            ]}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            label={{
              value: "$1 per active project",
              position: "insideTopRight",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <Tooltip cursor={false} content={<DotTip />} isAnimationActive={false} />
          {(
            [
              ["Nothing yet", dots.filter((d) => d.earned === 0), "var(--chart-other)"],
              ["Earning", dots.filter((d) => d.earned > 0), "var(--chart-1)"],
            ] as const
          ).map(([name, data, color]) => (
            <Scatter
              key={name}
              name={name}
              data={data}
              fill={color}
              fillOpacity={0.75}
              stroke="var(--card)"
              strokeWidth={1.5}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="label"
                position="right"
                offset={8}
                fill="var(--foreground)"
                fontSize={11}
              />
              <LabelList
                dataKey="labelLeft"
                position="left"
                offset={8}
                fill="var(--foreground)"
                fontSize={11}
              />
            </Scatter>
          ))}
        </ScatterChart>
      </ChartContainer>
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          Not shown: {fmtNum(hidden)} templates with no active projects and no kickback in 30
          days.
        </p>
      )}
    </div>
  );
}

function DotTip({ active, payload }: { active?: boolean; payload?: { payload: Dot }[] }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const rows: [string, string][] = [
    ["Kickback, 30 days", fmtUsd(d.earned)],
    ["Per active project", d.activeProjects > 0 ? fmtUsd(d.earned / d.activeProjects) : "—"],
    ["Paying, 30 days", d.payers != null ? fmtNum(d.payers) : "—"],
    ["Active projects", fmtNum(d.activeProjects)],
    ["Running instances", d.running != null ? fmtNum(d.running) : "—"],
    ["Projects, all time", fmtNum(d.projects)],
    ["Services", fmtNum(d.services)],
  ];
  return (
    <div className="grid min-w-48 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{d.name}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-mono font-medium tabular-nums">{v}</span>
        </div>
      ))}
      {d.publishedAt && (
        <div className="text-muted-foreground">Published {fmtDay(d.publishedAt)}</div>
      )}
    </div>
  );
}
