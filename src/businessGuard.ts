// Business Guard — pure math behind the Business Guard report.
//
// Three tabs, all computed here so the screen only reads + renders:
//   Tab 1  Weekly action queue — deficits awaiting a decision, flag state,
//          month attribution for resolutions.
//   Tab 2  Business health — revenue/transactions per hour worked, staffing
//          efficiency, best day/time, staffing-vs-sales match, net profit
//          (gross − unrecovered deficits + recovered deficits − salaries,
//          current week's deficits excluded, flagged as not comprehensive).
//   Tab 3  Per-employee profiles — revenue, transactions, hours, activity
//          heat map (idle vs active), deficit history; manager stats cascade
//          to their own cashiers, owner sees everyone.
//
// Conventions: all instants are epoch ms or ISO strings; every DAY/week/month
// key is computed in UTC (the app writes `toISOString()` values everywhere, so
// UTC keys round-trip regardless of device timezone). No DB, no React, no
// formatting — this file stays importable from a bare `tsx` test.

export type Role = "owner" | "admin" | "manager" | "cashier";

export const DAY = 86400000;
const HOURS_SLOT = 3; // "best time period" bucket size

// ── time keys ──────────────────────────────────────────────────────────────

export function toDate(d: Date | string | number): Date {
  if (d instanceof Date) return d;
  if (typeof d === "number") return new Date(d);
  // "YYYY-MM-DD" → UTC midnight (matches how the app stamps dates)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00Z`);
  return new Date(d);
}

