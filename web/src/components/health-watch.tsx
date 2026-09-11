import { fmtUsd } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  qualifiesForBonus,
  SUPPORT_BONUS_THRESHOLD,
  supportHealthOf,
  type TemplateAnalytics,
} from "~/queries/analytics";

function healthParts(template: TemplateAnalytics): string {
  const parts = [];
  if (template.supportSolved != null) {
    parts.push(`${template.supportSolved.toFixed(0)}% solved`);
  }
  if (template.supportCsat != null) {
    parts.push(`${template.supportCsat.toFixed(0)}% CSAT`);
  }
  return parts.length > 0 ? parts.join(" · ") : "no support threads to grade";
}

function HealthBar({ value }: { value: number }) {
  const atRisk = value < SUPPORT_BONUS_THRESHOLD;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full",
          atRisk ? "bg-(--viz-critical)" : "bg-(--viz-up)",
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
      <div
        className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/35"
        style={{ left: `${SUPPORT_BONUS_THRESHOLD}%` }}
        title={`${SUPPORT_BONUS_THRESHOLD}% support-bonus line`}
      />
    </div>
  );
}

export function HealthWatch({ templates }: { templates: TemplateAnalytics[] }) {
  const atRisk = templates
    .filter((t) => !qualifiesForBonus(t))
    .sort((a, b) => supportHealthOf(a) - supportHealthOf(b));
  const qualifying = templates.length - atRisk.length;

  const watch =
    atRisk.length > 0
      ? atRisk
      : [...templates]
          .sort((a, b) => supportHealthOf(a) - supportHealthOf(b))
          .slice(0, 5);
  const showList =
    atRisk.length > 0 || watch.some((t) => supportHealthOf(t) < 90);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {atRisk.length > 0 ? (
          <>
            <span className="font-medium text-(--viz-critical)">
              {atRisk.length} {atRisk.length === 1 ? "template" : "templates"}
            </span>{" "}
            below the {SUPPORT_BONUS_THRESHOLD}% line — the +10% support bonus
            is off.
          </>
        ) : (
          <>
            All {qualifying} {qualifying === 1 ? "template" : "templates"}{" "}
            qualify for the +10% support bonus.
          </>
        )}
      </p>

      {showList && (
        <ul className="space-y-3">
          {watch.map((t) => {
            const health = supportHealthOf(t);
            const atRiskRow = !qualifiesForBonus(t);
            return (
              <li key={t.templateId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {healthParts(t)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        atRiskRow ? "text-(--viz-critical)" : "text-(--viz-up)",
                      )}
                    >
                      {health.toFixed(0)}%
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {fmtUsd(t.totalPayout)}
                    </div>
                  </div>
                </div>
                <HealthBar value={health} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
