// Credit analytics — plain, rule-based arithmetic over rows the app already
// stores (credits, credit_payments, sales). No model, no scoring library:
// every number shown can be recomputed by hand from the tables, and every
// guidance string is paired with the numbers it came from so an owner (or an
// accountant) can check the reasoning.
//
// Decisions encoded here (owner-confirmed):
//   • Aging basis   = due date when it exists, else the credit's issue date.
//   • Collection    = cohort: of the credit ISSUED in a month, how much of it
//                     has been repaid by now.
//   • Limit         = median of credit issued in the last 12 months
//                     (falls back to all history when the window is empty).
//   • Guidance is advisory text only — nothing here blocks a sale.

const DAY = 86400000;
const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Collection-rate movement that counts as a direction (percentage points). */
const RATE_STEP_PP = 5;
/** Old-balance (60+ days) movement that counts as a direction (share). */
const OLD_BALANCE_STEP = 0.1;
/** Behaviour trend step for one customer (percentage points). */
const BEHAVIOR_STEP_PP = 10;

export type CreditRow = {
  id: string;
  customer_id?: string | null;
  sale_id?: string | null;
  store_id?: string | null;
  amount?: number | null;
  amount_paid?: number | null;
  balance?: number | null;
  status?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
  is_deleted?: number | boolean;
  /** Issue date — credits carry no created_at; callers fill this from the sale. */
  issued_at?: string | null;
};

export type PaymentRow = {
  credit_id?: string | null;
  debt_id?: string | null;
  amount?: number | null;
  created_at?: string | null;
  store_id?: string | null;
};

export type CustomerRow = {
  id: string;
  name?: string | null;
  phone?: string | null;
  credit_limit?: number | null;
  credit_limit_source?: string | null;
  store_id?: string | null;
  is_deleted?: number | boolean;
};

export type TrendPoint = { label: string; t: number; value: number };
export type Cohort = { key: string; label: string; issued: number; repaid: number; rate: number | null };
export type AgingBandKey = "lt30" | "d30_60" | "d60_90" | "g90";
export type AgingBand = { key: AgingBandKey; label: string; short: string; amount: number; count: number };
export type CreditDirection = "improving" | "stable" | "declining";
export type Behavior = "no-history" | "full-payer" | "partial-payer" | "improving" | "slipping";

const live = <T extends { is_deleted?: number | boolean }>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter(r => r && !r.is_deleted);

const parseTime = (s: string | null | undefined): number => {
  const t = Date.parse(String(s ?? ""));
  return isNaN(t) ? 0 : t;
};

const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const round1 = (v: number) => Math.round(v * 10) / 10;
const signPP = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(Math.round(v));

/** Short money for reasons/captions: G24.3k / G1.2M (chart + tooltip text). */
export function shortG(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000000) return `G${(v / 1000000).toFixed(1)}M`;
  if (a >= 1000) return `G${(v / 1000).toFixed(1)}k`;
  return `G${Math.round(v)}`;
}

