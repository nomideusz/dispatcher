import type { ReactNode } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, Key, shareTop, Tip, tick } from "~/components/chart-kit";
import { DOCKET, DocketCell, Fig, Section } from "~/components/page";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { VerdictGuide } from "~/components/verdict-guide";
import { kindLabel } from "~/components/what-to-publish";
import { ageDays, DAY, earned30, EDGE_CODE, FAIR_CHANCE_DAYS, HEALTH_FLOOR, inUse, lifeOf, notTakenUp, paidCurve, publishedOn } from "~/lib/catalog";
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { ORIGINS, type TimelineResponse, type TimelineTemplate, type VerdictsResponse } from "~/queries/analytics";
import type { PayerChain } from "~/queries/payouts";

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Most recent publishing months shown on their own; older ones share a layer. */
const SEPARATE_MONTHS = 3;
/** Skips the running green: beside teal it fails the validator's normal-vision floor. */
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** The age chart stops here: past it only the oldest batch has a line. */
const AGE_DAYS = 60;
/** Almost nothing is paid in the first two weeks, so a shorter line shows nothing. */
const MIN_LINE_DAYS = 14;
/** A batch's line stops once fewer of its templates than this are that old:
 * under it one payer swings the line 10+ points. */
const MIN_BATCH = 10;
/** Shorter collection gaps don't move a weekly figure. */
const NOTABLE_GAP = 2 * DAY;
/** A payer still counts for a day past the estimated next invoice, so an invoice
 * that lands a little late doesn't read as a lapse. Our allowance, not Railway's. */
const PAYER_GRACE = DAY;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
/** The word joiner keeps a minus on the same line as its figure. */
const signed = (v: number, abs: string) => `${v >= 0 ? "+" : "−⁠"}${abs}`;
export const signedUsd = (v: number) => signed(v, fmtUsd(Math.abs(v)));
const signedNum = (v: number) => signed(v, fmtNum(Math.abs(v)));

/** Invoices a payer had sent by a moment. Between the first and the last
 * they are spread evenly, which is how a monthly bill falls. */
const invoicesBy = (p: PayerChain, at: number) => {
  const first = Date.parse(p.firstAt);
  const last = Date.parse(p.lastAt);
  if (at < first) return 0;
  if (at >= last || p.invoices < 2) return p.invoices;
  return 1 + Math.floor(((at - first) / (last - first)) * (p.invoices - 1));
};

type Batch = { key: string; label: string; color: string; templates: TimelineTemplate[] };

/** Templates by the month they were published: the newest months apart, the
 * rest as one "before" layer. Oldest first, so colours stay with the batch. */
function batchesOf(templates: TimelineTemplate[]): Batch[] {
  const months = [...new Set(templates.map((t) => publishedOn(t).slice(0, 7)))].sort();
  const separate = months.slice(-SEPARATE_MONTHS);
  const older = months.length > separate.length;
  const keys = older ? ["before", ...separate] : separate;
  return keys.map((key, i) => ({
    key,
    label: key === "before" ? `Before ${monthLabel(separate[0])}` : monthLabel(key),
    color: COLORS[i],
    templates: templates.filter((t) => {
      const month = publishedOn(t).slice(0, 7);
      return key === "before" ? month < separate[0] : month === key;
    }),
  }));
}

export type StrategyModel = ReturnType<typeof buildStrategy>;

