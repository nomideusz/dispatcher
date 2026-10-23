import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtAgo, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { type ServiceUpgrade, upgradesQuery, useRefreshUpgrades } from "~/queries/upgrades";

/** behind: a newer release on the pinned major line (the queue). majors: a
 * later major exists. all: every pinned image or version. */
type UpgradeFilter = "behind" | "majors" | "all";
const FILTER_LABELS: Record<UpgradeFilter, string> = { behind: "Behind", majors: "Majors", all: "All" };
const MATCHES: Record<UpgradeFilter, (u: ServiceUpgrade) => boolean> = {
  behind: (u) => u.behind === "minor" || u.behind === "patch",
  majors: (u) => u.major !== "",
  all: () => true,
};

export function UpgradeQueue() {
  const upgrades = useQuery(upgradesQuery);
  const refresh = useRefreshUpgrades();
  const [filter, setFilter] = useState<UpgradeFilter>("behind");
  const rows = upgrades.data ?? [];
  const names = shortNames(rows.map((u) => u.name ?? u.templateId));
  const shown = rows.filter(MATCHES[filter]);
  const behindTemplates = new Set(rows.filter(MATCHES.behind).map((u) => u.templateId)).size;
  const checkedAt = rows[0]?.checkedAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upgrades</CardTitle>
        <CardDescription>
          {checkedAt
            ? `${fmtNum(behindTemplates)} templates pin an image or version with a newer release on the same major line, most earning first. Checked against the registries ${fmtAgo(checkedAt, new Date().toISOString())} ago; daily at 06:08 UTC.`
            : "Each template's pinned images, and the versions its Dockerfiles mark, against the newest release of the same shape."}
          {refresh.isError && (
            <span className="text-(--viz-critical)"> Re-check failed: {refresh.error.message}</span>
          )}
        </CardDescription>
        <CardAction className="flex gap-1">
          {(["behind", "majors", "all"] as const).map((f) => (
            <Button
              key={f}
              size="xs"
              variant={f === filter ? "secondary" : "ghost"}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </Button>
          ))}
          <Button size="xs" variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Checking…" : "Re-check"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="scroll-fade max-h-[32rem] overflow-auto">
        {upgrades.isPending && <Skeleton className="h-40 w-full" />}
        {upgrades.isError && (
          <p className="text-sm text-(--viz-critical)">Failed to load upgrades.</p>
        )}
        {upgrades.isSuccess && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "No check has run yet." : "Nothing here: every pinned image is current."}
          </p>
        )}
        {shown.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Template</th>
                <th className="pb-2 pl-3 font-medium">Service</th>
                <th className="pb-2 pl-3 font-medium">Image</th>
                <th className="pb-2 pl-3 font-medium">Pinned</th>
                <th className="pb-2 pl-3 font-medium">Newest on line</th>
                <th className="pb-2 pl-3 font-medium">Later major</th>
                <th className="pb-2 pl-3 text-right font-medium">Earned 30d</th>
                <th className="pb-2 pl-3 text-right font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={`${u.templateId}-${u.service}-${u.image}`} className="border-b last:border-0">
                  <td className="py-1.5">{names(u.name ?? u.templateId)}</td>
                  <td className="py-1.5 pl-3 text-muted-foreground">{u.service}</td>
                  <td className="max-w-64 truncate py-1.5 pl-3 font-mono text-xs" title={u.image}>
                    {u.image}
                  </td>
                  <td className="py-1.5 pl-3 font-mono text-xs">{u.tag}</td>
                  <td className="py-1.5 pl-3 font-mono text-xs">
                    <LineCell u={u} />
                  </td>
                  <td className="py-1.5 pl-3 font-mono text-xs text-muted-foreground">{u.major}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {u.earningsLast30Days == null ? "—" : fmtUsd(u.earningsLast30Days)}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {u.activeProjects == null ? "—" : fmtNum(u.activeProjects)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function LineCell({ u }: { u: ServiceUpgrade }) {
  switch (u.behind) {
    case "minor":
    case "patch":
      return (
        <span className={u.behind === "minor" ? "text-(--viz-critical)" : undefined}>
          {u.latest} <span className="font-sans text-muted-foreground">({u.behind})</span>
        </span>
      );
    case "floating":
      return <span className="font-sans text-muted-foreground">floating tag</span>;
    case "unknown":
      return (
        <span className="font-sans text-muted-foreground" title={u.error}>
          registry unreadable
        </span>
      );
    default:
      return <span className="font-sans text-muted-foreground">current</span>;
  }
}
