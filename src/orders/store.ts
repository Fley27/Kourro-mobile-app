// Assisted ordering — the only code allowed to write open_orders,
// open_order_lines, order_change_requests and open_order_events.
//
// Every mutation follows the same shape:
//   1. load order + line
//   2. ask rules.ts (the same gate the UI used to render the button)
//   3. write the row
//   4. refresh the order's running totals
//   5. append one open_order_events row (actor id + role + rank + reason)
//   6. emit() — the LAN seam, silent until Phase 5 wires the socket
//
// Why one writer: the lock rules are the feature. Splitting writes across
// screens is how "waiting is freely editable" quietly stops being true.
import { getDb, insertOutbox } from "../db";
import {
  canCancelLine,
  canDecideChange,
  canDeliverLine,
  canEditLine,
  canForceCancel,
  canMarkAttention,
  canRequestChange,
  canResolveAttention,
  canSettle,
  canStartLine,
  collapseForBilling,
  deliveredSubtotal,
  lineTotal,
  liveLines,
  newRoundNo,
  normalizeCode,
  orderAcceptsWrites,
  orderCodeLabel,
  rankOf,
} from "./rules";
import { localDayKey, localDayRange } from "../businessGuard";
import type { BillingLine } from "./rules";
import { EVENT_ACTIONS as EV } from "./types";
import type {
  Actor,
  AttentionAction,
  ChangeKind,
  ChangeRequest,
  Order,
  OrderCodeKind,
  OrderEvent,
  OrderLine,
  OrderMode,
  RoundLineInput,
  StoreResult,
} from "./types";

// ── Phase 5 seams ──────────────────────────────────────────────────────────
// Outbox writes were held back while middleware rejected unknown tables
// (middleware/src/routes/sync.ts): pushed rows came back as `unknown_table`
// and clogged the queue. The four tables are registered now (TABLES entry +
// 012_assisted_orders.sql), so dirty rows ride the regular sync push.
const CLOUD_OUTBOX = true;

export type OrderBusMessage = {
  table: "open_orders" | "open_order_lines" | "order_change_requests";
  id: string;
  orderId: string;
  action: string;
  at: string;
};

/** LAN broadcast seam — Phase 5 opens the socket; until then it is a no-op. */
async function emit(msg: OrderBusMessage): Promise<void> {
  void msg;
}

async function outbox(table: string, operation: "create" | "update" | "delete", payload: unknown): Promise<void> {
  if (!CLOUD_OUTBOX) return;
  try {
    await insertOutbox(table, operation, payload);
  } catch {
    // Cloud backup is best-effort; the local row is already written.
  }
}

// ── small helpers ──────────────────────────────────────────────────────────
const nowISO = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const lamport = () => Date.now();

type Row = Record<string, any>;

function one<T>(rows: Row[] | null | undefined): T | null {
  return rows && rows.length ? (rows[0] as T) : null;
}

async function insertRow(db: any, table: string, rec: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(rec);
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  await db.runAsync(sql, cols.map(c => (rec[c] ?? null) as any));
}

