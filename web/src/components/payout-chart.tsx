import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { fmtUsd, fmtUsdTick } from "~/lib/format";
import type { PayoutSeriesResponse } from "~/queries/analytics";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const fullFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Series color = slot order (--chart-1..5, validated categorical order);
// the "Other" fold always wears the neutral gray, never a series hue.
function seriesColor(key: string, index: number): string {
  return key === "other" ? "var(--chart-other)" : `var(--chart-${index + 1})`;
}

export function PayoutChart({ data }: { data: PayoutSeriesResponse }) {
  const { series, points } = data;
  const origin = points[0]?.values ?? {};

  const chartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.name, color: seriesColor(s.key, i) }]),
  ) satisfies ChartConfig;

  // Lifetime totals hide the window. Plot what each template added since
  // the first sample so 7d/30d/90d actually changes the shape.
  const rows: Record<string, number | string>[] = points.map((p) => ({
    sampledAt: p.sampledAt,
    ...Object.fromEntries(
      series.map((s) => [
        s.key,
        Math.max(0, (p.values[s.key] ?? 0) - (origin[s.key] ?? 0)),
      ]),
    ),
  }));
  const stackTotal = (row: Record<string, unknown>) =>
    series.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0);

  const maxTotal = Math.max(0, ...rows.map(stackTotal));
  const yAxisWidth = Math.max(56, fmtUsdTick(maxTotal * 1.15).length * 7 + 14);

  const first = points[0];
  const last = points[points.length - 1];
  const spansDays =
    points.length > 1 &&
    new Date(last.sampledAt).getTime() - new Date(first.sampledAt).getTime() >
      3 * 24 * 60 * 60 * 1000;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <AreaChart data={rows} margin={{ top: 8, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="sampledAt"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={(v: string) =>
            (spansDays ? dayFmt : timeFmt).format(new Date(v))
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          domain={[0, "auto"]}
          tickFormatter={(v: number) => fmtUsdTick(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label, payload) =>
                fullFmt.format(
                  new Date(payload?.[0]?.payload?.sampledAt ?? String(label)),
                )
              }
              formatter={(value, name, item, index) => (
                <>
                  <div
                    className="h-2.5 w-1 shrink-0 rounded-[2px]"
                    style={{ background: item.color }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">
                      {chartConfig[name as string]?.label ?? name}
                    </span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {fmtUsd(Number(value))}
                    </span>
                  </div>
                  {index === series.length - 1 && series.length > 1 && (
                    <div className="mt-0.5 flex basis-full items-center justify-between gap-4 border-t border-border/50 pt-1.5 leading-none">
                      <span className="text-muted-foreground">Added</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {fmtUsd(stackTotal(item.payload))}
                      </span>
                    </div>
                  )}
                </>
              )}
            />
          }
        />
        {series.map((s, i) => (
          <Area
            key={s.key}
            dataKey={s.key}
            stackId="payout"
            type="monotone"
            stroke={seriesColor(s.key, i)}
            strokeWidth={2}
            fill={seriesColor(s.key, i)}
            fillOpacity={0.22}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          />
        ))}
        {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
      </AreaChart>
    </ChartContainer>
  );
}