export function buildStrategy(data: TimelineResponse, payers: PayerChain[]) {
  const { templates, points } = data;
  const batches = batchesOf(templates);
  const today = data.sampledAt.slice(0, 10);

  /** What each batch earned in the 30 days to `end`. Railway's own figure is a
   * rolling 30×24h, which touches 31 dates, so this counts 31 to agree with it. */
  const earnedBy = (end: string) => {
    const from = iso(utc(end) - 30 * DAY);
    return batches.map((b) =>
      b.templates.reduce(
        (s, t) => s + t.activity.reduce((n, a) => (a.date >= from && a.date <= end ? n + a.earnedCents / 100 : n), 0),
        0,
      ),
    );
  };

  /** The catalog, its payers and its month of kickback, as of the end of a day. */
  const snapshot = (end: string) => {
    const seen = points.filter((p) => p.date <= end);
    const lastWith = (key: "running" | "earningTemplates") => {
      for (let i = seen.length - 1; i >= 0; i--) if (seen[i][key] != null) return seen[i];
      return null;
    };
    const sample = lastWith("running");
    const published = seen[seen.length - 1]?.published ?? 0;
    const endMs = utc(end);
    const paying = payers.filter(
      (p) => Date.parse(p.firstAt) <= endMs + DAY && endMs <= Date.parse(p.nextDueAt) + PAYER_GRACE,
    );
    // Those on a second or later invoice by then: the kickback that repeats.
    const repeat = paying.filter((p) => invoicesBy(p, endMs + DAY) >= 2).length;
    const earned = earnedBy(end);
    const total = earned.reduce((s, v) => s + v, 0);
    return {
      published,
      earning: lastWith("earningTemplates")?.earningTemplates ?? null,
      running: sample ? (sample.running ?? 0) - (sample.edgeRunning ?? 0) : null,
      paying: paying.length,
      repeat,
      firstInvoice: paying.length - repeat,
      total,
      ...Object.fromEntries(earned.map((v, i) => [`b${i}`, v])),
    };
  };

  // Week by week from the Monday of the week tracking began. A week still under
  // way has no deploy bars, nor has the one tracking began partway through: a
  // part-week reads as a collapse. Edge's surge is left out, as in running.
  const start = utc(data.trackedSince.slice(0, 10));
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  const weeks = [];
  for (let w = monday; iso(w) <= today; w += 7 * DAY) {
    const from = iso(w);
    const end = iso(Math.min(w + 6 * DAY, utc(today)));
    const whole = iso(w + 6 * DAY) < today && w >= start;
    let deploysPaid = 0;
    let deploysUnpaid = 0;
    for (const t of templates) {
      if (t.code === EDGE_CODE) continue;
      const n = t.activity.reduce((s, a) => (a.date >= from && a.date <= end ? s + a.newProjects : s), 0);
      if (t.lifetimeCents > 0) deploysPaid += n;
      else deploysUnpaid += n;
    }
    weeks.push({
      week: from,
      deploysPaid: whole ? deploysPaid : null,
      deploysUnpaid: whole ? deploysUnpaid : null,
      ...snapshot(end),
    });
  }
  const monthAgo = snapshot(iso(utc(today) - 30 * DAY));

  // Growth over the last 30 days, per batch.
  const now = earnedBy(today);
  const then = earnedBy(iso(utc(today) - 30 * DAY));
  const change = now.map((v, i) => v - then[i]);
  const growth = change.reduce((s, v) => s + v, 0);
  const fromNew = batches.reduce((s, b, i) => (b.key === "before" ? s : s + change[i]), 0);
  const newTemplates = batches.reduce((s, b) => (b.key === "before" ? s : s + b.templates.length), 0);

  // Share of each batch paid by each day of its templates' own lives,
  // Kaplan–Meier as in the size chart, so a batch still filling up (most of
  // October came in its last week) shows the days its older templates have
  // lived instead of waiting for the youngest. Ages are each template's own,
  // so a payer's repeat invoices count the same in every batch.
  const nowMs = Date.parse(data.sampledAt);
  const curves = batches.map((b) => paidCurve(b.templates.flatMap((t) => lifeOf(t, nowMs) ?? []), AGE_DAYS, MIN_BATCH));
  const reach = curves.map((c) => c.reduce((last, p, day) => (p.share != null ? day : last), -1));
  const drawn = reach.map((r) => r > MIN_LINE_DAYS);
  const ageRows = Array.from({ length: AGE_DAYS + 1 }, (_, age) => {
    const row: Record<string, number | null> = { age };
    curves.forEach((c, i) => {
      row[`b${i}`] = drawn[i] ? c[age].share : null;
      row[`n${i}`] = c[age].n;
    });
    return row;
  });
  // One day every drawn line has reached, so the key compares like with like.
  const ends = reach.filter((_, i) => drawn[i]);
  const checkpoint = ends.length ? Math.min(...ends) : null;
  const atCheckpoint = curves.map((c, i) => (drawn[i] && checkpoint != null ? c[checkpoint] : null));

  return { batches, weeks, monthAgo, now, growth, fromNew, newTemplates, ageRows, drawn, checkpoint, atCheckpoint };
}

