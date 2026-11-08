import type { ReactNode } from "react";
import { Link } from "react-router";
import { Fig, Section } from "~/components/page";
import { DAY, EDGE_CODE, HEALTH_FLOOR, publishedOn, tiersOf } from "~/components/strategy";
import { best, kindLabel, segmentsOf, sizeLabel } from "~/components/what-to-publish";
import { fmtNum, fmtUsd, shortName, shortNames } from "~/lib/format";
import type { TimelineResponse, TimelineTemplate } from "~/queries/analytics";
import type { Candidates } from "~/queries/candidates";
import type { Search } from "~/queries/search";
import type { ServiceUpgrade } from "~/queries/upgrades";

/** A new template's first month: younger ones mostly haven't been invoiced,
 * older ones are past the launch bump. */
const FRESH_FROM = 30;
const FRESH_TO = 90;
/** Search positions past this take a small share of a keyword's deploys. */
const TOP = 3;

type Lever = {
  key: string;
  name: string;
  /** The figure that is at stake, in the lever's own unit. */
  figure: string | null;
  unit: string;
  evidence: ReactNode;
  to: string;
  go: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const list = (items: string[]) => items.join(", ");

/** Where the next hour goes: each lever on the catalog with what is at stake
 * in it, read from the data every other page already shows. Facts and links
 * only; the call between them stays the owner's. */
export function Levers({
  data,
  upgrades,
  search,
  candidates,
}: {
  data: TimelineResponse;
  upgrades: ServiceUpgrade[] | undefined;
  search: Search | undefined;
  candidates: Candidates | undefined;
}) {
  const { templates } = data;
  const name = shortNames(templates.map((t) => t.name));
  const nowMs = Date.parse(data.sampledAt);
  const earned = (t: TimelineTemplate) => t.earned30d ?? 0;
  const age = (t: TimelineTemplate) => (nowMs - Date.parse(publishedOn(t))) / DAY;
  const byEarned = (a: TimelineTemplate, b: TimelineTemplate) => earned(b) - earned(a);
  const tiers = tiersOf(templates, nowMs);
  const notTaken = tiers[tiers.length - 1].rows;

  // Health: money on earners below the floor, and use on the rest of them.
  const sick = templates.filter((t) => t.health != null && t.health < HEALTH_FLOOR && t.code !== EDGE_CODE);
  const sickEarning = sick.filter((t) => earned(t) > 0).sort(byEarned);
  const sickIdle = sick.filter((t) => earned(t) === 0 && (t.running ?? 0) > 0);

  // Upgrades: the queue's own "behind" rule, so counts match the Upgrades page.
  const behindIds = new Set((upgrades ?? []).filter((u) => u.behind === "minor" || u.behind === "patch").map((u) => u.templateId));
  const urgent = new Set((upgrades ?? []).filter((u) => u.urgent).map((u) => u.templateId));
  const behind = templates.filter((t) => behindIds.has(t.templateId));
  const behindEarning = behind.filter((t) => earned(t) > 0).sort(byEarned);
  const behindIdle = notTaken.filter((t) => behindIds.has(t.templateId));

  // Search: keywords one of ours shows on but below the top three, and ours
  // that dropped out. Keywords returning the same templates share a demand
  // figure ("linux desktop *"), so each figure is named once.
  const keywords = search?.keywords ?? [];
  const weak = keywords
    .filter((k) => (k.best != null && k.best > TOP) || (k.best == null && k.prevBest != null))
    .sort((a, b) => b.demand - a.demand);
  const seen = new Set<number>();
  const weakTop = weak.filter((k) => !seen.has(k.demand) && seen.add(k.demand)).slice(0, 3);
  const slipped = keywords.filter((k) => k.prevBest != null && (k.best == null || k.best > k.prevBest)).length;
  const share = (pos: number) => search?.curve.find((c) => c.position === pos)?.share;

  // Listings: apps we publish where others' templates take most deploys
  // (the Candidates page's Behind view). The sum counts each app's own
  // deploys only: similar names overlap, so adding theirs counts twice.
  const losing = (candidates?.groups ?? [])
    .filter((g) => g.ours.length > 0 && g.ourRecent * 2 < g.recent + g.similarRecent)
    .map((g) => ({ g, total: g.recent, lost: Math.max(0, g.recent - g.ourRecent) }))
    .sort((a, b) => b.lost - a.lost);
  const toRivals = losing.reduce((s, l) => s + l.lost, 0);
  const biggestLoss = losing[0];

  // Publishing: what templates in their first months bring in.
  const fresh = templates.filter((t) => age(t) >= FRESH_FROM && age(t) < FRESH_TO);
  const freshSum = fresh.reduce((s, t) => s + earned(t), 0);
  const { byKind, bySize } = segmentsOf(data);
  const topKind = best(byKind, "");
  const topSize = best(bySize);
  const shortlist = (candidates?.groups ?? []).filter((g) => g.status === "shortlist");

  const levers: Lever[] = [
    {
      key: "health",
      name: "Fix health",
      figure: fmtUsd(sickEarning.reduce((s, t) => s + earned(t), 0)),
      unit: `a month on earners under ${HEALTH_FLOOR}% health`,
      evidence: (
        <>
          <Fig>{fmtNum(sickEarning.length)}</Fig> earning {sickEarning.length === 1 ? "template is" : "templates are"} under{" "}
          {HEALTH_FLOOR}% deploy health
          {sickEarning.length > 0 &&
            `: ${list(sickEarning.slice(0, 3).map((t) => `${name(t.name)} ${t.health?.toFixed(0)}%`))}`}
          ; <Fig>{fmtNum(sickIdle.length)}</Fig> more have instances running but earn nothing. Health also orders search
          results among listings with the same name.
        </>
      ),
      to: "/templates?sort=health",
      go: "Templates by health",
    },
    {
      key: "upgrades",
      name: "Upgrade",
      figure: upgrades ? fmtUsd(behindEarning.reduce((s, t) => s + earned(t), 0)) : null,
      unit: "a month on earners behind on upgrades",
      evidence: (
        <>
          <Fig>{fmtNum(behind.length)}</Fig> templates are behind
          {urgent.size > 0 && (
            <>
              , <Fig>{fmtNum(urgent.size)}</Fig> urgent
            </>
          )}
          ; <Fig>{fmtNum(behindEarning.length)}</Fig> of them earn
          {behindEarning.length > 0 && `: ${list(behindEarning.slice(0, 3).map((t) => name(t.name)))}`}.{" "}
          <Fig>{fmtNum(behindIdle.length)}</Fig> were never taken up.
        </>
      ),
      to: "/upgrades",
      go: "Upgrades",
    },
    {
      key: "search",
      name: "Climb search",
      figure: search ? fmtNum(weak.length) : null,
      unit: `keywords where ours ranks below #${TOP} or dropped out`,
      evidence: (
        <>
          Biggest by deploys in 90 days:{" "}
          {weakTop.length
            ? list(weakTop.map((k) => `${k.query} ${k.best == null ? "gone" : `#${k.best}`} (${fmtNum(k.demand)})`))
            : "none"}
          . <Fig>{fmtNum(slipped)}</Fig> slipped in the last week.
          {share(1) != null && share(TOP + 1) != null && (
            <>
              {" "}
              #1 takes <Fig>{pct(share(1)!)}</Fig> of a keyword&apos;s deploys, #{TOP + 1} <Fig>{pct(share(TOP + 1)!)}</Fig>.
            </>
          )}
        </>
      ),
      to: "/search",
      go: "Search",
    },
    {
      key: "listings",
      name: "Win back listings",
      figure: candidates ? fmtNum(toRivals) : null,
      unit: "deploys in 90 days went to rivals' listings of apps we publish",
      evidence: (
        <>
          <Fig>{fmtNum(losing.length)}</Fig> apps where others take most of the deploys
          {losing.length > 0 &&
            `: ${list(losing.slice(0, 3).map(({ g, total }) => `${g.key} ${fmtNum(g.ourRecent)} of ${fmtNum(total)}`))}`}
          .
          {biggestLoss && toRivals > 0 && biggestLoss.lost / toRivals >= 0.3 && (
            <>
              {" "}
              {biggestLoss.g.key} alone is <Fig>{pct(biggestLoss.lost / toRivals)}</Fig>, against{" "}
              <Fig>{fmtNum(biggestLoss.g.rivals)}</Fig> rival templates.
            </>
          )}{" "}
          Fixing a listing is cheaper than building a template.
        </>
      ),
      to: "/candidates",
      go: "Candidates, Behind",
    },
    {
      key: "publish",
      name: "Publish new",
      figure: fresh.length ? fmtUsd(freshSum / fresh.length) : "—",
      unit: `a month per template published ${FRESH_FROM}–${FRESH_TO} days ago`,
      evidence: (
        <>
          <Fig>{fmtNum(fresh.length)}</Fig> such templates earn <Fig>{fmtUsd(freshSum)}</Fig> a month between them;{" "}
          <Fig>{fmtNum(fresh.filter((t) => earned(t) > 0).length)}</Fig> earn anything.
          {topKind && topSize && (
            <>
              {" "}
              Best-paying: {kindLabel(topKind.key)} <Fig>{fmtUsd(topKind.typical)}</Fig>, {sizeLabel(topSize.key)}{" "}
              <Fig>{fmtUsd(topSize.typical)}</Fig> a typical template.
            </>
          )}{" "}
          {shortlist.length
            ? `Shortlisted: ${list(shortlist.slice(0, 3).map((g) => shortName(g.leader.name)))}${shortlist.length > 3 ? ` +${shortlist.length - 3}` : ""}.`
            : "Nothing shortlisted."}
        </>
      ),
      to: "/candidates",
      go: "Candidates",
    },
    {
      key: "prune",
      name: "Stop maintaining",
      figure: fmtNum(notTaken.length),
      unit: "templates 45+ days old with nothing running or earned",
      evidence: (
        <>
          <Fig>{fmtNum(behindIdle.length)}</Fig> of them wait in the upgrade queue
          {notTaken.length > 0 && `; ${list([...notTaken].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => name(t.name)))} are the oldest`}
          .
        </>
      ),
      to: "#outcomes",
      go: "Templates by outcome",
    },
  ];

  return (
    <Section
      id="levers"
      title="Where the next hour goes"
      text="Each lever on the catalog and what is at stake in it. The figures are in their own units, money, deploys or keywords, so weigh them rather than rank them."
    >
      <div className="divide-y border-y">
        {levers.map((l) => (
          <div key={l.key} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[9rem_11rem_1fr] lg:grid-cols-[10rem_14rem_1fr_9rem]">
            <h3 className="text-base font-semibold">{l.name}</h3>
            <div>
              <div className="text-xl leading-tight font-semibold tabular-nums">{l.figure ?? "…"}</div>
              <div className="text-xs text-muted-foreground">{l.unit}</div>
            </div>
            <p className="text-sm text-muted-foreground sm:col-start-3 lg:col-start-auto">{l.evidence}</p>
            {l.to.startsWith("#") ? (
              <a href={l.to} className="text-sm text-primary underline sm:col-start-3 lg:col-start-auto lg:text-right">
                {l.go}
              </a>
            ) : (
              <Link to={l.to} className="text-sm text-primary underline sm:col-start-3 lg:col-start-auto lg:text-right">
                {l.go}
              </Link>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
