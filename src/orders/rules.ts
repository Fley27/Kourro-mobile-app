// Assisted ordering — the lock rules, pure and dependency-free.
//
// Nothing in here touches SQLite, React or the network: every permission
// question the UI and store.ts need is answered here, once, so the same rule
// cannot drift between the button that renders it and the write that enforces
// it (mirrors how Business Guard keeps canLogDeficitFor next to its writer).
//
// The rules, in words:
//   waiting   → creator edits/cancels freely, no confirmation from anyone
//   progress  → locked. Changes go through a request the preparer must accept.
//               Declining flags the line (needs attention), never deletes it.
//   delivered → final lock, by whoever physically hands the item over.
//               Counts toward the running subtotal immediately.
//   cancelled → out of billing forever (creator cancel, or manager override
//               with a required reason).
//   order     → open until payment, then locked for settlement.
import { ROLE_RANK } from "../users";
import type { Actor, Order, OrderLine, RoundLineInput } from "./types";

// ── hierarchy ──────────────────────────────────────────────────────────────
const RANKS = ROLE_RANK as unknown as Record<string, number>;

export function rankOf(role?: string | null): number {
  if (!role) return 0;
  return RANKS[String(role)] ?? 1;
}

/** Manager and above — the same bar the deficit override uses. */
export function isManagerPlus(role?: string | null): boolean {
  return rankOf(role) >= 2;
}

export function isCreator(line: Pick<OrderLine, "created_by">, actor: Actor | null): boolean {
  if (!actor?.id) return false;
  return String(line.created_by ?? "") === String(actor.id);
}

// ── order-level gates ──────────────────────────────────────────────────────
/** The whole order is editable only while it is open — "ready" (fully
 *  delivered, waiting for a payer) freezes it: no new rounds, no edits. */
export function orderAcceptsWrites(order: Pick<Order, "status">): boolean {
  return order.status === "open";
}

export function isStuck(line: Pick<OrderLine, "status">): boolean {
  return line.status === "waiting" || line.status === "progress";
}

/**
 * Payment gate: every line must be delivered or cancelled first. Stuck lines
 * (waiting / progress) are returned so the settlement sheet can list them and
 * offer the manager override for genuine edge cases.
 */
export function canSettle(
  order: Pick<Order, "status">,
  lines: OrderLine[],
): { ok: boolean; stuck: OrderLine[]; error?: string } {
  if (order.status === "closed") return { ok: false, stuck: [], error: "Kòmand lan deja fèmen." };
  if (order.status === "cancelled") return { ok: false, stuck: [], error: "Kòmand lan anile." };
  if (order.status === "settling") return { ok: false, stuck: [], error: "Kòmand lan deja nan peye." };
  const stuck = lines.filter(isStuck);
  if (stuck.length) {
    return {
      ok: false,
      stuck,
      error: "Chak liy dwe libe anvan peye — gen liy ki toujou ap tann oswa an travay.",
    };
  }
  return { ok: true, stuck: [] };
}

// ── Fakti (bill) gate ──────────────────────────────────────────────────────
/** Every billable line delivered, at least one line exists. Cancelled lines
 *  are out of billing forever, so they never hold the bill back. */
export function allLinesDelivered(lines: Pick<OrderLine, "status">[]): boolean {
  const active = lines.filter(l => l.status !== "cancelled");
  return active.length > 0 && active.every(l => l.status === "delivered");
}

/**
 * Fakti — printable only when every item is delivered and the order is at
 * (or past) the payment-ready moment. Never on the Associate/Server side
 * (role "associate": retail "Associate", hospitality "Server"): the bill
 * belongs with the people who take money. One rule, both entry points —
 * the board button and the list card's quick print.
 */
export function canBill(order: Pick<Order, "status">, allDelivered: boolean, actor: Actor | null): boolean {
  if (String(actor?.role ?? "") === "associate") return false;
  if (order.status === "cancelled") return false;
  // "ready" IS the payment-ready moment; settling/closed are only reachable
  // with everything delivered (or a manager override) — the bill stays
  // re-printable through payment.
  if (order.status === "ready" || order.status === "settling" || order.status === "closed") return true;
  return allDelivered;
}