export function epoch(d: Date | string | number): number {
  return toDate(d).getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC calendar day, YYYY-MM-DD. */
export function dayKey(d: Date | string | number): string {
  const t = toDate(d);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Local (device) business day, YYYY-MM-DD — the store's day flips at local
 *  midnight (Haiti UTC−4), NOT at 00:00 UTC. Use this for every "today" key
 *  (report_date, hand ids, check_date) and every day-scoped lookup. */
export function localDayKey(d?: Date | string | number): string {
  const t = d === undefined ? new Date() : d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return new Date().toISOString().slice(0, 10);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** UTC-instant range [start, end) covering a local day key. Row timestamps
 *  are UTC ISO strings, so day filters must compare instants (SQL >= / <)
 *  — substring dates would mis-slice around local midnight. */
export function localDayRange(day: string): [string, string] {
  const [y, m, d] = String(day ?? "").split("-").map(Number);
  const start = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? new Date(y, (m || 1) - 1, d || 1)
    : new Date();
  const lo = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const hi = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return [lo.toISOString(), hi.toISOString()];
}

/** True when an ISO timestamp falls inside the given local day key. */
export function inLocalDay(ts: any, day: string): boolean {
  const s = String(ts ?? "");
  if (!s) return false;
  const [a, b] = localDayRange(day);
  return s >= a && s < b;
}

/** UTC month, YYYY-MM (resolutions count toward the month resolved). */
export function monthKey(d: Date | string | number): string {
  return dayKey(d).slice(0, 7);
}

/** UTC day from a YYYY-MM-DD key, shifted by n days. */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * DAY;
  return dayKey(t);
}

/** Days from a → b (b − a), calendar days. */
export function daysBetween(a: string | number | Date, b: string | number | Date): number {
  return Math.round((Date.parse(`${dayKey(b)}T00:00:00Z`) - Date.parse(`${dayKey(a)}T00:00:00Z`)) / DAY);
}

/** Monday (UTC) of the week containing d, YYYY-MM-DD. */
export function weekStart(d: Date | string | number): string {
  const day = dayKey(d);
  const dow = (Date.parse(`${day}T00:00:00Z`) / DAY + 3) % 7; // epoch day 4 = 1970-01-05 = Monday
  return addDays(day, -dow);
}

/** Which week bucket a day falls in, relative to the current week. */
export function weekBucket(day: string, now: number | string | Date): "this" | "last" | "older" {
  const w = weekStart(now);
  const dw = weekStart(day);
  if (dw === w) return "this";
  if (dw === addDays(w, -7)) return "last";
  return Date.parse(`${dw}T00:00:00Z`) > Date.parse(`${w}T00:00:00Z`) ? "this" : "older";
}

/** "Mon".."Sun" labels in period order. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** 0 = Monday (matches weekStart). */
export function weekdayIndex(d: Date | string | number): number {
  return (Date.parse(`${dayKey(d)}T00:00:00Z`) / DAY + 3) % 7; // 1970-01-05 was a Monday
}

/** 3-hour slot label, e.g. "15:00–18:00". */
export function slotLabel(hour: number): string {
  const end = (hour + HOURS_SLOT) % 24;
  return `${pad(hour)}:00–${pad(end)}:00`;
}

// ── deficits ───────────────────────────────────────────────────────────────

export type Resolution = "paid" | "salary" | "forgiven";
export type DeficitRow = {
  id: string;
  store_id?: string | null;
  cashier_id: string;
  date: string;
  deficit: number;
  status?: string | null;          // open | resolved (legacy 'paid')
  resolution?: string | null;      // paid | salary | forgiven (legacy waived_negligible)
  resolution_reason?: string | null;
  report_id?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
  notes?: string | null;
};

export type DeficitState = "paid" | "salary" | "forgiven" | "open";

/** Normalized decision state of a deficit row. */
export function deficitState(d: DeficitRow): DeficitState {
  const r = String(d?.resolution ?? "").toLowerCase();
  if (r === "paid" || r === "salary" || r === "forgiven") return r;
  if (r === "waived_negligible") return "forgiven"; // legacy report-review vocabulary
  const s = String(d?.status ?? "").toLowerCase();
  if (s === "paid") return "paid";                 // legacy: resolution lived in status
  if (s === "resolved") return "paid";             // resolved without a known decision → cash came back
  return "open";
}

/** Cash the business got back (paid by employee, or taken from salary). */
export function isRecovered(d: DeficitRow): boolean {
  const s = deficitState(d);
  return s === "paid" || s === "salary";
}

/** Genuine loss: forgiven, or still open (left unpaid). */
export function isUnrecovered(d: DeficitRow): boolean {
  return !isRecovered(d);
}

/** Resolution attribution month — the month it is resolved in, not logged in. */
export function resolvedMonth(d: DeficitRow): string | null {
  const at = d?.resolved_at;
  return at ? monthKey(at) : null;
}

export type ResolvedMonth = {
  month: string;
  total: number;
  paid: number;
  salary: number;
  forgiven: number;
  count: number;
};

/** Resolutions grouped by the month they were resolved in. */
export function resolutionsByMonth(deficits: DeficitRow[], fromMs?: number, toMs?: number): ResolvedMonth[] {
  const by = new Map<string, ResolvedMonth>();
  for (const d of deficits ?? []) {
    const m = resolvedMonth(d);
    if (!m) continue;
    const t = epoch(d.resolved_at!);
    if (fromMs != null && t < fromMs) continue;
    if (toMs != null && t >= toMs) continue;
    const s = deficitState(d);
    if (s === "open") continue;
    let row = by.get(m);
    if (!row) { row = { month: m, total: 0, paid: 0, salary: 0, forgiven: 0, count: 0 }; by.set(m, row); }
    row.total += Number(d?.deficit ?? 0);
    row[s] += Number(d?.deficit ?? 0);
    row.count += 1;
  }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export type FlagResult = {
  /** % of the employee's own salary (passed in — stored in _meta). */
  pct: number;
  salary: number;
  threshold: number;
  /** Worst single deficit, regardless of resolution state. */
  singleWorst: number;
  /** Sum of deficits logged in the rolling 90-day window. */
  rolling90: number;
  flagged: boolean;
  reason: "single" | "rolling90" | null;
};

/**
 * Threshold flagging: a percentage of the employee's OWN salary. A deficit is
 * flagged when a single one reaches that threshold, or when the running total
 * within a rolling 90-day window crosses it — regardless of resolution state.
 */
export function deficitFlag(deficits: DeficitRow[], salary: number, now: number | string | Date, pct: number): FlagResult {
  const threshold = Math.max(0, Number(salary ?? 0)) * Math.max(0, pct);
  let singleWorst = 0;
  let rolling90 = 0;
  const cutoff = dayKey(addDays(dayKey(now), -89)); // 90-day window inclusive of today
  for (const d of deficits ?? []) {
    const amt = Number(d?.deficit ?? 0);
    if (amt > singleWorst) singleWorst = amt;
    if (dayKey(d.date) >= cutoff) rolling90 += amt;
  }
  const hitSingle = threshold > 0 && singleWorst >= threshold;
  const hitRolling = threshold > 0 && rolling90 >= threshold;
  return {
    pct, salary: Number(salary ?? 0), threshold, singleWorst, rolling90,
    flagged: hitSingle || hitRolling,
    reason: hitSingle ? "single" : hitRolling ? "rolling90" : null,
  };
}

export type QueueRow = {
  id: string;
  cashierId: string;
  cashierName: string;
  cashierRole: Role | string;
  day: string;
  createdAt: string;
  amount: number;
  state: DeficitState;
  resolutionReason: string | null;
  resolvedAt: string | null;
  resolvedMonth: string | null;
  daysOpen: number;
  bucket: "this" | "last" | "older";
  flagged: boolean;
  flagThreshold: number;
  flagReason: "single" | "rolling90" | null;
  /** Source daily report (cashier_deficits.report_id) — drill-in for investigation. */
  reportId?: string;
};

export type GuardEmployee = {
  id: string;
  full_name?: string | null;
  role?: string | null;
  salary?: number | null;
  store_id?: string | null;
  is_active?: number | null;
};

/**
 * Tab 1 rows: everything still awaiting a decision (never lost, whatever its
 * age) plus everything resolved in the last two weeks, newest week first —
 * open rows ahead of settled ones inside each week.
 */
export function queueRows(
  deficits: DeficitRow[],
  employees: GuardEmployee[],
  now: number | string | Date,
  flagPct: number
): QueueRow[] {
  const byId = new Map(employees.map(e => [String(e.id), e]));
  const nowMs = epoch(now);
  const out: QueueRow[] = [];
  for (const d of deficits ?? []) {
    const day = dayKey(d.date);
    const state = deficitState(d);
    const resolvedT = d.resolved_at ? epoch(d.resolved_at) : null;
    const bucket = weekBucket(day, now);
    const fresh = resolvedT !== null && nowMs - resolvedT < 14 * DAY;
    if (state !== "open" && !fresh) continue; // settled long ago → out of the queue
    const emp = byId.get(String(d.cashier_id));
    const flag = deficitFlag([d], Number(emp?.salary ?? 0), now, flagPct); // single-deficit view
    const rolling = deficitFlag(deficits.filter(x => String(x.cashier_id) === String(d.cashier_id)), Number(emp?.salary ?? 0), now, flagPct);
    out.push({
      id: String(d.id),
      cashierId: String(d.cashier_id),
      cashierName: String(emp?.full_name ?? d.cashier_id),
      cashierRole: String(emp?.role ?? "cashier"),
      day,
      createdAt: String(d.created_at ?? `${day}T00:00:00Z`),
      amount: Number(d?.deficit ?? 0),
      state,
      resolutionReason: d.resolution_reason ?? null,
      resolvedAt: d.resolved_at ?? null,
      resolvedMonth: resolvedMonth(d),
      daysOpen: state === "open" ? Math.max(0, daysBetween(day, now)) : 0,
      bucket,
      flagged: flag.flagged || rolling.flagged,
      flagThreshold: rolling.threshold,
      flagReason: rolling.flagged ? rolling.reason : flag.flagged ? flag.reason : null,
    });
  }
  const bucketRank = (b: string) => (b === "this" ? 0 : b === "last" ? 1 : 2);
  out.sort((a, b) =>
    bucketRank(a.bucket) - bucketRank(b.bucket) ||
    (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) ||
    b.day.localeCompare(a.day) ||
    b.amount - a.amount
  );
  return out;
}

// ── permissions (hierarchical deficit logging) ─────────────────────────────

/**
 * Managers log for their cashiers; admins for managers and cashiers; owners
 * for everyone (including other owners). Cashiers log for nobody.
 */
const DEFICIT_SCOPE: Record<Role, Role[]> = {
  owner: ["owner", "admin", "manager", "cashier"],
  admin: ["manager", "cashier"],
  manager: ["cashier"],
  cashier: [],
};

export function canLogDeficitFor(actorRole: Role | string, targetRole: Role | string): boolean {
  const a = String(actorRole) as Role;
  const t = String(targetRole) as Role;
  return (DEFICIT_SCOPE[a] ?? []).includes(t);
}

/** Roles whose records an actor may see/act on (tab 3 scoping too). */
export function scopeRoles(actorRole: Role | string): Role[] {
  return DEFICIT_SCOPE[String(actorRole) as Role] ?? [];
}

export function isManagerScope(actorRole: Role | string): boolean {
  return actorRole === "owner" || actorRole === "admin" || actorRole === "manager";
}

// ── time worked ────────────────────────────────────────────────────────────

export type Session = { cashierId: string; start: number; end: number };

/** Shift rows → clamped [start, end] sessions (open shift ends at `now`). */
export function sessionsFromShifts(shifts: any[], now: number | string | Date): Session[] {
  const nowMs = epoch(now);
  const out: Session[] = [];
  for (const s of shifts ?? []) {
    const start = s?.start_time ? epoch(s.start_time) : null;
    if (start == null || isNaN(start)) continue;
    let end = s?.end_time ? epoch(s.end_time) : nowMs;
    if (isNaN(end) || end < start) end = nowMs;
    out.push({ cashierId: String(s?.cashier_id ?? ""), start, end });
  }
  return out;
}

/** Staffed hours inside [from, to) for these sessions. */
export function hoursWorked(sessions: Session[], from: number, to: number, cashierId?: string): number {
  let ms = 0;
  for (const s of sessions ?? []) {
    if (cashierId != null && s.cashierId !== cashierId) continue;
    const a = Math.max(s.start, from);
    const b = Math.min(s.end, to);
    if (b > a) ms += b - a;
  }
  return ms / 3600000;
}

/** Rates need at least this much clocked time — below it a "per hour"
 *  number is noise (a few sales over minutes of shifts) and misleads. */
export const MIN_RATE_HOURS = 1;

export type HourMetrics = {
  revenue: number;
  transactions: number;
  hours: number;
  revenuePerHour: number;
  transactionsPerHour: number;
  /** False when clocked hours are too thin for a meaningful rate. */
  reliable: boolean;
};

/** Revenue and transactions per hour worked (hours from the same scope). */
export function perHourMetrics(sales: any[], sessions: Session[], from: number, to: number, cashierId?: string): HourMetrics {
  const inWin = (s: any) => {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) return false;
    return cashierId == null ? true : String(s?.seller_id ?? "") === cashierId;
  };
  const rows = (sales ?? []).filter(inWin);
  const revenue = rows.reduce((a, s) => a + Number(s?.total ?? 0), 0);
  const hours = hoursWorked(sessions, from, to, cashierId);
  const reliable = hours >= MIN_RATE_HOURS;
  return {
    revenue,
    transactions: rows.length,
    hours,
    revenuePerHour: reliable ? revenue / hours : 0,
    transactionsPerHour: reliable ? rows.length / hours : 0,
    reliable,
  };
}

// ── business health ────────────────────────────────────────────────────────

export type BestDay = { weekday: number; label: string; revenue: number; transactions: number };

export function bestDay(sales: any[], from: number, to: number, cashierId?: string): BestDay | null {
  const agg = Array.from({ length: 7 }, (_, i) => ({ weekday: i, label: WEEKDAY_LABELS[i], revenue: 0, transactions: 0 }));
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) continue;
    if (cashierId != null && String(s?.seller_id ?? "") !== cashierId) continue;
    const w = weekdayIndex(t);
    agg[w].revenue += Number(s?.total ?? 0);
    agg[w].transactions += 1;
  }
  const best = agg.reduce((a, b) => (b.revenue > a.revenue ? b : a), agg[0]);
  return best && best.transactions > 0 ? best : null;
}

