const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("en-US");

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Full comma-separated dollars, never abbreviated; cents dropped once they
 * stop mattering ($10,000+). */
export function fmtUsd(v: number): string {
  return Math.abs(v) >= 10_000 ? usdWhole.format(v) : usd.format(v);
}

/** Axis-tick currency: whole comma-separated dollars. */
export function fmtUsdTick(v: number): string {
  return usdWhole.format(v);
}

export function fmtNum(v: number): string {
  return num.format(v);
}

/** Format an integer cent amount as USD. */
export function fmtCents(cents: number): string {
  return usd.format(cents / 100);
}

export function fmtSignedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** Compact "7d" / "26h" / "45m" distance between two instants. */
export function fmtAgo(fromIso: string, toIso: string): string {
  const ms = Math.abs(new Date(toIso).getTime() - new Date(fromIso).getTime());
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "2026-08-14" is a UTC day, so parse it as UTC midnight — parsing it locally
 * would slide a westward timezone back a day. */
export function dayDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

const shortDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Sep 7" for a UTC day key or an ISO instant. */
export function fmtDay(v: string): string {
  return shortDay.format(v.length === 10 ? dayDate(v) : new Date(v));
}

/** "Sun, Sep 7, 2026" for a UTC day key. */
export function fmtLongDay(date: string): string {
  return longDay.format(dayDate(date));
}

/** UTC day key of an ISO instant. */
export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Template names run long ("Chromium | Your Browser in the Cloud"); the part
 * before the first " | " is the name people know it by. */
export function shortName(name: string): string {
  return name.split(" | ")[0];
}
