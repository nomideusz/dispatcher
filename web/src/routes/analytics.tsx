import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Delta } from "~/components/delta";
import { PayoutChart } from "~/components/payout-chart";
import { PayoutHistory } from "~/components/payout-history";
import { RangeToggle, type RangeDays } from "~/components/range-toggle";
import { TemplateMix } from "~/components/template-mix";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtAgo, fmtCents, fmtNum, fmtUsd } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  payoutSeriesQuery,
  qualifiesForBonus,
  summaryQuery,
  type TemplateAnalytics,
  templateAnalyticsQuery,
  useRefreshAnalytics,
} from "~/queries/analytics";
import { payoutHistoryQuery } from "~/queries/payouts";
import {
  accountLabel,
  scheduleDescription,
  type WithdrawalAccount,
  withdrawAccountsQuery,
  withdrawSettingsQuery,
} from "~/queries/withdraw";
import type { Route } from "./+types/analytics";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Dispatcher" }];
}

export default function Analytics() {
  const [days, setDays] = useState<RangeDays>(30);
  const summary = useQuery(summaryQuery);
  const series = useQuery(payoutSeriesQuery(days));
  const templates = useQuery(templateAnalyticsQuery);
  const payouts = useQuery(payoutHistoryQuery(days));
  const accounts = useQuery(withdrawAccountsQuery);
  const withdraw = useQuery(withdrawSettingsQuery);

  const hasData = summary.data != null;
  const comparedAgo =
    summary.data?.comparedTo != null
      ? fmtAgo(summary.data.comparedTo, summary.data.sampledAt)
      : null;
  const list = templates.data?.templates ?? [];

  return (
    <main className="viz shell space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">Kickback</h1>
          <p className="text-sm text-muted-foreground">
            {summary.data
              ? [
                  list.length > 0
                    ? `${fmtNum(list.length)} ${list.length === 1 ? "template" : "templates"}`
                    : null,
                  `${fmtNum(summary.data.activeProjects.current)} active`,
                  summary.data.runningInstances
                    ? `${fmtNum(summary.data.runningInstances.current)} running`
                    : null,
                  `sampled ${fmtAgo(summary.data.sampledAt, new Date().toISOString())} ago`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Earnings, health, and withdrawals for the templates you publish"}
          </p>
        </div>
        {hasData && <RangeToggle value={days} onChange={setDays} />}
      </header>

      {summary.isPending && <DashboardSkeleton />}
      {summary.isError && (
        <p className="text-sm text-(--viz-critical)">
          Failed to load analytics — is the API up?
        </p>
      )}
      {summary.isSuccess && !hasData && <EmptyState />}

      {summary.data && (
        <>
          <MoneyBand
            kickback={summary.data.totalPayout.current}
            kickbackPct={summary.data.totalPayout.changePct}
            comparedAgo={comparedAgo}
            availableCents={accounts.data?.availableBalance}
            availablePending={accounts.isPending}
            withdrawnCents={payouts.data?.totals.lifetimeCents}
            withdrawnSince={payouts.data?.totals.firstPayoutAt ?? null}
            withdrawnPending={payouts.isPending}
            autoEnabled={withdraw.data?.enabled}
            autoSchedule={withdraw.data?.schedule}
            autoAccount={
              withdraw.data && accounts.data
                ? accounts.data.accounts.find(
                    (a) => a.id === withdraw.data.withdrawalAccountId,
                  )
                : undefined
            }
            autoPending={withdraw.isPending}
          />

          <Attention
            templates={list}
            pendingCount={payouts.data?.totals.pendingCount ?? 0}
            pendingCents={payouts.data?.totals.pendingCents ?? 0}
            autoOff={withdraw.data != null && !withdraw.data.enabled}
            withdrawable={
              accounts.data != null &&
              accounts.data.availableBalance >= accounts.data.minimumBalance &&
              accounts.data.availableBalance > 0
            }
          />

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>Added this window</CardTitle>
                <CardDescription>
                  Kickback accrued since the start of the last {days}d, stacked
                  by template. Bars are published templates; the dashed line
                  is their services.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {series.isPending ? (
                  <Skeleton className="h-64 w-full" />
                ) : series.data && series.data.points.length > 0 ? (
                  <PayoutChart data={series.data} />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No samples in this range yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Mix now</CardTitle>
                <CardDescription>Share of accrued kickback</CardDescription>
              </CardHeader>
              <CardContent>
                {templates.isPending ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : (
                  <TemplateMix templates={list} />
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-12">
              <CardHeader>
                <CardTitle>Templates</CardTitle>
                <CardDescription>
                  {comparedAgo
                    ? `Latest snapshot · kickback vs ${comparedAgo} ago`
                    : "Latest snapshot"}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[32rem] overflow-auto">
                {templates.isPending ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : list.length > 0 ? (
                  <EarnersTable templates={list} />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No templates in the latest snapshot.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <PayoutHistory />
        </>
      )}
    </main>
  );
}

function MoneyBand({
  kickback,
  kickbackPct,
  comparedAgo,
  availableCents,
  availablePending,
  withdrawnCents,
  withdrawnSince,
  withdrawnPending,
  autoEnabled,
  autoSchedule,
  autoAccount,
  autoPending,
}: {
  kickback: number;
  kickbackPct: number | null;
  comparedAgo: string | null;
  availableCents: number | undefined;
  availablePending: boolean;
  withdrawnCents: number | undefined;
  withdrawnSince: string | null;
  withdrawnPending: boolean;
  autoEnabled: boolean | undefined;
  autoSchedule: string | undefined;
  autoAccount: WithdrawalAccount | undefined;
  autoPending: boolean;
}) {
  const monthLong = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid-cols-4">
      <BandCell
        label="Ready to withdraw"
        className="border-b border-r lg:border-b-0"
      >
        {availablePending ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <BandValue
            value={availableCents != null ? fmtCents(availableCents) : "—"}
          />
        )}
        <p className="text-xs text-muted-foreground">Railway balance</p>
      </BandCell>

      <BandCell label="Accrued kickback" className="border-b lg:border-r lg:border-b-0">
        <BandValue value={fmtUsd(kickback)} />
        <Delta
          pct={kickbackPct}
          suffix={comparedAgo ? `vs ${comparedAgo} ago` : undefined}
        />
      </BandCell>

      <BandCell label="Withdrawn" className="border-r">
        {withdrawnPending ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <BandValue
            value={withdrawnCents != null ? fmtCents(withdrawnCents) : "—"}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {withdrawnSince
            ? `since ${monthLong.format(new Date(withdrawnSince))}`
            : "lifetime"}
        </p>
      </BandCell>

      <BandCell label="Auto-withdraw">
        {autoPending ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-xl font-semibold">{autoEnabled ? "On" : "Off"}</div>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {autoEnabled && autoSchedule
            ? [
                scheduleDescription(autoSchedule),
                autoAccount ? accountLabel(autoAccount) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Withdrawals are manual"}
        </p>
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
  return (
    <div
      className={`font-semibold tabular-nums ${
        value.length > 13 ? "text-base" : value.length > 10 ? "text-xl" : "text-2xl"
      }`}
    >
      {value}
    </div>
  );
}

function Attention({
  templates,
  pendingCount,
  pendingCents,
  autoOff,
  withdrawable,
}: {
  templates: TemplateAnalytics[];
  pendingCount: number;
  pendingCents: number;
  autoOff: boolean;
  withdrawable: boolean;
}) {
  const atRisk = templates.filter((t) => !qualifiesForBonus(t)).length;
  const items: { key: string; tone: "critical" | "muted"; text: string }[] = [];

  if (atRisk > 0) {
    items.push({
      key: "health",
      tone: "critical",
      text: `${atRisk} ${atRisk === 1 ? "template is" : "templates are"} below the 80% support-bonus line`,
    });
  }
  if (pendingCount > 0) {
    items.push({
      key: "pending",
      tone: "muted",
      text: `${fmtCents(pendingCents)} in flight · ${pendingCount} pending`,
    });
  }
  if (autoOff && withdrawable) {
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

function EarnersTable({ templates }: { templates: TemplateAnalytics[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="pb-2 font-medium">Template</th>
          <th className="pb-2 pl-3 text-right font-medium">Active</th>
          <th className="pb-2 pl-3 text-right font-medium">Running</th>
          <th className="pb-2 pl-3 text-right font-medium">Support</th>
          <th className="pb-2 pl-3 text-right font-medium">Deploy</th>
          <th className="pb-2 pl-3 text-right font-medium">Kickback</th>
          <th className="pb-2 pl-3 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr
            key={t.templateId}
            className="border-b border-border/50 last:border-0"
          >
            <td className="py-2.5 pr-4">
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground">
                {t.status.toLowerCase()}
                {t.projects > 0 ? ` · ${fmtNum(t.projects)} projects` : ""}
              </div>
            </td>
            <td className="py-2.5 pl-3 text-right tabular-nums">
              {fmtNum(t.activeProjects)}
            </td>
            <td className="py-2.5 pl-3 text-right tabular-nums">
              {t.runningInstances == null ? "—" : fmtNum(t.runningInstances)}
            </td>
            <td
              className={`py-2.5 pl-3 text-right tabular-nums ${
                (t.supportHealth ?? 100) >= 80
                  ? "text-(--viz-up)"
                  : "text-(--viz-critical)"
              }`}
            >
              {(t.supportHealth ?? 100).toFixed(0)}%
            </td>
            <td className="py-2.5 pl-3 text-right tabular-nums">
              {t.health == null ? (
                "—"
              ) : (
                <span
                  className={
                    t.health >= 80
                      ? "text-(--viz-up)"
                      : t.health < 50
                        ? "text-(--viz-critical)"
                        : undefined
                  }
                >
                  {t.health.toFixed(0)}%
                </span>
              )}
            </td>
            <td className="whitespace-nowrap py-2.5 pl-3 text-right font-medium tabular-nums">
              {fmtUsd(t.totalPayout)}
            </td>
            <td className="py-2.5 pl-3">
              <span className="flex justify-end">
                <Delta pct={t.payoutChangePct} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      <section className="grid grid-cols-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader>
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
