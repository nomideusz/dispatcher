import { ArrowDown, ArrowUp, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { TemplateProjects } from "~/components/template-projects";
import { Button } from "~/components/ui/button";
import { fmtCents, fmtDay, fmtLongDay, fmtNum, fmtUsd } from "~/lib/format";
import {
  type Kind,
  KINDS,
  qualifiesForBonus,
  SUPPORT_BONUS_THRESHOLD,
  type TimelineTemplate,
  useSetKind,
} from "~/queries/analytics";
import type { PayoutTemplateTotal } from "~/queries/payouts";

type Row = TimelineTemplate & {
  perActive: number | null;
  payers: PayoutTemplateTotal | undefined;
};

const FILTERS = {
  all: { label: "All", test: () => true },
  earning: { label: "Earning", test: (r: Row) => (r.earned30d ?? 0) > 0 },
  idle: {
    label: "Deployed, not earning",
    test: (r: Row) => r.activeProjects > 0 && !r.earned30d,
  },
  unused: { label: "No projects", test: (r: Row) => r.projects === 0 },
  unsorted: { label: "Unsorted", test: (r: Row) => !r.kind },
} satisfies Record<string, { label: string; test: (r: Row) => boolean }>;
type Filter = keyof typeof FILTERS;

type SortKey =
  | "name"
  | "newProjects"
  | "projects"
  | "activeProjects"
  | "running"
  | "publishedAt"
  | "lastDeployAt"
  | "earnedCents"
  | "perActive"
  | "payers"
  | "lifetimeCents"
  | "lastPaidAt"
  | "health";

const sortValue = (r: Row, key: SortKey): string | number | null =>
  key === "payers" ? (r.payers?.payers ?? null) : r[key];

function compare(a: Row, b: Row, key: SortKey): number {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // blanks last
  return typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
}

/** Every template in one table: reach, money and dates side by side, and a
 * strip of the range's days — deploys up, kickback down. */
export function TemplatesTable({
  templates,
  byTemplate,
  dates,
}: {
  templates: TimelineTemplate[];
  byTemplate: PayoutTemplateTotal[] | undefined;
  /** The range's days, oldest first; the activity strip's x axis. */
  dates: string[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "lifetimeCents",
    desc: true,
  });
  // A held name jumps to #t-<id>; a filter that hides the row would make
  // the jump land nowhere.
  useEffect(() => {
    const show = () => window.location.hash.startsWith("#t-") && setFilter("all");
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, []);

  const payers = new Map(byTemplate?.map((p) => [p.templateId, p]));
  const all: Row[] = templates.map((t) => ({
    ...t,
    perActive: t.activeProjects > 0 && t.earned30d != null ? t.earned30d / t.activeProjects : null,
    payers: payers.get(t.templateId),
  }));
  const rows = all
    .filter(FILTERS[filter].test)
    .sort((a, b) => {
      const c = compare(a, b, sort.key);
      const blank = sortValue(a, sort.key) == null || sortValue(b, sort.key) == null;
      return (sort.desc && !blank ? -c : c) || b.activeProjects - a.activeProjects;
    });

  const lifetimeTotal = all.reduce((s, r) => s + r.lifetimeCents, 0);
  const scale = {
    dates,
    maxNew: Math.max(1, ...all.flatMap((r) => r.activity.map((a) => a.newProjects))),
    maxEarned: Math.max(1, ...all.flatMap((r) => r.activity.map((a) => a.earnedCents))),
  };

  const header = (key: SortKey, label: string, right = true) => {
    const on = sort.key === key;
    return (
      <th
        aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
        className={`sticky top-0 z-10 bg-card pb-2 font-medium ${right ? "pl-3 text-right" : ""}`}
      >
        <button
          type="button"
          className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-foreground ${on ? "text-foreground" : ""}`}
          onClick={() =>
            setSort({ key, desc: on ? !sort.desc : key !== "name" })
          }
        >
          {label}
          {on && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter templates" className="flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Button
            key={f}
            size="xs"
            aria-pressed={f === filter}
            variant={f === filter ? "secondary" : "ghost"}
            onClick={() => setFilter(f)}
          >
            {FILTERS[f].label}
            <span className="text-muted-foreground tabular-nums">
              {all.filter(FILTERS[f].test).length}
            </span>
          </Button>
        ))}
      </div>

      <div className="scroll-fade max-h-[36rem] overflow-auto">
        <table className="w-full text-sm">
          {/* The rule rides on the sticky cells; a row border scrolls away. */}
          <thead className="[&_th]:shadow-[inset_0_-1px_0_var(--border)]">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="sticky top-0 z-10 bg-card pr-3 pb-2 font-medium max-sm:hidden">Code</th>
              {header("name", "Template", false)}
              <th className="sticky top-0 z-10 bg-card pb-2 pl-3 font-medium whitespace-nowrap">
                Last {dates.length}d
              </th>
              {header("newProjects", "New")}
              {header("projects", "Projects")}
              {header("activeProjects", "Active")}
              {header("running", "Running")}
              {header("publishedAt", "Published")}
              {header("lastDeployAt", "Last deploy")}
              {header("earnedCents", `Earned ${dates.length}d`)}
              {header("perActive", "$/active")}
              {header("payers", "Payers")}
              {header("lifetimeCents", "Lifetime")}
              {header("lastPaidAt", "Paid")}
              {header("health", "Health")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <TemplateRow key={r.templateId} r={r} scale={scale} lifetimeTotal={lifetimeTotal} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No templates match.</p>
        )}
      </div>
    </div>
  );
}

type Scale = { dates: string[]; maxNew: number; maxEarned: number };

function TemplateRow({
  r,
  scale,
  lifetimeTotal,
}: {
  r: Row;
  scale: Scale;
  lifetimeTotal: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `template-projects-${r.templateId}`;
  const muted = "py-2 pl-3 text-right tabular-nums text-muted-foreground";
  const cell = "py-2 pl-3 text-right tabular-nums";
  const p = r.payers;
  return (
    <>
      <tr id={`t-${r.templateId}`} className={open ? "bg-muted/40" : "border-b border-border/60 last:border-0"}>
        <td
          className="max-w-28 truncate py-2 pr-3 align-top font-mono text-xs text-muted-foreground max-sm:hidden"
          title={r.code || undefined}
        >
          {r.code || "—"}
        </td>
        <td className="max-w-64 py-2 pr-3">
          <div className="flex items-start gap-1">
            {/* The name links to Railway, so expanding gets its own control. */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={`${open ? "Hide" : "Show"} projects over time for ${r.name}`}
              onClick={() => setOpen((o) => !o)}
              className="-ml-1 mt-0.5 shrink-0 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
            <div className="min-w-0">
              {r.code ? (
                <a
                  href={`https://railway.com/deploy/${r.code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium underline-offset-3 hover:underline"
                  title={r.name}
                >
                  {r.name}
                </a>
              ) : (
                <div className="truncate font-medium" title={r.name}>
                  {r.name}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {r.services} {r.services === 1 ? "service" : "services"} ·
                <KindSelect r={r} />
              </div>
            </div>
          </div>
        </td>
        <td className="py-2 pl-3">
          <ActivityStrip r={r} scale={scale} />
        </td>
        <td className={r.newProjects ? cell : muted}>{r.newProjects ? fmtNum(r.newProjects) : "—"}</td>
        <td className={cell}>{fmtNum(r.projects)}</td>
        <td className={cell}>{fmtNum(r.activeProjects)}</td>
        <td className={muted}>{r.running == null ? "—" : fmtNum(r.running)}</td>
        <td className={`${muted} whitespace-nowrap`}>
          {r.publishedAt ? fmtDay(r.publishedAt) : "—"}
        </td>
        <td className={`${muted} whitespace-nowrap`}>
          <LastDeploy at={r.lastDeployAt} after={r.lastDeployAfter} />
        </td>
        <td className={r.earnedCents ? `${cell} font-medium` : muted}>
          {r.earnedCents ? fmtCents(r.earnedCents) : "—"}
        </td>
        <td className={r.perActive ? cell : muted}>{r.perActive ? fmtUsd(r.perActive) : "—"}</td>
        <td
          className={p?.payers ? cell : muted}
          title={p ? `${p.new} new · ${p.returning} returning · ${p.lapsed} lapsed` : undefined}
        >
          {p?.payers ? fmtNum(p.payers) : "—"}
        </td>
        <td className={cell}>
          {r.lifetimeCents > 0 ? (
            <div className="flex flex-col items-end gap-1">
              {fmtCents(r.lifetimeCents)}
              <span className="h-1 w-14 rounded-full bg-muted">
                <span
                  className="float-right block h-full rounded-full bg-(--chart-1)"
                  style={{ width: `${Math.max(2, (r.lifetimeCents / lifetimeTotal) * 100)}%` }}
                />
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className={`${muted} whitespace-nowrap`}>
          {r.firstPaidAt && r.lastPaidAt
            ? fmtDay(r.firstPaidAt) === fmtDay(r.lastPaidAt)
              ? fmtDay(r.lastPaidAt)
              : `${fmtDay(r.firstPaidAt)} – ${fmtDay(r.lastPaidAt)}`
            : "—"}
        </td>
        <td className={`${cell} whitespace-nowrap`}>
          <Health r={r} />
        </td>
      </tr>
      {open && (
        <tr id={panelId} className="border-b border-border/50 bg-muted/40 last:border-0">
          {/* Sticky to the scroller's left edge so the charts stay in view
              while the wide table is scrolled sideways. */}
          <td colSpan={15} className="p-0">
            <div className="sticky left-0 w-[min(56rem,calc(100vw-4rem))] px-5 pt-2 pb-6">
              <TemplateProjects templateId={r.templateId} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** What the template is for, editable in place: a plain select that reads
 * as text until it is opened. */
function KindSelect({ r }: { r: Row }) {
  const setKind = useSetKind();
  const kind = setKind.isPending ? setKind.variables.kind : r.kind;
  return (
    <select
      aria-label={`Kind of ${r.name}`}
      value={kind}
      disabled={setKind.isPending}
      onChange={(e) => setKind.mutate({ templateId: r.templateId, kind: e.target.value as Kind | "" })}
      className={`-mx-0.5 cursor-pointer appearance-none rounded-sm bg-transparent px-0.5 outline-none field-sizing-content hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${kind ? "" : "text-(--viz-caution)"}`}
    >
      <option value="">Unsorted</option>
      {KINDS.map((k) => (
        <option key={k.key} value={k.key}>
          {k.label}
        </option>
      ))}
    </select>
  );
}

/** A new project shows up between two snapshots; across a collection gap
 * that is a span of days, and saying one date would be made up. */
function LastDeploy({ at, after }: { at: string | null; after: string | null }) {
  if (!at) return <>—</>;
  const spansDays = after != null && fmtDay(after) !== fmtDay(at);
  return (
    <span
      title={
        spansDays
          ? `Appeared between ${fmtDay(after!)} and ${fmtDay(at)}, while collection was down`
          : undefined
      }
    >
      {spansDays ? `${fmtDay(after!)} – ${fmtDay(at)}` : fmtDay(at)}
    </span>
  );
}

function Health({ r }: { r: Row }) {
  const bonus = qualifiesForBonus(r);
  const title = [
    r.health != null ? `Deploy health ${r.health.toFixed(0)}%` : "No deploy health yet",
    r.supportHealth != null
      ? `support health ${r.supportHealth.toFixed(0)}%${bonus ? "" : ` — under ${SUPPORT_BONUS_THRESHOLD}%, no +10% bonus`}`
      : "no support threads",
  ].join(" · ");
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {!bonus && (
        <span className="inline-flex items-center gap-0.5 text-xs text-(--viz-critical)">
          <CircleAlert className="size-3.5" />
          support
        </span>
      )}
      {/* The same rule that puts a template in the Held tray. */}
      {r.activeProjects > 0 && r.health != null && r.health < 50 ? (
        <span className="font-semibold text-(--viz-critical)">held · {r.health.toFixed(0)}%</span>
      ) : (
        <span>{r.health == null ? "—" : `${r.health.toFixed(0)}%`}</span>
      )}
    </span>
  );
}

const STRIP_W = 96;
const STRIP_H = 24;
const MID = STRIP_H / 2;

/** The range day by day: new projects rise above the midline, kickback
 * hangs below it, on scales shared by every row so strips compare. A
 * tick marks the day the template was published, if that falls inside. */
function ActivityStrip({ r, scale }: { r: Row; scale: Scale }) {
  const n = scale.dates.length;
  const step = STRIP_W / n;
  const w = Math.max(1, step - (step > 3 ? 1 : 0));
  const index = new Map(scale.dates.map((d, i) => [d, i]));
  const published = r.publishedAt ? index.get(r.publishedAt.slice(0, 10)) : undefined;
  const h = (v: number, max: number) => (v > 0 ? Math.max(2, Math.sqrt(v / max) * (MID - 1)) : 0);

  return (
    <svg width={STRIP_W} height={STRIP_H} className="block overflow-visible" aria-hidden>
      <line x1={0} x2={STRIP_W} y1={MID} y2={MID} stroke="var(--border)" />
      {published != null && (
        <rect x={published * step} y={0} width={Math.max(1.5, w)} height={STRIP_H} fill="var(--chart-5)" opacity={0.5}>
          <title>Published {fmtLongDay(scale.dates[published])}</title>
        </rect>
      )}
      {r.activity.map((a) => {
        const i = index.get(a.date);
        if (i == null) return null;
        const up = h(a.newProjects, scale.maxNew);
        const down = h(a.earnedCents, scale.maxEarned);
        return (
          <g key={a.date}>
            <title>
              {[
                fmtLongDay(a.date),
                a.newProjects ? `${a.newProjects} new ${a.newProjects === 1 ? "project" : "projects"}` : null,
                a.earnedCents ? `${fmtCents(a.earnedCents)} kickback` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </title>
            <rect x={i * step - 1} y={0} width={step + 2} height={STRIP_H} fill="transparent" />
            {up > 0 && <rect x={i * step} y={MID - up} width={w} height={up} rx={1} fill="var(--chart-3)" />}
            {down > 0 && <rect x={i * step} y={MID + 1} width={w} height={down} rx={1} fill="var(--chart-1)" />}
          </g>
        );
      })}
    </svg>
  );
}
