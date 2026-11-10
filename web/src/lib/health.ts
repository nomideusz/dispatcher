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
  /** The recorded fix: new projects since the day before it and the health
   * it stood at then; both null when it predates the series. */
  fix: { on: string; newSince: number | null; healthThen: number | null } | null;
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

  let fix: HealthRead["fix"] = null;
  if (t.fixedOn) {
    // The day before the fix is the baseline; -1 when the fix predates the series.
    let before = -1;
    series.days.forEach((d, i) => {
      if (d < t.fixedOn) before = i;
    });
    const base = before < 0 ? null : lastUpTo(s.projects, before);
    const nowProjects = lastUpTo(s.projects, last);
    fix = {
      on: t.fixedOn,
      newSince: base != null && nowProjects != null ? Math.max(0, nowProjects - base) : null,
      healthThen: before < 0 ? null : lastUpTo(s.health, before),
    };
  }

  const falling = change != null && change <= -HEALTH_FALL;
  const low = t.health < HEALTH_FLOOR;
  const state: HealthState =
    fix?.newSince != null && fix.newSince < FIX_TEST_DEPLOYS
      ? "untested"
      : fix && low
        ? "notHeld"
        : falling
          ? (newProjects ?? 0) <= FEW_DEPLOYS
            ? "runningFail"
            : "newFail"
          : "low";
  return { now: t.health, change, newProjects, redeploys, fix, state, days: series.days, spark: s.health };
}

/** A template worth a look: under the floor, or falling toward it. */
export const onWatch = (r: HealthRead) => r.now < HEALTH_FLOOR || (r.change != null && r.change <= -HEALTH_FALL);
