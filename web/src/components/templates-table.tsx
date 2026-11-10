import { ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useUrlState } from "~/components/page";
import { TemplateProjects } from "~/components/template-projects";
import { Button } from "~/components/ui/button";
import { VerdictGuide, verdictNote } from "~/components/verdict-guide";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, TableSortHead } from "~/components/ui/table";
import { fmtCents, fmtDay, fmtDayTime, fmtLongDay, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  type Kind,
  KINDS,
  type Origin,
  ORIGINS,
  qualifiesForBonus,
  SUPPORT_BONUS_THRESHOLD,
  type TemplateVerdict,
  type TimelineTemplate,
  useSetKind,
  useSetOrigin,
  VERDICT_STATES,
  type VerdictsResponse,
} from "~/queries/analytics";
import type { PayoutTemplateTotal } from "~/queries/payouts";

type Row = TimelineTemplate & {
  perRunning: number | null;
  payers: PayoutTemplateTotal | undefined;
  verdict: TemplateVerdict | undefined;
};

const FILTERS = {
  all: { label: "All", test: () => true },
  earning: { label: "Earning", test: (r: Row) => (r.earned30d ?? 0) > 0 },
  idle: {
    label: "Deployed, not earning",
    // Two weeks in: younger ones mostly haven't had time to pay.
    test: (r: Row) =>
      (r.running ?? r.activeProjects) > 0 &&
      !r.earned30d &&
      r.publishedAt != null &&
      Date.now() - Date.parse(r.publishedAt) >= 14 * 86_400_000,
  },
  unused: { label: "No projects", test: (r: Row) => r.projects === 0 },
  unsorted: { label: "Unsorted", test: (r: Row) => !r.kind },
  unmarked: { label: "No origin", test: (r: Row) => !r.origin },
} satisfies Record<string, { label: string; test: (r: Row) => boolean }>;
type Filter = keyof typeof FILTERS;

type SortKey =
  | "name"
  | "verdict"
  | "newProjects"
  | "projects"
  | "activeProjects"
  | "running"
  | "earnedCents"
  | "perRunning"
  | "payers"
  | "lifetimeCents"
  | "health"
  | "publishedAt"
  | "lastDeployAt"
  | "lastPaidAt";
const SORT_KEYS: SortKey[] = [
  "name",
  "verdict",
  "newProjects",
  "projects",
  "activeProjects",
  "running",
  "earnedCents",
  "perRunning",
  "payers",
  "lifetimeCents",
  "health",
  "publishedAt",
  "lastDeployAt",
  "lastPaidAt",
];

/** Sorted by state, not alphabet: keep, watch, no signal, too early, pre-tracking. */
const sortValue = (r: Row, key: SortKey): string | number | null =>
  key === "payers"
    ? (r.payers?.payers ?? null)
    : key === "verdict"
      ? r.verdict
        ? VERDICT_STATES.indexOf(r.verdict.state)
        : null
      : r[key];

/** Text keys read best A to Z, and the verdict best from keep down; the rest
 * open biggest first. */
const ASCENDING_FIRST: SortKey[] = ["name", "verdict"];

function compare(a: Row, b: Row, key: SortKey): number {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // blanks last
  return typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
}

/** Every template in one table: reach, money and dates side by side, and a
 * strip of the range's days — deploys up, kickback down. Filter, search and
 * sort live in the URL (?filter, ?q, ?sort=-lifetimeCents), so a reload or a
 * shared link keeps them. */
