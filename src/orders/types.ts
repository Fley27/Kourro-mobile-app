// Assisted ordering — shared types.
//
// One open-order object serves both sides of the business:
//   restaurant → identifier is a table number (mode "restaurant")
//   retail     → identifier is the customer name + optional phone (mode "retail")
//
// An order stays open and receives many rounds of items. Each line carries
// its own status (waiting | progress | delivered | cancelled) so the locks
// are per item, not per ticket, until payment locks the whole order.

export type OrderMode = "restaurant" | "retail";
export type OrderCodeKind = "table" | "name";
// "ready" = delivered in full, waiting for an open-shift payer — its OWN
// status, never stacked on "open" (open freezes the moment it's set).
export type OrderStatus = "open" | "ready" | "settling" | "closed" | "cancelled";
export type LineStatus = "waiting" | "progress" | "delivered" | "cancelled";
export type ChangeKind = "edit" | "cancel";
export type ChangeStatus = "pending" | "accepted" | "declined";
export type AttentionAction = "resend" | "cancel";

/** Who is acting. `id` can be null on a device with no signed-in user. */
export type Actor = { id: string | null; name: string; role: string };

export type Order = {
  id: string;
  store_id: string;
  mode: OrderMode;
  code_kind: OrderCodeKind;
  table_no: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  // Registered customer picked at creation — carried into the sale at
  // settlement (sales.customer_id) so the payment lands on their ledger.
  customer_id: string | null;
  status: OrderStatus;
  created_by: string | null;
  created_by_name: string | null;
  device_id: string | null;
  delivered_total: number;
  line_count: number;
  note: string | null;
  locked_at: string | null;
  closed_sale_id: string | null;
  // Broadcast handoff: fully delivered, waiting for ANY open-shift person
  // (cashier → owner) to take the payment. Visibility only — the shift gate
  // on Pay is unchanged. Mirror of status === "ready" (kept in sync for
  // older readers; the status is the truth).
  ready_for_payment?: number;
  ready_at?: string | null;
  ready_by?: string | null;
  lamport_clock: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
  dirty: number;
};

export type OrderLine = {
  id: string;
  order_id: string;
  store_id: string;
  round_no: number;
  product_id: string | null;
  name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  factor: number;
  variant: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  status: LineStatus;
  attention: number;
  attention_reason: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  override: number;
  created_by: string | null;
  created_by_name: string | null;
  started_by: string | null;
  started_at: string | null;
  delivered_by: string | null;
  delivered_at: string | null;
  revision: number;
  lamport_clock: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
  dirty: number;
};

/** What the POS picker hands to `addRound` — one round of lines. */
export type RoundLineInput = {
  product_id?: string | null;
  name: string;
  unit_id?: string | null;
  unit_name?: string | null;
  factor?: number | null;
  variant?: string | null;
  qty: number;
  unit_price: number;
};

export type ChangeRequest = {
  id: string;
  order_id: string;
  line_id: string;
  store_id: string | null;
  kind: ChangeKind;
  payload: string | null;
  reason: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_by_role: string | null;
  status: ChangeStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
  dirty: number;
};

export type OrderEvent = {
  id: string;
  order_id: string;
  line_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_rank: number | null;
  reason: string | null;
  snapshot: string | null;
  created_at: string;
};

/** Result shape used by every writer in store.ts. Default = no payload. */
export type StoreResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; existing?: Order };

// Kreyòl status labels — the app's UI copy is hard-coded Kreyòl by convention.
export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  waiting: "ap tann",
  progress: "an travay",
  delivered: "Livre",
  cancelled: "Anile",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "Louvri",
  ready: "Pare pou peye",
  settling: "Ap peye",
  closed: "Fèmen",
  cancelled: "Anile",
};

export const LINE_STATUS_COLOR: Record<LineStatus, string> = {
  waiting: "#d99a2b",   // amber — same language as the Shift/POS screens
  progress: "#22d3ee",  // cyan
  delivered: "#4cae7f", // green
  cancelled: "#8e8e93", // muted
};

/** Actions written to open_order_events (append-only audit trail). */
export const EVENT_ACTIONS = {
  order_created: "order_created",
  order_locked: "order_locked",
  order_closed: "order_closed",
  order_cancelled: "order_cancelled",
  round_added: "round_added",
  line_edited: "line_edited",
  line_cancelled: "line_cancelled",
  line_started: "line_started",
  line_delivered: "line_delivered",
  line_attention: "line_attention",
  line_resend: "line_resend",
  override_cancel: "override_cancel",
  change_requested: "change_requested",
  change_accepted: "change_accepted",
  change_declined: "change_declined",
  ready_for_payment: "ready_for_payment",
  ready_withdrawn: "ready_withdrawn",
} as const;
