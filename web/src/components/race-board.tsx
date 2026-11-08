import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROUPS, groupOf } from "~/components/chart-kit";
import { Button } from "~/components/ui/button";
import { fmtCents, fmtNum, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { KINDS, ORIGINS, type TimelineResponse, type TimelineTemplate } from "~/queries/analytics";

/** The board: kickback or new projects, day by day, run as a race between
 * templates or their groups. A Dispatcher reads like a departures board, so
 * that is the look: the date flips, the figures roll, rows glide to their
 * place and a stamp lands on a first kickback or a change of leader. */

type Measure = "kickback" | "projects";
type Field = "templates" | "kinds" | "sizes" | "origins" | "months" | "weeks";
type Clock = "calendar" | "launch";
type Count = "total" | "per";
type Biggest = "kept" | "out";

const MEASURES: { key: Measure; label: string; board: string }[] = [
  { key: "kickback", label: "Kickback", board: "Kickback earned" },
  { key: "projects", label: "User deploys", board: "Deployed by users" },
];
const FIELDS: { key: Field; label: string }[] = [
  { key: "templates", label: "Templates" },
  { key: "kinds", label: "Kinds" },
  { key: "sizes", label: "Sizes" },
  { key: "origins", label: "Origins" },
  { key: "months", label: "Publish months" },
  { key: "weeks", label: "Publish weeks" },
];
const CLOCKS: { key: Clock; label: string }[] = [
  { key: "calendar", label: "Calendar" },
  { key: "launch", label: "From launch" },
];
const COUNTS: { key: Count; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "per", label: "Per template" },
];
const BIGGEST: { key: Biggest; label: string }[] = [
  { key: "kept", label: "Kept" },
  { key: "out", label: "Left out" },
];
/** Per template: under this many templates a group sits out, and from
 * launch its bar stops at the age fewer than this have reached, since past
 * that one payer makes the line. */
const MIN_GROUP = 5;
const SPEEDS = [0.5, 1, 2, 4] as const;
type Pace = "real" | "eventful";
type Start = "full" | "first";
const STARTS: { key: Start; label: string }[] = [
  { key: "full", label: "Board full" },
  { key: "first", label: "First day" },
];
const PACES: { key: Pace; label: string }[] = [
  { key: "eventful", label: "Eventful" },
  { key: "real", label: "Real time" },
];
/** Eventful: a race lasts this long at 1×, whatever the span of days. */
const SECONDS = 60;
/** Real time: a day lasts this long at 1×; a lone racer's days run faster. */
const DAY_SECONDS = 0.45;
const LONE = 0.35;
/** Full rows, then a tail of smaller ones fading out. */
const SHOWN = 10;
const TAIL = 10;
/** Closer than this counts as level. */
const TIE = 1e-6;
/** Days a stamp or a rank arrow stays up. */
const LINGER = 3;

const KIND_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)", "var(--chart-1)", "var(--chart-other)"];
/** Publish weeks take their month's colour, cycling. */
const MONTH_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)", "var(--chart-1)"];
const ORIGIN_COLORS = ["var(--chart-3)", "var(--chart-1)"];
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
  /** From launch: shown once the race passes its last day. */
  note?: string;
}

/** A colour of its own per template, given by where it finishes: the top
 * ten take ten evenly spaced hues, neighbours in rank 108° apart; the tail
 * takes the hues between, darker; the rest step by the golden angle. */
function finishColor(i: number) {
  if (i < SHOWN) return `oklch(0.8 0.13 ${((i * 3) % 10) * 36 + 15})`;
  if (i < SHOWN + TAIL) return `oklch(0.68 0.12 ${((i * 3) % 10) * 36 + 33})`;
  return `oklch(0.7 0.1 ${((i * 137.508) % 360).toFixed(1)})`;
}