async function patchById(db: any, table: string, id: string, fields: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(", ")} WHERE id = ?`;
  await db.runAsync(sql, [...cols.map(c => (fields[c] ?? null) as any), id]);
}

/** Bump the sync columns on an order/line. */
function syncStamp(): Record<string, unknown> {
  return { updated_at: nowISO(), lamport_clock: lamport(), dirty: 1 };
}

type EventInput = {
  orderId: string;
  storeId?: string | null;
  lineId?: string | null;
  action: string;
  actor?: Actor | null;
  reason?: string | null;
  snapshot?: unknown;
};

async function logEvent(db: any, e: EventInput): Promise<void> {
  const ts = nowISO();
  // The audit row carries the order's store scope: the sync pull filters on
  // store_id and the server stamps LWW off updated_at, so both need to agree.
  const storeId =
    e.storeId ??
    one<{ store_id: string | null }>(
      await db.getAllAsync("SELECT * FROM open_orders WHERE id = ?", [e.orderId])
    )?.store_id ??
    null;
  const rec: Record<string, unknown> = {
    id: uid("oe"),
    order_id: e.orderId,
    store_id: storeId,
    line_id: e.lineId ?? null,
    action: e.action,
    actor_id: e.actor?.id ?? null,
    actor_name: e.actor?.name ?? null,
    actor_role: e.actor?.role ?? null,
    actor_rank: e.actor ? rankOf(e.actor.role) : null,
    reason: e.reason ?? null,
    snapshot: e.snapshot ? JSON.stringify(e.snapshot) : null,
    lamport_clock: lamport(),
    dirty: 1,
    created_at: ts,
    updated_at: ts,
  };
  await insertRow(db, "open_order_events", rec);
  await outbox("open_order_events", "create", rec);
}

async function loadOrder(db: any, orderId: string): Promise<Order | null> {
  return one<Order>(await db.getAllAsync("SELECT * FROM open_orders WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)", [orderId]));
}

async function loadLine(db: any, lineId: string): Promise<OrderLine | null> {
  return one<OrderLine>(await db.getAllAsync("SELECT * FROM open_order_lines WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)", [lineId]));
}

async function loadLines(db: any, orderId: string): Promise<OrderLine[]> {
  return ((await db.getAllAsync("SELECT * FROM open_order_lines WHERE order_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY round_no ASC, created_at ASC", [orderId])) ?? []) as OrderLine[];
}

/** Running subtotal + live line count are stored on the order for fast lists. */
async function refreshTotals(db: any, orderId: string): Promise<void> {
  const lines = await loadLines(db, orderId);
  await patchById(db, "open_orders", orderId, {
    delivered_total: deliveredSubtotal(lines),
    line_count: liveLines(lines).length,
    ...syncStamp(),
  });
}

// ── orders ─────────────────────────────────────────────────────────────────
export type CreateOrderArgs = {
  storeId: string;
  mode: OrderMode;
  codeKind: OrderCodeKind;
  tableNo?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerId?: string | null;
  actor: Actor;
  deviceId?: string | null;
  note?: string | null;
};

/**
 * One open order per identifier: a table number in restaurant mode, the
 * customer name in retail mode (phone is the backup lookup, not the key).
 */
export async function createOrder(args: CreateOrderArgs): Promise<StoreResult<{ order: Order }>> {
  const db = await getDb();
  const tableNo = (args.tableNo ?? "").trim();
  const customerName = (args.customerName ?? "").trim();

  if (args.codeKind === "table" && !tableNo) return { ok: false, error: "Bay nimero tab la." };
  if (args.codeKind === "name" && customerName.length < 2) return { ok: false, error: "Bay non kliyan an (min 2 lèt)." };

  const code = normalizeCode(args.codeKind, { tableNo, customerName });
  const open = (await db.getAllAsync(
    "SELECT * FROM open_orders WHERE store_id = ? AND (status = 'open' OR status = 'settling') AND (is_deleted = 0 OR is_deleted IS NULL)",
    [args.storeId],
  ).catch(() => [])) as Order[];
  const existing = open.find(o => {
    const oc = normalizeCode(o.code_kind, { tableNo: o.table_no, customerName: o.customer_name });
    return oc === code && oc.length > 0;
  });
  if (existing) {
    return {
      ok: false,
      error: args.codeKind === "table" ? `Tab ${tableNo} gen yon kòmand louvri deja.` : `"${customerName}" gen yon kòmand louvri deja.`,
      existing,
    };
  }

  const ts = nowISO();
  const order: Order = {
    id: uid("ord"),
    store_id: args.storeId,
    mode: args.mode,
    code_kind: args.codeKind,
    table_no: args.codeKind === "table" ? tableNo : null,
    // Table orders may still carry an optional attached customer (picked in
    // the create sheet) — persist it either way; only "name" codes *require* it.
    customer_name: customerName || null,
    customer_phone: (args.customerPhone ?? "").trim() || null,
    customer_id: args.customerId ?? null,
    status: "open",
    created_by: args.actor.id,
    created_by_name: args.actor.name,
    device_id: args.deviceId ?? null,
    delivered_total: 0,
    line_count: 0,
    note: (args.note ?? "").trim() || null,
    locked_at: null,
    closed_sale_id: null,
    lamport_clock: lamport(),
    created_at: ts,
    updated_at: ts,
    is_deleted: 0,
    dirty: 1,
  };

  await insertRow(db, "open_orders", order as unknown as Record<string, unknown>);
  await logEvent(db, {
    orderId: order.id,
    action: EV.order_created,
    actor: args.actor,
    snapshot: { codeKind: order.code_kind, code, mode: order.mode },
  });
  await outbox("open_orders", "create", order);
  await emit({ table: "open_orders", id: order.id, orderId: order.id, action: EV.order_created, at: ts });
  return { ok: true, order };
}

export async function listOrders(storeId: string, opts?: { status?: string[] | null; limit?: number }): Promise<Order[]> {
  const db = await getDb();
  const statuses = opts?.status ?? ["open", "ready", "settling"];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = (await db.getAllAsync(
    `SELECT * FROM open_orders WHERE store_id = ? AND status IN (${placeholders}) AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at DESC LIMIT ?`,
    [storeId, ...statuses, opts?.limit ?? 200],
  ).catch(() => [])) as Order[];
  return rows;
}

export async function getOrderBundle(orderId: string): Promise<{ order: Order; lines: OrderLine[]; requests: ChangeRequest[]; events: OrderEvent[] } | null> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return null;
  const lines = await loadLines(db, orderId);
  const requests = (await db.getAllAsync(
    "SELECT * FROM order_change_requests WHERE order_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC",
    [orderId],
  ).catch(() => [])) as ChangeRequest[];
  const events = (await db.getAllAsync(
    "SELECT * FROM open_order_events WHERE order_id = ? ORDER BY created_at ASC LIMIT 500",
    [orderId],
  ).catch(() => [])) as OrderEvent[];
  return { order, lines, requests, events };
}

/**
 * Pending change requests this device actually has to answer — i.e. the ones
 * the current actor is "the other side" for. This is what pops the accept /
 * decline dialog on the preparer's screen.
 */
export async function pendingRequests(actor: Actor): Promise<ChangeRequest[]> {
  const db = await getDb();
  const rows = (await db.getAllAsync(
    "SELECT * FROM order_change_requests WHERE status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC",
  ).catch(() => [])) as ChangeRequest[];
  const answered: ChangeRequest[] = [];
  for (const r of rows) {
    const line = await loadLine(db, r.line_id);
    const order = line ? await loadOrder(db, line.order_id) : null;
    if (line && order && canDecideChange(order, line, actor)) answered.push(r);
  }
  return answered;
}

/** Everything pending, for boards that show "waiting on the other side". */
export async function allPendingRequests(): Promise<ChangeRequest[]> {
  const db = await getDb();
  return (await db.getAllAsync(
    "SELECT * FROM order_change_requests WHERE status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC",
  ).catch(() => [])) as ChangeRequest[];
}

/** The settlement gate, loaded fresh: order + lines + whatever is stuck. */
export async function checkSettlement(orderId: string): Promise<
  { ok: boolean; order: Order | null; lines: OrderLine[]; stuck: OrderLine[]; error?: string }
> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, order: null, lines: [], stuck: [], error: "Kòmand lan pa jwenn." };
  const lines = await loadLines(db, orderId);
  const res = canSettle(order, lines);
  return { ok: res.ok, order, lines, stuck: res.stuck, ...(res.error ? { error: res.error } : {}) };
}

/** Delivered lines collapsed into billable lines — settlement only. */
export async function billingLines(orderId: string): Promise<BillingLine[]> {
  const db = await getDb();
  return collapseForBilling(await loadLines(db, orderId));
}

/** Payment starts → the whole order locks for settlement. */
export async function lockOrder(orderId: string, actor: Actor): Promise<StoreResult<{ order: Order }>> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  const gate = canSettle(order, await loadLines(db, orderId));
  if (!gate.ok) return { ok: false, error: gate.error ?? "Kòmand lan pa pare." };
  await patchById(db, "open_orders", orderId, { status: "settling", locked_at: nowISO(), ...syncStamp() });
  await logEvent(db, { orderId, action: EV.order_locked, actor });
  await outbox("open_orders", "update", { id: orderId, status: "settling", updated_at: nowISO() });
  const fresh = await loadOrder(db, orderId);
  await emit({ table: "open_orders", id: orderId, orderId, action: EV.order_locked, at: nowISO() });
  return fresh ? { ok: true, order: fresh } : { ok: false, error: "Kòmand lan pa jwenn." };
}

/** Payment succeeded → close the order against the sale it produced. */
export async function closeOrder(orderId: string, saleId: string, actor: Actor): Promise<StoreResult<{ order: Order }>> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (order.status === "closed") return { ok: true, order };
  if (order.status !== "settling" && order.status !== "open" && order.status !== "ready") {
    return { ok: false, error: "Kòmand lan pa ka fèmen nan eta sa a." };
  }
  await patchById(db, "open_orders", orderId, { status: "closed", closed_sale_id: saleId, ...syncStamp() });
  await logEvent(db, { orderId, action: EV.order_closed, actor, snapshot: { saleId } });
  await outbox("open_orders", "update", { id: orderId, status: "closed", closed_sale_id: saleId, updated_at: nowISO() });
  const fresh = await loadOrder(db, orderId);
  await emit({ table: "open_orders", id: orderId, orderId, action: EV.order_closed, at: nowISO() });
  return fresh ? { ok: true, order: fresh } : { ok: false, error: "Kòmand lan pa jwenn." };
}

/**
 * Broadcast handoff — "it's time to pay". The order is fully delivered, so
 * move it to its OWN status "ready": it leaves "open" (nothing can be added
 * anymore) and everyone with an open shift right now (cashier → owner) sees
 * it and can take the payment; nobody is exclusively assigned, so an order
 * can never wait on one absent person. Setting it requires a settle-ready
 * open order; clearing it returns the order to "open" (until closed).
 */
export async function markReadyForPayment(orderId: string, actor: Actor, ready: boolean): Promise<StoreResult<{ order: Order }>> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (order.status === "closed" || order.status === "cancelled") return { ok: false, error: "Kòmand lan fèmen." };
  if (order.status === "settling") return { ok: false, error: "Kòmand lan nan eta peye." };
  if (ready) {
    // open → ready is the only direction this flag can be set from.
    if (order.status !== "open") return { ok: false, error: "Kòmand sa a deja pare pou peye." };
    const gate = canSettle(order, await loadLines(db, orderId));
    if (!gate.ok) return { ok: false, error: gate.error ?? "Kòmand lan pa pare pou peye." };
  } else if (order.status !== "ready") {
    // Already open — nothing to withdraw (no spurious event).
    return { ok: true, order };
  }
  const ts = nowISO();
  // Status is the truth; the ready_* columns stay as its mirror for older
  // readers — both always move together so "open" and "ready" never stack.
  const status = ready ? "ready" : "open";
  await patchById(db, "open_orders", orderId, {
    status,
    ready_for_payment: ready ? 1 : 0,
    ready_at: ready ? ts : null,
    ready_by: ready ? actor.id ?? null : null,
    ...syncStamp(),
  });
  await logEvent(db, { orderId, action: ready ? EV.ready_for_payment : EV.ready_withdrawn, actor, snapshot: { status } });
  await outbox("open_orders", "update", { id: orderId, status, ready_for_payment: ready ? 1 : 0, updated_at: ts });
  await emit({ table: "open_orders", id: orderId, orderId, action: ready ? EV.ready_for_payment : EV.ready_withdrawn, at: ts });
  if (ready) await notifyPaymentPool(db, order, actor);
  const fresh = await loadOrder(db, orderId);
  return fresh ? { ok: true, order: fresh } : { ok: false, error: "Kòmand lan pa jwenn." };
}

/**
 * Ping the pool: staff whose role can take money (cashier → owner) with an
 * open/pending shift today, skipping anyone whose own report is awaiting
 * review — exactly the set whose Pay button is already unlocked.
 */
async function notifyPaymentPool(db: any, order: Order, actor: Actor): Promise<void> {
  try {
    const day = localDayKey();
    const [start, end] = localDayRange(day);
    const shifts = (await db.getAllAsync(
      "SELECT cashier_id FROM shifts WHERE store_id = ? AND status IN ('pending','open') AND start_time >= ? AND start_time < ?",
      [order.store_id, start, end],
    ).catch(() => [])) as { cashier_id: string }[];
    const ids = [...new Set(shifts.map(s => s.cashier_id).filter(Boolean))];
    if (!ids.length) return;
    const employees = (await db.getAllAsync(
      "SELECT id, full_name, role FROM employees WHERE store_id = ? AND is_active = 1",
      [order.store_id],
    ).catch(() => [])) as { id: string; full_name: string; role: string }[];
    const payableRoles = new Set(["cashier", "manager", "admin", "owner"]);
    const pool = employees.filter(e => ids.includes(e.id) && payableRoles.has(String(e.role ?? ""))).slice(0, 8);
    const label = orderCodeLabel(order);
    const ts = nowISO();
    for (const p of pool) {
      const rep = (await db.getAllAsync(
        "SELECT 1 AS x FROM daily_reports WHERE user_id = ? AND report_date = ? AND status = 'submitted' LIMIT 1",
        [p.id, day],
      ).catch(() => [])) as unknown[];
      if (rep?.length) continue;
      try {
        await db.runAsync(
          "INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${p.id}-${Math.random().toString(36).slice(2, 5)}`, p.id, "order_ready_to_pay", order.id,
            `${actor.name || "Yon moun"} pare pou peye: ${label} — ou ka pran peye a.`, "pending", ts],
        );
      } catch {}
    }
  } catch {}
}

