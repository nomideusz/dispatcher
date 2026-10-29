import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import * as React from "react"

import { cn } from "~/lib/utils"

/** Rows a table shows before "Show all"; app.css hides the rest. */
const ROWS = 500

/** The consignment table: labels in a header on paper, hairline row rules,
 * 8px rows, figures in mono and right-aligned. The page scrolls, never the
 * table: from xl the header sticks under the bar; below it the table
 * scrolls sideways when it is wider than the screen. Pass `rows` (the body's
 * row count) and past 500 it shows the first 500 with a "Show all" under
 * them, so a very long list never buries the sections after it. */
function Table({ className, rows = 0, ...props }: React.ComponentProps<"table"> & { rows?: number }) {
  const [all, setAll] = React.useState(false)
  const capped = rows > ROWS && !all
  return (
    <div data-slot="table-box" data-capped={capped || undefined}>
      {/* relative: screen-reader-only labels are absolutely placed, and
          would escape the sideways scroll and widen the whole page. */}
      <div className="relative overflow-x-auto xl:overflow-visible">
        <table data-slot="table" className={cn("w-full text-sm", className)} {...props} />
      </div>
      {capped && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2 cursor-pointer text-xs text-primary underline underline-offset-3"
        >
          Show all <span className="tabular-nums">{rows}</span>
        </button>
      )}
    </div>
  )
}

/** The rule rides on the sticky cells; a row border would scroll away. */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] xl:[&_th]:sticky xl:[&_th]:top-14 xl:[&_th]:z-10 [&_tr]:border-0",
        className
      )}
      {...props}
    />
  )
}

/** Rows band on wide screens (see app.css); a grouped body whose rules
 * already separate its groups turns it off. */
function TableBody({ banded = true, ...props }: React.ComponentProps<"tbody"> & { banded?: boolean }) {
  return <tbody data-slot="table-body" data-banded={banded || undefined} {...props} />
}

const RULES = {
  bottom: "border-b border-border/60 last:border-0",
  // A group heading: the rule opens the group instead of closing the row.
  top: "border-t border-border/60 first:border-0",
  none: "",
}

function TableRow({ className, rule = "bottom", ...props }: React.ComponentProps<"tr"> & { rule?: keyof typeof RULES }) {
  return <tr data-slot="table-row" className={cn(RULES[rule], className)} {...props} />
}

type Numeric = { numeric?: boolean }

/** What a column counts, under its label on hover, keyboard focus and tap,
 * and the label's description to screen readers. The label it hangs from is
 * the `group`. */
function Hint({ id, numeric, children }: Numeric & { id: string; children: React.ReactNode }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={cn(
        "invisible absolute top-full z-30 mt-1 w-max max-w-60 border bg-popover px-2 py-1.5 text-left text-xs font-normal whitespace-normal text-popover-foreground",
        "group-hover:visible group-focus-visible:visible pointer-coarse:group-focus:visible",
        numeric ? "right-0" : "left-0"
      )}
    >
      {children}
    </span>
  )
}

const HINTED = "underline decoration-current/40 decoration-dotted underline-offset-3"

/** A column label. `numeric` right-aligns it over a column of figures;
 * `hint` says what the column counts. */
function TableHead({
  className,
  numeric,
  hint,
  children,
  ...props
}: React.ComponentProps<"th"> & Numeric & { hint?: string }) {
  const id = React.useId()
  return (
    <th
      data-slot="table-head"
      className={cn(
        "pb-2 pl-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-0",
        numeric && "text-right",
        className
      )}
      {...props}
    >
      {hint ? (
        <span
          tabIndex={0}
          aria-describedby={id}
          className="group relative inline-block outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={HINTED}>{children}</span>
          <Hint id={id} numeric={numeric}>
            {hint}
          </Hint>
        </span>
      ) : (
        children
      )}
    </th>
  )
}

/** A column label that sorts the table. `sort` is set on the column the
 * table is sorted by; `hint` says what the column counts, so no glossary has
 * to sit above the table. */
function TableSortHead({
  sort,
  onSort,
  hint,
  numeric,
  className,
  children,
}: Numeric & {
  sort?: "ascending" | "descending"
  onSort: () => void
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <TableHead numeric={numeric} aria-sort={sort} className={className}>
      <button
        type="button"
        aria-describedby={hint && id}
        onClick={onSort}
        className={cn(
          "group relative inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          sort && "text-foreground"
        )}
      >
        <span className={cn(hint && HINTED)}>{children}</span>
        {hint && (
          <Hint id={id} numeric={numeric}>
            {hint}
          </Hint>
        )}
        {sort === "descending" ? (
          <ArrowDown className="size-3" />
        ) : sort === "ascending" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-30 group-hover:opacity-70 group-focus-visible:opacity-70" />
        )}
      </button>
    </TableHead>
  )
}

type SortValue = string | number | null | undefined

/** Sorting for a table whose columns all sort. A first press sorts figures
 * and dates biggest and newest first, and the `asc` keys (names, ranks,
 * orders) from the top; a second press flips it. Blanks stay last either
 * way, and ties keep the rows' own order. `head` renders a column's label. */
function useSort<R, K extends string>(
  rows: R[],
  value: (r: R, key: K) => SortValue,
  initial: NoInfer<K>,
  asc: NoInfer<K>[] = []
) {
  const [sort, setSort] = React.useState({ key: initial, desc: !asc.includes(initial) })
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key)
    const y = value(b, sort.key)
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)
    return sort.desc ? -c : c
  })
  const head = (key: K, label: React.ReactNode, props: Numeric & { hint?: string; className?: string } = {}) => {
    const on = sort.key === key
    return (
      <TableSortHead
        {...props}
        sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
        onSort={() => setSort({ key, desc: on ? !sort.desc : !asc.includes(key) })}
      >
        {label}
      </TableSortHead>
    )
  }
  return { rows: sorted, head }
}

const cell = (numeric?: boolean) =>
  cn("py-2 pl-3 first:pl-0", numeric && "text-right whitespace-nowrap tabular-nums")

/** A data cell. `numeric` sets a figure: mono, right-aligned, unbroken. */
function TableCell({ className, numeric, ...props }: React.ComponentProps<"td"> & Numeric) {
  return <td data-slot="table-cell" className={cn(cell(numeric), className)} {...props} />
}

/** The cell that names its row (the template, the payer), for screen
 * readers moving across a row. */
function TableRowHead({ className, numeric, ...props }: React.ComponentProps<"th"> & Numeric) {
  return <th data-slot="table-row-head" scope="row" className={cn(cell(numeric), "text-left font-normal", className)} {...props} />
}

/** A hairline-thin share-of-the-column bar beside a figure. `value` is 0–1.
 * The track is a hairline, so it survives the wide-screen row band. */
function TableMeter({
  value,
  color = "var(--chart-1)",
  className,
}: {
  value: number
  color?: string
  className?: string
}) {
  return (
    <span data-slot="table-meter" aria-hidden className={cn("block h-1 w-14 shrink-0 rounded-full bg-border", className)}>
      <span
        className="block h-full rounded-full dark:opacity-60"
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, background: color }}
      />
    </span>
  )
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead, TableSortHead, useSort }
