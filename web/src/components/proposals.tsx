import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Section } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtAgo } from "~/lib/format";
import { cn } from "~/lib/utils";
import { type Proposal, proposalsQuery, useAddProposals, useRemoveProposal } from "~/queries/proposals";

const STATUS: Record<Proposal["status"], { label: string; className: string }> = {
  "": { label: "New", className: "text-primary" },
  building: { label: "Building", className: "text-foreground" },
  published: { label: "Published", className: "text-(--viz-up)" },
  skipped: { label: "Skipped", className: "text-muted-foreground" },
};

/** The owner's inbox of apps to consider: paste links here, and the routine
 * answers each one with a status and a reply. */
export function Proposals() {
  const q = useQuery(proposalsQuery);
  const add = useAddProposals();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const now = new Date().toISOString();
  const waiting = q.data?.proposals.filter((p) => p.status === "").length ?? 0;

  return (
    <Section
      id="proposals"
      title="Proposals"
      text={`Paste links to apps worth a template, one or many, with an optional note. Claude reads them at the next routine check and answers each one here.${waiting ? ` ${waiting} waiting.` : ""}`}
    >
      <form
        className="grid gap-2 sm:grid-cols-[1fr_16rem_auto] sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ text, note }, { onSuccess: () => (setText(""), setNote("")) });
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="https://github.com/owner/repo"
          aria-label="Links to propose"
          className="min-h-16 border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Note for these links"
          className="h-8 border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={add.isPending || !text.trim()}>
          {add.isPending ? "Adding…" : "Propose"}
        </Button>
      </form>
      {add.isError && (
        <p role="alert" className="text-xs text-(--viz-critical)">
          Not added. Paste at least one link starting with https://.
        </p>
      )}

      {q.isPending && <Skeleton className="h-24 w-full" />}
      {q.isError && (
        <p role="alert" className="text-sm text-(--viz-critical)">
          Couldn&apos;t load proposals. Reload to try again.
        </p>
      )}
      {q.isSuccess && q.data.proposals.length > 0 && (
        <ul className="divide-y border">
          {q.data.proposals.map((p) => (
            <ProposalRow key={p.url} p={p} now={now} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProposalRow({ p, now }: { p: Proposal; now: string }) {
  const remove = useRemoveProposal();
  const s = STATUS[p.status] ?? STATUS[""];
  const name = p.url.replace(/^https?:\/\/(www\.)?(github\.com\/)?/, "");
  return (
    <li className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[5.5rem_1fr_auto] sm:gap-3">
      <span className={cn("text-xs font-medium uppercase tracking-wide", s.className)}>{s.label}</span>
      <div className="min-w-0 space-y-0.5">
        <a href={p.url} target="_blank" rel="noreferrer" className="break-all font-medium underline-offset-3 hover:underline">
          {name}
        </a>
        {p.note && <p className="text-muted-foreground">You: {p.note}</p>}
        {p.reply && <p>Claude: {p.reply}</p>}
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{fmtAgo(p.status ? p.updatedAt : p.createdAt, now)} ago</span>
        <button
          type="button"
          className="cursor-pointer underline underline-offset-3 hover:text-foreground disabled:opacity-50"
          disabled={remove.isPending}
          onClick={() => remove.mutate(p.url)}
          aria-label={`Remove ${name}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
