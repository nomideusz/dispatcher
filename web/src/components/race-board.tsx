import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROUPS, groupOf } from "~/components/chart-kit";
import { Button } from "~/components/ui/button";
import { fmtCents, fmtNum, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { KINDS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";

/** The board: kickback or new projects, day by day, run as a race between
 * templates or their groups. A Dispatcher reads like a departures board, so
 * that is the look: the date flips, the figures roll, rows glide to their
 * place and a stamp lands on a first kickback or a change of leader. */

type Measure = "kickback" | "projects";
type Field = "templates" | "launch" | "kinds" | "weeks";

const MEASURES: { key: Measure; label: string; board: string }[] = [
  { key: "kickback", label: "Kickback", board: "Kickback earned" },
  { key: "projects", label: "User deploys", board: "Deployed by users" },
];
const FIELDS: { key: Field; label: string }[] = [
  { key: "templates", label: "Templates" },
  { key: "launch", label: "Templates from launch" },
  { key: "kinds", label: "Kinds" },
  { key: "weeks", label: "Publish weeks" },
];
const SPEEDS = [0.5, 1, 2, 4] as const;
type Pace = "real" | "eventful";
const PACES: { key: Pace; label: string }[] = [
  { key: "real", label: "Real time" },
  { key: "eventful", label: "Eventful" },
];
/** Eventful: a race lasts this long at 1×, whatever the span of days. */
const SECONDS = 60;
/** Real time: a day lasts this long at 1×; a lone racer's days run faster. */
const DAY_SECONDS = 0.45;
const LONE = 0.35;
/** Full rows, then a tail of smaller ones fading out. */
const SHOWN = 10;
const TAIL = 10;
/** Days a stamp or a rank arrow stays up. */
const LINGER = 3;

const KIND_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)", "var(--chart-1)", "var(--chart-other)"];
/** Publish weeks take their month's colour, cycling. */
const MONTH_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)", "var(--chart-1)"];
const UNSORTED = "var(--chart-other)";
const DAY_MS = 86_400_000;
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const weekName = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

interface Racer {
  id: string;
  label: string;
  color: string;
  /** Running total at the end of each day. */
  cum: number[];
  /** Slopes at each day for monotone cubic easing between them. */
  tan: number[];
  /** The day it first scored, for the stamp. */
  first: number;
  /** From launch: the last day it has lived through so far. */
  age?: number;
}

function racerOf(t: TimelineTemplate, field: Field, name: (n: string) => string): Pick<Racer, "id" | "label" | "color"> {
  switch (field) {
    case "templates":
    case "launch":
      return { id: t.templateId, label: name(t.name), color: GROUPS[groupOf(t)].color };
    case "kinds": {
      const i = KINDS.findIndex((k) => k.key === t.kind);
      return i < 0 ? { id: "unsorted", label: "Unsorted", color: UNSORTED } : { id: KINDS[i].key, label: KINDS[i].label, color: KIND_COLORS[i] };
    }
    case "weeks": {
      if (!t.publishedAt) return { id: "unknown", label: "Date unknown", color: UNSORTED };
      const d = new Date(`${t.publishedAt.slice(0, 10)}T00:00:00Z`);
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
      return { id: monday.toISOString().slice(0, 10), label: `Week of ${weekName.format(monday)}`, color: UNSORTED };
    }
  }
}

function legendOf(field: Field, racers: Racer[]) {
  if (field === "templates" || field === "launch") return GROUPS.map((g) => ({ label: g.label, color: g.color }));
  if (field === "kinds") return racers.map((r) => ({ label: r.label, color: r.color }));
  const months = new Map<string, { label: string; color: string }>();
  for (const r of [...racers].sort((a, b) => a.id.localeCompare(b.id))) {
    const d = new Date(`${r.id}T00:00:00Z`);
    const label = Number.isNaN(d.getTime()) ? r.label : `${monthName.format(d)} weeks`;
    months.set(label, { label, color: r.color });
  }
  return [...months.values()];
}

/** Days from the one before anything scored to the last sample, and each
 * racer's running total over them. From launch, the days are each
 * template's own, counted from the day it was published. */
