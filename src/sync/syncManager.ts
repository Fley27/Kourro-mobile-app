/**
 * SyncManager — handles 3 sync paths:
 * 1. Cloud sync via middleware (/api/sync/push & /pull)
 * 2. LAN P2P sync via WebSocket hub (same WiFi, no internet)
 * 3. Local SQLite as source of truth when offline
 */
import { getDb, getDirtyChanges, insertOutbox, MAX_PUSH_ATTEMPTS, recomputeItemCosts } from "../db";
import { middlewareUrl } from "../auth/supabase";
import { USER_IDS } from "../users";
import { healSalaryCaches } from "../payroll";
import { WINDOW_DAYS, REFERENCE_TABLES, OPEN_ITEM_PREDICATES, SYNC_TABLES, SUBSCRIPTION_EXPIRED_STATUS } from "@retail/shared-types";

// Pull watermark, kept apart from the legacy `last_synced_at` key (which push
// used to write) so an existing device re-pulls from the epoch once instead of
// starting from a poisoned cursor.
const PULL_CURSOR_KEY = "pull_cursor";

// Legacy categories carried text ids ("drinks") and their join rows carried
// slugs ("dairy"). categories.id is uuid in the cloud, so a slug can never name
// a real row — storing one only ever creates an orphan.
const UUID_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: any) => UUID_ID_RE.test(String(v ?? ""));

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
  // Payroll (028): org-wide period cycle + append-only salary history + the
  // salary-bound deficit ledger + the server-written close-once payments.
  // Whole-row upsert; the server owns period status (closed stays closed).
  pay_periods: [
    "id","organization_id","store_id","start_date","end_date","status","cadence",
    "closed_at","created_at","updated_at","is_deleted","dirty","lamport_clock",
  ],
  salary_history: [
    "id","employee_id","organization_id","store_id","amount","created_at",
    "updated_at","is_deleted","dirty","lamport_clock",
  ],
  salary_deficits: [
    "id","employee_id","period_id","organization_id","store_id","date","amount",
    "daily_report_id","registered_by","created_at","updated_at","is_deleted","dirty",
    "lamport_clock",
  ],
  salary_payments: [
    "id","employee_id","period_id","organization_id","store_id","salary_amount",
    "deficit_total","net_amount","closed_at","created_at","updated_at","is_deleted",
    "dirty","lamport_clock",
  ],
};

/**
 * Thrown when the middleware rejects our credentials (401/403). A stale JWT
 * used to make a device 401 forever on every push+pull while other devices on
 * the same store kept syncing — the pull cursor froze and the register showed
 * an empty catalog. Callers must refresh the token (or sign the user out),
 * never just retry with the same dead token.
 */
