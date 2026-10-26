import { useQuery } from "@tanstack/react-query";
import { Copies } from "~/components/candidates";
import { PageHeader, Section, useHashFollow } from "~/components/page";
import { RangeToggle, useRangeDays } from "~/components/range-toggle";
import { TemplateFunnel } from "~/components/template-funnel";
import { TemplateScatter } from "~/components/template-scatter";
import { TemplatesTable } from "~/components/templates-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtAgo } from "~/lib/format";
import { timelineQuery } from "~/queries/analytics";
import { candidatesQuery } from "~/queries/candidates";
import { payoutHistoryQuery } from "~/queries/payouts";
import type { Route } from "./+types/templates";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Templates · Dispatcher" }];
}

export default function Templates() {
  const [days, setDays] = useRangeDays();
  const timeline = useQuery(timelineQuery(days));
  const payouts = useQuery(payoutHistoryQuery(days));
  const candidates = useQuery(candidatesQuery);
  const data = timeline.data;
  const byTemplate = payouts.data?.byTemplate;
  const copies = candidates.data?.copies ?? [];
  // The Held tray on Money links to #t-<id> rows and to #copies.
  useHashFollow(!!data && candidates.isFetched);

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Templates"
        sub={
          data
            ? `Every template we publish, what it earns and how it is used · sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago`
            : "Every template we publish, what it earns and how it is used"
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
        <p className="text-sm text-muted-foreground">No data yet. Refresh from the bar to collect it.</p>
      )}

      {data && (
        <>
          <Section
            id="catalog"
            title="Catalog"
            text={`Every template with its numbers${days === 30 ? ", over the last 30 days" : `. New and Earned cover the last ${days} days; $/active the last 30`}. Point at a column name for what it counts; open a row for its dates and projects over time.`}
          >
            <TemplatesTable templates={data.templates} byTemplate={byTemplate} dates={data.points.map((p) => p.date)} />
          </Section>

          <Section id="reach" title="Use and pay" text="Which templates people use, and which of those pay.">
            <div className="grid gap-x-8 lg:grid-cols-12">
              <Card className="lg:col-span-7">
                <CardHeader>
                  <CardTitle>Reach vs money</CardTitle>
                  <CardDescription>
                    Live projects against kickback in the last 30 days. Dots above a diagonal earn
                    more per project than its label. Far right and low: popular but unpaid.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TemplateScatter
                    templates={data.templates}
                    payers={new Map(byTemplate?.map((t) => [t.templateId, t.payers]))}
                  />
                </CardContent>
              </Card>
              <Card className="max-lg:border-t lg:col-span-5 lg:border-l lg:pl-8">
                <CardHeader>
                  <CardTitle>From deploy to kickback</CardTitle>
                  <CardDescription>Railway&apos;s counts across all templates, widest first</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <TemplateFunnel templates={data.templates} payers={byTemplate?.reduce((s, t) => s + t.payers, 0)} />
                </CardContent>
              </Card>
            </div>
          </Section>

          {copies.length > 0 && (
            <Section
              id="copies"
              title="Copies"
              text="Templates by other creators that build from our repos. Their deploys pay their creator, not us, yet they build whatever we push to main."
            >
              <Copies copies={copies} />
            </Section>
          )}
        </>
      )}
    </main>
  );
}
