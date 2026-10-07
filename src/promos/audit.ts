// Append-only promotion audit. Every action across the system lands here —
// discount creation, coupon issuance, coupon redemption (with the sale it
// applied to), proformat creation, expiry flips — no matter how minor.
// Same write pattern as open_order_events: one insert + one outbox row.
import { insertOutbox } from "../db";
import { newId, type PromoActor } from "./types";

export type PromoAuditAction =
  | "proformat_created"
  | "proformat_paid"
  | "discount_created"
  | "coupon_issued"
  | "coupon_redeemed"
  | "coupon_expired";

export type PromoAuditArgs = {
  store_id: string;
  action: PromoAuditAction;
  entity_type?: "proformat" | "discount" | "coupon" | "sale";
  entity_id?: string | null;
  proformat_id?: string | null;
  discount_id?: string | null;
  coupon_id?: string | null;
  sale_id?: string | null;
  actor?: PromoActor | null;
  snapshot?: Record<string, unknown>;
};

export async function logPromo(db: any, args: PromoAuditArgs): Promise<void> {
  const now = new Date().toISOString();
  const row = {
    id: newId("pa"),
    store_id: args.store_id,
    action: args.action,
    entity_type: args.entity_type ?? null,
    entity_id: args.entity_id ?? null,
    proformat_id: args.proformat_id ?? null,
    discount_id: args.discount_id ?? null,
    coupon_id: args.coupon_id ?? null,
    sale_id: args.sale_id ?? null,
    actor_id: args.actor?.id ?? null,
    actor_name: args.actor?.name ?? null,
    actor_role: args.actor?.role ?? null,
    snapshot: args.snapshot ? JSON.stringify(args.snapshot) : null,
    lamport_clock: Date.now(),
    created_at: now,
    updated_at: now,
    dirty: 1,
  };
  await db.runAsync(
    "INSERT INTO promo_audit (id,store_id,action,entity_type,entity_id,proformat_id,discount_id,coupon_id,sale_id,actor_id,actor_name,actor_role,snapshot,lamport_clock,created_at,updated_at,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [row.id, row.store_id, row.action, row.entity_type, row.entity_id, row.proformat_id,
      row.discount_id, row.coupon_id, row.sale_id, row.actor_id, row.actor_name, row.actor_role,
      row.snapshot, row.lamport_clock, row.created_at, row.updated_at, row.dirty]
  );
  await insertOutbox("promo_audit", "create", row, db);
}