export type BestSlot = { hour: number; label: string; revenue: number; transactions: number };

export function bestSlot(sales: any[], from: number, to: number, cashierId?: string): BestSlot | null {
  const n = Math.floor(24 / HOURS_SLOT);
  const agg = Array.from({ length: n }, (_, i) => ({ hour: i * HOURS_SLOT, label: slotLabel(i * HOURS_SLOT), revenue: 0, transactions: 0 }));
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) continue;
    if (cashierId != null && String(s?.seller_id ?? "") !== cashierId) continue;
    const b = agg[Math.floor(new Date(t).getUTCHours() / HOURS_SLOT)];
    if (!b) continue;
    b.revenue += Number(s?.total ?? 0);
    b.transactions += 1;
  }
  const best = agg.reduce((a, b) => (b.revenue > a.revenue ? b : a), agg[0]);
  return best && best.transactions > 0 ? best : null;
}

export type SlotGap = {
  hour: number;
  label: string;
  revenueShare: number;
  hoursShare: number;
  /** revenueShare − hoursShare: > 0 sales ran ahead of staffing. */
  gap: number;
  revenue: number;
  hours: number;
};

export type StaffingMatch = {
  verdict: "matched" | "understaffed" | "overstaffed";
  label: string;
  detail: string;
  slots: SlotGap[];
};