export function median(values: number[]): number | null {
  const v = values.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Open balance — the stated balance when present, else amount − amount_paid. */
export function balanceOf(c: CreditRow): number {
  if (c.balance !== null && c.balance !== undefined) return Math.max(0, Number(c.balance) || 0);
  return Math.max(0, (Number(c.amount) || 0) - (Number(c.amount_paid) || 0));
}

/** Issue time: the sale's date when the caller resolved it, else updated_at. */
export function issueTime(c: CreditRow): number {
  return parseTime(c.issued_at ?? c.updated_at);
}

/** Aging basis: due date when it exists, else the issue date (owner decision). */
export function agingBasisTime(c: CreditRow): number {
  const due = parseTime(c.due_date);
  return due || issueTime(c);
}

/** Whole days past the aging basis; unknown dates read as "current" (0). */
export function daysPastDue(c: CreditRow, now: number): number {
  const t = agingBasisTime(c);
  if (!t) return 0;
  return Math.floor((now - t) / DAY);
}

export const AGING_BANDS: { key: AgingBandKey; label: string; short: string }[] = [
  { key: "lt30", label: "Under 30 days", short: "<30d" },
  { key: "d30_60", label: "30–60 days", short: "30–60" },
  { key: "d60_90", label: "60–90 days", short: "60–90" },
  { key: "g90", label: "90+ days", short: "90+" },
];

/**
 * Payments recorded against one credit at or before `t`.
 * (`credit_id` and the legacy `debt_id` both point at the credit.)
 */
function paidUpTo(c: CreditRow, payments: PaymentRow[], t: number): number {
  const id = String(c.id);
  let sum = 0;
  for (const p of payments ?? []) {
    if (String(p.credit_id ?? "") !== id && String(p.debt_id ?? "") !== id) continue;
    const pt = parseTime(p.created_at);
    if (!pt || pt <= t) sum += Number(p.amount) || 0;
  }
  return sum;
}

/**
 * Open balance as it stood at `t`. The stated balance is the source of truth
 * for "now" (it is what every other screen shows); a past snapshot is
 * amount − payments received by then, so a credit repaid before `t` is not
 * counted as open.
 */
function balanceAt(c: CreditRow, payments: PaymentRow[], t: number, now: number): number {
  if (t >= now) return balanceOf(c);
  const it = issueTime(c);
  if (it && it > t) return 0;
  return Math.max(0, (Number(c.amount) || 0) - paidUpTo(c, payments, t));
}

/**
 * Four aging bands over open balances at instant `t` — days measured from
 * the aging basis (due date, else issue date) as of that same instant.
 * `now` marks the present so today's snapshot uses the stated balance.
 */
export function agingBreakdown(
  credits: CreditRow[],
  payments: PaymentRow[] = [],
  t: number = Date.now(),
  now: number = t
): AgingBand[] {
  const out: AgingBand[] = AGING_BANDS.map(b => ({ ...b, amount: 0, count: 0 }));
  for (const c of live(credits)) {
    const bal = balanceAt(c, payments, t, now);
    if (!(bal > 0)) continue;
    const d = daysPastDue(c, t);
    const i = d < 30 ? 0 : d < 60 ? 1 : d < 90 ? 2 : 3;
    out[i].amount += bal;
    out[i].count += 1;
  }
  return out;
}

function oldBalance(aging: AgingBand[]): number {
  return aging[2].amount + aging[3].amount;
}

/** Credit issued minus payments received at instant `t` (never negative). */
export function outstandingAt(credits: CreditRow[], payments: PaymentRow[], t: number): number {
  let issued = 0;
  for (const c of live(credits)) {
    const it = issueTime(c);
    if (!it || it <= t) issued += Number(c.amount) || 0;
  }
  let paid = 0;
  for (const p of payments ?? []) {
    const pt = parseTime(p.created_at);
    if (!pt || pt <= t) paid += Number(p.amount) || 0;
  }
  return Math.max(0, issued - paid);
}

/** Month-end outstanding for the last `months` months (last point = now). */
export function outstandingSeries(credits: CreditRow[], payments: PaymentRow[], now: number, months = 6): TrendPoint[] {
  const cur = new Date(now);
  const pts: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const end = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i + 1, 0, 23, 59, 59, 999));
    const t = Math.min(end.getTime(), now);
    pts.push({ label: MONTH_LABEL[end.getUTCMonth()], t, value: outstandingAt(credits, payments, t) });
  }
  return pts;
}

const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string) => MONTH_LABEL[Number(key.slice(5, 7)) - 1] ?? key;

function lastMonthKeys(now: number, months: number): string[] {
  const cur = new Date(now);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1)));
  return keys;
}

/** Payments attributed to one credit (credit_id and legacy debt_id). */
export function paymentsFor(payments: PaymentRow[], creditIds: Set<string>): PaymentRow[] {
  return (payments ?? []).filter(p => creditIds.has(String(p.credit_id ?? "")) || creditIds.has(String(p.debt_id ?? "")));
}

/**
 * Collection rate, cohort style: for each of the last `months` months, the
 * credit ISSUED that month and how much of it has been repaid by now.
 * Months with no issuance are dropped (a trend needs real cohorts).
 */
