import { useQuery } from "@tanstack/react-query";
import { HealthDetail } from "~/components/health-detail";
import { type FixableRow, FixableTable } from "~/components/health-fixable";
import { HealthWatch } from "~/components/health-watch";
import { DOCKET, DocketCell, Fig, PageHeader, Section, useHashFollow, useUrlState } from "~/components/page";
import { Skeleton } from "~/components/ui/skeleton";
import { earned30, HEALTH_FLOOR } from "~/lib/catalog";
import { fmtAgo, fmtNum } from "~/lib/format";
import { HEALTH_FALL, isFast, isFixable, onWatch, readHealth, SCORED_DEPLOYS, SLOW_FILL_DAYS, searchStake, WATCH_DAYS } from "~/lib/health";
import { cn } from "~/lib/utils";
import { healthSeriesQuery, timelineQuery } from "~/queries/analytics";
import { searchQuery } from "~/queries/search";
import { upgradesQuery } from "~/queries/upgrades";
import type { Route } from "./+types/health";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Health · Dispatcher" }];
}

export default function Health() {
  const timeline = useQuery(timelineQuery(30));
  const series = useQuery(healthSeriesQuery);
  const search = useQuery(searchQuery);
  const upgrades = useQuery(upgradesQuery);
  const [params, setParams] = useUrlState();
  const data = timeline.data;
  useHashFollow(!!data && series.isFetched);

  const scored = data?.templates.filter((t) => t.health != null) ?? [];
  const reads = series.data
    ? scored.flatMap((t) => {
        const r = readHealth(t, series.data);
        return r ? [{ t, r }] : [];
      })
    : [];
  const keywords = search.data?.keywords;
  const stakeOf = (templateId: string) => (keywords ? searchStake(templateId, keywords) : null);
  const fixable: FixableRow[] = reads.filter(({ r }) => isFixable(r)).map((x) => ({ ...x, stake: stakeOf(x.t.templateId) }));
  const watched = reads.filter(({ r }) => onWatch(r));

  const at100 = scored.filter((t) => t.health === 100).length;
  const low = scored.filter((t) => t.health! < HEALTH_FLOOR);
  const falling = reads.filter(({ r }) => r.change != null && r.change <= -HEALTH_FALL);
  const fallingQuiet = falling.filter(({ r }) => (r.newProjects ?? 0) <= 2);
  const slowWatched = watched.filter(({ r }) => !isFast(r));

  // The detail opens on ?t=, else on what most needs a look.
  const byEarned = (rows: { t: (typeof scored)[number] }[]) => [...rows].sort((a, b) => earned30(b.t) - earned30(a.t));
  const fallback = byEarned(fixable)[0]?.t ?? byEarned(watched)[0]?.t ?? scored[0];
  const selected = scored.find((t) => t.templateId === params.get("t")) ?? fallback;
  const upgradedOn = upgrades.data
    ? upgrades.data.filter((u) => u.templateId === selected?.templateId).reduce((d, u) => (u.upgradedOn > d ? u.upgradedOn : d), "")
    : "";

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Health"
        sub={
          data
            ? `Deploy health of every scored template, what it costs in search and what to fix first · sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago`
            : "Deploy health of every scored template, what it costs in search and what to fix first"
        }
      />

      {(timeline.isPending || series.isPending) && <Skeleton className="h-96 w-full" />}
      {(timeline.isError || series.isError) && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load the health history. Check that the API is running, then reload.
        </p>
      )}

      {data && series.data && (
        <>
          <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
            <DocketCell label="At exactly 100" value={fmtNum(at100)}>
              <p>
                of <Fig>{fmtNum(scored.length)}</Fig> scored
              </p>
              <p>the top band in search</p>
            </DocketCell>
            <DocketCell label="Still fixable" value={fmtNum(fixable.length)}>
              <p>short of 100, {SCORED_DEPLOYS} new deploys within {SLOW_FILL_DAYS} days</p>
              <p>a fix shows in days</p>
            </DocketCell>
            <DocketCell label={`Under ${HEALTH_FLOOR}%`} value={fmtNum(low.length)}>
              <p>
                <Fig>{fmtNum(low.filter((t) => earned30(t) > 0).length)}</Fig> of them earning
              </p>
              <p>sorted below unscored listings</p>
            </DocketCell>
            <DocketCell label={`Falling, ${WATCH_DAYS} days`} value={fmtNum(falling.length)}>
              <p>
                lost {HEALTH_FALL} points or more; <Fig>{fmtNum(fallingQuiet.length)}</Fig> with next to no new deploys
              </p>
            </DocketCell>
          </div>

          <Section
            id="fixable"
            title="Still fixable"
            text={`Short of 100 while ${SCORED_DEPLOYS} new projects still arrive within ${SLOW_FILL_DAYS} days. New deploys set these scores, so a bad one ages out and a fix shows within days. Let one slip and the lost rank slows deploys until the running instances set the score.`}
          >
            <FixableTable rows={fixable} />
          </Section>

          <Section
            id="watch"
            title="Health watch"
            text={`Under ${HEALTH_FLOOR}%, or ${HEALTH_FALL} points down in ${WATCH_DAYS} days, with the most money at stake first. ${
              slowWatched.length
                ? `${slowWatched.length} of ${watched.length} take over ${SLOW_FILL_DAYS} days to get ${SCORED_DEPLOYS} new projects, so their instances already running set the score and a push won't reach them: only new healthy deploys from others bring it back.`
                : "Judge a fix by the deploys since, not by the calendar."
            }`}
          >
            <HealthWatch templates={data.templates} series={series.data} />
          </Section>

          {selected && (
            <Section
              id="detail"
              title="One template"
              text="Hour by hour against the projects that arrived, how fast its scored set turns over, every move with what moved beside it, and where it shows in search. Pick one here or press a name above."
            >
              <HealthDetail
                templates={scored}
                selected={selected}
                onSelect={(id) => setParams({ t: id })}
                read={reads.find(({ t }) => t.templateId === selected.templateId)?.r ?? null}
                stake={stakeOf(selected.templateId)}
                upgradedOn={upgradedOn}
              />
            </Section>
          )}
        </>
      )}
    </main>
  );
}
