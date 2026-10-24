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
  /** Other creators' templates of the same or a similar app. */
  rivals: number;
  status: "" | "shortlist" | "skip";
  note: string;
}

export interface Candidates {
  fetchedAt: string | null;
  groups: CandidateGroup[];
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