/**
 * Did staffing match sales? — share of staffed hours vs share of revenue per
 * time period. A slot taking much more revenue than hours is understaffing;
 * much more hours than revenue is overstaffing.
 */
export function staffingMatch(sales: any[], sessions: Session[], from: number, to: number): StaffingMatch {
  const n = Math.floor(24 / HOURS_SLOT);
  const rev = new Array(n).fill(0);
  const hrs = new Array(n).fill(0);
  const inWin = (t: number) => !isNaN(t) && t >= from && t < to;
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (!inWin(t)) continue;
    const b = Math.floor(new Date(t).getUTCHours() / HOURS_SLOT);
    if (rev[b] != null) rev[b] += Number(s?.total ?? 0);
  }
  for (const se of sessions ?? []) {
    // Slice the session hour-by-hour so each hour lands in its own bucket.
    for (let t = Math.max(se.start, from); t < Math.min(se.end, to); t += 3600000) {
      const b = Math.floor(new Date(t).getUTCHours() / HOURS_SLOT);
      if (hrs[b] != null) hrs[b] += 1;
    }
  }
  const totalRev = rev.reduce((a, b) => a + b, 0);
  const totalHrs = hrs.reduce((a, b) => a + b, 0);
  const slots: SlotGap[] = [];
  if (totalRev <= 0 || totalHrs <= 0) {
    return { verdict: "matched", label: "Not enough data", detail: totalHrs <= 0 ? "No staffed hours in this period." : "No sales in this period.", slots };
  }
  for (let i = 0; i < n; i++) {
    const rs = rev[i] / totalRev;
    const hs = hrs[i] / totalHrs;
    slots.push({ hour: i * HOURS_SLOT, label: slotLabel(i * HOURS_SLOT), revenueShare: rs, hoursShare: hs, gap: rs - hs, revenue: rev[i], hours: hrs[i] });
  }
  slots.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || b.revenue - a.revenue);
  const worst = slots[0];
  if (!worst || Math.abs(worst.gap) < 0.05) {
    return { verdict: "matched", label: "Staffing matched sales", detail: "Hours and revenue are spread evenly across the day.", slots };
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return worst.gap > 0
    ? {
        verdict: "understaffed",
        label: "Sales outpaced staffing",
        detail: `${worst.label} took ${pct(worst.revenueShare)} of revenue on ${pct(worst.hoursShare)} of hours — add cover here.`,
        slots,
      }
    : {
        verdict: "overstaffed",
        label: "Hours outpaced sales",
        detail: `${worst.label} used ${pct(worst.hoursShare)} of hours for ${pct(worst.revenueShare)} of revenue — move hours here elsewhere.`,
        slots,
      };
}

export type NetProfitLine = { label: string; value: number; hint?: string };

