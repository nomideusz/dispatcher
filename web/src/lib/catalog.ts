import type { TimelineTemplate } from "~/queries/analytics";
import type { PayerChain } from "~/queries/payouts";

export const DAY = 86_400_000;
/** A first invoice can take a month to arrive, so by this age a template has
 * had a fair chance to show use. */
export const FAIR_CHANCE_DAYS = 45;
export const HEALTH_FLOOR = 70;
/** Its October surge was short-lived, unexplained and has never earned, so it
 * doesn't count as use on Patterns. Other pages still show it. */
export const EDGE_CODE = "microsoft-edge";

export const publishedOn = (t: TimelineTemplate) => t.publishedAt ?? t.firstSeenAt;
export const ageDays = (t: TimelineTemplate, now: number) => (now - Date.parse(publishedOn(t))) / DAY;
export const earned30 = (t: TimelineTemplate) => t.earned30d ?? 0;
/** Running instances that count as use: Edge's surge is left out. */
export const inUse = (t: TimelineTemplate) => (t.code === EDGE_CODE ? 0 : (t.running ?? 0));
/** Old enough to judge, with nothing running and nothing earned in 30 days. */
export const notTakenUp = (t: TimelineTemplate, now: number) =>
  earned30(t) === 0 && (t.running ?? 0) === 0 && ageDays(t, now) >= FAIR_CHANCE_DAYS;

/** Whole days from publishing to the first kickback; null if it never paid. */
export const daysToPay = (t: TimelineTemplate) =>
  t.publishedAt && t.firstPaidAt
    ? Math.max(0, Math.floor((Date.parse(t.firstPaidAt) - Date.parse(t.publishedAt)) / DAY))
    : null;

export type Life = { age: number; paid: number | null };
export const lifeOf = (t: TimelineTemplate, now: number): Life | null =>
  t.publishedAt ? { age: Math.floor((now - Date.parse(t.publishedAt)) / DAY), paid: daysToPay(t) } : null;

/** Share paid by each day 0..last after publishing, Kaplan–Meier: each
 * day's payers over the templates still unpaid and at least that old, so a
 * young template that already paid counts now instead of once it ages past
 * the day. n is how many are that old; under min the share is null. */
export function paidCurve(life: Life[], last: number, min = 5) {
  let unpaid = 1;
  return Array.from({ length: last + 1 }, (_, day) => {
    const old = life.filter((l) => l.age >= day);
    const atRisk = old.filter((l) => l.paid == null || l.paid >= day).length;
    if (atRisk > 0) unpaid *= 1 - old.filter((l) => l.paid === day).length / atRisk;
    return { share: old.length < min ? null : 1 - unpaid, n: old.length };
  });
}

/** How a set of payer chains behaves. A second invoice "fell due" for every
 * chain that paid one or lapsed waiting for it; a later one for every repeat
 * invoice past the second or a lapse after it. The same rates Money's
 * forecast renews payers by. */
export function payerStats(chains: PayerChain[]) {
  const invoices = chains.reduce((s, p) => s + p.invoices, 0);
  const cents = chains.reduce((s, p) => s + p.totalCents, 0);
  const returned = chains.filter((p) => p.invoices >= 2).length;
  const kept = chains.reduce((s, p) => s + Math.max(0, p.invoices - 2), 0);
  return {
    payers: chains.length,
    active: chains.filter((p) => p.status !== "lapsed").length,
    perInvoice: invoices > 0 ? cents / 100 / invoices : null,
    returned,
    due: returned + chains.filter((p) => p.invoices === 1 && p.status === "lapsed").length,
    kept,
    keptDue: kept + chains.filter((p) => p.invoices >= 2 && p.status === "lapsed").length,
  };
}