/** Where every template stands today. Exactly one row per template. */
export function tiersOf(templates: TimelineTemplate[], nowMs: number) {
  const running = (t: TimelineTemplate) => t.running ?? 0;
  const defs: { label: string; hint: string; has: (t: TimelineTemplate) => boolean }[] = [
    { label: "Earning $5+", hint: "in the last 30 days", has: (t) => earned30(t) >= 5 },
    { label: "Earning under $5", hint: "in the last 30 days", has: (t) => earned30(t) > 0 && earned30(t) < 5 },
    { label: "In use, not paying", hint: "services running, nothing earned in 30 days", has: (t) => earned30(t) === 0 && running(t) > 0 },
    {
      label: "Too young to call",
      hint: `under ${FAIR_CHANCE_DAYS} days old, nothing running`,
      has: (t) => earned30(t) === 0 && running(t) === 0 && !notTakenUp(t, nowMs),
    },
    {
      label: "Not taken up",
      hint: `${FAIR_CHANCE_DAYS}+ days old, nothing running or earned`,
      has: (t) => notTakenUp(t, nowMs),
    },
  ];
  return defs.map((d) => {
    const rows = templates.filter(d.has);
    return {
      ...d,
      rows,
      earned: rows.reduce((s, t) => s + earned30(t), 0),
      running: rows.reduce((s, t) => s + inUse(t), 0),
      biggest: [...rows].sort((a, b) => earned30(b) - earned30(a) || inUse(b) - inUse(a)).slice(0, 3),
      unhealthy: rows.filter((t) => t.health != null && t.health < HEALTH_FLOOR).length,
    };
  });
}

/** The page's opening figures: is the monthly kickback growing and where
 * from, how concentrated it is, how often a template comes to pay and what
 * one that does brings in. */
