/**
 * SyncManager — handles 3 sync paths:
 * 1. Cloud sync via middleware (/api/sync/push & /pull)
 * 2. LAN P2P sync via WebSocket hub (same WiFi, no internet)
 * 3. Local SQLite as source of truth when offline
 */
import { getDb, getDirtyChanges, MAX_PUSH_ATTEMPTS } from "../db";

const MIDDLEWARE_URL = process.env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000";

// Pull watermark, kept apart from the legacy `last_synced_at` key (which push
// used to write) so an existing device re-pulls from the epoch once instead of
// starting from a poisoned cursor.
const PULL_CURSOR_KEY = "pull_cursor";

// Assisted ordering tables ride whole-row upserts: the column lists are the
// schema's, in order, so a pulled row lands complete and `dirty` clears to 0
// (a pulled row must never echo back out of the local outbox).
const ORDER_SYNC_COLUMNS: Record<string, readonly string[]> = {
  open_orders: [
    "id","store_id","mode","code_kind","table_no","customer_name","customer_phone","status",
    "created_by","created_by_name","device_id","delivered_total","line_count","note","locked_at",
    "closed_sale_id","lamport_clock","created_at","updated_at","is_deleted","dirty",
    "ready_for_payment","ready_at","ready_by","customer_id",
  ],
  open_order_lines: [
    "id","order_id","store_id","round_no","product_id","name","unit_id","unit_name","factor",
    "variant","qty","unit_price","line_total","status","attention","attention_reason",
    "cancel_reason","cancelled_by","cancelled_at","override","created_by","created_by_name",
    "started_by","started_at","delivered_by","delivered_at","revision","lamport_clock",
    "created_at","updated_at","is_deleted","dirty",
  ],
  order_change_requests: [
    "id","order_id","line_id","store_id","kind","payload","reason","requested_by",
    "requested_by_name","requested_by_role","status","decided_by","decided_by_name",
    "decided_at","created_at","updated_at","lamport_clock","is_deleted","dirty",
  ],
  open_order_events: [
    "id","order_id","store_id","line_id","action","actor_id","actor_name","actor_role",
    "actor_rank","reason","snapshot","lamport_clock","dirty","created_at","updated_at",
  ],
};

// Promotions: same whole-row upsert contract as assisted ordering. Pulled rows
// land complete with dirty=0 (never echo back out of the local outbox);
// Postgres booleans come back as true/false and are written as SQLite 0/1.
const PROMO_SYNC_COLUMNS: Record<string, readonly string[]> = {
  proformats: [
    "id","store_id","receipt_number","customer_id","items","subtotal","total",
    "created_by","created_by_name","created_by_role","device_id",
    "lamport_clock","created_at","updated_at","is_deleted","dirty",
  ],
  discounts: [
    "id","store_id","percentage","created_by","created_by_name","created_by_role",
    "device_id","lamport_clock","created_at","updated_at","is_deleted","dirty",
  ],
  coupons: [
    "id","store_id","code","discount_id","discount_percentage","proformat_id","customer_id",
    "type","min","cap","expires_at","status","flat_amount_goud","message",
    "created_by","created_by_name","created_by_role","device_id",
    "lamport_clock","created_at","updated_at","is_deleted","dirty",
  ],
  coupon_redemptions: [
    "id","store_id","coupon_id","sale_id","sale_number","redeemed_by","redeemed_by_name",
    "redeemed_by_role","amount_applied","lamport_clock","created_at","updated_at","is_deleted","dirty",
  ],
  promo_audit: [
    "id","store_id","action","entity_type","entity_id","proformat_id","discount_id",
    "coupon_id","sale_id","actor_id","actor_name","actor_role","snapshot",
    "lamport_clock","created_at","updated_at","is_deleted","dirty",
  ],
};