function build(data: TimelineResponse, measure: Measure, field: Field) {
  const score = (a: { earnedCents: number; newProjects: number }) => (measure === "kickback" ? a.earnedCents : a.newProjects);
  const dates = data.templates.flatMap((t) => t.activity.filter((a) => score(a) > 0).map((a) => a.date));
  const end = data.sampledAt.slice(0, 10);
  const start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : end;
  const launch = field === "launch";
  const since = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

  // From launch, only templates published after collection began, so none
  // is missing its first days.
  const entrants = launch ? data.templates.filter((t) => t.publishedAt && t.publishedAt.slice(0, 10) >= start) : data.templates;
  const days: string[] = [];
  if (launch) {
    const oldest = Math.max(1, ...entrants.map((t) => since(t.publishedAt!.slice(0, 10), end)));
    for (let i = 0; i <= oldest + 1; i++) days.push(`Day ${Math.max(0, i - 1)}`);
  } else {
    for (let d = Date.parse(start) - DAY_MS; d <= Date.parse(end); d += DAY_MS) days.push(new Date(d).toISOString().slice(0, 10));
  }
  const at = new Map(days.map((d, i) => [d, i]));
  const indexOf = (t: TimelineTemplate, date: string) =>
    launch ? Math.min(days.length - 1, 1 + Math.max(0, since(t.publishedAt!.slice(0, 10), date))) : at.get(date);

  const name = shortNames(data.templates.map((t) => t.name));
  const racers = new Map<string, Racer>();
  for (const t of entrants) {
    const base = racerOf(t, field, name);
    const r: Racer = racers.get(base.id) ?? { ...base, cum: new Array(days.length).fill(0), tan: [], first: Infinity };
    if (launch) r.age = indexOf(t, end);
    racers.set(base.id, r);
    for (const a of t.activity) {
      const i = indexOf(t, a.date);
      if (i != null) r.cum[i] += score(a);
    }
  }
  const list = [...racers.values()];
  for (const r of list) {
    r.cum = spread(r.cum, measure === "kickback" ? 7 : 3);
    for (let i = 1; i < r.cum.length; i++) r.cum[i] += r.cum[i - 1];
    r.tan = monotoneSlopes(r.cum);
    r.first = r.cum.findIndex((v) => v > 0);
  }
  const scoring = list.filter((r) => r.first >= 0);
  if (field === "weeks") {
    // A colour per month in the race, in order, so none repeats.
    const months = [...new Set(scoring.map((r) => r.id.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
    for (const r of scoring) {
      const i = months.indexOf(r.id.slice(0, 7));
      if (i >= 0) r.color = MONTH_COLORS[i % MONTH_COLORS.length];
    }
  }

  // Each day's order, for the rank arrows and the leader stamp.
  const ranks = days.map((_, d) => {
    const order = scoring.filter((r) => r.cum[d] > 0).sort((a, b) => b.cum[d] - a.cum[d]);
    return new Map(order.map((r, i) => [r.id, i]));
  });
  const leader = ranks.map((m) => [...m].find(([, i]) => i === 0)?.[0] ?? null);
  const tookLead = leader.map((id, d) => (d > 0 && id != null && leader[d - 1] != null && id !== leader[d - 1] ? d : -1));

  // The clock warps: a day weighs mostly how many places changed on the
  // board, a little how much the totals grew. Days of overtaking get time to
  // follow; a stretch where nothing moves (kickback's lone payouts before
  // August, a burst feeding a runaway leader) passes quickly. A floor keeps
  // an idle day from passing unseen.
  const totals = days.map((_, d) => scoring.reduce((s, r) => s + r.cum[d], 0));
  const swaps = days.map((_, d) => {
    if (d + 1 >= days.length) return 0;
    let n = 0;
    for (const [id, rank] of ranks[d + 1]) if (rank < SHOWN + TAIL && ranks[d].get(id) !== rank) n++;
    return n;
  });
  const per = (xs: number[]) => Math.max(1e-9, xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length - 1));
  const growth = days.map((_, d) => Math.max(0, (totals[d + 1] ?? totals[d]) - totals[d]));
  const meanSwaps = per(swaps);
  const meanGrowth = per(growth);
  const weight = smooth(days.map((_, d) => 0.12 + Math.min(2, swaps[d] / meanSwaps) + 0.5 * Math.min(2, growth[d] / meanGrowth)));
  const clock = weight.slice(0, -1).reduce((s, w) => s + w, 0) || 1;
  // Real time: every day the same, except while one racer at most is in
  // play (kickback's first template alone until July, or from launch the
  // oldest template outliving the rest).
  const inPlay = (d: number) =>
    scoring.filter((r) => (launch ? (r.age ?? 0) >= d + 1 : r.cum[Math.min(d + 1, days.length - 1)] > 0)).length;
  const even = smooth(days.map((_, d) => (inPlay(d) <= 1 ? LONE : 1)));
  return { days, racers: scoring, ranks, leader, tookLead, weight, clock, even, launch, legend: legendOf(field, scoring) };
}

/** Kickback lands in monthly invoice lumps, deploys in bursts: shown as
 * they came, a bar leaps in a blink and then stands still for weeks. Each
 * day's amount is spread over the days that follow, so bars grow; nothing
 * shows before it arrived, and the last day still adds up to the total. */
function spread(daily: number[], days: number) {
  const out = new Array<number>(daily.length).fill(0);
  daily.forEach((v, i) => {
    if (!v) return;
    const last = Math.min(daily.length - 1, i + days - 1);
    for (let j = i; j <= last; j++) out[j] += v / (last - i + 1);
  });
  return out;
}

/** Fritsch–Carlson slopes: a cubic through every day's total that never
 * overshoots or runs backwards, so a bar eases into a busy day and out of
 * it instead of lurching at midnight. */
function monotoneSlopes(y: number[]) {
  const n = y.length;
  const delta = y.slice(0, -1).map((v, i) => y[i + 1] - v);
  const m = y.map((_, i) => (i === 0 ? (delta[0] ?? 0) : i === n - 1 ? delta[n - 2] : delta[i - 1] * delta[i] > 0 ? (delta[i - 1] + delta[i]) / 2 : 0));
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      m[i] = k * a * delta[i];
      m[i + 1] = k * b * delta[i];
    }
  }
  return m;
}

