import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { dayKey, fmtAgo, fmtDay, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type ServiceUpgrade, upgradesQuery, useRefreshUpgrades } from "~/queries/upgrades";

/** How many templates pin something with a newer release on its major
 * line: the count the Held tray links to the Upgrades page with. */
export const behindTemplateCount = (rows: ServiceUpgrade[]) => templateCount(rows.filter(MATCHES.behind));

/** How far back "Recent" looks: a week of pushes. */
const RECENT_DAYS = 7;
const recentFrom = () => dayKey(new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString());

/** behind: a newer release on the pinned major line (the queue). majors: a
 * later major exists. recent: upgraded in the last week, newest first. all:
 * every template, including those with nothing pinned to check. */
type UpgradeFilter = "behind" | "majors" | "recent" | "all";
const FILTERS = ["behind", "majors", "recent", "all"] as const;
const FILTER_LABELS: Record<UpgradeFilter, string> = { behind: "Behind", majors: "Majors", recent: "Recent", all: "All" };
const MATCHES: Record<UpgradeFilter, (u: ServiceUpgrade) => boolean> = {
  behind: (u) => u.behind === "minor" || u.behind === "patch",
  majors: (u) => u.major !== "",
  recent: (u) => u.upgradedOn !== "" && u.upgradedOn >= recentFrom(),
  all: () => true,
};

const templateCount = (rows: ServiceUpgrade[]) => new Set(rows.map((u) => u.templateId)).size;

/** Rows by template, templates in the order they first appear (the server's
 * order: urgent by running instances, then behind by earnings). */
function byTemplate(rows: ServiceUpgrade[]): ServiceUpgrade[][] {
  const groups = new Map<string, ServiceUpgrade[]>();
  for (const u of rows) groups.set(u.templateId, [...(groups.get(u.templateId) ?? []), u]);
  return [...groups.values()];
}

