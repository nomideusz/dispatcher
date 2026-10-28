import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** One template in a marketplace search, as Railway ranks it. */
export interface SearchResult {
  position: number;
  templateId: string;
  code: string;
  name: string;
  creator: string;
  ours: boolean;
  /** Projects deployed from it in the last 90 days, from the market read. */
  recent: number;
  active: number;
}

/** One keyword as searched in the latest daily run. */
export interface SearchKeyword {
  query: string;
  /** Who asked for it: added by hand, one of our templates, or a top market app. */
  source: "manual" | "ours" | "market";
  /** Railway's category of the first result. */
  category: string;
  /** 90-day projects of every template the search returns. */
  demand: number;
  results: number;
  /** Our best position now; null when none of ours shows. */
  best: number | null;
  /** Our best position a week earlier; null when absent or not searched then. */
  prevBest: number | null;
  searchedBefore: boolean;
  top: SearchResult[];
}

/** How much of a keyword's demand the template at a position holds,
 * averaged over keywords. */
export interface PositionShare {
  position: number;
  share: number;
  keywords: number;
}

export interface Search {
  sampledAt: string | null;
  prevAt: string | null;
  keywords: SearchKeyword[];
  curve: PositionShare[];
}

export const searchQuery = queryOptions({
  queryKey: ["search"],
  queryFn: ({ signal }) => api.get("search", { signal }).json<Search>(),
  staleTime: 3_600_000,
});

export function useAddKeyword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (query: string) => api.post("search/keywords", { json: { query }, timeout: 30_000 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["search"] }),
  });
}

export function useRemoveKeyword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (query: string) => api.delete(`search/keywords/${encodeURIComponent(query)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["search"] }),
  });
}
