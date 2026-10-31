import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";

/** One UTC day. earnedCents and newProjects are what the day's snapshots saw
 * arrive; the counts are the day's last sample, null on a day without one
 * (before tracking or during a collection gap). published/services are the
 * catalog as of the end of the day. */
export interface TimelinePoint {
  date: string;
  earnedCents: number;
  newProjects: number;
  projects: number | null;
  activeProjects: number | null;
  /** templateMetrics.activeDeployments — Railway's metrics page "Active":
   * running instances, not projects. Null before metrics were collected. */
  running: number | null;
  /** Published templates with any project ever, with a live project, and
   * with kickback in Railway's trailing 30 days (null before Railway
   * reported it), at the day's last sample; null on a day without one. */
  deployedTemplates: number | null;
  activeTemplates: number | null;
  earningTemplates: number | null;
  /** What the published templates had earned by the day's last sample. */
  lifetimeCents: number | null;
  published: number;
  services: number;
}

export interface TimelineActivity {
  date: string;
  earnedCents: number;
  newProjects: number;
}

export interface TimelineTemplate {
  templateId: string;
  name: string;
  code: string;
  /** What it is for, set by hand; "" until sorted. */
  kind: Kind | "";
  /** Original (nothing like it on Railway when published) or a competitive
   * pick, set by hand; "" until marked. */
  origin: Origin | "";
  /** Railway's Template.createdAt; the API has no separate publish date. */
  publishedAt: string | null;
  firstSeenAt: string;
  services: number;
  /** Projects other users created from the template (the public page's
   * "Total deploys"); activeProjects are the ones still live. */
  projects: number;
  activeProjects: number;
  running: number | null;
  /** templateMetrics.totalDeployments: every deploy, the author's included. */
  deployments: number | null;
  /** Deploy health and support health, 0–100. Support health of 80+ earns
   * the +10% kickback bonus; null (no threads to grade) counts as healthy. */
  health: number | null;
  supportHealth: number | null;
  /** templateMetrics.earningsLast30Days, in dollars. */
  earned30d: number | null;
  lifetimeCents: number;
  /** In the selected range; activity is the same, day by day. */
  earnedCents: number;
  newProjects: number;
  activity: TimelineActivity[];
  /** The snapshot that saw the latest new project, and the one before it:
   * the project arrived in between (days apart across a collection gap). */
  lastDeployAt: string | null;
  lastDeployAfter: string | null;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
}

export interface TimelineResponse {
  sampledAt: string;
  trackedSince: string;
  window: {
    days: number;
    earnedCents: number;
    previousEarnedCents: number;
    newProjects: number;
    /** Null when the previous range began before tracking did. */
    previousNewProjects: number | null;
  };
  /** Stretches of more than a day without a sample; what arrived during one
   * lands on its `to` day. A gap ending near now means the collector stopped. */
  gaps: { from: string; to: string }[];
  points: TimelinePoint[];
  templates: TimelineTemplate[];
}

/** Support health of 80%+ earns the +10% kickback bonus. No threads to
 * grade counts as healthy. */
export const SUPPORT_BONUS_THRESHOLD = 80;

export function qualifiesForBonus(t: TimelineTemplate): boolean {
  return (t.supportHealth ?? 100) >= SUPPORT_BONUS_THRESHOLD;
}

export const timelineQuery = (days: number) =>
  queryOptions({
    queryKey: ["analytics", "timeline", days],
    queryFn: ({ signal }) =>
      api
        .get("analytics/timeline", { searchParams: { days }, signal })
        .json<TimelineResponse | null>(),
    // Keep the previous range on screen while the next one loads.
    placeholderData: (previous) => previous,
  });

export interface MetricChange {
  current: number;
  previous: number | null;
  changePct: number | null;
}

export interface ProjectPoint {
  sampledAt: string;
  projects: number;
  /** Projects deployed in the 90 days before the sample. */
  recentProjects: number;
  activeProjects: number;
  /** Running instances; null on samples taken before metrics were collected. */
  running: number | null;
}

export interface TemplateProjects {
  days: number;
  /** Newest sample in the window against the oldest; null when the window
   * holds no samples. */
  change: {
    projects: MetricChange;
    recentProjects: MetricChange;
    activeProjects: MetricChange;
    /** Null when no sample in the window has running instances. */
    running: MetricChange | null;
  } | null;
  points: ProjectPoint[];
}

export const templateProjectsQuery = (templateId: string, days: number) =>
  queryOptions({
    queryKey: ["analytics", "projects", templateId, days],
    queryFn: ({ signal }) =>
      api
        .get(`analytics/templates/${encodeURIComponent(templateId)}/projects`, {
          searchParams: { days },
          signal,
        })
        .json<TemplateProjects>(),
    // Hold the previous range on screen while the next one loads.
    placeholderData: (previous) => previous,
  });

/** Collect a fresh snapshot server-side, then refetch everything it feeds. */
export function useRefreshAnalytics() {
  const qc = useQueryClient();
  return useMutation({
    // Snapshots every template, then syncs payouts: ~30 s, past ky's 10 s
    // default, which dropped the response and left the page stale.
    mutationFn: () => api.post("analytics/refresh", { timeout: 300_000 }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["analytics"] }),
        qc.invalidateQueries({ queryKey: ["payouts"] }),
        // The upgrade queue shows each template's latest earnings.
        qc.invalidateQueries({ queryKey: ["upgrades"] }),
      ]),
  });
}

/** Template kinds, in the order the dashboard lists them. */
export const KINDS = [
  { key: "business", label: "Business & team" },
  { key: "ai", label: "AI infrastructure" },
  { key: "media", label: "Media & hobby" },
  { key: "agent", label: "Coding agents" },
  { key: "devtools", label: "Dev & infra" },
  { key: "desktop", label: "Desktops & browsers" },
] as const;
export type Kind = (typeof KINDS)[number]["key"];

/** Where a template came from: the day-14 verdict splits its backtest by it. */
export const ORIGINS = [
  { key: "original", label: "Original" },
  { key: "competitive", label: "Competitive" },
] as const;
export type Origin = (typeof ORIGINS)[number]["key"];

export function useSetOrigin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, origin }: { templateId: string; origin: Origin | "" }) =>
      api.put(`templates/${encodeURIComponent(templateId)}/origin`, { json: { origin } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analytics", "timeline"] }),
  });
}

export function useSetKind() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, kind }: { templateId: string; kind: Kind | "" }) =>
      api.put(`templates/${encodeURIComponent(templateId)}/kind`, { json: { kind } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analytics", "timeline"] }),
  });
}
