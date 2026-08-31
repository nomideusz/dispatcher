import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { fmtCents, fmtUsdTick } from "~/lib/format";
import type { PayoutPoint } from "~/queries/payouts";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-08-14" is a UTC day, so parse it as UTC midnight — parsing it locally
 * would slide a westward timezone back a day. */
function dayDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Cumulative payouts across the selected window: each point is everything
 * paid out from the start of the range up to that day, so the line only ever
 * climbs and a payout-free stretch reads as a plateau rather than a drop.
 *
 * Deliberately one y-scale. Overlaying lifetime-to-date on the same plot would
 * need a second axis, and the alignment between two scales is arbitrary enough
 * to invent a trend — the lifetime figure is a stat beside the chart instead. */
export function PayoutHistoryChart({ points }: { points: PayoutPoint[] }) {
  const hasCredits = points.some((p) => p.creditsCents > 0);

  const chartConfig = {
    cashCents: { label: "Cash", color: "var(--chart-1)" },
    creditsCents: { label: "Railway credits", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const peak = Math.max(
    0,
    ...points.map((p) => p.cashCents + (hasCredits ? p.creditsCents : 0)),
  );
  // Size the gutter to the widest tick so full dollar amounts never clip.
  const yAxisWidth = Math.max(56, fmtUsdTick(peak / 100).length * 7 + 14);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <LineChart accessibilityLayer data={points} margin={{ top: 8, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={(date: string) => dayFmt.format(dayDate(date))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          domain={[0, "auto"]}
          tickFormatter={(cents: number) => fmtUsdTick(cents / 100)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                fullFmt.format(dayDate(payload?.[0]?.payload?.date ?? ""))
              }
              formatter={(value, name, item, index) => (
                <>
                  <div
                    className="h-2.5 w-1 shrink-0 rounded-[2px]"
                    style={{ background: item.color }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">
                      {chartConfig[name as keyof typeof chartConfig]?.label ??
                        name}
                    </span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {fmtCents(Number(value))}
                    </span>
                  </div>
                  {/* Close the last row with what the running total is made of:
                      one big payout and six small ones read identically from
                      the line alone. */}
                  {index === (hasCredits ? 1 : 0) && (
                    <div className="mt-0.5 flex basis-full items-center justify-between gap-4 border-t border-border/50 pt-1.5 leading-none">
                      <span className="text-muted-foreground">
                        {item.payload.count}{" "}
                        {item.payload.count === 1 ? "payout" : "payouts"} so far
                      </span>
                      {hasCredits && (
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {fmtCents(
                            item.payload.cashCents + item.payload.creditsCents,
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            />
          }
        />
        <Line
          dataKey="cashCents"
          type="monotone"
          stroke="var(--color-cashCents)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
        />
        {hasCredits && (
          <Line
            dataKey="creditsCents"
            type="monotone"
            stroke="var(--color-creditsCents)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          />
        )}
        {hasCredits && <ChartLegend content={<ChartLegendContent />} />}
      </LineChart>
    </ChartContainer>
  );
}
