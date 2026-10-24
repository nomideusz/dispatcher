import {
  CartesianGrid,
  LabelList,
  ReferenceArea,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { GROUPS, groupOf, Key } from "~/components/chart-kit";
import { ChartContainer } from "~/components/ui/chart";
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import type { TimelineTemplate } from "~/queries/analytics";

/** log10(1 + v): a log axis that still has a place for zero. Templates
 * span 0 to 1,000 projects and $0 to $100, most of them under 20 and $10;
 * on this scale each decade gets the same room. */
const f = (v: number) => Math.log10(1 + v);
const NICE = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const niceTop = (max: number) => NICE.find((n) => n >= max) ?? max;
const fromTick = (t: number) => NICE.find((n) => Math.abs(f(n) - t) < 1e-9) ?? Math.round(10 ** t - 1);

/** Templates with nothing in 30 days sit in their own row below $0,
 * spread a little so dozens of them don't print as one dot. */
const NONE_Y = -0.3;
const NONE_BAND = 0.09;
/** Constant kickback per active project: straight diagonals on log axes. */
const RATES = [0.1, 1, 10];

type Dot = TimelineTemplate & {
  x: number;
  y: number;
  earned: number;
  payers: number | undefined;
  label?: string;
  /** Same name, drawn left of the dot: near the right edge it would clip. */
  labelLeft?: string;
};

/** One dot per template: live projects across, last 30 days of kickback up,
 * template size as colour. Parallel diagonals mark what one active project
 * pays a month, so a dot's distance above or below them is how well its
 * users convert to money. */
export function TemplateScatter({
  templates,
  payers,
}: {
  templates: TimelineTemplate[];
  payers: Map<string, number>;
}) {
  const shown = templates.filter((t) => t.activeProjects > 0 || (t.earned30d ?? 0) > 0);
  const hidden = templates.length - shown.length;
  let none = 0;
  const dots: Dot[] = shown.map((t) => {
    const earned = t.earned30d ?? 0;
    // A stable fan of offsets across the row.
    const spread = earned > 0 ? 0 : ((none++ % 5) - 2) / 2;
    return {
      ...t,
      earned,
      payers: payers.get(t.templateId),
      x: f(t.activeProjects),
      y: earned > 0 ? f(earned) : NONE_Y + spread * NONE_BAND * 0.6,
    };
  });

  const xTop = niceTop(Math.max(10, ...dots.map((d) => d.activeProjects)));
  const yTop = niceTop(Math.max(10, ...dots.map((d) => d.earned)));
  const [X, Y] = [f(xTop), f(yTop)];

  // Name the templates that make the argument (top earners, then the widest
  // reach) wherever the name fits: a label that would land on one already
  // placed is left to the tooltip.
  const name = shortNames(templates.map((t) => t.name));
  const placed: [number, number][] = [];
  for (const d of [
    ...[...dots].sort((a, b) => b.earned - a.earned).slice(0, 6),
    ...[...dots].sort((a, b) => b.activeProjects - a.activeProjects).slice(0, 4),
  ]) {
    const [x, y] = [d.x / X, (d.y - NONE_Y) / (Y - NONE_Y)];
    if (d.label || d.labelLeft || placed.some(([px, py]) => Math.abs(px - x) < 0.2 && Math.abs(py - y) < 0.06)) continue;
    placed.push([x, y]);
    if (x > 0.75) d.labelLeft = name(d.name);
    else d.label = name(d.name);
  }

  // Each rate line from where it enters the plot to where it leaves.
  const rates = RATES.map((rate) => {
    const from = Math.max(1, 1 / rate);
    const to = Math.min(xTop, yTop / rate);
    const pts = Array.from({ length: 24 }, (_, i) => {
      const a = from * (to / from) ** (i / 23);
      return { x: f(a), y: f(a * rate), label: undefined as string | undefined };
    });
    pts[pts.length - 1].label = rate < 1 ? `${rate * 100}¢` : fmtUsdTick(rate);
    return { rate, pts };
  });

  const earning = dots.filter((d) => d.earned > 0);
  const idle = dots.filter((d) => d.earned === 0);
  const above = earning.filter((d) => d.activeProjects > 0 && d.earned / d.activeProjects >= 1).length;
  const labels = (side: "right" | "top") => (
    <>
      <LabelList dataKey="label" position={side} offset={8} fill="var(--foreground)" fontSize={11} />
      <LabelList dataKey="labelLeft" position="left" offset={8} fill="var(--foreground)" fontSize={11} />
    </>
  );

  return (
    <div className="space-y-3">
      <Key
        items={[
          ...GROUPS.map((g) => ({ label: g.label, color: g.color })),
          { label: "Kickback per active project, a month", color: "var(--muted-foreground)", line: true, dashed: true },
        ]}
      />
      <ChartContainer config={{}} className="aspect-auto h-96 w-full">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 20, left: 0 }}>
          <CartesianGrid strokeOpacity={0.6} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, X]}
            ticks={NICE.filter((n) => n <= xTop).map(f)}
            tickFormatter={(t: number) => fmtNum(fromTick(t))}
            padding={{ left: 10, right: 6 }}
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
            dataKey="y"
            width={56}
            domain={[NONE_Y - NONE_BAND, Y]}
            ticks={[NONE_Y, ...NICE.filter((n) => n > 0 && n <= yTop).map(f)]}
            tickFormatter={(t: number) => (t < 0 ? "none" : fmtUsdTick(fromTick(t)))}
            tickLine={false}
            axisLine={false}
          />
          <ZAxis range={[64, 64]} />
          <ReferenceArea
            y1={NONE_Y - NONE_BAND}
            y2={NONE_Y + NONE_BAND}
            fill="var(--muted)"
            fillOpacity={0.6}
            stroke="none"
          />
          <Tooltip cursor={false} content={<DotTip />} isAnimationActive={false} />
          {rates.map(({ rate, pts }) => (
            <Scatter
              key={rate}
              data={pts}
              line={{ stroke: "var(--muted-foreground)", strokeOpacity: rate === 1 ? 0.7 : 0.35, strokeDasharray: "4 4" }}
              shape={() => <g />}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            >
              <LabelList dataKey="label" position="left" offset={4} fill="var(--muted-foreground)" fontSize={11} />
            </Scatter>
          ))}
          {GROUPS.map((g, i) => (
            <Scatter
              key={`idle-${g.label}`}
              data={idle.filter((d) => groupOf(d) === i)}
              fill="var(--card)"
              stroke={g.color}
              strokeWidth={1.5}
              isAnimationActive={false}
            >
              {labels("top")}
            </Scatter>
          ))}
          {GROUPS.map((g, i) => (
            <Scatter
              key={g.label}
              data={earning.filter((d) => groupOf(d) === i)}
              fill={g.color}
              fillOpacity={0.85}
              stroke="var(--card)"
              strokeWidth={1.5}
              isAnimationActive={false}
            >
              {labels("right")}
            </Scatter>
          ))}
        </ScatterChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        {fmtNum(earning.length)} templates earned in the last 30 days, {fmtNum(above)} of them $1 or
        more per active project. {fmtNum(idle.length)} have live projects and earned nothing (the
        bottom row)
        {hidden > 0 ? `; ${fmtNum(hidden)} more have neither and are not shown` : ""}. Both axes
        are logarithmic.
      </p>
    </div>
  );
}

function DotTip({ active, payload }: { active?: boolean; payload?: { payload: Dot }[] }) {
  const d = payload?.[0]?.payload;
  if (!active || !d?.templateId) return null;
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