export function StrategyDocket({ data, model }: { data: TimelineResponse; model: StrategyModel }) {
  const { batches, growth, fromNew, newTemplates } = model;
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const nowMs = Date.parse(data.sampledAt);
  const total = templates.reduce((s, t) => s + earned30(t), 0);
  const ranked = [...templates].sort((a, b) => earned30(b) - earned30(a));
  const topShare = (n: number) => (total > 0 ? ranked.slice(0, n).reduce((s, t) => s + earned30(t), 0) / total : 0);
  const earners = ranked.filter((t) => earned30(t) > 0);
  const median = earners.length ? earned30(earners[Math.floor(earners.length / 2)]) : 0;
  const old = templates.filter((t) => ageDays(t, nowMs) >= 60);
  const paid = paidCurve(templates.flatMap((t) => lifeOf(t, nowMs) ?? []), FAIR_CHANCE_DAYS);
  const since = batches.find((b) => b.key !== "before")?.label;

  return (
    <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
      <DocketCell label="Monthly kickback" value={fmtUsd(total)}>
        <Fig>{signedUsd(growth)}</Fig> in 30 days: <Fig>{signedUsd(fromNew)}</Fig> from the <Fig>{fmtNum(newTemplates)}</Fig>{" "}
        published since {since}, <Fig>{signedUsd(growth - fromNew)}</Fig> from the <Fig>{fmtNum(templates.length - newTemplates)}</Fig> before
      </DocketCell>
      <DocketCell label="Earning" value={`${fmtNum(earners.length)} of ${fmtNum(templates.length)}`}>
        {ranked[0] && (
          <>
            {name(ranked[0].name)} alone is <Fig>{Math.round(topShare(1) * 100)}%</Fig>, the top <Fig>5</Fig>{" "}
            <Fig>{Math.round(topShare(5) * 100)}%</Fig>
          </>
        )}
      </DocketCell>
      <DocketCell label={`Paid by day ${FAIR_CHANCE_DAYS}`} value={paid[FAIR_CHANCE_DAYS].share == null ? "—" : pct(paid[FAIR_CHANCE_DAYS].share!)}>
        of templates, counting young ones for the days they&apos;ve been live
        {paid[30].share != null && (
          <>
            ; <Fig>{pct(paid[30].share!)}</Fig> by day <Fig>30</Fig>
          </>
        )}
      </DocketCell>
      <DocketCell label="One that pays brings" value={fmtUsd(median)}>
        a month, the median of the <Fig>{fmtNum(earners.length)}</Fig> earning; the average is{" "}
        <Fig>{fmtUsd(earners.length ? total / earners.length : 0)}</Fig>.{" "}
        <Fig>{fmtNum(old.filter((t) => earned30(t) === 0).length)}</Fig> of the <Fig>{fmtNum(old.length)}</Fig> past day{" "}
        <Fig>60</Fig> earn nothing
      </DocketCell>
    </div>
  );
}

/** Is publishing paying: the month's kickback by publishing month, then the
 * catalog, its deploys, its use and its payers, week by week. */