// ── health tab series (visual-mock driven) ─────────────────────────────────

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Hour-of-day tag the health mock uses: 8 → "8a", 13 → "1p", 23 → "11p". */
export function hourTag(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  const suffix = h < 12 ? "a" : "p";
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${suffix}`;
}

export type RevenueWeekPoint = { label: string; value: number; revenue: number; hours: number };

/**
 * Trailing weeks of revenue ÷ labor hours, oldest → newest. Labels are each
 * week's Monday ("Aug 10", UTC); the current week clamps to `now`. Pass
 * `cashierId` to scope both sides of the ratio to one employee.
 */
export function weeklyRevenuePerHour(
  sales: any[],
  sessions: Session[],
  now: number | string | Date,
  weeks = 8,
  cashierId?: string
): { points: RevenueWeekPoint[]; hours: number; revenue: number } {
  const nowMs = epoch(now);
  const thisMonday = weekStart(nowMs);
  const points: RevenueWeekPoint[] = [];
  let hours = 0;
  let revenue = 0;
  for (let i = weeks - 1; i >= 0; i--) {
    const from = Date.parse(`${addDays(thisMonday, -7 * i)}T00:00:00Z`);
    const to = Math.min(from + 7 * DAY, nowMs + 1);
    let rev = 0;
    for (const s of sales ?? []) {
      const t = s?.created_at ? epoch(s.created_at) : NaN;
      if (isNaN(t) || t < from || t >= to) continue;
      if (cashierId != null && String(s?.seller_id ?? "") !== cashierId) continue;
      rev += Number(s?.total ?? 0);
    }
    const hrs = hoursWorked(sessions, from, to, cashierId);
    const d = new Date(from);
    points.unshift({
      label: `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`,
      value: hrs >= MIN_RATE_HOURS ? rev / hrs : 0,
      revenue: rev,
      hours: hrs,
    });
    hours += hrs;
    revenue += rev;
  }
  return { points, hours, revenue };
}

// ── staff profile timeline (visual-mock driven) ────────────────────────────

/** One merged run of consecutive staffed hours sharing a state. */
export type TimelineSeg = { start: number; end: number; active: boolean };

/**
 * One calendar day of an employee's clocked hours. `start`/`end`/clock edges
 * are hours-since-midnight (end ≤ 24; a clock-out may spill to ≤ 26 when the
 * shift runs past midnight). Empty `segs` means no shift that day.
 */
export type TimelineDay = {
  label: string;            // "Wed 23"
  isToday: boolean;
  segs: TimelineSeg[];
  clockIn: number | null;
  clockOut: number | null;
};

export type DayTimeline = { days: TimelineDay[]; activePct: number };

/**
 * The last 7 calendar days ending today (pass `to = now + 1`): per-day
 * active/idle segments from that employee's sessions and sales, first-in /
 * last-out clock edges, and the % of staffed hours with at least one sale.
 */
export function dayTimeline(
  sales: any[],
  sessions: Session[],
  from: number,
  to: number,
  cashierId: string
): DayTimeline {
  const days: TimelineDay[] = [];
  const todayKey = dayKey(to - 1);
  let staffedTotal = 0;
  let activeTotal = 0;
  for (let k = dayKey(from), guard = 0; k <= todayKey && guard < 32; k = addDays(k, 1), guard++) {
    const dayStart = Date.parse(`${k}T00:00:00Z`);
    const dayEnd = dayStart + DAY;
    const staffed = new Array<boolean>(24).fill(false);
    const active = new Array<boolean>(24).fill(false);
    let clockIn: number | null = null;
    let clockOut: number | null = null;
    for (const se of sessions ?? []) {
      if (se.cashierId !== cashierId) continue;
      const a = Math.max(se.start, dayStart);
      const b = Math.min(se.end, dayEnd);
      if (b > a) {
        const h0 = Math.floor((a - dayStart) / 3600000);
        const h1 = Math.ceil((b - dayStart) / 3600000);
        for (let h = Math.max(0, h0); h < Math.min(24, h1); h++) staffed[h] = true;
      }
      if (se.start >= dayStart && se.start < dayEnd) {
        const h = (se.start - dayStart) / 3600000;
        clockIn = clockIn == null ? h : Math.min(clockIn, h);
      }
      if (se.end > dayStart && se.end < dayEnd + 2 * 3600000) {
        const h = (se.end - dayStart) / 3600000;
        clockOut = clockOut == null ? h : Math.max(clockOut, h);
      }
    }
    for (const s of sales ?? []) {
      if (String(s?.seller_id ?? "") !== cashierId) continue;
      const t = s?.created_at ? epoch(s.created_at) : NaN;
      if (isNaN(t) || t < dayStart || t >= dayEnd) continue;
      active[new Date(t).getUTCHours()] = true;
    }
    const segs: TimelineSeg[] = [];
    let i = 0;
    while (i < 24) {
      if (!staffed[i]) { i++; continue; }
      const isActive = active[i];
      let j = i;
      while (j < 24 && staffed[j] && active[j] === isActive) j++;
      segs.push({ start: i, end: j, active: isActive });
      i = j;
    }
    for (let h = 0; h < 24; h++) {
      if (!staffed[h]) continue;
      staffedTotal++;
      if (active[h]) activeTotal++;
    }
    const d = new Date(dayStart);
    days.push({
      label: `${WEEKDAY_LABELS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`,
      isToday: k === todayKey,
      segs,
      clockIn,
      clockOut,
    });
  }
  return { days, activePct: staffedTotal > 0 ? (activeTotal / staffedTotal) * 100 : 0 };
}

export type HeatRevenueCell = { weekday: number; hour: number; revenue: number };
export type PeakWindow = { weekday: number; dayLabel: string; fromHour: number; toHour: number; label: string };

/**
 * 7×24 revenue grid over a window plus the best contiguous two-hour window
 * inside [hourFrom, hourTo] — "Peak: Fri 7p–9p".
 */
export function revenueHeat(
  sales: any[],
  from: number,
  to: number,
  hourFrom = 8,
  hourTo = 23
): { cells: HeatRevenueCell[]; max: number; peak: PeakWindow | null } {
  const grid = new Array<number>(7 * 24).fill(0);
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) continue;
    const d = new Date(t);
    grid[weekdayIndex(d) * 24 + d.getUTCHours()] += Number(s?.total ?? 0);
  }
  const cells: HeatRevenueCell[] = [];
  let max = 0;
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const revenue = grid[w * 24 + h];
      cells.push({ weekday: w, hour: h, revenue });
      if (revenue > max) max = revenue;
    }
  }
  let peak: PeakWindow | null = null;
  let best = 0;
  for (let w = 0; w < 7; w++) {
    for (let h = hourFrom; h <= hourTo - 1; h++) {
      const sum = grid[w * 24 + h] + grid[w * 24 + h + 1];
      if (sum > best && sum > 0) {
        best = sum;
        peak = {
          weekday: w,
          dayLabel: WEEKDAY_LABELS[w],
          fromHour: h,
          toHour: h + 2,
          label: `${WEEKDAY_LABELS[w]} ${hourTag(h)}–${hourTag(h + 2)}`,
        };
      }
    }
  }
  return { cells, max, peak };
}

export type StaffingHour = { hour: number; revenue: number; staff: number; short: boolean };
export type StaffingChart = {
  hours: StaffingHour[];
  insight: string;
  shortCount: number;
  shortRun: { from: number; to: number } | null;
};

/**
 * Average revenue vs average staff on floor per hour of the day for one day
 * group (Mon–Fri / Sat–Sun) inside a window. `short` = the hour took a larger
 * share of revenue than of staffed hours (short-handed); the insight names
 * the longest such run, mirroring the staffing-match mock.
 */
export function staffingByHour(
  sales: any[],
  sessions: Session[],
  from: number,
  to: number,
  group: "weekday" | "weekend",
  hourFrom = 8,
  hourTo = 23
): StaffingChart {
  const rev = new Array<number>(24).fill(0);
  const staff = new Array<number>(24).fill(0);
  const inGroup = (t: number) => {
    const w = weekdayIndex(t);
    return group === "weekday" ? w < 5 : w >= 5;
  };
  let days = 0;
  for (let t = Date.parse(`${dayKey(from)}T00:00:00Z`); t < to; t += DAY) {
    if (inGroup(t)) days++;
  }
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to || !inGroup(t)) continue;
    rev[new Date(t).getUTCHours()] += Number(s?.total ?? 0);
  }
  for (const se of sessions ?? []) {
    for (let t = Math.max(se.start, from); t < Math.min(se.end, to); t += 3600000) {
      if (!inGroup(t)) continue;
      staff[new Date(t).getUTCHours()] += 1;
    }
  }
  const hours: StaffingHour[] = [];
  for (let h = hourFrom; h <= hourTo; h++) hours.push({ hour: h, revenue: rev[h], staff: staff[h], short: false });
  if (days > 0) {
    for (const row of hours) {
      row.revenue /= days;
      row.staff /= days;
    }
  }
  const totalRev = hours.reduce((a, r) => a + r.revenue, 0);
  const totalStaff = hours.reduce((a, r) => a + r.staff, 0);
  for (const row of hours) {
    const rs = totalRev > 0 ? row.revenue / totalRev : 0;
    const ss = totalStaff > 0 ? row.staff / totalStaff : 0;
    row.short = row.revenue > 0 && rs > ss;
  }
  const shortCount = hours.filter(r => r.short).length;
  const longestRun = (take: (r: StaffingHour) => boolean): { from: number; to: number } | null => {
    let bestRun: { from: number; to: number } | null = null;
    let start = -1;
    for (let i = 0; i <= hours.length; i++) {
      const on = i < hours.length && take(hours[i]);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        const run = { from: hours[start].hour, to: hours[i - 1].hour + 1 };
        if (!bestRun || run.to - run.from > bestRun.to - bestRun.from) bestRun = run;
        start = -1;
      }
    }
    return bestRun;
  };
  const shortRun = longestRun(r => r.short);
  const overRun = longestRun(r => r.staff > 0 && !r.short);
  const has = totalRev > 0 && totalStaff > 0;
  const insight = !has
    ? totalStaff <= 0
      ? "No staffed hours in this window."
      : "No sales in this window."
    : shortRun
      ? `Short-handed ${hourTag(shortRun.from)}–${hourTag(shortRun.to)}. ${shortCount} hour${shortCount === 1 ? "" : "s"} took more revenue than their share of staff.`
      : overRun
        ? `Overstaffed ${hourTag(overRun.from)}–${hourTag(overRun.to)}. ${overRun.to - overRun.from} hours carried more staff than sales need.`
        : `Staffing matched sales from ${hourTag(hourFrom)} to ${hourTag(hourTo)}.`;
  return { hours, insight, shortCount, shortRun };
}

/**
 * Deficits inside the window that net profit skipped because they landed in
 * the current (not yet settled) week — the "Excluded" footnote amount.
 */
export function excludedUnsettled(
  deficits: DeficitRow[],
  from: number,
  to: number,
  now: number | string | Date
): number {
  const thisWeek = weekStart(now);
  let sum = 0;
  for (const d of deficits ?? []) {
    const anchor = d.resolved_at ? dayKey(d.resolved_at) : dayKey(d.date);
    const t = Date.parse(`${anchor}T00:00:00Z`);
    if (t < from || t >= to) continue;
    if (weekStart(anchor) !== thisWeek) continue;
    sum += Number(d?.deficit ?? 0);
  }
  return sum;
}


export type NetProfit = {
  grossProfit: number;
  /** Deficits resolved as paid / taken from salary inside the window. */
  recovered: number;
  /** Deficits forgiven or still open inside the window (genuine loss). */
  unrecovered: number;
  /** Salaries prorated over the window (monthly/30 × days). */
  salaries: number;
  /** gross − unrecovered + recovered − salaries. */
  total: number;
  lines: NetProfitLine[];
  /** Never true: rent, utilities and other fixed costs are not in here. */
  comprehensive: false;
  note: string;
};

/**
 * Net profit for a period: gross profit, minus deficits that are a genuine
 * loss (forgiven or unpaid), plus deficits recovered (paid or taken from
 * salary), minus salaries paid out. The caller excludes the current week's
 * deficits (they are not settled yet) — see screen.
 */
export function netProfit(input: { grossProfit: number; deficits: DeficitRow[]; salaries: number }): NetProfit {
  const deficits = input.deficits ?? [];
  let recovered = 0;
  let unrecovered = 0;
  for (const d of deficits) (isRecovered(d) ? (recovered += Number(d?.deficit ?? 0)) : (unrecovered += Number(d?.deficit ?? 0)));
  const salaries = Number(input.salaries ?? 0);
  const grossProfit = Number(input.grossProfit ?? 0);
  const total = grossProfit - unrecovered + recovered - salaries;
  return {
    grossProfit, recovered, unrecovered, salaries, total,
    lines: [
      { label: "Gross profit", value: grossProfit },
      { label: "Deficits — genuine loss (forgiven / unpaid)", value: -unrecovered, hint: "unrecovered" },
      { label: "Deficits recovered (paid / salary)", value: recovered, hint: "recovered" },
      { label: "Salaries paid out", value: -salaries, hint: "monthly ÷ 30 × days" },
    ],
    comprehensive: false,
    note: "Not fully comprehensive — excludes rent, utilities, and other fixed costs.",
  };
}

/** Salaries for a window: monthly salary ÷ 30 × days, active employees only. */
export function proratedSalaries(employees: GuardEmployee[], from: number, to: number): number {
  const days = Math.max(1, Math.round((to - from) / DAY));
  let sum = 0;
  for (const e of employees ?? []) {
    if (e?.is_active != null && !Number(e.is_active)) continue;
    sum += Math.max(0, Number(e?.salary ?? 0));
  }
  return (sum / 30) * days;
}

// ── tab 3: per-employee ────────────────────────────────────────────────────

export type HeatState = "none" | "idle" | "active";
export type HeatCell = {
  weekday: number;
  hour: number;
  state: HeatState;
  hours: number;
  revenue: number;
  transactions: number;
};

/**
 * 7 × 24 activity heat map over the window (aggregated across its days):
 *   none   — nobody clocked in
 *   idle   — staffed, but no sale in that hour
 *   active — staffed with at least one sale
 */
export function heatMap(sales: any[], sessions: Session[], from: number, to: number, cashierId?: string): HeatCell[] {
  const cells: HeatCell[] = [];
  const idx = new Map<number, HeatCell>();
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const c: HeatCell = { weekday: w, hour: h, state: "none", hours: 0, revenue: 0, transactions: 0 };
      idx.set(w * 24 + h, c);
      cells.push(c);
    }
  }
  for (const se of sessions ?? []) {
    if (cashierId != null && se.cashierId !== cashierId) continue;
    for (let t = Math.max(se.start, from); t < Math.min(se.end, to); t += 3600000) {
      const d = new Date(t);
      const key = weekdayIndex(d) * 24 + d.getUTCHours();
      const c = idx.get(key);
      if (c) c.hours += 1;
    }
  }
  for (const s of sales ?? []) {
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) continue;
    if (cashierId != null && String(s?.seller_id ?? "") !== cashierId) continue;
    const d = new Date(t);
    const c = idx.get(weekdayIndex(d) * 24 + d.getUTCHours());
    if (!c) continue;
    c.revenue += Number(s?.total ?? 0);
    c.transactions += 1;
  }
  for (const c of cells) c.state = c.hours > 0 ? (c.transactions > 0 ? "active" : "idle") : "none";
  return cells;
}

export type EmployeeStats = {
  employeeId: string;
  hours: number;
  revenue: number;
  transactions: number;
  revenuePerHour: number;
  transactionsPerHour: number;
  deficitCount: number;
  deficitTotal: number;
  openCount: number;
  /** resolved ÷ logged (0..1). */
  resolutionRate: number;
  flag: FlagResult;
  heatmap: HeatCell[];
  bestDay: BestDay | null;
};

export function employeeStats(input: {
  employee: GuardEmployee;
  sales: any[];
  sessions: Session[];
  deficits: DeficitRow[];
  from: number;
  to: number;
  now: number | string | Date;
  flagPct: number;
}): EmployeeStats {
  const id = String(input.employee.id);
  const m = perHourMetrics(input.sales, input.sessions, input.from, input.to, id);
  const mine = (input.deficits ?? []).filter(d => String(d.cashier_id) === id);
  const resolved = mine.filter(d => deficitState(d) !== "open");
  return {
    employeeId: id,
    hours: m.hours,
    revenue: m.revenue,
    transactions: m.transactions,
    revenuePerHour: m.revenuePerHour,
    transactionsPerHour: m.transactionsPerHour,
    deficitCount: mine.length,
    deficitTotal: mine.reduce((a, d) => a + Number(d?.deficit ?? 0), 0),
    openCount: mine.length - resolved.length,
    resolutionRate: mine.length > 0 ? resolved.length / mine.length : 0,
    flag: deficitFlag(mine, Number(input.employee.salary ?? 0), input.now, input.flagPct),
    heatmap: heatMap(input.sales, input.sessions, input.from, input.to, id),
    bestDay: bestDay(input.sales, input.from, input.to, id),
  };
}

/** Cashiers a manager cascades to: whoever they clocked in on shift rows. */
export function cascadeCashierIds(shifts: any[], managerId: string): string[] {
  const ids = new Set<string>();
  for (const s of shifts ?? []) {
    if (String(s?.manager_id ?? "") === String(managerId)) ids.add(String(s?.cashier_id ?? ""));
  }
  return [...ids];
}

// ── standby sales ──────────────────────────────────────────────────────────

export type StandbyTotals = { amount: number; count: number };

/**
 * Standby window: the seller's own report for the day is locked
 * (submitted/confirmed) and they have NOT clocked a new shift after the
 * lock — sales rung now belong to the previous report period and are
 * handed to the manager instead of their till.
 */
export function isStandbyWindow(report: any, shiftsToday: any[]): boolean {
  if (!report) return false;
  const status = String(report.status ?? "");
  if (status !== "submitted" && status !== "closed") return false;
  const lockRaw = report.submitted_at ?? report.closed_at ?? null;
  const lockTs = lockRaw ? epoch(lockRaw) : NaN;
  const open = (shiftsToday ?? []).filter((s: any) => String(s?.status ?? "") === "open");
  if (isNaN(lockTs)) return open.length === 0;
  return !open.some((s: any) => {
    const t = s?.start_time ? epoch(s.start_time) : NaN;
    return !isNaN(t) && t >= lockTs;
  });
}

/**
 * Reconciliation carry: the amount rolled into the NEXT report — confirmed
 * standby hands that were not carried into a report yet.
 */
export function carryTotal(hands: any[]): number {
  let total = 0;
  for (const h of hands ?? []) {
    if (!h || Number(h?.is_deleted ?? 0)) continue;
    if (Number(h?.cashier_confirmed ?? 0) !== 1) continue;
    const carried = h?.carried_into_report_id;
    if (carried != null && String(carried) !== "") continue;
    total += Number(h?.amount ?? 0) || 0;
  }
  return total;
}

/** Sales rung after a report was locked (standby = 1) inside a window. */
export function standbyTotals(sales: any[], from: number, to: number, cashierId?: string): StandbyTotals {
  let amount = 0;
  let count = 0;
  for (const s of sales ?? []) {
    if (!Number(s?.standby ?? 0)) continue;
    const t = s?.created_at ? epoch(s.created_at) : NaN;
    if (isNaN(t) || t < from || t >= to) continue;
    if (cashierId != null && String(s?.seller_id ?? "") !== cashierId) continue;
    amount += Number(s?.total ?? 0);
    count += 1;
  }
  return { amount, count };
}

// ── unified Shift: opening confirmation + daily auto-close ────────────────

/**
 * Has the daily auto-close time passed? Managers/admins/owners self-account —
 * their shift + report close by themselves at this local "HH:MM" (default
 * 06:30, the quieter window before the morning rush). Cashiers never
 * auto-close: submitting their report is their close.
 */
export function isPastAutoClose(now: Date, timeStr: string | null | undefined): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr ?? "").trim());
  const hh = m ? parseInt(m[1], 10) : 6;
  const mm = m ? parseInt(m[2], 10) : 30;
  const mins = (now.getHours() * 60 + now.getMinutes());
  return mins >= hh * 60 + mm;
}

/**
 * Should THIS shift have auto-closed by now?
 *
 * The close moment is the first "HH:MM" occurrence strictly after the shift
 * clocked in: a shift opened at 09:00 with a 06:30 auto-close lives until
 * 06:30 the NEXT day. A blanket "past HH:MM today" check (isPastAutoClose)
 * would instead force-close every open shift for the whole 06:30–24:00
 * window — the auto-close poll runs on boot, on foreground and every 60s, so
 * an app rebundle would silently kill a shift that is still in use
 * (auto_closed = 1, report written behind the user's back).
 */
export function shiftAutoCloseDue(startTime: string | null | undefined, now: Date, timeStr: string | null | undefined): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr ?? "").trim());
  const hh = m ? parseInt(m[1], 10) : 6;
  const mm = m ? parseInt(m[2], 10) : 30;
  const st = epoch(String(startTime ?? ""));
  if (isNaN(st)) return isPastAutoClose(now, timeStr); // legacy rows without start: old rule
  const start = new Date(st);
  const due = new Date(start.getFullYear(), start.getMonth(), start.getDate(), hh, mm, 0, 0);
  if (due.getTime() <= st) due.setDate(due.getDate() + 1);
  return now.getTime() >= due.getTime();
}

/**
 * Pure till reconciliation for one shift. Every inflow/outflow is an
 * itemized line — the report preserves each one so a discrepancy traces to
 * its exact source:
 *   expected = opening float (baseline, NOT revenue)
 *            + cash sales (standby sales excluded — that cash left the till)
 *            + debt collected (an inflow, but never counted as sales)
 *            − cash taken out for non-sales purposes (withdrawals + supplies)
 *            + standby carry (post-lock sales rolled into this report)
 */
export function reconcileShift(input: {
  opening: number;
  cashSales: number;
  debtCollected: number;
  cashOut: number;
  standbyCarry: number;
}): number {
  const n = (v: number | null | undefined) => Number(v) || 0;
  return n(input.opening) + n(input.cashSales) + n(input.debtCollected) - n(input.cashOut) + n(input.standbyCarry);
}
