import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Fragment, useState } from "react";
import { DOCKET, DocketCell, Fig, Section } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, TableSortHead } from "~/components/ui/table";
import { fmtAgo, fmtNum } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type PositionShare, type SearchKeyword, searchQuery, useAddKeyword, useRemoveKeyword } from "~/queries/search";

/** Databases, boilerplates and queues top the demand and are not apps we
 * build; same set as Candidates. */
const PLUMBING = new Set(["Storage", "Starters", "Queues"]);

type View = "names" | "added" | "gaps" | "all";
type SortKey = "query" | "best" | "demand" | "worth" | "first";
type Value = (k: SearchKeyword, key: SortKey) => string | number | null;

/** What reaching #1 adds, in 90-day projects: the keyword's demand times the
 * share #1 holds over the share at our position (none when we're unlisted).
 * The biggest single result's projects are left out of demand: a template
 * holding most of a keyword from #14 ("hermes") gets them by name, not by
 * position, and no rank takes them.
 * ponytail: average shares across all keywords, an upper bound; per-keyword
 * click data would sharpen it if Railway ever exposes it. */
function worthOf(curve: PositionShare[]) {
  const share = new Map(curve.map((c) => [c.position, c.share]));
  const first = share.get(1) ?? 0;
  return (k: SearchKeyword) => {
    if (k.best === 1) return null;
    const open = k.demand - Math.max(0, ...k.top.map((r) => r.recent));
    return open * (first - (k.best == null ? 0 : (share.get(k.best) ?? 0)));
  };
}

/** Blanks (not ranked, no results) stay last whichever way it's sorted. */
function compare(a: SearchKeyword, b: SearchKeyword, key: SortKey, desc: boolean, sortValue: Value): number {
  const x = sortValue(a, key);
  const y = sortValue(b, key);
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
  const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
  return desc ? -c : c;
}

const inView = (k: SearchKeyword, v: View, hidePlumbing: boolean) => {
  if (v === "names") return k.source === "ours";
  if (v === "added") return k.source === "manual";
  if (hidePlumbing && PLUMBING.has(k.category)) return false;
  // A gap: people deploy what this finds, and we aren't in the top three.
  if (v === "gaps") return k.demand > 0 && (k.best == null || k.best > 3);
  return true;
};

/** Where our templates land in Railway's marketplace search, which
 * keywords carry demand we don't reach, and how much a position is worth. */
