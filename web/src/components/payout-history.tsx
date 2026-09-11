import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { PayoutHistoryChart } from "~/components/payout-history-chart";
import { Delta } from "~/components/delta";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtCents, fmtNum } from "~/lib/format";
import { type Payout, payoutHistoryQuery } from "~/queries/payouts";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function PayoutHistory({ days }: { days: number }) {
  const history = useQuery(payoutHistoryQuery(days));
  const data = history.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdrawals</CardTitle>
        <CardDescription>
          Cash and credits that left your Railway balance · last {days}d
        </CardDescription>
      </CardHeader>

      {history.isPending && (
        <CardContent className="space-y-3">
          <Skeleton className="h-64 w-full" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      )}

      {history.isError && (
        <CardContent>
          <p className="text-sm text-(--viz-critical)">
            Couldn&apos;t load payout history — check the server logs.
          </p>
        </CardContent>
      )}

      {data && data.totalRows === 0 && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No payouts recorded yet. Railway pays out once your balance clears{" "}
            {fmtCents(10000)}; the collector picks them up on each refresh.
          </p>
        </CardContent>
      )}

      {data && data.totalRows > 0 && (
        <div className="grid lg:grid-cols-12">
          <CardContent className="space-y-4 lg:col-span-7">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <WindowFigure days={days} data={data} />
              {data.totals.pendingCount > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground">In flight</div>
                  <div className="text-xl font-semibold">
                    {fmtCents(data.totals.pendingCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {data.totals.pendingCount} pending
                  </div>
                </div>
              )}
            </div>
            {data.window.count > 0 ? (
              <PayoutHistoryChart points={data.points} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No withdrawals in the last {days} days.
              </p>
            )}
          </CardContent>

          <CardContent className="overflow-x-auto lg:col-span-5 lg:border-l">
            <table className="w-full text-sm">
              <caption className="sr-only">
                The {data.payouts.length} most recent withdrawals, newest first
              </caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 pl-3 font-medium">Destination</th>
                  <th className="pb-2 pl-3 font-medium">Status</th>
                  <th className="pb-2 pl-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((p) => (
                  <PayoutRow key={p.id} payout={p} />
                ))}
              </tbody>
            </table>
            {data.totalRows > data.payouts.length && (
              <p className="pt-3 text-xs text-muted-foreground">
                Showing the {data.payouts.length} most recent of{" "}
                {fmtNum(data.totalRows)} withdrawals.
              </p>
            )}
          </CardContent>
        </div>
      )}
    </Card>
  );
}

function WindowFigure({
  days,
  data,
}: {
  days: number;
  data: { window: { totalCents: number; changePct: number | null; count: number } };
}) {
  const { totalCents, changePct, count } = data.window;
  return (
    <div>
      <div className="text-xs text-muted-foreground">This window</div>
      <div className="text-xl font-semibold">{fmtCents(totalCents)}</div>
      {changePct != null ? (
        <Delta pct={changePct} suffix={`vs previous ${days}d`} />
      ) : (
        <div className="text-xs text-muted-foreground">
          {count} {count === 1 ? "withdrawal" : "withdrawals"}
        </div>
      )}
    </div>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums">
        {dayFmt.format(new Date(payout.createdAt))}
      </td>
      <td className="py-2.5 pl-3 text-muted-foreground">{payout.destination}</td>
      <td className="py-2.5 pl-3">
        <PayoutStatus status={payout.status} />
      </td>
      <td className="whitespace-nowrap py-2.5 pl-3 text-right font-medium tabular-nums">
        {fmtCents(payout.amountCents)}
      </td>
    </tr>
  );
}

/** Status always ships as icon + word, never colour alone. */
function PayoutStatus({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  if (status === "PENDING") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Clock className="size-3.5" />
        {label}
      </span>
    );
  }
  if (status === "COMPLETED") {
    return (
      <span className="flex items-center gap-1 text-(--viz-up)">
        <CircleCheck className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-(--viz-critical)">
      <CircleAlert className="size-3.5" />
      {label}
    </span>
  );
}