function racerOf(
  t: TimelineTemplate,
  field: Field,
  name: (n: string) => string,
): Pick<Racer, "id" | "label" | "color"> {
  switch (field) {
    case "templates":
      return { id: t.templateId, label: name(t.name), color: UNSORTED };
    case "sizes": {
      const g = groupOf(t);
      return g < 0 ? { id: "unsorted", label: "Unsorted", color: UNSORTED } : { id: `s${g}`, label: GROUPS[g].label, color: GROUPS[g].color };
    }
    case "origins": {
      const i = ORIGINS.findIndex((o) => o.key === t.origin);
      return i < 0 ? { id: "unsorted", label: "Unsorted", color: UNSORTED } : { id: ORIGINS[i].key, label: ORIGINS[i].label, color: ORIGIN_COLORS[i] };
    }
    case "months": {
      if (!t.publishedAt) return { id: "unknown", label: "Date unknown", color: UNSORTED };
      const d = new Date(`${t.publishedAt.slice(0, 7)}-01T00:00:00Z`);
      return { id: t.publishedAt.slice(0, 7), label: monthName.format(d), color: UNSORTED };
    }
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
  // A template's colour is only its own; there is nothing to key.
  if (field === "templates") return [];
  if (field !== "weeks") return [...racers].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ label: r.label, color: r.color }));
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
 * template's own, counted from the day it was published. Per template
 * divides a group's total by its templates; leaving out the biggest drops
 * each group's top template (for templates, the top one overall). */
