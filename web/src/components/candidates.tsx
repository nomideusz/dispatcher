import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtAgo, fmtDay, fmtNum, fmtUsd, shortNames } from "~/lib/format";
import type { TimelineTemplate } from "~/queries/analytics";
import { type CandidateGroup, candidatesQuery, type MarketCopy, useMarkCandidate } from "~/queries/candidates";

/** Databases, boilerplates and queues top the marketplace and are not apps
 * anyone pays kickback on for long. */
const PLUMBING = new Set(["Storage", "Starters", "Queues"]);
const PAGE = 40;
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

type View = "shortlist" | "market" | "skip";

/** What people deploy on Railway, one row per app, against what we publish:
 * a shortlist to build from, the market to find more, and our own
 * templates that have no rival at all. */
export function Candidates({ templates }: { templates: TimelineTemplate[] }) {
  const q = useQuery(candidatesQuery);
  const [view, setView] = useState<View>("shortlist");
  const [search, setSearch] = useState("");
  const [hidePlumbing, setHidePlumbing] = useState(true);
  const [hideOurs, setHideOurs] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const groups = q.data?.groups ?? [];
  const counts = {
    shortlist: groups.filter((g) => g.status === "shortlist").length,
    skip: groups.filter((g) => g.status === "skip").length,
  };
  const needle = search.trim().toLowerCase();
  const rows = groups.filter((g) => {
    if (needle && !g.key.includes(needle) && !g.leader.name.toLowerCase().includes(needle)) return false;
    if (view !== "market") return g.status === view;
    if (g.status) return false;
    if (hidePlumbing && PLUMBING.has(g.category)) return false;
    if (hideOurs && (g.ours.length > 0 || g.similar)) return false;
    return true;
  });
  const maxRecent = Math.max(1, ...rows.map((g) => g.recent));

  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <p className="text-sm text-(--viz-critical)">Failed to load the marketplace.</p>;
  if (!q.data.fetchedAt) {
    return <p className="text-sm text-muted-foreground">The marketplace has not been read yet; it is read daily at 06:20 UTC and on first start.</p>;
  }

  return (
    <div className="space-y-5">
      <Copies copies={q.data.copies ?? []} />
      <Originals groups={groups} templates={templates} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Candidates view" className="flex gap-1">
          {(
            [
              ["shortlist", "Shortlist", counts.shortlist],
              ["market", "Market", null],
              ["skip", "Skipped", counts.skip],
            ] as const
          ).map(([v, label, n]) => (
            <Button
              key={v}
              size="xs"
              variant={view === v ? "secondary" : "ghost"}
              onClick={() => {
                setView(v);
                setLimit(PAGE);
              }}
            >
              {label}
              {n != null && <span className="tabular-nums text-muted-foreground">{fmtNum(n)}</span>}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {view === "market" && (
            <>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={hidePlumbing} onChange={(e) => setHidePlumbing(e.target.checked)} />
                Hide databases and starters
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={hideOurs} onChange={(e) => setHideOurs(e.target.checked)} />
                Hide apps we have
              </label>
            </>
          )}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps"
            aria-label="Search apps"
            className="h-7 w-40 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
              <th className="pb-2 font-medium">App</th>
              <th className="pb-2 pl-3 font-medium">Deployed, 90 days</th>
              <th className="pb-2 pl-3 text-right font-medium">Active</th>
              <th className="pb-2 pl-3 text-right font-medium">Templates</th>
              <th className="pb-2 pl-3 font-medium">Leading template</th>
              <th className="pb-2 pl-3 text-right font-medium">Newest</th>
              <th className="pb-2 pl-3 font-medium">{view === "market" ? "We have" : "Note"}</th>
              <th className="pb-2 pl-3" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.slice(0, limit).map((g) => (
              <CandidateRow key={g.key} g={g} view={view} maxRecent={maxRecent} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-muted-foreground">
                  {view === "shortlist" ? "Nothing shortlisted. Pick from Market." : "No apps match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Railway&apos;s public marketplace, read {fmtAgo(q.data.fetchedAt, new Date().toISOString())} ago.
          Templates with the same name are one app; templates counts other creators&apos; only.
        </span>
        {rows.length > limit && (
          <Button size="xs" variant="ghost" onClick={() => setLimit(rows.length)}>
            Show all {fmtNum(rows.length)}
          </Button>
        )}
      </div>
    </div>
  );
}

function CandidateRow({ g, view, maxRecent }: { g: CandidateGroup; view: View; maxRecent: number }) {
  const mark = useMarkCandidate();
  const set = (status: CandidateGroup["status"], note = g.note) => mark.mutate({ key: g.key, status, note });
  const l = g.leader;
  const weak = l.health != null && l.health < 70;
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="max-w-60 py-2 pr-3">
        {l.code ? (
          <a
            href={`https://railway.com/deploy/${l.code}`}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-medium hover:underline"
            title={l.name}
          >
            {l.name}
          </a>
        ) : (
          <div className="truncate font-medium">{g.key}</div>
        )}
        <div className="truncate text-xs text-muted-foreground">
          {g.key}
          {g.category && g.category !== "Other" ? ` · ${g.category}` : ""}
        </div>
      </td>
      <td className="py-2 pl-3">
        <div className="flex items-center gap-2">
          <span className="w-12 text-right">{fmtNum(g.recent)}</span>
          <span className="h-1.5 w-24 rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-(--chart-3)"
              style={{ width: `${(g.recent / maxRecent) * 100}%` }}
            />
          </span>
        </div>
      </td>
      <td className="py-2 pl-3 text-right">{fmtNum(g.active)}</td>
      <td className="py-2 pl-3 text-right text-muted-foreground">{fmtNum(g.rivals)}</td>
      <td className="max-w-56 py-2 pl-3 text-xs whitespace-nowrap text-muted-foreground">
        {l.name ? (
          <div className="truncate">
            <span className={weak ? "font-medium text-(--viz-critical)" : ""}>
              {l.health == null ? "—" : `${Math.round(l.health)}%`}
            </span>{" "}
            · {fmtNum(l.active)} active · {monthFmt.format(new Date(l.createdAt))}
            <div className="truncate">{l.creator || "unknown creator"}</div>
          </div>
        ) : (
          "Only ours"
        )}
      </td>
      <td className="py-2 pl-3 text-right text-xs whitespace-nowrap text-muted-foreground">{fmtDay(g.newest)}</td>
      <td className="max-w-64 py-2 pl-3 text-xs text-muted-foreground">
        {view === "market" ? (
          g.ours.length > 0 ? "Yes" : (g.similar ?? "—")
        ) : (
          <input
            defaultValue={g.note}
            title={g.note || undefined}
            aria-label={`Note on ${g.key}`}
            placeholder="Add a note"
            onBlur={(e) => e.target.value.trim() !== g.note && set(g.status, e.target.value)}
            className="w-full min-w-40 rounded-sm bg-transparent px-1 py-0.5 text-foreground outline-none placeholder:text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </td>
      <td className="py-2 pl-3 text-right whitespace-nowrap">
        {view === "shortlist" ? (
          <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => set("")}>
            Remove
          </Button>
        ) : view === "skip" ? (
          <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => set("")}>
            Unskip
          </Button>
        ) : (
          <>
            <Button size="xs" variant="secondary" disabled={mark.isPending} onClick={() => set("shortlist")}>
              Shortlist
            </Button>
            <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => set("skip")}>
              Skip
            </Button>
          </>
        )}
      </td>
    </tr>
  );
}

/** Our templates nobody else publishes against the ones in a crowded app:
 * the case for building something new (Laya was the first decision API on
 * Railway) instead of the hundredth copy of an app. */
function Originals({ groups, templates }: { groups: CandidateGroup[]; templates: TimelineTemplate[] }) {
  const stats = useMemo(() => {
    const alone = new Set(groups.filter((g) => g.ours.length > 0 && g.rivals === 0).flatMap((g) => g.ours));
    const tally = (ts: TimelineTemplate[]) => {
      const earned = ts.reduce((s, t) => s + (t.earned30d ?? 0), 0);
      const active = ts.reduce((s, t) => s + t.activeProjects, 0);
      return { n: ts.length, earned, active, per: active > 0 ? earned / active : null };
    };
    const mine = templates.filter((t) => alone.has(t.templateId));
    const rest = templates.filter((t) => !alone.has(t.templateId));
    const name = shortNames(templates.map((t) => t.name));
    const earners = mine
      .filter((t) => (t.earned30d ?? 0) > 0)
      .sort((a, b) => (b.earned30d ?? 0) - (a.earned30d ?? 0))
      .map((t) => `${name(t.name)} ${fmtUsd(t.earned30d ?? 0)}`);
    return { alone: tally(mine), rest: tally(rest), earners };
  }, [groups, templates]);
  const { alone, rest, earners } = stats;
  if (alone.n === 0) return null;

  return (
    <div className="grid gap-4 border-b pb-5 sm:grid-cols-[auto_auto_1fr] sm:items-end sm:gap-8">
      <Figure label="Alone on Railway" value={fmtNum(alone.n)} sub={`of our ${fmtNum(alone.n + rest.n)} templates`} />
      <Figure
        label="Per active project, 30 days"
        value={alone.per != null ? fmtUsd(alone.per) : "—"}
        sub={`others with rivals: ${rest.per != null ? fmtUsd(rest.per) : "—"}`}
      />
      <p className="text-xs text-muted-foreground sm:pb-0.5">
        Templates of an app no one else publishes on Railway, like Laya, the first of its kind.
        Market demand only shows apps that are already here; an original starts without a
        leader to beat.{" "}
        {earners.length > 0 && (
          <span className="text-foreground">
            Earning: {earners.slice(0, 5).join(" · ")}
            {earners.length > 5 ? ` · +${earners.length - 5} more` : ""}
          </span>
        )}
      </p>
    </div>
  );
}

/** Other creators' templates built from our repos. Their deploys pay them,
 * and they run whatever we push to main. */
function Copies({ copies }: { copies: MarketCopy[] }) {
  if (copies.length === 0) return null;
  return (
    <div className="space-y-2 border-b pb-5">
      <div className="text-sm font-medium text-(--viz-critical)">
        {copies.length === 1 ? "1 template by someone else builds" : `${fmtNum(copies.length)} templates by others build`} from our code
      </div>
      <ul className="space-y-1 text-sm">
        {copies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
            <a
              href={`https://railway.com/deploy/${c.code}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {c.name}
            </a>
            <span className="text-xs text-muted-foreground">
              by {c.creator || "unknown creator"} · {c.repo.replace(/^github\.com\//i, "")} · published{" "}
              {fmtDay(c.createdAt)} · {fmtNum(c.activeProjects)} active, {fmtNum(c.recentProjects)} in 90 days
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Deploys of these pay their creator, not us, and they build whatever we push to main.
      </p>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
