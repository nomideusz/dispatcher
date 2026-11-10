import { ChevronRight } from "lucide-react";
import { fmtDay, fmtUsd } from "~/lib/format";
import type { PredictorResult, TemplateVerdict, VerdictState, VerdictsResponse } from "~/queries/analytics";

/** The age in days at which a template is read: verdict.go's verdictReadDay. */
export const READ_DAY = 21;

type Verdicts = VerdictsResponse | null | undefined;

/** What each state means in plain words, with the numbers of the stored
 * test behind it. The server calls the two rules P1 (paid by the read day)
 * and P2 (2+ services and 2+ active projects); the page never does. */
export function verdictStates(all: Verdicts): { state: VerdictState; text: string }[] {
  const c = all?.checkpoint;
  const rise = c && all ? `added ${fmtUsd(all.minOutcomeRise)}+ by day ${c.horizon}` : "";
  // How a rule's test came out, or why its state isn't shown.
  const tested = (r: PredictorResult | undefined, rest: string) => {
    if (!r) return "Not shown until its test is stored: too few templates are old enough yet.";
    const counts = `${r.truePositives} of ${r.trueN} ${rise}, against ${r.falsePositives} of ${r.falseN} ${rest}`;
    if (r.result === "pass") return `Of the older templates like it, ${counts}.`;
    if (r.result === "fail") return `Not shown: it failed its test (${counts}).`;
    return `Not shown yet: too few templates to test it (${r.trueN} met it, ${r.falseN} didn't).`;
  };
  return [
    { state: "keep", text: `It had earned kickback by day ${READ_DAY}. ${tested(c?.p1, "that hadn't")}` },
    {
      state: "watch",
      text: `No kickback by day ${READ_DAY}, but it has 2+ services and 2+ active projects. ${tested(c?.p2, "without that")}`,
    },
    {
      state: "no signal",
      text: `Neither applies at day ${READ_DAY}. That is nothing to go on yet, not a reason to drop it${
        c ? `: ${c.p1.falsePositives} of ${c.p1.falseN} unpaid at day ${READ_DAY} still ${rise}` : ""
      }.`,
    },
    { state: "too early", text: `Under ${READ_DAY + 1} days old, so it hasn't been read.` },
    {
      state: "pre-tracking",
      text: `Already live when tracking began${all ? ` on ${fmtDay(all.trackedSince)}` : ""}, or no sample near its day ${READ_DAY}, so there is no reading.`,
    },
  ];
}

/** One template's state in words, with its frozen reading. */
export function verdictNote(v: TemplateVerdict, all: Verdicts) {
  const held = v.p1 ? "had earned kickback" : v.p2 ? "had 2+ services and 2+ active projects" : null;
  const text =
    v.state === "no signal" && held
      ? `It ${held} by day ${READ_DAY}, but that rule isn't shown until it passes its test, so it reads no signal.`
      : (verdictStates(all).find((s) => s.state === v.state)?.text ?? "");
  const r = v.reading;
  return r
    ? `${text} Its reading on ${fmtDay(r.at)}: ${fmtUsd(r.earnings)} earned, ${r.activeProjects} active ${r.activeProjects === 1 ? "project" : "projects"}.`
    : text;
}

/** The Verdict column explained, folded away: it matters once, then it is
 * noise on a page read daily. */
export function VerdictGuide({ verdicts, label = "What Verdict means" }: { verdicts: Verdicts; label?: string }) {
  const c = verdicts?.checkpoint;
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm font-medium text-foreground outline-none select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="mt-2 max-w-3xl space-y-2">
        <p>
          An early read on a new template: three weeks in, does it already show whether it will earn? Each template is read
          once, at {READ_DAY} days old, and the reading is frozen. A rule shows its state only after it is tested on older
          templates: it passes when at least half of the ones it flagged went on to earn, at twice the rate of the rest.
          {c && verdicts && (
            <>
              {" "}Tested once, on {fmtDay(c.judgedAt)}, over the <span className="tabular-nums">{c.n}</span> templates
              published since tracking began that had reached day {c.horizon}; the groups are small.
            </>
          )}
        </p>
        <dl className="space-y-2">
          {verdictStates(verdicts).map((s) => (
            <div key={s.state}>
              <dt className="font-medium text-foreground">{s.state}</dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
