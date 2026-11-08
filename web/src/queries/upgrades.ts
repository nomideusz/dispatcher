import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";

/** One pinned image or marked Dockerfile version (image "github:owner/repo",
 * "npm:package", "pypi:package" or "bugstage:host/project/repo") of a template service as of the last
 * daily check. latest is the newest tag of the same shape on the pinned major line; major is the
 * newest tag of a later major, reported apart since templates often hold
 * databases back on purpose. */
export interface ServiceUpgrade {
  checkedAt: string;
  templateId: string;
  service: string;
  image: string;
  tag: string;
  latest: string;
  /** minor or patch; "" when current; floating for latest/digests;
   * unknown when the registry could not be read (see error); unchecked for
   * a template with nothing pinned (its only row, service and image empty). */
  behind: "" | "minor" | "patch" | "floating" | "unknown" | "unchecked";
  major: string;
  /** The Railway template this database converts to a cluster with
   * (redis-ha, mysql-ha, postgres-ha); "" when it has none. */
  ha: string;
  /** Why that conversion fails or would: tag (the pinned tag names no
   * major, Railway refuses it), pinned (the companion does not support the
   * pinned major), major (it does not support the later major, so bumping
   * drops the convert option). */
  haBlock: "" | "tag" | "pinned" | "major";
  error?: string;
  name: string | null;
  code: string | null;
  status: string | null;
  earningsLast30Days: number | null;
  runningInstances: number | null;
  /** Why the template's upgrade is urgent (a security fix, or a fix for
   * something our version breaks on), read from the release notes and set
   * with dispatcherctl urgent; "" when it isn't. Urgent templates come
   * first, by running instances. */
  urgent: string;
  /** The day the template's pins last moved (YYYY-MM-DD): seen by the daily
   * check when a pinned tag changes, or recorded with dispatcherctl
   * upgraded on the day of a push. "" when neither has happened. */
  upgradedOn: string;
}

export const upgradesQuery = queryOptions({
  queryKey: ["upgrades"],
  queryFn: ({ signal }) => api.get("upgrades", { signal }).json<ServiceUpgrade[]>(),
});

export function useRefreshUpgrades() {
  const qc = useQueryClient();
  return useMutation({
    // Lists every registry again; minutes at worst.
    mutationFn: () => api.post("upgrades/refresh", { timeout: 1_200_000 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["upgrades"] }),
  });
}