export class SyncAuthError extends Error {
  constructor(status: number, message = `auth failed ${status}`) {
    super(message);
    this.name = "SyncAuthError";
  }
}

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

  async pushToCloud(): Promise<{ rejected: { table: string; status: string }[]; subscriptionBlocked: boolean }> {
    const changesRaw = await getDirtyChanges();
    if (!changesRaw.length) return { rejected: [], subscriptionBlocked: false };
    const payload = {
      store_id: this.storeId,
      device_id: this.deviceId,
      changes: changesRaw.map(c => ({ table: c.table, operation: c.operation, record: c.payload })),
      last_synced_at: this.lastSyncedAt,
    };
    const res = await fetch(`${middlewareUrl}/api/sync/push`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401 || res.status === 403) throw new SyncAuthError(res.status, `push failed ${res.status}`);
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
    // Surfaced on the status bus (P1): a rejected row would otherwise sit in
    // the outbox for 8 cycles and vanish with only a console.warn — that is
    // how whole tables silently stopped syncing.
    const rejectedInfo = rejected.map(r => {
      const src = changesRaw.find(c => String((c.payload as any)?.id) === String(r!.id));
      return { table: String(src?.table ?? "?"), status: String(r?.status ?? "") };
    });
    // Subscription write-gate rejections (migration 029) are NOT errors: the
    // org is read-only, the lockdown lifts on renewal. Keep the rows and do
    // NOT burn push attempts — otherwise a long expiry would silently drop
    // every write the moment the subscription comes back.
    const statusById = new Map(results.map(r => [String(r?.id ?? ""), String(r?.status ?? "")]));
    const subscriptionBlocked = rejectedInfo.some(r => r.status.includes(SUBSCRIPTION_EXPIRED_STATUS));
    const drop = failed.size
      ? changesRaw.filter(c => !failed.has(String((c.payload as any)?.id)))
      : results.length ? changesRaw : [];
    const db = await getDb();
    for (const c of drop) await db.runAsync("DELETE FROM outbox WHERE id = ?", [c.outboxId]);
    for (const c of changesRaw) {
      if (!failed.has(String((c.payload as any)?.id))) continue;
      if ((statusById.get(String((c.payload as any)?.id)) ?? "").includes(SUBSCRIPTION_EXPIRED_STATUS)) continue;
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
    return { rejected: rejectedInfo, subscriptionBlocked };
  }

  // Returns how many records came down — callers reload their lists only when
  // the pull actually brought something new.
  //
  // Phased-pull options (initial download / stale catch-up):
  //   tables:   only these tables (reference full / windowed 90d split)
  //   openOnly: only open-item rows, any age
  //   ids + idsCol: companion fetch (parent sale for an open credit…)
  //   advanceCursor: false for additive passes — only the plain incremental
  //                  pull moves the watermark (an open-items sweep must never
  //                  swallow rows that changed during the same session).
  async pullFromCloud(opts?: {
    tables?: readonly string[];
    openOnly?: boolean;
    ids?: string[];
    idsCol?: string;
    since?: string;
    until?: string;
    advanceCursor?: boolean;
    onProgress?: (received: number) => void;
  }): Promise<number> {
    await this.loadPullCursor();
    const since = opts?.since ?? this.lastSyncedAt ?? new Date(0).toISOString();
    let page = 0;
    let serverTime: string | null = opts?.until ?? null;
    let received = 0;
    while (true) {
      const params = [
        `store_id=${encodeURIComponent(this.storeId)}`,
        `device_id=${encodeURIComponent(this.deviceId)}`,
        `since=${encodeURIComponent(since)}`,
        `page=${page}`,
      ];
      if (opts?.tables?.length) params.push(`tables=${encodeURIComponent(opts.tables.join(","))}`);
      if (opts?.openOnly) params.push(`open_only=1`);
      if (opts?.ids?.length) {
        params.push(`ids=${encodeURIComponent(opts.ids.join(","))}`);
        if (opts.idsCol) params.push(`ids_col=${encodeURIComponent(opts.idsCol)}`);
      }
      if (serverTime) params.push(`until=${encodeURIComponent(serverTime)}`);
      const res = await fetch(`${middlewareUrl}/api/sync/pull?${params.join("&")}`, { headers: this.authHeaders() });
      if (res.status === 401 || res.status === 403) throw new SyncAuthError(res.status, `pull failed ${res.status}`);
      if (!res.ok) throw new Error(`pull failed ${res.status}`);
      const payload = await res.json();
      const list: any[] = Array.isArray(payload?.changes) ? payload.changes : [];
      if (typeof payload?.server_time !== "string") throw new Error("pull response missing server_time");
      // Pin the snapshot only on the first page of a pass — later pages (and
      // later passes of the same initial download) must see the same until.
      if (!serverTime) serverTime = payload.server_time;
      else if (payload.server_time !== serverTime && page > 0) throw new Error("pull snapshot changed during pagination");
      serverTime = payload.server_time;
      await this.applyChanges(list);
      received += list.length;
      opts?.onProgress?.(received);
      if (!payload.has_more) break;
      page += 1;
    }
    // Only a cursor-advancing pass records the watermark. Additive passes
    // (open items, companions) are lookups, not the incremental frontier.
    if (opts?.advanceCursor !== false) {
      this.lastSyncedAt = serverTime;
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", [PULL_CURSOR_KEY, this.lastSyncedAt]);
    }
    return received;
  }

  /** True when this device has never completed a pull (fresh install / new device). */
  async needsInitialDownload(): Promise<boolean> {
    const db = await getDb();
    const cursor = (await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [PULL_CURSOR_KEY])) as any[];
    if (cursor?.[0]?.value) return false;
    // No cursor: initial download unless local business data already exists
    // (mock/demo seeds, LAN-only devices) — those keep the epoch pull path.
    const sales = (await db.getAllAsync("SELECT COUNT(*) AS n FROM sales")) as any[];
    const customers = (await db.getAllAsync("SELECT COUNT(*) AS n FROM customers")) as any[];
    return Number(sales?.[0]?.n ?? 0) === 0 && Number(customers?.[0]?.n ?? 0) === 0;
  }

  /**
   * Full initial download for a fresh device, in three phases pinned to one
   * server snapshot so no row falls between phases:
   *   A. reference data (suppliers, products + batches, clients, roster…) — full
   *   B. transactional history — last WINDOW_DAYS days only
   *   C. open/unfinished items — any age
   * plus companion rows (parent sale of an open credit, lines of an open
   * order…) so open items are usable. The pull cursor advances once, at the
   * end — a failure mid-way reruns idempotently (applyChanges = replace).
   */
  async initialDownload(onProgress?: (received: number) => void): Promise<number> {
    const until = new Date().toISOString();
    const sinceWindow = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const windowed = SYNC_TABLES.filter(t => !(REFERENCE_TABLES as readonly string[]).includes(t));
    let total = 0;
    const tally = (n: number) => { total = n; onProgress?.(total); };

    total += await this.pullFromCloud({ tables: REFERENCE_TABLES, since: new Date(0).toISOString(), until, advanceCursor: false, onProgress: n => tally(total + n) });
    total += await this.pullFromCloud({ tables: windowed, since: sinceWindow, until, advanceCursor: false, onProgress: n => tally(total + n) });
    total += await this.pullFromCloud({ tables: Object.keys(OPEN_ITEM_PREDICATES), openOnly: true, since: new Date(0).toISOString(), until, advanceCursor: false, onProgress: n => tally(total + n) });
    total += await this.pullOpenCompanions(until, onProgress);

    // Single cursor write at the end (advanceCursor default true).
    await this.pullFromCloud({ since: until, until, onProgress: () => {} });
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", ["initial_sync_done", new Date().toISOString()]);
    return total;
  }

  /**
   * Stale-device catch-up: the incremental pull (since the cursor) already
   * covers everything that CHANGED while offline; this additionally re-sweeps
   * open items + their companions, catching status transitions the cursor
   * window may have raced. Additive only — never advances the cursor.
   */
  async openItemsSweep(): Promise<number> {
    const until = new Date().toISOString();
    let total = await this.pullFromCloud({
      tables: Object.keys(OPEN_ITEM_PREDICATES),
      openOnly: true,
      since: new Date(0).toISOString(),
      until,
      advanceCursor: false,
    });
    total += await this.pullOpenCompanions(until);
    return total;
  }

  // Companion rows for whatever the open sweep just brought: parent sales for
  // open credits / undelivered lines, lines+events for open orders, items for
  // open tabs. Fetched by id, additive.
  private async pullOpenCompanions(until: string, onProgress?: (received: number) => void): Promise<number> {
    const db = await getDb();
    const idsFrom = async (sql: string): Promise<string[]> => {
      try {
        const rows = (await db.getAllAsync(sql)) as any[];
        return [...new Set(rows.map(r => String(r?.id)).filter(Boolean))];
      } catch { return []; }
    };
    const fetch = async (table: string, ids: string[], idsCol?: string) => {
      if (!ids.length) return 0;
      let got = 0;
      for (let i = 0; i < ids.length; i += 400) {
        got += await this.pullFromCloud({
          tables: [table],
          ids: ids.slice(i, i + 400),
          idsCol,
          since: new Date(0).toISOString(),
          until,
          advanceCursor: false,
        });
      }
      onProgress?.(got);
      return got;
    };

    // Open credits → their sales + all sale lines (context for collection).
    const creditSaleIds = await idsFrom("SELECT DISTINCT sale_id AS id FROM credits WHERE balance > 0 AND (is_deleted = 0 OR is_deleted IS NULL)");
    let got = await fetch("sales", creditSaleIds);
    got += await fetch("sale_items", creditSaleIds, "sale_id");

    // Undelivered lines → parent sales.
    const pickupSaleIds = await idsFrom(
      "SELECT DISTINCT sale_id AS id FROM sale_items WHERE quantity_delivered < quantity AND (is_deleted = 0 OR is_deleted IS NULL)"
    );
    got += await fetch("sales", pickupSaleIds.filter(id => !creditSaleIds.includes(id)));

    // Open tabs → their items.
    const tabIds = await idsFrom("SELECT id FROM suspended_sales WHERE status = 'open'");
    got += await fetch("suspended_sale_items", tabIds, "suspended_sale_id");

    // Open orders → lines, change requests, events.
    const orderIds = await idsFrom("SELECT id FROM open_orders WHERE status IN ('open','ready','settling') AND (is_deleted = 0 OR is_deleted IS NULL)");
    got += await fetch("open_order_lines", orderIds, "order_id");
    got += await fetch("order_change_requests", orderIds, "order_id");
    got += await fetch("open_order_events", orderIds, "order_id");

    return got;
  }

  /** Age of the last successful pull, or null when never pulled. */
  async pullCursorAgeMs(): Promise<number | null> {
    await this.loadPullCursor();
    if (!this.lastSyncedAt) return null;
    const t = Date.parse(this.lastSyncedAt);
    return Number.isFinite(t) ? Date.now() - t : null;
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
        // A join row keyed on a slug names a category that can never exist —
        // the cloud carries those legacy rows, so refusing them here is what
        // keeps them from coming back after the launch-time sweep.
        if (ch.table === "category_links" && (!isUuid(r?.child_id) || !isUuid(r?.parent_id))) continue;
        if (ch.table === "product_categories" && r?.category_id != null && !isUuid(r.category_id)) continue;
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
              `INSERT OR REPLACE INTO batches (id,store_id,item_id,supplier_id,date,quantity,total_paid,status,received_by,received_at,denied_by,denied_at,reason,delivery_ref,transport_share,session_ref,source,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
              [r.id, r.store_id ?? null, r.item_id, r.supplier_id, r.date, r.quantity ?? 0, r.total_paid ?? 0, r.status ?? "pending", r.received_by ?? null, r.received_at ?? null, r.denied_by ?? null, r.denied_at ?? null, r.reason ?? null, r.delivery_ref ?? null, Number(r.transport_share ?? 0), r.session_ref ?? null, r.source ?? "user", r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString(), r.is_deleted ? 1 : 0]
            );
          }
        } else if (ch.table === "product_stock") {
          // Per-store stock (migration 023): whole-row upsert keyed on id.
          if (r.is_deleted === true || r.is_deleted === 1) {
            await db.runAsync(
              "DELETE FROM product_stock WHERE id = ? OR (store_id = ? AND product_id = ?)",
              [r.id, r.store_id, r.product_id]
            );
          } else {
            // A device may have created the same store/product row offline
            // with a different UUID. Keep only the canonical cloud row.
            await db.runAsync(
              "DELETE FROM product_stock WHERE store_id = ? AND product_id = ? AND id <> ?",
              [r.store_id, r.product_id, r.id]
            );
            await db.runAsync(
              `INSERT OR REPLACE INTO product_stock (id,store_id,product_id,quantity,available,device_id,lamport_clock,is_deleted,dirty,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
              [r.id, r.store_id, r.product_id, Number(r.quantity ?? 0), Number(r.available ?? r.quantity ?? 0), r.device_id ?? null, Number(r.lamport_clock ?? 0), r.is_deleted ? 1 : 0, r.created_at ?? new Date().toISOString(), r.updated_at ?? new Date().toISOString()]
            );
          }
        } else if (ch.table === "profiles") {
          // Roster: this business's people (names/roles/email/emergency).
          // Local-only fields (phone/salary/address) stay on the employee row
          // untouched.
          if (r.is_deleted === true || r.is_deleted === 1) {
            await db.runAsync("DELETE FROM employees WHERE id = ?", [r.id]);
          } else {
            const name = String(r.full_name ?? "");
            const role = String(r.role ?? "cashier");
            const email = r.email != null && String(r.email).trim() ? String(r.email) : null;
            const emergency =
              r.emergency_name || r.emergency_phone || r.emergency_address
                ? JSON.stringify({
                    name: String(r.emergency_name ?? ""),
                    phone: String(r.emergency_phone ?? ""),
                    address: String(r.emergency_address ?? ""),
                  })
                : null;
            const ts = r.updated_at ?? new Date().toISOString();
            // A pulled profile replaces a demo-seeded twin of the same person:
            // seed rows carry stable demo ids (USER_IDS) while the roster
            // carries the auth uuid — same name, two rows, one of them with
            // a timestamp in its phone field from the old misaligned insert.
            try {
              const demoIds = Object.values(USER_IDS) as string[];
              if (name.trim()) {
                await db.runAsync(
                  `DELETE FROM employees WHERE id IN (${demoIds.map(() => "?").join(",")}) AND id <> ? AND lower(trim(full_name)) = ?`,
                  [...demoIds, r.id, name.trim().toLowerCase()]
                );
              }
            } catch {}
            const existing = (await db.getAllAsync("SELECT id FROM employees WHERE id = ?", [r.id]).catch(() => [])) as any[];
            if (!existing.length) {
              const sm = (await db.getAllAsync("SELECT store_id FROM employee_stores WHERE employee_id = ? LIMIT 1", [r.id]).catch(() => [])) as any[];
              // Full explicit values: a previous version mixed literals with
              // too few bindings, landing created_at in `phone` and 0 in
              // `salary` on every fresh row. Count must match columns exactly.
              await db.runAsync(
                "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, email, salary, address, emergency_json, is_active, online_status, created_at, updated_at, lamport_clock, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [r.id, sm?.[0]?.store_id ?? "", name, role, email, 0, "", emergency, 1, 0, r.created_at ?? ts, ts, Number(r.lamport_clock ?? 0), 0, 0]
              );
            } else {
              await db.runAsync("UPDATE employees SET full_name = ?, role = ?, email = ?, emergency_json = ?, updated_at = ?, dirty = 0 WHERE id = ?", [name, role, email, emergency, ts, r.id]);
            }
          }
        } else if (ch.table === "store_members") {
          // Membership: (employee, store) assignment — the roster backbone.
          const eid = String(r.user_id ?? "");
          const sid = String(r.store_id ?? "");
          if (eid && sid) {
            await db.runAsync("INSERT OR IGNORE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [eid, sid]);
            // Ensure a local employee row exists so the roster lists the person
            // even when their profile row hasn't applied yet in this pull.
            const existing = (await db.getAllAsync("SELECT id FROM employees WHERE id = ?", [eid]).catch(() => [])) as any[];
            if (!existing.length) {
              const ts = new Date().toISOString();
              // Full explicit values (see profiles branch): the old
              // literal-mixed statement misaligned columns the same way.
              await db.runAsync(
                "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, phone, salary, address, is_active, online_status, created_at, updated_at, lamport_clock, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [eid, sid, "", String(r.role ?? "cashier"), null, 0, "", 1, 0, r.created_at ?? ts, ts, 0, 0, 0]
              );
            } else {
              await db.runAsync("UPDATE employees SET store_id = ? WHERE id = ? AND (store_id IS NULL OR store_id = '')", [sid, eid]);
            }
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
        } else if (ch.table === "categories") {
          // One live row per name per store (the UI enforces it). Any twin this
          // device minted while offline — or a ghost the old id-remap pushed —
          // must not stay: move every reference onto the surviving id and
          // tombstone the twin, so the register stops showing it twice. The
          // tombstone goes back out, so the cloud drops its copy too.
          const repoint = async (fromId: string, toId: string) => {
            await db.runAsync("UPDATE products SET category_id = ? WHERE category_id = ?", [toId, fromId]);
            // A product already linked to both would violate the pair key.
            await db.runAsync(
              "DELETE FROM product_categories WHERE category_id = ? AND product_id IN (SELECT product_id FROM product_categories WHERE category_id = ?)",
              [fromId, toId]
            );
            await db.runAsync("UPDATE product_categories SET category_id = ? WHERE category_id = ?", [toId, fromId]);
            await db.runAsync("UPDATE category_links SET child_id = ? WHERE child_id = ?", [toId, fromId]);
            await db.runAsync("UPDATE category_links SET parent_id = ? WHERE parent_id = ?", [toId, fromId]);
          };
          const nm = String(r.name ?? "").trim().toLowerCase();
          const keepId = String(r.id ?? "");
          if (nm && keepId) {
            const twins = ((await db.getAllAsync(
              "SELECT id FROM categories WHERE lower(trim(name)) = ? AND id <> ? AND (is_deleted = 0 OR is_deleted IS NULL)",
              [nm, keepId]
            ).catch(() => [])) as any[]) ?? [];
            for (const t of twins) {
              const tid = String(t.id);
              try {
                if (r.is_deleted) {
                  // Cloud dropped this one (the 022 dedupe, or a rename elsewhere):
                  // its references belong to the live twin under the same name.
                  await repoint(keepId, tid);
                  console.log(`[pull] category tombstone ${keepId} handed to ${tid}`);
                } else {
                  await repoint(tid, keepId);
                  const tnow = new Date().toISOString();
                  await db.runAsync("UPDATE categories SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?", [tnow, tid]);
                  const trow = ((await db.getAllAsync("SELECT * FROM categories WHERE id = ?", [tid]).catch(() => [])) as any[])?.[0];
                  if (trow) {
                    await insertOutbox("categories", "update", {
                      id: tid, store_id: trow.store_id ?? r.store_id ?? null, name: trow.name ?? null,
                      icon: trow.icon ?? null, updated_at: tnow, is_deleted: 1,
                    }, db);
                  }
                  console.log(`[pull] category twin folded into ${keepId}:`, tid);
                }
              } catch (e) { console.warn("[pull] category twin merge failed:", tid, e); }
            }
          }
          const ccols = CORE_SYNC_COLUMNS["categories"];
          const cvals = ccols.map((c) => {
            if (c === "dirty") return 0;
            const v = r[c] ?? null;
            return typeof v === "boolean" ? (v ? 1 : 0) : v;
          });
          await db.runAsync(
            `INSERT OR REPLACE INTO categories (${ccols.join(",")}) VALUES (${ccols.map(() => "?").join(",")})`,
            cvals
          );
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
      } catch (e) {
        console.warn("apply error", e);
        throw e;
      }
    }
    // Older screens still read the product stock cache. Keep it in step with
    // the authoritative per-store row after the entire pull batch is applied.
    for (const ch of changes) {
      const r = ch?.record;
      if (ch?.table !== "product_stock" || !r || r.is_deleted || r.store_id !== this.storeId) continue;
      await db.runAsync(
        "UPDATE products SET stock_quantity = ?, current_amount_available = ? WHERE id = ? AND store_id = ?",
        [Number(r.quantity ?? 0), Number(r.available ?? r.quantity ?? 0), r.product_id, r.store_id]
      );
    }
    // A pulled batch/quote row is a new fact about what the product cost:
    // republish the affected products' unit costs now, or items.cost stays
    // stale until the next launch (batches are the cost source of truth —
    // see recomputeItemCosts).
    try {
      const pids = new Set<string>();
      for (const ch of changes) {
        const r = ch?.record;
        if (ch?.table === "batches" && r?.item_id) pids.add(String(r.item_id));
        if (ch?.table === "product_supplier_costs" && r?.product_id) pids.add(`p:${String(r.product_id)}`);
      }
      const itemIds = [...pids].filter(x => !x.startsWith("p:"));
      const direct = [...pids].filter(x => x.startsWith("p:")).map(x => x.slice(2));
      const fromItems = itemIds.length
        ? (((await db.getAllAsync(
            `SELECT DISTINCT product_id FROM items WHERE id IN (${itemIds.map(() => "?").join(",")})`,
            itemIds
          ).catch(() => [])) ?? []) as any[]).map((x: any) => String(x.product_id))
        : [];
      for (const pid of [...new Set([...direct, ...fromItems])]) {
        try { await recomputeItemCosts(db, pid); } catch {}
      }
    } catch (e) { console.warn("pull recompute", e); }
    // Salary rows must republish the roster's display cache: the team list
    // reads employees.salary while the detail reads salary_history, and the
    // profiles pull carries no salary (local-only) — without this the
    // receiver's list keeps a stale/zero value forever.
    try {
      const touched = changes.some(
        (ch: any) => ch?.table === "salary_history" || ch?.table === "profiles" || ch?.table === "store_members"
      );
      if (touched) await healSalaryCaches(db);
    } catch (e) { console.warn("salary cache heal", e); }
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
