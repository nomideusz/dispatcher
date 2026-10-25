import { useQuery } from "@tanstack/react-query";
import { Candidates } from "~/components/candidates";
import { PageHeader, Section } from "~/components/page";
import { RangeToggle, useRangeDays } from "~/components/range-toggle";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { WhatToPublish } from "~/components/what-to-publish";
import { fmtAgo } from "~/lib/format";
import { timelineQuery } from "~/queries/analytics";
import type { Route } from "./+types/decide";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Decide · Dispatcher" }];
}

export default function Decide() {
  const [days, setDays] = useRangeDays();
  const timeline = useQuery(timelineQuery(days));
  const data = timeline.data;

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Decide"
        sub={
          data
            ? `What to build next, from what pays and what people deploy · sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago`
            : "What to build next, from what pays and what people deploy"
        }
      >
        {data && <RangeToggle value={days} onChange={setDays} />}
      </PageHeader>

      {timeline.isPending && <Skeleton className="h-96 w-full" />}
      {timeline.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && !data && (
        <p className="text-sm text-muted-foreground">
          No snapshots yet. Today has a button to collect the first one.
        </p>
      )}

      {data && (
        <>
          <Section
            id="publish"
            title="What to publish"
            text="What kind of template, how big and how old, against what it earns and how soon it starts paying."
          >
            <Card>
              <CardContent>
                <WhatToPublish data={data} />
              </CardContent>
            </Card>
          </Section>

          <Section
            id="candidates"
            title="Candidates"
            text="What people deploy on Railway, one row per app, against what we already publish. Shortlist what to build next; skip what never will be."
          >
            <Card>
              <CardContent>
                <Candidates templates={data.templates} />
              </CardContent>
            </Card>
          </Section>
        </>
      )}
    </main>
  );
}
