import * as React from "react"

import { cn } from "~/lib/utils"

/** The consignment table: labels in a sticky header on paper, hairline row
 * rules, 8px rows, figures in mono and right-aligned. `box="scroll"` keeps a
 * long list inside a 36rem box whose bottom edge fades while rows remain;
 * `box="wide"` only scrolls sideways, for short tables wider than a phone. */
function Table({
  className,
  box = "scroll",
  boxClassName,
  ...props
}: React.ComponentProps<"table"> & { box?: "scroll" | "wide"; boxClassName?: string }) {
  return (
    <div
      data-slot="table-box"
      className={cn(box === "scroll" ? "scroll-fade max-h-[36rem] overflow-auto" : "overflow-x-auto", boxClassName)}
    >
      <table data-slot="table" className={cn("w-full text-sm", className)} {...props} />
    </div>
  )
}

/** The rule rides on the sticky cells; a row border would scroll away. */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0",
        className
      )}
      {...props}
    />
  )
}

function TableBody(props: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />
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

/** A column label. `numeric` right-aligns it over a column of figures. */
function TableHead({ className, numeric, ...props }: React.ComponentProps<"th"> & Numeric) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "pb-2 pl-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-0",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
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

/** A hairline-thin share-of-the-column bar beside a figure. `value` is 0–1. */
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
    <span data-slot="table-meter" aria-hidden className={cn("block h-1 w-14 rounded-full bg-muted", className)}>
      <span
        className="block h-full rounded-full dark:opacity-60"
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, background: color }}
      />
    </span>
  )
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableMeter, TableRow, TableRowHead }