// Core rows (customers/catalog/sales/credits): same whole-row upsert contract.
// Pulled rows land complete with dirty=0; Postgres booleans become SQLite 0/1.
const CORE_SYNC_COLUMNS: Record<string, readonly string[]> = {
  products: [
    "id","store_id","sku","barcode","name","name_ht","category_id","item_type","is_available",
    "stock_quantity","current_amount_available","low_stock_threshold","device_id","lamport_clock",
    "updated_at","is_deleted","dirty","status",
  ],
  customers: [
    "id","store_id","name","phone","email","address","id_card_number","first_name","last_name",
    "birth_day","birth_month","birth_year","country","department","commune","address_line1",
    "address_line2","marketing_consent","total_debt","credit_limit","credit_limit_source",
    "is_high_risk","open_debt_count","lamport_clock","updated_at","is_deleted","dirty","is_prospect",
  ],
  categories: [
    "id","store_id","name","icon","color","sort_order","created_at","updated_at","is_deleted","dirty",
  ],
  sales: [
    "id","store_id","sale_number","customer_id","status","payment_method","subtotal","discount",
    "total","amount_paid","amount_due","seller_id","seller_role","created_at","lamport_clock",
    "updated_at","is_deleted","dirty","is_complimentary","complimentary_reason","approved_by",
    "standby","proformat_id",
  ],
  sale_items: [
    "id","store_id","sale_id","product_id","product_name","unit_id","variant","quantity",
    "unit_price","cost_price","line_total","quantity_delivered","lamport_clock","updated_at",
    "is_deleted","dirty","is_complimentary","approved_by",
  ],
  credits: [
    "id","store_id","sale_id","customer_id","amount","amount_paid","balance","status","due_date",
    "will_be_late","lamport_clock","updated_at","is_deleted","dirty",
  ],
  credit_payments: [
    "id","store_id","credit_id","debt_id","amount","payment_method","receipt_number",
    "collected_by","created_at","shift_id",
  ],
  price_history: [
    "id","store_id","product_id","old_cost","new_cost","old_price","new_price","created_at",
  ],
};

// Operational rows (shifts, daily reports, suspended tabs, pickup events,
// standby hands, notifications): whole-row upsert keyed on id, same contract as
// PROMO. These tables are wider on the server (device_id/lamport/version), so
// only the columns the device owns are listed — anything else in the pulled
// record is ignored. Tables whose SQLite twin has no is_deleted (sale_pickups,
// daily_reports, suspended_sales, suspended_sale_items) simply omit it; a
// cloud tombstone still deletes the local row.
const OPS_SYNC_COLUMNS: Record<string, readonly string[]> = {
  sale_pickups: [
    "id","store_id","sale_id","sale_item_id","quantity","picked_up_by","created_at",
  ],
  shifts: [
    "id","store_id","cashier_id","manager_id","opening_balance","opening_stated",
    "opening_confirmed_by","status","start_time","end_time","actual_cash",
    "cashier_confirmed","manager_confirmed","supervisor_confirmed","auto_closed",
    "created_at","updated_at","is_deleted","dirty","lamport_clock",
  ],
  daily_reports: [
    "id","store_id","report_date","role","user_id","shift_id","status","standby_carry",
    "opening_balance","expected_cash","actual_cash","cash_sales","moncash_sales",
    "natcash_sales","credit_sales","credit_collected_cash","credit_collected_moncash",
    "credit_collected_natcash","withdrawals_total","inventory_total","deficit",
    "submitted_at","closed_at","reviewed_by","reviewed_at","created_at","updated_at",
  ],
  suspended_sales: [
    "id","store_id","label","customer_id","cashier_id","cashier_name","seller_role",
    "status","total","completed_sale_id","device_id","created_at","updated_at",
  ],
  suspended_sale_items: [
    "id","suspended_sale_id","store_id","product_id","product_name","unit_id","unit_name",
    "factor","variant","quantity","base_price","unit_price","line_total","bundle_applied",
    "created_at",
  ],
  standby_hands: [
    "id","store_id","cashier_id","manager_id","report_id","carried_into_report_id",
    "sale_count","amount","handed_at","cashier_confirmed","confirmed_at","carried_at",
    "created_at","updated_at","is_deleted","dirty",
  ],
  // No store_id: user-scoped, filtered by the pull's owner path instead.
  notifications: [
    "id","user_id","type","reference_id","message","status","created_at",
    "is_deleted","dirty",
  ],
};

