import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, Tip, tick } from "~/components/chart-kit";
import { DOCKET, DocketCell, Fig, Section } from "~/components/page";
import { lifeOf, paidCurve } from "~/components/what-to-publish";
import { ChartContainer } from "~/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead } from "~/components/ui/table";
import { fmtDay, fmtNum, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { TimelineResponse, TimelineTemplate } from "~/queries/analytics";
import type { PayerChain } from "~/queries/payouts";

export const DAY = 86_400_000;
/** Most recent publishing months shown on their own; older ones share a layer. */
const SEPARATE_MONTHS = 3;
/** Skips the running green: beside teal it fails the validator's normal-vision floor. */
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** A first invoice can take a month to arrive, so by this age a template has
 * had a fair chance to show use. */
export const FAIR_CHANCE_DAYS = 45;
export const HEALTH_FLOOR = 70;
/** The age chart stops here: past it only the oldest batch has a line. */
const AGE_DAYS = 60;
/** Almost nothing is paid in the first two weeks, so a shorter line shows nothing. */
const MIN_LINE_DAYS = 14;
/** Shorter collection gaps don't move a weekly figure. */
const NOTABLE_GAP = 2 * DAY;
/** A payer still counts for a day past the estimated next invoice, so an invoice
 * that lands a little late doesn't read as a lapse. Our allowance, not Railway's. */
const PAYER_GRACE = DAY;

/** Its October surge was short-lived, unexplained and has never earned, so it
 * doesn't count as use here. Other pages still show it. */
export const EDGE_CODE = "microsoft-edge";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
export const publishedOn = (t: TimelineTemplate) => t.publishedAt ?? t.firstSeenAt;
/** The word joiner keeps a minus on the same line as its figure. */
export const signedUsd = (v: number) => `${v >= 0 ? "+" : "−\u2060"}${fmtUsd(Math.abs(v))}`;

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

  /** What one published template of each size earned in the 30 days to
   * `end`: the size's kickback over its templates published by then. Each
   * size's biggest lifetime earner is left out, as in the segment tables, so
   * one hit (Twenty) doesn't make its size's line. */
  const sizeTop = GROUPS.map((_, g) =>
    templates.filter((t) => groupOf(t) === g).reduce<TimelineTemplate | null>((m, t) => (!m || t.lifetimeCents > m.lifetimeCents ? t : m), null),
  );
  const perSizeBy = (end: string) => {
    const from = iso(utc(end) - 30 * DAY);
    return GROUPS.map((_, g) => {
      const ts = templates.filter((t) => groupOf(t) === g && t !== sizeTop[g] && publishedOn(t).slice(0, 10) <= end);
      const sum = ts.reduce(
        (s, t) => s + t.activity.reduce((n, a) => (a.date >= from && a.date <= end ? n + a.earnedCents / 100 : n), 0),
        0,
      );
      return ts.length ? sum / ts.length : null;
    });
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
    ).length;
    const earned = earnedBy(end);
    const total = earned.reduce((s, v) => s + v, 0);
    return {
      published,
      earning: lastWith("earningTemplates")?.earningTemplates ?? null,
      running: sample ? (sample.running ?? 0) - (sample.edgeRunning ?? 0) : null,
      paying,
      total,
      perTemplate: published > 0 ? total / published : 0,
      ...Object.fromEntries(earned.map((v, i) => [`b${i}`, v])),
      ...Object.fromEntries(perSizeBy(end).map((v, g) => [`s${g}`, v])),
    };
  };

  // Week by week from the Monday of the week tracking began. A week still under
  // way has no deploy bars: a part-week reads as a collapse.
  const start = utc(data.trackedSince.slice(0, 10));
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  const weeks = [];
  for (let w = monday; iso(w) <= today; w += 7 * DAY) {
    const from = iso(w);
    const end = iso(Math.min(w + 6 * DAY, utc(today)));
    const finished = iso(w + 6 * DAY) < today;
    let deploysPaid = 0;
    let deploysUnpaid = 0;
    for (const t of templates) {
      const n = t.activity.reduce((s, a) => (a.date >= from && a.date <= end ? s + a.newProjects : s), 0);
      if (t.lifetimeCents > 0) deploysPaid += n;
      else deploysUnpaid += n;
    }
    weeks.push({
      week: from,
      deploysPaid: finished ? deploysPaid : null,
      deploysUnpaid: finished ? deploysUnpaid : null,
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

  // Each batch's kickback by age, per template. The batch's biggest earner is
  // left out so one hit (Twenty) doesn't set the line, and a line stops once
  // too few of its templates are that old for the average to be the same group.
  const nowMs = Date.parse(data.sampledAt);
  const ageRows = Array.from({ length: AGE_DAYS + 1 }, (_, age) => {
    const row: Record<string, number | null> = { age };
    batches.forEach((b, i) => {
      const top = b.templates.reduce<TimelineTemplate | null>((m, t) => (!m || t.lifetimeCents > m.lifetimeCents ? t : m), null);
      const rest = b.templates.filter((t) => t !== top);
      const old = rest.filter((t) => (nowMs - Date.parse(publishedOn(t))) / DAY >= age);
      if (old.length < 5 || old.length < rest.length * 0.8) {
        row[`b${i}`] = null;
        return;
      }
      const sum = old.reduce((s, t) => {
        const pub = utc(publishedOn(t).slice(0, 10));
        return s + t.activity.reduce((n, a) => ((utc(a.date) - pub) / DAY <= age ? n + a.earnedCents / 100 : n), 0);
      }, 0);
      row[`b${i}`] = sum / old.length;
    });
    return row;
  });
  const drawn = batches.map((_, i) => ageRows.filter((r) => r[`b${i}`] != null).length > MIN_LINE_DAYS);

  return { batches, weeks, monthAgo, now, change, growth, fromNew, newTemplates, ageRows, drawn };
}

/** Where every template stands today. Exactly one row per template. */
function tiersOf(templates: TimelineTemplate[], nowMs: number) {
  const age = (t: TimelineTemplate) => (nowMs - Date.parse(publishedOn(t))) / DAY;
  const earned = (t: TimelineTemplate) => t.earned30d ?? 0;
  const running = (t: TimelineTemplate) => t.running ?? 0;
  const counted = (t: TimelineTemplate) => (t.code === EDGE_CODE ? 0 : running(t));
  const defs: { label: string; hint: string; has: (t: TimelineTemplate) => boolean }[] = [
    { label: "Earning $5+", hint: "in the last 30 days", has: (t) => earned(t) >= 5 },
    { label: "Earning under $5", hint: "in the last 30 days", has: (t) => earned(t) > 0 && earned(t) < 5 },
    { label: "In use, not paying", hint: "services running, nothing earned in 30 days", has: (t) => earned(t) === 0 && running(t) > 0 },
    {
      label: "Too young to call",
      hint: `under ${FAIR_CHANCE_DAYS} days old, nothing running`,
      has: (t) => earned(t) === 0 && running(t) === 0 && age(t) < FAIR_CHANCE_DAYS,
    },
    {
      label: "Not taken up",
      hint: `${FAIR_CHANCE_DAYS}+ days old, nothing running or earned`,
      has: (t) => earned(t) === 0 && running(t) === 0 && age(t) >= FAIR_CHANCE_DAYS,
    },
  ];
  return defs.map((d) => {
    const rows = templates.filter(d.has);
    return {
      ...d,
      rows,
      earned: rows.reduce((s, t) => s + earned(t), 0),
      running: rows.reduce((s, t) => s + counted(t), 0),
      biggest: [...rows].sort((a, b) => earned(b) - earned(a) || counted(b) - counted(a)).slice(0, 3),
      unhealthy: rows.filter((t) => t.health != null && t.health < HEALTH_FLOOR).length,
    };
  });
}

/** The page's opening figures: is the monthly kickback growing and where
 * from, how concentrated it is, and what a typical template comes to. */
export function StrategyDocket({ data, model }: { data: TimelineResponse; model: StrategyModel }) {
  const { batches, growth, fromNew, newTemplates } = model;
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const nowMs = Date.parse(data.sampledAt);
  const earned = (t: TimelineTemplate) => t.earned30d ?? 0;
  const total = templates.reduce((s, t) => s + earned(t), 0);
  const ranked = [...templates].sort((a, b) => earned(b) - earned(a));
  const topShare = (n: number) => (total > 0 ? ranked.slice(0, n).reduce((s, t) => s + earned(t), 0) / total : 0);
  const earningNow = ranked.filter((t) => earned(t) > 0).length;
  const mature = ranked.filter((t) => (nowMs - Date.parse(publishedOn(t))) / DAY >= 60);
  const typical = mature.length ? earned(mature[Math.floor(mature.length / 2)]) : 0;
  const matureAvg = mature.length ? mature.reduce((s, t) => s + earned(t), 0) / mature.length : 0;
  const paid30 = paidCurve(templates.flatMap((t) => lifeOf(t, nowMs) ?? []), 30)[30].share;
  const since = batches.find((b) => b.key !== "before")?.label;

  return (
    <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
      <DocketCell label="Monthly kickback" value={fmtUsd(total)}>
        <Fig>{signedUsd(growth)}</Fig> in 30 days: <Fig>{signedUsd(fromNew)}</Fig> from the <Fig>{fmtNum(newTemplates)}</Fig>{" "}
        published since {since}, <Fig>{signedUsd(growth - fromNew)}</Fig> from the <Fig>{fmtNum(templates.length - newTemplates)}</Fig> before
      </DocketCell>
      <DocketCell label="Earning" value={`${fmtNum(earningNow)} of ${fmtNum(templates.length)}`}>
        {ranked[0] && (
          <>
            {name(ranked[0].name)} alone is <Fig>{Math.round(topShare(1) * 100)}%</Fig>, the top <Fig>5</Fig>{" "}
            <Fig>{Math.round(topShare(5) * 100)}%</Fig>
          </>
        )}
      </DocketCell>
      <DocketCell label="Typical at 60+ days" value={fmtUsd(typical)}>
        a month, the median of <Fig>{fmtNum(mature.length)}</Fig>; the average is <Fig>{fmtUsd(matureAvg)}</Fig> because a few earn most
      </DocketCell>
      <DocketCell label="Paid within 30 days" value={paid30 == null ? "—" : `${Math.round(paid30 * 100)}%`}>
        of templates, counting young ones for the days they&apos;ve been live
      </DocketCell>
    </div>
  );
}

/** Is publishing paying: the month's kickback by publishing month, then the
 * catalog, its users, its payers and each size's rate, week by week. */
export function Trend({ data, model }: { data: TimelineResponse; model: StrategyModel }) {
  const { batches, weeks, monthAgo, now } = model;
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const earned = (t: TimelineTemplate) => t.earned30d ?? 0;
  const last = weeks[weeks.length - 1];
  const lastFullWeek = [...weeks].reverse().find((w) => w.deploysPaid != null);
  const longGaps = data.gaps.filter((g) => Date.parse(g.to) - Date.parse(g.from) >= NOTABLE_GAP);
  const edge = templates.find((t) => t.code === EDGE_CODE);
  const axis = { dataKey: "week", ...tick, tickMargin: 6, minTickGap: 36, tickFormatter: fmtDay };
  const sync = { data: weeks, syncId: "strategy", margin: { top: 6, right: 4, left: 0, bottom: 0 } };
  const weekTitle = (l: string | number) => `Week of ${fmtDay(String(l))}`;
  const sizeNow = (g: number) => (last as unknown as Record<string, number | null>)[`s${g}`];

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
            value: (
              <>
                {fmtUsd(now[i])}
                <span className="font-normal text-muted-foreground"> · {fmtUsd(b.templates.length ? now[i] / b.templates.length : 0)} each</span>
              </>
            ),
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
                  payload={p.payload?.map((x) => ({ ...x, color: batches[Number(String(x.dataKey).slice(1))]?.color }))}
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

      <div className="grid gap-x-6 gap-y-5 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
            { label: "On paying templates", color: "var(--chart-1)", value: fmtNum(lastFullWeek?.deploysPaid ?? 0) },
            { label: "Never paid", color: "var(--chart-other)", value: fmtNum(lastFullWeek?.deploysUnpaid ?? 0) },
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
          note={edge?.running ? <>leaving out {name(edge.name)}&apos;s <Fig>{fmtNum(edge.running)}</Fig></> : undefined}
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
          figure={fmtNum(last.paying)}
          note={
            <>
              <Fig>{`${last.paying - monthAgo.paying >= 0 ? "+" : "−"}${fmtNum(Math.abs(last.paying - monthAgo.paying))}`}</Fig> in 30 days, from invoices
            </>
          }
        >
          <LineChart {...sync} aria-label="Paying deployers, week by week">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={36} {...tick} tickCount={3} allowDecimals={false} />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={weekTitle} format={fmtNum} />} />
            <Line name="Paying" type="stepAfter" dataKey="paying" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Panel>

        <Panel
          title="A month per template, by size"
          keyItems={GROUPS.map((g, i) => ({
            label: g.short,
            color: g.color,
            line: true,
            value: sizeNow(i) == null ? undefined : fmtUsd(sizeNow(i)!),
          }))}
        >
          <LineChart {...sync} aria-label="Trailing 30-day kickback per published template, by size, week by week">
            <CartesianGrid vertical={false} />
            <XAxis {...axis} />
            <YAxis width={44} {...tick} tickCount={3} tickFormatter={fmtUsdTick} />
            <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={weekTitle} format={fmtUsd} />} />
            {GROUPS.map((g, i) => (
              <Line key={g.label} name={g.label} dataKey={`s${i}`} stroke={g.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Deploys count whole weeks, so the current one is left out until it ends, and the key shows the last whole week.
        “Paying” means at any time so far, so a template that paid late counts in its earlier weeks too.
        {edge && ` Deploys still include ${name(edge.name)}, which is most of the mid-October spike; it earned ${fmtUsd(earned(edge))}.`}
        {" "}A month per template leaves out each size&apos;s biggest earner; a line falling while the catalog grows means that size&apos;s new templates earn less than its old ones.
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

/** Each publishing month's kickback per template by age, so batches compare
 * at the same age instead of the newest looking worst for being young. */
export function Cohorts({ model }: { model: StrategyModel }) {
  const { batches, ageRows, drawn } = model;
  const tooYoung = batches.filter((_, i) => !drawn[i]).map((b) => b.label);
  const day30 = ageRows[30];
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-base font-semibold">Do newer batches do better?</h3>
      <Key
        items={batches.flatMap((b, i) => {
          if (!drawn[i]) return [];
          const at30 = day30?.[`b${i}`];
          return [{ label: b.label, color: b.color, line: true, value: at30 != null ? `${fmtUsd(at30)} at day 30` : undefined }];
        })}
      />
      <ChartContainer config={{}} className="aspect-auto h-56 w-full lg:h-64">
        <LineChart data={ageRows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} aria-label="Cumulative kickback per template by days since publishing, per publishing month">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="age" {...tick} tickMargin={6} type="number" domain={[0, AGE_DAYS]} ticks={[0, 15, 30, 45, 60]} tickFormatter={(d: number) => `Day ${d}`} />
          <YAxis width={44} {...tick} tickCount={4} tickFormatter={(v: number) => fmtUsd(v)} />
          <Tooltip isAnimationActive={false} cursor={cursor} content={(p) => <Tip {...p} title={(l) => `Day ${l} after publishing`} format={fmtUsd} />} />
          {batches.map((b, i) => !drawn[i] ? null : (
            <Line key={b.key} name={b.label} dataKey={`b${i}`} stroke={b.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Kickback per template so far, by days since publishing, each batch&apos;s biggest earner left out so one hit doesn&apos;t set its line.
        A line stops while too few of its templates have reached that age, and money comes with a monthly invoice, so a young line says little yet.
        {tooYoung.length > 0 && ` ${tooYoung.join(" and ")} ${tooYoung.length > 1 ? "are" : "is"} too young to draw.`}
      </p>
    </section>
  );
}

export type Tier = ReturnType<typeof tiersOf>[number];
export { tiersOf };

/** Where every template stands today, one row per outcome. */
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
          Running leaves out {name(edge.name)}&apos;s <Fig>{fmtNum(edge.running)}</Fig>, a short surge that never earned.
        </p>
      ) : null}
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
