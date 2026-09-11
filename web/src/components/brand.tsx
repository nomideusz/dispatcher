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
      <rect x="1" y="3" width="8" height="2" rx="0.6" />
      <rect x="7" y="7" width="8" height="2" rx="0.6" />
      <rect x="1" y="11" width="8" height="2" rx="0.6" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-heading font-semibold", className)}>
      <Mark className="text-primary" />
      Dispatcher
    </span>
  );
}
