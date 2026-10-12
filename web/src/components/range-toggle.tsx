import { cn } from "~/lib/utils";

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

/** Segmented control, Railway's pattern for a small fixed set of ranges. */
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
      className="inline-flex rounded-lg bg-muted p-0.5 ring-1 ring-foreground/10"
    >
      {RANGE_DAYS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={days === value}
          onClick={() => onChange(days)}
          className={cn(
            "h-6 min-w-10 rounded-md px-2 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            days === value
              ? "bg-card text-foreground ring-1 ring-foreground/10"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}