export class SyncManager {
  storeId: string;
  deviceId: string;
  lastSyncedAt: string | null = null;
  private accessToken: string | null = null;

  constructor(storeId: string, deviceId: string) {
    this.storeId = storeId;
    this.deviceId = deviceId;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    if (this.accessToken) h["Authorization"] = `Bearer ${this.accessToken}`;
    return h;
  }

  async pushToCloud(): Promise<void> {
    const changesRaw = await getDirtyChanges();
    if (!changesRaw.length) return;
    const payload = {
      store_id: this.storeId,
      device_id: this.deviceId,
      changes: changesRaw.map(c => ({ table: c.table, operation: c.operation, record: c.payload })),
      last_synced_at: this.lastSyncedAt,
    };
    const res = await fetch(`${MIDDLEWARE_URL}/api/sync/push`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`push failed ${res.status}`);
    const data = await res.json();
    // Clear what the server accepted, KEEP what it rejected: a rejected record
    // (e.g. the cloud migration for a new column is not applied yet) stays in
    // the outbox and is retried on the next push instead of being dropped.
    const results: { id?: string; status?: string }[] = Array.isArray(data?.results) ? data.results : [];
    // `error:` = the row bounced (bad column, type mismatch). `unknown_table`
    // = the server hasn't got the table yet (migration not applied). Both are
    // retried rather than dropped, until MAX_PUSH_ATTEMPTS runs out.
    const rejected = results.filter(r => {
      const s = String(r?.status ?? "");
      return (s.startsWith("error:") || s === "unknown_table") && r?.id != null && String(r.id) !== "undefined";
    });
    const failed = new Set(rejected.map(r => String(r!.id)));
    const drop = failed.size
      ? changesRaw.filter(c => !failed.has(String((c.payload as any)?.id)))
      : results.length ? changesRaw : [];
    const db = await getDb();
    for (const c of drop) await db.runAsync("DELETE FROM outbox WHERE id = ?", [c.outboxId]);
    for (const c of changesRaw) {
      if (!failed.has(String((c.payload as any)?.id))) continue;
      const cur = ((await db.getAllAsync("SELECT attempts FROM outbox WHERE id = ?", [c.outboxId])) as any[])?.[0];
      const attempts = Number(cur?.attempts ?? 0) + 1;
      if (attempts >= MAX_PUSH_ATTEMPTS) {
        console.warn("[sync] dropping record after", attempts, "rejected pushes:", c.table, String((c.payload as any)?.id));
        await db.runAsync("DELETE FROM outbox WHERE id = ?", [c.outboxId]);
      } else {
        await db.runAsync("UPDATE outbox SET attempts = ? WHERE id = ?", [attempts, c.outboxId]);
      }
    }
    // Push must NOT advance the pull cursor. The server ignores the client's
    // `last_synced_at` (it writes its own row in sync_state), so moving the
    // local cursor to "now" here only poisoned the pull that follows: fullSync
    // pushes first, then pulls with `since = now`, which skips every row older
    // than this instant — i.e. exactly the other device's sales. The cursor is
    // the pull watermark and only pullFromCloud() moves it.
  }

