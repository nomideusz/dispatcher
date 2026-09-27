import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Delta } from "~/components/delta";
import { PayoutHistory } from "~/components/payout-history";
import { RangeToggle, type RangeDays } from "~/components/range-toggle";
import { TemplateFunnel } from "~/components/template-funnel";
import { TemplateScatter, TemplateSegments } from "~/components/template-scatter";
import { TemplatesTable } from "~/components/templates-table";
import { TimelineChart } from "~/components/timeline-chart";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { dayDate, dayKey, fmtAgo, fmtCents, fmtDay, fmtNum, shortName } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  qualifiesForBonus,
  SUPPORT_BONUS_THRESHOLD,
  type TimelineResponse,
  timelineQuery,
  useRefreshAnalytics,
} from "~/queries/analytics";
import { type PayoutHistory as PayoutHistoryData, payoutHistoryQuery } from "~/queries/payouts";
import {
  accountLabel,
  scheduleDescription,
  withdrawAccountsQuery,
  withdrawSettingsQuery,
} from "~/queries/withdraw";
import type { Route } from "./+types/analytics";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dispatcher" }];
}

export default function Analytics() {
  const [days, setDays] = useState<RangeDays>(30);
  const timeline = useQuery(timelineQuery(days));
  const payouts = useQuery(payoutHistoryQuery(days));
  const data = timeline.data;
  const payers = new Map(payouts.data?.byTemplate.map((t) => [t.templateId, t.payers]));

  return (
    <main className="viz shell space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">Kickback</h1>
          <p className="text-sm text-muted-foreground">
            {data
              ? `Sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago · tracking since ${fmtDay(data.trackedSince)}`
              : "What your templates earn, who deploys them, and when"}
          </p>
        </div>
        {data && <RangeToggle value={days} onChange={setDays} />}
      </header>

      {timeline.isPending && <DashboardSkeleton />}
      {timeline.isError && (
        <p className="text-sm text-(--viz-critical)">
          Failed to load analytics — is the API up?
        </p>
      )}
      {timeline.isSuccess && !data && <EmptyState />}

      {data && (
        <>
          <KpiBand data={data} payouts={payouts.data} />
          <Attention data={data} payouts={payouts.data} />

          <Card>
            <CardHeader>
              <CardTitle>Day by day</CardTitle>
              <CardDescription>
                What each day earned, how many projects were created and still live, and how
                big the catalog was. Hover a day to see which templates moved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TimelineChart data={data} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle>Reach vs money</CardTitle>
                <CardDescription>
                  Each template by its live projects and its last 30 days of kickback. Above
                  the dashed line a project earns more than $1 a month; far right and low is
                  popular but unpaid.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TemplateScatter templates={data.templates} payers={payers} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle>From deploy to kickback</CardTitle>
                <CardDescription>What Railway counts, widest first, across all templates</CardDescription>
              </CardHeader>
              <CardContent>
                <TemplateFunnel
                  templates={data.templates}
                  payers={payouts.data?.byTemplate.reduce((s, t) => s + t.payers, 0)}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>What earns</CardTitle>
              <CardDescription>
                Kickback over the last 30 days per active project, by template size and by
                when it was published
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateSegments templates={data.templates} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Templates</CardTitle>
              <CardDescription>
                New and earned are for the last {days} days; payers and $/active for the last
                30. Last deploy is when a new project last appeared; paid is the first and
                latest kickback.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplatesTable
                templates={data.templates}
                byTemplate={payouts.data?.byTemplate}
                dates={data.points.map((p) => p.date)}
              />
            </CardContent>
          </Card>

          <PayoutHistory days={days} />
        </>
      )}
    </main>
  );
}