/**
 * Abandon an order that was never paid. Delivered goods make this a
 * manager-level decision (with a reason) — the same accounting care as a
 * voided sale; an empty order can be dropped by whoever opened it.
 */
export async function cancelOrder(orderId: string, actor: Actor, reason?: string): Promise<StoreResult> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (order.status === "closed") return { ok: false, error: "Kòmand ki fini pa ka anile." };
  if (order.status === "cancelled") return { ok: true };
  const lines = await loadLines(db, orderId);
  const hasDelivered = lines.some(l => l.status === "delivered");
  const text = String(reason ?? "").trim();
  if (hasDelivered && !(rankOf(actor.role) >= 2 && text)) {
    return { ok: false, error: "Gen byen livre deja — sèl manadjè ka anile, ak yon rezon." };
  }
  await patchById(db, "open_orders", orderId, { status: "cancelled", ...syncStamp() });
  await logEvent(db, { orderId, action: EV.order_cancelled, actor, reason: text || null });
  await outbox("open_orders", "update", { id: orderId, status: "cancelled", updated_at: nowISO() });
  await emit({ table: "open_orders", id: orderId, orderId, action: EV.order_cancelled, at: nowISO() });
  return { ok: true };
}

// ── rounds ─────────────────────────────────────────────────────────────────
/**
 * Add one round of items. Every row is a NEW line — identical products never
 * merge with an earlier round, so the live order keeps the real sequence.
 * Only collapseForBilling merges, at payment time.
 */
