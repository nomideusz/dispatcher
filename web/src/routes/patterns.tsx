import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "~/components/page";
import { Strategy } from "~/components/strategy";
import { Skeleton } from "~/components/ui/skeleton";
import { WhatToPublish } from "~/components/what-to-publish";
import { fmtAgo } from "~/lib/format";
import { timelineQuery } from "~/queries/analytics";
import { payoutHistoryQuery } from "~/queries/payouts";
import type { Route } from "./+types/patterns";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Patterns · Dispatcher" }];
}

export default function Patterns() {
  // Fixed windows (30 days for earning, 90 for the trend), so no range.
  const timeline = useQuery(timelineQuery(90));
  // Payer chains are whole-life whatever the days; 30 shares Money's default cache.
  const payouts = useQuery(payoutHistoryQuery(30));
  const data = timeline.data;
  const sub = "Which kinds, sizes and ages of template earn, how soon they start paying, and whether publishing is paying off";

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Patterns"
        sub={data ? `${sub} · sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago` : sub}
      />
      {timeline.isPending && <Skeleton className="h-96 w-full" />}
      {timeline.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && !data && (
        <p className="text-sm text-muted-foreground">No data yet. Refresh from the bar to collect it.</p>
      )}
      {data && <WhatToPublish data={data} />}
      {/* Whole-life, after the fixed-window breakdowns above. */}
      {data && payouts.data && <Strategy payers={payouts.data.payers} />}
    </main>
  );
}
