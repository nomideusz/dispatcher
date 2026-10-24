import type { ReactNode } from "react";
import { fmtUsd, type shortNames } from "~/lib/format";
import type { TimelineTemplate } from "~/queries/analytics";

/** Template size buckets: the question is whether to publish more
 * single-service templates or more stacks. */
export const GROUPS = [
  { label: "1 service", short: "1", color: "var(--chart-3)", has: (s: number) => s === 1 },
  { label: "2–3 services", short: "2–3", color: "var(--chart-5)", has: (s: number) => s >= 2 && s <= 3 },
  { label: "4+ services", short: "4+", color: "var(--chart-4)", has: (s: number) => s >= 4 },
] as const;
export const groupOf = (t: TimelineTemplate) => GROUPS.findIndex((g) => g.has(t.services)) as 0 | 1 | 2;

export function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export const tick = { tickLine: false, axisLine: false } as const;
export const cursor = { stroke: "var(--border)", fill: "var(--foreground)", fillOpacity: 0.05 };
/** Under a dollar a day reads better in cents. */
export const perDay = (v: number) => (v >= 1 ? fmtUsd(v) : `${Math.round(v * 100)}¢`);

export type Names = ReturnType<typeof shortNames>;
type TipItem = { name?: string | number; value?: unknown; color?: string; dataKey?: unknown };

/** One tooltip for every chart: the day (or day count), each series
 * formatted by the chart that owns it, and optionally what earned. */
export function Tip({
  active,
  payload,
  label,
  title,
  format,
  extra,
  footer,
}: {
  active?: boolean;
  payload?: readonly TipItem[];
  label?: string | number;
  title: (label: string | number) => string;
  format: (v: number, key: string) => string;
  extra?: (label: string | number) => [string, number][];
  footer?: (label: string | number) => ReactNode;
}) {
  if (!active || !payload?.length || label == null) return null;
  const top = extra?.(label) ?? [];
  const foot = footer?.(label);
  return (
    <div className="min-w-48 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
      <div className="mb-1 font-medium">{title(label)}</div>
      {payload
        .filter((p) => typeof p.value === "number")
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular-nums">{format(p.value as number, String(p.dataKey))}</span>
          </div>
        ))}
      {top.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t pt-1.5 text-muted-foreground">
          {top.slice(0, 4).map(([n, v], i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="max-w-40 truncate">{n}</span>
              <span className="tabular-nums">{fmtUsd(v)}</span>
            </div>
          ))}
          {top.length > 4 && <div>+{top.length - 4} more</div>}
        </div>
      )}
      {foot && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{foot}</div>}
    </div>
  );
}

/** Legend. An item with a value reads as a figure: label, then the number. */
export function Key({
  items,
}: {
  items: { label: string; color: string; line?: boolean; dashed?: boolean; value?: ReactNode }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((k) => (
        <span key={k.label} className="flex items-center gap-1.5">
          <span
            className={k.line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"}
            style={
              k.dashed
                ? { background: `repeating-linear-gradient(90deg, ${k.color} 0 3px, transparent 3px 5px)` }
                : { background: k.color }
            }
          />
          {k.label}
          {k.value != null && <span className="font-medium text-foreground tabular-nums">{k.value}</span>}
        </span>
      ))}
    </div>
  );
}
