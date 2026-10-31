import { useQuery } from "@tanstack/react-query";
import { Candidates } from "~/components/candidates";
import { PageHeader } from "~/components/page";
import { Proposals } from "~/components/proposals";
import { Skeleton } from "~/components/ui/skeleton";
import { timelineQuery } from "~/queries/analytics";
import type { Route } from "./+types/candidates";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Candidates · Dispatcher" }];
}

export default function CandidatesPage() {
  // Our catalog only marks which apps we already publish; Patterns reads the
  // same 90 days, so the two share one fetch.
  const timeline = useQuery(timelineQuery(90));

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Candidates"
        sub="Apps people deploy on Railway, against what we already publish. Shortlist the next build; skip the rest."
      />
      <Proposals />
      {timeline.isPending && <Skeleton className="h-96 w-full" />}
      {timeline.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && <Candidates templates={timeline.data?.templates ?? []} />}
    </main>
  );
}