function build(data: TimelineResponse, measure: Measure, field: Field, timeline: Clock, count: Count, biggest: Biggest, from: Start) {
  const score = (a: { earnedCents: number; newProjects: number }) => (measure === "kickback" ? a.earnedCents : a.newProjects);
  const dates = data.templates.flatMap((t) => t.activity.filter((a) => score(a) > 0).map((a) => a.date));
  const end = data.sampledAt.slice(0, 10);
  const start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : end;
  const launch = timeline === "launch";
  const perTemplate = count === "per" && field !== "templates";
  const since = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
  const pub = (t: TimelineTemplate) => (t.publishedAt ?? t.firstSeenAt).slice(0, 10);

  // From launch, only templates published after collection began, so none
  // is missing its first days.
  const entrants = launch ? data.templates.filter((t) => t.publishedAt && t.publishedAt.slice(0, 10) >= start) : data.templates;
  const days: string[] = [];
  if (launch) {
    const oldest = Math.max(1, ...entrants.map((t) => since(pub(t), end)));
    for (let i = 0; i <= oldest + 1; i++) days.push(`Day ${Math.max(0, i - 1)}`);
  } else {
    for (let d = Date.parse(start) - DAY_MS; d <= Date.parse(end); d += DAY_MS) days.push(new Date(d).toISOString().slice(0, 10));
  }
  const last = days.length - 1;
  const at = new Map(days.map((d, i) => [d, i]));
  const indexOf = (t: TimelineTemplate, date: string) =>
    launch ? Math.min(last, 1 + Math.max(0, since(pub(t), date))) : at.get(date);

  // The last day each template has lived through: from launch its own age,
  // on the calendar the end; and the first, the day it was published.
  const lastDay = (t: TimelineTemplate) => (launch ? indexOf(t, end)! : last);
  const firstDay = (t: TimelineTemplate) => (launch ? 0 : (at.get(pub(t)) ?? 0));
  // Each template's running total, its payouts spread as they are shown but
  // never past its own last day.
  const cumOf = new Map<TimelineTemplate, number[]>();
  for (const t of entrants) {
    const daily = new Array<number>(days.length).fill(0);
    for (const a of t.activity) {
      const i = indexOf(t, a.date);
      if (i != null) daily[i] += score(a);
    }
    const own = spread(daily.slice(0, lastDay(t) + 1), measure === "kickback" ? 7 : 3);
    const cum = days.map((_, d) => own[Math.min(d, own.length - 1)]);
    for (let i = 1; i < own.length; i++) cum[i] += cum[i - 1];
    for (let i = own.length; i < cum.length; i++) cum[i] = cum[own.length - 1];
    cumOf.set(t, cum);
  }
  const final = (t: TimelineTemplate) => cumOf.get(t)![last];

  const name = shortNames(data.templates.map((t) => t.name));
  const groups = new Map<string, { base: Pick<Racer, "id" | "label" | "color">; members: TimelineTemplate[] }>();
  for (const t of entrants) {
    const base = racerOf(t, field, name);
    const g = groups.get(base.id) ?? { base, members: [] };
    g.members.push(t);
    groups.set(base.id, g);
  }
  const leftOut: string[] = [];
  if (biggest === "out") {
    const topOf = (ts: TimelineTemplate[]) => ts.reduce((m, t) => (final(t) > final(m) ? t : m));
    if (field === "templates" && entrants.length) {
      const top = topOf(entrants);
      if (final(top) > 0) {
        groups.delete(top.templateId);
        leftOut.push(name(top.name));
      }
    } else {
      for (const g of groups.values()) {
        if (g.members.length < 2) continue;
        const top = topOf(g.members);
        if (final(top) <= 0) continue;
        g.members = g.members.filter((t) => t !== top);
        leftOut.push(name(top.name));
      }
    }
  }

  /** A group's line: the sum of its templates, or per template the mean
   * cumulative: each day adds the average its templates earned that day,
   * over the ones live on it (published by then, or from launch that old).
   * A young template counts for the days it has had, a new one joining
   * doesn't drag the bar back, and no template is dropped for its age. */
  const combine = (members: TimelineTemplate[]): (Pick<Racer, "cum" | "age" | "note"> & { n: number }) | null => {
    if (!perTemplate) {
      const cum = days.map((_, d) => members.reduce((s, t) => s + cumOf.get(t)![d], 0));
      if (!launch) return { cum, n: members.length };
      const oldest = members.reduce((m, t) => Math.max(m, lastDay(t)), 0);
      return { cum, age: oldest, note: field === "templates" ? `${oldest - 1} days old` : `to day ${oldest - 1}`, n: members.length };
    }
    if (members.length < MIN_GROUP) return null;
    const cum = new Array<number>(days.length).fill(0);
    let stop = last;
    for (let d = 1; d < days.length; d++) {
      const live = members.filter((t) => firstDay(t) <= d && d <= lastDay(t));
      if (launch && live.length < MIN_GROUP) {
        stop = d - 1;
        break;
      }
      const gain = live.reduce((s, t) => s + cumOf.get(t)![d] - cumOf.get(t)![d - 1], 0);
      cum[d] = cum[d - 1] + (live.length ? gain / live.length : 0);
    }
    for (let d = stop + 1; d < days.length; d++) cum[d] = cum[stop];
    return launch ? { cum, age: stop, note: `to day ${stop - 1}`, n: members.length } : { cum, n: members.length };
  };

  const list: Racer[] = [];
  for (const { base, members } of groups.values()) {
    const line = combine(members);
    if (!line) continue;
    list.push({ ...base, label: perTemplate ? `${base.label} (${line.n})` : base.label, cum: line.cum, age: line.age, note: line.note, tan: [], first: -1 });
  }
  const everyone = [...groups.values()].flatMap((g) => g.members);
  const allLine = combine(everyone) ?? { cum: days.map((_, d) => everyone.reduce((s, t) => s + cumOf.get(t)![d], 0)) };
  const all: Racer = { id: "all", label: "All", color: UNSORTED, cum: allLine.cum, tan: [], first: -1 };
  for (const r of [...list, all]) {
    r.tan = monotoneSlopes(r.cum);
    r.first = r.cum.findIndex((v) => v > 0);
  }
  const scoring = list.filter((r) => r.first >= 0);
  // Board full: the early stretch (one template paid until August, nothing
  // in a launch's first days) is a few bars and the odd payment, no race.
  // Start on the first day the board's top rows are all taken; what came
  // before is the head start they line up with.
  if (from === "full") {
    const need = Math.min(SHOWN, scoring.length);
    const full = days.findIndex((_, d) => scoring.filter((r) => r.cum[d] > 0).length >= need);
    const cut = Math.max(0, full - 1);
    if (cut > 0) {
      days.splice(0, cut);
      for (const r of [...scoring, all]) {
        r.cum = r.cum.slice(cut);
        r.tan = r.tan.slice(cut);
        r.first -= cut;
        if (r.age != null) r.age -= cut;
      }
    }
  }
  if (field === "templates") {
    const last = days.length - 1;
    [...scoring].sort((a, b) => b.cum[last] - a.cum[last]).forEach((r, i) => (r.color = finishColor(i)));
  }
  if (field === "months") {
    [...scoring].sort((a, b) => a.id.localeCompare(b.id)).forEach((r, i) => {
      if (/^\d{4}-\d{2}$/.test(r.id)) r.color = MONTH_COLORS[i % MONTH_COLORS.length];
    });
  }
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

  // Eventful: a day weighs what the eye sees change on it, how far the bars
  // on the board move against the leader's and how many places swap. Early
  // on, with the leader at a few dollars, one payment rescales every bar and
  // that day gets time; later the same payment barely shows and its day
  // passes quickly. A floor keeps an idle day from passing unseen.
  const onBoard = (d: number, id: string) => (ranks[d].get(id) ?? Infinity) < SHOWN + TAIL;
  const tops = days.map((_, d) => scoring.reduce((m, r) => Math.max(m, r.cum[d]), TIE));
  const motion = days.map((_, d) => {
    if (d + 1 >= days.length) return 0;
    let m = 0;
    for (const r of scoring) if (onBoard(d + 1, r.id)) m += Math.abs(r.cum[d + 1] / tops[d + 1] - r.cum[d] / tops[d]);
    return m;
  });
  const swaps = days.map((_, d) => {
    if (d + 1 >= days.length) return 0;
    let n = 0;
    for (const [id, rank] of ranks[d + 1]) if (rank < SHOWN + TAIL && ranks[d].get(id) !== rank) n++;
    return n;
  });
  const per = (xs: number[]) => Math.max(1e-9, xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length - 1));
  const meanMotion = per(motion);
  const meanSwaps = per(swaps);
  const weight = smooth(days.map((_, d) => 0.15 + Math.min(8, motion[d] / meanMotion) + 0.5 * Math.min(3, swaps[d] / meanSwaps)));
  const clock = weight.slice(0, -1).reduce((s, w) => s + w, 0) || 1;
  // Real time: every day the same, except while one racer at most is in
  // play (kickback's first template alone until July, or from launch the
  // oldest template outliving the rest).
  const inPlay = (d: number) =>
    scoring.filter((r) => (launch ? (r.age ?? 0) >= d + 1 : r.cum[Math.min(d + 1, days.length - 1)] > 0)).length;
  const even = smooth(days.map((_, d) => (inPlay(d) <= 1 ? LONE : 1)));
  return { days, racers: scoring, all, ranks, leader, tookLead, weight, clock, even, launch, per: perTemplate, leftOut, legend: legendOf(field, scoring) };
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
  const [clock, setClock] = useState<Clock>("calendar");
  const [count, setCount] = useState<Count>("total");
  const [biggest, setBiggest] = useState<Biggest>("kept");
  const [pace, setPace] = useState<Pace>("eventful");
  const [start, setStart] = useState<Start>("full");
  const race = useMemo(
    () => build(data, measure, field, clock, count, biggest, start),
    [data, measure, field, clock, count, biggest, start],
  );
  const span = race.days.length - 1;

  const reduced = useRef(false);
  // Clamped: switching from a finished long race to a shorter one renders
  // once with the old clock before the reset below lands, past the last day.
  const [clockT, setT] = useState(0);
  const t = Math.min(clockT, span);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  tRef.current = t;

  // A new race waits at the gate for Play; with reduced motion it opens on
  // the result. Neither loading the page nor changing a setting starts it.
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setT(reduced.current ? span : 0);
    setPlaying(false);
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
  // Ties keep the order they had: whoever got there first stays ahead.
  // Without it, racers level on a count flip on rounding noise every frame
  // and their rows twitch back and forth.
  const lastOrder = useRef(new Map<string, number>());
  const before = (id: string) => lastOrder.current.get(id) ?? Infinity;
  const standing = race.racers
    .map((r) => ({ r, v: valueAt(r) }))
    .filter((x) => x.v > TIE)
    .sort((a, b) => (Math.abs(b.v - a.v) > TIE ? b.v - a.v : before(a.r.id) - before(b.r.id) || a.r.id.localeCompare(b.r.id)));
  lastOrder.current = new Map(standing.map((x, i) => [x.r.id, i]));
  // A few past the cut stay mounted, hidden at the bottom, so a racer
  // dropping out slides away instead of vanishing.
  const field_ = standing.slice(0, SHOWN + TAIL + 3);
  const full = Math.min(SHOWN, race.racers.length);
  const tail = Math.max(0, Math.min(TAIL, race.racers.length - SHOWN));
  const yOf = (rank: number) =>
    rank < SHOWN ? `var(--row) * ${rank}` : `var(--row) * ${SHOWN} + var(--tail) * ${Math.min(rank, SHOWN + TAIL) - SHOWN}`;
  const top = standing[0]?.v ?? 0;
  const total = shown(race.all);
  const fmt = (v: number) =>
    measure === "kickback" ? fmtCents(Math.round(v)) : race.per ? (Math.round(v * 10) / 10).toFixed(1) : fmtNum(Math.round(v));

  const date = new Date(`${race.days[day] ?? race.days[0]}T00:00:00Z`);
  const flapDate = race.launch
    ? `DAY ${(race.days[day] ?? "").slice(4).padStart((race.days[span] ?? "").slice(4).length, "0")}`
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
        <Choice label="Clock" options={CLOCKS} value={clock} onChange={setClock} />
        {field !== "templates" && <Choice label="Count" options={COUNTS} value={count} onChange={setCount} />}
        <Choice label="Biggest" options={BIGGEST} value={biggest} onChange={setBiggest} />
        <Choice label="Pace" options={PACES} value={pace} onChange={setPace} />
        <Choice label="Start" options={STARTS} value={start} onChange={setStart} />
      </div>

      {/* The board is a carbon island: the dark tokens, whatever the theme. */}
      <div className="race-board dark bg-background text-foreground" data-playing={playing || undefined}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border px-4 pt-4 pb-3 sm:px-6">
          <div className="space-y-1">
            <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {MEASURES.find((m) => m.key === measure)!.board}
              {race.per && " per template"}
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
            <div className="text-xs text-muted-foreground">{race.per ? "Every template" : "All together"}</div>
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
                : field === "templates" && day - r.first >= 0 && day - r.first < LINGER
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
                  {r.age != null && r.note && day > r.age && (
                    <span className="shrink-0 text-xs text-muted-foreground">{r.note}</span>
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
        {start === "full" && "The race starts once ten racers have scored; what they had by then is their head start. "}
        {measure === "kickback"
          ? "A payout is spread over the week after it lands, so bars grow rather than leap. "
          : "Each day's deploys are spread over the next three days. "}
        {pace === "real"
          ? "Every day takes the same time, a little less while only one racer is in play. "
          : "Days when places change run slowly, days when nothing moves pass quickly. "}
        {measure === "projects" &&
          "User deploys counts every project other users created from a template (its Total deploys on Railway, the New and Projects columns on Templates), whether or not it is still live. "}
        {clock === "launch"
          ? race.per
            ? "From launch, every template starts on its publish day, and each day a group's bar adds what its templates that old added that day, on average, so young templates count for the days they have had; a bar stops where fewer than five of its templates are that old. "
            : "From launch, every template starts on its publish day, so the young ones race the old on equal footing; a bar stops where its templates run out of days. "
          : race.per
            ? "Per template, each day a group's bar adds what its templates published by then added that day, on average, so a big group doesn't win on numbers; groups of older templates have still had longer to collect, which From launch evens out. "
            : field === "weeks"
              ? "Templates grouped by the week they were published, coloured by month. "
              : measure === "kickback"
                ? "Kickback goes back to the first payout in May. "
                : "The count starts when collection began in August. "}
        {race.per && "Groups under five templates sit out. "}
        {biggest === "out" &&
          race.leftOut.length > 0 &&
          (field === "templates"
            ? `${race.leftOut[0]} is left out. `
            : `Each group's biggest is left out (${race.leftOut.join(", ")}). `)}
        {!(clock === "launch" && (race.per || field === "templates") && biggest === "out") &&
          "For the fairest race: From launch, Per template, Biggest left out."}
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
  if (keys.length === 0) return null;
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