export function collectionCohorts(credits: CreditRow[], payments: PaymentRow[], now: number, months = 6): Cohort[] {
  const groups = new Map<string, CreditRow[]>();
  for (const c of live(credits)) {
    const it = issueTime(c);
    if (!it) continue;
    const k = monthKey(it);
    const arr = groups.get(k) ?? [];
    arr.push(c);
    groups.set(k, arr);
  }
  const out: Cohort[] = [];
  for (const key of lastMonthKeys(now, months)) {
    const rows = groups.get(key);
    if (!rows?.length) continue;
    const ids = new Set(rows.map(r => String(r.id)));
    const issued = rows.reduce((a, c) => a + (Number(c.amount) || 0), 0);
    if (!(issued > 0)) continue;
    const repaid = paymentsFor(payments, ids).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    out.push({ key, label: monthLabel(key), issued, repaid, rate: Math.min(100, (repaid / issued) * 100) });
  }
  return out;
}

export type CreditHealth = {
  outstanding: number;
  outstanding30dAgo: number;
  delta: { amount: number; pct: number } | null;
  trend: TrendPoint[];
  aging: AgingBand[];
  aging30dAgo: AgingBand[];
  oldBalance: number;
  oldBalance30dAgo: number;
  cohorts: Cohort[];
  direction: CreditDirection;
  headline: string;
  guidance: string;
  reasons: string[];
  hasData: boolean;
};

const HEADLINE: Record<CreditDirection, string> = {
  improving: "Credit health is improving",
  stable: "Credit health is stable",
  declining: "Credit health is declining",
};
const GUIDANCE: Record<CreditDirection, string> = {
  improving: "Conditions support extending more credit.",
  stable: "Conditions are steady — extend credit as you normally do.",
  declining: "Exercise caution before issuing new credit.",
};

/**
 * Direction of a cohort-rate series: the last up-to-2 cohorts vs the ones
 * before them. Needs at least two cohorts to say anything at all.
 */
function cohortTrend(rates: number[]): { recent: number; prior: number; step: number } | null {
  if (rates.length < 2) return null;
  const recentLen = Math.min(2, rates.length - 1);
  const recent = mean(rates.slice(-recentLen));
  const prior = mean(rates.slice(0, rates.length - recentLen));
  return { recent, prior, step: recent - prior };
}

/**
 * Business-wide signal. Two inputs, both directional:
 *   1. collection-rate cohorts (recent vs earlier, ≥5pp counts),
 *   2. balances 60+ days old, now vs 30 days ago (≥10% counts).
 * Sum: ≥1 improving, ≤−1 declining, otherwise stable. Advisory only.
 */
