// Pure promotion math — no DB, no React. Checkout and the screens share
// these so the number the customer is shown, the number validated at pay
// time, and the number written to the lines can never drift apart.
import { fmt } from "../format";
import { round2, toGoud, parseMin, type Coupon, type CouponMin } from "./types";

/** The slice of a cart line the promotion math needs (structural — the
 *  checkout CheckoutLine and the POS CartItem both satisfy it). */
export type CouponLine = { id: string; qty: number; lineTotal: number };

/**
 * Split a flat goud amount across lines proportionally to their totals.
 * Shares are cents, the residue lands on the largest line with slack, and
 * every share is floored at 0 — a line can never go negative.
 */
export function allocateDiscount(lineTotals: number[], amount: number): number[] {
  const n = lineTotals.length;
  const shares = new Array<number>(n).fill(0);
  const totals = lineTotals.map(t => Math.max(0, Number(t) || 0));
  const sum = round2(totals.reduce((s, t) => s + t, 0));
  let remaining = Math.min(Math.max(0, round2(Number(amount) || 0)), sum);
  if (remaining <= 0 || sum <= 0) return shares;
  for (let i = 0; i < n; i++) {
    if (totals[i] <= 0) continue;
    shares[i] = round2(remaining * (totals[i] / sum));
    if (shares[i] > totals[i]) shares[i] = totals[i];
  }
  let diff = round2(remaining - shares.reduce((s, x) => s + x, 0));
  if (diff !== 0) {
    const order = totals.map((t, i) => i).sort((a, b) => totals[b] - totals[a]);
    for (const i of order) {
      if (diff === 0) break;
      const slack = round2(totals[i] - shares[i]);
      const give = diff > 0 ? Math.min(diff, slack) : Math.max(diff, -shares[i]);
      if (give === 0) continue;
      shares[i] = round2(shares[i] + give);
      diff = round2(diff - give);
    }
  }
  return shares;
}

/** Indices of the lines the discount applies to: conditional → only the
 *  required products (when the coupon carries a product list); otherwise
 *  every line. */
export function eligibleIndices<T extends CouponLine>(lines: T[], coupon: Coupon): number[] {
  const min = parseMin(coupon.min);
  const req = min?.products ?? [];
  if (coupon.type === "conditional" && req.length) {
    const ids = new Set(req.map(p => String(p.product_id)));
    return lines.map((_, i) => i).filter(i => ids.has(String(lines[i].id)));
  }
  return lines.map((_, i) => i);
}

export function eligibleLines<T extends CouponLine>(lines: T[], coupon: Coupon): T[] {
  return eligibleIndices(lines, coupon).map(i => lines[i]);
}

export type MinCheck = { ok: true } | { ok: false; reason: string };

/** The purchase gate: products + qty, minimum spend, minimum item count —
 *  all present sub-conditions must hold (AND). */
export function checkMin(lines: CouponLine[], min: CouponMin | null | undefined): MinCheck {
  const m = min ?? null;
  if (!m) return { ok: true };
  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0));
  const items = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const req = m.products ?? [];
  for (const r of req) {
    const need = Number(r.qty) || 0;
    const have = lines.filter(l => String(l.id) === String(r.product_id)).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    if (have < need) return { ok: false, reason: `Ou dwe achte omwen ${need}× ${r.name}.` };
  }
  const minAmount = Number(m.min_amount ?? 0) || 0;
  if (minAmount > 0 && subtotal < minAmount) {
    return { ok: false, reason: `Achte omwen ${fmt(minAmount)} goud pou sèvi ak koupon sa a.` };
  }
  const minItems = Number(m.min_items ?? 0) || 0;
  if (minItems > 0 && items < minItems) {
    return { ok: false, reason: `Achte omwen ${minItems} atik pou sèvi ak koupon sa a.` };
  }
  return { ok: true };
}

/**
 * The flat goud amount for a coupon against a profit scope:
 * percentage-of-profit, rounded to whole goud, then capped.
 * Scope profit is Σ(lineTotal − cost) over the eligible lines.
 */
export function amountFromProfit(pct: number, scopeProfit: number, cap?: number | null): number {
  let amount = toGoud((Number(pct) || 0) / 100 * (Number(scopeProfit) || 0));
  if (amount < 0) amount = 0;
  const capNum = Number(cap ?? 0);
  if (capNum > 0) amount = Math.min(amount, toGoud(capNum));
  return amount;
}

/** Profit of a set of lines given their cost totals (index-aligned). */
export function scopeProfitOf(lines: CouponLine[], costs: number[]): number {
  return round2(lines.reduce((s, l, i) => s + ((Number(l.lineTotal) || 0) - (Number(costs[i]) || 0)), 0));
}

/** Final applied amount: never above the eligible lines' totals, never negative. */
export function clampToLines(amount: number, eligible: CouponLine[]): number {
  const sum = round2(eligible.reduce((s, l) => s + Math.max(0, Number(l.lineTotal) || 0), 0));
  return Math.max(0, Math.min(toGoud(amount), sum));
}

// ---- Customer-facing message ------------------------------------------
// The percentage is NEVER in the message and neither is a goud amount — the
// discount is calculated at payment. What IS always there: the exact
// condition (the configured minimums), the code and the expiry.

function conditionPhrase(min: CouponMin | null | undefined): string {
  const m = min ?? null;
  const parts: string[] = [];
  for (const r of m?.products ?? []) parts.push(`${r.qty}× ${r.name}`);
  const amount = Number(m?.min_amount ?? 0) || 0;
  if (amount > 0) parts.push(`omwen ${fmt(amount)} goud`);
  const items = Number(m?.min_items ?? 0) || 0;
  if (items > 0) parts.push(`omwen ${items} atik`);
  if (!parts.length) return "";
  return parts.join(" ak ");
}

export function buildCouponMessage(args: {
  customerName: string;
  code: string;
  expiresAt: string;
  type: Coupon["type"];
  min: CouponMin | null | undefined;
  proformatReceipt?: string | null;
  expiryLabel: string;
}): string {
  const who = args.customerName?.trim() ? args.customerName.trim() : "Ou";
  const cond = conditionPhrase(args.min);
  const expiry = args.expiryLabel;
  const head = `${who} —`;
  // No goud figure: the discount is calculated when the customer pays (% of
  // the cart's profit), so promising a number here would be one we can break.
  // The minimum is fixed at issuance, though — it must always be stated.
  const where = args.proformatReceipt ? ` sou proformat ${args.proformatReceipt}` : "";
  if (cond) return `${head} achte ${cond}${where} epi peye anvan ${expiry}, epi ou jwenn koupon ${args.code}.`;
  if (where) return `${head} koupon ${args.code} pou${where}, valab jouk ${expiry}.`;
  return `${head} koupon ${args.code} pou ou, valab jouk ${expiry}. Mande l nan magazen an!`;
}