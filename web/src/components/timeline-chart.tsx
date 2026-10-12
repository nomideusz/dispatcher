import { type ReactNode, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "~/components/ui/chart";
import {
  dayKey,
  fmtCents,
  fmtDay,
  fmtLongDay,
  fmtNum,
  fmtUsdTick,
  shortName,
} from "~/lib/format";
import type { TimelinePoint, TimelineResponse } from "~/queries/analytics";

/** Every panel reserves the same gutter, so the plots line up day for day. */
const Y_WIDTH = 52;

const COLOR = {
  earned: "var(--chart-1)",
  newProjects: "var(--chart-3)",
  active: "var(--chart-3)",
  running: "var(--chart-4)",
  published: "var(--chart-5)",
  services: "var(--chart-other)",
};

type Row = TimelinePoint & { earned: number; avg7: number | null };

/** Runs of days without a usage sample: before tracking began, or a
 * collection gap. The counts are unknown there, not zero. */
function missingRuns(points: TimelinePoint[], trackedDay: string) {
  const runs: { from: string; to: string; untracked: boolean }[] = [];
  points.forEach((p, i) => {
    if (p.activeProjects != null) return;
    const last = runs[runs.length - 1];
    if (last && i > 0 && last.to === points[i - 1].date) last.to = p.date;
    else runs.push({ from: p.date, to: p.date, untracked: p.date < trackedDay });
  });
  return runs;
}

/** Kickback, new projects, live projects and the catalog on one time axis:
 * four small charts, one scale each, hovering together. The panel on the
 * right reads out the hovered day, down to which templates moved. */
export function TimelineChart({ data }: { data: TimelineResponse }) {
  const { points } = data;
  const [hover, setHover] = useState<number | null>(null);
  const index = hover ?? points.length - 1;

  const rows: Row[] = useMemo(
    () =>
      points.map((p, i) => ({
        ...p,
        earned: p.earnedCents / 100,
        avg7:
          i >= 6
            ? points.slice(i - 6, i + 1).reduce((s, q) => s + q.earnedCents, 0) / 700
            : null,
      })),
    [points],
  );

  const shade = useMemo(
    () => missingRuns(points, dayKey(data.trackedSince)),
    [points, data.trackedSince],
  );
  const areas = shade.map((r) => (
    <ReferenceArea
      key={r.from}
      x1={r.from}
      x2={r.to}
      fill="var(--foreground)"
      fillOpacity={0.04}
      ifOverflow="hidden"
    />
  ));

  const track = (s: { activeTooltipIndex?: number | string | null }) => {
    const i = Number(s.activeTooltipIndex);
    if (s.activeTooltipIndex != null && Number.isFinite(i)) setHover(i);
  };
  const chartProps = {
    data: rows,
    syncId: "timeline",
    // Room below for the 0 tick on panels without an x axis.
    margin: { top: 6, right: 8, left: 0, bottom: 6 },
    onMouseMove: track,
    onMouseLeave: () => setHover(null),
  };
  const axes = (showX: boolean, format: (v: number) => string) => (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="date"
        // Band on every panel, bars or not, so the days line up across them.
        scale="band"
        hide={!showX}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={40}
        tickFormatter={fmtDay}
      />
      <YAxis
        width={Y_WIDTH}
        tickLine={false}
        axisLine={false}
        tickCount={3}
        interval={0}
        allowDecimals={false}
        domain={[0, "auto"]}
        tickFormatter={format}
      />
      <Tooltip
        content={() => null}
        cursor={{ stroke: "var(--border)", fill: "var(--foreground)", fillOpacity: 0.05 }}
        isAnimationActive={false}
      />
    </>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-3">
        <Panel
          title="Kickback earned"
          keys={[
            { label: "per day", color: COLOR.earned },
            { label: "7-day average", color: "var(--muted-foreground)", line: true },
          ]}
        >
          <ChartContainer config={{}} className="aspect-auto h-32 w-full">
            <ComposedChart {...chartProps}>
              {axes(false, fmtUsdTick)}
              <Bar dataKey="earned" fill={COLOR.earned} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Line dataKey="avg7" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
        </Panel>

        <Panel title="New projects" keys={[{ label: "per day", color: COLOR.newProjects }]}>
          <ChartContainer config={{}} className="aspect-auto h-20 w-full">
            <ComposedChart {...chartProps}>
              {axes(false, fmtNum)}
              {areas}
              <Bar dataKey="newProjects" fill={COLOR.newProjects} radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
        </Panel>

        <Panel
          title="Live now"
          keys={[
            { label: "Active projects", color: COLOR.active, line: true },
            { label: "Running instances", color: COLOR.running, line: true },
          ]}
        >
          <ChartContainer config={{}} className="aspect-auto h-28 w-full">
            <ComposedChart {...chartProps}>
              {axes(false, fmtNum)}
              {areas}
              <Line dataKey="activeProjects" stroke={COLOR.active} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="running" stroke={COLOR.running} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
        </Panel>

        <Panel
          title="Catalog"
          keys={[
            { label: "Published templates", color: COLOR.published, line: true },
            { label: "Services they define", color: COLOR.services, line: true },
          ]}
        >
          <ChartContainer config={{}} className="aspect-auto h-28 w-full">
            <ComposedChart {...chartProps}>
              {axes(true, fmtNum)}
              <Line type="stepAfter" dataKey="published" stroke={COLOR.published} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="services" stroke={COLOR.services} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
        </Panel>
        {shade.length > 0 && (
          <p className="pl-13 text-xs text-muted-foreground">
            Shaded days have no sample —{" "}
            {shade.some((r) => r.untracked) && "before tracking began, "}
            {shade.some((r) => !r.untracked) && "a collection gap, whose new projects land on the day after it, "}
            so project counts are unknown there, not zero. Kickback is still read from Railway&apos;s totals.
          </p>
        )}
      </div>

      <DayDetail data={data} point={points[index]} pinned={hover == null} />
    </div>
  );
}

function Panel({
  title,
  keys,
  children,
}: {
  title: string;
  keys: { label: string; color: string; line?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-13 text-xs">
        <span className="font-medium">{title}</span>
        {keys.map((k) => (
          <span key={k.label} className="flex items-center gap-1.5 text-muted-foreground">
            <Swatch color={k.color} line={k.line} />
            {k.label}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
  ) : (
    <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
  );
}

/** The hovered day in full — which templates earned, which got deployed,
 * what was published. Pinned to the latest day when nothing is hovered. */
function DayDetail({
  data,
  point,
  pinned,
}: {
  data: TimelineResponse;
  point: TimelinePoint;
  pinned: boolean;
}) {
  const { date } = point;
  const moved = data.templates
    .map((t) => ({ t, a: t.activity.find((a) => a.date === date) }))
    .filter((x) => x.a != null);
  const earners = moved
    .filter((x) => x.a!.earnedCents > 0)
    .sort((a, b) => b.a!.earnedCents - a.a!.earnedCents);
  const deployed = moved
    .filter((x) => x.a!.newProjects > 0)
    .sort((a, b) => b.a!.newProjects - a.a!.newProjects);
  const added = data.templates.filter(
    (t) => t.publishedAt && dayKey(t.publishedAt) === date,
  );
  const catchUp = data.gaps.find((g) => dayKey(g.to) === date);

  return (
    <aside className="space-y-4 border-t pt-4 text-sm lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      <div>
        <div className="font-medium">{fmtLongDay(date)}</div>
        <div className="text-xs text-muted-foreground">
          {pinned ? "Latest day · hover the chart to move" : "Hovered day"}
        </div>
      </div>

      <DetailBlock
        color={COLOR.earned}
        label="Kickback earned"
        value={fmtCents(point.earnedCents)}
        items={earners.map(({ t, a }) => [shortName(t.name), fmtCents(a!.earnedCents)])}
      />
      <DetailBlock
        color={COLOR.newProjects}
        label="New projects"
        value={fmtNum(point.newProjects)}
        items={deployed.map(({ t, a }) => [shortName(t.name), fmtNum(a!.newProjects)])}
        note={
          catchUp && point.newProjects > 0
            ? `Includes projects that arrived since ${fmtDay(catchUp.from)}, during the collection gap.`
            : undefined
        }
      />
      <div className="space-y-1.5">
        <DetailRow color={COLOR.active} label="Active projects" value={point.activeProjects} />
        <DetailRow color={COLOR.running} label="Running instances" value={point.running} />
        <DetailRow label="Projects, all time" value={point.projects} />
      </div>
      <div className="space-y-1.5">
        <DetailRow color={COLOR.published} label="Published templates" value={point.published} />
        <DetailRow color={COLOR.services} label="Services" value={point.services} />
        {added.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Published this day: {added.map((t) => shortName(t.name)).join(", ")}
          </p>
        )}
      </div>
    </aside>
  );
}

function DetailBlock({
  color,
  label,
  value,
  items,
  note,
}: {
  color: string;
  label: string;
  value: string;
  items: [string, string][];
  note?: string;
}) {
  const shown = items.slice(0, 5);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Swatch color={color} />
          {label}
        </span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      {shown.length > 0 && (
        <ul className="space-y-0.5 pl-4.5 text-xs text-muted-foreground">
          {/* Index keys: short names collide (eight "Linux Desktop" templates), and
              duplicate keys make React leave stale rows behind on every hover. */}
          {shown.map(([name, v], i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">{name}</span>
              <span className="tabular-nums">{v}</span>
            </li>
          ))}
          {items.length > shown.length && <li>+{items.length - shown.length} more</li>}
        </ul>
      )}
      {note && <p className="pl-4.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function DetailRow({
  color,
  label,
  value,
}: {
  color?: string;
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        {color ? <Swatch color={color} line /> : <span className="w-3" />}
        {label}
      </span>
      <span className="tabular-nums">
        {value == null ? <span className="text-muted-foreground">no sample</span> : fmtNum(value)}
      </span>
    </div>
  );
}
