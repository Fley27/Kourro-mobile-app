// Payroll model — salary history, org-wide pay periods, salary-bound
// deficits, and the close-once payment ledger (migration 028).
//
// Principles (decided with the owner):
//   • Salary is never overwritten: each change appends one dated row; the
//     CURRENT salary is simply the most recent row. employees.salary stays a
//     display cache refreshed by every write here (no structural change).
//   • Pay periods are org-wide: one cycle shared by every store. Devices
//     derive the current period locally (deterministic id) and the SERVER
//     alone flips periods to closed, writing one locked payment per employee.
//   • salary_deficits only ever receives shortfalls EXPLICITLY designated to
//     come out of salary ("Pran sou salè"); negligible ones write nothing.
//     Permanent — no delete path exists anywhere.
//   • Money math re-scopes by date ranges, so a mis-anchored period_id can
//     never skew a close or a breakdown.
import { deriveId, mintId } from "./db/ids";
import { fmtG } from "./format";

export type PayPeriod = {
  id: string;
  organization_id: string | null;
  store_id: string | null;
  start_date: string;
  end_date: string;
  status: "open" | "closed" | string;
  cadence: string;
};
export type Cadence = "weekly" | "biweekly" | "monthly";

// ── date math (device-local day keys, matching daily_reports.report_date) ───

export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDayKey(key: string): Date {
  const [y, m, d] = String(key).split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(key: string, n: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

/** Period bounds for the period STARTING at `startDate`, by cadence. */
export function periodBoundsFor(startDate: string, cadence: string): { start: string; end: string } {
  if (cadence === "weekly") return { start: startDate, end: addDays(startDate, 6) };
  if (cadence === "biweekly") return { start: startDate, end: addDays(startDate, 13) };
  // Monthly (default): calendar month containing startDate — closes on its
  // last calendar day regardless of weekday/weekend.
  const d = parseDayKey(startDate);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: localDayKey(first), end: localDayKey(last) };
}

/** Start of the period AFTER the one ending at `endDate`. */
export function nextPeriodStart(endDate: string, cadence: string): string {
  if (cadence === "weekly") return addDays(endDate, 1);
  if (cadence === "biweekly") return addDays(endDate, 1);
  const d = parseDayKey(endDate);
  return localDayKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

/** The period containing `dayKey` — for attaching deficits by DATE. */
export function periodCovering(dayKey: string, cadence: string = "monthly"): { start: string; end: string } {
  if (cadence === "weekly" || cadence === "biweekly") {
    // Anchored chains start from the contained date itself (UI hidden today).
    return periodBoundsFor(dayKey, cadence);
  }
  return periodBoundsFor(dayKey, cadence);
}

export function periodIdFor(orgId: string | null, startDate: string): string {
  return deriveId("pp", orgId ?? "local", startDate);
}

export function isExpired(p: Pick<PayPeriod, "end_date">, today: string = localDayKey()): boolean {
  return today > p.end_date;
}

// ── row helpers ─────────────────────────────────────────────────────────────

function parseAmount(v: any): number {
  return Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;
}

export function salaryCacheString(amount: number): string {
  return fmtG(Number.isFinite(amount) ? amount : 0);
}

async function metaGet(db: any, key: string): Promise<string | null> {
  try {
    const rows = (await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [key])) as any[];
    return rows?.[0]?.value != null ? String(rows[0].value) : null;
  } catch {
    return null;
  }
}

/** The org id this device belongs to (persisted at auth); "local" pre-cloud. */
export async function orgIdOf(db: any): Promise<string | null> {
  return metaGet(db, "organization_id");
}

async function queueRow(db: any, table: string, row: any): Promise<void> {
  try {
    const { insertOutbox } = await import("./db");
    await insertOutbox(table, "update", { ...row, updated_at: new Date().toISOString() }, db);
  } catch {}
}

// ── periods ─────────────────────────────────────────────────────────────────

/** Latest period row for the org (any status), by start_date. */
async function latestPeriodRow(db: any, orgId: string | null): Promise<PayPeriod | null> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM pay_periods WHERE organization_id = ?", [orgId ?? "local"])) as any[];
    if (!rows?.length) return null;
    rows.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    return rows[rows.length - 1] as PayPeriod;
  } catch {
    return null;
  }
}

/**
 * The period containing TODAY for the org — created locally (deterministic
 * id) when missing so deficits and the live expected-payment figure always
 * have an anchor, even before the server's close cycle has run. Never flips
 * status: the server owns close.
 */
