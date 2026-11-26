import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** One app on the Railway marketplace: every template whose name reads the
 * same ("Ghost", "Ghost (Production)", "ghost v5"), as of the daily read. */
export interface CandidateGroup {
  key: string;
  /** Railway's category of the leading template; mostly "Other". */
  category: string;
  templates: number;
  active: number;
  /** Projects deployed from the group in the last 90 days. */
  recent: number;
  /** The newest template's creation date: a recent one means fresh competition. */
  newest: string;
  /** The other creators' template with the most active projects. */
  leader: {
    name: string;
    code: string;
    creator: string;
    active: number;
    health: number | null;
    createdAt: string;
  };
  /** Our template ids in the group. */
  ours: string[];
  /** The key of one of our groups that looks like the same app. */
  similar?: string;
  /** The group's 90-day projects that went to our templates. */
  ourRecent: number;
  /** 90-day projects of the groups whose similar names this one. */
  similarRecent: number;
  /** Other creators' templates of the same or a similar app. */
  rivals: number;
  status: "" | "shortlist" | "skip";
  note: string;
}

/** Another creator's template that builds from one of our repos: its
 * deploys pay its creator, not us. */
export interface MarketCopy {
  id: string;
  name: string;
  code: string;
  creator: string;
  repo: string;
  activeProjects: number;
  recentProjects: number;
  createdAt: string;
}

/** One of a rival's new templates of an app we publish. */
export interface RivalListing {
  name: string;
  code: string;
  /** The key of our group it competes in. */
  ours: string;
  active: number;
  health: number | null;
  createdAt: string;
}

/** A creator who published at least two templates of apps we publish in the
 * 14 days before the market read. */
export interface MarketRival {
  creator: string;
  /** All their templates created in those 14 days, ours or not. */
  new: number;
  /** The most they created on one UTC day, and that day. */
  busiest: number;
  busiestDay: string;
  listings: RivalListing[];
}

export interface Candidates {
  fetchedAt: string | null;
  groups: CandidateGroup[];
  copies: MarketCopy[];
  rivals: MarketRival[];
}

export const candidatesQuery = queryOptions({
  queryKey: ["candidates"],
  queryFn: ({ signal }) => api.get("candidates", { signal }).json<Candidates>(),
  staleTime: 3_600_000,
});

export function useMarkCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, status, note }: Pick<CandidateGroup, "key" | "status" | "note">) =>
      api.put(`candidates/${encodeURIComponent(key)}`, { json: { status, note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["candidates"] }),
  });
}