export function creditHealth(args: {
  credits: CreditRow[];
  payments: PaymentRow[];
  now?: number;
  months?: number;
}): CreditHealth {
  const now = args.now ?? Date.now();
  const months = args.months ?? 6;
  const { credits, payments } = args;

  const trend = outstandingSeries(credits, payments, now, months);
  const outstanding = outstandingAt(credits, payments, now);
  const outstanding30dAgo = outstandingAt(credits, payments, now - 30 * DAY);
  const delta = outstanding30dAgo > 0
    ? { amount: outstanding - outstanding30dAgo, pct: ((outstanding - outstanding30dAgo) / outstanding30dAgo) * 100 }
    : null;

  const aging = agingBreakdown(credits, payments, now, now);
  const aging30dAgo = agingBreakdown(credits, payments, now - 30 * DAY, now);
  const oldNow = oldBalance(aging);
  const oldBefore = oldBalance(aging30dAgo);
  const cohorts = collectionCohorts(credits, payments, now, months);

  const reasons: string[] = [];
  let rateDir = 0;
  const rates = cohorts.map(c => c.rate).filter((r): r is number => r != null);
  const rateTrend = cohortTrend(rates);
  if (rateTrend) {
    if (rateTrend.step >= RATE_STEP_PP) rateDir = 1;
    else if (rateTrend.step <= -RATE_STEP_PP) rateDir = -1;
    reasons.push(
      `Collection rate ${Math.round(rateTrend.prior)}% → ${Math.round(rateTrend.recent)}% (${signPP(rateTrend.step)}pp)`
    );
  } else {
    reasons.push(rates.length ? "One collection cohort so far — no trend yet" : "No issued credit in the last 6 months");
  }

  let ageDir = 0;
  if (oldBefore > 0) {
    const change = (oldNow - oldBefore) / oldBefore;
    if (change <= -OLD_BALANCE_STEP) ageDir = 1;
    else if (change >= OLD_BALANCE_STEP) ageDir = -1;
    reasons.push(`Balances 60+ days ${shortG(oldBefore)} → ${shortG(oldNow)} (${signPP(change * 100)}%)`);
  } else if (oldNow > 0) {
    ageDir = -1;
    reasons.push(`Balances 60+ days appeared: ${shortG(oldNow)}`);
  } else {
    reasons.push("No balances older than 60 days");
  }

  const score = rateDir + ageDir;
  const direction: CreditDirection = score >= 1 ? "improving" : score <= -1 ? "declining" : "stable";
  const hasData = live(credits).length > 0;

  return {
    outstanding,
    outstanding30dAgo,
    delta,
    trend,
    aging,
    aging30dAgo,
    oldBalance: oldNow,
    oldBalance30dAgo: oldBefore,
    cohorts,
    direction,
    headline: HEADLINE[direction],
    guidance: GUIDANCE[direction],
    reasons,
    hasData,
  };
}

export type CustomerCreditRow = {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  openCount: number;
  daysOverdue: number;
  dueAt: number | null;
  limit: number | null;
};

/** One row per customer with credit history: balance + how overdue it is. */
export function customerCreditRows(
  credits: CreditRow[],
  customers: CustomerRow[],
  now: number
): CustomerCreditRow[] {
  const names = new Map(live(customers).map(c => [String(c.id), c]));
  const byCustomer = new Map<string, CreditRow[]>();
  for (const c of live(credits)) {
    const id = String(c.customer_id ?? "");
    if (!id) continue;
    const arr = byCustomer.get(id) ?? [];
    arr.push(c);
    byCustomer.set(id, arr);
  }
  const rows: CustomerCreditRow[] = [];
  for (const [id, list] of byCustomer) {
    const cust = names.get(id);
    let balance = 0;
    let openCount = 0;
    let daysOverdue = 0;
    let dueAt: number | null = null;
    for (const c of list) {
      const bal = balanceOf(c);
      balance += bal;
      if (bal > 0) {
        openCount += 1;
        daysOverdue = Math.max(daysOverdue, daysPastDue(c, now));
        const basis = agingBasisTime(c);
        if (basis) dueAt = dueAt === null ? basis : Math.min(dueAt, basis);
      }
    }
    rows.push({
      id,
      name: String(cust?.name ?? "Unknown customer"),
      phone: cust?.phone ?? null,
      balance,
      openCount,
      daysOverdue: balance > 0 ? daysOverdue : 0,
      dueAt,
      limit: cust?.credit_limit === null || cust?.credit_limit === undefined || Number(cust.credit_limit) === 0
        ? null : Number(cust.credit_limit),
    });
  }
  return rows;
}

export type CustomerSort = "overdue" | "balance" | "name";

/** Default = soonest-overdue first (most overdue at the top, paid last). */
export function sortCustomerRows(rows: CustomerCreditRow[], mode: CustomerSort): CustomerCreditRow[] {
  const arr = [...rows];
  if (mode === "name") return arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  if (mode === "balance") return arr.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  return arr.sort((a, b) => {
    const aOpen = a.balance > 0;
    const bOpen = b.balance > 0;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen && (a.daysOverdue > 0 || b.daysOverdue > 0)) {
      if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
      return b.balance - a.balance;
    }
    const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
    const bd = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return b.balance - a.balance;
  });
}

export type HistoryPoint = { key: string; label: string; issued: number; paid: number };

/** One payment, paired with the credit it paid down. */
export type PaymentHistoryRow = {
  at: number;
  amount: number;
  /** Whole days from the credit's issue date to this payment (null when unknown). */
  daysToClear: number | null;
};

