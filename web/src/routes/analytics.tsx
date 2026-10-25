import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Delta } from "~/components/delta";
import { RangeToggle, type RangeDays, useRangeDays } from "~/components/range-toggle";
import { TemplateFunnel } from "~/components/template-funnel";
import { TemplateScatter } from "~/components/template-scatter";
import { TemplatesTable } from "~/components/templates-table";
import { Earnings } from "~/components/earnings";
import { PageHeader, Section } from "~/components/page";
import { behindTemplateCount, UpgradeQueue } from "~/components/upgrade-queue";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { dayDate, dayKey, fmtAgo, fmtCents, fmtDay, fmtNum, shortName, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  qualifiesForBonus,
  SUPPORT_BONUS_THRESHOLD,
  type TimelineResponse,
  timelineQuery,
  useRefreshAnalytics,
} from "~/queries/analytics";
import { candidatesQuery } from "~/queries/candidates";
import {
  type PayoutHistory as PayoutHistoryData,
  type PayoutTemplateTotal,
  payoutHistoryQuery,
} from "~/queries/payouts";
import { upgradesQuery } from "~/queries/upgrades";
import {
  accountLabel,
  scheduleDescription,
  withdrawAccountsQuery,
  withdrawSettingsQuery,
} from "~/queries/withdraw";
import type { Route } from "./+types/analytics";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Today · Dispatcher" }];
}

export default function Today() {
  const [days, setDays] = useRangeDays();
  const timeline = useQuery(timelineQuery(days));
  const payouts = useQuery(payoutHistoryQuery(days));
  const data = timeline.data;
  const payers = new Map(payouts.data?.byTemplate.map((t) => [t.templateId, t.payers]));

  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Today"
        sub={
          data
            ? `Sampled ${fmtAgo(data.sampledAt, new Date().toISOString())} ago · tracking since ${fmtDay(data.trackedSince)}`
            : "What your templates earn, what needs you, and what to do next"
        }
      >
        {data && <RangeToggle value={days} onChange={setDays} />}
      </PageHeader>

      {timeline.isPending && <DashboardSkeleton />}
      {timeline.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load analytics. Check that the API is running, then reload.
        </p>
      )}
      {timeline.isSuccess && !data && <EmptyState />}

      {data && (
        <>
          <Docket data={data} payouts={payouts.data} />
          <Held data={data} payouts={payouts.data} />

          <Section
            id="earnings"
            title="Earnings"
            text="Everything earned so far against how much of the catalog is deployed, live and paying, and what each day added. Hover a day to see which templates earned."
          >
            <Card>
              <CardContent>
                <Earnings data={data} />
              </CardContent>
            </Card>
          </Section>

          <Section
            id="templates"
            title="Templates"
            text="Every template as a consignment to act on, its upgrades, then which ones reach people and which of those pay."
          >
            <TemplatesCard data={data} days={days} byTemplate={payouts.data?.byTemplate} />

            <div className="grid gap-x-8 border-t pt-2 lg:grid-cols-12">
              <Card className="lg:col-span-7">
                <CardHeader>
                  <CardTitle>Reach vs money</CardTitle>
                  <CardDescription>
                    Each template by its live projects and its last 30 days of kickback. Up and
                    left of a diagonal, each project pays more; far right and low is popular but
                    unpaid.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TemplateScatter templates={data.templates} payers={payers} />
                </CardContent>
              </Card>
              <Card className="max-lg:border-t lg:col-span-5 lg:border-l lg:pl-8">
                <CardHeader>
                  <CardTitle>From deploy to kickback</CardTitle>
                  <CardDescription>What Railway counts, widest first, across all templates</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <TemplateFunnel
                    templates={data.templates}
                    payers={payouts.data?.byTemplate.reduce((s, t) => s + t.payers, 0)}
                  />
                </CardContent>
              </Card>
            </div>
          </Section>
        </>
      )}
    </main>
  );
}

/** Every template, two ways: what it earns and how it is deployed, or what
 * it pins that has a newer release. Both are lists to act on, per template,
 * so they share one card and one place on the page. */