/** A five-day moving average, so the clock speeds up and slows down
 * gradually instead of at day boundaries. */
function smooth(xs: number[]) {
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((s, x) => s + x, 0) / w.length;
  });
}

const flapMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export function RaceBoard({ data }: { data: TimelineResponse }) {
  const [measure, setMeasure] = useState<Measure>("kickback");
  const [field, setField] = useState<Field>("templates");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [pace, setPace] = useState<Pace>("real");
  const race = useMemo(() => build(data, measure, field), [data, measure, field]);
  const span = race.days.length - 1;

  const reduced = useRef(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  tRef.current = t;

  // A new race starts from the gate; with reduced motion it opens on the result.
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      setT(span);
      setPlaying(false);
      return;
    }
    setT(0);
    setPlaying(false);
    const go = window.setTimeout(() => setPlaying(true), 500);
    return () => window.clearTimeout(go);
  }, [race, span]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = -1;
    const step = (now: number) => {
      if (last < 0) last = now;
      const cur = Math.max(0, tRef.current);
      const d = Math.floor(cur);
      // Seconds the current day lasts at 1×.
      const lerp = (xs: number[]) => (xs[d] ?? 1) + ((xs[d + 1] ?? xs[d] ?? 1) - (xs[d] ?? 1)) * (cur - d);
      const lasts = pace === "real" ? DAY_SECONDS * lerp(race.even) : (SECONDS / race.clock) * lerp(race.weight);
      const next = Math.min(span, cur + (Math.max(0, now - last) / 1000) * (speed / lasts));
      tRef.current = next;
      last = now;
      setT(next);
      if (next >= span) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pace, span, race]);

  const day = Math.floor(t);
  const at = (r: Racer, when: number) => {
    const d = Math.floor(when);
    if (d >= span) return r.cum[span];
    // Cubic Hermite between day d and d+1 on the monotone slopes.
    const h = when - d;
    const h2 = h * h;
    const h3 = h2 * h;
    return (
      (2 * h3 - 3 * h2 + 1) * r.cum[d] + (h3 - 2 * h2 + h) * r.tan[d] + (-2 * h3 + 3 * h2) * r.cum[d + 1] + (h3 - h2) * r.tan[d + 1]
    );
  };
  const valueAt = (r: Racer) => at(r, t);
  // Bars move every frame; figures tick a few times a second, like a pump
  // display, so each digit finishes its roll before the next.
  const tick = useRef({ wall: 0, t: 0 });
  const wall = typeof performance === "undefined" ? 0 : performance.now();
  if (!playing || wall - tick.current.wall > 120) tick.current = { wall, t };
  const shown = (r: Racer) => at(r, tick.current.t);
  const standing = race.racers
    .map((r) => ({ r, v: valueAt(r) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.r.id.localeCompare(b.r.id));
  // A few past the cut stay mounted, hidden at the bottom, so a racer
  // dropping out slides away instead of vanishing.
  const field_ = standing.slice(0, SHOWN + TAIL + 3);
  const full = Math.min(SHOWN, race.racers.length);
  const tail = Math.max(0, Math.min(TAIL, race.racers.length - SHOWN));
  const yOf = (rank: number) =>
    rank < SHOWN ? `var(--row) * ${rank}` : `var(--row) * ${SHOWN} + var(--tail) * ${Math.min(rank, SHOWN + TAIL) - SHOWN}`;
  const top = standing[0]?.v ?? 0;
  const total = race.racers.reduce((s, r) => s + shown(r), 0);
  const fmt = (v: number) => (measure === "kickback" ? fmtCents(Math.round(v)) : fmtNum(Math.round(v)));

  const date = new Date(`${race.days[day] ?? race.days[0]}T00:00:00Z`);
  const flapDate = race.launch
    ? `DAY ${String(Math.max(0, day - 1)).padStart(String(span).length, "0")}`
    : `${flapMonth.format(date).toUpperCase()} ${String(date.getUTCDate()).padStart(2, "0")}`;
  const lastLead = (() => {
    for (let d = day; d >= Math.max(0, day - LINGER); d--) if (race.tookLead[d] >= 0) return d;
    return -1;
  })();

  const toggle = () => {
    if (playing) return setPlaying(false);
    if (t >= span) setT(0);
    setPlaying(true);
  };

  const standingsText = standing
    .slice(0, 3)
    .map((x) => `${x.r.label} ${fmt(x.v)}`)
    .join(", ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Choice label="Race" options={MEASURES} value={measure} onChange={setMeasure} />
        <Choice label="Between" options={FIELDS} value={field} onChange={setField} />
        <Choice label="Pace" options={PACES} value={pace} onChange={setPace} />
      </div>

      {/* The board is a carbon island: the dark tokens, whatever the theme. */}
      <div className="race-board dark bg-background text-foreground" data-playing={playing || undefined}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border px-4 pt-4 pb-3 sm:px-6">
          <div className="space-y-1">
            <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {MEASURES.find((m) => m.key === measure)!.board}
            </div>
            <div className="text-xs text-muted-foreground">
              {race.launch ? (
                "Counted from each one's publish day"
              ) : (
                <>
                  Day <span className="tabular-nums">{day}</span> of <span className="tabular-nums">{span}</span>
                </>
              )}
            </div>
          </div>
          <div aria-hidden className="race-flaps text-2xl font-semibold sm:text-3xl">
            {flapDate.split("").map((c, i) => (
              <span key={`${i}-${c}`} className={cn("race-flap", c === " " && "race-flap-gap")}>
                {c === " " ? " " : c}
              </span>
            ))}
          </div>
          <div className="sm:text-right">
            <div className="text-xs text-muted-foreground">All together</div>
            <Odometer text={fmt(total)} className="text-2xl font-semibold sm:text-3xl" />
          </div>
        </div>

        <ol
          aria-hidden
          // Clipped, so racers parked past the cut never sit over the controls.
          className="relative mx-4 my-3 overflow-clip [--row:3.5rem] [--tail:1.75rem] sm:mx-6 sm:[--row:2.75rem] sm:[--tail:1.625rem]"
          // Room for the whole field from the gate, so nothing below jumps.
          style={{ height: `calc(var(--row) * ${Math.max(1, full)} + var(--tail) * ${tail})` }}
        >
          {standing.length === 0 && (
            <li className="absolute inset-0 flex items-center text-sm text-muted-foreground">At the gate.</li>
          )}
          {field_.map(({ r, v }, rank) => {
            const out = rank >= SHOWN + TAIL;
            const small = rank >= SHOWN;
            const before = race.ranks[Math.max(0, day - LINGER)].get(r.id);
            const now = race.ranks[day].get(r.id);
            const move = before == null || now == null ? 0 : before - now;
            const stamp =
              lastLead >= 0 && race.leader[lastLead] === r.id && rank === 0
                ? "New leader"
                : (field === "templates" || field === "launch") && day - r.first >= 0 && day - r.first < LINGER
                  ? measure === "kickback"
                    ? "First kickback"
                    : "First project"
                  : null;
            return (
              <li
                key={r.id}
                className={cn(
                  "race-row absolute inset-x-0 top-0 grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/60 sm:grid-cols-[2.25rem_minmax(8rem,15rem)_minmax(0,1fr)_7.5rem]",
                  small ? "h-(--tail) border-border/30" : "h-(--row) max-sm:content-center max-sm:gap-y-1",
                )}
                style={{
                  transform: `translateY(calc(${yOf(rank)}))`,
                  // The tail thins out the further down it goes.
                  opacity: out ? 0 : small ? 0.75 - ((rank - SHOWN) / TAIL) * 0.5 : 1,
                }}
              >
                <span className={cn("text-right text-muted-foreground tabular-nums", small ? "text-xs" : "text-sm")}>{rank + 1}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate", small ? "text-xs" : "text-sm", rank === 0 && "font-semibold")}>{r.label}</span>
                  {r.age != null && day > r.age && (
                    <span className="shrink-0 text-xs text-muted-foreground">{Math.max(0, r.age - 1)} days old</span>
                  )}
                  {move !== 0 && (
                    <span className={cn("shrink-0 text-xs", move > 0 ? "text-(--chart-2)" : "text-muted-foreground")}>
                      {move > 0 ? "▲" : "▼"}
                    </span>
                  )}
                  {stamp && (
                    <span key={stamp + lastLead + r.first} className="race-stamp shrink-0" data-lead={stamp === "New leader" || undefined}>
                      {stamp}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "min-w-0",
                    small ? "h-2 max-sm:hidden" : "h-3 max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 sm:h-4",
                  )}
                >
                  <span
                    className="race-bar block h-full"
                    style={{ width: `${top > 0 ? Math.max(0.5, (v / top) * 100) : 0}%`, color: r.color }}
                  />
                </span>
                <Odometer
                  text={fmt(shown(r))}
                  className={cn(
                    "justify-self-end max-sm:col-start-3 max-sm:row-start-1",
                    small ? "text-xs" : "text-sm",
                    rank === 0 && "font-semibold",
                  )}
                />
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 sm:px-6">
          <Button size="sm" onClick={toggle} aria-label={playing ? "Pause" : t >= span ? "Run again" : "Play"}>
            {playing ? <Pause /> : t >= span ? <RotateCcw /> : <Play />}
            {playing ? "Pause" : t >= span ? "Run again" : "Play"}
          </Button>
          <div className="flex gap-0.5" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <Button key={s} size="xs" variant={speed === s ? "secondary" : "ghost"} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                <span className="tabular-nums">{s}×</span>
              </Button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={span}
            step="any"
            value={t}
            aria-label="Day of the race"
            aria-valuetext={race.days[day]}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            className="race-scrub min-w-40 flex-1"
          />
          <span className="text-xs text-muted-foreground tabular-nums">{race.days[day]}</span>
        </div>
        <Legend keys={race.legend} />
      </div>

      <p className="sr-only" aria-live="polite">
        {playing ? "" : `${race.days[day]}: ${standingsText || "nothing yet"}.`}
      </p>

      <p className="max-w-[72ch] text-xs text-muted-foreground">
        Each bar is a running total and the longest leads.{" "}
        {measure === "kickback"
          ? "A payout is spread over the week after it lands, so bars grow rather than leap. "
          : "Each day's deploys are spread over the next three days. "}
        {pace === "real"
          ? "Every day takes the same time, a little less while only one racer is in play. "
          : "Days when places change run slowly, days when nothing moves pass quickly. "}
        {measure === "projects" &&
          "User deploys counts every project other users created from a template (its Total deploys on Railway, the New and Projects columns on Templates), whether or not it is still live. "}
        {field === "launch"
          ? "From launch, every template starts on its publish day, so the young ones race the old on equal footing; a bar stops where the template runs out of days."
          : field === "weeks"
            ? "Templates grouped by the week they were published, coloured by month."
            : measure === "kickback"
              ? "Kickback goes back to the first payout in May."
              : "The count starts when collection began in August."}
      </p>
    </div>
  );
}

function Choice<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="mr-1 text-xs text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Button key={o.key} size="xs" variant={value === o.key ? "secondary" : "ghost"} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** Figures that roll: each digit is a strip of 0–9 sliding to its place,
 * keyed from the right so a new leading digit joins without a jolt. */
function Odometer({ text, className }: { text: string; className?: string }) {
  const chars = text.split("");
  return (
    <span className={cn("race-odo inline-flex font-mono tabular-nums", className)} aria-label={text}>
      {chars.map((c, i) => {
        const key = chars.length - i;
        if (c < "0" || c > "9") return <span key={key}>{c}</span>;
        return (
          <span key={key} aria-hidden className="race-digit">
            <span style={{ transform: `translateY(${-Number(c) * 10}%)` }}>
              {"0123456789".split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Legend({ keys }: { keys: { label: string; color: string }[] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
      {keys.map((k) => (
        <span key={k.label} className="inline-flex items-center gap-1.5">
          <span className="race-bar inline-block h-2.5 w-4" style={{ color: k.color }} />
          {k.label}
        </span>
      ))}
    </p>
  );
}
