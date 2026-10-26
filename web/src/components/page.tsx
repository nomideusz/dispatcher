import { type ReactNode, useEffect } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

/** The page's title line: what the page is, how fresh it is, and its range. */
export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
      {children}
    </header>
  );
}

export function Section({
  id,
  title,
  text,
  children,
}: {
  id: string;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 space-y-3 pt-4 lg:scroll-mt-20">
      <div className="border-b border-foreground pb-2">
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="max-w-[75ch] text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </section>
  );
}

/** The docket grid: cells on paper, split by 1px hairlines. Add the columns. */
export const DOCKET = "grid gap-px border bg-border [&>*]:bg-background";

/** One docket cell: a label, its figure, and the notes under it. `small` sets
 * the figure for a strip inside a section, a step below the page's docket. */
export function DocketCell({
  label,
  value,
  small,
  children,
}: {
  label: string;
  /** null while loading. */
  value: ReactNode | null;
  small?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", small ? "px-4 py-3" : "p-4 sm:px-5")}>
      <div className={cn("font-semibold", small ? "text-xs" : "text-sm")}>{label}</div>
      {value == null ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <div
          className={cn(
            "leading-none font-semibold tabular-nums",
            small ? "text-xl" : "text-[1.625rem] sm:text-[2.125rem]",
          )}
        >
          {value}
        </div>
      )}
      {children && <div className={cn("space-y-0.5 text-muted-foreground", small ? "text-xs" : "text-sm")}>{children}</div>}
    </div>
  );
}

/** An inline figure inside sans prose, set in mono like every figure. */
export function Fig({ children }: { children: ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

/** Bring the URL's #target into view once the page has drawn it: the rows
 * and sections that links point at exist only after the data loads. */
export function useHashFollow(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const follow = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const block = hash.startsWith("t-") ? "center" : "start";
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [ready]);
}