function TemplatesCard({
  data,
  days,
  byTemplate,
}: {
  data: TimelineResponse;
  days: RangeDays;
  byTemplate: PayoutTemplateTotal[] | undefined;
}) {
  const [view, setView] = useState<"templates" | "upgrades">("templates");
  const upgrades = useQuery(upgradesQuery);

  // Held names link to #t-<id> rows and the upgrades count to #upgrades;
  // switch to the view that holds the target, then bring it into view.
  useEffect(() => {
    const follow = () => {
      const hash = window.location.hash.slice(1);
      if (hash !== "upgrades" && !hash.startsWith("t-")) return;
      setView(hash === "upgrades" ? "upgrades" : "templates");
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ block: hash === "upgrades" ? "start" : "center" }),
      );
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const behind = upgrades.data ? behindTemplateCount(upgrades.data) : null;

  return (
    <Card id="upgrades" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>All templates</CardTitle>
        <CardDescription>
          {view === "templates"
            ? `New and earned are for the last ${days} days; payers and $/active for the last 30. Last deploy is when a new project last appeared; paid is the first and latest kickback.`
            : "Each template's pinned images, and the versions its Dockerfiles mark, against the newest release of the same shape. Behind first, most earning first."}
        </CardDescription>
        <CardAction role="group" aria-label="Templates view">
          <Button
            size="xs"
            aria-pressed={view === "templates"}
            variant={view === "templates" ? "secondary" : "ghost"}
            onClick={() => setView("templates")}
          >
            Earnings
          </Button>
          <Button
            size="xs"
            aria-pressed={view === "upgrades"}
            variant={view === "upgrades" ? "secondary" : "ghost"}
            onClick={() => setView("upgrades")}
          >
            Upgrades
            {behind != null && behind > 0 && (
              <span className="tabular-nums text-muted-foreground">{fmtNum(behind)}</span>
            )}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {view === "templates" ? (
          <TemplatesTable
            templates={data.templates}
            byTemplate={byTemplate}
            dates={data.points.map((p) => p.date)}
          />
        ) : (
          <UpgradeQueue />
        )}
      </CardContent>
    </Card>
  );
}

/** The docket header: today's takings, the range, the balance and whether
 * auto-withdraw will pay it, and the catalog. Each figure appears once. */