export function MarketSearch() {
  const q = useQuery(searchQuery);
  const [view, setView] = useState<View>("names");
  const [needle, setNeedle] = useState("");
  const [hidePlumbing, setHidePlumbing] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "worth", desc: true });
  const add = useAddKeyword();

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.isError) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-(--viz-critical)">
        Couldn&apos;t load search positions.
        <Button size="xs" variant="ghost" disabled={q.isFetching} onClick={() => q.refetch()}>
          {q.isFetching ? "Loading…" : "Try again"}
        </Button>
      </p>
    );
  }
  if (!q.data.sampledAt) {
    return <p className="text-sm text-muted-foreground">Railway&apos;s search hasn&apos;t been read yet. It&apos;s read daily at 06:40 UTC and on first start.</p>;
  }

  const all = q.data.keywords;
  const worth = worthOf(q.data.curve);
  const value: Value = (k, key) => (key === "worth" ? worth(k) : key === "first" ? (k.top[0]?.recent ?? null) : k[key]);
  const own = all.filter((k) => k.source === "ours");
  const n = needle.trim().toLowerCase().replace(/\s+/g, " ");
  const rows = all
    .filter((k) => inView(k, view, hidePlumbing) && (!n || k.query.includes(n)))
    .sort((a, b) => compare(a, b, sort.key, sort.desc, value) || b.demand - a.demand);
  const maxDemand = Math.max(1, ...rows.map((k) => k.demand));
  const count = (v: View) => all.filter((k) => inView(k, v, hidePlumbing)).length;
  // The tabs split what used to sit together, so a miss here may be a hit next door.
  const elsewhere = n.length > 0 && view !== "all" && all.some((k) => inView(k, "all", hidePlumbing) && k.query.includes(n));
  // A rank or a name reads best from the top; counts from the biggest.
  const header = (key: SortKey, label: string, hint?: string, numeric = true, className?: string) => {
    const on = sort.key === key;
    return (
      <TableSortHead
        numeric={numeric}
        hint={hint}
        className={className}
        sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
        onSort={() => setSort({ key, desc: on ? !sort.desc : key !== "query" && key !== "best" })}
      >
        {label}
      </TableSortHead>
    );
  };

  return (
    <>
      <div className={cn(DOCKET, "grid-cols-2 lg:grid-cols-4")}>
        <DocketCell label="Template names at #1" value={`${fmtNum(own.filter((k) => k.best === 1).length)} of ${fmtNum(own.length)}`}>
          names and codes of our templates
        </DocketCell>
        <DocketCell label="In the top 3" value={fmtNum(own.filter((k) => k.best != null && k.best <= 3).length)} />
        <DocketCell label="Missing under own name" value={fmtNum(own.filter((k) => k.best == null).length)}>
          {own
            .filter((k) => k.best == null)
            .slice(0, 4)
            .map((k) => k.query)
            .join(" · ") || "none"}
        </DocketCell>
        <DocketCell label="Gaps" value={fmtNum(count("gaps"))}>
          keywords with demand where we&apos;re not top 3
        </DocketCell>
      </div>

      <Section
        id="keywords"
        title="Keywords"
        text={`Railway's top 20 for each keyword, read ${fmtAgo(q.data.sampledAt, new Date().toISOString())} ago. Open a keyword for its results; point at a column name for what it counts.`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Keywords view" className="flex gap-1">
            {(
              [
                ["names", "Template names"],
                ["added", "Added by hand"],
                ["gaps", "Gaps"],
                ["all", "All"],
              ] as const
            ).map(([v, label]) => (
              <Button key={v} size="xs" aria-pressed={view === v} variant={view === v ? "secondary" : "ghost"} onClick={() => setView(v)}>
                {label}
                <span className="tabular-nums text-muted-foreground">{fmtNum(count(v))}</span>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {(view === "gaps" || view === "all") && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={hidePlumbing} onChange={(e) => setHidePlumbing(e.target.checked)} />
                Hide databases and starters
              </label>
            )}
            {/* Not tracked as typed, even if longer keywords contain it ("claude" beside "claude mem"). */}
            {n.length >= 2 && !all.some((k) => k.query === n) && (
              <span className="flex items-center gap-2">
                {add.isError && add.variables === n && <span role="alert" className="text-(--viz-critical)">Not added</span>}
                <Button size="xs" variant="secondary" disabled={add.isPending} onClick={() => add.mutate(n, { onSuccess: () => setView("added") })}>
                  {add.isPending ? "Searching…" : `Track “${n}”`}
                </Button>
              </span>
            )}
            <input
              type="search"
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder="Find or track a keyword"
              aria-label="Find or track a keyword"
              className="h-7 w-52 border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <Table rows={rows.length} limit={50} className="sm:min-w-[48rem]">
          <TableHeader>
            <TableRow>
              {header("query", "Keyword", undefined, false)}
              {header("best", "We rank", "Our best position now, and the change from a week ago")}
              {header("demand", "Demand, 90 days", "Projects in 90 days of everything the search finds, so broad keywords count big templates more than once", false)}
              {header("worth", "Worth at #1", "Projects in 90 days that reaching #1 would add, at most: demand less its biggest template, times what #1 holds over our spot (see What a position holds)")}
              {header("first", "First result", "Sorted by the first result's projects in 90 days", false, "max-sm:hidden")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => (
              <Fragment key={k.query}>
                <KeywordRow k={k} worth={worth(k)} maxDemand={maxDemand} open={open === k.query} onToggle={() => setOpen(open === k.query ? null : k.query)} />
                {open === k.query && (
                  <TableRow data-panel>
                    <TableCell colSpan={5} className="pb-4">
                      <TopResults k={k} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No keywords match.
                  {elsewhere && (
                    <>
                      {" "}
                      <Button size="xs" variant="secondary" onClick={() => setView("all")}>
                        Look in All
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Section>

      <Curve curve={q.data.curve} />
    </>
  );
}

function KeywordRow({
  k,
  worth,
  maxDemand,
  open,
  onToggle,
}: {
  k: SearchKeyword;
  worth: number | null;
  maxDemand: number;
  open: boolean;
  onToggle: () => void;
}) {
  const first = k.top[0];
  return (
    <TableRow>
      <TableRowHead className="max-w-40 sm:max-w-56">
        <button type="button" aria-expanded={open} onClick={onToggle} className="block max-w-full cursor-pointer truncate text-left font-medium hover:underline">
          {k.query}
        </button>
        <div className="truncate text-xs text-muted-foreground">
          {k.source === "ours" ? "template name" : k.source === "market" ? "market app" : "added by hand"}
          {k.category && k.category !== "Other" ? ` · ${k.category}` : ""}
        </div>
      </TableRowHead>
      <TableCell numeric>
        <Rank k={k} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="w-14 text-right tabular-nums">{fmtNum(k.demand)}</span>
          <TableMeter value={k.demand / maxDemand} color="var(--chart-3)" className="w-24 max-sm:hidden" />
        </div>
      </TableCell>
      <TableCell numeric className={worth != null && worth >= 1 ? "" : "text-muted-foreground"}>
        {worth == null ? "—" : fmtNum(Math.round(worth))}
      </TableCell>
      <TableCell className="max-w-72 text-xs text-muted-foreground max-sm:hidden">
        {first ? (
          <div className="truncate">
            <a href={`https://railway.com/deploy/${first.code}`} target="_blank" rel="noreferrer" className={cn("hover:underline", first.ours ? "font-medium text-foreground" : "")}>
              {first.ours ? "Ours: " : ""}
              {first.name}
            </a>
            <div className="truncate">
              {first.ours ? "" : `${first.creator || "unknown creator"} · `}
              <Fig>{fmtNum(first.recent)}</Fig> in 90 days
            </div>
          </div>
        ) : (
          "No results"
        )}
      </TableCell>
    </TableRow>
  );
}

/** Our best position, with its move since a week ago: a lower number is up. */
function Rank({ k }: { k: SearchKeyword }) {
  const now = k.best == null ? <span className="text-muted-foreground">—</span> : <span className="font-medium">#{k.best}</span>;
  if (!k.searchedBefore || k.best === k.prevBest) return now;
  // Off the list counts as position 21 for the arrow.
  const before = k.prevBest ?? 21;
  const after = k.best ?? 21;
  const up = after < before;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {now}
      <span className={cn("flex items-center text-xs", up ? "text-(--viz-up)" : "text-(--viz-down)")} title={`was ${k.prevBest == null ? "not listed" : `#${k.prevBest}`}`}>
        {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
        {k.prevBest == null ? "new" : k.best == null ? "out" : Math.abs(before - after)}
      </span>
    </span>
  );
}

/** A keyword opened: Railway's results, and for one added by hand the way
 * to stop tracking it. */
function TopResults({ k }: { k: SearchKeyword }) {
  const remove = useRemoveKeyword();
  const stop = k.source === "manual" && (
    <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={remove.isPending} onClick={() => remove.mutate(k.query)}>
      {remove.isPending ? "Removing…" : `Stop tracking \u201c${k.query}\u201d`}
    </Button>
  );
  if (k.top.length === 0)
    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        Railway returns nothing for this keyword. {stop}
      </div>
    );
  return (
    <div className="space-y-2">
    <ol className="grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
      {k.top.map((r) => (
        <li key={r.templateId} className={cn("flex min-w-0 gap-2", r.ours ? "font-medium text-foreground" : "text-muted-foreground")}>
          <span className="w-5 shrink-0 text-right tabular-nums">{r.position}</span>
          <a href={`https://railway.com/deploy/${r.code}`} target="_blank" rel="noreferrer" className="truncate hover:underline">
            {r.name}
          </a>
          <span className="shrink-0 tabular-nums">{fmtNum(r.recent)}</span>
          <span className="truncate">{r.ours ? "ours" : r.creator}</span>
        </li>
      ))}
    </ol>
    {stop}
    </div>
  );
}

/** What a position is worth: the share of a keyword's demand held by the
 * template there. Rank and popularity feed each other, so this is the
 * upper bound of what a better position buys, not a measured effect. */
function Curve({ curve }: { curve: PositionShare[] }) {
  const top = curve.filter((c) => c.position <= 10);
  if (top.length === 0) return null;
  const max = Math.max(...top.map((c) => c.share));
  return (
    <Section
      id="positions"
      title="What a position holds"
      text="Average share of a keyword's 90-day projects held by the template at each position, over every keyword with demand. Popular templates may rank high for being popular, so read it as an upper bound."
    >
      <Table rows={top.length} className="max-w-xl">
        <TableHeader>
          <TableRow>
            <TableHead>Position</TableHead>
            <TableHead>Share of demand</TableHead>
            <TableHead numeric>Keywords</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {top.map((c) => (
            <TableRow key={c.position}>
              <TableRowHead>#{c.position}</TableRowHead>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-right tabular-nums">{Math.round(c.share * 100)}%</span>
                  <TableMeter value={c.share / max} color="var(--chart-2)" className="w-32" />
                </div>
              </TableCell>
              <TableCell numeric className="text-muted-foreground">
                {fmtNum(c.keywords)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}