// ── line-level gates ───────────────────────────────────────────────────────
/** A waiting line belongs to its creator: edit freely, no confirmation. */
export function canEditLine(order: Pick<Order, "status">, line: OrderLine, actor: Actor | null): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.status !== "waiting") return false;
  return isCreator(line, actor) || isManagerPlus(actor?.role);
}

export function canCancelLine(order: Pick<Order, "status">, line: OrderLine, actor: Actor | null): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.status === "delivered") return false; // final lock
  if (line.status === "cancelled") return false;
  if (line.status === "progress") return false; // must go through a change request
  return isCreator(line, actor) || isManagerPlus(actor?.role);
}

/** Taking a line out of waiting — the preparer starting work. Any role. */
export function canStartLine(order: Pick<Order, "status">, line: OrderLine, _actor: Actor | null): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.status !== "waiting") return false;
  if (line.attention) return false; // needs resolution first
  return true;
}

/**
 * Handing the item to the customer — final lock. Deliberately NOT role-bound:
 * whoever physically does the hand-off marks it (server for food, cashier or
 * server for something that skipped preparation).
 */
export function canDeliverLine(order: Pick<Order, "status">, line: OrderLine, _actor: Actor | null): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.attention) return false;
  return line.status === "waiting" || line.status === "progress";
}

/** Change requests only exist for a locked line — delivered never reopens. */
export function canRequestChange(
  order: Pick<Order, "status">,
  line: OrderLine,
  _actor: Actor | null,
): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.attention) return false;
  return line.status === "progress";
}

/** The other side decides: whoever started the line, a cook, or a manager. */
export function canDecideChange(order: Pick<Order, "status">, line: OrderLine, actor: Actor | null): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (!actor) return false;
  if (isManagerPlus(actor.role)) return true;
  if (String(actor.role) === "cook") return true;
  return !!actor.id && String(line.started_by ?? "") === String(actor.id);
}

/** Preparer refusing an outright — flags the line back to the creator. */
export function canMarkAttention(
  order: Pick<Order, "status">,
  line: OrderLine,
  actor: Actor | null,
): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (line.attention) return false;
  if (line.status === "delivered" || line.status === "cancelled") return false;
  if (!actor) return false;
  if (isManagerPlus(actor.role)) return true;
  if (String(actor.role) === "cook") return true;
  return !!actor.id && String(line.started_by ?? "") === String(actor.id);
}

/** Creator (or manager) clears the flagged line: re-send, or cancel it. */
export function canResolveAttention(
  order: Pick<Order, "status">,
  line: OrderLine,
  actor: Actor | null,
): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (!line.attention) return false;
  return isCreator(line, actor) || isManagerPlus(actor?.role);
}

/**
 * Manager override: force-cancel a stuck line at settlement time. Never
 * bills it — the customer is not charged for what was never handed over —
 * but the reason is mandatory and lands on the audit trail.
 */
export function canForceCancel(
  order: Pick<Order, "status">,
  line: OrderLine,
  actor: Actor | null,
  reason?: string | null,
): boolean {
  if (!orderAcceptsWrites(order)) return false;
  if (!isManagerPlus(actor?.role)) return false;
  if (line.status !== "waiting" && line.status !== "progress") return false;
  return !!String(reason ?? "").trim();
}

// ── money ──────────────────────────────────────────────────────────────────
export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function lineTotal(qty: number, unitPrice: number): number {
  return roundMoney((Number(qty) || 0) * (Number(unitPrice) || 0));
}

export function liveLines<T extends Pick<OrderLine, "status">>(lines: T[]): T[] {
  return lines.filter(l => l.status !== "cancelled");
}

/** Running subtotal — delivered lines only, building progressively. */
export function deliveredSubtotal(lines: Pick<OrderLine, "status" | "line_total">[]): number {
  return roundMoney(
    lines.filter(l => l.status === "delivered").reduce((s, l) => s + (Number(l.line_total) || 0), 0),
  );
}

/** Count of lines still owed to the customer (waiting + progress). */
export function pendingCount(lines: Pick<OrderLine, "status">[]): number {
  return lines.filter(isStuck).length;
}

/** Order header label: table number or customer name. Lives here (not in
 *  OrderBoard) so OrderPaySheet can use it without an import cycle. */
export function orderCodeLabel(order: Pick<Order, "code_kind" | "table_no" | "customer_name">): string {
  if (order.code_kind === "table") return `Tab ${order.table_no ?? "?"}`;
  return order.customer_name ?? "Kliyan";
}