export function TemplatesTable({
  templates,
  byTemplate,
  dates,
  trackedSince,
  verdicts,
}: {
  templates: TimelineTemplate[];
  byTemplate: PayoutTemplateTotal[] | undefined;
  /** The day-21 verdicts; undefined while loading or if the call failed. */
  verdicts: VerdictsResponse | null | undefined;
  /** The range's days, oldest first; the activity strip's x axis. */
  dates: string[];
  /** The first snapshot: projects are seen arriving only after it. */
  trackedSince: string;
}) {
  const [params, setParams] = useUrlState();
  const f = params.get("filter");
  const filter: Filter = f && f in FILTERS ? (f as Filter) : "all";
  // The box keeps its own text and copies it to ?q: bound to the URL, fast
  // typing would outrun the navigation and drop letters.
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  useEffect(() => setParams({ q: search || null }), [search]);
  // Earned in the range by default: what pays now, not what paid since July.
  const s = params.get("sort") ?? "-earnedCents";
  const sortKey = s.replace(/^-/, "") as SortKey;
  const sort = SORT_KEYS.includes(sortKey)
    ? { key: sortKey, desc: s.startsWith("-") }
    : { key: "earnedCents" as SortKey, desc: true };
  const setFilter = (v: Filter) => setParams({ filter: v === "all" ? null : v });
  const showAll = () => {
    setSearch("");
    setParams({ filter: null });
  };
  // A held name jumps to #t-<id>; a filter that hides the row would make
  // the jump land nowhere.
  const hash = useLocation().hash;
  const narrowed = filter !== "all" || search !== "";
  useEffect(() => {
    if (hash.startsWith("#t-") && narrowed) showAll();
    // Only on a new jump, not when the filter changes after it.
  }, [hash]);

  const payers = new Map(byTemplate?.map((p) => [p.templateId, p]));
  const verdictOf = new Map(verdicts?.templates.map((v) => [v.templateId, v]));
  const all: Row[] = templates.map((t) => ({
    ...t,
    // Under three instances, one more or less halves or doubles it: noise.
    perRunning: t.running != null && t.running >= 3 && t.earned30d != null ? t.earned30d / t.running : null,
    payers: payers.get(t.templateId),
    verdict: verdictOf.get(t.templateId),
  }));
  const short = shortNames(all.map((r) => r.name));
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((r) => FILTERS[filter].test(r) && (!needle || `${r.name} ${r.code}`.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const c = compare(a, b, sort.key);
      const blank = sortValue(a, sort.key) == null || sortValue(b, sort.key) == null;
      return (sort.desc && !blank ? -c : c) || (b.running ?? 0) - (a.running ?? 0);
    });

  const lifetimeTotal = all.reduce((s, r) => s + r.lifetimeCents, 0);
  const scale = {
    dates,
    maxNew: Math.max(1, ...all.flatMap((r) => r.activity.map((a) => a.newProjects))),
    maxEarned: Math.max(1, ...all.flatMap((r) => r.activity.map((a) => a.earnedCents))),
  };

  const header = (key: SortKey, label: string, hint?: string, right = true) => {
    const on = sort.key === key;
    return (
      <TableSortHead
        numeric={right}
        hint={hint}
        sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
        onSort={() => {
          const desc = on ? !sort.desc : !ASCENDING_FIRST.includes(key);
          setParams({ sort: key === "earnedCents" && desc ? null : `${desc ? "-" : ""}${key}` });
        }}
      >
        {label}
      </TableSortHead>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Filter templates" className="flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Button
            key={f}
            size="xs"
            disabled={f !== "all" && f !== filter && !all.some(FILTERS[f].test)}
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
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates"
          aria-label="Search templates"
          className="h-7 w-48 border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <VerdictGuide verdicts={verdicts} />

      <Table rows={rows.length} limit={50}>
        <TableHeader>
          <TableRow>
              {header("name", "Template", undefined, false)}
              {header(
                "verdict",
                "Verdict",
                "An early read, taken once at 21 days old: does it already show the template will earn? “What Verdict means” above the table spells out each state; point at one for that template's reading",
                false,
              )}
              {header(
                "health",
                "Health",
                `Share of recent deploys that came up, as the marketplace shows it. Unscored: no running deploys have scored it yet, and search sorts it below every listing at 70% or more. A red "support" beside it: support health is under ${SUPPORT_BONUS_THRESHOLD}%, so no +10% kickback bonus`,
              )}
              <TableHead className="max-sm:hidden" hint="New projects above the line, kickback below, day by day">
                Last {dates.length}d
              </TableHead>
              {header("newProjects", "New", newHint(dates, trackedSince.slice(0, 10), templates))}
              {header("projects", "Projects", "Projects made from it that still exist: deleting one lowers this, while New keeps counting it")}
              {header("activeProjects", "Active", "Projects live today")}
              {header("running", "Running", "Service instances up now")}
              {header("earnedCents", `Earned ${dates.length}d`, `Kickback in the last ${dates.length} days`)}
              {header("perRunning", "$/running", "30-day kickback per running instance, from 3 running")}
              {header("payers", "Payers", "Deployers whose invoices paid us kickback")}
              {header("lifetimeCents", "Lifetime", "Kickback since it was published")}
              {header("publishedAt", "Published", "When it went live on the marketplace, UTC")}
              {header("lastDeployAt", "Last deploy", "Newest project made from it, UTC, to the hourly sample that first saw it")}
              {header("lastPaidAt", "Paid", "Last kickback attributed to it, UTC, to the hourly sample; open the row for the first")}
          </TableRow>
        </TableHeader>
        <TableBody>
            {rows.map((r) => (
              <TemplateRow
                key={r.templateId}
                r={r}
                name={short(r.name)}
                scale={scale}
                lifetimeTotal={lifetimeTotal}
                byTemplateLoaded={byTemplate != null}
                verdicts={verdicts}
              />
            ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUMNS} className="py-6 text-center text-muted-foreground">
                No templates match.{" "}
                <button type="button" className="cursor-pointer text-primary underline" onClick={showAll}>
                  Show all
                </button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** A range that starts before tracking can't see projects made before it on
 * templates published before the range: the server counts all of a
 * template's projects only when the range holds its whole life. */
function newHint(dates: string[], tracked: string, templates: TimelineTemplate[]) {
  const hint = `Projects made from it in the last ${dates.length} days`;
  const blind = dates[0] < tracked && templates.some((t) => t.publishedAt != null && t.publishedAt.slice(0, 10) < dates[0]);
  return blind
    ? `${hint}. Tracking began ${fmtDay(tracked)}: for a template published before ${fmtDay(dates[0])}, only projects made after ${fmtDay(tracked)} count`
    : hint;
}

/** The state; its meaning and the frozen day-21 reading on hover. */
function Verdict({ v, all }: { v: TemplateVerdict | undefined; all: VerdictsResponse | null | undefined }) {
  if (!v) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      title={verdictNote(v, all)}
      className={cn(
        "whitespace-nowrap",
        v.state === "keep" ? "font-medium" : v.state === "watch" ? "" : "text-xs text-muted-foreground",
      )}
    >
      {v.state}
    </span>
  );
}

type Scale = { dates: string[]; maxNew: number; maxEarned: number };
const COLUMNS = 15;

function TemplateRow({
  r,
  name,
  scale,
  lifetimeTotal,
  byTemplateLoaded,
  verdicts,
}: {
  r: Row;
  /** The short name, told apart from its siblings; the full one is its title. */
  name: string;
  scale: Scale;
  lifetimeTotal: number;
  /** Payers come from the payout query; until it loads, "—" means unknown. */
  byTemplateLoaded: boolean;
  verdicts: VerdictsResponse | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `template-projects-${r.templateId}`;
  const muted = "text-muted-foreground";
  const p = r.payers;
  return (
    <>
      <TableRow id={`t-${r.templateId}`} data-open={open || undefined} rule={open ? "none" : "bottom"} className={cn(open && "bg-muted/40")}>
        <TableRowHead className="max-w-72 2xl:max-w-80">
          <div className="flex items-start gap-1">
            {/* The name links to Railway, so expanding gets its own control. */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={`${open ? "Hide" : "Show"} projects over time for ${r.name}`}
              onClick={() => setOpen((o) => !o)}
              className="-mt-0.5 -ml-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
                  title={`${r.name} · ${r.code}`}
                >
                  {name}
                </a>
              ) : (
                <div className="truncate font-medium" title={r.name}>
                  {name}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground sm:flex-nowrap sm:whitespace-nowrap">
                <span className="whitespace-nowrap">
                  <span className="tabular-nums">{r.services}</span> {r.services === 1 ? "service" : "services"} ·
                </span>
                <KindSelect r={r} /> ·
                <OriginSelect r={r} />
              </div>
              {/* On a phone the money columns are off-screen, so the row
                  carries what it earned under the name. */}
              <div className="text-xs sm:hidden">
                <span className="tabular-nums">{fmtCents(r.earnedCents)}</span> in {scale.dates.length}d
              </div>
            </div>
          </div>
        </TableRowHead>
        <TableCell>
          <Verdict v={r.verdict} all={verdicts} />
        </TableCell>
        <TableCell numeric>
          <Health r={r} />
        </TableCell>
        <TableCell className="max-sm:hidden">
          <ActivityStrip r={r} scale={scale} />
        </TableCell>
        <TableCell numeric className={cn(!r.newProjects && muted)}>{fmtNum(r.newProjects)}</TableCell>
        <TableCell numeric>{fmtNum(r.projects)}</TableCell>
        <TableCell numeric>{fmtNum(r.activeProjects)}</TableCell>
        <TableCell numeric className={cn(!r.running && muted)}>{r.running == null ? "—" : fmtNum(r.running)}</TableCell>
        <TableCell numeric className={r.earnedCents ? "font-medium" : muted}>
          {fmtCents(r.earnedCents)}
        </TableCell>
        <TableCell numeric className={cn(!r.perRunning && muted)}>{r.perRunning == null ? "—" : fmtUsd(r.perRunning)}</TableCell>
        <TableCell
          numeric
          className={cn(!p?.payers && muted)}
          title={p ? `${p.new} new · ${p.returning} returning · ${p.lapsed} lapsed` : undefined}
        >
          {byTemplateLoaded ? fmtNum(p?.payers ?? 0) : "—"}
        </TableCell>
        <TableCell numeric>
          {r.lifetimeCents > 0 ? (
            <div className="flex items-center justify-end gap-2">
              <TableMeter value={Math.max(0.02, r.lifetimeCents / lifetimeTotal)} />
              {fmtCents(r.lifetimeCents)}
            </div>
          ) : (
            <span className="text-muted-foreground">{fmtCents(0)}</span>
          )}
        </TableCell>
        <TableCell numeric className={cn("text-xs", muted)}>{r.publishedAt ? <DayTime iso={r.publishedAt} /> : "—"}</TableCell>
        <TableCell numeric className={cn("text-xs", muted)}>
          <LastDeploy at={r.lastDeployAt} after={r.lastDeployAfter} />
        </TableCell>
        <TableCell numeric className={cn("text-xs", muted)}>{r.lastPaidAt ? <DayTime iso={r.lastPaidAt} /> : "never"}</TableCell>
      </TableRow>
      {open && (
        <TableRow id={panelId} data-panel className="bg-muted/40">
          {/* Sticky to the scroller's left edge so the charts stay in view
              while the wide table is scrolled sideways. */}
          <TableCell colSpan={COLUMNS} className="p-0">
            <div className="sticky left-0 w-[calc(100vw-4rem)] max-w-[86rem] space-y-3 px-5 pt-2 pb-6">
              {r.firstPaidAt && (
                <p className="text-xs text-muted-foreground">
                  First paid <span className="tabular-nums">{fmtDayTime(r.firstPaidAt)}</span> UTC
                </p>
              )}
              <TemplateProjects templateId={r.templateId} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const INLINE_SELECT =
  "-mx-0.5 min-h-6 cursor-pointer appearance-none border-b border-dashed border-current/40 bg-transparent px-0.5 outline-none field-sizing-content hover:border-current hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** Original or competitive, marked by hand like the kind. */
function OriginSelect({ r }: { r: Row }) {
  const setOrigin = useSetOrigin();
  const origin = setOrigin.isPending ? setOrigin.variables.origin : r.origin;
  return (
    <select
      aria-label={`Origin of ${r.name}`}
      value={origin}
      disabled={setOrigin.isPending}
      onChange={(e) => setOrigin.mutate({ templateId: r.templateId, origin: e.target.value as Origin | "" })}
      className={cn(INLINE_SELECT, !origin && "text-(--viz-caution)")}
    >
      <option value="">No origin</option>
      {ORIGINS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
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
      className={cn(INLINE_SELECT, !kind && "text-(--viz-caution)")}
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
 * that is a span of days, and saying one time would be made up. */
function LastDeploy({ at, after }: { at: string | null; after: string | null }) {
  if (!at) return <>—</>;
  const spansDays = after != null && fmtDay(after) !== fmtDay(at);
  return (
    <span title={spansDays ? `Appeared between ${fmtDayTime(after!)} and ${fmtDayTime(at)} UTC, while collection was down` : undefined}>
      {spansDays ? (
        <>
          <span className="block">{fmtDay(after!)} –</span>
          <span className="block">{fmtDay(at)}</span>
        </>
      ) : (
        <DayTime iso={at} />
      )}
    </span>
  );
}

/** The day; its UTC time on hover, since the hour rarely matters here. */
function DayTime({ iso }: { iso: string }) {
  return <span title={`${fmtDayTime(iso)} UTC`}>{fmtDay(iso)}</span>;
}

function Health({ r }: { r: Row }) {
  const bonus = qualifiesForBonus(r);
  const title = [
    r.health != null
      ? `Deploy health ${r.health.toFixed(0)}%`
      : "Unscored: no running deploys have scored it yet, so search sorts it below every listing at 70% or more",
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
      {(r.running ?? r.activeProjects) > 0 && r.health != null && r.health < 50 ? (
        <span className="font-semibold text-(--viz-critical)">
          held · <span className="tabular-nums">{r.health.toFixed(0)}%</span>
        </span>
      ) : (
        r.health == null ? (
          <span className="text-xs text-muted-foreground">unscored</span>
        ) : (
          <span className="tabular-nums">{r.health.toFixed(0)}%</span>
        )
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
