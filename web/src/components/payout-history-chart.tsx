import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { fmtCents, fmtNum, fmtUsdTick } from "~/lib/format";
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
 * Catalog size shares the time axis, not the money scale. Bars are published
 * templates; the dashed line is the services those templates define. */
export function PayoutHistoryChart({ points }: { points: PayoutPoint[] }) {
  const hasCredits = points.some((p) => p.creditsCents > 0);
  const hasCatalog = points.some((p) => p.published > 0 || p.services > 0);
  const lastMoneyIndex = hasCredits ? 1 : 0;

  const chartConfig = {
    cashCents: { label: "Cash", color: "var(--chart-1)" },
    creditsCents: { label: "Railway credits", color: "var(--chart-2)" },
    published: { label: "Published templates", color: "var(--chart-other)" },
    services: { label: "Services", color: "var(--chart-3)" },
  } satisfies ChartConfig;

  const peak = Math.max(
    0,
    ...points.map((p) => p.cashCents + (hasCredits ? p.creditsCents : 0)),
  );
  const countPeak = Math.max(
    0,
    ...points.map((p) => Math.max(p.published, p.services)),
  );
  // Size the gutter to the widest tick so full dollar amounts never clip.
  const yAxisWidth = Math.max(56, fmtUsdTick(peak / 100).length * 7 + 14);
  const countAxisWidth = Math.max(36, fmtNum(countPeak).length * 7 + 14);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <ComposedChart
        accessibilityLayer
        data={points}
        margin={{ top: 8, right: hasCatalog ? 8 : 12 }}
      >
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
          yAxisId="money"
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          domain={[0, "auto"]}
          tickFormatter={(cents: number) => fmtUsdTick(cents / 100)}
        />
        {hasCatalog && (
          <YAxis
            yAxisId="count"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={countAxisWidth}
            domain={[0, "auto"]}
            tickFormatter={(n: number) => fmtNum(n)}
          />
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                fullFmt.format(dayDate(payload?.[0]?.payload?.date ?? ""))
              }
              formatter={(value, name, item, index) => {
                const isCount = name === "published" || name === "services";
                const isBar = name === "published";
                return (
                  <>
                    <div
                      className={`h-2.5 w-1 shrink-0 rounded-[2px] ${name === "services" ? "border border-current bg-transparent" : ""}`}
                      style={
                        name === "services"
                          ? { color: item.color, borderStyle: "dashed" }
                          : { background: item.color }
                      }
                    />
                    <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ??
                          name}
                      </span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {isCount
                          ? fmtNum(Number(value))
                          : fmtCents(Number(value))}
                      </span>
                    </div>
                    {index === lastMoneyIndex && !isCount && !isBar && (
                      <div className="mt-0.5 flex basis-full items-center justify-between gap-4 border-t border-border/50 pt-1.5 leading-none">
                        <span className="text-muted-foreground">
                          {item.payload.count}{" "}
                          {item.payload.count === 1 ? "payout" : "payouts"} so
                          far
                        </span>
                        {hasCredits && (
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {fmtCents(
                              item.payload.cashCents +
                                item.payload.creditsCents,
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                );
              }}
            />
          }
        />
        {hasCatalog && (
          <Bar
            yAxisId="count"
            dataKey="published"
            fill="var(--color-published)"
            fillOpacity={0.4}
            maxBarSize={14}
            radius={[2, 2, 0, 0]}
          />
        )}
        <Line
          yAxisId="money"
          dataKey="cashCents"
          type="monotone"
          stroke="var(--color-cashCents)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
        />
        {hasCredits && (
          <Line
            yAxisId="money"
            dataKey="creditsCents"
            type="monotone"
            stroke="var(--color-creditsCents)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          />
        )}
        {hasCatalog && (
          <Line
            yAxisId="count"
            dataKey="services"
            type="stepAfter"
            stroke="var(--color-services)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          />
        )}
        {(hasCredits || hasCatalog) && (
          <ChartLegend content={<ChartLegendContent />} />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}
