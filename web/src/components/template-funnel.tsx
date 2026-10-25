import { ChevronRight } from "lucide-react";
import { fmtNum, fmtUsd } from "~/lib/format";
import type { TimelineTemplate } from "~/queries/analytics";

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

/** Railway's counts from widest to narrowest, each with what it actually
 * counts — the words overlap ("Active" means two different things), so the
 * definition sits next to the number. */
export function TemplateFunnel({
  templates,
  payers,
}: {
  templates: TimelineTemplate[];
  /** Paying deployers over the trailing 30 days; undefined while loading. */
  payers: number | undefined;
}) {
  const deployments = sum(templates.map((t) => t.deployments));
  const projects = sum(templates.map((t) => t.projects));
  const active = sum(templates.map((t) => t.activeProjects));
  const running = sum(templates.map((t) => t.running));
  const earned = sum(templates.map((t) => t.earned30d));

  const stages = [
    {
      label: "Deployments",
      value: deployments,
      color: "var(--chart-other)",
      of: null,
      text: "Every deploy of your templates, including your own tests and deploys into existing projects. It never goes down.",
    },
    {
      label: "Projects",
      value: projects,
      color: "var(--chart-3)",
      of: pct(projects, deployments) + " of deployments",
      text: "Projects other people created from your templates, all time. Railway's template page calls this “Total deploys”.",
    },
    {
      label: "Active projects",
      value: active,
      color: "var(--chart-3)",
      of: pct(active, projects) + " of projects",
      text: "Those projects still live today. A deleted project leaves this count but stays in Projects.",
    },
    {
      label: "Paying",
      value: payers,
      color: "var(--chart-1)",
      of: payers != null ? pct(payers, active) + " of active" : null,
      text: "Deployers whose invoice paid you kickback in the last 30 days. Kickback is 15% of what they pay, +10% while support health is 80% or more.",
    },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <ol className="space-y-3">
        {stages.map((s) => (
          <li key={s.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="flex items-baseline gap-2">
                {s.of && <span className="text-xs text-muted-foreground">{s.of}</span>}
                <span className="font-semibold tabular-nums">
                  {s.value == null ? "—" : fmtNum(s.value)}
                </span>
              </span>
            </div>
            <div className="h-2 bg-muted">
              <div
                className="h-full"
                style={{
                  width: `${deployments > 0 ? Math.max(1, ((s.value ?? 0) / deployments) * 100) : 0}%`,
                  background: s.color,
                }}
              />
            </div>
          </li>
        ))}
      </ol>

      <p className="border-t pt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmtUsd(earned)}</span> kickback in
        Railway&apos;s 30-day count (the docket adds up our hourly samples, so it can differ a
        little): <span className="text-foreground">{active > 0 ? fmtUsd(earned / active) : "—"}</span>{" "}
        per active project
        {payers ? (
          <>
            , <span className="text-foreground">{fmtUsd(earned / payers)}</span> per payer
          </>
        ) : null}
        . <span className="text-foreground">{fmtNum(running)}</span> service instances running.
      </p>

      {/* The definitions matter once, then they are noise on a page read daily. */}
      <details className="group mt-auto text-xs text-muted-foreground">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm font-medium text-foreground outline-none select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          What each count means
        </summary>
        <dl className="mt-2 space-y-2">
          {stages.map((s) => (
            <div key={s.label}>
              <dt className="font-medium text-foreground">{s.label}</dt>
              <dd>{s.text}</dd>
            </div>
          ))}
          <div>
            <dt className="font-medium text-foreground">Running · {fmtNum(running)}</dt>
            <dd>
              Railway&apos;s metrics page calls this “Active”, but it counts running services, not
              projects. A four-service project counts up to four; a crashed or removed service
              counts zero.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">“Activated”, “Recent projects”</dt>
            <dd>
              “Activated” isn&apos;t a Railway term. “Recent projects” are projects created in the
              last 90 days.
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
