import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { fmtFill } from "~/components/health-watch";
import { DOCKET, DocketCell, Fig } from "~/components/page";
import { RangeToggle } from "~/components/range-toggle";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "~/components/ui/chart";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { DAY, HEALTH_FLOOR } from "~/lib/catalog";
import { fmtDay, fmtDayTime, fmtNum, shortName } from "~/lib/format";
import {
  badOf25,
  type HealthMove,
  type HealthRead,
  healthMoves,
  isFast,
  SCORED_DEPLOYS,
  type SearchStake,
  SLOW_FILL_DAYS,
  WATCH_DAYS,
} from "~/lib/health";
import { cn } from "~/lib/utils";
import { type ProjectPoint, type TimelineTemplate, templateProjectsQuery } from "~/queries/analytics";

/** To 25 above this draws at the top of its panel: past a few months the
 * figure only says "slow". */
const FILL_CAP = 120;
const HOUR = 3_600_000;

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const signed = (d: number) => (d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}`);

/** New projects in each hourly step: Railway's count rising. A fall is a
 * project taken out, not a negative arrival. */
function arrivals(points: ProjectPoint[]) {
  return points.map((p, i) => ({ t: Date.parse(p.sampledAt), n: i === 0 ? 0 : Math.max(0, p.projects - points[i - 1].projects) }));
}

/** Per UTC day from `from`: the day's new projects, and To 25 at the
 * day's end over the WATCH_DAYS before it. */
function daily(points: ProjectPoint[], from: number) {
  const arr = arrivals(points);
  if (arr.length === 0) return [];
  const first = Math.floor(Math.max(from, arr[0].t) / DAY) * DAY;
  const last = Math.floor(arr[arr.length - 1].t / DAY) * DAY;
  // Not `fill`: Recharts paints a bar in its row's `fill`, and days aren't a colour.
  const out: { t: number; day: string; newProjects: number; fillDays: number | null; fillShown: number | null }[] = [];
  for (let d = first; d <= last; d += DAY) {
    const end = d + DAY;
    const newProjects = arr.reduce((s, a) => (a.t >= d && a.t < end ? s + a.n : s), 0);
    // Only once the series holds the whole stretch before the day's end.
    const full = arr[0].t <= end - WATCH_DAYS * DAY + HOUR;
    const inStretch = arr.reduce((s, a) => (a.t >= end - WATCH_DAYS * DAY && a.t < end ? s + a.n : s), 0);
    const fillDays = full ? (inStretch === 0 ? Infinity : (SCORED_DEPLOYS * WATCH_DAYS) / inStretch) : null;
    out.push({ t: d + DAY / 2, day: new Date(d).toISOString().slice(0, 10), newProjects, fillDays, fillShown: fillDays == null ? null : Math.min(fillDays, FILL_CAP) });
  }
  return out;
}

const hourMinute = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function axis(min: number, max: number) {
  const spansDays = max - min > 3 * DAY;
  return {
    dataKey: "t",
    type: "number" as const,
    domain: [min, max] as [number, number],
    tickLine: false,
    axisLine: false,
    tickMargin: 8,
    tickCount: 4,
    tickFormatter: (v: number) => (spansDays ? fmtDay(new Date(v).toISOString()) : hourMinute.format(new Date(v))),
  };
}

function Panel({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span> · {note}
      </div>
      {children}
    </div>
  );
}

/** The marks every panel carries: the day a fix was pushed and the day the
 * pins last moved. */
function Marks({ fixAt, upgradeAt }: { fixAt: number | null; upgradeAt: number | null }) {
  return (
    <>
      {fixAt != null && <ReferenceLine x={fixAt} stroke="var(--chart-5)" strokeWidth={1.5} />}
      {upgradeAt != null && <ReferenceLine x={upgradeAt} stroke="var(--chart-3)" strokeWidth={1.5} strokeDasharray="4 2" />}
    </>
  );
}

/** `show` reads the hovered row: To 25 shows its uncapped figure, not the
 * capped one it is drawn at. */
const tooltip = (show: (row: Record<string, unknown>, value: number) => string, label: string) => (
  <ChartTooltip
    content={
      <ChartTooltipContent
        labelFormatter={(_, payload) => {
          const p = payload?.[0]?.payload;
          return p?.sampledAt ? `${fmtDayTime(p.sampledAt)} UTC` : p?.day ? fmtDay(p.day) : "";
        }}
        formatter={(value, _name, item) => (
          <div className="flex flex-1 items-center justify-between gap-4 leading-none">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {show(item.payload, Number(value))}
            </span>
          </div>
        )}
      />
    }
  />
);

/** One template's health in full: hour by hour against the projects that
 * arrived, how fast its scored set turns over, every move with what moved
 * beside it, and the searches it shows in. */
export function HealthDetail({
  templates,
  selected,
  onSelect,
  read,
  stake,
  upgradedOn,
}: {
  /** Scored templates to pick from. */
  templates: TimelineTemplate[];
  selected: TimelineTemplate;
  onSelect: (templateId: string) => void;
  read: HealthRead | null;
  stake: SearchStake | null;
  upgradedOn: string;
}) {
  const [days, setDays] = useState<number>(30);
  // The stretch before the range too, so To 25 starts on the range's first day.
  const q = useQuery(templateProjectsQuery(selected.templateId, days === 0 ? 0 : days + WATCH_DAYS));
  const points = q.data?.points ?? [];
  const end = points.length ? Date.parse(points[points.length - 1].sampledAt) : Date.now();
  const from = days === 0 ? (points.length ? Date.parse(points[0].sampledAt) : end) : end - days * DAY;
  const shown = points.filter((p) => Date.parse(p.sampledAt) >= from);
  const hourly = shown.map((p) => ({ t: Date.parse(p.sampledAt), sampledAt: p.sampledAt, health: p.health }));
  const perDay = daily(points, from);
  const moves = healthMoves(shown);
  const withNew = moves.filter((m) => m.newProjects > 0).length;
  const min = hourly[0]?.t ?? from;
  const max = hourly[hourly.length - 1]?.t ?? end;
  const inRange = (day: string) => {
    if (!day) return null;
    const t = Date.parse(`${day}T00:00:00Z`);
    return t > min && t <= max ? t : null;
  };
  const fixAt = inRange(selected.fixedOn);
  const upgradeAt = inRange(upgradedOn);
  const fast = read != null && isFast(read);
  const sorted = [...templates].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));
  const config = { health: { label: "Health", color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="relative">
          <select
            value={selected.templateId}
            aria-label="Template"
            onChange={(e) => onSelect(e.target.value)}
            className="h-9 max-w-[min(32rem,calc(100vw-2rem))] appearance-none border border-input bg-transparent pr-8 pl-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sorted.map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.name} · {t.health?.toFixed(0)}%
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          These charts
          <RangeToggle value={days} onChange={setDays} />
        </div>
      </div>

      <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
        <DocketCell small label="Health" value={read ? `${read.now.toFixed(0)}%` : "—"}>
          {read && (fast ? <p>{plural(badOf25(read.now), "deploy")} of {SCORED_DEPLOYS} down</p> : <p>fewer than {SCORED_DEPLOYS} likely scored</p>)}
          {read?.change != null && <p><Fig>{signed(read.change)}</Fig> over {WATCH_DAYS} days</p>}
        </DocketCell>
        <DocketCell small label={`To ${SCORED_DEPLOYS}`} value={read?.fillDays == null ? "—" : fmtFill(read.fillDays)}>
          {read?.fillDays != null && (
            <p>{fast ? "new deploys set the score; a fix shows in days" : "the instances already running set the score"}</p>
          )}
          {read?.newProjects != null && <p><Fig>{fmtNum(read.newProjects)}</Fig> new, <Fig>{fmtNum(read.redeploys ?? 0)}</Fig> redeploys in {WATCH_DAYS} days</p>}
        </DocketCell>
        <DocketCell small label="Fix and upgrade" value={selected.fixedOn ? fmtDay(selected.fixedOn) : "—"}>
          <p>{selected.fixedOn ? `fix pushed${read?.fix?.newSince != null ? `, ${plural(read.fix.newSince, "new project")} since` : ""}` : "no fix recorded"}</p>
          <p>{upgradedOn ? <>pins last moved <Fig>{fmtDay(upgradedOn)}</Fig></> : "no upgrade recorded"}</p>
        </DocketCell>
        <DocketCell small label="Search" value={stake == null ? null : stake[0] ? `#${stake[0].position}` : "—"}>
          {stake?.[0] ? (
            <p>
              for &ldquo;{stake[0].query}&rdquo;{stake.length > 1 && <>, listed for <Fig>{fmtNum(stake.length)}</Fig></>}
            </p>
          ) : (
            stake && <p>not in the top results for any tracked keyword</p>
          )}
        </DocketCell>
      </div>

      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load this template&apos;s hourly history. Reload to try again.
        </p>
      )}
      {q.data && hourly.length === 0 && <p className="text-sm text-muted-foreground">No published samples in this range.</p>}

      {hourly.length > 0 && (
        <div className={cn("grid gap-6 lg:grid-cols-3", q.isPlaceholderData && "opacity-60")}>
          <Panel label="Health" note={`hour by hour; the dashed line is ${HEALTH_FLOOR}%`}>
            <ChartContainer config={config} className="aspect-auto h-36 w-full">
              <AreaChart accessibilityLayer data={hourly} syncId="health-detail" syncMethod="value" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis {...axis(min, max)} />
                <YAxis tickLine={false} axisLine={false} width={40} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => `${v}%`} />
                <ReferenceLine y={HEALTH_FLOOR} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.6} />
                <Marks fixAt={fixAt} upgradeAt={upgradeAt} />
                {tooltip((_, v) => `${v.toFixed(0)}%`, "Health")}
                <Area dataKey="health" type="stepAfter" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.1} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          </Panel>
          <Panel label="New projects" note="per day; a busy day moves a fast template's score">
            <ChartContainer config={{ newProjects: { label: "New projects", color: "var(--chart-2)" } }} className="aspect-auto h-36 w-full">
              <BarChart accessibilityLayer data={perDay} syncId="health-detail" syncMethod="value" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis {...axis(min, max)} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickCount={3} />
                <Marks fixAt={fixAt} upgradeAt={upgradeAt} />
                {tooltip((_, v) => fmtNum(v), "New projects")}
                <Bar dataKey="newProjects" fill="var(--chart-2)" isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </Panel>
          <Panel label={`To ${SCORED_DEPLOYS}`} note={`days over the ${WATCH_DAYS} before each day; the dashed line is ${SLOW_FILL_DAYS}`}>
            <ChartContainer config={{ fillShown: { label: `To ${SCORED_DEPLOYS}`, color: "var(--chart-4)" } }} className="aspect-auto h-36 w-full">
              <AreaChart accessibilityLayer data={perDay} syncId="health-detail" syncMethod="value" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis {...axis(min, max)} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={[0, FILL_CAP]}
                  ticks={[0, SLOW_FILL_DAYS, FILL_CAP]}
                  tickFormatter={(v: number) => (v === FILL_CAP ? `${v}d+` : `${v}d`)}
                />
                <ReferenceLine y={SLOW_FILL_DAYS} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.6} />
                <Marks fixAt={fixAt} upgradeAt={upgradeAt} />
                {tooltip((row) => (row.fillDays === Infinity ? "no new projects" : fmtFill(row.fillDays as number)), `To ${SCORED_DEPLOYS}`)}
                <Area dataKey="fillShown" type="stepAfter" stroke="var(--chart-4)" strokeWidth={2} fill="var(--chart-4)" fillOpacity={0.1} dot={false} connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          </Panel>
        </div>
      )}
      {(fixAt != null || upgradeAt != null) && (
        <p className="text-xs text-muted-foreground">
          {fixAt != null && <>The solid upright line is the fix pushed {fmtDay(selected.fixedOn)}. </>}
          {upgradeAt != null && <>The dashed one is the day its pins last moved, {fmtDay(upgradedOn)}.</>}
        </p>
      )}

      {hourly.length > 0 && (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-2 lg:col-span-7">
            <div>
              <h3 className="font-semibold">Every move</h3>
              <p className="text-sm text-muted-foreground">
                {moves.length === 0 ? (
                  "Health didn't move in this range."
                ) : (
                  <>
                    <Fig>{fmtNum(moves.length)}</Fig> {moves.length === 1 ? "change" : "changes"}, <Fig>{fmtNum(withNew)}</Fig> in the same hour as a
                    new project. A move with no new project is an instance already running changing state, which no push reaches.
                  </>
                )}
              </p>
            </div>
            {moves.length > 0 && <MovesTable moves={moves} />}
          </div>
          <div className="min-w-0 space-y-2 max-lg:border-t max-lg:pt-4 lg:col-span-5 lg:border-l lg:pl-8">
            <div>
              <h3 className="font-semibold">In search</h3>
              <p className="text-sm text-muted-foreground">
                Keywords it shows for in the latest run. Exactly 100 is the top band; 70 to 99 rank as one, and under {HEALTH_FLOOR} it sorts below
                unscored listings.
              </p>
            </div>
            {stake == null ? <Skeleton className="h-24 w-full" /> : stake.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not in the top results for any tracked keyword. <Link to="/search" className="text-primary underline underline-offset-3">Search</Link> lists them.
              </p>
            ) : (
              <StakeTable stake={stake} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function moveReading(m: HealthMove) {
  if (m.newProjects > 0) return `${plural(m.newProjects, "new project")} that hour`;
  if (m.lostActive > 0) return `${plural(m.lostActive, "project")} stopped or removed`;
  return "no project change";
}

function MovesTable({ moves }: { moves: HealthMove[] }) {
  return (
    <Table rows={moves.length} limit={50}>
      <TableHeader>
        <TableRow>
          <TableHead>When (UTC)</TableHead>
          <TableHead numeric>Health</TableHead>
          <TableHead numeric hint="Four points is one deploy of 25. Other steps mean fewer than 25 are scored">
            Points
          </TableHead>
          <TableHead>With it</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {moves.map((m) => (
          <TableRow key={m.at}>
            <TableRowHead className="tabular-nums">{fmtDayTime(m.at)}</TableRowHead>
            <TableCell numeric>
              {m.from.toFixed(0)} → {m.to.toFixed(0)}
            </TableCell>
            <TableCell numeric>{signed(m.to - m.from)}</TableCell>
            <TableCell className={cn("text-xs", m.newProjects === 0 && "text-muted-foreground")}>{moveReading(m)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StakeTable({ stake }: { stake: SearchStake }) {
  return (
    <Table rows={stake.length} limit={50}>
      <TableHeader>
        <TableRow>
          <TableHead>Keyword</TableHead>
          <TableHead numeric>Position</TableHead>
          <TableHead numeric hint="Projects deployed in 90 days from every template the search returns">
            Demand
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stake.map((k) => (
          <TableRow key={k.query}>
            <TableRowHead>{k.query}</TableRowHead>
            <TableCell numeric title={k.ourBest != null && k.ourBest < k.position ? `Another of ours ranks #${k.ourBest}` : undefined}>
              #{k.position}
              {k.ourBest != null && k.ourBest < k.position && <span className="text-muted-foreground"> (ours #{k.ourBest})</span>}
            </TableCell>
            <TableCell numeric>{fmtNum(k.demand)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
