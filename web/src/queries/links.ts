import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** One link of a template's marketplace readme that the daily check found
 * broken or could not verify. */
export interface ReadmeLink {
  checkedAt: string;
  templateId: string;
  name: string;
  code: string;
  url: string;
  /** HTTP status of the last answer, 0 when there was none. */
  status: number;
  /** not-found (404 or 410, twice), gone (the domain does not resolve),
   * deploy (a deploy button on a code with no published template),
   * relative (a link that leads nowhere on Railway's page), unverified (a
   * bot wall, rate limit, timeout or 5xx: usually fine in a browser). */
  problem: "not-found" | "gone" | "deploy" | "relative" | "unverified";
  detail: string;
}

export interface LinkReport {
  checkedAt: string | null;
  readmes: number;
  links: number;
  /** Broken first, then unverified. */
  problems: ReadmeLink[];
}

export const linksQuery = queryOptions({
  queryKey: ["links"],
  queryFn: ({ signal }) => api.get("links", { signal }).json<LinkReport>(),
});

export function useRefreshLinks() {
  const qc = useQueryClient();
  return useMutation({
    // About a minute: every distinct link once, a dozen at a time.
    mutationFn: () => api.post("links/refresh", { timeout: 1_200_000 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links"] }),
  });
}
