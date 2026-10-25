import { useSearchParams } from "react-router";
import { cn } from "~/lib/utils";

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

/** The page's range, kept in the URL (?days=7) so a link or reload keeps it;
 * 30 days is the default and stays out of the URL. */
export function useRangeDays(): [RangeDays, (days: RangeDays) => void] {
  const [params, setParams] = useSearchParams();
  const n = Number(params.get("days"));
  const days = RANGE_DAYS.find((d) => d === n) ?? 30;
  const setDays = (d: RangeDays) =>
    setParams(
      (p) => {
        if (d === 30) p.delete("days");
        else p.set("days", String(d));
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  return [days, setDays];
}

/** Segmented control for a small fixed set of ranges. */
export function RangeToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: RangeDays) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex border bg-muted p-0.5"
    >
      {RANGE_DAYS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={days === value}
          onClick={() => onChange(days)}
          className={cn(
            "h-7 min-w-11 px-2 text-xs font-medium tabular-nums pointer-coarse:h-9 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            days === value
              ? "bg-background text-foreground ring-1 ring-foreground/25"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}