export function UpgradeQueue() {
  const upgrades = useQuery(upgradesQuery);
  const refresh = useRefreshUpgrades();
  const [filter, setFilter] = useState<UpgradeFilter>("behind");
  // Templates that earned nothing in 30 days wait behind one line, unless
  // urgent: most of the queue, and the last thing worth an afternoon.
  const [idleOpen, setIdleOpen] = useState(false);
  const rows = upgrades.data ?? [];
  const names = shortNames(rows.map((u) => u.name ?? u.templateId));
  const shown = rows.filter(MATCHES[filter]);
  const checkedAt = rows.find((u) => u.behind !== "unchecked")?.checkedAt;
  const recent = filter === "recent";
  const groups = byTemplate(shown);
  if (recent) groups.sort((a, b) => b[0].upgradedOn.localeCompare(a[0].upgradedOn));
  // The last push and how many templates it moved, whatever the filter.
  const lastOn = rows.reduce((m, u) => (u.upgradedOn > m ? u.upgradedOn : m), "");
  const lastCount = templateCount(rows.filter((u) => u.upgradedOn === lastOn));
  // A week of pushes is short, so Recent shows idle templates too.
  const lead = (g: ServiceUpgrade[]) => recent || !!g[0].urgent || (g[0].earningsLast30Days ?? 0) > 0;
  const earning = groups.filter(lead);
  const idle = groups.filter((g) => !lead(g));
  const visible = idleOpen ? groups : earning;
  // Most lines have no later major; the column shows only when one does.
  const majors = shown.some((u) => u.major !== "");
  // The server puts urgent templates first, then behind ones by earnings,
  // so the first template behind is the one to upgrade next.
  const first = byTemplate(rows.filter(MATCHES.behind))[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter upgrades" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
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
          {lastOn && (
            <span>
              Last upgrade {fmtDay(lastOn)}, <span className="tabular-nums">{fmtNum(lastCount)}</span>{" "}
              {lastCount === 1 ? "template" : "templates"}
            </span>
          )}
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
          {rows.length === 0
            ? "No check has run yet."
            : recent
              ? `Nothing upgraded in the last ${RECENT_DAYS} days.`
              : "Nothing here: every pinned image is current."}
        </p>
      )}
      {visible.length > 0 && (
        <Table rows={0}>
          <TableHeader>
            <TableRow>
              {/* The template's money sits beside its name: it is why the row is where it is. */}
              <TableHead className="max-sm:hidden">Template</TableHead>
              <TableHead numeric className="max-sm:hidden">Earned 30d</TableHead>
              <TableHead numeric className="max-sm:hidden">Running</TableHead>
              <TableHead className="pr-6 max-sm:hidden">Upgraded</TableHead>
              <TableHead className="max-sm:pl-0">Service</TableHead>
              <TableHead className="max-md:hidden">Image</TableHead>
              <TableHead>Pinned → newest on line</TableHead>
              {majors && <TableHead className="max-sm:hidden">Later major</TableHead>}
            </TableRow>
          </TableHeader>
          {visible.map((group, i) => (
            <TemplateGroup key={group[0].templateId} group={group} first={i === 0} name={names(group[0].name ?? group[0].templateId)} majors={majors} />
          ))}
        </Table>
      )}
      {idle.length > 0 && (
        <Button size="xs" variant="ghost" aria-expanded={idleOpen} onClick={() => setIdleOpen((o) => !o)}>
          {idleOpen ? (
            "Hide templates that earned nothing"
          ) : (
            <>
              Show <span className="tabular-nums">{fmtNum(idle.length)}</span> more that earned nothing in 30 days
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/** One template: its name and money on the line of its first service,
 * spanning the rest, so the group costs no extra line. A phone hides those
 * columns, so there the name and money get a heading line of their own. */
function TemplateGroup({ group, name, majors, first }: { group: ServiceUpgrade[]; name: string; majors: boolean; first: boolean }) {
  const u = group[0];
  const services = group.filter((g) => g.behind !== "unchecked");
  const lead = (
    <>
      <TableRowHead scope="rowgroup" rowSpan={Math.max(1, services.length)} className="align-top font-medium max-sm:hidden">
        <TemplateLink u={u} name={name} />
        <UrgentNote u={u} />
      </TableRowHead>
      <TableCell numeric rowSpan={Math.max(1, services.length)} className="align-top max-sm:hidden">
        {u.earningsLast30Days == null ? "—" : fmtUsd(u.earningsLast30Days)}
      </TableCell>
      <TableCell numeric rowSpan={Math.max(1, services.length)} className="align-top max-sm:hidden">
        {u.runningInstances == null ? "—" : fmtNum(u.runningInstances)}
      </TableCell>
      <TableCell rowSpan={Math.max(1, services.length)} className="pr-6 align-top whitespace-nowrap text-muted-foreground max-sm:hidden">
        {u.upgradedOn ? fmtDay(u.upgradedOn) : "—"}
      </TableCell>
    </>
  );
  // The table's first group sits right under the header's own rule.
  const opens = cn(first ? "border-t-0" : "border-t border-border/60", "max-sm:border-t-0");
  // A body of its own: the spanning cells belong to the first row, so the
  // whole group lights up on hover, not just that row.
  return (
    <TableBody banded={false} data-grouped>
      <TableRow rule="none" className={cn("sm:hidden", !first && "border-t border-border/60")}>
        <TableRowHead scope="rowgroup" colSpan={3} className="pt-3 pb-0 font-medium">
          <TemplateLink u={u} name={name} />
          {u.earningsLast30Days != null && (
            <span className="font-normal text-muted-foreground">
              {" "}· <span className="tabular-nums">{fmtUsd(u.earningsLast30Days)}</span> in 30d
            </span>
          )}
          {u.upgradedOn && (
            <span className="font-normal text-muted-foreground"> · upgraded {fmtDay(u.upgradedOn)}</span>
          )}
          <UrgentNote u={u} />
        </TableRowHead>
      </TableRow>
      {services.length === 0 ? (
        <TableRow rule="none" className={opens}>
          {lead}
          <TableCell colSpan={majors ? 4 : 3} className="text-muted-foreground">nothing pinned</TableCell>
        </TableRow>
      ) : (
        services.map((s, i) => (
          <ServiceRow key={`${s.service}-${s.image}`} u={s} majors={majors} className={i === 0 ? opens : undefined}>
            {i === 0 && lead}
          </ServiceRow>
        ))
      )}
    </TableBody>
  );
}

/** The upgrade to do next: the first template behind on its line, its
 * services and versions, and why: what makes it urgent and how many deploys
 * run it, or what it earns. */
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
      {u.urgent ? (
        <span className="text-muted-foreground">
          {" "}· <span className="text-(--viz-critical)">urgent:</span> {u.urgent}
          {u.runningInstances != null && (
            <>
              , <span className="tabular-nums">{fmtNum(u.runningInstances)}</span> running
            </>
          )}
        </span>
      ) : (
        u.earningsLast30Days != null && (
          <span className="text-muted-foreground">
            {" "}· <span className="tabular-nums">{fmtUsd(u.earningsLast30Days)}</span> in 30 days
            {u.runningInstances != null && (
              <>
                , <span className="tabular-nums">{fmtNum(u.runningInstances)}</span> running
              </>
            )}
          </span>
        )
      )}
    </p>
  );
}

/** Why an urgent template leads the queue, under its name. */
function UrgentNote({ u }: { u: ServiceUpgrade }) {
  if (!u.urgent) return null;
  return (
    <div className="max-w-56 text-xs font-normal">
      <span className="text-(--viz-critical)">Urgent:</span> <span className="text-muted-foreground">{u.urgent}</span>
    </div>
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
  majors,
  className,
  children,
}: {
  u: ServiceUpgrade;
  /** Whether the table has the Later major column. */
  majors: boolean;
  className?: string;
  /** The template's spanning cells, on its first service only. */
  children?: ReactNode;
}) {
  const moved = u.behind === "minor" || u.behind === "patch";
  return (
    <TableRow rule="none" className={className}>
      {children}
      {/* Fourth column on desktop, first on a phone, whichever row it is in. */}
      <TableCell className="text-muted-foreground max-sm:pl-0 sm:first:pl-3" title={u.image}>
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
    </TableRow>
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