export async function ensurePayPeriod(db: any, orgId: string | null, cadence: string = "monthly"): Promise<PayPeriod> {
  const today = localDayKey();
  const bounds = periodCovering(today, cadence);
  const id = periodIdFor(orgId, bounds.start);
  try {
    const found = (await db.getAllAsync("SELECT * FROM pay_periods WHERE id = ?", [id])) as any[];
    if (found?.length) return found[0] as PayPeriod;
  } catch {}
  const now = new Date().toISOString();
  const row: PayPeriod = {
    id,
    organization_id: orgId ?? "local",
    store_id: null,
    start_date: bounds.start,
    end_date: bounds.end,
    status: "open",
    cadence,
  };
  try {
    await db.runAsync(
      "INSERT OR IGNORE INTO pay_periods (id, organization_id, store_id, start_date, end_date, status, cadence, device_id, lamport_clock, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1)",
      [id, orgId ?? "local", null, bounds.start, bounds.end, "open", cadence, null, Date.now(), now, now]
    );
    await queueRow(db, "pay_periods", { ...row, updated_at: now });
  } catch {}
  return row;
}

/** Expired open periods on file — the close request should fire for the org. */
export async function expiredOpenPeriods(db: any, orgId: string | null, today: string = localDayKey()): Promise<PayPeriod[]> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM pay_periods WHERE organization_id = ?", [orgId ?? "local"])) as any[];
    return (rows ?? []).filter((r) => String(r.status) === "open" && String(r.end_date) < today) as PayPeriod[];
  } catch {
    return [];
  }
}

/** Fire-and-forget: ask the server to close any expired period (it alone
 * writes payments + emails). Safe to call on a poll: throttled to once a
 * minute, and only fires when THIS device's clock already saw an expiry —
 * the server applies its own wider cutoff, so an early ask is a no-op. */