export async function addRound(orderId: string, rows: RoundLineInput[], actor: Actor): Promise<StoreResult<{ lines: OrderLine[] }>> {
  const db = await getDb();
  const order = await loadOrder(db, orderId);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!orderAcceptsWrites(order)) return { ok: false, error: "Kòmand lan fèmen pou chanjman." };
  const clean = rows.filter(r => Number(r.qty) > 0 && String(r.name ?? "").trim().length > 0);
  if (!clean.length) return { ok: false, error: "Pa gen atik nan tiyon an." };

  const existing = await loadLines(db, orderId);
  const roundNo = newRoundNo(existing);
  const ts = nowISO();
  const created: OrderLine[] = [];

  for (const r of clean) {
    const qty = Number(r.qty) || 0;
    const price = Number(r.unit_price) || 0;
    const rec: OrderLine = {
      id: uid("ol"),
      order_id: orderId,
      store_id: order.store_id,
      round_no: roundNo,
      product_id: r.product_id ?? null,
      name: String(r.name).trim(),
      unit_id: r.unit_id ?? null,
      unit_name: r.unit_name ?? null,
      factor: Number(r.factor) || 1,
      variant: r.variant ?? null,
      qty,
      unit_price: price,
      line_total: lineTotal(qty, price),
      status: "waiting",
      attention: 0,
      attention_reason: null,
      cancel_reason: null,
      cancelled_by: null,
      cancelled_at: null,
      override: 0,
      created_by: actor.id,
      created_by_name: actor.name,
      started_by: null,
      started_at: null,
      delivered_by: null,
      delivered_at: null,
      revision: 0,
      lamport_clock: lamport(),
      created_at: ts,
      updated_at: ts,
      is_deleted: 0,
      dirty: 1,
    };
    await insertRow(db, "open_order_lines", rec as unknown as Record<string, unknown>);
    await outbox("open_order_lines", "create", rec);
    created.push(rec);
  }

  await refreshTotals(db, orderId);
  // A true "ready" order never reaches here (orderAcceptsWrites blocked it
  // above); this only heals a stale flag mirror left by an older client
  // while the order stayed "open".
  if (order.ready_for_payment) {
    await patchById(db, "open_orders", orderId, { ready_for_payment: 0, ready_at: null, ready_by: null, ...syncStamp() });
    await outbox("open_orders", "update", { id: orderId, ready_for_payment: 0, updated_at: nowISO() });
  }
  await logEvent(db, {
    orderId,
    action: EV.round_added,
    actor,
    snapshot: { round: roundNo, count: created.length, total: created.reduce((s, l) => s + l.line_total, 0) },
  });
  await emit({ table: "open_order_lines", id: created[0]?.id ?? orderId, orderId, action: EV.round_added, at: ts });
  return { ok: true, lines: created };
}

