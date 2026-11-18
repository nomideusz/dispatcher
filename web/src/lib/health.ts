import { HEALTH_FLOOR } from "~/lib/catalog";
import type { HealthSeries, TimelineTemplate } from "~/queries/analytics";

/** The stretch a fall is measured over. */
export const WATCH_DAYS = 14;
/** Points lost over the stretch that count as falling. */
export const HEALTH_FALL = 5;
/** New projects a fix needs before it can be judged: health scores the
 * instances already running, so a fix to the image shows only in deploys
 * made after it. */
export const FIX_TEST_DEPLOYS = 5;
/** New projects in the stretch at or under which a fall is the running
 * instances failing, not the new deploys. */
const FEW_DEPLOYS = 2;
/** Health scores at most this many of the latest deploys: one bad deploy
 * among a full set costs 4 points. */
export const SCORED_DEPLOYS = 25;
/** Days to collect the scored set past which it no longer fills. Measured
 * 16 Nov over 14 days: templates that took up to 39 days sat on k/25 values
 * all the time, those over 50 were 80–100% off them, with fewer than 25
 * scored and moves mostly on instances already running. */
export const SLOW_FILL_DAYS = 30;

export type HealthState =
  | "untested" // a fix is pushed, too few deploys since to judge it
  | "notHeld" // a fix is pushed, deploys have landed, still low
  | "runningFail" // falling with next to no new deploys
  | "newFail" // falling while new deploys land
  | "low"; // low and steady, nothing recorded

export type HealthRead = {
  now: number;
  /** Health at the start of the stretch, or on its first scored day since. */
  change: number | null;
  /** New projects in the stretch, and deploys beyond them: redeploys into
   * projects that already existed. */
  newProjects: number | null;
  redeploys: number | null;
  /** Days to collect SCORED_DEPLOYS new projects at the stretch's pace;
   * Infinity when none came in it. */
  fillDays: number | null;
  /** The stretch's hour-to-hour moves split by whether a new project arrived
   * in the hour: a loss with one is new deploys failing, a loss without one
   * is instances already running going down. The two sum to `change` but
   * for steps across a gap in sampling. */
  changeWithNew: number;
  changeWithout: number;
  /** The recorded fix: new projects since it went out (since the end of its
   * day when the time isn't known) and the health just before it; both null
   * when no sample predates it. */
  fix: { on: string; at: string | null; newSince: number | null; healthThen: number | null } | null;
  state: HealthState;
  /** Health day by day over the whole series, for the row's sparkline. */
  days: string[];
  spark: (number | null)[];
};

const firstFrom = (values: (number | null)[], from: number) => {
  for (let i = Math.max(0, from); i < values.length; i++) if (values[i] != null) return values[i];
  return null;
};
const lastUpTo = (values: (number | null)[], to: number) => {
  for (let i = Math.min(to, values.length - 1); i >= 0; i--) if (values[i] != null) return values[i];
  return null;
};

/** Read one template's series: where its health stands, what it did over
 * the stretch, and what the counts beside it say about why. Null when it
 * has no score today. */
export function readHealth(t: TimelineTemplate, series: HealthSeries): HealthRead | null {
  const s = series.templates.find((x) => x.templateId === t.templateId);
  if (!s || t.health == null) return null;
  const last = series.days.length - 1;
  const cut = Math.max(0, last - WATCH_DAYS);
  const diff = (values: (number | null)[], from: number) => {
    const then = firstFrom(values, from);
    const now = lastUpTo(values, last);
    return then != null && now != null ? now - then : null;
  };
  const then = firstFrom(s.health, cut);
  const change = then != null ? t.health - then : null;
  const added = diff(s.projects, cut);
  const newProjects = added == null ? null : Math.max(0, added);
  const deploys = diff(s.deployments, cut);
  const redeploys = deploys == null || newProjects == null ? null : Math.max(0, deploys - newProjects);
  const fillDays = newProjects == null ? null : newProjects === 0 ? Infinity : (SCORED_DEPLOYS * WATCH_DAYS) / newProjects;
  // Moves on the days after the stretch's first, which `change` starts from.
  const sumAfter = (values: (number | null)[] | undefined) => (values ?? []).slice(cut + 1).reduce<number>((a, v) => a + (v ?? 0), 0);
  const changeWithNew = sumAfter(s.changeWithNew);
  const changeWithout = sumAfter(s.changeWithout);

  // Counted server-side from the hourly samples: a day's series can't tell
  // the deploys before a fix that morning from the ones after it.
  const fix: HealthRead["fix"] = t.fixedOn
    ? { on: t.fixedOn, at: t.fixedAt, newSince: t.fixNewProjects, healthThen: t.fixHealthThen }
    : null;

  const falling = change != null && change <= -HEALTH_FALL;
  const low = t.health < HEALTH_FLOOR;
  const state: HealthState =
    fix?.newSince != null && fix.newSince < FIX_TEST_DEPLOYS
      ? "untested"
      : fix && low
        ? "notHeld"
        : falling
          ? // Blame the side that lost more: a fall with many new projects can
            // still be the running instances, if the hours it fell in had none.
            (newProjects ?? 0) <= FEW_DEPLOYS || changeWithout < changeWithNew
            ? "runningFail"
            : "newFail"
          : "low";
  return { now: t.health, change, newProjects, redeploys, fillDays, changeWithNew, changeWithout, fix, state, days: series.days, spark: s.health };
}