let closeRequestedAt = 0;
export async function requestPeriodClose(): Promise<void> {
  const now = Date.now();
  if (now - closeRequestedAt < 60_000) return; // once a minute max
  closeRequestedAt = now;
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    const orgId = await orgIdOf(db);
    const expired = await expiredOpenPeriods(db, orgId);
    if (!expired.length) return;
    const { supabase, middlewareUrl } = await import("./auth/supabase");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) return;
    await fetch(`${middlewareUrl}/api/payroll/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: "{}",
    });
  } catch {}
}

// ── salary ──────────────────────────────────────────────────────────────────

/** Latest salary row amount for an employee, fallback to the display cache. */
export async function latestSalary(db: any, employeeId: string): Promise<number> {
  try {
    const rows = (await db.getAllAsync("SELECT amount, created_at FROM salary_history WHERE employee_id = ?", [employeeId])) as any[];
    if (rows?.length) {
      rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
      return Number(rows[rows.length - 1].amount ?? 0);
    }
  } catch {}
  try {
    const emp = (await db.getAllAsync("SELECT salary FROM employees WHERE id = ?", [employeeId])) as any[];
    return Number(emp?.[0]?.salary ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Heal the employees.salary display cache from the append-only history.
 * The team LIST reads the cache while the detail reads salary_history, so a
 * device that pulled salary rows must refresh the cache — profiles carry no
 * salary (local-only), and roster inserts leave it at 0, which is why the
 * list used to stay stale forever. Employees without history are untouched;
 * updated_at/dirty stay alone so nothing echoes back into the outbox.
 * Returns the number of rows actually rewritten.
 */
export async function healSalaryCaches(db: any): Promise<number> {
  try {
    const res = await db.runAsync(
      `UPDATE employees SET salary = (
         SELECT sh.amount FROM salary_history sh
         WHERE sh.employee_id = employees.id AND COALESCE(sh.is_deleted, 0) = 0
         ORDER BY sh.created_at DESC, sh.rowid DESC LIMIT 1
       )
       WHERE EXISTS (
         SELECT 1 FROM salary_history sx
         WHERE sx.employee_id = employees.id AND COALESCE(sx.is_deleted, 0) = 0
       )
       AND COALESCE(employees.salary, -1) <> (
         SELECT sy.amount FROM salary_history sy
         WHERE sy.employee_id = employees.id AND COALESCE(sy.is_deleted, 0) = 0
         ORDER BY sy.created_at DESC, sy.rowid DESC LIMIT 1
       )`,
      []
    );
    return Number(res?.changes ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Append a salary change (first row = deterministic "init" id so every
 * device's backfill converges) and refresh the employees.salary display
 * cache. Returns the new row.
 */
export async function recordSalaryChange(db: any, args: {
  employeeId: string; amount: number; orgId: string | null; storeId: string | null;
}): Promise<any> {
  const amount = Math.max(0, Math.round(args.amount));
  let id: string;
  let existing: any[] = [];
  try {
    existing = (await db.getAllAsync("SELECT id FROM salary_history WHERE employee_id = ? LIMIT 1", [args.employeeId])) as any[];
  } catch {}
  id = existing?.length ? mintId() : deriveId("sal", args.employeeId, "init");
  const now = new Date().toISOString();
  const row = {
    id, employee_id: args.employeeId, organization_id: args.orgId ?? null,
    store_id: args.storeId ?? null, amount,
  };
  try {
    await db.runAsync(
      "INSERT OR REPLACE INTO salary_history (id, employee_id, organization_id, store_id, amount, device_id, lamport_clock, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,0,1)",
      [id, args.employeeId, args.orgId ?? null, args.storeId ?? null, amount, null, Date.now(), now, now]
    );
    await db.runAsync("UPDATE employees SET salary = ?, updated_at = ? WHERE id = ?", [amount, now, args.employeeId]);
    await queueRow(db, "salary_history", { ...row, created_at: now, updated_at: now });
  } catch {}
  return { ...row, created_at: now, updated_at: now };
}

// ── deficits ────────────────────────────────────────────────────────────────

/**
 * Record a shortfall explicitly designated for salary deduction. Anchored to
 * the period whose range contains `date` (created locally if needed).
 */
export async function recordSalaryDeficit(db: any, args: {
  employeeId: string; amount: number; date: string; reportId?: string | null;
  orgId: string | null; storeId: string | null; registeredBy?: string | null;
}): Promise<any> {
  const amount = Math.round(Number(args.amount) || 0);
  if (amount <= 0) return null;
  // One decision per daily report: the cashier's submit-time choice already
  // took it (or waived it); the guard's confirm must never net it twice.
  if (args.reportId) {
    try {
      const dup = (await db.getAllAsync("SELECT * FROM salary_deficits WHERE daily_report_id = ? LIMIT 1", [args.reportId])) as any[];
      if (dup?.length) return dup[0];
    } catch {}
  }
  const today = localDayKey();
  const cadence = "monthly";
  const bounds = periodCovering(args.date, cadence);
  const periodId = periodIdFor(args.orgId, bounds.start);
  // Ensure the anchor exists (open when the date is current, closed for past).
  try {
    const found = (await db.getAllAsync("SELECT id FROM pay_periods WHERE id = ?", [periodId])) as any[];
    if (!found?.length) {
      const nowISO = new Date().toISOString();
      await db.runAsync(
        "INSERT OR IGNORE INTO pay_periods (id, organization_id, store_id, start_date, end_date, status, cadence, device_id, lamport_clock, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1)",
        [periodId, args.orgId ?? "local", null, bounds.start, bounds.end, bounds.end >= today ? "open" : "closed", cadence, null, Date.now(), nowISO, nowISO]
      );
    }
  } catch {}
  const id = mintId();
  const now = new Date().toISOString();
  const row = {
    id, employee_id: args.employeeId, period_id: periodId,
    organization_id: args.orgId ?? null, store_id: args.storeId ?? null,
    date: args.date, amount, daily_report_id: args.reportId ?? null,
    registered_by: args.registeredBy ?? null,
  };
  try {
    await db.runAsync(
      "INSERT OR REPLACE INTO salary_deficits (id, employee_id, period_id, organization_id, store_id, date, amount, daily_report_id, registered_by, device_id, lamport_clock, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,1)",
      [id, args.employeeId, periodId, args.orgId ?? null, args.storeId ?? null, args.date, amount, args.reportId ?? null, args.registeredBy ?? null, null, Date.now(), now, now]
    );
    await queueRow(db, "salary_deficits", { ...row, created_at: now, updated_at: now });
  } catch {}
  return { ...row, created_at: now, updated_at: now };
}

/** Sum of salary-bound deficits whose DATE falls inside the period range. */
export async function deficitTotalForPeriod(db: any, employeeId: string, period: Pick<PayPeriod, "start_date" | "end_date">): Promise<number> {
  try {
    const rows = (await db.getAllAsync("SELECT date, amount FROM salary_deficits WHERE employee_id = ?", [employeeId])) as any[];
    return (rows ?? [])
      .filter((r) => String(r.date) >= period.start_date && String(r.date) <= period.end_date)
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);
  } catch {
    return 0;
  }
}

// ── payments ────────────────────────────────────────────────────────────────

/** Closed payment rows for an employee, newest close first. */
export async function paymentHistory(db: any, employeeId: string): Promise<any[]> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM salary_payments WHERE employee_id = ?", [employeeId])) as any[];
    return (rows ?? [])
      .filter((r) => !Number(r.is_deleted ?? 0))
      .sort((a, b) => String(b.closed_at ?? b.updated_at ?? "").localeCompare(String(a.closed_at ?? a.updated_at ?? "")));
  } catch {
    return [];
  }
}

/** The period row for a payment (dates shown in the breakdown). */
export async function periodById(db: any, periodId: string): Promise<PayPeriod | null> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM pay_periods WHERE id = ?", [periodId])) as any[];
    return rows?.[0] ? (rows[0] as PayPeriod) : null;
  } catch {
    return null;
  }
}

/** Itemized deficits inside a payment's period (for the breakdown view). */
export async function periodDeficitRows(db: any, employeeId: string, period: Pick<PayPeriod, "start_date" | "end_date">): Promise<any[]> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM salary_deficits WHERE employee_id = ?", [employeeId])) as any[];
    return (rows ?? [])
      .filter((r) => !Number(r.is_deleted ?? 0))
      .filter((r) => String(r.date) >= period.start_date && String(r.date) <= period.end_date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } catch {
    return [];
  }
}

// ── display helpers ─────────────────────────────────────────────────────────

/**
 * Live expected payment for the CURRENT period: current salary minus the
 * period's salary-bound deficits. Display only — never persisted.
 */
export async function expectedPayment(db: any, employeeId: string, period: Pick<PayPeriod, "start_date" | "end_date">): Promise<{ salary: number; deficits: number; expected: number }> {
  const [salary, deficits] = await Promise.all([
    latestSalary(db, employeeId),
    deficitTotalForPeriod(db, employeeId, period),
  ]);
  return { salary, deficits, expected: salary - deficits };
}

const ROLE_HT: Record<string, string> = {
  owner: "mèt", admin: "admin", manager: "manadjè",
  cashier: "kesyè", associate: "asosye", cook: "kwizinye",
};

/**
 * Smart-salary hint: how the entered amount compares with same-role peers
 * (org-wide, excluding the employee being edited). Medians, not averages —
 * one outlier salary must not distort the signal. Quiet under ±10% or with
 * fewer than two peers.
 */
export function peerSalaryHint(amount: number, role: string, employees: { id: string; role: string; salary: string | number }[], excludeId?: string): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const peers: number[] = [];
  for (const e of employees) {
    if (e.role !== role) continue;
    if (excludeId && e.id === excludeId) continue;
    const n = parseAmount(e.salary);
    if (n > 0) peers.push(n);
  }
  if (peers.length < 2) return null;
  peers.sort((a, b) => a - b);
  const mid = peers.length >> 1;
  const median = peers.length % 2 ? peers[mid] : (peers[mid - 1] + peers[mid]) / 2;
  if (median <= 0) return null;
  const pct = ((amount - median) / median) * 100;
  if (Math.abs(pct) < 10) return null;
  const dir = pct > 0 ? "pi wo" : "pi ba";
  return `~${Math.round(Math.abs(pct))}% ${dir} pase lòt ${ROLE_HT[role] ?? role} yo`;
}

// ── startup backfill ────────────────────────────────────────────────────────

/**
 * One-time-per-row (idempotent every launch): give every existing employee
 * their first salary_history row from the employees.salary cache, and make
 * sure this month's open period exists. Deterministic ids make this converge
 * with other devices instead of duplicating. Runs on SQLite and the RAM mock.
 */
export async function payrollBackfill(db: any): Promise<void> {
  const orgId = await orgIdOf(db);
  let employees: any[] = [];
  try {
    employees = (await db.getAllAsync("SELECT id, store_id, salary, created_at FROM employees WHERE COALESCE(is_deleted,0) = 0")) as any[];
  } catch {}
  let added = 0;
  for (const e of employees ?? []) {
    try {
      const has = (await db.getAllAsync("SELECT id FROM salary_history WHERE employee_id = ? LIMIT 1", [e.id])) as any[];
      if (has?.length) continue;
      const id = deriveId("sal", e.id, "init");
      const created = e.created_at ?? new Date().toISOString();
      const amount = Number(e.salary ?? 0) || 0;
      await db.runAsync(
        "INSERT OR REPLACE INTO salary_history (id, employee_id, organization_id, store_id, amount, device_id, lamport_clock, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,0,1)",
        [id, e.id, orgId ?? null, e.store_id ?? null, amount, null, Date.now(), created, created]
      );
      await queueRow(db, "salary_history", { id, employee_id: e.id, organization_id: orgId ?? null, store_id: e.store_id ?? null, amount, created_at: created, updated_at: created });
      added++;
    } catch {}
  }
  try {
    await ensurePayPeriod(db, orgId);
  } catch {}
  if (added) console.log(`[payroll] salary history seeded for ${added} employee(s)`);
}
