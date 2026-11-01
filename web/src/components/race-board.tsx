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
type Field = "templates" | "kinds" | "sizes" | "origin";

const MEASURES: { key: Measure; label: string; board: string }[] = [
  { key: "kickback", label: "Kickback", board: "Kickback earned" },
  { key: "projects", label: "New projects", board: "New projects" },
];
const FIELDS: { key: Field; label: string }[] = [
  { key: "templates", label: "Templates" },
  { key: "kinds", label: "Kinds" },
  { key: "sizes", label: "Sizes" },
  { key: "origin", label: "Original or not" },
];
const SPEEDS = [1, 2, 4] as const;
/** A race lasts this long at 1×, whatever the span of days. */
const SECONDS = 24;
const SHOWN = 10;
/** Days a stamp or a rank arrow stays up. */
const LINGER = 3;

const KIND_COLORS = ["var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)", "var(--chart-1)", "var(--chart-other)"];
const ORIGIN_COLORS = { original: "var(--chart-2)", competitive: "var(--chart-5)" };
const UNSORTED = "var(--chart-other)";

interface Racer {
  id: string;
  label: string;
  color: string;
  /** Running total at the end of each day. */
  cum: number[];
  /** The day it first scored, for the stamp. */
  first: number;
}

function racerOf(t: TimelineTemplate, field: Field, name: (n: string) => string): Omit<Racer, "cum" | "first"> {
  switch (field) {
    case "templates":
      return { id: t.templateId, label: name(t.name), color: GROUPS[groupOf(t)].color };
    case "sizes": {
      const g = GROUPS[groupOf(t)];
      return { id: g.label, label: g.label, color: g.color };
    }
    case "kinds": {
      const i = KINDS.findIndex((k) => k.key === t.kind);
      return i < 0 ? { id: "unsorted", label: "Unsorted", color: UNSORTED } : { id: KINDS[i].key, label: KINDS[i].label, color: KIND_COLORS[i] };
    }
    case "origin": {
      const o = ORIGINS.find((x) => x.key === t.origin);
      return o ? { id: o.key, label: o.label, color: ORIGIN_COLORS[o.key] } : { id: "unmarked", label: "Not marked", color: UNSORTED };
    }
  }
}

/** Days from the one before anything scored to the last sample, and each
 * racer's running total over them. */
function build(data: TimelineResponse, measure: Measure, field: Field) {
  const score = (a: { earnedCents: number; newProjects: number }) => (measure === "kickback" ? a.earnedCents : a.newProjects);
  const dates = data.templates.flatMap((t) => t.activity.filter((a) => score(a) > 0).map((a) => a.date));
  const end = data.sampledAt.slice(0, 10);
  const start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : end;
  const days: string[] = [];
  for (let d = Date.parse(start) - 86_400_000; d <= Date.parse(end); d += 86_400_000) days.push(new Date(d).toISOString().slice(0, 10));
  const at = new Map(days.map((d, i) => [d, i]));

  const name = shortNames(data.templates.map((t) => t.name));
  const racers = new Map<string, Racer>();
  for (const t of data.templates) {
    const base = racerOf(t, field, name);
    const r = racers.get(base.id) ?? { ...base, cum: new Array(days.length).fill(0), first: Infinity };
    racers.set(base.id, r);
    for (const a of t.activity) {
      const i = at.get(a.date);
      if (i != null) r.cum[i] += score(a);
    }
  }
  const list = [...racers.values()];
  for (const r of list) {
    for (let i = 1; i < r.cum.length; i++) r.cum[i] += r.cum[i - 1];
    r.first = r.cum.findIndex((v) => v > 0);
  }
  const scoring = list.filter((r) => r.first >= 0);

  // Each day's order, for the rank arrows and the leader stamp.
  const ranks = days.map((_, d) => {
    const order = scoring.filter((r) => r.cum[d] > 0).sort((a, b) => b.cum[d] - a.cum[d]);
    return new Map(order.map((r, i) => [r.id, i]));
  });
  const leader = ranks.map((m) => [...m].find(([, i]) => i === 0)?.[0] ?? null);
  const tookLead = leader.map((id, d) => (d > 0 && id != null && leader[d - 1] != null && id !== leader[d - 1] ? d : -1));

  // The clock warps: a day weighs what moved on it, so a quiet stretch
  // (kickback's lone payouts from May to August) flies by and the busy days
  // get the screen. A floor keeps an idle day from passing unseen.
  const sum = (d: number) => scoring.reduce((s, r) => s + r.cum[d], 0);
  const totals = days.map((_, d) => sum(d));
  const mean = Math.max(1, totals[days.length - 1] - totals[0]) / Math.max(1, days.length - 1);
  const weight = days.map((_, d) => 0.15 + Math.max(0, (totals[d + 1] ?? totals[d]) - totals[d]) / mean);
  const clock = weight.slice(0, -1).reduce((s, w) => s + w, 0) || 1;
  return { days, racers: scoring, ranks, leader, tookLead, weight, clock };
}

const flapMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export function RaceBoard({ data }: { data: TimelineResponse }) {
  const [measure, setMeasure] = useState<Measure>("kickback");
  const [field, setField] = useState<Field>("templates");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
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
    let last = performance.now();
    const step = (now: number) => {
      const cur = tRef.current;
      const w = race.weight[Math.floor(cur)] ?? 1;
      const next = Math.min(span, cur + ((now - last) / 1000) * (race.clock / SECONDS) * (speed / w));
      tRef.current = next;
      last = now;
      setT(next);
      if (next >= span) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, span, race]);

  const day = Math.floor(t);
  const at = (r: Racer, when: number) => {
    const d = Math.floor(when);
    return r.cum[d] + ((r.cum[Math.min(span, d + 1)] ?? r.cum[d]) - r.cum[d]) * (when - d);
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
  const field_ = standing.slice(0, SHOWN + 3);
  const top = standing[0]?.v ?? 0;
  const total = race.racers.reduce((s, r) => s + shown(r), 0);
  const fmt = (v: number) => (measure === "kickback" ? fmtCents(Math.round(v)) : fmtNum(Math.round(v)));

  const date = new Date(`${race.days[day] ?? race.days[0]}T00:00:00Z`);
  const flapDate = `${flapMonth.format(date).toUpperCase()} ${String(date.getUTCDate()).padStart(2, "0")}`;
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
      </div>

      {/* The board is a carbon island: the dark tokens, whatever the theme. */}
      <div className="race-board dark bg-background text-foreground" data-playing={playing || undefined}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border px-4 pt-4 pb-3 sm:px-6">
          <div className="space-y-1">
            <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {MEASURES.find((m) => m.key === measure)!.board}
            </div>
            <div className="text-xs text-muted-foreground">
              Day <span className="tabular-nums">{day}</span> of <span className="tabular-nums">{span}</span>
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
          className="relative mx-4 my-3 [--row:3.5rem] sm:mx-6 sm:[--row:2.75rem]"
          // Room for the whole field from the gate, so nothing below jumps.
          style={{ height: `calc(var(--row) * ${Math.max(1, Math.min(SHOWN, race.racers.length))})` }}
        >
          {standing.length === 0 && (
            <li className="absolute inset-0 flex items-center text-sm text-muted-foreground">At the gate.</li>
          )}
          {field_.map(({ r, v }, rank) => {
            const out = rank >= SHOWN;
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
                className="race-row absolute inset-x-0 top-0 grid h-(--row) grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/60 max-sm:content-center max-sm:gap-y-1 sm:grid-cols-[2.25rem_minmax(8rem,15rem)_minmax(0,1fr)_7.5rem]"
                style={{
                  transform: `translateY(calc(var(--row) * ${out ? SHOWN : rank}))`,
                  opacity: out ? 0 : 1,
                }}
              >
                <span className="text-right text-sm text-muted-foreground tabular-nums">{rank + 1}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate text-sm", rank === 0 && "font-semibold")}>{r.label}</span>
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
                <span className="h-3 min-w-0 max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 sm:h-4">
                  <span
                    className="race-bar block h-full"
                    style={{ width: `${top > 0 ? Math.max(0.5, (v / top) * 100) : 0}%`, color: r.color }}
                  />
                </span>
                <Odometer
                  text={fmt(shown(r))}
                  className={cn("justify-self-end text-sm max-sm:row-start-1 max-sm:col-start-3", rank === 0 && "font-semibold")}
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
        <Legend field={field} racers={race.racers} />
      </div>

      <p className="sr-only" aria-live="polite">
        {playing ? "" : `${race.days[day]}: ${standingsText || "nothing yet"}.`}
      </p>

      <p className="max-w-[72ch] text-xs text-muted-foreground">
        Each bar is a running total and the longest leads. Quiet days pass quickly, busy ones slowly.{" "}
        {measure === "kickback" ? "Kickback goes back to the first payout in May." : "New projects start when collection began in August."}
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

function Legend({ field, racers }: { field: Field; racers: Racer[] }) {
  const keys =
    field === "templates" || field === "sizes"
      ? GROUPS.map((g) => ({ label: g.label, color: g.color }))
      : [...new Map(racers.map((r) => [r.id, { label: r.label, color: r.color }])).values()];
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