/** Next round number — a later request for the same item starts a new round. */
export function newRoundNo(lines: Pick<OrderLine, "round_no">[]): number {
  return lines.reduce((m, l) => Math.max(m, Number(l.round_no) || 0), 0) + 1;
}

export type BillingLine = {
  key: string;
  product_id: string | null;
  name: string;
  unit_id: string | null;
  unit_name: string | null;
  factor: number;
  variant: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
  rounds: number;
};

/**
 * Identical variants collapse into one summed line — but ONLY here, at
 * billing. The live order keeps every round distinct so it reflects the real
 * sequence of what happened.
 */
export function collapseForBilling(lines: Pick<OrderLine,
  "status" | "product_id" | "name" | "unit_id" | "unit_name" | "factor" | "variant" | "unit_price" | "qty" | "line_total"
>[]): BillingLine[] {
  const groups = new Map<string, BillingLine>();
  for (const l of lines) {
    if (l.status !== "delivered") continue;
    const key = `${l.product_id ?? "x"}|${l.unit_id ?? "base"}|${l.variant ?? "Regular"}|${roundMoney(l.unit_price)}`;
    const hit = groups.get(key);
    if (hit) {
      hit.qty = roundMoney(hit.qty + (Number(l.qty) || 0));
      hit.line_total = roundMoney(hit.line_total + (Number(l.line_total) || 0));
      hit.rounds += 1;
      continue;
    }
    groups.set(key, {
      key,
      product_id: l.product_id ?? null,
      name: l.name ?? "",
      unit_id: l.unit_id ?? null,
      unit_name: l.unit_name ?? null,
      factor: Number(l.factor) || 1,
      variant: l.variant ?? null,
      unit_price: roundMoney(l.unit_price),
      qty: Number(l.qty) || 0,
      line_total: roundMoney(l.line_total),
      rounds: 1,
    });
  }
  return Array.from(groups.values());
}

// ── identity ───────────────────────────────────────────────────────────────
/** Lookup code for the order: table number, or customer name (phone is backup). */
export function normalizeCode(
  codeKind: "table" | "name",
  input: { tableNo?: string | null; customerName?: string | null },
): string {
  const raw = codeKind === "table" ? (input.tableNo ?? "") : (input.customerName ?? "");
  const trimmed = String(raw).trim();
  return codeKind === "table" ? trimmed : trimmed.replace(/\s+/g, " ").toLowerCase();
}

