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

/** Template groups shown before "Show all". */
const GROUPS = 10;

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
  // The queue's head is what gets done; the rest of the groups wait behind
  // one press so the page doesn't run on for thousands of pixels.
  const [allGroups, setAllGroups] = useState(false);
  const rows = upgrades.data ?? [];
  const names = shortNames(rows.map((u) => u.name ?? u.templateId));
  const shown = rows.filter(MATCHES[filter]);
  const pins = shown.filter((u) => u.behind !== "unchecked").length;
  const checkedAt = rows.find((u) => u.behind !== "unchecked")?.checkedAt;
  const groups = byTemplate(shown);
  const shownGroups = allGroups ? groups : groups.slice(0, GROUPS);
  // Most lines have no later major; the column shows only when one does.
  const majors = shown.some((u) => u.major !== "");
  // The server orders behind-first, most-earning-first, so the first
  // template behind is the one to upgrade next.
  const first = byTemplate(rows.filter(MATCHES.behind))[0];

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
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            Group by template
          </label>
          {checkedAt && (
            <span>
              Checked {fmtAgo(checkedAt, new Date().toISOString())} ago · daily at 06:08 UTC
            </span>
          )}
          <Button size="xs" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </div>
      {first && <FirstUp group={first} name={names(first[0].name ?? first[0].templateId)} />}
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
          <Table rows={grouped ? 0 : shown.length}>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="max-md:hidden">Image</TableHead>
                <TableHead>Pinned → newest on line</TableHead>
                {majors && <TableHead className="max-sm:hidden">Later major</TableHead>}
                <TableHead numeric className="max-sm:hidden">Earned 30d</TableHead>
                <TableHead numeric className="max-sm:hidden">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody banded={!grouped}>
              {grouped
                ? shownGroups.map((group) => {
                    const u = group[0];
                    const checked = group.filter((g) => g.behind !== "unchecked");
                    const behind = group.filter(MATCHES.behind).length;
                    return (
                      <Fragment key={u.templateId}>
                        <TableRow rule="top">
                          <TableRowHead scope="rowgroup" className="pt-3 pb-1 font-medium">
                            <TemplateLink u={u} name={names(u.name ?? u.templateId)} />
                          </TableRowHead>
                          <TableCell colSpan={majors ? 4 : 3} className="pt-3 pb-1 text-xs text-muted-foreground">
                            {checked.length === 0
                              ? "nothing pinned"
                              : `${fmtNum(checked.length)} pinned${behind ? `, ${fmtNum(behind)} behind` : ""}`}
                            {/* A phone hides the earning columns; the heading carries them. */}
                            {u.earningsLast30Days != null && (
                              <span className="sm:hidden"> · <span className="tabular-nums">{fmtUsd(u.earningsLast30Days)}</span> in 30d</span>
                            )}
                          </TableCell>
                          <EarningCells u={u} className="pt-3 pb-1" />
                        </TableRow>
                        {checked.map((s) => (
                          <ServiceRow key={`${s.service}-${s.image}`} u={s} template="" majors={majors} />
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
                      majors={majors}
                    />
                  ))}
            </TableBody>
          </Table>
      )}
      {grouped && groups.length > shownGroups.length && (
        <button
          type="button"
          onClick={() => setAllGroups(true)}
          className="cursor-pointer text-xs text-primary underline underline-offset-3"
        >
          Show all <span className="tabular-nums">{fmtNum(groups.length)}</span> templates
        </button>
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

/** The upgrade to do next: the first template behind on its line, its
 * services and versions, and what it earns. */
function FirstUp({ group, name }: { group: ServiceUpgrade[]; name: string }) {
  const behind = group.filter(MATCHES.behind);
  const u = group[0];
  const latest = new Set(behind.map((b) => b.latest));
  return (
    <p className="text-sm">
      <span className="font-semibold">Do first:</span> <TemplateLink u={u} name={name} />, {behind.map((b) => b.service).join(", ")}
      {latest.size === 1 && (
        <>
          {" "}to <span className="font-mono text-xs">{behind[0].latest}</span>
        </>
      )}
      {u.earningsLast30Days != null && (
        <span className="text-muted-foreground">
          {" "}· <span className="tabular-nums">{fmtUsd(u.earningsLast30Days)}</span> in 30 days
          {u.activeProjects != null && (
            <>
              , <span className="tabular-nums">{fmtNum(u.activeProjects)}</span> active
            </>
          )}
        </span>
      )}
    </p>
  );
}

/** The template name, linking to its row in the Templates page's table. */
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
  majors,
}: {
  u: ServiceUpgrade;
  template: ReactNode;
  earnings?: boolean;
  /** Whether the table has the Later major column. */
  majors: boolean;
}) {
  const moved = u.behind === "minor" || u.behind === "patch";
  return (
    <TableRow rule={earnings ? "bottom" : "none"}>
      <TableCell>{template}</TableCell>
      <TableCell className="text-muted-foreground" title={u.image}>
        {u.service}
        {/* Without the Image column, seven "Backend" rows need their image. */}
        <div className="font-mono text-xs md:hidden">{u.image.split("/").pop()}</div>
      </TableCell>
      <TableCell className="font-mono text-xs max-md:hidden" title={u.image}>
        {/* A cell ignores max-width; the div inside holds the line. */}
        <div className="max-w-64 truncate">{u.image}</div>
      </TableCell>
      <TableCell className="font-mono text-xs">
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
      {majors && (
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
      )}
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
