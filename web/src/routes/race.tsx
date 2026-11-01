import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "~/components/page";
import { RaceBoard } from "~/components/race-board";
import { Skeleton } from "~/components/ui/skeleton";
import { timelineQuery } from "~/queries/analytics";
import type { Route } from "./+types/race";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Race · Dispatcher" }];
}

export default function Race() {
  // The whole history: kickback reaches back to the first payout.
  const timeline = useQuery(timelineQuery(365));
  const data = timeline.data;

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader title="Race" sub="Kickback and new projects, day by day, run as a race between templates and their groups" />
      {timeline.isPending && <Skeleton className="h-[36rem] w-full" />}
      {timeline.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && !data && (
        <p className="text-sm text-muted-foreground">No data yet. Refresh from the bar to collect it.</p>
      )}
      {data && <RaceBoard data={data} />}
    </main>
  );
}