/**
 * One customer's payments, newest first. `daysToClear` is measured from the
 * credit's issue date — the same clock the aging bands use — so the table and
 * the pattern chart read as one story: how long that money took to come back.
 */
export function customerPaymentHistory(args: {
  customerId: string;
  credits: CreditRow[];
  payments: PaymentRow[];
}): PaymentHistoryRow[] {
  const mine = live(args.credits).filter(c => String(c.customer_id ?? "") === String(args.customerId));
  const byId = new Map(mine.map(c => [String(c.id), c]));
  const rows = paymentsFor(args.payments ?? [], new Set(byId.keys()));
  const out: PaymentHistoryRow[] = [];
  for (const p of rows) {
    const at = parseTime(p.created_at);
    if (!at) continue;
    const credit = byId.get(String(p.credit_id ?? p.debt_id ?? ""));
    const issue = credit ? issueTime(credit) : 0;
    out.push({
      at,
      amount: Number(p.amount) || 0,
      daysToClear: issue && at >= issue ? Math.round((at - issue) / DAY) : null,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export type CustomerProfile = {
  customerId: string;
  name: string;
  phone: string | null;
  balance: number;
  openCount: number;
  totalCount: number;
  daysOverdue: number;
  dueAt: number | null;
  history: HistoryPoint[];
  /** Repayment rate by month (same cohort rule as the business report). */
  cohorts: Cohort[];
  behavior: Behavior;
  behaviorWhy: string;
  currentLimit: number | null;
  currentLimitSource: string | null;
  suggestedLimit: number | null;
  limitSamples: number[];
  limitWindow: "12m" | "all" | "none";
  issuedTotal: number;
  paidTotal: number;
  paymentCount: number;
  lastPaymentAt: string | null;
  guidance: { headline: string; body: string };
};

const BEHAVIOR_GUIDANCE: Record<Behavior, { headline: string; body: string }> = {
  "full-payer": {
    headline: "Strong repayment history",
    body: "This customer has a strong repayment history. Increasing their limit may be reasonable.",
  },
  "partial-payer": {
    headline: "Partial repayment pattern",
    body: "This customer repays part of what they owe. Keeping the current limit is reasonable for now.",
  },
  improving: {
    headline: "Repayments improving",
    body: "This customer's payment behavior has improved recently. Increasing their limit may be reasonable.",
  },
  slipping: {
    headline: "Payments weakening",
    body: "This customer's payment behavior has weakened recently. Consider holding or reducing their limit.",
  },
  "no-history": {
    headline: "No credit history yet",
    body: "This customer has no credit history. Set a starting limit from what you already know about them.",
  },
};

/**
 * One customer's decision-support view. Behaviour comes from their cohort
 * TREND (recent months vs earlier), never from a single snapshot; the limit
 * is the median of their last 12 months of credit; the guidance is a
 * suggestion with the arithmetic next to it.
 */
export function customerProfile(args: {
  customerId: string;
  credits: CreditRow[];
  payments: PaymentRow[];
  customers?: CustomerRow[];
  now?: number;
  historyMonths?: number;
}): CustomerProfile {
  const now = args.now ?? Date.now();
  const historyMonths = args.historyMonths ?? 8;
  const cust = live(args.customers ?? []).find(c => String(c.id) === String(args.customerId)) ?? null;
  const mine = live(args.credits).filter(c => String(c.customer_id ?? "") === String(args.customerId));
  const ids = new Set(mine.map(c => String(c.id)));
  const payments = paymentsFor(args.payments ?? [], ids);

  let balance = 0;
  let openCount = 0;
  let daysOverdue = 0;
  let dueAt: number | null = null;
  let issuedTotal = 0;
  for (const c of mine) {
    const bal = balanceOf(c);
    issuedTotal += Number(c.amount) || 0;
    if (bal > 0) {
      balance += bal;
      openCount += 1;
      daysOverdue = Math.max(daysOverdue, daysPastDue(c, now));
      const basis = agingBasisTime(c);
      if (basis) dueAt = dueAt === null ? basis : Math.min(dueAt, basis);
    }
  }
  const paidTotal = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const lastPayment = payments
    .map(p => parseTime(p.created_at))
    .filter(t => t > 0)
    .sort((a, b) => b - a)[0] ?? null;

  // Monthly history (issued vs paid) for the chart.
  const keys = lastMonthKeys(now, historyMonths);
  const history: HistoryPoint[] = keys.map(key => ({ key, label: monthLabel(key), issued: 0, paid: 0 }));
  const index = new Map(history.map(h => [h.key, h]));
  for (const c of mine) {
    const it = issueTime(c);
    if (!it) continue;
    const row = index.get(monthKey(it));
    if (row) row.issued += Number(c.amount) || 0;
  }
  for (const p of payments) {
    const pt = parseTime(p.created_at);
    if (!pt) continue;
    const row = index.get(monthKey(pt));
    if (row) row.paid += Number(p.amount) || 0;
  }

  // Cohort rates for THIS customer (months with issuance only).
  const cohorts = collectionCohorts(mine, args.payments ?? [], now, historyMonths);
  const rates = cohorts.map(c => c.rate).filter((r): r is number => r != null);

  let behavior: Behavior = "partial-payer";
  let behaviorWhy = "";
  if (!mine.length) {
    behavior = "no-history";
    behaviorWhy = "No credit has been issued to this customer yet.";
  } else if (balance <= 0) {
    behavior = "full-payer";
    behaviorWhy = `All ${mine.length} credit${mine.length === 1 ? "" : "s"} repaid — ${shortG(paidTotal)} of ${shortG(issuedTotal)} issued.`;
  } else {
    // Trend over cohorts, never a single snapshot: the last cohorts vs the
    // ones before them (≥10pp apart in either direction is a real change).
    const rateTrend = cohortTrend(rates);
    let trended: { behavior: "improving" | "slipping"; why: string } | null = null;
    if (rateTrend) {
      const { recent, prior, step } = rateTrend;
      const why = `Recent credit repaid ${Math.round(recent)}% on average vs ${Math.round(prior)}% before (${signPP(step)}pp).`;
      if (step >= BEHAVIOR_STEP_PP) trended = { behavior: "improving", why };
      else if (step <= -BEHAVIOR_STEP_PP) trended = { behavior: "slipping", why };
    }
    behavior = trended?.behavior ?? "partial-payer";
    behaviorWhy = trended?.why ?? `Repaid ${shortG(paidTotal)} of ${shortG(issuedTotal)} issued; ${shortG(balance)} still open.`;
  }

  // Suggested limit: median of the last 12 months of credit (fallback: all).
  const cutoff = now - 365 * DAY;
  const recent = mine.filter(c => issueTime(c) >= cutoff && issueTime(c) > 0);
  const windowRows = recent.length ? recent : mine;
  const samples = windowRows.map(c => Number(c.amount) || 0).filter(v => v > 0);
  const suggestedLimit = median(samples);
  const limitWindow: CustomerProfile["limitWindow"] = suggestedLimit === null ? "none" : recent.length ? "12m" : "all";

  const currentLimit = cust?.credit_limit === null || cust?.credit_limit === undefined || Number(cust.credit_limit) === 0
    ? null : Number(cust.credit_limit);

  return {
    customerId: String(args.customerId),
    name: String(cust?.name ?? "Unknown customer"),
    phone: cust?.phone ?? null,
    balance,
    openCount,
    totalCount: mine.length,
    daysOverdue: balance > 0 ? daysOverdue : 0,
    dueAt,
    history,
    cohorts,
    behavior,
    behaviorWhy,
    currentLimit,
    currentLimitSource: cust?.credit_limit_source ?? null,
    suggestedLimit,
    limitSamples: samples.sort((a, b) => b - a),
    limitWindow,
    issuedTotal,
    paidTotal,
    paymentCount: payments.length,
    lastPaymentAt: lastPayment ? new Date(lastPayment).toISOString() : null,
    guidance: BEHAVIOR_GUIDANCE[behavior],
  };
}