function Docket({
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
  const activeChange = first?.activeProjects != null ? activeNow - first.activeProjects : null;
  const since = points[0]?.date ?? "";
  const added = templates.filter((t) => t.publishedAt && dayKey(t.publishedAt) >= since).length;
  const earning = templates.filter((t) => t.earnedCents > 0).length;
  // A previous range that reaches back before the first kickback compares
  // against nothing: +48,000% is true and useless.
  const firstPaid = Math.min(...templates.map((t) => (t.firstPaidAt ? Date.parse(t.firstPaidAt) : Infinity)));
  const comparable = firstPaid <= dayDate(since).getTime() - w.days * 86_400_000;

  // The window ends today, so the last point is today's money so far.
  const today = points[points.length - 1];
  const yesterday = points[points.length - 2];
  const name = shortNames(templates.map((t) => t.name));
  const earnedToday = templates
    .map((t) => [name(t.name), t.activity.find((a) => a.date === today?.date)?.earnedCents ?? 0] as const)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  const balance = accounts.data?.availableBalance;
  const minimum = accounts.data?.minimumBalance ?? 10_000;
  const auto = withdraw.data;
  const autoAccount = auto && accounts.data?.accounts.find((a) => a.id === auto.withdrawalAccountId);

  return (
    <section
      aria-label="Docket"
      className="grid grid-cols-2 gap-px border bg-border lg:grid-cols-4 [&>*]:bg-background"
    >
      <DocketCell label="Today · UTC" value={fmtCents(today?.earnedCents ?? 0)}>
        {yesterday && <p>{fmtCents(yesterday.earnedCents)} yesterday</p>}
        <p className="line-clamp-2">
          {earnedToday.length === 0
            ? "Nothing yet today"
            : [
                ...earnedToday.slice(0, 3).map(([n, c]) => `${n} ${fmtCents(c)}`),
                ...(earnedToday.length > 3 ? [`+${earnedToday.length - 3} more`] : []),
              ].join(" · ")}
        </p>
      </DocketCell>

      <DocketCell label={`Last ${w.days} days`} value={fmtCents(w.earnedCents)}>
        <Delta
          pct={
            comparable && w.previousEarnedCents > 0
              ? ((w.earnedCents - w.previousEarnedCents) / w.previousEarnedCents) * 100
              : null
          }
          suffix={`on the previous ${w.days}`}
        />
        <p>
          {fmtCents(perDay)} a day · {fmtCents(lifetime)} lifetime
          {payouts ? `, ${fmtCents(payouts.totals.lifetimeCents)} paid out` : ""}
        </p>
      </DocketCell>

      <DocketCell
        label="Balance"
        value={accounts.isPending ? null : balance != null ? fmtCents(balance) : "—"}
      >
        {balance != null && (
          <p>
            {balance > minimum
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
        )}
        {accounts.isError && <p>Couldn&apos;t read the balance from Railway.</p>}
      </DocketCell>

      <DocketCell label="Templates" value={fmtNum(templates.length)}>
        {last?.published != null && last.published !== templates.length && (
          <p>
            {fmtNum(last.published)} published on Railway, {fmtNum(Math.abs(last.published - templates.length))}{" "}
            {last.published > templates.length ? "not in the list below" : "no longer published"}
          </p>
        )}
        <p>
          {fmtNum(activeNow)} active projects
          {activeChange != null && first && (
            <>
              {" "}
              <span className={activeChange >= 0 ? "text-(--viz-up)" : "text-(--viz-down)"}>
                ({activeChange >= 0 ? "+" : ""}
                {fmtNum(activeChange)} since {fmtDay(first.date)})
              </span>
            </>
          )}
        </p>
        <p>
          {fmtNum(runningNow)} running · {fmtNum(earning)} earned in {w.days} days · {fmtNum(added)} added
        </p>
      </DocketCell>
    </section>
  );
}

function DocketCell({
  label,
  value,
  children,
}: {
  label: string;
  /** null while loading. */
  value: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5 p-4 sm:px-5">
      <div className="text-sm font-semibold">{label}</div>
      {value == null ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <div className="text-[1.625rem] leading-none font-semibold tabular-nums sm:text-[2.125rem]">
          {value}
        </div>
      )}
      <div className="space-y-0.5 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

type HeldItem = { key: string; text: ReactNode };

/** The held tray: what needs you, named, each name a jump to its
 * consignment row; then chores and the next verifiable steps. Only facts the
 * data shows, never a recommendation. */
function Held({
  data,
  payouts,
}: {
  data: TimelineResponse;
  payouts: PayoutHistoryData | undefined;
}) {
  const upgrades = useQuery(upgradesQuery);
  const candidates = useQuery(candidatesQuery);
  const name = shortNames(data.templates.map((t) => t.name));
  const jump = (t: { templateId: string; name: string }) => (
    <a
      href={`#t-${t.templateId}`}
      className="font-semibold text-foreground underline decoration-(--viz-critical) decoration-1 hover:decoration-2"
    >
      {name(t.name)}
    </a>
  );
  const list = (nodes: ReactNode[]) =>
    nodes.flatMap((n, i) => (i === 0 ? [n] : [i === nodes.length - 1 ? " and " : ", ", n]));

  const held: HeldItem[] = [];
  if (Date.now() - Date.parse(data.sampledAt) > 24 * 3_600_000) {
    held.push({
      key: "stale",
      text: <>No snapshot since {fmtDay(data.sampledAt)}: the collector has stopped, so every figure below is old.</>,
    });
  }
  const failing = data.templates
    .filter((t) => t.activeProjects > 0 && t.health != null && t.health < 50)
    .sort((a, b) => (a.health ?? 0) - (b.health ?? 0));
  for (const t of failing) {
    held.push({
      key: `health-${t.templateId}`,
      text: (
        <>
          {jump(t)} deploy health {t.health?.toFixed(0)}%, {fmtNum(t.activeProjects)} active
        </>
      ),
    });
  }
  const atRisk = data.templates.filter((t) => !qualifiesForBonus(t));
  if (atRisk.length > 0) {
    held.push({
      key: "support",
      text: (
        <>
          {list([
            ...atRisk.slice(0, 5).map((t) => <span key={t.templateId}>{jump(t)}</span>),
            ...(atRisk.length > 5 ? [<span key="more">{fmtNum(atRisk.length - 5)} more</span>] : []),
          ])}{" "}
          {atRisk.length === 1 ? "is" : "are"} below the{" "}
          {SUPPORT_BONUS_THRESHOLD}% support-bonus line
        </>
      ),
    });
  }
  const copies = candidates.data?.copies ?? [];
  if (copies.length > 0) {
    held.push({
      key: "copies",
      text: (
        <Link to="/decide#copies" className="font-semibold text-foreground underline decoration-(--viz-critical)">
          {copies.length === 1
            ? "1 template by someone else builds"
            : `${fmtNum(copies.length)} templates by others build`}{" "}
          from our code
        </Link>
      ),
    });
  }

  const next: HeldItem[] = [];
  const behind = upgrades.data ? behindTemplateCount(upgrades.data) : 0;
  if (behind > 0) {
    next.push({
      key: "upgrades",
      text: (
        <a href="#upgrades" className="text-primary underline">
          {fmtNum(behind)} {behind === 1 ? "template" : "templates"} behind on upgrades
        </a>
      ),
    });
  }
  const shortlist = (candidates.data?.groups ?? []).filter((g) => g.status === "shortlist");
  if (shortlist.length > 0) {
    next.push({
      key: "shortlist",
      text: (
        <>
          Shortlisted to build:{" "}
          <Link to="/decide" className="text-primary underline">
            {shortlist.slice(0, 3).map((g) => shortName(g.leader.name)).join(", ")}
            {shortlist.length > 3 ? ` +${shortlist.length - 3} more` : ""}
          </Link>
        </>
      ),
    });
  }
  if (payouts && payouts.totals.pendingCount > 0) {
    next.push({
      key: "pending",
      text: (
        <Link to="/payouts" className="text-primary underline">
          {fmtCents(payouts.totals.pendingCents)} in flight across {fmtNum(payouts.totals.pendingCount)} pending{" "}
          {payouts.totals.pendingCount === 1 ? "payout" : "payouts"}
        </Link>
      ),
    });
  }

  return (
    <section aria-labelledby="held-title" aria-live="polite" className="bg-(--tray) px-4 py-3.5 sm:px-5">
      <div className="flex flex-col gap-x-6 gap-y-1.5 sm:flex-row sm:items-baseline">
        <h2
          id="held-title"
          className={cn(
            "shrink-0 text-sm font-bold tracking-[0.06em] uppercase",
            held.length > 0 ? "text-(--viz-critical)" : "text-(--viz-up)",
          )}
        >
          {held.length > 0 ? `Held · ${held.length}` : "Nothing held"}
        </h2>
        {held.length > 0 ? (
          <ul className="flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:flex-wrap">
            {held.map((h) => (
              <li key={h.key}>{h.text}</li>
            ))}
          </ul>
        ) : (
          <p>
            Every deployed template is over 50% deploy health and over the {SUPPORT_BONUS_THRESHOLD}%
            support-bonus line.
          </p>
        )}
      </div>
      {next.length > 0 && (
        <div className="mt-2 flex flex-col gap-x-6 gap-y-1 border-t border-foreground/15 pt-2 text-sm sm:flex-row sm:flex-wrap sm:items-baseline">
          <span className="font-semibold">Next</span>
          {next.map((n) => (
            <span key={n.key}>{n.text}</span>
          ))}
        </div>
      )}
    </section>
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
      <section className="grid grid-cols-2 gap-px border bg-border lg:grid-cols-4 [&>*]:bg-background">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 p-4 sm:px-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </section>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </>
  );
}
