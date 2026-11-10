import { Link } from "react-router";
import { Fig } from "~/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead, useSort } from "~/components/ui/table";
import { earned30, HEALTH_FLOOR } from "~/lib/catalog";
import { fmtDay, fmtLongDay, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { FIX_TEST_DEPLOYS, type HealthRead, onWatch, readHealth, WATCH_DAYS } from "~/lib/health";
import { cn } from "~/lib/utils";
import type { HealthSeries, TimelineTemplate } from "~/queries/analytics";

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** What the figures say, in words. */
function reading(r: HealthRead) {
  const since = r.fix?.newSince;
  switch (r.state) {
    case "untested":
      return `Fix pushed ${fmtDay(r.fix!.on)}${r.fix!.healthThen != null ? ` at ${r.fix!.healthThen.toFixed(0)}%` : ""}: ${plural(since!, "new project")} since, too few to judge it`;
    case "notHeld":
      return since == null
        ? `Fix pushed ${fmtDay(r.fix!.on)} and still under ${HEALTH_FLOOR}%`
        : `Fix pushed ${fmtDay(r.fix!.on)} didn't hold: ${plural(since, "new project")} since, still under ${HEALTH_FLOOR}%`;
    case "runningFail":
      return `Falling with ${plural(r.newProjects ?? 0, "new project")}: instances already running are failing`;
    case "newFail":
      return `Falling as ${plural(r.newProjects ?? 0, "new project")} landed: canary a fresh deploy`;
    default:
      return "Low and steady, no fix recorded";
  }
}

const SPARK_W = 96;
const SPARK_H = 24;

/** Health over the series on a fixed 0–100 scale, so rows compare: the
 * dashed line is the floor and the tick is the day a fix was pushed. */
function Spark({ r }: { r: HealthRead }) {
  const n = r.spark.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * SPARK_W;
  const y = (v: number) => SPARK_H - 1 - (v / 100) * (SPARK_H - 2);
  // Unscored days break the line instead of bridging it.
  const runs: string[] = [];
  let run: string[] = [];
  r.spark.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
    } else run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  const fixAt = r.fix ? r.days.findIndex((d) => d >= r.fix!.on) : -1;
  return (
    <svg width={SPARK_W} height={SPARK_H} className="block overflow-visible" role="img" aria-label={`Health from ${fmtLongDay(r.days[0])} to ${fmtLongDay(r.days[n - 1])}`}>
      <line x1={0} x2={SPARK_W} y1={y(HEALTH_FLOOR)} y2={y(HEALTH_FLOOR)} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="2 2" />
      {fixAt >= 0 && (
        <line x1={x(fixAt)} x2={x(fixAt)} y1={0} y2={SPARK_H} stroke="var(--chart-5)" strokeWidth={1.5}>
          <title>Fix pushed {fmtLongDay(r.fix!.on)}</title>
        </line>
      )}
      {runs.map((points) => (
        <polyline key={points} points={points} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** The templates whose health needs a look, with what would tell why:
 * the fall, the deploys that came in while it fell, and whether a recorded
 * fix has had deploys to prove itself on. */
export function HealthWatch({ templates, series }: { templates: TimelineTemplate[]; series: HealthSeries }) {
  const name = shortNames(templates.map((t) => t.name));
  const watched = templates.flatMap((t) => {
    const r = readHealth(t, series);
    return r && onWatch(r) ? [{ t, r }] : [];
  });
  const { rows, head } = useSort(
    watched,
    ({ t, r }, key: "name" | "health" | "change" | "newProjects" | "redeploys" | "fix" | "earned" | "running") =>
      ({
        name: name(t.name),
        health: r.now,
        change: r.change,
        newProjects: r.newProjects,
        redeploys: r.redeploys,
        fix: r.fix?.newSince,
        earned: earned30(t),
        running: t.running,
      })[key],
    "earned",
    ["name", "health", "change"],
  );
  if (watched.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing under {HEALTH_FLOOR}% and nothing falling.</p>;
  }
  const low = watched.filter(({ r }) => r.now < HEALTH_FLOOR);
  const count = (state: HealthRead["state"]) => watched.filter(({ r }) => r.state === state).length;
  return (
    <div className="space-y-3">
      <p className="max-w-[80ch] text-sm text-muted-foreground">
        <Fig>{fmtNum(low.length)}</Fig> under {HEALTH_FLOOR}%, <Fig>{fmtNum(low.filter(({ t }) => earned30(t) > 0).length)}</Fig> of
        them earning{watched.length > low.length && <>; <Fig>{fmtNum(watched.length - low.length)}</Fig> more falling</>}.{" "}
        <Fig>{fmtNum(count("untested"))}</Fig> have a fix that can&apos;t be judged yet, <Fig>{fmtNum(count("notHeld"))}</Fig> a fix
        that didn&apos;t hold, and <Fig>{fmtNum(count("runningFail"))}</Fig> are falling with no new deploys to blame.
      </p>
      <Table rows={rows.length} limit={50} className="min-w-[60rem]">
        <TableHeader>
          <TableRow>
            {head("name", "Template")}
            {head("health", "Health", { numeric: true, hint: `Share of recent deploys that are up. Under ${HEALTH_FLOOR}% search sorts it below unscored listings` })}
            {head("change", `${WATCH_DAYS} days`, { numeric: true, hint: `Points gained or lost over the last ${WATCH_DAYS} days` })}
            <TableHead className="max-sm:hidden" hint={`Health day by day on a 0 to 100 scale. The dashed line is ${HEALTH_FLOOR}%; the upright one is the day a fix was pushed`}>
              Last {series.days.length}d
            </TableHead>
            {head("newProjects", "New", { numeric: true, hint: `Projects made from it in the last ${WATCH_DAYS} days. Only these can show whether the current image deploys well` })}
            {head("redeploys", "Redeploys", { numeric: true, hint: `Deploys in the last ${WATCH_DAYS} days beyond the new projects: deployers redeploying what they already run, and our own canaries. Railway counts them about once a day` })}
            {head("fix", "Since fix", { numeric: true, hint: `New projects since the day a fix was recorded. Under ${FIX_TEST_DEPLOYS}, the fix can't be judged: health scores the instances already running` })}
            {head("earned", "Earned 30d", { numeric: true })}
            {head("running", "Running", { numeric: true, hint: "Service instances up now" })}
            <TableHead>Reading</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ t, r }) => (
            <TableRow key={t.templateId}>
              <TableRowHead>
                <Link to={{ hash: `#t-${t.templateId}` }} className="underline decoration-current/40 underline-offset-3 hover:decoration-current">
                  {name(t.name)}
                </Link>
              </TableRowHead>
              <TableCell numeric className={cn(r.now < HEALTH_FLOOR && "font-medium")}>{r.now.toFixed(0)}%</TableCell>
              <TableCell numeric className={cn(!r.change && "text-muted-foreground")}>
                {r.change == null ? "—" : r.change === 0 ? "0" : `${r.change > 0 ? "+" : "−"}${Math.abs(r.change).toFixed(0)}`}
              </TableCell>
              <TableCell className="max-sm:hidden">
                <Spark r={r} />
              </TableCell>
              <TableCell numeric className={cn(!r.newProjects && "text-muted-foreground")}>{r.newProjects == null ? "—" : fmtNum(r.newProjects)}</TableCell>
              <TableCell numeric className={cn(!r.redeploys && "text-muted-foreground")}>{r.redeploys == null ? "—" : fmtNum(r.redeploys)}</TableCell>
              <TableCell numeric className={cn(!r.fix && "text-muted-foreground")} title={r.fix?.healthThen != null ? `Fix pushed ${fmtLongDay(r.fix.on)}, at ${r.fix.healthThen.toFixed(0)}% health` : undefined}>
                {r.fix ? (r.fix.newSince == null ? fmtDay(r.fix.on) : fmtNum(r.fix.newSince)) : "—"}
              </TableCell>
              <TableCell numeric className={cn(!earned30(t) && "text-muted-foreground")}>{fmtUsd(earned30(t))}</TableCell>
              <TableCell numeric>{t.running == null ? "—" : fmtNum(t.running)}</TableCell>
              <TableCell className="min-w-56 text-xs text-muted-foreground">{reading(r)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