// ── waiting: creator edits freely ──────────────────────────────────────────
export type LinePatch = { qty?: number; unit_price?: number; variant?: string | null; name?: string | null };

export async function editWaitingLine(lineId: string, patch: LinePatch, actor: Actor): Promise<StoreResult<{ line: OrderLine }>> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canEditLine(order, line, actor)) {
    return { ok: false, error: "Liy sa a fèmen — li dwe pase pa yon demann chanjman." };
  }

  const qty = patch.qty != null ? Number(patch.qty) : line.qty;
  const price = patch.unit_price != null ? Number(patch.unit_price) : line.unit_price;
  if (!(qty > 0)) return { ok: false, error: "Kantite dwe pi gran pase 0." };
  const next: Record<string, unknown> = {
    qty,
    unit_price: price,
    line_total: lineTotal(qty, price),
    revision: (Number(line.revision) || 0) + 1,
    ...syncStamp(),
  };
  if (patch.variant !== undefined) next.variant = patch.variant;
  if (patch.name != null && patch.name.trim()) next.name = patch.name.trim();

  await patchById(db, "open_order_lines", lineId, next);
  await refreshTotals(db, line.order_id);
  await logEvent(db, {
    orderId: line.order_id,
    lineId,
    action: EV.line_edited,
    actor,
    snapshot: { before: { qty: line.qty, unit_price: line.unit_price, variant: line.variant }, after: { qty, unit_price: price, variant: patch.variant ?? line.variant } },
  });
  await outbox("open_order_lines", "update", { id: lineId, ...next });
  const fresh = await loadLine(db, lineId);
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.line_edited, at: nowISO() });
  return fresh ? { ok: true, line: fresh } : { ok: false, error: "Liy lan pa jwenn." };
}