export function Trend({ data, model }: { data: TimelineResponse; model: StrategyModel }) {
  const { batches, weeks, monthAgo, now } = model;
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const last = weeks[weeks.length - 1];
  const lastWholeWeek = [...weeks].reverse().find((w) => w.deploysPaid != null);
  const longGaps = data.gaps.filter((g) => Date.parse(g.to) - Date.parse(g.from) >= NOTABLE_GAP);
  const edge = templates.find((t) => t.code === EDGE_CODE);
  const axis = { dataKey: "week", ...tick, tickMargin: 6, minTickGap: 36, tickFormatter: fmtDay };
  const sync = { data: weeks, syncId: "strategy", margin: { top: 6, right: 4, left: 0, bottom: 0 } };
  const weekTitle = (l: string | number) => `Week of ${fmtDay(String(l))}`;

  return (
    <Section
      id="trend"
      title="Is it working?"
      text="What publishing has added since tracking began, week by week. Monthly kickback is Railway's trailing 30 days, which can take in a day more than “Last 30 days” on Money."
    >
      <section className="space-y-2">
        <h3 className="text-base font-semibold">Monthly kickback, by when the template was published</h3>
        <Key
          items={batches.map((b, i) => ({
            label: `${b.label} (${fmtNum(b.templates.length)})`,
            color: b.color,
            value: fmtUsd(now[i]),
          }))}
        />
        <ChartContainer config={{}} className="aspect-auto h-56 w-full lg:h-64">
          <AreaChart {...sync} aria-label="Trailing 30-day kickback, stacked by publishing month">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={44} {...tick} tickCount={4} tickFormatter={fmtUsdTick} />
            <Tooltip
              isAnimationActive={false}
              cursor={cursor}
              content={(p) => (
                <Tip
                  {...p}
                  swatch="fill"
                  title={weekTitle}
                  format={fmtUsd}
                  footer={(l) => {
                    const w = weeks.find((x) => x.week === l);
                    return w ? <>Total <span className="tabular-nums text-foreground">{fmtUsd(w.total)}</span></> : null;
                  }}
                />
              )}
            />
            {batches.map((b, i) => (
              <Area
                key={b.key}
                name={b.label}
                dataKey={`b${i}`}
                stackId="k"
                stroke="var(--card)"
                strokeWidth={2}
                fill={b.color}
                fillOpacity={1}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
        <p className="text-xs text-muted-foreground">
          The top edge is the month&apos;s kickback, <Fig>{fmtUsd(last.total)}</Fig> now and <Fig>{fmtUsd(monthAgo.total)}</Fig> 30 days ago.
          A new layer that stays thin means new templates add little; older layers shrinking means the catalog is losing earners.
        </p>
      </section>

      <div className="grid gap-x-6 gap-y-5 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        <Panel
          title="Templates"
          keyItems={[
            { label: "Published", color: "var(--chart-other)", line: true, value: fmtNum(last.published) },
            { label: "Earning", color: "var(--chart-1)", line: true, value: fmtNum(last.earning ?? 0) },
          ]}
        >
          <LineChart {...sync} aria-label="Templates published and earning, week by week">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={36} {...tick} tickCount={3} allowDecimals={false} />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={weekTitle} format={fmtNum} />} />
            <Line name="Published" type="stepAfter" dataKey="published" stroke="var(--chart-other)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line name="Earning" type="stepAfter" dataKey="earning" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Panel>

        <Panel
          title="Deploys a week"
          keyItems={[
            { label: "On templates that have paid", color: "var(--chart-1)", value: fmtNum(lastWholeWeek?.deploysPaid ?? 0) },
            { label: "Never paid", color: "var(--chart-other)", value: fmtNum(lastWholeWeek?.deploysUnpaid ?? 0) },
          ]}
        >
          <BarChart {...sync} aria-label="New projects per week, on templates that have and have not paid">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={36} {...tick} tickCount={3} allowDecimals={false} />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={weekTitle} format={fmtNum} />} />
            <Bar name="Have paid" dataKey="deploysPaid" stackId="d" fill="var(--chart-1)" isAnimationActive={false} />
            <Bar name="Never paid" dataKey="deploysUnpaid" stackId="d" fill="var(--chart-other)" isAnimationActive={false} />
          </BarChart>
        </Panel>

        <Panel
          title="Running instances"
          figure={fmtNum(last.running ?? 0)}
          note={
            monthAgo.running != null && last.running != null ? (
              <>
                <Fig>{signedNum(last.running - monthAgo.running)}</Fig> in 30 days
              </>
            ) : undefined
          }
        >
          <LineChart {...sync} aria-label="Running instances, week by week">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={36} {...tick} tickCount={3} allowDecimals={false} />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={weekTitle} format={fmtNum} />} />
            <Line name="Running" type="stepAfter" dataKey="running" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Panel>

        <Panel
          title="Paying deployers"
          keyItems={[
            { label: "Paid before", color: "var(--chart-1)", value: fmtNum(last.repeat) },
            { label: "On a first invoice", color: "var(--chart-other)", value: fmtNum(last.firstInvoice) },
          ]}
        >
          <AreaChart {...sync} aria-label="Paying deployers, those who paid before and those on a first invoice, week by week">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={36} {...tick} tickCount={3} allowDecimals={false} />
            <Tooltip
              isAnimationActive={false}
              cursor={cursor}
              content={(p) => (
                <Tip
                  {...p}
                  swatch="fill"
                  title={weekTitle}
                  format={fmtNum}
                  footer={(l) => {
                    const w = weeks.find((x) => x.week === l);
                    return w ? <>Paying <span className="tabular-nums text-foreground">{fmtNum(w.paying)}</span></> : null;
                  }}
                />
              )}
            />
            <Area name="Paid before" type="stepAfter" dataKey="repeat" stackId="p" stroke="var(--card)" strokeWidth={1} fill="var(--chart-1)" fillOpacity={1} isAnimationActive={false} />
            <Area name="On a first invoice" type="stepAfter" dataKey="firstInvoice" stackId="p" stroke="var(--card)" strokeWidth={1} fill="var(--chart-other)" fillOpacity={1} isAnimationActive={false} />
          </AreaChart>
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Deploys count whole weeks, so the one under way and the one tracking began in are left out, and the key shows the last whole week.
        “Have paid” means at any time so far, so a template that paid late counts in its earlier weeks too.
        Paying deployers are read from invoices: <Fig>{fmtNum(last.paying)}</Fig> now, <Fig>{signedNum(last.paying - monthAgo.paying)}</Fig> in 30 days.
        Those who paid before are the kickback that repeats.
        {edge?.running
          ? ` Deploys and running instances leave out ${name(edge.name)} (${fmtNum(edge.running)} running), whose mid-October surge would flatten every other week; it has earned ${fmtUsd(earned30(edge))} so far.`
          : ""}
        {longGaps.map((g) => (
          <span key={g.from}>
            {" "}
            Nothing was collected from {fmtDay(g.from.slice(0, 10))} to {fmtDay(g.to.slice(0, 10))}, so those deploys land in the week it resumed.
          </span>
        ))}
      </p>
    </Section>
  );
}

