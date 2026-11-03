import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { cursor, GROUPS, groupOf, Key, perDay, Tip, tick } from "~/components/chart-kit";
import { ChartContainer } from "~/components/ui/chart";
import { fmtDay, fmtUsd, fmtUsdTick, shortNames } from "~/lib/format";
import type { TimelineResponse } from "~/queries/analytics";

const AVG = "var(--muted-foreground)";

type Row = {
  date: string;
  earned: number;
  avg7: number | null;
  e0: number; e1: number; e2: number;
};

function useEarnings(data: TimelineResponse) {
  return useMemo(() => {
    const { points, templates } = data;
    const index = new Map(points.map((p, i) => [p.date, i]));
    const rows: Row[] = points.map((p) => ({
      date: p.date,
      earned: p.earnedCents / 100,
      avg7: null,
      e0: 0, e1: 0, e2: 0,
    }));
    const name = shortNames(templates.map((t) => t.name));
    const earners: [string, number][][] = points.map(() => []);
    for (const t of templates) {
      const g = groupOf(t);
      for (const a of t.activity) {
        const i = index.get(a.date);
        if (i == null || a.earnedCents <= 0) continue;
        rows[i][`e${g}`] += a.earnedCents / 100;
        earners[i].push([name(t.name), a.earnedCents / 100]);
      }
    }
    for (const e of earners) e.sort((a, b) => b[1] - a[1]);
    rows.forEach((r, i) => {
      if (i >= 6) r.avg7 = rows.slice(i - 6, i + 1).reduce((s, x) => s + x.earned, 0) / 7;
    });
    return { rows, earners };
  }, [data]);
}

/** What each day added, by template size. */
export function Earnings({ data }: { data: TimelineResponse }) {
  const { rows, earners } = useEarnings(data);
  const dayIndex = new Map(rows.map((r, i) => [r.date, i]));
  const latestAvg = rows[rows.length - 1]?.avg7;

  return (
    <section className="space-y-2">
      <Key
        items={[
          ...GROUPS.map((g) => ({ label: g.label, color: g.color })),
          {
            label: "7-day average",
            color: AVG,
            line: true,
            value: latestAvg != null ? `${perDay(latestAvg)} a day` : undefined,
          },
        ]}
      />
      <ChartContainer config={{}} className="aspect-auto h-52 w-full lg:h-72">
        <ComposedChart data={rows} margin={{ top: 6, right: 0, left: 0, bottom: 4 }} aria-label="Kickback per day, by template size">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" scale="band" {...tick} tickMargin={8} minTickGap={40} tickFormatter={fmtDay} />
          <YAxis width={52} {...tick} tickCount={3} tickFormatter={fmtUsdTick} />
          <Tooltip
            isAnimationActive={false}
            cursor={cursor}
            content={(p) => (
              <Tip
                {...p}
                title={(l) => fmtDay(String(l))}
                format={(v) => fmtUsd(v)}
                extra={(l) => earners[dayIndex.get(String(l)) ?? -1] ?? []}
              />
            )}
          />
          {GROUPS.map((g, i) => (
            <Bar key={g.label} name={g.label} dataKey={`e${i}`} stackId="k" fill={g.color} maxBarSize={22} isAnimationActive={false} />
          ))}
          <Line name="7-day average" dataKey="avg7" stroke={AVG} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
    </section>
  );
}