export async function cancelLine(lineId: string, actor: Actor, reason?: string): Promise<StoreResult> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canCancelLine(order, line, actor)) {
    return { ok: false, error: "Liy sa a pa ka anile konsa (li an travay oswa deja livre)." };
  }
  const text = String(reason ?? "").trim() || null;
  const ts = nowISO();
  await patchById(db, "open_order_lines", lineId, {
    status: "cancelled",
    cancelled_by: actor.id,
    cancelled_at: ts,
    cancel_reason: text,
    ...syncStamp(),
  });
  await refreshTotals(db, line.order_id);
  await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_cancelled, actor, reason: text, snapshot: { qty: line.qty, name: line.name } });
  await outbox("open_order_lines", "update", { id: lineId, status: "cancelled", updated_at: ts });
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.line_cancelled, at: ts });
  return { ok: true };
}

// ── progress → delivered ───────────────────────────────────────────────────
/** The preparer starts work. That is the moment the line locks. */
export async function startLine(lineId: string, actor: Actor): Promise<StoreResult<{ line: OrderLine }>> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canStartLine(order, line, actor)) return { ok: false, error: "Liy sa a pa ka kòmanse nan eta sa a." };

  const ts = nowISO();
  await patchById(db, "open_order_lines", lineId, {
    status: "progress",
    started_by: actor.id,
    started_at: ts,
    ...syncStamp(),
  });
  await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_started, actor });
  await outbox("open_order_lines", "update", { id: lineId, status: "progress", updated_at: ts });
  const fresh = await loadLine(db, lineId);
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.line_started, at: ts });
  return fresh ? { ok: true, line: fresh } : { ok: false, error: "Liy lan pa jwenn." };
}

/**
 * Handing the item over — the final lock. Any role can mark it, because the
 * person who physically does the hand-off is not fixed to one job title.
 */
export async function deliverLine(lineId: string, actor: Actor): Promise<StoreResult<{ line: OrderLine }>> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canDeliverLine(order, line, actor)) return { ok: false, error: "Liy sa a pa ka livre nan eta sa a." };

  const ts = nowISO();
  await patchById(db, "open_order_lines", lineId, {
    status: "delivered",
    delivered_by: actor.id,
    delivered_at: ts,
    attention: 0,
    ...syncStamp(),
  });
  await refreshTotals(db, line.order_id);
  await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_delivered, actor, snapshot: { name: line.name, qty: line.qty, line_total: line.line_total } });
  await outbox("open_order_lines", "update", { id: lineId, status: "delivered", updated_at: ts });
  const fresh = await loadLine(db, lineId);
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.line_delivered, at: ts });
  return fresh ? { ok: true, line: fresh } : { ok: false, error: "Liy lan pa jwenn." };
}

