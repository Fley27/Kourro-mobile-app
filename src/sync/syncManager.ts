/**
 * SyncManager — handles 3 sync paths:
 * 1. Cloud sync via middleware (/api/sync/push & /pull)
 * 2. LAN P2P sync via WebSocket hub (same WiFi, no internet)
 * 3. Local SQLite as source of truth when offline
 */
import { getDb, getDirtyChanges } from "../db";

const MIDDLEWARE_URL = process.env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000";

// Assisted ordering tables ride whole-row upserts: the column lists are the
// schema's, in order, so a pulled row lands complete and `dirty` clears to 0
// (a pulled row must never echo back out of the local outbox).
const ORDER_SYNC_COLUMNS: Record<string, readonly string[]> = {
  open_orders: [
    "id","store_id","mode","code_kind","table_no","customer_name","customer_phone","status",
    "created_by","created_by_name","device_id","delivered_total","line_count","note","locked_at",
    "closed_sale_id","lamport_clock","created_at","updated_at","is_deleted","dirty",
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
    const failed = new Set(
      results
        .filter(r => String(r?.status ?? "").startsWith("error:") && r?.id != null && String(r.id) !== "undefined")
        .map(r => String(r!.id)),
    );
    const drop = failed.size
      ? changesRaw.filter(c => !failed.has(String((c.payload as any)?.id)))
      : results.length ? changesRaw : [];
    const db = await getDb();
    for (const c of drop) await db.runAsync("DELETE FROM outbox WHERE id = ?", [c.outboxId]);
    this.lastSyncedAt = data.server_time;
    await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", ["last_synced_at", this.lastSyncedAt!]);
  }

  async pullFromCloud(): Promise<void> {
    const since = this.lastSyncedAt ?? new Date(0).toISOString();
    const url = `${MIDDLEWARE_URL}/api/sync/pull?store_id=${this.storeId}&device_id=${this.deviceId}&since=${encodeURIComponent(since)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`pull failed ${res.status}`);
    const { changes, server_time } = await res.json();
    await this.applyChanges(changes);
    this.lastSyncedAt = server_time;
  }

  async applyChanges(changes: any[]): Promise<void> {
    const db = await getDb();
    for (const ch of changes) {
      const r = ch.record;
      // Simple LWW: overwrite if remote lamport/newer
      // For brevity, upsert directly; resolveLWW from sync-engine can be used here
      try {
        if (ch.table === "products") {
          // cost_price dropped in the v2 cutover — never written back.
          await db.runAsync(
            `INSERT OR REPLACE INTO products (id,store_id,name,stock_quantity,lamport_clock,updated_at) VALUES (?,?,?,?,?,?)`,
            [r.id, r.store_id, r.name, r.stock_quantity, r.lamport_clock, r.updated_at]
          );
        } else if (ch.table === "suppliers") {
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