function KpiBand({
  data,
  payouts,
}: {
  data: TimelineResponse;
  payouts: PayoutHistoryData | undefined;
}) {
  const accounts = useQuery(withdrawAccountsQuery);
  const withdraw = useQuery(withdrawSettingsQuery);
  const { window: w, points, templates } = data;

  const perDay = w.earnedCents / w.days;
  const lifetime = templates.reduce((s, t) => s + t.lifetimeCents, 0);
  const first = points.find((p) => p.activeProjects != null);
  const last = points[points.length - 1];
  const activeNow = templates.reduce((s, t) => s + t.activeProjects, 0);
  const runningNow = templates.reduce((s, t) => s + (t.running ?? 0), 0);
  const projectsNow = templates.reduce((s, t) => s + t.projects, 0);
  const activeChange = first?.activeProjects != null ? activeNow - first.activeProjects : null;
  const since = points[0]?.date ?? "";
  const added = templates.filter((t) => t.publishedAt && dayKey(t.publishedAt) >= since).length;
  const earning = templates.filter((t) => t.earnedCents > 0).length;
  // A previous range that reaches back before the first kickback compares
  // against nothing: +48,000% is true and useless.
  const firstPaid = Math.min(...templates.map((t) => (t.firstPaidAt ? Date.parse(t.firstPaidAt) : Infinity)));
  const comparable = firstPaid <= dayDate(since).getTime() - w.days * 86_400_000;

  const balance = accounts.data?.availableBalance;
  const minimum = accounts.data?.minimumBalance ?? 10_000;
  const auto = withdraw.data;
  const autoAccount = auto && accounts.data?.accounts.find((a) => a.id === auto.withdrawalAccountId);

  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid-cols-5 [&>*]:border-foreground/10">
      <BandCell label={`Earned · last ${w.days}d`} className="border-r border-b lg:border-b-0">
        <BandValue value={fmtCents(w.earnedCents)} />
        <Delta
          pct={
            comparable && w.previousEarnedCents > 0
              ? ((w.earnedCents - w.previousEarnedCents) / w.previousEarnedCents) * 100
              : null
          }
          suffix={`vs previous ${w.days}d`}
        />
        <p className="text-xs text-muted-foreground">{fmtCents(perDay)} a day</p>
      </BandCell>

      <BandCell label="Balance" className="border-b lg:border-r lg:border-b-0">
        {accounts.isPending ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <BandValue value={balance != null ? fmtCents(balance) : "—"} />
        )}
        {balance != null && (
          <>
            <div className="h-1.5 rounded-full bg-muted" title={`${fmtCents(minimum)} minimum withdrawal`}>
              <div
                className="h-full rounded-full bg-(--chart-1)"
                style={{ width: `${Math.min(100, (balance / minimum) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {balance >= minimum
                ? auto?.enabled
                  ? [
                      "Auto-withdraw",
                      scheduleDescription(auto.schedule),
                      autoAccount ? accountLabel(autoAccount) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Withdrawable · auto-withdraw is off"
                : `${fmtCents(minimum - balance)} to the ${fmtCents(minimum)} minimum${
                    perDay > 0 ? ` · ~${Math.ceil((minimum - balance) / perDay)} days at this pace` : ""
                  }`}
            </p>
          </>
        )}
      </BandCell>

      <BandCell label="Lifetime kickback" className="border-r border-b lg:border-b-0">
        <BandValue value={fmtCents(lifetime)} />
        <p className="text-xs text-muted-foreground">
          {payouts ? `${fmtCents(payouts.totals.lifetimeCents)} of it paid out` : " "}
        </p>
      </BandCell>

      <BandCell label="Active projects" className="border-b lg:border-r lg:border-b-0">
        <BandValue value={fmtNum(activeNow)} />
        {activeChange != null && first && (
          <p className="text-xs">
            <span className={activeChange >= 0 ? "text-(--viz-up)" : "text-(--viz-down)"}>
              {activeChange >= 0 ? "+" : ""}
              {fmtNum(activeChange)}
            </span>{" "}
            <span className="text-muted-foreground">since {fmtDay(first.date)}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {fmtNum(runningNow)} running · {fmtNum(projectsNow)} ever
        </p>
      </BandCell>

      <BandCell label="Templates" className="col-span-2 lg:col-span-1">
        <BandValue value={fmtNum(last?.published ?? templates.length)} />
        <p className="text-xs text-muted-foreground">
          {fmtNum(earning)} earned in {w.days}d · {fmtNum(added)} added
        </p>
        <p className="text-xs text-muted-foreground">{fmtNum(last?.services ?? 0)} services</p>
      </BandCell>
    </section>
  );
}

function BandCell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1 p-4", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function BandValue({ value }: { value: string }) {
  return <div className="text-2xl font-semibold tabular-nums">{value}</div>;
}

function Attention({
  data,
  payouts,
}: {
  data: TimelineResponse;
  payouts: PayoutHistoryData | undefined;
}) {
  const accounts = useQuery(withdrawAccountsQuery);
  const withdraw = useQuery(withdrawSettingsQuery);
  const items: { key: string; tone: "critical" | "muted"; text: string; title?: string }[] = [];

  const stale = Date.now() - Date.parse(data.sampledAt) > 24 * 3_600_000;
  if (stale) {
    items.push({
      key: "stale",
      tone: "critical",
      text: `No snapshot since ${fmtDay(data.sampledAt)} — the collector has stopped`,
    });
  }
  const atRisk = data.templates.filter((t) => !qualifiesForBonus(t));
  if (atRisk.length > 0) {
    items.push({
      key: "support",
      tone: "critical",
      text: `${atRisk.length} ${atRisk.length === 1 ? "template is" : "templates are"} below the ${SUPPORT_BONUS_THRESHOLD}% support-bonus line`,
      title: atRisk.map((t) => shortName(t.name)).join(", "),
    });
  }
  const failing = data.templates.filter(
    (t) => t.activeProjects > 0 && t.health != null && t.health < 50,
  );
  if (failing.length > 0) {
    items.push({
      key: "health",
      tone: "muted",
      text: `${failing.length} deployed ${failing.length === 1 ? "template has" : "templates have"} deploy health under 50%`,
      title: failing.map((t) => `${shortName(t.name)} ${t.health}%`).join(", "),
    });
  }
  if (payouts && payouts.totals.pendingCount > 0) {
    items.push({
      key: "pending",
      tone: "muted",
      text: `${fmtCents(payouts.totals.pendingCents)} in flight · ${payouts.totals.pendingCount} pending`,
    });
  }
  if (
    withdraw.data &&
    !withdraw.data.enabled &&
    accounts.data &&
    accounts.data.availableBalance > 0 &&
    accounts.data.availableBalance >= accounts.data.minimumBalance
  ) {
    items.push({
      key: "auto",
      tone: "muted",
      text: "Balance is withdrawable and auto-withdraw is off",
    });
  }
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          title={item.title}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs ring-1",
            item.tone === "critical"
              ? "bg-destructive/10 text-(--viz-critical) ring-destructive/20"
              : "bg-card text-muted-foreground ring-foreground/10",
          )}
        >
          {item.text}
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  const refresh = useRefreshAnalytics();
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          No snapshots yet. The collector runs hourly, or you can grab the first
          one right now.
        </p>
        <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? "Refreshing…" : "Refresh now"}
        </Button>
        {refresh.isError && (
          <p className="text-sm text-(--viz-critical)">
            Couldn&apos;t refresh — check the server logs and try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <section className="grid grid-cols-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </section>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    </>
  );
}