// ── change requests (locked lines) ─────────────────────────────────────────
export async function requestChange(args: {
  lineId: string;
  kind: ChangeKind;
  payload?: Record<string, unknown> | null;
  reason?: string | null;
  actor: Actor;
}): Promise<StoreResult<{ request: ChangeRequest }>> {
  const db = await getDb();
  const line = await loadLine(db, args.lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canRequestChange(order, line, args.actor)) {
    return { ok: false, error: "Se pou yon liy an travay sèlman — livrezon se yon fèmen definitif." };
  }
  const openReq = one<ChangeRequest>(await db.getAllAsync(
    "SELECT * FROM order_change_requests WHERE line_id = ? AND status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL)",
    [args.lineId],
  ));
  if (openReq) return { ok: false, error: "Gen yon demann chanjman annatant deja sou liy sa a." };

  const ts = nowISO();
  const req: ChangeRequest = {
    id: uid("ocr"),
    order_id: line.order_id,
    line_id: args.lineId,
    store_id: order.store_id,
    kind: args.kind,
    payload: args.payload ? JSON.stringify(args.payload) : null,
    reason: (args.reason ?? "").trim() || null,
    requested_by: args.actor.id,
    requested_by_name: args.actor.name,
    requested_by_role: args.actor.role,
    status: "pending",
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    created_at: ts,
    updated_at: ts,
    is_deleted: 0,
    dirty: 1,
  };
  await insertRow(db, "order_change_requests", req as unknown as Record<string, unknown>);
  await logEvent(db, {
    orderId: line.order_id,
    lineId: args.lineId,
    action: EV.change_requested,
    actor: args.actor,
    reason: req.reason,
    snapshot: { kind: args.kind, payload: args.payload ?? null },
  });
  await outbox("order_change_requests", "create", req);
  await emit({ table: "order_change_requests", id: req.id, orderId: line.order_id, action: EV.change_requested, at: ts });
  return { ok: true, request: req };
}

/**
 * The other side decides. Accepting applies the change to the locked line;
 * declining never touches the line — it flags it so it comes back to the
 * creator as needs-attention instead of vanishing.
 */
export async function decideChangeRequest(
  requestId: string,
  accept: boolean,
  actor: Actor,
  reason?: string,
): Promise<StoreResult<{ line?: OrderLine }>> {
  const db = await getDb();
  const req = one<ChangeRequest>(await db.getAllAsync(
    "SELECT * FROM order_change_requests WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)",
    [requestId],
  ));
  if (!req) return { ok: false, error: "Demann lan pa jwenn." };
  if (req.status !== "pending") return { ok: false, error: "Demann sa a deja regle." };
  const line = await loadLine(db, req.line_id);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canDecideChange(order, line, actor)) return { ok: false, error: "Ou pa gen dwa regle demann sa a." };

  const ts = nowISO();
  const text = String(reason ?? "").trim() || null;

  if (accept) {
    const payload = req.payload ? (JSON.parse(req.payload) as Record<string, unknown>) : {};
    if (req.kind === "cancel") {
      await patchById(db, "open_order_lines", line.id, {
        status: "cancelled",
        cancelled_by: req.requested_by,
        cancelled_at: ts,
        cancel_reason: text,
        ...syncStamp(),
      });
    } else {
      const qty = payload.qty != null ? Number(payload.qty) : line.qty;
      const price = payload.unit_price != null ? Number(payload.unit_price) : line.unit_price;
      if (!(qty > 0)) return { ok: false, error: "Kantite a pa valab." };
      const next: Record<string, unknown> = {
        qty,
        unit_price: price,
        line_total: lineTotal(qty, price),
        revision: (Number(line.revision) || 0) + 1,
        ...syncStamp(),
      };
      if (payload.variant !== undefined) next.variant = payload.variant;
      if (payload.name != null && String(payload.name).trim()) next.name = String(payload.name).trim();
      await patchById(db, "open_order_lines", line.id, next);
      await outbox("open_order_lines", "update", { id: line.id, ...next });
    }
    await patchById(db, "order_change_requests", requestId, {
      status: "accepted",
      decided_by: actor.id,
      decided_by_name: actor.name,
      decided_at: ts,
      ...syncStamp(),
    });
    await refreshTotals(db, line.order_id);
    await logEvent(db, { orderId: line.order_id, lineId: line.id, action: EV.change_accepted, actor, reason: text, snapshot: { kind: req.kind, payload } });
    const fresh = await loadLine(db, line.id);
    await emit({ table: "open_order_lines", id: line.id, orderId: line.order_id, action: EV.change_accepted, at: ts });
    return fresh ? { ok: true, line: fresh } : { ok: true };
  }

  await patchById(db, "order_change_requests", requestId, {
    status: "declined",
    decided_by: actor.id,
    decided_by_name: actor.name,
    decided_at: ts,
    ...syncStamp(),
  });
  await patchById(db, "open_order_lines", line.id, {
    attention: 1,
    attention_reason: text ?? "Chanjman refize — liy la tounen bay moun ki te kreye l.",
    ...syncStamp(),
  });
  await logEvent(db, { orderId: line.order_id, lineId: line.id, action: EV.change_declined, actor, reason: text, snapshot: { kind: req.kind } });
  await logEvent(db, { orderId: line.order_id, lineId: line.id, action: EV.line_attention, actor, reason: text });
  await outbox("order_change_requests", "update", { id: requestId, status: "declined", updated_at: ts });
  await emit({ table: "order_change_requests", id: requestId, orderId: line.order_id, action: EV.change_declined, at: ts });
  return { ok: true };
}

