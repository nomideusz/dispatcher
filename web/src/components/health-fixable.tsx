import { Link } from "react-router";
import { detailLink, fmtFill, Spark } from "~/components/health-watch";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { earned30 } from "~/lib/catalog";
import { fmtDay, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { badOf25, fastState, type HealthRead, SCORED_DEPLOYS, SLOW_FILL_DAYS, type SearchStake, WATCH_DAYS } from "~/lib/health";
import { cn } from "~/lib/utils";
import type { TimelineTemplate } from "~/queries/analytics";

export type FixableRow = { t: TimelineTemplate; r: HealthRead; stake: SearchStake | null };

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** What the counts say about a fast template short of 100. */
function reading({ r }: FixableRow) {
  const bad = badOf25(r.now);
  const n = r.newProjects ?? 0;
  const fix = r.fix ? ` · fix pushed ${fmtDay(r.fix.on)}${r.fix.newSince != null ? `, ${plural(r.fix.newSince, "new project")} since` : ""}` : "";
  switch (fastState(r)) {
    case "falling":
      return `Lost ${Math.abs(r.changeWithNew).toFixed(0)} points in the hours new projects landed (${plural(n, "new project")} in ${WATCH_DAYS} days): new deploys are failing, canary one${fix}`;
    case "runningDown":
      return `Lost ${Math.abs(r.changeWithout).toFixed(0)} points in hours with no new project: instances already running went down, not the new deploys. ${fmtNum(bad)} of ${SCORED_DEPLOYS} down; if new deploys keep coming up healthy they push the misses out within about ${fmtFill(r.fillDays!)}${fix}`;
    case "turnedOver":
      return `${plural(n, "new project")} replaced the whole scored set and ${fmtNum(bad)} of the newest ${SCORED_DEPLOYS} are down: about 1 new deploy in ${fmtNum(Math.round(SCORED_DEPLOYS / bad))} fails now${fix}`;
    default:
      return `${fmtNum(bad)} of ${SCORED_DEPLOYS} down. If new deploys come up healthy they push the misses out within about ${fmtFill(r.fillDays!)}${fix}`;
  }
}

/** Templates off exactly 100 whose scored set still turns over within a
 * month: new deploys decide their score, so a fix shows in days. */
export function FixableTable({ rows: input }: { rows: FixableRow[] }) {
  const name = shortNames(input.map(({ t }) => t.name));
  const { rows, head } = useSort(
    input,
    ({ t, r, stake }, key: "name" | "health" | "bad" | "change" | "newProjects" | "fill" | "search" | "earned") =>
      ({
        name: name(t.name),
        health: r.now,
        bad: badOf25(r.now),
        change: r.change,
        newProjects: r.newProjects,
        fill: r.fillDays,
        search: stake?.[0]?.position,
        earned: earned30(t),
      })[key],
    "earned",
    ["name", "health", "change", "search"],
  );
  if (input.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No template that fills its {SCORED_DEPLOYS} scored deploys within {SLOW_FILL_DAYS} days is short of 100.
      </p>
    );
  }
  return (
    <Table rows={rows.length} limit={50} className="min-w-[60rem]">
      <TableHeader>
        <TableRow>
          {head("name", "Template")}
          {head("health", "Health", { numeric: true })}
          {head("bad", `Down of ${SCORED_DEPLOYS}`, { numeric: true, hint: `Scored deploys that aren't up, at 4 points each. All ${SCORED_DEPLOYS} count on a template this busy` })}
          {head("change", `${WATCH_DAYS} days`, { numeric: true, hint: `Points gained or lost over the last ${WATCH_DAYS} days` })}
          <TableHead className="max-sm:hidden" hint="Health day by day on a 0 to 100 scale. The dashed line is 70%; the upright one is the day a fix was pushed">
            Trend
          </TableHead>
          {head("newProjects", "New", { numeric: true, hint: `Projects made from it in the last ${WATCH_DAYS} days` })}
          {head("fill", `To ${SCORED_DEPLOYS}`, { numeric: true, hint: `Days to collect ${SCORED_DEPLOYS} new projects at this pace: about how long a bad deploy stays in the score` })}
          {head("search", "Search", { numeric: true, hint: "Its best position in the latest search run, and for what. Exactly 100 is the top band; 70 to 99 rank as one" })}
          {head("earned", "Earned 30d", { numeric: true })}
          <TableHead>Reading</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const { t, r, stake } = row;
          const best = stake?.[0];
          return (
            <TableRow key={t.templateId}>
              <TableRowHead>
                <Link to={detailLink(t.templateId)} preventScrollReset className="underline decoration-current/40 underline-offset-3 hover:decoration-current">
                  {name(t.name)}
                </Link>
              </TableRowHead>
              <TableCell numeric>{r.now.toFixed(0)}%</TableCell>
              <TableCell numeric>{fmtNum(badOf25(r.now))}</TableCell>
              <TableCell numeric className={cn(!r.change && "text-muted-foreground")}>
                {r.change == null ? "—" : r.change === 0 ? "0" : `${r.change > 0 ? "+" : "−"}${Math.abs(r.change).toFixed(0)}`}
              </TableCell>
              <TableCell className="max-sm:hidden">
                <Spark r={r} />
              </TableCell>
              <TableCell numeric>{r.newProjects == null ? "—" : fmtNum(r.newProjects)}</TableCell>
              <TableCell numeric>{r.fillDays == null ? "—" : fmtFill(r.fillDays)}</TableCell>
              <TableCell numeric className={cn(!best && "text-muted-foreground")} title={stake && stake.length > 1 ? `Listed for ${plural(stake.length, "keyword")}` : undefined}>
                {stake == null ? "…" : best ? (
                  <>
                    #{best.position} <span className="font-sans text-xs text-muted-foreground">{best.query}</span>
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell numeric className={cn(!earned30(t) && "text-muted-foreground")}>{fmtUsd(earned30(t))}</TableCell>
              <TableCell className="min-w-56 text-xs text-muted-foreground">{reading(row)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
