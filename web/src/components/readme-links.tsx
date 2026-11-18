import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "~/components/ui/table";
import { fmtAgo, fmtNum, shortNames } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type LinkReport, type ReadmeLink, useRefreshLinks } from "~/queries/links";

/** What a problem means and what to do about it, in a word or two. */
const WHAT: Record<ReadmeLink["problem"], string> = {
  "not-found": "Page gone (404)",
  gone: "Domain gone",
  deploy: "Dead deploy button",
  relative: "Relative link",
  unverified: "Not verified",
};

function LinkRows({ rows }: { rows: ReadmeLink[] }) {
  const name = shortNames(rows.map((r) => r.name));
  return (
    <Table rows={rows.length} limit={50} className="min-w-[44rem]">
      <TableHeader>
        <TableRow>
          <TableHead>Template</TableHead>
          <TableHead>Link</TableHead>
          <TableHead hint="Broken links failed twice, five seconds apart. Not verified means the site would not answer a script: open it to be sure">What&apos;s wrong</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={`${r.templateId} ${r.url}`}>
            <TableRowHead>
              <a href={`https://railway.com/deploy/${r.code}`} className="underline decoration-current/40 underline-offset-3 hover:decoration-current">
                {name(r.name)}
              </a>
            </TableRowHead>
            <TableCell className="max-w-[28rem] font-mono text-xs break-all">
              {r.problem === "relative" ? (
                r.url
              ) : (
                <a href={r.url} rel="noreferrer" className="underline decoration-current/40 underline-offset-3 hover:decoration-current">
                  {r.url}
                </a>
              )}
            </TableCell>
            <TableCell className={cn("text-xs", r.problem === "unverified" ? "text-muted-foreground" : "text-(--viz-critical)")}>
              <span className="font-medium">{WHAT[r.problem]}</span>
              {r.detail && <span className="text-muted-foreground"> · {r.detail}</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Broken links in template readmes from the daily check, the unverified
 * ones folded away under them. */
export function ReadmeLinks({ report }: { report: LinkReport }) {
  const refresh = useRefreshLinks();
  const [openUnverified, setOpenUnverified] = useState(false);
  const broken = report.problems.filter((p) => p.problem !== "unverified");
  const unverified = report.problems.filter((p) => p.problem === "unverified");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {report.checkedAt
            ? `${fmtNum(report.links)} links in ${fmtNum(report.readmes)} readmes, checked ${fmtAgo(report.checkedAt, new Date().toISOString())} ago`
            : "Not checked yet: the check runs daily at 06:38 UTC, or press Re-check."}
        </p>
        <Button size="xs" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Checking…" : "Re-check"}
        </Button>
      </div>
      {refresh.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          The check failed. Try again in a minute.
        </p>
      )}
      {broken.length ? (
        <LinkRows rows={broken} />
      ) : (
        report.checkedAt && <p className="text-sm text-muted-foreground">No broken links.</p>
      )}
      {unverified.length > 0 && (
        <>
          <Button size="xs" variant="ghost" aria-expanded={openUnverified} onClick={() => setOpenUnverified((o) => !o)}>
            {openUnverified ? "Hide unverified links" : `${fmtNum(unverified.length)} not verified (bot walls, rate limits, timeouts)`}
          </Button>
          {openUnverified && <LinkRows rows={unverified} />}
        </>
      )}
    </div>
  );
}
