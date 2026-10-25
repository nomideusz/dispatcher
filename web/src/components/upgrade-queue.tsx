import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { fmtAgo, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type ServiceUpgrade, upgradesQuery, useRefreshUpgrades } from "~/queries/upgrades";

/** How many templates pin something with a newer release on its major
 * line: the count the Held tray links to the Upgrades page with. */
export const behindTemplateCount = (rows: ServiceUpgrade[]) => templateCount(rows.filter(MATCHES.behind));

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
  // One heading per template, so its earnings show once instead of on
  // every service row.
  const [grouped, setGrouped] = useState(true);
  const rows = upgrades.data ?? [];
  const names = shortNames(rows.map((u) => u.name ?? u.templateId));
  const shown = rows.filter(MATCHES[filter]);
  const pins = shown.filter((u) => u.behind !== "unchecked").length;
  const checkedAt = rows.find((u) => u.behind !== "unchecked")?.checkedAt;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter upgrades" className="flex flex-wrap gap-1">
          {(["behind", "majors", "all"] as const).map((f) => (
            <Button
              key={f}
              size="xs"
              aria-pressed={f === filter}
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
          <Button
            size="xs"
            aria-pressed={grouped}
            variant={grouped ? "secondary" : "ghost"}
            onClick={() => setGrouped(!grouped)}
          >
            Group by template
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {checkedAt && (
            <span>
              Checked {fmtAgo(checkedAt, new Date().toISOString())} ago · daily at 06:08 UTC
            </span>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </div>
      {refresh.isError && (
        <p className="text-xs text-(--viz-critical)">Re-check failed: {refresh.error.message}</p>
      )}
      {upgrades.isPending && <Skeleton className="h-40 w-full" />}
      {upgrades.isError && (
        <p className="text-sm text-(--viz-critical)">Failed to load upgrades.</p>
      )}
      {upgrades.isSuccess && shown.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No check has run yet." : "Nothing here: every pinned image is current."}
        </p>
      )}
      {shown.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="max-md:hidden">Image</TableHead>
                <TableHead>Pinned → newest on line</TableHead>
                <TableHead className="max-sm:hidden">Later major</TableHead>
                <TableHead numeric className="max-sm:hidden">Earned 30d</TableHead>
                <TableHead numeric className="max-sm:hidden">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody banded={!grouped}>
              {grouped
                ? byTemplate(shown).map((group) => {
                    const u = group[0];
                    const checked = group.filter((g) => g.behind !== "unchecked");
                    const behind = group.filter(MATCHES.behind).length;
                    return (
                      <Fragment key={u.templateId}>
                        <TableRow rule="top">
                          <TableRowHead scope="rowgroup" className="pt-3 pb-1 font-medium">
                            <TemplateLink u={u} name={names(u.name ?? u.templateId)} />
                          </TableRowHead>
                          <TableCell colSpan={4} className="pt-3 pb-1 text-xs text-muted-foreground">
                            {checked.length === 0
                              ? "nothing pinned"
                              : `${fmtNum(checked.length)} pinned${behind ? `, ${fmtNum(behind)} behind` : ""}`}
                          </TableCell>
                          <EarningCells u={u} className="pt-3 pb-1" />
                        </TableRow>
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
                      template={<TemplateLink u={u} name={names(u.name ?? u.templateId)} />}
                      earnings
                    />
                  ))}
            </TableBody>
          </Table>
      )}
      {shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {fmtNum(templateCount(shown))} templates, {fmtNum(pins)} pinned{" "}
          {pins === 1 ? "image or version" : "images and versions"}
        </p>
      )}
    </div>
  );
}

/** The template name, linking to its row in the Money page's table. */
function TemplateLink({ u, name }: { u: ServiceUpgrade; name: string }) {
  return (
    <Link to={`/templates#t-${u.templateId}`} className="underline-offset-3 hover:underline">
      {name}
    </Link>
  );
}

function ServiceRow({
  u,
  template,
  earnings,
}: {
  u: ServiceUpgrade;
  template: ReactNode;
  earnings?: boolean;
}) {
  const moved = u.behind === "minor" || u.behind === "patch";
  return (
    <TableRow rule={earnings ? "bottom" : "none"}>
      <TableCell>{template}</TableCell>
      <TableCell className="text-muted-foreground" title={u.image}>
        {u.service}
      </TableCell>
      <TableCell className="max-w-64 truncate font-mono text-xs max-md:hidden" title={u.image}>
        {u.image}
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap">
        {u.tag}
        {(u.haBlock === "tag" || u.haBlock === "pinned") && (
          <span className="font-sans text-(--viz-caution)" title={`${u.ha} cannot convert this tag`}>
            {" "}(no HA)
          </span>
        )}
        {u.tag && " "}
        {moved && <span className="font-sans text-muted-foreground">→ </span>}
        <LineCell u={u} />
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground max-sm:hidden">
        {u.major}
        {u.major && u.ha && (u.haBlock === "" || u.haBlock === "major") && (
          <span
            className={`font-sans ${u.haBlock === "major" ? "text-(--viz-caution)" : ""}`}
            title={u.haBlock === "major" ? `${u.ha} does not support this major yet` : `${u.ha} supports this major`}
          >
            {u.haBlock === "major" ? " (drops HA)" : " (HA ok)"}
          </span>
        )}
      </TableCell>
      {earnings ? <EarningCells u={u} /> : <TableCell colSpan={2} className="max-sm:hidden" />}
    </TableRow>
  );
}

function EarningCells({ u, className }: { u: ServiceUpgrade; className?: string }) {
  return (
    <>
      <TableCell numeric className={cn("max-sm:hidden", className)}>
        {u.earningsLast30Days == null ? "—" : fmtUsd(u.earningsLast30Days)}
      </TableCell>
      <TableCell numeric className={cn("max-sm:hidden", className)}>
        {u.activeProjects == null ? "—" : fmtNum(u.activeProjects)}
      </TableCell>
    </>
  );
}

function LineCell({ u }: { u: ServiceUpgrade }) {
  switch (u.behind) {
    case "minor":
    case "patch":
      return (
        <span className={u.behind === "minor" ? "text-(--viz-caution)" : undefined}>
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