/** Preparer refuses an outright — the line comes back as needs-attention. */
export async function markAttention(lineId: string, actor: Actor, reason?: string): Promise<StoreResult> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canMarkAttention(order, line, actor)) return { ok: false, error: "Ou pa ka make liy sa a." };

  const text = String(reason ?? "").trim() || null;
  const ts = nowISO();
  await patchById(db, "open_order_lines", lineId, {
    attention: 1,
    attention_reason: text ?? "Pa ka prepare — tounen bay moun ki te kreye l.",
    ...syncStamp(),
  });
  await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_attention, actor, reason: text, snapshot: { name: line.name, status: line.status } });
  await outbox("open_order_lines", "update", { id: lineId, attention: 1, updated_at: ts });
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.line_attention, at: ts });
  return { ok: true };
}

/** The creator clears a flagged line: send it back, or cancel it. */
export async function resolveAttention(
  lineId: string,
  action: AttentionAction,
  actor: Actor,
  reason?: string,
): Promise<StoreResult> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canResolveAttention(order, line, actor)) return { ok: false, error: "Liy sa a pa tounen pou ou regle." };

  const text = String(reason ?? "").trim() || null;
  const ts = nowISO();
  if (action === "cancel") {
    await patchById(db, "open_order_lines", lineId, {
      status: "cancelled",
      attention: 0,
      cancelled_by: actor.id,
      cancelled_at: ts,
      cancel_reason: text,
      ...syncStamp(),
    });
    await refreshTotals(db, line.order_id);
    await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_cancelled, actor, reason: text, snapshot: { from: "attention" } });
  } else {
    await patchById(db, "open_order_lines", lineId, {
      status: "waiting",
      attention: 0,
      attention_reason: null,
      started_by: null,
      started_at: null,
      revision: (Number(line.revision) || 0) + 1,
      ...syncStamp(),
    });
    await logEvent(db, { orderId: line.order_id, lineId, action: EV.line_resend, actor, reason: text });
  }
  await outbox("open_order_lines", "update", { id: lineId, updated_at: ts });
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: action === "cancel" ? EV.line_cancelled : EV.line_resend, at: ts });
  return { ok: true };
}

/**
 * Manager override at settlement: force-cancel a stuck line so the customer
 * is not billed for something never handed over. Reason is mandatory and the
 * decision lands on the same audit trail as every other line action.
 */
export async function forceCancelLine(lineId: string, actor: Actor, reason: string): Promise<StoreResult> {
  const db = await getDb();
  const line = await loadLine(db, lineId);
  if (!line) return { ok: false, error: "Liy lan pa jwenn." };
  const order = await loadOrder(db, line.order_id);
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn." };
  if (!canForceCancel(order, line, actor, reason)) {
    return {
      ok: false,
      error: rankOf(actor.role) < 2
        ? "Se sèl manadjè ka fè yon override."
        : line.status !== "waiting" && line.status !== "progress"
          ? "Se yon liy ki an atann oswa an travay sèlman ki ka bloke konsa."
          : "Rezon obligatwa pou yon override.",
    };
  }

  const text = String(reason).trim();
  const ts = nowISO();
  await patchById(db, "open_order_lines", lineId, {
    status: "cancelled",
    attention: 0,
    override: 1,
    cancel_reason: text,
    cancelled_by: actor.id,
    cancelled_at: ts,
    ...syncStamp(),
  });
  await refreshTotals(db, line.order_id);
  await logEvent(db, {
    orderId: line.order_id,
    lineId,
    action: EV.override_cancel,
    actor,
    reason: text,
    snapshot: { name: line.name, qty: line.qty, unit_price: line.unit_price, line_total: line.line_total, was: line.status },
  });
  await outbox("open_order_lines", "update", { id: lineId, status: "cancelled", override: 1, cancel_reason: text, updated_at: ts });
  await emit({ table: "open_order_lines", id: lineId, orderId: line.order_id, action: EV.override_cancel, at: ts });
  return { ok: true };
}
