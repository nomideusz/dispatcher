import { cn } from "~/lib/utils";

/** Dispatch mark — three staggered bars, not Railway's train. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className={cn("size-4", className)}
      fill="currentColor"
      aria-hidden
    >
      <rect x="1" y="3" width="8" height="2" />
      <rect x="7" y="7" width="8" height="2" />
      <rect x="1" y="11" width="8" height="2" />
    </svg>
  );
}

/** compact drops the name to the mark alone on phones, where the bar is full. */
export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2 font-bold tracking-[0.06em] uppercase", className)}>
      <Mark />
      <span className={compact ? "max-sm:sr-only" : undefined}>Dispatcher</span>
    </span>
  );
}
