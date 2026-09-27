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
      text: "Every deploy of your templates, yours included: test runs and deploys into existing projects. Only goes up. Railway's metrics page calls these Deployments.",
    },
    {
      label: "Projects",
      value: projects,
      color: "var(--chart-3)",
      of: pct(projects, deployments) + " of deployments",
      text: "Projects other people created from a template, all time. The public template page shows this as “Total deploys”.",
    },
    {
      label: "Active projects",
      value: active,
      color: "var(--chart-3)",
      of: pct(active, projects) + " of projects",
      text: "Those projects still live today. Deleting a project drops it from here, never from Projects.",
    },
    {
      label: "Paying",
      value: payers,
      color: "var(--chart-1)",
      of: payers != null ? pct(payers, active) + " of active" : null,
      text: "Deployers whose invoice paid you kickback in the last 30 days, told apart by billing date. Kickback is 15% of what they pay, +10% while support health is 80%+.",
    },
  ];

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {stages.map((s) => (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="flex items-baseline gap-2">
                {s.of && <span className="text-xs text-muted-foreground">{s.of}</span>}
                <span className="font-semibold tabular-nums">
                  {s.value == null ? "—" : fmtNum(s.value)}
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${deployments > 0 ? Math.max(1, ((s.value ?? 0) / deployments) * 100) : 0}%`,
                  background: s.color,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>

      <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{fmtUsd(earned)}</span> kickback over
          30 days: <span className="text-foreground">{active > 0 ? fmtUsd(earned / active) : "—"}</span>{" "}
          per active project
          {payers ? (
            <>
              , <span className="text-foreground">{fmtUsd(earned / payers)}</span> per payer
            </>
          ) : null}
          .
        </p>
        <p>
          <span className="font-medium text-foreground">Running · {fmtNum(running)}</span> is
          what Railway&apos;s metrics page labels “Active”: service instances running right now,
          not projects. A four-service project counts up to four; a crashed or removed service
          counts none. So running can outnumber active projects, or trail them.
        </p>
        <p>
          <span className="font-medium text-foreground">“Activated”</span> isn&apos;t a Railway
          term. Railway also shows <span className="text-foreground">Recent projects</span>:
          projects created in the last 90 days.
        </p>
      </div>
    </div>
  );
}