/** The share of each publishing month paid by each day of its templates'
 * own lives, so batches compare at the same age instead of the newest
 * looking worst for being young. */
export function Cohorts({ model }: { model: StrategyModel }) {
  const { batches, ageRows, drawn, checkpoint, atCheckpoint } = model;
  const tooYoung = batches.filter((_, i) => !drawn[i]).map((b) => b.label);
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">Do newer batches do better?</h3>
      <Key
        items={batches.flatMap((b, i) => {
          const at = atCheckpoint[i];
          if (!at || at.share == null) return [];
          return [{
            label: `${b.label} (${fmtNum(b.templates.length)})`,
            color: b.color,
            line: true,
            value: (
              <>
                {pct(at.share)}
                <span className="font-sans font-normal text-muted-foreground"> by day {checkpoint}</span>
              </>
            ),
          }];
        })}
      />
      <ChartContainer config={{}} className="aspect-auto h-56 w-full lg:h-64">
        <LineChart data={ageRows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} aria-label="Share of each publishing month's templates paid, by days since publishing">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="age" {...tick} tickMargin={6} type="number" domain={[0, AGE_DAYS]} ticks={[0, 15, 30, 45, 60]} tickFormatter={(d: number) => `Day ${d}`} />
          <YAxis width={44} {...tick} tickCount={4} domain={[0, shareTop]} tickFormatter={pct} />
          <Tooltip
            isAnimationActive={false}
            cursor={cursor}
            content={(p) => (
              <Tip
                {...p}
                title={(l) => `Day ${l} after publishing`}
                format={(v, k) => `${pct(v)} paid · of ${p.payload?.[0]?.payload?.[`n${k.slice(1)}`]}`}
              />
            )}
          />
          {checkpoint != null && <ReferenceLine x={checkpoint} stroke="var(--border)" strokeDasharray="3 3" />}
          {batches.map((b, i) => !drawn[i] ? null : (
            <Line key={b.key} name={b.label} type="stepAfter" dataKey={`b${i}`} stroke={b.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Share of each publishing month&apos;s templates that had earned any kickback by each day after publishing, each counted by its own age.
        Young templates count for the days they&apos;ve been live, and a line stops where fewer than {MIN_BATCH} of its month are that old.
        {checkpoint != null && (
          <>
            {" "}The key reads day <Fig>{checkpoint}</Fig>, the furthest every line reaches. A newer line under an older one at the same day means the newer batch is starting slower.
          </>
        )}
        {" "}A first invoice can take a month to arrive, so almost nothing shows before day 15.
        {tooYoung.length > 0 && ` ${tooYoung.join(" and ")} ${tooYoung.length > 1 ? "are" : "is"} too young to draw.`}
      </p>
    </section>
  );
}

/** What the day-21 read has told so far: the stored checkpoint of the
 * verdict backtest, in the two groups it compares. */
export function EarlyRead({ verdicts }: { verdicts: VerdictsResponse | null | undefined }) {
  const c = verdicts?.checkpoint;
  if (!verdicts || !c) return null;
  const count = (state: string) => verdicts.templates.filter((v) => v.state === state).length;
  const rose = `added ${fmtUsd(verdicts.minOutcomeRise)}+ by day ${c.horizon}`;
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">Does day 21 tell?</h3>
      <div className={cn(DOCKET, "sm:grid-cols-3")}>
        <DocketCell small label="Paid by day 21" value={`${fmtNum(c.p1.truePositives)} of ${fmtNum(c.p1.trueN)}`}>
          {rose}
        </DocketCell>
        <DocketCell small label="Nothing by day 21" value={`${fmtNum(c.p1.falsePositives)} of ${fmtNum(c.p1.falseN)}`}>
          {rose}
        </DocketCell>
        <DocketCell small label="Read today" value={`${fmtNum(count("keep"))} keep`}>
          <Fig>{fmtNum(count("no signal"))}</Fig> no signal, <Fig>{fmtNum(count("too early"))}</Fig> under 22 days old.{" "}
          <Link to="/templates?sort=verdict" className="text-primary underline">
            Templates by verdict
          </Link>
        </DocketCell>
      </div>
      <p className="text-xs text-muted-foreground">
        Each template is read once, at day 21. This is the test of that reading, made once on {fmtDay(c.judgedAt)} over the{" "}
        <Fig>{fmtNum(c.n)}</Fig> templates published since tracking began that had reached day {c.horizon}
        {c.p1.result === "pass"
          ? ": paid by day 21 passed, so those templates read keep on Templates."
          : c.p1.result === "fail"
            ? ": paid by day 21 failed, so no template reads keep."
            : ": too few templates to say, so no template reads keep yet."}
        {" "}The groups are small, and day 90 is tested next.
      </p>
      <VerdictGuide verdicts={verdicts} label="What the Verdict column means" />
    </section>
  );
}

export type Tier = ReturnType<typeof tiersOf>[number];

/** Where every template stands today, one row per outcome, then the ones
 * nobody took up by name. */
export function CatalogTiers({ data }: { data: TimelineResponse }) {
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const tiers = tiersOf(templates, Date.parse(data.sampledAt));
  const edge = templates.find((t) => t.code === EDGE_CODE);
  return (
    <section className="min-w-0 space-y-2">
      <Table rows={tiers.length} className="min-w-[34rem] sm:min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Outcome</TableHead>
            <TableHead>Templates</TableHead>
            <TableHead numeric>Kickback, 30 days</TableHead>
            <TableHead numeric>Running</TableHead>
            <TableHead numeric>{`Under ${HEALTH_FLOOR}% health`}</TableHead>
            <TableHead className="max-sm:hidden">Biggest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tiers.map((t) => (
            <TableRow key={t.label}>
              <TableRowHead>
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.hint}</div>
              </TableRowHead>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-right tabular-nums">{fmtNum(t.rows.length)}</span>
                  <TableMeter value={t.rows.length / templates.length} color="var(--chart-1)" className="w-20 max-sm:hidden" />
                </div>
              </TableCell>
              <TableCell numeric>{fmtUsd(t.earned)}</TableCell>
              <TableCell numeric>{fmtNum(t.running)}</TableCell>
              <TableCell numeric>{t.unhealthy > 0 ? fmtNum(t.unhealthy) : "—"}</TableCell>
              <TableCell className="max-w-64 truncate text-xs text-muted-foreground max-sm:hidden">
                {t.biggest.map((x) => name(x.name)).join(", ") || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {edge?.running ? (
        <p className="text-xs text-muted-foreground">
          Running leaves out {name(edge.name)}&apos;s <Fig>{fmtNum(edge.running)}</Fig>, mostly from a mid-October surge. It
          hasn&apos;t earned yet, which is too early to judge: Linux templates took about 40 days to earn.
        </p>
      ) : null}
    </section>
  );
}

type IdleKey = "name" | "kind" | "origin" | "services" | "age" | "projects";

/** The templates nobody took up, by name: the list a decision to stop
 * maintaining starts from. */
export function NotTakenUp({ data }: { data: TimelineResponse }) {
  const { templates } = data;
  const nowMs = Date.parse(data.sampledAt);
  const name = shortNames(templates.map((t) => t.name));
  const idle = templates.filter((t) => notTakenUp(t, nowMs));
  const originLabel = (k: string) => ORIGINS.find((x) => x.key === k)?.label ?? "Unsorted";
  const { rows, head } = useSort(
    idle,
    (t, key: IdleKey) =>
      ({
        name: name(t.name),
        kind: kindLabel(t.kind),
        origin: originLabel(t.origin),
        services: t.services,
        age: ageDays(t, nowMs),
        projects: t.projects,
      })[key],
    "age",
    ["name", "kind", "origin"],
  );
  if (idle.length === 0) return null;
  const kinds = new Map<string, number>();
  for (const t of idle) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1);
  const tally = [...kinds.entries()].sort((a, b) => b[1] - a[1]);
  const originals = idle.filter((t) => t.origin === "original").length;
  return (
    <section className="min-w-0 space-y-2 pt-4">
      <h3 className="text-base font-semibold">Not taken up, by name</h3>
      <p className="max-w-[80ch] text-sm text-muted-foreground">
        <Fig>{fmtNum(idle.length)}</Fig> templates past day {FAIR_CHANCE_DAYS} with nothing running and nothing earned:{" "}
        {tally.map(([k, n], i) => (
          <span key={k}>
            {i > 0 && ", "}
            <Fig>{fmtNum(n)}</Fig> {kindLabel(k)}
          </span>
        ))}
        ; <Fig>{fmtNum(originals)}</Fig> of them originals. Each still takes its turn in the upgrade queue.
      </p>
      <Table rows={rows.length} limit={50} className="min-w-[34rem]">
        <TableHeader>
          <TableRow>
            {head("name", "Template")}
            {head("kind", "Kind")}
            {head("origin", "Origin", { className: "max-sm:hidden" })}
            {head("services", "Services", { numeric: true, className: "max-sm:hidden" })}
            {head("age", "Days old", { numeric: true })}
            {head("projects", "Deploys", { numeric: true, hint: "Projects other people ever created from it; none is running now" })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.templateId}>
              <TableRowHead>
                <Link to={`/templates#t-${t.templateId}`} className="underline decoration-current/40 underline-offset-3 hover:decoration-current">
                  {name(t.name)}
                </Link>
              </TableRowHead>
              <TableCell className="text-muted-foreground">{kindLabel(t.kind)}</TableCell>
              <TableCell className="text-muted-foreground max-sm:hidden">{originLabel(t.origin)}</TableCell>
              <TableCell numeric className="max-sm:hidden">{fmtNum(t.services)}</TableCell>
              <TableCell numeric>{fmtNum(Math.floor(ageDays(t, nowMs)))}</TableCell>
              <TableCell numeric>{fmtNum(t.projects)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** One small multiple: a title, its figure or key, one chart with one axis. */
function Panel({
  title,
  figure,
  note,
  keyItems,
  children,
}: {
  title: string;
  figure?: string;
  note?: ReactNode;
  keyItems?: { label: string; color: string; line?: boolean; value?: ReactNode }[];
  children: React.ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {keyItems ? (
        <div className="min-h-9">
          <Key items={keyItems} />
        </div>
      ) : (
        <p className="min-h-9 text-xs text-muted-foreground">
          <span className="font-mono text-base font-semibold text-foreground tabular-nums">{figure}</span>
          {note && <span> {note}</span>}
        </p>
      )}
      <ChartContainer config={{}} className="aspect-auto h-36 w-full">
        {children}
      </ChartContainer>
    </section>
  );
}