/** A template worth a look: under the floor, or falling toward it. */
export const onWatch = (r: HealthRead) => r.now < HEALTH_FLOOR || (r.change != null && r.change <= -HEALTH_FALL);

/** Still in the fast stage: its latest 25 deploys are recent, so new
 * deploys set the score and a fix shows within days. */
export const isFast = (r: HealthRead) => r.fillDays != null && r.fillDays <= SLOW_FILL_DAYS;

/** Off exactly 100 while still fast: the cheapest health to win back, and
 * the last stage before a lost rank slows deploys and the score sets on the
 * instances already running. */
export const isFixable = (r: HealthRead) => r.now < 100 && isFast(r);

/** Deploys among the scored 25 that aren't up: each costs 4 points. Only
 * meaningful when all 25 count, which a fast template's do. */
export const badOf25 = (health: number) => Math.round(((100 - health) * SCORED_DEPLOYS) / 100);

export type FastState =
  | "turnedOver" // 25+ new projects in the stretch: every miss is a recent deploy
  | "falling" // losing points in the hours new deploys landed, the set not yet replaced
  | "runningDown" // losing points in hours with no new project: instances already running went down
  | "agingOut"; // the misses predate most of the set and can still age out

/** Why a fast template is short of 100, from the stretch's hours. A full
 * turnover comes first: once the stretch replaced all 25, a dip of one
 * deploy says no more than the misses left standing. A fall is the new
 * deploys only when it came in the hours they arrived: Pterodactyl lost 12
 * in one hour with none (15 Nov) while 21 came up healthy around it. */
export function fastState(r: HealthRead): FastState {
  if ((r.newProjects ?? 0) >= SCORED_DEPLOYS) return "turnedOver";
  if (r.changeWithNew < 0) return "falling";
  if (r.change != null && r.change < 0 && r.changeWithout < 0) return "runningDown";
  return "agingOut";
}

/** Where a template shows in the latest search run: each keyword it is
 * listed for, best position first. */
export type SearchStake = { query: string; position: number; demand: number; prevBest: number | null; ourBest: number | null }[];

export function searchStake(templateId: string, keywords: { query: string; demand: number; best: number | null; prevBest: number | null; top: { position: number; templateId: string }[] }[]): SearchStake {
  return keywords
    .flatMap((k) => {
      const hit = k.top.find((x) => x.templateId === templateId);
      return hit ? [{ query: k.query, position: hit.position, demand: k.demand, prevBest: k.prevBest, ourBest: k.best }] : [];
    })
    .sort((a, b) => a.position - b.position || b.demand - a.demand);
}

/** One hour-to-hour move in health, with what else moved in that hour. */
export type HealthMove = {
  at: string;
  from: number;
  to: number;
  /** New projects that arrived in the hour (Railway's count rising). */
  newProjects: number;
  /** Active projects lost in the hour: deleted or stopped. */
  lostActive: number;
};

/** Every change in an hourly series, newest first. A gap of more than
 * 2.5 hours between samples is skipped: across it, what moved together
 * can't be told apart. */
export function healthMoves(points: { sampledAt: string; health: number | null; projects: number; activeProjects: number }[]): HealthMove[] {
  const scored = points.filter((p) => p.health != null);
  const out: HealthMove[] = [];
  for (let i = 1; i < scored.length; i++) {
    const a = scored[i - 1];
    const b = scored[i];
    if (a.health === b.health) continue;
    if (Date.parse(b.sampledAt) - Date.parse(a.sampledAt) > 2.5 * 3_600_000) continue;
    out.push({
      at: b.sampledAt,
      from: a.health!,
      to: b.health!,
      newProjects: Math.max(0, b.projects - a.projects),
      lostActive: Math.max(0, a.activeProjects - b.activeProjects),
    });
  }
  return out.reverse();
}
