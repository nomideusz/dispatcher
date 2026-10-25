import { type ReactNode, useEffect } from "react";

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
