import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fmtSignedPct } from "~/lib/format";

export function Delta({
  pct,
  suffix,
}: {
  pct: number | null | undefined;
  suffix?: string;
}) {
  if (pct == null) {
    return (
      <span className="text-xs text-muted-foreground">
        {suffix ? `no comparison yet` : "—"}
      </span>
    );
  }
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-1 text-xs">
      <span
        className={`flex items-center gap-0.5 font-medium ${
          up ? "text-(--viz-up)" : "text-(--viz-down)"
        }`}
      >
        {up ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <ArrowDownRight className="size-3.5" />
        )}
        {fmtSignedPct(pct)}
      </span>
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </span>
  );
}
