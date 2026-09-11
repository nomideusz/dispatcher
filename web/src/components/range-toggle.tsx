import { Button } from "~/components/ui/button";

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

export function RangeToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: RangeDays) => void;
}) {
  return (
    <div role="group" aria-label="Time range" className="flex gap-1">
      {RANGE_DAYS.map((days) => (
        <Button
          key={days}
          size="xs"
          variant={days === value ? "secondary" : "ghost"}
          onClick={() => onChange(days)}
        >
          {days}d
        </Button>
      ))}
    </div>
  );
}