  // Returns how many records came down — callers reload their lists only when
  // the pull actually brought something new.
  async pullFromCloud(): Promise<number> {
    await this.loadPullCursor();
    const since = this.lastSyncedAt ?? new Date(0).toISOString();
    const url = `${MIDDLEWARE_URL}/api/sync/pull?store_id=${this.storeId}&device_id=${this.deviceId}&since=${encodeURIComponent(since)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`pull failed ${res.status}`);
    const { changes, server_time } = await res.json();
    const list: any[] = Array.isArray(changes) ? changes : [];
    await this.applyChanges(list);
    this.lastSyncedAt = server_time;
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", [PULL_CURSOR_KEY, this.lastSyncedAt]);
    return list.length;
  }

  // The old `last_synced_at` key was only ever written by push, so it was
  // always poisoned (see pushToCloud) — read a separate key instead. With none
  // stored yet we pull from the epoch once, which is what every sync did
  // before, then every pull after it is incremental.
  private async loadPullCursor(): Promise<void> {
    if (this.lastSyncedAt) return;
    try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [PULL_CURSOR_KEY])) as any[];
      this.lastSyncedAt = rows?.[0]?.value ?? null;
    } catch {}
  }

  async applyChanges(changes: any[]): Promise<void> {
    const db = await getDb();
    for (const ch of changes) {
      const r = ch.record;
      // Simple LWW: overwrite if remote lamport/newer
      // For brevity, upsert directly; resolveLWW from sync-engine can be used here
      try {
        if (ch.table === "suppliers") {
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM suppliers WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO suppliers (id,store_id,name,phone,country,department,city,address,payment_methods,payment_terms,bank_info,notes,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.store_id, r.name, r.phone ?? null, r.country ?? null, r.department ?? null, r.city ?? null, r.address ?? null, r.payment_methods ?? null, r.payment_terms ?? null, r.bank_info ?? null, r.notes ?? null, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "supplier_bank_accounts") {
          // Repeatable bank sub-records ride the supplier's global scope.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM supplier_bank_accounts WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO supplier_bank_accounts (id,store_id,supplier_id,bank_name,currency,account_number,sort_order,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.store_id ?? null, r.supplier_id, r.bank_name, r.currency, r.account_number ?? null, Number(r.sort_order ?? 0), r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "orders") {
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM orders WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO orders (id,store_id,item_name,qty,unit,supplier_name,note,status,requested_by,requested_by_name,approved_by,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.store_id, r.item_name, r.qty ?? 1, r.unit ?? null, r.supplier_name ?? null, r.note ?? null, r.status ?? "requested", r.requested_by ?? null, r.requested_by_name ?? null, r.approved_by ?? null, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "employee_stores") {
          if (r.employee_id && r.store_id) {
            await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id,store_id) VALUES (?,?)", [r.employee_id, r.store_id]);
          }
        } else if (ch.table === "product_supplier_costs") {
          // Global join (no store scope): one row per (product, supplier, unit).
          // item_id rides along so cost-comparison readers can key on batch lines.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM product_supplier_costs WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT INTO product_supplier_costs (id,product_id,supplier_id,unit_id,item_id,cost,last_updated,device_id,lamport_clock,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)
               ON CONFLICT(product_id,supplier_id,unit_id) DO UPDATE SET item_id=coalesce(excluded.item_id,product_supplier_costs.item_id),cost=excluded.cost,last_updated=excluded.last_updated,updated_at=excluded.updated_at,is_deleted=0,dirty=0`,
              [r.id, r.product_id, r.supplier_id, r.unit_id, r.item_id ?? null, Number(r.cost ?? 0), r.last_updated ?? new Date().toISOString(), r.device_id ?? null, r.lamport_clock ?? 0, r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "bundles") {
          // Bundle rule (min quantity) — price lives in bundle_prices.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM bundles WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO bundles (id,variant_id,min_quantity,active,device_id,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.variant_id, Number(r.min_quantity ?? 0), r.active === false || r.active === 0 ? 0 : 1, r.device_id ?? null, r.lamport_clock ?? 0, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "bundle_prices") {
          // Effective-dated; current = latest date ≤ now (see currentBundlePrice).
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM bundle_prices WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO bundle_prices (id,bundle_id,price,date,device_id,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.bundle_id, Number(r.price ?? 0), r.date, r.device_id ?? null, r.lamport_clock ?? 0, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "product_units") {
          // Global per-product units; condition is the 2nd variant dimension.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM product_units WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO product_units (id,product_id,unit_name,condition,conversion_factor,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
              [r.id, r.product_id, r.unit_name, r.condition ?? null, Number(r.conversion_factor ?? 1), r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()]
            );
          }
        } else if (ch.table === "category_links") {
          // Polyhierarchy DAG edges (id-keyed).
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM category_links WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO category_links (id,child_id,parent_id,device_id,lamport_clock,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,0)`,
              [r.id ?? `${r.child_id}__${r.parent_id}`, r.child_id, r.parent_id, r.device_id ?? null, r.lamport_clock ?? 0, r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "items") {
          // Catalog v2 containers (chain via ref_item_id + ratio). `cost` is
          // the persisted unit purchase cost — the value the sending device
          // derived (batch / quote / ratio chain) or the owner typed in, so a
          // pulled device never starts from a cost-free catalog.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM items WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO items (id,product_id,name,ref_item_id,ratio,sort_order,cost,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.product_id, r.name, r.ref_item_id ?? null, r.ratio ?? null, r.sort_order ?? 0, Number(r.cost ?? 0), r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "product_suppliers") {
          // Costless sourcing link (pair-keyed).
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM product_suppliers WHERE product_id = ? AND supplier_id = ?", [r.product_id, r.supplier_id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO product_suppliers (id,product_id,supplier_id,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,0)`,
              [r.id ?? `${r.product_id}__${r.supplier_id}`, r.product_id, r.supplier_id, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "batches") {
          // Only place cost enters; stock moves only on received.
          // delivery_ref/transport_share/session_ref are part of the row now:
          // without them the receiving device loses the delivery card identity,
          // its transport slice, and the wizard-run grouping.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM batches WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO batches (id,item_id,supplier_id,date,quantity,total_paid,status,received_by,received_at,denied_by,denied_at,reason,delivery_ref,transport_share,session_ref,source,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.item_id, r.supplier_id, r.date, r.quantity ?? 0, r.total_paid ?? 0, r.status ?? "pending", r.received_by ?? null, r.received_at ?? null, r.denied_by ?? null, r.denied_at ?? null, r.reason ?? null, r.delivery_ref ?? null, Number(r.transport_share ?? 0), r.session_ref ?? null, r.source ?? "user", r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "variants") {
          // Sellable presentations of an item.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM variants WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO variants (id,item_id,name,sort_order,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,0)`,
              [r.id, r.item_id, r.name, r.sort_order ?? 0, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "variant_prices") {
          // Effective-dated; current = latest date ≤ now (see catalogModel).
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM variant_prices WHERE id = ?", [r.id]);
          } else {
            await db.runAsync(
              `INSERT OR REPLACE INTO variant_prices (id,variant_id,price,date,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,0)`,
              [r.id, r.variant_id, r.price ?? 0, r.date, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "product_categories") {
          // Local join is pair-keyed (no row id): server ids are `${a}__${b}`.
          if (r.is_deleted) {
            await db.runAsync("DELETE FROM product_categories WHERE product_id = ? AND category_id = ?", [r.product_id, r.category_id]);
          } else {
            await db.runAsync("INSERT OR IGNORE INTO product_categories (product_id,category_id) VALUES (?,?)", [r.product_id, r.category_id]);
          }
        } else if (ch.table === "stock_batches") {
          await db.runAsync(
            `INSERT OR REPLACE INTO stock_batches (id,store_id,reference,supplier,supplier_id,transport_cost,notes,total_items_cost,total_cost,received_at,status,delivered_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [r.id, r.store_id, r.reference ?? null, r.supplier ?? null, r.supplier_id ?? null, r.transport_cost ?? 0, r.notes ?? null, r.total_items_cost ?? 0, r.total_cost ?? 0, r.received_at ?? null, r.status ?? "pending", r.delivered_at ?? null, r.created_by ?? null, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()]
          );
        } else if (ORDER_SYNC_COLUMNS[ch.table]) {
          // Assisted ordering: whole-row upsert keyed on id. Waiting/progress/
          // delivered status and the pending request rows all travel as-is —
          // the lock rules live in the record, not in the sync layer.
          const cols = ORDER_SYNC_COLUMNS[ch.table];
          if (r.is_deleted) {
            await db.runAsync(`DELETE FROM ${ch.table} WHERE id = ?`, [r.id]);
          } else {
            const vals = cols.map(c => (c === "dirty" ? 0 : r[c] ?? null));
            await db.runAsync(
              `INSERT OR REPLACE INTO ${ch.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
              vals
            );
          }
        } else if (ch.table === "stock_movements") {
          await db.runAsync(
            `INSERT OR REPLACE INTO stock_movements (id,batch_id,store_id,product_id,type,quantity,initial_qty,remaining_qty,unit_cost,total_cost,allocated_transport,reason,status,delivered_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [r.id, r.batch_id ?? null, r.store_id, r.product_id, r.type, r.quantity, r.initial_qty ?? 0, r.remaining_qty ?? 0, r.unit_cost ?? 0, r.total_cost ?? 0, r.allocated_transport ?? 0, r.reason ?? null, r.status ?? "pending", r.delivered_at ?? null, r.created_by ?? null, r.created_at ?? new Date().toISOString()]
          );
        } else if (PROMO_SYNC_COLUMNS[ch.table]) {
          // Promotions: whole-row upsert keyed on id (see PROMO_SYNC_COLUMNS).
          // Postgres booleans (is_deleted) land as SQLite 0/1; a pulled row
          // clears dirty so it never echoes back out of the local outbox.
          const cols = PROMO_SYNC_COLUMNS[ch.table];
          if (r.is_deleted) {
            await db.runAsync(`DELETE FROM ${ch.table} WHERE id = ?`, [r.id]);
          } else {
            const vals = cols.map(c => {
              if (c === "dirty") return 0;
              const v = r[c] ?? null;
              return typeof v === "boolean" ? (v ? 1 : 0) : v;
            });
            await db.runAsync(
              `INSERT OR REPLACE INTO ${ch.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
              vals
            );
          }
        } else if (OPS_SYNC_COLUMNS[ch.table]) {
          // Operational rows: whole-row upsert keyed on id (see OPS_SYNC_COLUMNS).
          // Postgres booleans (is_deleted) become SQLite 0/1, a cloud tombstone
          // removes the local row, and a pulled row clears dirty so it never
          // echoes back out of the local outbox.
          const cols = OPS_SYNC_COLUMNS[ch.table];
          if (r.is_deleted === true || r.is_deleted === 1) {
            await db.runAsync(`DELETE FROM ${ch.table} WHERE id = ?`, [r.id]);
          } else {
            const vals = cols.map(c => {
              if (c === "dirty") return 0;
              const v = r[c] ?? null;
              return typeof v === "boolean" ? (v ? 1 : 0) : v;
            });
            await db.runAsync(
              `INSERT OR REPLACE INTO ${ch.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
              vals
            );
          }
        } else if (CORE_SYNC_COLUMNS[ch.table]) {
          // Core rows: whole-row upsert keyed on id (see CORE_SYNC_COLUMNS).
          // Never hard-delete here: a soft-deleted cloud row stays as a local
          // tombstone so sales/credits keep their references.
          const cols = CORE_SYNC_COLUMNS[ch.table];
          const vals = cols.map((c) => {
            if (c === "dirty") return 0;
            const v = r[c] ?? null;
            return typeof v === "boolean" ? (v ? 1 : 0) : v;
          });
          await db.runAsync(
            `INSERT OR REPLACE INTO ${ch.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
            vals
          );
        }
        // ... similar for other tables
      } catch (e) { console.warn("apply error", e); }
    }
  }

  // LAN P2P — connect to hub WebSocket (main register or middleware)
  connectLAN(hubUrl: string): WebSocket {
    const wsUrl = hubUrl.replace("http", "ws") + `/lan?store_id=${this.storeId}&device_id=${this.deviceId}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.changes) await this.applyChanges(msg.changes);
      } catch {}
    };
    return ws;
  }

  async fullSync(opts?: { quiet?: boolean }): Promise<void> {
    const warn = opts?.quiet ? (_m: string, _e: any) => {} : (m: string, e: any) => console.warn(m, e);
    try { await this.pushToCloud(); } catch (e) { warn("[sync] push failed offline?", e); }
    try { await this.pullFromCloud(); } catch (e) { warn("[sync] pull failed offline?", e); }
  }
}
