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

const hourMinute = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** "Sep 7 14:05" in UTC for an ISO instant, with the year when it isn't
 * this one: "Dec 3 2025 09:30". */
export function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const year = d.getUTCFullYear() === new Date().getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${shortDay.format(d)}${year} ${hourMinute.format(d)}`;
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

/** Short names for a catalog. Where several templates share one (eight
 * "Linux Desktop"s), each keeps its variant minus the words they all end
 * with: "Linux Desktop · Alpine KDE Plasma". */
export function shortNames(names: string[]): (name: string) => string {
  const groups = new Map<string, string[]>();
  for (const n of new Set(names)) {
    const s = shortName(n);
    groups.set(s, [...(groups.get(s) ?? []), n]);
  }
  const out = new Map<string, string>();
  for (const [s, group] of groups) {
    if (group.length < 2) continue;
    const rests = group.map((n) => n.slice(s.length + 3).split(" ").filter(Boolean));
    let k = 0;
    while (rests.every((r) => r.length > k + 1 && r.at(-1 - k) === rests[0].at(-1 - k))) k++;
    group.forEach((n, i) => {
      const variant = rests[i].slice(0, rests[i].length - k).join(" ");
      out.set(n, variant ? `${s} · ${variant}` : s);
    });
  }
  return (n) => out.get(n) ?? shortName(n);
}
