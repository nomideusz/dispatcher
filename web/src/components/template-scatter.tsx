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
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortName } from "~/lib/format";
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
  const placed: [number, number][] = [];
  const pos = (d: Dot) => [Math.sqrt(d.activeProjects / xTop), Math.sqrt(d.earned / yTop)];
  for (const d of [
    ...[...dots].sort((a, b) => b.earned - a.earned).slice(0, 5),
    ...[...dots].sort((a, b) => b.activeProjects - a.activeProjects).slice(0, 5),
  ]) {
    const [x, y] = pos(d);
    if (d.label || d.labelLeft || placed.some(([px, py]) => Math.abs(px - x) < 0.18 && Math.abs(py - y) < 0.06)) continue;
    placed.push([x, y]);
    if (x > 0.8) d.labelLeft = shortName(d.name);
    else d.label = shortName(d.name);
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

type Segment = {
  key: string;
  templates: number;
  earning: number;
  active: number;
  earned: number;
};

function segment(templates: TimelineTemplate[], keyOf: (t: TimelineTemplate) => string) {
  const by = new Map<string, Segment>();
  for (const t of templates) {
    const key = keyOf(t);
    const s = by.get(key) ?? { key, templates: 0, earning: 0, active: 0, earned: 0 };
    s.templates += 1;
    s.earning += (t.earned30d ?? 0) > 0 ? 1 : 0;
    s.active += t.activeProjects;
    s.earned += t.earned30d ?? 0;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** The same templates cut two ways: by how many services they define, and
 * by the month they were published — plus how long a template takes to
 * start paying, which says how soon a new batch can be judged. */
export function TemplateSegments({ templates }: { templates: TimelineTemplate[] }) {
  const bySize = segment(templates, (t) => (t.services >= 4 ? "4+" : String(t.services)));
  const byMonth = segment(templates, (t) => t.publishedAt?.slice(0, 7) ?? "unknown");

  const lags = templates
    .filter((t) => t.publishedAt && t.firstPaidAt)
    .map((t) => (Date.parse(t.firstPaidAt!) - Date.parse(t.publishedAt!)) / 86_400_000)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const median = lags.length > 0 ? lags[Math.floor(lags.length / 2)] : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <SegmentTable title="Services per template" rows={bySize} />
        <SegmentTable
          title="Published"
          rows={byMonth}
          format={(k) => (k === "unknown" ? k : monthFmt.format(new Date(`${k}-01T00:00:00Z`)))}
        />
      </div>
      {median != null && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Publish to first kickback: {Math.round(median)} days
          </span>{" "}
          median across the {lags.length} templates that have paid (fastest{" "}
          {Math.round(lags[0])}, slowest {Math.round(lags[lags.length - 1])}). A template younger
          than that hasn&apos;t had its chance yet.
        </p>
      )}
    </div>
  );
}

function SegmentTable({
  title,
  rows,
  format = (k) => k,
}: {
  title: string;
  rows: Segment[];
  format?: (key: string) => string;
}) {
  const best = Math.max(0, ...rows.map((r) => (r.active > 0 ? r.earned / r.active : 0)));
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="pb-2 font-medium">{title}</th>
          <th className="pb-2 pl-3 text-right font-medium">Templates</th>
          <th className="pb-2 pl-3 text-right font-medium">Earning</th>
          <th className="pb-2 pl-3 text-right font-medium">Active</th>
          <th className="pb-2 pl-3 text-right font-medium">30d</th>
          <th className="pb-2 pl-3 font-medium">Per active project</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const per = r.active > 0 ? r.earned / r.active : null;
          return (
            <tr key={r.key} className="border-b border-border/50 last:border-0">
              <td className="py-2">{format(r.key)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(r.templates)}</td>
              <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                {fmtNum(r.earning)}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(r.active)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{fmtUsd(r.earned)}</td>
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-right tabular-nums">
                    {per == null ? "—" : fmtUsd(per)}
                  </span>
                  <span className="h-1.5 flex-1 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-(--chart-1)"
                      style={{ width: `${best > 0 && per ? (per / best) * 100 : 0}%` }}
                    />
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
