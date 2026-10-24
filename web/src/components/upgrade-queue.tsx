import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
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
 * later major exists. all: every template, including those with nothing
 * pinned to check. */
type UpgradeFilter = "behind" | "majors" | "all";
const FILTER_LABELS: Record<UpgradeFilter, string> = { behind: "Behind", majors: "Majors", all: "All" };
const MATCHES: Record<UpgradeFilter, (u: ServiceUpgrade) => boolean> = {
  behind: (u) => u.behind === "minor" || u.behind === "patch",
  majors: (u) => u.major !== "",
  all: () => true,
};

const templateCount = (rows: ServiceUpgrade[]) => new Set(rows.map((u) => u.templateId)).size;

/** Rows by template, templates in the order they first appear (the server's
 * behind-first, most-earning-first order). */
function byTemplate(rows: ServiceUpgrade[]): ServiceUpgrade[][] {
  const groups = new Map<string, ServiceUpgrade[]>();
  for (const u of rows) groups.set(u.templateId, [...(groups.get(u.templateId) ?? []), u]);
  return [...groups.values()];
}

export function UpgradeQueue() {
  const upgrades = useQuery(upgradesQuery);
  const refresh = useRefreshUpgrades();
  const [filter, setFilter] = useState<UpgradeFilter>("behind");
  const [grouped, setGrouped] = useState(false);
  const rows = upgrades.data ?? [];
  const names = shortNames(rows.map((u) => u.name ?? u.templateId));
  const shown = rows.filter(MATCHES[filter]);
  const pins = shown.filter((u) => u.behind !== "unchecked").length;
  const behindTemplates = templateCount(rows.filter(MATCHES.behind));
  const checkedAt = rows.find((u) => u.behind !== "unchecked")?.checkedAt;

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
              {upgrades.isSuccess && (
                <span className="tabular-nums text-muted-foreground">
                  {fmtNum(templateCount(rows.filter(MATCHES[f])))}
                </span>
              )}
            </Button>
          ))}
          <Button size="xs" variant={grouped ? "secondary" : "ghost"} onClick={() => setGrouped(!grouped)}>
            Group
          </Button>
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
          <p className="mb-2 text-xs text-muted-foreground">
            {fmtNum(templateCount(shown))} templates, {fmtNum(pins)} pinned{" "}
            {pins === 1 ? "image or version" : "images and versions"}
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
              {grouped
                ? byTemplate(shown).map((group) => {
                    const u = group[0];
                    const checked = group.filter((g) => g.behind !== "unchecked");
                    const behind = group.filter(MATCHES.behind).length;
                    return (
                      <Fragment key={u.templateId}>
                        <tr className="border-t first:border-0">
                          <td className="pt-3 pb-1 font-medium">{names(u.name ?? u.templateId)}</td>
                          <td colSpan={5} className="pt-3 pb-1 pl-3 text-xs text-muted-foreground">
                            {checked.length === 0
                              ? "nothing pinned"
                              : `${fmtNum(checked.length)} pinned${behind ? `, ${fmtNum(behind)} behind` : ""}`}
                          </td>
                          <EarningCells u={u} />
                        </tr>
                        {checked.map((s) => (
                          <ServiceRow key={`${s.service}-${s.image}`} u={s} template="" />
                        ))}
                      </Fragment>
                    );
                  })
                : shown.map((u) => (
                    <ServiceRow
                      key={`${u.templateId}-${u.service}-${u.image}`}
                      u={u}
                      template={names(u.name ?? u.templateId)}
                      earnings
                    />
                  ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ u, template, earnings }: { u: ServiceUpgrade; template: string; earnings?: boolean }) {
  return (
    <tr className={earnings ? "border-b last:border-0" : undefined}>
      <td className="py-1.5">{template}</td>
      <td className="py-1.5 pl-3 text-muted-foreground">{u.service}</td>
      <td className="max-w-64 truncate py-1.5 pl-3 font-mono text-xs" title={u.image}>
        {u.image}
      </td>
      <td className="py-1.5 pl-3 font-mono text-xs">
        {u.tag}
        {(u.haBlock === "tag" || u.haBlock === "pinned") && (
          <span className="font-sans text-(--viz-critical)" title={`${u.ha} cannot convert this tag`}>
            {" "}(no HA)
          </span>
        )}
      </td>
      <td className="py-1.5 pl-3 font-mono text-xs">
        <LineCell u={u} />
      </td>
      <td className="py-1.5 pl-3 font-mono text-xs text-muted-foreground">
        {u.major}
        {u.major && u.ha && (u.haBlock === "" || u.haBlock === "major") && (
          <span
            className={`font-sans ${u.haBlock === "major" ? "text-(--viz-critical)" : ""}`}
            title={u.haBlock === "major" ? `${u.ha} does not support this major yet` : `${u.ha} supports this major`}
          >
            {u.haBlock === "major" ? " (drops HA)" : " (HA ok)"}
          </span>
        )}
      </td>
      {earnings ? <EarningCells u={u} /> : <td colSpan={2} />}
    </tr>
  );
}

function EarningCells({ u }: { u: ServiceUpgrade }) {
  return (
    <>
      <td className="py-1.5 pl-3 text-right tabular-nums">
        {u.earningsLast30Days == null ? "—" : fmtUsd(u.earningsLast30Days)}
      </td>
      <td className="py-1.5 pl-3 text-right tabular-nums">
        {u.activeProjects == null ? "—" : fmtNum(u.activeProjects)}
      </td>
    </>
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
    case "unchecked":
      return <span className="font-sans text-muted-foreground">nothing pinned</span>;
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
