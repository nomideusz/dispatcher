import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Levers } from "~/components/levers";
import { PageHeader, Section, useHashFollow } from "~/components/page";
import { buildStrategy, CatalogTiers, Cohorts, StrategyDocket, Trend } from "~/components/strategy";
import { Skeleton } from "~/components/ui/skeleton";
import { PaidBySize, Segments } from "~/components/what-to-publish";
import { fmtAgo } from "~/lib/format";
import { timelineQuery } from "~/queries/analytics";
import { candidatesQuery } from "~/queries/candidates";
import { payoutHistoryQuery } from "~/queries/payouts";
import { searchQuery } from "~/queries/search";
import { upgradesQuery } from "~/queries/upgrades";
import type { Route } from "./+types/patterns";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Patterns · Dispatcher" }];
}

/** Is the catalog strategy working, and where the next hour goes: the
 * opening figures, the levers, then the evidence under them. Whole-life,
 * so no range. */
export default function Patterns() {
  const timeline = useQuery(timelineQuery(0));
  // Payer chains are whole-life whatever the days; 30 shares Money's default cache.
  const payouts = useQuery(payoutHistoryQuery(30));
  const upgrades = useQuery(upgradesQuery);
  const search = useQuery(searchQuery);
  const candidates = useQuery(candidatesQuery);
  const data = timeline.data;
  const payers = payouts.data?.payers;
  const model = useMemo(() => (data && payers ? buildStrategy(data, payers) : null), [data, payers]);
  useHashFollow(!!model);
  const sub = "Whether publishing pays, and whether the next hour goes to fixing, upgrading, search or a new template";

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Patterns"
        sub={data ? `${sub} · sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago` : sub}
      />
      {(timeline.isPending || (data && !model && payouts.isPending)) && <Skeleton className="h-96 w-full" />}
      {(timeline.isError || payouts.isError) && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && !data && (
        <p className="text-sm text-muted-foreground">No data yet. Refresh from the bar to collect it.</p>
      )}
      {data && model && (
        <>
          <StrategyDocket data={data} model={model} />
          <Levers data={data} upgrades={upgrades.data} search={search.data} candidates={candidates.data} />
          <Trend data={data} model={model} />
          <Section
            id="new"
            title="Do new templates pay?"
            text="How each publishing month does at the same age, and how soon a template of each size earns its first kickback. The case for publishing more rests here."
          >
            <div className="grid gap-x-8 gap-y-8 xl:grid-cols-2">
              <Cohorts model={model} />
              <PaidBySize data={data} />
            </div>
          </Section>
          <Segments data={data} />
          <Section
            id="outcomes"
            title="Templates by outcome"
            text="Every template in exactly one row. Earners are worth repairing, in-use ones may be one fix from paying, and those nobody took up after 45 days cost upkeep for nothing."
          >
            <CatalogTiers data={data} />
          </Section>
        </>
      )}
    </main>
  );
}
