import { fmtUsd } from "~/lib/format";
import type { TemplateAnalytics } from "~/queries/analytics";

function seriesColor(index: number): string {
  return `var(--chart-${(index % 5) + 1})`;
}

/** Current kickback mix — share of accrued earnings, not a second time series. */
export function TemplateMix({ templates }: { templates: TemplateAnalytics[] }) {
  const ranked = [...templates]
    .filter((t) => t.totalPayout > 0)
    .sort((a, b) => b.totalPayout - a.totalPayout);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  const restTotal = rest.reduce((sum, t) => sum + t.totalPayout, 0);
  const rows = [
    ...top.map((t, i) => ({
      key: t.templateId,
      name: t.name,
      value: t.totalPayout,
      color: seriesColor(i),
    })),
    ...(restTotal > 0
      ? [
          {
            key: "other",
            name: `Other · ${rest.length}`,
            value: restTotal,
            color: "var(--chart-other)",
          },
        ]
      : []),
  ];
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (total <= 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No kickback recorded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = (row.value / total) * 100;
        return (
          <li key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {share.toFixed(0)}%
                <span className="ml-2 text-foreground">{fmtUsd(row.value)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(share, 1.5)}%`, background: row.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
