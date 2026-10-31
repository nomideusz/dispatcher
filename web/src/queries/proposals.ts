import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

/** An app the owner suggested building. Claude answers it during the
 * routine with a status and a reply. */
export interface Proposal {
  url: string;
  note: string;
  /** "" while it waits for an answer. */
  status: "" | "building" | "published" | "skipped";
  reply: string;
  createdAt: string;
  updatedAt: string;
}

export const proposalsQuery = queryOptions({
  queryKey: ["proposals"],
  queryFn: ({ signal }) => api.get("proposals", { signal }).json<{ proposals: Proposal[] }>(),
});

export function useAddProposals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; note: string }) => api.post("proposals", { json: body }).json<{ added: string[] }>(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useRemoveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.delete("proposals", { searchParams: { url } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}