// ── dev self-check ─────────────────────────────────────────────────────────
// Phase 1 ships without a test runner (the repo has none), so the rule table
// asserts itself once at import time under __DEV__. Failures surface as
// console.warn — visible in the Expo console, never thrown in production.
export function selfCheckRules(): string[] {
  const fails: string[] = [];
  const expect = (label: string, got: unknown, want: unknown) => {
    if (got !== want) fails.push(`${label}: got ${String(got)}, want ${String(want)}`);
  };
  const order = { status: "open" } as Order;
  const settled = { status: "settling" } as Order;
  const creator: Actor = { id: "u1", name: "Nadia", role: "associate" };
  const cook: Actor = { id: "u2", name: "Chef", role: "cook" };
  const cashier: Actor = { id: "u3", name: "Sophie", role: "cashier" };
  const manager: Actor = { id: "u4", name: "Pierre", role: "manager" };
  const line = (over: Partial<OrderLine>): OrderLine =>
    ({
      id: "l1", order_id: "o1", store_id: "s", round_no: 1,
      product_id: "p1", name: "Biyè", unit_id: null, unit_name: "pcs", factor: 1,
      variant: "Regular", qty: 2, unit_price: 100, line_total: 200,
      status: "waiting", attention: 0, attention_reason: null,
      cancel_reason: null, cancelled_by: null, cancelled_at: null, override: 0,
      created_by: "u1", created_by_name: "Nadia",
      started_by: null, started_at: null, delivered_by: null, delivered_at: null,
      revision: 0, lamport_clock: 0, created_at: "", updated_at: "", is_deleted: 0, dirty: 0,
      ...over,
    }) as OrderLine;

  // waiting: creator edits freely, cook cannot
  expect("creator edits waiting", canEditLine(order, line({}), creator), true);
  expect("cook cannot edit waiting", canEditLine(order, line({}), cook), false);
  expect("manager can edit waiting", canEditLine(order, line({}), manager), true);

  // progress: locked → change request, no direct edit/cancel
  const prog = line({ status: "progress", started_by: "u2" });
  expect("no direct edit in progress", canEditLine(order, prog, creator), false);
  expect("no direct cancel in progress", canCancelLine(order, prog, creator), false);
  expect("change request allowed", canRequestChange(order, prog, creator), true);
  expect("change request not on waiting", canRequestChange(order, line({}), creator), false);
  expect("cook decides change", canDecideChange(order, prog, cook), true);
  expect("stranger cannot decide", canDecideChange(order, prog, cashier), false);

  // delivered: final lock for everyone
  const done = line({ status: "delivered", delivered_by: "u1" });
  expect("delivered never edited", canEditLine(order, done, manager), false);
  expect("delivered never cancelled", canCancelLine(order, done, manager), false);
  expect("delivered never reopens", canRequestChange(order, done, creator), false);
  expect("cashier can deliver", canDeliverLine(order, prog, cashier), true);

  // override: manager+ only, reason required, never on delivered
  expect("cashier cannot override", canForceCancel(order, line({}), cashier, "gone"), false);
  expect("manager overrides with reason", canForceCancel(order, line({}), manager, "kite"), true);
  expect("override needs a reason", canForceCancel(order, line({}), manager, "   "), false);
  expect("override never on delivered", canForceCancel(order, done, manager, "kite"), false);
  expect("settling blocks writes", canEditLine(settled, line({}), manager), false);

  // settlement gate
  const lWaiting = line({ id: "a", status: "waiting" });
  const lDone = line({ id: "b", status: "delivered", line_total: 300 });
  const lCancelled = line({ id: "c", status: "cancelled" });
  expect("blocked by a waiting line", canSettle(order, [lWaiting, lDone]).ok, false);
  expect("settles when all delivered", canSettle(order, [lDone, lCancelled]).ok, true);
  expect("settling not payable twice", canSettle(settled, [lDone]).ok, false);

  // Fakti: all delivered + payment-ready moment, never Associate/Server
  const closed = { status: "closed" } as Order;
  const cancelledOrder = { status: "cancelled" } as Order;
  expect("fakti waits for delivery", canBill(order, allLinesDelivered([lWaiting, lDone]), cashier), false);
  expect("fakti when all delivered", canBill(order, allLinesDelivered([lDone, lCancelled]), cashier), true);
  expect("no fakti with zero lines", canBill(order, allLinesDelivered([]), manager), false);
  expect("associate (Server) never gets fakti", canBill(order, allLinesDelivered([lDone]), creator), false);
  expect("fakti while settling", canBill(settled, false, manager), true);
  expect("fakti when closed", canBill(closed, false, manager), true);
  expect("no fakti on cancelled order", canBill(cancelledOrder, allLinesDelivered([lDone]), manager), false);

  // "ready" status: its own state — bills, settles, but never accepts writes
  const ready = { status: "ready" } as Order;
  expect("ready is not writable", orderAcceptsWrites(ready), false);
  expect("ready blocks line edits", canEditLine(ready, line({}), manager), false);
  expect("ready still settles", canSettle(ready, [lDone]).ok, true);
  expect("ready order bills", canBill(ready, allLinesDelivered([lDone]), cashier), true);

  // money: delivered only, rounds collapse only at billing
  expect("running subtotal", deliveredSubtotal([lWaiting, lDone, lCancelled]), 300);
  expect("rounds stay distinct", newRoundNo([lDone, lWaiting]), 2);
  const again = line({ id: "d", status: "delivered", qty: 3, unit_price: 100, line_total: 300 });
  const collapsed = collapseForBilling([lDone, again, line({ id: "e", status: "waiting" })]);
  expect("billing collapses identical variants", collapsed.length, 1);
  expect("collapsed qty summed", collapsed[0]?.qty, 5);
  expect("collapsed total summed", collapsed[0]?.line_total, 600);

  return fails;
}

if (__DEV__) {
  const failures = selfCheckRules();
  if (failures.length) console.warn("[orders] rule self-check FAILED:\n - " + failures.join("\n - "));
}
