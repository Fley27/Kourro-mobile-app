import { SCHEMA_SQL } from "./schema";
import { fmtG } from "../format";
import { itemCostsFor } from "../analytics/metrics";
import { seedDevCatalogIfNeeded, buildDevCatalogMemory, devSeedEnabled } from "./devSeed";
import { runCatalogCutover, cleanupAutoBaseJunk, migrateInventoryBatches, backfillSkus, backfillSupplierCostItems, migrateBundlesToV3 } from "./cutoverCatalog";

// Web fallback: in-memory mock when expo-sqlite not available (Expo web)
let SQLite: any = null;
try {
  SQLite = require("expo-sqlite");
} catch {
  // expo-sqlite not available on this platform (e.g. web without native) — use mock
}

let db: any | null = null;

// Which storage backend is actually serving queries. "sqlite" = jesyon.db
// file on disk (HARD memory, survives rebundles/restarts). "memory" = RAM
// mock (data evaporates on every JS reload — only acceptable on web).
// Use getDbBackend() to inspect at runtime; getDb() logs transitions.
let backend: "unknown" | "sqlite" | "memory" = "unknown";
export function getDbBackend(): "unknown" | "sqlite" | "memory" {
  return backend;
}
const memStore = new Map<string, any[]>();

// ── assisted-order tables on the RAM/web fallback ───────────────────────────
// The mock dispatcher further down is hand-written per table, so the four
// assisted-ordering tables get a small generic engine instead: INSERT builds a
// row from the column list, UPDATE patches by WHERE column, SELECT evaluates
// the simple WHERE / ORDER BY / LIMIT shapes src/orders/store.ts uses. Keeps
// the order loop identical on web (memory) and on device (sqlite).
const ORDER_MEM_TABLES = new Set(["open_orders", "open_order_lines", "order_change_requests", "open_order_events"]);
function orderMemTable(sql: string): string | null {
  const m =
    /^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i.exec(sql) ??
    /^\s*SELECT\b[\s\S]*?\bFROM\s+(\w+)/i.exec(sql);
  const t = m?.[1] ?? "";
  return ORDER_MEM_TABLES.has(t) ? t : null;
}
function orderMemInsert(table: string, sql: string, params: any[]): void {
  const cols = (sql.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rec: any = {};
  cols.forEach((c, i) => { rec[c] = params[i] ?? null; });
  const arr = memStore.get(table) ?? [];
  arr.push(rec);
  memStore.set(table, arr);
}
function orderMemUpdate(table: string, sql: string, params: any[]): void {
  const setPart = sql.match(/SET\s+([\s\S]*?)\s+WHERE/i)?.[1] ?? "";
  const cols = setPart.split(",").map((s) => s.trim().split("=")[0].trim()).filter(Boolean);
  const whereCol = sql.match(/WHERE\s+(\w+)/i)?.[1] ?? "id";
  const rec = (memStore.get(table) ?? []).find((r) => r[whereCol] === params[cols.length]);
  if (!rec) return;
  cols.forEach((c, i) => { rec[c] = params[i] ?? null; });
}
function orderMemSelect(table: string, sql: string, params: any[]): any[] {
  let rows = (memStore.get(table) ?? []).map((r) => ({ ...r }));
  const whereM = /\bWHERE\b([\s\S]*?)(?:\s+ORDER BY[\s\S]*$|\s+LIMIT[\s\S]*$|$)/i.exec(sql);
  let pi = 0;
  if (whereM) {
    // split on top-level AND only (OR groups stay inside their parentheses)
    const parts: string[] = [];
    let depth = 0, buf = "";
    for (const tk of whereM[1].split(/(\s+AND\s+|\(|\))/i)) {
      if (/^\s*AND\s+$/i.test(tk) && depth === 0) { if (buf.trim()) parts.push(buf); buf = ""; continue; }
      if (tk === "(") depth++;
      if (tk === ")") depth--;
      buf += tk;
    }
    if (buf.trim()) parts.push(buf);

    for (const raw of parts) {
      const p = raw.trim();
      if (!p) continue;
      const inner = p.startsWith("(") && p.endsWith(")") ? p.slice(1, -1).trim() : p;
      if (/is_deleted\s*=\s*0/i.test(inner) && /IS NULL/i.test(inner)) {
        rows = rows.filter((r) => Number(r.is_deleted ?? 0) === 0);
        continue;
      }
      const orLit = /^\(\s*(\w+)\s*=\s*'([^']*)'\s+OR\s+(\w+)\s*=\s*'([^']*)'\s*\)$/i.exec(inner);
      if (orLit) {
        const [, c1, v1, c2, v2] = orLit;
        rows = rows.filter((r) => r[c1] === v1 || r[c2] === v2);
        continue;
      }
      const lit = /^(\w+)\s*=\s*'([^']*)'/.exec(inner);
      if (lit) { const [, c, v] = lit; rows = rows.filter((r) => r[c] === v); continue; }
      const inSet = /^(\w+)\s+IN\s*\(([^)]*)\)/i.exec(inner);
      if (inSet) {
        const c = inSet[1];
        const wanted = inSet[2].split(",").map((t) => {
          const v = t.trim();
          if (v === "?") return params[pi++];
          return v.replace(/^'|'$/g, "");
        });
        rows = rows.filter((r) => wanted.includes(r[c]));
        continue;
      }
      const par = /^(\w+)\s*=\s*\?/.exec(inner);
      if (par) { const c = par[1]; const v = params[pi++]; rows = rows.filter((r) => r[c] === v); continue; }
      // unsupported clause: leave rows as-is rather than dropping everything
    }
  }
  const ob = /\bORDER BY\s+([\s\S]*?)(?:\s+LIMIT\s+\d+)?\s*;?\s*$/i.exec(sql);
  if (ob) {
    const keys = ob[1].split(",").map((s) => ({
      col: s.trim().split(/\s+/)[0],
      dir: /DESC/i.test(s) ? -1 : 1,
    }));
    rows.sort((a, b) => {
      for (const k of keys) {
        const av = a[k.col], bv = b[k.col];
        if (av === bv) continue;
        if (av === null || av === undefined) return -1 * k.dir;
        if (bv === null || bv === undefined) return 1 * k.dir;
        return (av < bv ? -1 : 1) * k.dir;
      }
      return 0;
    });
  }
  const lim = /\bLIMIT\s+(\d+|\?)/i.exec(sql);
  if (lim) {
    const n = lim[1] === "?" ? Number(params[pi++]) : Number(lim[1]);
    if (Number.isFinite(n)) rows = rows.slice(0, n);
  }
  return rows;
}


// ── RAM-mock durability (web / failed native init) ──────────────────────────
// The memory backend must NOT behave like a temp cache: a rebundle would
// otherwise wipe an open shift (and every sale) that exists only in RAM.
// On platforms with localStorage (browsers) every mutation schedules a
// debounced whole-store snapshot; boot restores it before seeding, so an
// unclosed shift survives rebundles/reloads exactly like the sqlite file.
// Native never needs this: there the backend is jesyon.db on disk.
const MEM_SNAPSHOT_KEY = "jesyon.memdb.v1";
const MEM_SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000;
let memPersistTimer: ReturnType<typeof setTimeout> | null = null;
function memLS(): any | null {
  const ls = (globalThis as any).localStorage;
  return ls && typeof ls.setItem === "function" ? ls : null;
}
function flushMemSnapshot() {
  memPersistTimer = null;
  const ls = memLS();
  if (!ls) return;
  try {
    const tables: Record<string, any[]> = {};
    for (const [k, v] of memStore) tables[k] = v;
    ls.setItem(MEM_SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), tables }));
  } catch (e) { console.warn("[db] mem snapshot save failed:", String(e)); }
}
function scheduleMemPersist() {
  const ls = memLS();
  if (!ls) return;
  const g = globalThis as any;
  if (typeof g.addEventListener === "function" && !g.__jesyonMemFlush) {
    // Last word before a web reload: never leave the newest write unflushed.
    g.__jesyonMemFlush = true;
    g.addEventListener("beforeunload", () => { if (memPersistTimer) flushMemSnapshot(); });
  }
  if (memPersistTimer) clearTimeout(memPersistTimer);
  memPersistTimer = setTimeout(flushMemSnapshot, 250);
}
function hydrateMemFromSnapshot(): boolean {
  const ls = memLS();
  if (!ls) return false;
  try {
    const raw = ls.getItem(MEM_SNAPSHOT_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    const tables = snap?.tables;
    if (!tables || typeof tables !== "object") return false;
    if (Date.now() - Number(snap.savedAt ?? 0) > MEM_SNAPSHOT_TTL_MS) {
      ls.removeItem(MEM_SNAPSHOT_KEY);
      return false;
    }
    let n = 0;
    for (const [k, v] of Object.entries(tables)) {
      if (Array.isArray(v)) { memStore.set(k, v); n++; }
    }
    console.log(`[db] restored ${n} tables from localStorage snapshot — open shifts survived the rebundle`);
    return true;
  } catch (e) { console.warn("[db] mem snapshot restore failed:", String(e)); return false; }
}

// NOTE: catalog demo data used to live here as inline mockProductsSeed (18 rows).
// It now comes from packages/mock-catalog via src/db/devSeed.ts (seed-once, dev-only).
if (devSeedEnabled()) {
  try {
    const mem = buildDevCatalogMemory(new Date().toISOString());
    memStore.set("products", mem.products);
    memStore.set("categories", mem.categories);
    memStore.set("category_links", mem.category_links);
    memStore.set("product_categories", mem.product_categories);
    memStore.set("product_units", mem.product_units);
    memStore.set("product_prices", mem.product_prices);
    memStore.set("product_bundles", mem.product_bundles);
    memStore.set("suppliers", mem.suppliers);
    memStore.set("product_supplier_costs", mem.product_supplier_costs);
  } catch (e) { console.log("[dev seed] memory catalog skipped:", String(e)); }
}

const customersSeed = [
  { id: "cust-1", store_id: "demo-store-id", name: "Jean Baptiste", id_card_number: "004-123-4567", phone: "+509 3810 0001", address: "Delmas 33, Port-au-Prince", total_debt: 3500, credit_limit: 5000, credit_limit_source: "manual", is_high_risk: true, open_debt_count: 1 },
  { id: "cust-2", store_id: "demo-store-id", name: "Marie Claire", id_card_number: "004-987-6543", phone: "+509 3820 0002", address: "Pétion-Ville, Rue Panaméricaine", total_debt: 0, credit_limit: null, is_high_risk: false, open_debt_count: 0 },
  { id: "cust-3", store_id: "demo-store-id", name: "Frantz Delmas", id_card_number: "004-111-2222", phone: "+509 3833 0003", address: "Carrefour, Bizoton", total_debt: 0, credit_limit: null, is_high_risk: false, open_debt_count: 0 },
];
const creditsSeed = [
  { id: "debt-1", store_id: "demo-store-id", customer_id: "cust-1", sale_id: "sale-debt-1", amount: 3500, amount_paid: 0, balance: 3500, status: "pending", due_date: new Date(Date.now() - 5*24*3600*1000).toISOString().slice(0,10), created_at: new Date(Date.now() - 10*24*3600*1000).toISOString() },
];

export async function getDb(): Promise<any> {
  if (db) return db;
  if (SQLite) {
    try {
      db = await SQLite.openDatabaseAsync("jesyon.db");
      // Run schema statement-by-statement (not one giant exec): a single
      // failing statement must not abort the whole init and silently drop
      // us onto the RAM mock (which loses all sales on rebundle).
      // IMPORTANT: strip `--` line comments BEFORE splitting on ";", since
      // several comment blocks contain semicolons (e.g. "source of truth;",
      // "never UPDATE/DELETE;") — splitting first orphans the CREATE TABLE
      // that follows the comment and that table never gets created.
      // (Verified: no `--` occurs inside a quoted literal in schema.ts.)
      // Columns added AFTER the table's first release. These run BEFORE the
      // schema statement loop so the matching CREATE INDEX (which needs the
      // column) succeeds on the same launch, not the next one. Failing on a
      // brand-new database (table doesn't exist yet) is expected and harmless:
      // the CREATE TABLE below carries the column natively.
      try { await db.execAsync("ALTER TABLE batches ADD COLUMN session_ref TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE product_supplier_costs ADD COLUMN item_id TEXT"); } catch {}
      // PERSISTED per-item purchase cost (batch / supplier quote / ratio chain
      // / owner entry) — see recomputeItemCosts below. Ships with the CREATE
      // TABLE on a fresh install; this is the migration for an existing DB.
      try { await db.execAsync("ALTER TABLE items ADD COLUMN cost REAL NOT NULL DEFAULT 0"); } catch {}
      const statements = SCHEMA_SQL.replace(/--[^\n]*/g, "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        try {
          await db.execAsync(stmt + ";");
        } catch (e) {
          console.warn("[db] schema statement failed (continuing):", String(e), stmt.slice(0, 140));
        }
      }
      try { await db.execAsync("ALTER TABLE customers ADD COLUMN address TEXT"); } catch {}
      // --- migrations for sales seller attribution + created_at ---
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN seller_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN seller_role TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN created_at TEXT"); } catch {}
      // --- migrations for stores enhanced + categories ---
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN location TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN code TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN created_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN disabled INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN breach_flagged INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN breached_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN revoked_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN dirty INTEGER DEFAULT 0"); } catch {}
      // --- migration: received_at for stock_batches (manual date of arrival) ---
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN received_at TEXT"); } catch {}
      // --- migration: FIFO batch accounting ---
      try { await db.execAsync("ALTER TABLE products ADD COLUMN current_amount_available REAL DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN initial_qty REAL DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN remaining_qty REAL DEFAULT 0"); } catch {}
      // --- migration: loading-dock (pending -> delivered) ---
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN status TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN delivered_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN status TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN delivered_at TEXT"); } catch {}
      // Legacy rows hit the shelf before this migration, so treat them as delivered
      try { await db.execAsync("UPDATE stock_batches SET status = 'delivered' WHERE status IS NULL"); } catch {}
      try { await db.execAsync("UPDATE stock_movements SET status = 'delivered' WHERE status IS NULL"); } catch {}
      // --- migration: catalog item types (goods vs service) + availability ---
      try { await db.execAsync("ALTER TABLE products ADD COLUMN item_type TEXT DEFAULT 'goods'"); } catch {}
      try { await db.execAsync("ALTER TABLE products ADD COLUMN is_available INTEGER DEFAULT 1"); } catch {}
      try { await db.execAsync("UPDATE products SET item_type = 'goods' WHERE item_type IS NULL"); } catch {}
      try { await db.execAsync("UPDATE products SET is_available = 1 WHERE is_available IS NULL"); } catch {}
      // --- migration: multi-variant selling model (units / prices / bundles) ---
      try {
        const flagged = await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", ["seed_variants_v1"]);
        if (flagged.length === 0) {
          const now2 = new Date().toISOString();
          let legacy: any[] = [];
          try { legacy = await db.getAllAsync("SELECT id, selling_price, unit FROM products"); } catch { legacy = []; }
          for (const p of legacy) {
            let has: any[] = [{ id: 1 }];
            try { has = await db.getAllAsync("SELECT id FROM product_units WHERE product_id = ?", [p.id]); } catch {}
            if (has.length === 0) {
              const uid = `unit-${p.id}-base`;
              await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                [uid, p.id, p.unit || "Unit", 1, now2, now2]);
              await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
                [`price-${p.id}-regular`, uid, "Regular", Number(p.selling_price ?? 0), now2]);
            }
          }
          // Demo variant data (spec example): Prestige Cold single 200 HTG, 3 for 500
          try {
            const baseUnit = await db.getAllAsync("SELECT id FROM product_units WHERE id = ?", ["unit-prod-3-base"]);
            const cold = await db.getAllAsync("SELECT id FROM product_prices WHERE id = ?", ["price-prod-3-cold"]);
            if (baseUnit.length > 0 && cold.length === 0) {
              await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
                ["price-prod-3-cold", "unit-prod-3-base", "Cold", 200, now2]);
              await db.runAsync("INSERT OR REPLACE INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
                ["bundle-prod-3-cold-3", "unit-prod-3-base", "Cold", 3, 500, now2]);
            }
          } catch {}
          await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["seed_variants_v1", "1"]);
        }
      } catch {}
      // Drop legacy single-price columns (SQLite >= 3.35; ignored when absent/unsupported)
      try { await db.execAsync("ALTER TABLE products DROP COLUMN selling_price"); } catch {}
      try { await db.execAsync("ALTER TABLE products DROP COLUMN unit"); } catch {}
      // sale_items variant tracking (how each line was sold: unit + variant)
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN unit_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN variant TEXT"); } catch {}
      // --- migration: catalog x supplier (global join + unit condition + gratis flags) ---
      try { await db.execAsync("ALTER TABLE product_units ADD COLUMN condition TEXT"); } catch {}
      try { await db.execAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_unique ON product_units(product_id, unit_name, COALESCE(condition, ''))"); } catch {}
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS product_supplier_costs (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
        unit_id TEXT NOT NULL, cost REAL NOT NULL DEFAULT 0, last_updated TEXT,
        device_id TEXT, lamport_clock INTEGER DEFAULT 0, updated_at TEXT,
        is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
      )`); } catch {}
      try { await db.execAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_psc_unique ON product_supplier_costs(product_id, supplier_id, unit_id)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_psc_product ON product_supplier_costs(product_id)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_psc_supplier ON product_supplier_costs(supplier_id)"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN supplier_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN is_complimentary INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN complimentary_reason TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN approved_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN is_complimentary INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN approved_by TEXT"); } catch {}
      // --- migration: assisted ordering events carry store scope + LWW stamp ---
      try { await db.execAsync("ALTER TABLE open_order_events ADD COLUMN store_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE open_order_events ADD COLUMN updated_at TEXT"); } catch {}
      // --- migration: orders sync columns (schema.ts grew after older DBs were created;
      // without these, logEvent/line inserts fail with "no column named lamport_clock") ---
      try { await db.execAsync("ALTER TABLE open_order_events ADD COLUMN lamport_clock INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE open_order_events ADD COLUMN dirty INTEGER DEFAULT 1"); } catch {}
      try { await db.execAsync("ALTER TABLE open_order_lines ADD COLUMN created_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE order_change_requests ADD COLUMN lamport_clock INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE product_bundles ADD COLUMN unit_id TEXT"); } catch {}
      // --- migration: broadcast "ready for payment" (pool handoff flag) ---
      try { await db.execAsync("ALTER TABLE open_orders ADD COLUMN ready_for_payment INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE open_orders ADD COLUMN ready_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE open_orders ADD COLUMN ready_by TEXT"); } catch {}
      // --- migration: "ready" became its own order status (was a flag stacked
      // on "open", which allowed the two to appear at once) — flip legacy rows ---
      try { await db.execAsync("UPDATE open_orders SET status = 'ready' WHERE status = 'open' AND ready_for_payment = 1"); } catch {}
      // --- migration: orders carry their picked customer into the sale ---
      try { await db.execAsync("ALTER TABLE open_orders ADD COLUMN customer_id TEXT"); } catch {}
      // --- migration: category polyhierarchy (DAG edges) ---
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS category_links (
        id TEXT PRIMARY KEY, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
        device_id TEXT, lamport_clock INTEGER DEFAULT 0, updated_at TEXT,
        is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
      )`); } catch {}
      try { await db.execAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_category_links_unique ON category_links(child_id, parent_id)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_category_links_child ON category_links(child_id)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_category_links_parent ON category_links(parent_id)"); } catch {}
      // opening register FSM columns
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN check_date TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN set_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN set_by_role TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN is_default INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE credit_payments ADD COLUMN collected_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE credit_payments ADD COLUMN shift_id TEXT"); } catch {}
      // Customer email for receipt-by-email (post-payment options)
      try { await db.execAsync("ALTER TABLE customers ADD COLUMN email TEXT"); } catch {}
      // Structured customer fields, saved as received from the form
      for (const col of ["first_name TEXT", "last_name TEXT", "birth_day TEXT", "birth_month TEXT", "birth_year TEXT", "country TEXT", "department TEXT", "commune TEXT", "address_line1 TEXT", "address_line2 TEXT", "marketing_consent INTEGER DEFAULT 0"]) {
        try { await db.execAsync(`ALTER TABLE customers ADD COLUMN ${col}`); } catch {}
      }
      // Free-text customer notes
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS customer_notes (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        text TEXT NOT NULL, created_by TEXT, created_at TEXT
      )`); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id, created_at)"); } catch {}
      // --- staging: partial pickup / delivery tracking (additive only, dormant when OFF) ---
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN quantity_delivered REAL DEFAULT 0"); } catch {}
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS sale_pickups (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, sale_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL, quantity REAL NOT NULL,
        picked_up_by TEXT, created_at TEXT
      )`); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_sale_pickups_sale ON sale_pickups(sale_id)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_sale_pickups_item ON sale_pickups(sale_item_id)"); } catch {}
      // Existing rows were fully taken: backfill delivered = quantity where unset
      try { await db.execAsync("UPDATE sale_items SET quantity_delivered = quantity WHERE quantity_delivered IS NULL"); } catch {}
      // Repair rows written while delivered defaulted to 0 with no pickup history:
      // no pickup action = all products delivered together.
      try { await db.execAsync("UPDATE sale_items SET quantity_delivered = quantity WHERE quantity_delivered = 0 AND NOT EXISTS (SELECT 1 FROM sale_pickups WHERE sale_pickups.sale_item_id = sale_items.id)"); } catch {}
      // deficit settlements table
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS deficit_settlements (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, cashier_id TEXT NOT NULL,
        period_start TEXT NOT NULL, period_end TEXT NOT NULL, deficit_ids TEXT,
        total REAL DEFAULT 0, paid REAL DEFAULT 0, status TEXT DEFAULT 'open',
        created_by TEXT, paid_by TEXT, paid_at TEXT, created_at TEXT, updated_at TEXT
      )`); } catch {}
      // --- Business Guard: deficit decisions, report status flow, standby sales ---
      try { await db.execAsync("ALTER TABLE cashier_deficits ADD COLUMN resolution_reason TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cashier_deficits ADD COLUMN report_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE daily_reports ADD COLUMN standby_carry REAL DEFAULT 0"); } catch {}
      // --- Multi-shift days: link each report to the shift it closes. ---
      try { await db.execAsync("ALTER TABLE daily_reports ADD COLUMN shift_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN standby INTEGER DEFAULT 0"); } catch {}
      // Legacy vocabulary -> Business Guard vocabulary. status='paid' hid the
      // resolution in the status column; waived_negligible is the forgive path.
      try { await db.execAsync("UPDATE cashier_deficits SET resolution = 'paid', status = 'resolved' WHERE status = 'paid'"); } catch {}
      try { await db.execAsync("UPDATE cashier_deficits SET resolution = 'forgiven', status = 'resolved' WHERE resolution = 'waived_negligible'"); } catch {}
      // Weekly flag threshold: a deficit is flagged when it (or the employee's
      // rolling 90-day total) reaches this % of their own salary. Seed once.
      try { await db.execAsync("INSERT OR IGNORE INTO _meta (key, value) VALUES ('guard_deficit_flag_pct', '0.1')"); } catch {}
      // --- Unified Shift: pending openings, self-confirmed openings, auto-close ---
      // Cashier openings are entered as (stated amount, named manager) and stay
      // pending until that manager confirms; supervisors self-enter. auto_closed
      // marks shifts the system closed at the daily low-traffic time.
      try { await db.execAsync("ALTER TABLE shifts ADD COLUMN opening_stated REAL"); } catch {}
      try { await db.execAsync("ALTER TABLE shifts ADD COLUMN opening_confirmed_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE shifts ADD COLUMN auto_closed INTEGER DEFAULT 0"); } catch {}
      // Daily auto-close time (local "HH:MM") for manager/admin/owner shifts.
      try { await db.execAsync("INSERT OR IGNORE INTO _meta (key, value) VALUES ('shift_autoclose_time', '06:30')"); } catch {}
      // --- dev mock catalog (mock-catalog JSON, seed-once, dev-only) ---
      try { await seedDevCatalogIfNeeded(db); } catch (e) { console.log("[dev seed] skipped:", String(e)); }
      // --- catalog v2: product_suppliers.id added after first create ---
      try { await db.execAsync("ALTER TABLE product_suppliers ADD COLUMN id TEXT"); } catch {}
      try { await db.runAsync("UPDATE product_suppliers SET id = product_id || '__' || supplier_id WHERE id IS NULL"); } catch {}
      // --- catalog v2: smaller_item_id → ref_item_id (refs can be bigger now) ---
      try { await db.execAsync("ALTER TABLE items ADD COLUMN ref_item_id TEXT"); } catch {}
      try { await db.runAsync("UPDATE items SET ref_item_id = smaller_item_id WHERE ref_item_id IS NULL"); } catch {}
      try { await db.execAsync("ALTER TABLE items DROP COLUMN smaller_item_id"); } catch {}
      // --- catalog v2: product draft status (unfinished chains never list) ---
      try { await db.execAsync("ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
      try { await db.runAsync("UPDATE products SET status = 'active' WHERE status IS NULL"); } catch {}
      // --- batches: delivery identity + transport share (Inventory cards) ---
      try { await db.execAsync("ALTER TABLE batches ADD COLUMN delivery_ref TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE batches ADD COLUMN transport_share REAL DEFAULT 0"); } catch {}
      // --- inventory wizard v3: session ref, item-keyed costs, bundles v3 ---
      try { await db.execAsync("ALTER TABLE batches ADD COLUMN session_ref TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE product_supplier_costs ADD COLUMN item_id TEXT"); } catch {}
      // --- supplier structured address + payment methods + bank accounts ---
      try { await db.execAsync("ALTER TABLE suppliers ADD COLUMN country TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE suppliers ADD COLUMN department TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE suppliers ADD COLUMN city TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE suppliers ADD COLUMN payment_methods TEXT"); } catch {}
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
        id TEXT PRIMARY KEY, store_id TEXT, supplier_id TEXT NOT NULL,
        bank_name TEXT NOT NULL, currency TEXT NOT NULL, account_number TEXT,
        sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT,
        is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
      )`); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_batches_session_ref ON batches(session_ref)"); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_psc_item ON product_supplier_costs(item_id)"); } catch {}
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS bundles (
        id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, min_quantity REAL NOT NULL DEFAULT 1,
        active INTEGER DEFAULT 1, device_id TEXT, lamport_clock INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
      )`); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_bundles_variant ON bundles(variant_id)"); } catch {}
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS bundle_prices (
        id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, price REAL NOT NULL, date TEXT NOT NULL,
        device_id TEXT, lamport_clock INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
      )`); } catch {}
      try { await db.execAsync("CREATE INDEX IF NOT EXISTS idx_bundle_prices_bundle ON bundle_prices(bundle_id)"); } catch {}
      // --- catalog v2 full cutover (option a): migrate old rows, repoint readers ---
      try { await runCatalogCutover(db); } catch (e) { console.log("[cutover] catalog v2 skipped/failed:", String(e)); }
      try { await migrateInventoryBatches(db); } catch (e) { console.log("[migrate] inventory batches skipped:", String(e)); }
      try { await backfillSkus(db); } catch (e) { console.log("[backfill] skus skipped:", String(e)); }
      try { await cleanupAutoBaseJunk(db); } catch (e) { console.log("[cutover] auto-base cleanup skipped:", String(e)); }
      // Wizard v3 backfills: cheap, idempotent, safe to re-run every launch.
      try { await backfillSupplierCostItems(db); } catch (e) { console.log("[backfill] supplier cost items skipped:", String(e)); }
      try { await migrateBundlesToV3(db); } catch (e) { console.log("[migrate] bundles v3 skipped:", String(e)); }
      // Price every item once per launch: derived costs get written back to
      // items.cost (and pushed out), so a container is never cost-free again.
      try { await recomputeItemCosts(db); } catch (e) { console.log("[backfill] item costs skipped:", String(e)); }
      // --- demo customers/credits (credit flows need them; independent of catalog) ---
      try {
        const existing = await db.getAllAsync("SELECT id FROM customers LIMIT 1").catch(() => []);
        if (existing.length === 0) {
          const now = new Date().toISOString();
          for (const c of customersSeed) {
            await db.runAsync("INSERT OR REPLACE INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              [c.id, c.store_id, c.name, c.phone, c.address, c.id_card_number, c.total_debt, c.credit_limit, c.credit_limit_source, c.is_high_risk ? 1 : 0, c.open_debt_count]);
          }
          for (const c of creditsSeed) {
            await db.runAsync("INSERT OR REPLACE INTO credits (id, store_id, customer_id, sale_id, amount, amount_paid, balance, status, due_date, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              [c.id, c.store_id, c.customer_id, c.sale_id, c.amount, c.amount_paid, c.balance, c.status, c.due_date, c.created_at]);
          }
        }
      } catch {}
      backend = "sqlite";
      console.log("[db] backend=sqlite (jesyon.db on disk — data survives rebundles)");
      return db;
    } catch (e) {
      // Fallback to mock if native SQLite fails (e.g. web). LOUD: on a
      // phone/simulator this means every sale lives in RAM and vanishes on
      // the next rebundle — check the native module / pods if you see this.
      console.warn("[db] backend=memory FALLBACK — expo-sqlite init failed, data will NOT survive reload:", String(e));
      db = null;
      SQLite = null;
    }
  }
  // Restore a previous session's RAM store (web) BEFORE the seed blocks —
  // seeds use memStore.has(), so a restored snapshot replaces reseeding and
  // an unclosed shift/sale set shows up again right after a rebundle.
  hydrateMemFromSnapshot();
  // Seed stores + categories for persistent testing (except users)
  if (!memStore.has("stores")) {
    memStore.set("stores", [
      { id: "st-petyonvil", name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", created_at: new Date().toISOString(), disabled: 0, breach_flagged: 0, breached_at: null, revoked_by: null, currency: "HTG", updated_at: new Date().toISOString() },
      { id: "st-delma", name: "Delmas", location: "Dèlma", code: "DL-9034", created_at: new Date().toISOString(), disabled: 0, breach_flagged: 0, breached_at: null, revoked_by: null, currency: "HTG", updated_at: new Date().toISOString() },
    ]);
  }
  if (!memStore.has("categories")) memStore.set("categories", []);
  if (!memStore.has("category_links")) memStore.set("category_links", []);
  if (!memStore.has("suppliers")) memStore.set("suppliers", []);
  if (!memStore.has("product_supplier_costs")) memStore.set("product_supplier_costs", []);
  if (!memStore.has("product_categories")) memStore.set("product_categories", []);
  // Category polyhierarchy edges (DAG)
  if (!memStore.has("category_links")) memStore.set("category_links", []);
  if (!memStore.has("suspended_sales")) memStore.set("suspended_sales", []);
  if (!memStore.has("suspended_sale_items")) memStore.set("suspended_sale_items", []);
  if (!memStore.has("suspended_sale_events")) memStore.set("suspended_sale_events", []);
  if (!memStore.has("product_units")) {
    const nowm = new Date().toISOString();
    const prods = memStore.get("products") ?? [];
    memStore.set("product_units", prods.map((p: any) => ({ id: `unit-${p.id}-base`, product_id: p.id, unit_name: p.unit ?? "Unit", conversion_factor: 1, created_at: nowm, updated_at: nowm })));
  }
  if (!memStore.has("product_prices")) {
    // Safety net: base unit + Regular price for products lacking pricing.
    const nowm = new Date().toISOString();
    const units = memStore.get("product_units") ?? [];
    const prices = units.map((u: any) => {
      const prod = (memStore.get("products") ?? []).find((p: any) => p.id === u.product_id);
      return { id: `price-${u.product_id}-regular`, unit_id: u.id, variant: "Regular", price: Number(prod?.selling_price ?? 0), updated_at: nowm };
    });
    memStore.set("product_prices", prices);
  }
  if (!memStore.has("product_bundles")) memStore.set("product_bundles", []);
  // Catalog v2 tables (populated by the cutover from old-model seed data).
  if (!memStore.has("items")) memStore.set("items", []);
  if (!memStore.has("product_suppliers")) memStore.set("product_suppliers", []);
  if (!memStore.has("batches")) memStore.set("batches", []);
  if (!memStore.has("variants")) memStore.set("variants", []);
  if (!memStore.has("variant_prices")) memStore.set("variant_prices", []);
  // Bundles v3: record + effective-dated prices (populated by the cutover).
  if (!memStore.has("bundles")) memStore.set("bundles", []);
  if (!memStore.has("bundle_prices")) memStore.set("bundle_prices", []);
  // Catalog x Supplier join (global, no store scope)
  if (!memStore.has("product_supplier_costs")) memStore.set("product_supplier_costs", []);
  if (!memStore.has("stock_batches")) memStore.set("stock_batches", []);
  if (!memStore.has("stock_movements")) memStore.set("stock_movements", []);
  if (!memStore.has("_meta")) memStore.set("_meta", []);
  if (!memStore.has("receipts")) memStore.set("receipts", []);
  if (!memStore.has("report_reviews")) memStore.set("report_reviews", []);
  if (!memStore.has("standby_hands")) memStore.set("standby_hands", []);
  // Staging: partial pickup history (dormant when flag OFF)
  if (!memStore.has("sale_pickups")) memStore.set("sale_pickups", []);
  // Repair: rows with delivered=0 and no pickup history were fully taken together.
  try {
    const picks = memStore.get("sale_pickups") ?? [];
    const withHist = new Set(picks.map((p: any) => p.sale_item_id));
    for (const it of memStore.get("sale_items") ?? []) {
      if (Number(it.quantity_delivered ?? 0) === 0 && !withHist.has(it.id) && Number(it.quantity ?? 0) > 0) {
        it.quantity_delivered = it.quantity;
      }
    }
  } catch {}
  // Seed sales for demo shift report (today)
  if (!memStore.has("sales")) {
    memStore.set("sales", []);
    memStore.set("sale_items", []);
    memStore.set("sale_pickups", memStore.get("sale_pickups") ?? []);
    memStore.set("customer_notes", memStore.get("customer_notes") ?? []);
    memStore.set("customers", [...customersSeed]);
    memStore.set("customer_history", []);
    memStore.set("employees", [
      { id: "emp-1", store_id: "demo-store-id", full_name: "Jacques Owner", role: "owner", phone: "+509 1000 0001", salary: 85000, address: "Delmas 33, Port-au-Prince", is_active: 1, online_status: 1 },
      { id: "emp-2", store_id: "demo-store-id", full_name: "Marie Admin", role: "admin", phone: "+509 1000 0002", salary: 65000, address: "Pétion-Ville, Rue Panaméricaine", is_active: 1, online_status: 1 },
      { id: "emp-3", store_id: "demo-store-id", full_name: "Pierre Manager", role: "manager", phone: "+509 1000 0003", salary: 45000, address: "Carrefour, Bizoton", is_active: 1, online_status: 0 },
      { id: "emp-4", store_id: "demo-store-id", full_name: "Sophie Cashier", role: "cashier", phone: "+509 1000 0004", salary: 25000, address: "Tabarre, Route de l'Aéroport", is_active: 1, online_status: 0 },
      { id: "emp-5", store_id: "demo-store-id", full_name: "Jean-Louis Dupont", role: "cashier", phone: "+509 3456 7890", salary: 22000, address: "Jacmel, Centre-Ville", is_active: 0, online_status: 0 },
      { id: "emp-6", store_id: "demo-store-id", full_name: "Marie-Claire Fontaine", role: "manager", phone: "+509 4567 8901", salary: 48000, address: "Cap-Haïtien, Bas-Rivière", is_active: 1, online_status: 1 },
      { id: "emp-7", store_id: "demo-store-id", full_name: "Robenson Saintil", role: "cashier", phone: "+509 5678 9012", salary: 20000, address: "Les Cayes, Boucan Rouge", is_active: 0, online_status: 0 },
      { id: "emp-8", store_id: "demo-store-id", full_name: "Tatiana Beaumont", role: "admin", phone: "+509 6789 0123", salary: 60000, address: "Pétion-Ville, Nazon", is_active: 1, online_status: 1 },
    ]);
    memStore.set("shifts", []);
    memStore.set("cash_movements", []);
    memStore.set("debt_collections", []);
    memStore.set("cash_requests", []);
    memStore.set("cash_discrepancies", []);
    memStore.set("notifications", []);
    memStore.set("daily_reports", []);
    memStore.set("cashier_deficits", []);
    memStore.set("monthly_losses", []);
    memStore.set("cash_register_checks", []);
    memStore.set("deficit_settlements", []);
    memStore.set("salary_deductions", []);
    memStore.set("credits", [...creditsSeed]);
    memStore.set("credit_payments", []);
  }
  // in-memory mock for web. With localStorage present the store is mirrored
  // there too (write-through snapshot), so rebundles restore it instead of
  // wiping an open shift. Without it, RAM only — data lost on every reload.
  if (backend !== "memory") {
    console.warn(
      memLS()
        ? "[db] backend=memory (RAM mock + localStorage snapshot — survives rebundles on web)"
        : "[db] backend=memory (RAM mock — data will NOT survive reloads)",
    );
  }
  backend = "memory";
  db = {
    execAsync: async () => {},
    runAsync: async (sql: string, params: any[]) => {
      const oTable = orderMemTable(sql);
      if (oTable) {
        if (/^\s*INSERT/i.test(sql)) orderMemInsert(oTable, sql, params);
        else if (/^\s*UPDATE/i.test(sql)) orderMemUpdate(oTable, sql, params);
        else if (/^\s*DELETE/i.test(sql)) {
          const col = sql.match(/WHERE\s+(\w+)/i)?.[1];
          const arr = memStore.get(oTable) ?? [];
          memStore.set(oTable, col ? arr.filter((r) => r[col] !== params[0]) : []);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.includes("INSERT INTO outbox")) {
        const arr = memStore.get("outbox") ?? [];
        arr.push({ id: params[0], table_name: params[1], operation: params[2], payload: params[3], created_at: params[4] });
        memStore.set("outbox", arr);
      } else if (sql.includes("INSERT INTO products")) {
        const products = memStore.get("products") ?? [];
        const cols = (sql.match(/INTO products\s*\((.*?)\)/i)?.[1] ?? "id,store_id,sku,name").split(",").map(s => s.trim());
        const at = (name: string): any => {
          const i = cols.indexOf(name);
          return i >= 0 ? params[i] : undefined;
        };
        const id = params[0];
        if (!products.some((p: any) => p.id === id)) {
          products.push({
            id,
            store_id: at("store_id") ?? params[1],
            sku: at("sku") ?? params[2],
            barcode: at("barcode") ?? at("sku") ?? params[2],
            name: at("name") ?? params[3],
            category_id: at("category_id") ?? params[4],
            stock_quantity: Number(at("stock_quantity") ?? 0),
            current_amount_available: Number(at("current_amount_available") ?? at("stock_quantity") ?? 0),
            low_stock_threshold: Number(at("low_stock_threshold") ?? 5),
            item_type: at("item_type") ?? "goods",
            is_available: at("is_available") ?? 1,
            updated_at: new Date().toISOString(),
            is_deleted: 0,
            dirty: 1,
          });
          memStore.set("products", products);
        }
      } else if (sql.includes("INTO product_units")) {
        const arr = memStore.get("product_units") ?? [];
        const colPart = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(s => s.trim());
        const at = (name: string): any => {
          const i = colPart.indexOf(name);
          return i >= 0 ? params[i + 1] : undefined;
        };
        const rec = { id: params[0], product_id: params[1], unit_name: at("unit_name") ?? params[2], condition: at("condition") ?? null, conversion_factor: Number(at("conversion_factor") ?? params[3] ?? 1), created_at: at("created_at") ?? params[4] ?? new Date().toISOString(), updated_at: at("updated_at") ?? params[5] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_units", arr);
      } else if (sql.includes("INTO product_prices")) {
        const arr = memStore.get("product_prices") ?? [];
        const rec = { id: params[0], unit_id: params[1], variant: params[2], price: Number(params[3] ?? 0), updated_at: params[4] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_prices", arr);
      } else if (sql.includes("INTO product_bundles")) {
        const arr = memStore.get("product_bundles") ?? [];
        const cols = (sql.match(/INTO product_bundles\s*\((.*?)\)/i)?.[1] ?? "id,unit_id,variant,min_quantity,bundle_price,created_at").split(",").map(s => s.trim());
        const at = (name: string): any => {
          const i = cols.indexOf(name);
          return i >= 0 ? params[i] : undefined;
        };
        const rec = { id: params[0], unit_id: at("unit_id"), variant_id: at("variant_id") ?? null, variant: at("variant") ?? params[2], min_quantity: Number(at("min_quantity") ?? params[3] ?? 0), bundle_price: Number(at("bundle_price") ?? params[4] ?? 0), created_at: at("created_at") ?? params[5] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_bundles", arr);
      } else if (
        sql.includes("INTO items") ||
        sql.includes("INTO variants") ||
        sql.includes("INTO variant_prices") ||
        sql.includes("INTO batches") ||
        sql.includes("INTO bundles") ||
        sql.includes("INTO bundle_prices") ||
        sql.includes("INTO product_suppliers")
      ) {
        // Catalog v2 generic upsert: column list parsed from the statement.
        const m = sql.match(/INTO\s+(\w+)\s*\((.*?)\)/i);
        const table = m?.[1] ?? "items";
        const cols = (m?.[2] ?? "id").split(",").map(c => c.trim());
        const arr = memStore.get(table) ?? [];
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        if (typeof rec.is_deleted === "undefined") rec.is_deleted = 0;
        let ui = arr.findIndex((x: any) => x.id != null && rec.id != null && x.id === rec.id);
        if (ui < 0 && table === "product_suppliers") {
          ui = arr.findIndex((x: any) => x.product_id === rec.product_id && x.supplier_id === rec.supplier_id);
        }
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set(table, arr);
      } else if (sql.includes("INTO product_supplier_costs")) {
        // Global join upsert: one row per (product, supplier, unit).
        const arr = memStore.get("product_supplier_costs") ?? [];
        const cols = (sql.match(/INTO product_supplier_costs\s*\((.*?)\)/i)?.[1] ?? "id,product_id,supplier_id,unit_id,cost,last_updated").split(",").map(c => c.trim());
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        rec.cost = Number(rec.cost ?? 0);
        rec.last_updated = rec.last_updated ?? new Date().toISOString();
        rec.updated_at = rec.updated_at ?? rec.last_updated;
        rec.is_deleted = rec.is_deleted ? 1 : 0;
        const ui = arr.findIndex((x: any) => x.product_id === rec.product_id && x.supplier_id === rec.supplier_id && x.unit_id === rec.unit_id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec, id: arr[ui].id };
        else {
          if (!rec.id) rec.id = `psc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          arr.push(rec);
        }
        memStore.set("product_supplier_costs", arr);
      } else if (sql.includes("UPDATE product_supplier_costs SET")) {
        const arr = memStore.get("product_supplier_costs") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
      } else if (/UPDATE\s+(items|variants|variant_prices|batches|bundles|bundle_prices)\s+SET/i.test(sql)) {
        // Catalog v2 generic update-by-id (manage screens).
        const table = (sql.match(/UPDATE\s+(\w+)\s+SET/i)?.[1] ?? "items") as string;
        const arr = memStore.get(table) ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
        memStore.set(table, arr);
      } else if (sql.includes("UPDATE product_prices SET") || sql.includes("UPDATE product_units SET")) {
        const target = sql.includes("UPDATE product_prices SET") ? "product_prices" : "product_units";
        const arr = memStore.get(target) ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE products SET")) {
        const products = memStore.get("products") ?? [];
        const id = params[params.length - 1];
        const p = products.find((x: any) => x.id === id);
        if (p) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const plus = c2.match(/^(\w+)\s*=\s*(\w+)\s*\+\s*\?$/);
            const minus = c2.match(/^(\w+)\s*=\s*(\w+)\s*-\s*\?$/);
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (plus && plus[1] === plus[2]) p[plus[1]] = Number(p[plus[1]] ?? 0) + Number(params[i] ?? 0);
            else if (minus && minus[1] === minus[2]) p[minus[1]] = Number(p[minus[1]] ?? 0) - Number(params[i] ?? 0);
            else if (plain) p[plain[1]] = params[i];
          });
          p.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stock_movements SET")) {
        const movs = memStore.get("stock_movements") ?? [];
        const id = params[params.length - 1];
        const m = movs.find((x: any) => x.id === id);
        if (m) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const minus = c2.match(/^(\w+)\s*=\s*(\w+)\s*-\s*\?$/);
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (minus && minus[1] === minus[2]) m[minus[1]] = Number(m[minus[1]] ?? 0) - Number(params[i] ?? 0);
            else if (plain) m[plain[1]] = params[i];
          });
          m.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stock_batches SET")) {
        const batches = memStore.get("stock_batches") ?? [];
        const id = params[params.length - 1];
        const b = batches.find((x: any) => x.id === id);
        if (b) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (plain) b[plain[1]] = params[i];
          });
          b.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE products SET")) {
        const products = memStore.get("products") ?? [];
        // Handle both stock_quantity +/- and generic column updates (selling_price, name, sku, category_id, etc.)
        if (sql.includes("stock_quantity")) {
          const qty = Number(params[0] ?? 0);
          const id = params[1];
          const p = products.find((x: any) => x.id === id);
          if (p) {
            if (sql.includes("stock_quantity + ?")) p.stock_quantity = (Number(p.stock_quantity ?? 0) + qty);
            else if (sql.includes("stock_quantity - ?")) p.stock_quantity = (Number(p.stock_quantity ?? 0) - qty);
            else p.stock_quantity = Number(params[0] ?? p.stock_quantity);
            if (sql.includes("selling_price")) {
              // case: UPDATE products SET stock_quantity = ..., selling_price = ? WHERE id = ?
              // params[0]=qty, params[1]=price, params[2]=id → handled separately below as generic
            }
            p.updated_at = new Date().toISOString();
          }
        } else {
          const id = params[params.length - 1];
          const p = products.find((x: any) => x.id === id);
          if (p) {
            const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
            const cols = setPart.split(",").map(c => c.trim().replace(/\s*=\s*\??$/, "").trim());
            cols.forEach((col, i) => {
              if (params[i] !== undefined) (p as any)[col] = params[i];
            });
            p.updated_at = new Date().toISOString();
          }
        }
      } else if (sql.includes("INSERT INTO sales")) {
        const sales = memStore.get("sales") ?? [];
        // Column-parsed (mirrors the standby_hands branch): callers list their
        // own column order — positional guessing broke when standby landed.
        const ts = new Date().toISOString();
        const sCols = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(c => c.trim());
        const sAt = (name: string): any => { const i = sCols.indexOf(name); return i >= 0 ? params[i + 1] : undefined; };
        sales.push({
          id: params[0], store_id: sAt("store_id"), sale_number: sAt("sale_number"),
          customer_id: sAt("customer_id") ?? null, status: sAt("status"),
          payment_method: sAt("payment_method"), subtotal: sAt("subtotal"), total: sAt("total"),
          amount_paid: sAt("amount_paid"), amount_due: sAt("amount_due"),
          seller_id: sAt("seller_id") ?? null, seller_role: sAt("seller_role") ?? null,
          standby: Number(sAt("standby") ?? 0),
          created_at: sAt("created_at") ?? ts, updated_at: sAt("updated_at") ?? ts,
        });
        memStore.set("sales", sales);
      } else if (sql.includes("INSERT INTO daily_reports")) {
        const arr = memStore.get("daily_reports") ?? [];
        const ts = new Date().toISOString();
        const rCols = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(c => c.trim());
        const rAt = (name: string): any => { const i = rCols.indexOf(name); return i >= 0 ? params[i + 1] : undefined; };
        const num = (v: any, d = 0) => (v === undefined || v === null ? d : Number(v));
        arr.push({
          id: params[0], store_id: rAt("store_id"), report_date: rAt("report_date"),
          role: rAt("role"), user_id: rAt("user_id"), shift_id: rAt("shift_id") ?? null, status: rAt("status") ?? "pending",
          standby_carry: num(rAt("standby_carry")),
          opening_balance: num(rAt("opening_balance")), expected_cash: num(rAt("expected_cash")),
          actual_cash: rAt("actual_cash") ?? null,
          cash_sales: num(rAt("cash_sales")), moncash_sales: num(rAt("moncash_sales")),
          natcash_sales: num(rAt("natcash_sales")), credit_sales: num(rAt("credit_sales")),
          credit_collected_cash: num(rAt("credit_collected_cash")),
          credit_collected_moncash: num(rAt("credit_collected_moncash")),
          credit_collected_natcash: num(rAt("credit_collected_natcash")),
          withdrawals_total: num(rAt("withdrawals_total")), inventory_total: num(rAt("inventory_total")),
          deficit: num(rAt("deficit")),
          submitted_at: rAt("submitted_at") ?? null, closed_at: rAt("closed_at") ?? null,
          created_at: rAt("created_at") ?? ts, updated_at: rAt("updated_at") ?? ts,
          reviewed_by: rAt("reviewed_by") ?? null, reviewed_at: rAt("reviewed_at") ?? null,
        });
        memStore.set("daily_reports", arr);
      } else if (sql.includes("INSERT INTO cashier_deficits")) {
        const arr = memStore.get("cashier_deficits") ?? [];
        const cd = { id: params[0], store_id: params[1], cashier_id: params[2], date: params[3], deficit: params[4] ?? 0, status: params[5] ?? "open", resolution: params[6] ?? null, resolved_by: params[7] ?? null, resolved_at: params[8] ?? null, notes: params[9] ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        if (params.length === 7) { cd.status = params[5] ?? "open"; cd.created_at = params[6] ?? new Date().toISOString(); }
        arr.push(cd);
        memStore.set("cashier_deficits", arr);
      } else if (sql.includes("INSERT INTO monthly_losses")) {
        const arr = memStore.get("monthly_losses") ?? [];
        arr.push({ id: params[0], store_id: params[1], month: params[2], cashier_id: params[3], amount: params[4] ?? 0, origin: params[5] ?? null, reason: params[6] ?? null, registered_by: params[7] ?? null, created_at: params[8] ?? new Date().toISOString() });
        memStore.set("monthly_losses", arr);
      } else if (sql.includes("INSERT INTO report_reviews")) {
        const arr = memStore.get("report_reviews") ?? [];
        arr.push({
          id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3],
          report_date: params[4], deficit: Number(params[5] ?? 0), decision: params[6],
          decided_by: params[7] ?? null, decided_by_role: params[8] ?? null,
          decided_by_rank: Number(params[9] ?? 0), reason: params[10] ?? null,
          previous_review_id: params[11] ?? null, created_at: params[12] ?? new Date().toISOString(),
          lamport_clock: Number(params[13] ?? 0), updated_at: params[12] ?? new Date().toISOString(),
        });
        memStore.set("report_reviews", arr);
      } else if (sql.includes("INSERT INTO standby_hands")) {
        const arr = memStore.get("standby_hands") ?? [];
        const ts = new Date().toISOString();
        const colPart = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(s => s.trim());
        const at = (name: string): any => { const i = colPart.indexOf(name); return i >= 0 ? params[i + 1] : undefined; };
        arr.push({
          id: params[0], store_id: at("store_id"), cashier_id: at("cashier_id"),
          manager_id: at("manager_id") ?? null, report_id: at("report_id") ?? null,
          carried_into_report_id: at("carried_into_report_id") ?? null,
          sale_count: Number(at("sale_count") ?? 0), amount: Number(at("amount") ?? 0),
          handed_at: at("handed_at") ?? null, cashier_confirmed: Number(at("cashier_confirmed") ?? 0),
          confirmed_at: at("confirmed_at") ?? null, carried_at: at("carried_at") ?? null,
          created_at: at("created_at") ?? ts, updated_at: ts,
        });
        memStore.set("standby_hands", arr);
      } else if (sql.includes("INSERT INTO cash_register_checks")) {
        const arr = memStore.get("cash_register_checks") ?? [];
        const ts = new Date().toISOString();
        let c: any;
        if (params.length >= 15 && sql.includes("check_date")) {
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: params[4] ?? ts.slice(0,10), stated_amount: params[5] ?? 0, program_amount: params[6] ?? 0, status: params[7] ?? "pending", action: params[8] ?? null, set_by: params[9] ?? "owner-1", set_by_role: params[10] ?? "owner", is_default: params[11] ?? 0, approved_by: params[12] ?? null, correct_amount: params[13] ?? null, created_at: params[14] ?? ts, updated_at: ts };
        } else if (params.length === 11) {
          const created = params[10] ?? ts;
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: created.slice(0,10), stated_amount: params[4] ?? 0, program_amount: params[5] ?? 0, status: params[6] ?? "pending", action: params[7] ?? null, set_by: "owner-1", set_by_role: "owner", is_default: 1, approved_by: params[8] ?? null, correct_amount: params[9] ?? null, created_at: created, updated_at: ts };
        } else {
          const created = params[8] ?? ts;
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: created.slice(0,10), stated_amount: params[4] ?? 0, program_amount: params[5] ?? 0, status: params[6] ?? "pending", action: params[7] ?? null, set_by: "owner-1", set_by_role: "owner", is_default: 1, approved_by: null, correct_amount: null, created_at: created, updated_at: ts };
          if (params.length === 9) { c.action = params[7] ?? null; c.created_at = params[8] ?? ts; c.updated_at = ts; }
        }
        arr.push(c);
        memStore.set("cash_register_checks", arr);
      } else if (sql.includes("INSERT INTO deficit_settlements")) {
        const arr = memStore.get("deficit_settlements") ?? [];
        const ts = new Date().toISOString();
        const s = { id: params[0], store_id: params[1], cashier_id: params[2], period_start: params[3], period_end: params[4], deficit_ids: params[5] ?? "[]", total: Number(params[6] ?? 0), paid: Number(params[7] ?? 0), status: params[8] ?? "open", created_by: params[9] ?? null, paid_by: params[10] ?? null, paid_at: params[11] ?? null, created_at: params[12] ?? ts, updated_at: ts };
        if (s.paid >= s.total && s.total > 0) s.status = "paid";
        else if (s.paid > 0) s.status = "partial";
        arr.push(s);
        memStore.set("deficit_settlements", arr);
      } else if (sql.includes("INSERT INTO salary_deductions")) {
        const arr = memStore.get("salary_deductions") ?? [];
        arr.push({ id: params[0], store_id: params[1], cashier_id: params[2], amount: params[3] ?? 0, deficit_ids: params[4] ?? null, registered_by: params[5] ?? null, created_at: params[6] ?? new Date().toISOString() });
        memStore.set("salary_deductions", arr);
      } else if (sql.includes("INSERT INTO sale_items")) {
        const items = memStore.get("sale_items") ?? [];
        // Column-parsed (handles 12-col legacy + 13-col with quantity_delivered).
        // No pickup action = all products delivered together: delivered defaults to quantity.
        const colPart = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(s => s.trim());
        const at = (name: string): any => {
          const i = colPart.indexOf(name);
          return i >= 0 ? params[i + 1] : undefined;
        };
        const qty = Number(at("quantity") ?? params[7] ?? 0);
        const qd = at("quantity_delivered");
        items.push({ id: params[0], store_id: params[1], sale_id: params[2], product_id: params[3], product_name: params[4], unit_id: params[5] ?? null, variant: params[6] ?? null, quantity: qty, unit_price: at("unit_price") ?? params[8], cost_price: at("cost_price") ?? params[9], line_total: at("line_total") ?? params[10], quantity_delivered: qd ?? qty, created_at: at("created_at") ?? at("updated_at") ?? params[11] ?? new Date().toISOString() });
        memStore.set("sale_items", items);
      } else if (sql.includes("INTO sale_pickups")) {
        // Staging only: append-only pickup history. Dormant when flag OFF.
        const arr = memStore.get("sale_pickups") ?? [];
        arr.push({ id: params[0], store_id: params[1], sale_id: params[2], sale_item_id: params[3], quantity: Number(params[4] ?? 0), picked_up_by: params[5] ?? null, created_at: params[6] ?? new Date().toISOString() });
        memStore.set("sale_pickups", arr);
      } else if (sql.includes("UPDATE sale_items SET")) {
        // Staging only: quantity_delivered adjustments. Generic SET parser (dormant when OFF).
        const items = memStore.get("sale_items") ?? [];
        const id = params[params.length - 1];
        const it = items.find((x: any) => x.id === id);
        if (it) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (it as any)[col] = params[i]; });
        }
      } else if (sql.includes("INTO receipts")) {
        const arr = memStore.get("receipts") ?? [];
        const idx = arr.findIndex((x: any) => x.id === params[0]);
        const rec = { id: params[0], store_id: params[1], sale_id: params[2], copy_type: params[3], receipt_number: params[4], sale_number: params[5], cashier_id: params[6] ?? null, cashier_name: params[7] ?? null, cashier_role: params[8] ?? null, content: params[9], created_at: params[10] ?? new Date().toISOString() };
        if (idx >= 0) arr[idx] = rec; else arr.push(rec);
        memStore.set("receipts", arr);
      } else if (sql.includes("INSERT INTO credits")) {
        const credits = memStore.get("credits") ?? [];
        if (params.length >= 10 && sql.includes("due_date")) {
          // 10-col: id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], amount_paid: params[5], balance: params[6], status: params[7], due_date: params[8] ?? null, created_at: params[9] ?? new Date().toISOString(), updated_at: params[9] ?? new Date().toISOString() });
        } else if (params.length >= 9 && sql.includes("due_date")) {
          // new 9-col: id,store_id,sale_id,customer_id,amount,balance,status,due_date,updated_at
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], balance: params[5], status: params[6], due_date: params[7] ?? null, created_at: params[8] ?? new Date().toISOString(), updated_at: params[8] ?? new Date().toISOString() });
        } else {
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], balance: params[5], status: params[6], created_at: params[7] ?? new Date().toISOString(), updated_at: params[7] ?? new Date().toISOString() });
        }
        memStore.set("credits", credits);
      } else if (sql.includes("INSERT INTO credit_payments")) {
        const payments = memStore.get("credit_payments") ?? [];
        payments.push({
          id: params[0],
          store_id: params[1],
          credit_id: params[2],
          debt_id: params[3],
          amount: params[4],
          payment_method: params[5],
          receipt_number: params[6],
          created_at: params[7] ?? new Date().toISOString(),
          collected_by: params[8] ?? null,
          shift_id: params[9] ?? null,
        });
        memStore.set("credit_payments", payments);
      } else if (sql.includes("INSERT INTO shifts")) {
        // Column-parsed: callers list their own column order (the unified Shift
        // screen writes opening_stated / opening_confirmed_by selectively).
        const shifts = memStore.get("shifts") ?? [];
        const ts = new Date().toISOString();
        const colPart = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(s => s.trim());
        const at = (name: string): any => { const i = colPart.indexOf(name); return i >= 0 ? params[i + 1] : undefined; };
        shifts.push({
          id: params[0], store_id: at("store_id"), cashier_id: at("cashier_id"),
          manager_id: at("manager_id") ?? null, opening_balance: Number(at("opening_balance") ?? 0),
          opening_stated: at("opening_stated") != null ? Number(at("opening_stated")) : undefined,
          opening_confirmed_by: at("opening_confirmed_by") ?? null,
          status: at("status"), start_time: at("start_time") ?? ts, end_time: at("end_time") ?? null,
          actual_cash: at("actual_cash") != null ? Number(at("actual_cash")) : undefined,
          cashier_confirmed: Number(at("cashier_confirmed") ?? 0), manager_confirmed: Number(at("manager_confirmed") ?? 0),
          supervisor_confirmed: Number(at("supervisor_confirmed") ?? 0), auto_closed: Number(at("auto_closed") ?? 0),
          created_at: at("created_at") ?? ts, updated_at: at("updated_at") ?? ts,
        });
        memStore.set("shifts", shifts);
      } else if (sql.includes("INSERT INTO cash_movements")) {
        const cms = memStore.get("cash_movements") ?? [];
        let cm: any;
        // Support both 9 and 10 params (with taken_by)
        if (params.length === 10) {
          cm = { id: params[0], shift_id: params[1], store_id: params[2], type: params[3], amount: params[4], reason: params[5], created_by: params[6], taken_by: params[7], validated_by: params[8], created_at: params[9] };
        } else {
          cm = { id: params[0], shift_id: params[1], store_id: params[2], type: params[3], amount: params[4], reason: params[5], created_by: params[6], validated_by: params[7], created_at: params[8] };
        }
        cms.push(cm);
        memStore.set("cash_movements", cms);
        // Notify all supervisors of the store on any cash movement OUT (withdrawal / inventory)
        if (cm.type === "withdrawal" || cm.type === "inventory") {
          const notifs = memStore.get("notifications") ?? [];
          const label = cm.type === "inventory" ? `Kach envantè ${fmtG(cm.amount)}` : `Retrè ${fmtG(cm.amount)}`;
          for (const sup of ["owner-1", "admin-1", "manager-1"]) {
            if (sup === cm.created_by) continue;
            notifs.push({ id: `notif-${Date.now()}-${sup}-${Math.random().toString(36).slice(2, 4)}`, user_id: sup, type: cm.type === "inventory" ? "inventory_pickup" : "withdrawal", reference_id: cm.id, message: `${label} — ${cm.reason ?? ""}`.trim(), status: "pending", created_at: new Date().toISOString() });
          }
          memStore.set("notifications", notifs);
        }
      } else if (sql.includes("INSERT INTO debt_collections")) {
        const dcs = memStore.get("debt_collections") ?? [];
        const dcCols = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "shift_id,customer_id,amount,created_at").split(",").map(s => s.trim());
        const dcAt = (name: string): any => { const i = dcCols.indexOf(name); return i >= 0 ? params[i + 1] : undefined; };
        dcs.push({ id: params[0], shift_id: dcAt("shift_id"), store_id: dcAt("store_id") ?? null, customer_id: dcAt("customer_id") ?? null, amount: Number(dcAt("amount") ?? 0), created_at: dcAt("created_at") ?? new Date().toISOString() });
        memStore.set("debt_collections", dcs);
      } else if (sql.includes("INSERT INTO customer_history")) {
        const history = memStore.get("customer_history") ?? [];
        history.push({ id: params[0], customer_id: params[1], user_id: params[2], action: params[3], field_name: params[4], old_value: params[5], new_value: params[6], created_at: params[7] });
        memStore.set("customer_history", history);
      } else if (sql.includes("INTO customer_notes")) {
        const arr = memStore.get("customer_notes") ?? [];
        arr.push({ id: params[0], store_id: params[1], customer_id: params[2], text: params[3], created_by: params[4] ?? null, created_at: params[5] ?? new Date().toISOString() });
        memStore.set("customer_notes", arr);
      } else if (sql.includes("INSERT INTO cash_requests")) {
        const crs = memStore.get("cash_requests") ?? [];
        crs.push({ id: params[0], shift_id: params[1], amount: params[2], reason: params[3], created_by: params[4], status: params[5], created_at: params[6] });
        memStore.set("cash_requests", crs);
      } else if (sql.includes("INSERT INTO notifications")) {
        const notifs = memStore.get("notifications") ?? [];
        notifs.push({
          id: params[0],
          user_id: params[1],
          type: params[2],
          reference_id: params[3],
          message: params[4],
          status: params[5],
          created_at: params[6] ?? new Date().toISOString(),
        });
        memStore.set("notifications", notifs);
      } else if (sql.includes("INSERT INTO employees")) {
        const emps = memStore.get("employees") ?? [];
        emps.push({ id: params[0], store_id: params[1], full_name: params[2], role: params[3], phone: params[4], salary: params[5], address: params[6], is_active: params[7], online_status: params[8], created_at: params[9] ?? new Date().toISOString() });
        memStore.set("employees", emps);
      } else if (sql.includes("UPDATE employees SET")) {
        const emps = memStore.get("employees") ?? [];
        const id = params[params.length - 1];
        const emp = emps.find((x: any) => x.id === id);
        if (emp) {
          if (sql.includes("full_name")) emp.full_name = params[0];
          if (sql.includes("role")) emp.role = params[0];
          if (sql.includes("phone")) emp.phone = params[0];
          if (sql.includes("salary")) emp.salary = params[0];
          if (sql.includes("address")) emp.address = params[0];
          if (sql.includes("is_active")) emp.is_active = params[0];
          if (sql.includes("online_status")) emp.online_status = params[0];
          emp.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("INTO suppliers")) {
        const arr = memStore.get("suppliers") ?? [];
        const cols = (sql.match(/INTO suppliers\s*\((.*?)\)/i)?.[1] ?? "id,store_id,name,phone,address,payment_terms,bank_info,notes,created_at").split(",").map(c => c.trim());
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        if (!rec.id) { /* no-op without id */ } else {
          rec.created_at = rec.created_at ?? new Date().toISOString();
          rec.updated_at = rec.updated_at ?? rec.created_at;
          rec.is_deleted = rec.is_deleted ? 1 : 0;
          const idx = arr.findIndex((x: any) => x.id === rec.id);
          if (idx >= 0) arr[idx] = { ...arr[idx], ...rec };
          else arr.push(rec);
          memStore.set("suppliers", arr);
        }
      } else if (sql.includes("UPDATE suppliers SET")) {
        const arr = memStore.get("suppliers") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (rec as any)[col] = params[i]; });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("DELETE FROM suppliers")) {
        const arr = memStore.get("suppliers") ?? [];
        if (!sql.includes("WHERE")) memStore.set("suppliers", []);
        else memStore.set("suppliers", arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("INTO supplier_bank_accounts")) {
        const arr = memStore.get("supplier_bank_accounts") ?? [];
        const cols = (sql.match(/INTO supplier_bank_accounts\s*\((.*?)\)/i)?.[1] ?? "id,store_id,supplier_id,bank_name,currency,account_number,sort_order,created_at").split(",").map(c => c.trim());
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        if (!rec.id) { /* no-op without id */ } else {
          rec.created_at = rec.created_at ?? new Date().toISOString();
          rec.updated_at = rec.updated_at ?? rec.created_at;
          rec.is_deleted = rec.is_deleted ? 1 : 0;
          const idx = arr.findIndex((x: any) => x.id === rec.id);
          if (idx >= 0) arr[idx] = { ...arr[idx], ...rec };
          else arr.push(rec);
          memStore.set("supplier_bank_accounts", arr);
        }
      } else if (sql.includes("UPDATE supplier_bank_accounts SET")) {
        const arr = memStore.get("supplier_bank_accounts") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (rec as any)[col] = params[i]; });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("DELETE FROM supplier_bank_accounts")) {
        const arr = memStore.get("supplier_bank_accounts") ?? [];
        if (!sql.includes("WHERE")) memStore.set("supplier_bank_accounts", []);
        else memStore.set("supplier_bank_accounts", arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("INTO orders")) {
        const arr = memStore.get("orders") ?? [];
        const cols = (sql.match(/INTO orders\s*\((.*?)\)/i)?.[1] ?? "id,store_id,item_name,qty,unit,supplier_name,note,requested_by,requested_by_name,created_at").split(",").map(c => c.trim());
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        if (!rec.id) { /* no-op without id */ } else {
          if (rec.qty == null) rec.qty = 1;
          if (!rec.status) rec.status = "requested";
          rec.created_at = rec.created_at ?? new Date().toISOString();
          rec.updated_at = rec.updated_at ?? rec.created_at;
          rec.is_deleted = rec.is_deleted ? 1 : 0;
          const idx = arr.findIndex((x: any) => x.id === rec.id);
          if (idx >= 0) arr[idx] = { ...arr[idx], ...rec };
          else arr.push(rec);
          memStore.set("orders", arr);
        }
      } else if (sql.includes("UPDATE orders SET")) {
        const arr = memStore.get("orders") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (rec as any)[col] = params[i]; });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("DELETE FROM orders")) {
        const arr = memStore.get("orders") ?? [];
        memStore.set("orders", arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("INSERT INTO cash_discrepancies")) {
        const cds = memStore.get("cash_discrepancies") ?? [];
        cds.push({ id: params[0], shift_id: params[1], manager_amount: params[2], cashier_amount: params[3], difference: params[4], status: params[5], created_by: params[6], reassigned_amount: params[7] ?? null, created_at: params[8] ?? new Date().toISOString() });
        memStore.set("cash_discrepancies", cds);
        // Create notifications for all supervisors
        const notifs = memStore.get("notifications") ?? [];
        for (const sup of ["owner-1", "admin-1", "manager-1"]) {
          notifs.push({ id: `notif-${Date.now()}-${sup}-${Math.random().toString(36).slice(2,4)}`, user_id: sup, type: "cash_discrepancy", reference_id: params[0], message: `Kesye rapòte ${fmtG(params[3])} olye de ${fmtG(params[2])} — manke ${fmtG(params[4])}`, status: "pending", created_at: new Date().toISOString() });
        }
        memStore.set("notifications", notifs);
      } else if (sql.includes("UPDATE notifications SET")) {
        const notifs = memStore.get("notifications") ?? [];
        const id = params[params.length - 1];
        const notif = notifs.find((x: any) => x.id === id);
        if (notif) {
          if (sql.includes("status")) notif.status = params[0];
          if (sql.includes("message")) notif.message = params[0];
        }
      } else if (sql.includes("INSERT INTO customers")) {
        const customers = memStore.get("customers") ?? [];
        const newId = params[0];
        if (!customers.some((c: any) => c.id === newId)) {
          if (params.length === 11) {
            customers.push({ id: params[0], store_id: params[1], name: params[2], phone: params[3], address: params[4], id_card_number: params[5], total_debt: params[6], credit_limit: params[7], credit_limit_source: params[8], is_high_risk: params[9], open_debt_count: params[10], email: null, first_name: null, last_name: null, birth_day: null, birth_month: null, birth_year: null, country: null, department: null, commune: null, address_line1: null, address_line2: null, marketing_consent: 0 });
          } else {
            customers.push({ id: params[0], store_id: params[1], name: params[2], phone: params[3], id_card_number: params[4], total_debt: params[5], credit_limit: params[6], credit_limit_source: params[7], is_high_risk: params[8], open_debt_count: params[9], address: null, email: null, first_name: null, last_name: null, birth_day: null, birth_month: null, birth_year: null, country: null, department: null, commune: null, address_line1: null, address_line2: null, marketing_consent: 0 });
          }
          memStore.set("customers", customers);
        }
      } else if (sql.includes("UPDATE customers SET")) {
        const customers = memStore.get("customers") ?? [];
        const id = params[params.length - 1];
        const c = customers.find((x: any) => x.id === id);
        if (c) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (c as any)[col] = params[i]; });
        }
      } else if (sql.includes("UPDATE credits SET")) {
        const credits = memStore.get("credits") ?? [];
        const id = params[params.length - 1];
        const credit = credits.find((x: any) => x.id === id);
        if (credit) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (credit as any)[col] = params[i]; });
          credit.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE cash_requests SET")) {
        const crs = memStore.get("cash_requests") ?? [];
        const id = params[1];
        const cr = crs.find((x: any) => x.id === id);
        if (cr) cr.status = params[0];
      } else if (sql.includes("UPDATE cash_discrepancies SET")) {
        const cds = memStore.get("cash_discrepancies") ?? [];
        const id = params[params.length - 1];
        const cd = cds.find((x: any) => x.id === id);
        if (cd) {
          if (sql.includes("status")) cd.status = params[0];
          if (sql.includes("reassigned_amount")) cd.reassigned_amount = params[0];
          if (sql.includes("cashier_amount") && params.length > 2) cd.cashier_amount = params[0];
        }
      } else if (sql.includes("UPDATE daily_reports SET")) {
        const arr = memStore.get("daily_reports") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/=\s*\?\s*,?$/, "").replace(/=$/, "").trim()).filter(Boolean);
        const tail = params.slice(cols.length);
        const whereSql = (sql.match(/WHERE\s+(.*)$/i)?.[1] ?? "").toLowerCase();
        let r: any | undefined;
        if (whereSql.includes("user_id")) {
          const [uid, rdate, sid] = tail;
          r = arr.find((x: any) => x.user_id === uid && x.report_date === rdate && (x.store_id ?? sid) === sid);
        } else if (tail.length > 0) {
          r = arr.find((x: any) => x.id === tail[tail.length - 1]);
        }
        if (r) {
          cols.forEach((col, i) => { if (params[i] !== undefined) r[col] = params[i]; });
          r.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE cashier_deficits SET")) {
        const arr = memStore.get("cashier_deficits") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/=\s*\?\s*,?$/, "").replace(/=$/, "").trim()).filter(Boolean);
        const tail = params.slice(cols.length);
        const d = arr.find((x: any) => x.id === tail[tail.length - 1]);
        if (d) {
          cols.forEach((col, i) => { if (params[i] !== undefined) d[col] = params[i]; });
          d.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE standby_hands SET")) {
        const arr = memStore.get("standby_hands") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/=\s*\?\s*,?$/, "").replace(/=$/, "").trim()).filter(Boolean);
        const tail = params.slice(cols.length);
        const h = arr.find((x: any) => x.id === tail[tail.length - 1]);
        if (h) {
          cols.forEach((col, i) => { if (params[i] !== undefined) h[col] = params[i]; });
          h.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE cash_register_checks SET")) {
        const arr = memStore.get("cash_register_checks") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
        const whereSql = (sql.match(/WHERE\s+(.*)$/i)?.[1] ?? "").toLowerCase();
        const tail = params.slice(cols.length);
        // WHERE id = ? — or the opening-resolution form: cashier_id + check_date
        // + action + status (Shift screen confirms a pending opening).
        const c = /\bid\s*=\s*\??\s*$/.test(whereSql.trim())
          ? arr.find((x: any) => x.id === params[params.length - 1])
          : arr.find((x: any) => x.cashier_id === tail[0]
            && (tail[1] === undefined || String(x.check_date ?? "") === tail[1])
            && (tail[2] === undefined || String(x.action ?? "") === tail[2])
            && (tail[3] === undefined || String(x.status ?? "") === tail[3]));
        if (c) {
          const terminal = new Set(["approved","rejected","resolved"]);
          const newStatus = cols.includes("status") ? params[cols.indexOf("status")] : c.status;
          if (terminal.has(c.status) && newStatus !== c.status) { /* blocked */ }
          else {
            const allowed: Record<string,string[]> = { pending:["approved","contested","rejected"], contested:["approved","rejected","resolved"], approved:[], rejected:[], resolved:[] };
            if (newStatus !== c.status && !(allowed[c.status] ?? []).includes(newStatus)) { /* blocked */ }
            else cols.forEach((col,i)=>{ if(params[i]!==undefined) (c as any)[col]=params[i]; });
          }
          c.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE deficit_settlements SET")) {
        const arr = memStore.get("deficit_settlements") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
        const id = params[params.length - 1];
        const s = arr.find((x: any) => x.id === id);
        if (s) {
          const terminal = new Set(["paid","waived"]);
          if (terminal.has(s.status)) { /* no transitions */ }
          else {
            cols.forEach((col,i)=>{ if(params[i]!==undefined) (s as any)[col]=params[i]; });
            if (!cols.includes("status")) {
              if (s.status !== "waived") {
                if (s.paid >= s.total && s.total > 0) s.status = "paid";
                else if (s.paid > 0) s.status = "partial";
                else s.status = "open";
                if (s.status === "paid") s.paid_at = new Date().toISOString();
              }
            }
          }
          s.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE sales SET")) {
        const sales = memStore.get("sales") ?? [];
        const id = params[params.length - 1];
        const s = sales.find((x: any) => x.id === id);
        if (s) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => {
            if (params[i] !== undefined) (s as any)[col] = params[i];
          });
        }
      } else if (sql.includes("UPDATE shifts SET")) {
        const shifts = memStore.get("shifts") ?? [];
        // SET assignments pair with params IN ORDER, but only the `?`
        // placeholders consume a param — literal assignments (status = 'closed',
        // auto_closed = 1) are skipped. WHERE params are the trailing `?` count.
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        // Each assignment is either a `?` placeholder (consumes the next param)
        // or a literal (status = 'closed', auto_closed = 1) applied as-is.
        const assigns: { col: string; ph: boolean; literal?: string | number | null }[] = [];
        for (const part of setPart.split(",")) {
          const m = part.trim().match(/^(\w+)\s*=\s*(.*)$/);
          if (!m) continue;
          if (m[2] === "?") assigns.push({ col: m[1], ph: true });
          else if (m[2] === "null") assigns.push({ col: m[1], ph: false, literal: null as any });
          else if (/^-?\d+(\.\d+)?$/.test(m[2])) assigns.push({ col: m[1], ph: false, literal: Number(m[2]) });
          else assigns.push({ col: m[1], ph: false, literal: m[2].replace(/^'(.*)'$/, "$1") });
        }
        const ph = assigns.filter(a => a.ph).map(a => a.col);
        const where = sql.match(/WHERE\s+(.*)$/i)?.[1] ?? "";
        const whereQs = (where.match(/\?/g) ?? []).length;
        const setParams = params.slice(0, ph.length);
        const whereParams = whereQs > 0 ? params.slice(params.length - whereQs) : [];
        const apply = (s: any) => {
          let pi = 0;
          for (const a of assigns) {
            if (a.ph) { if (setParams[pi] !== undefined) s[a.col] = setParams[pi]; pi++; }
            else s[a.col] = a.literal;
          }
        };
        if (/^\s*id\s*=\s*\??\s*$/.test(where.trim())) {
          const s = shifts.find((x: any) => x.id === whereParams[0]);
          if (s) apply(s);
        } else if (where.includes("cashier_id")) {
          // Confirmed clock-out style: WHERE cashier_id = ? [AND day/range] AND status = 'open'.
          const cid = whereParams[0];
          if (where.includes("start_time >= ?")) {
            // Instant-range form (local business day — see localDayRange).
            const a = String(whereParams[1] ?? "");
            const b = String(whereParams[2] ?? "");
            shifts.filter((x: any) => x.cashier_id === cid && x.status === "open" && String(x.start_time ?? "") >= a && String(x.start_time ?? "") < b).forEach(apply);
          } else {
            const day = whereParams[1];
            shifts.filter((x: any) => x.cashier_id === cid && (day === undefined || String(x.start_time ?? "").slice(0, 10) === day) && x.status === "open").forEach(apply);
          }
        }
      } else if (sql.includes("INTO categories")) {
        const cats = memStore.get("categories") ?? [];
        // INSERT OR REPLACE or INSERT
        const id = params[0];
        const existingIdx = cats.findIndex((c: any) => c.id === id);
        const rec = { id: params[0], store_id: params[1], name: params[2], icon: params[3], color: params[4], sort_order: params[5] ?? cats.length + 1, created_at: params[6] ?? new Date().toISOString(), updated_at: params[7] ?? new Date().toISOString(), is_deleted: 0, dirty: 1 };
        if (sql.includes("OR REPLACE") && existingIdx >= 0) cats[existingIdx] = { ...cats[existingIdx], ...rec };
        else if (existingIdx >= 0) { /* ignore duplicate */ } else cats.push(rec);
        memStore.set("categories", cats);
      } else if (sql.includes("INTO stores")) {
        const stores = memStore.get("stores") ?? [];
        const id = params[0];
        const idx = stores.findIndex((s: any) => s.id === id);
        const rec: any = {};
        // Handle both full INSERT and OR REPLACE variants: map by position if 10+ params else try to infer
        if (params.length >= 7) {
          // Expected: id, name, location, code, currency, created_at, updated_at, disabled, breach_flagged, breached_at, revoked_by
          rec.id = params[0]; rec.name = params[1]; rec.location = params[2]; rec.code = params[3]; rec.currency = params[4] ?? "HTG"; rec.created_at = params[5]; rec.updated_at = params[6]; rec.disabled = params[7] ?? 0; rec.breach_flagged = params[8] ?? 0; rec.breached_at = params[9] ?? null; rec.revoked_by = params[10] ?? null;
        } else {
          rec.id = params[0]; rec.name = params[1] ?? rec.id; rec.location = params[2] ?? ""; rec.code = params[3] ?? "";
        }
        if (idx >= 0) stores[idx] = { ...stores[idx], ...rec, updated_at: new Date().toISOString() };
        else stores.push(rec);
        memStore.set("stores", stores);
      } else if (sql.includes("INTO _meta") || sql.includes("INSERT OR REPLACE INTO _meta")) {
        const meta = memStore.get("_meta") ?? [];
        const key = params[0]; const value = params[1];
        const idx = meta.findIndex((m: any) => m.key === key);
        if (idx >= 0) meta[idx].value = value;
        else meta.push({ key, value });
        memStore.set("_meta", meta);
      } else if (sql.includes("DELETE FROM _meta")) {
        // Real delete (not an empty write): draft cleanup must not leave
        // tombstone rows behind, and callers rely on the row actually going.
        const meta = memStore.get("_meta") ?? [];
        const key = params[0];
        const left = meta.filter((m: any) => m.key !== key);
        if (left.length !== meta.length) memStore.set("_meta", left);
      } else if (sql.includes("UPDATE categories SET")) {
        const cats = memStore.get("categories") ?? [];
        const id = params[params.length - 1];
        const c = cats.find((x: any) => x.id === id);
        if (c) {
          if (sql.includes("name")) c.name = params[0];
          if (sql.includes("icon")) c.icon = params[0];
          c.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stores SET")) {
        const stores = memStore.get("stores") ?? [];
        const id = params[params.length - 1];
        const s = stores.find((x: any) => x.id === id);
        if (s) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (s as any)[col] = params[i]; });
          s.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE _meta SET")) {
        const meta = memStore.get("_meta") ?? [];
        const key = params[params.length - 1];
        const m = meta.find((x: any) => x.key === key);
        if (m) m.value = params[0];
      } else if (sql.includes("INTO category_links")) {
        const arr = memStore.get("category_links") ?? [];
        const cols = (sql.match(/INTO category_links\s*\((.*?)\)/i)?.[1] ?? "id,child_id,parent_id").split(",").map(c => c.trim());
        const rec: any = {};
        cols.forEach((col, i) => { if (col) rec[col] = params[i] ?? null; });
        if (!rec.id) rec.id = `${rec.child_id}__${rec.parent_id}`;
        rec.updated_at = rec.updated_at ?? new Date().toISOString();
        rec.is_deleted = rec.is_deleted ? 1 : 0;
        const ui = arr.findIndex((x: any) => x.child_id === rec.child_id && x.parent_id === rec.parent_id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec };
        else arr.push(rec);
        memStore.set("category_links", arr);
      } else if (sql.includes("INTO product_categories")) {
        const pcs = memStore.get("product_categories") ?? [];
        if (!pcs.some((r: any) => r.product_id === params[0] && r.category_id === params[1])) {
          pcs.push({ product_id: params[0], category_id: params[1] });
          memStore.set("product_categories", pcs);
        }
      } else if (sql.includes("INTO employee_stores")) {
        const rows = memStore.get("employee_stores") ?? [];
        if (!rows.some((r: any) => r.employee_id === params[0] && r.store_id === params[1])) {
          rows.push({ employee_id: params[0], store_id: params[1] });
          memStore.set("employee_stores", rows);
        }
      } else if (sql.includes("DELETE FROM product_categories")) {
        const pcs = memStore.get("product_categories") ?? [];
        if (!sql.includes("WHERE")) memStore.set("product_categories", []);
        else if (sql.includes("category_id")) {
          memStore.set("product_categories", pcs.filter((r: any) => !(r.product_id === params[0] && r.category_id === params[1])));
        } else {
          memStore.set("product_categories", pcs.filter((r: any) => r.product_id !== params[0]));
        }
      } else if (sql.includes("DELETE FROM employee_stores")) {
        const rows = memStore.get("employee_stores") ?? [];
        if (sql.includes("store_id")) {
          memStore.set("employee_stores", rows.filter((r: any) => !(r.employee_id === params[0] && r.store_id === params[1])));
        } else {
          memStore.set("employee_stores", rows.filter((r: any) => r.employee_id !== params[0]));
        }
      } else if (sql.includes("INTO stock_batches")) {
        const batches = memStore.get("stock_batches") ?? [];
        const id = params[0];
        // Column-mapped (supports both legacy 14-col and new 15-col with supplier_id).
        const colPart = (sql.match(/\(\s*id\s*,(.*?)\)\s*VALUES/i)?.[1] ?? "").split(",").map(s => s.trim());
        const at = (name: string): any => {
          const i = colPart.indexOf(name);
          return i >= 0 ? params[i + 1] : undefined;
        };
        const rec = { id: params[0], store_id: params[1], reference: at("reference") ?? params[2], supplier: at("supplier") ?? params[3], supplier_id: at("supplier_id") ?? null, transport_cost: Number(at("transport_cost") ?? params[4] ?? 0), notes: at("notes") ?? params[5], total_items_cost: Number(at("total_items_cost") ?? params[6] ?? 0), total_cost: Number(at("total_cost") ?? params[7] ?? 0), received_at: at("received_at") ?? params[8] ?? null, created_by: at("created_by") ?? params[9], created_at: at("created_at") ?? params[10] ?? new Date().toISOString(), updated_at: at("updated_at") ?? params[11] ?? new Date().toISOString(), status: at("status") ?? params[12] ?? 'delivered', delivered_at: at("delivered_at") ?? params[13] ?? null };
        const idx = batches.findIndex((b: any) => b.id === id);
        if (idx >= 0) batches[idx] = { ...batches[idx], ...rec };
        else batches.push(rec);
        memStore.set("stock_batches", batches);
      } else if (sql.includes("INTO stock_movements")) {
        const movs = memStore.get("stock_movements") ?? [];
        const rec = { id: params[0], batch_id: params[1], store_id: params[2], product_id: params[3], type: params[4], quantity: Number(params[5] ?? 0), initial_qty: Number(params[6] ?? 0), remaining_qty: Number(params[7] ?? 0), unit_cost: Number(params[8] ?? 0), total_cost: Number(params[9] ?? 0), allocated_transport: Number(params[10] ?? 0), reason: params[11], status: params[14] ?? "delivered", delivered_at: params[15] ?? null, created_by: params[12], created_at: params[13] ?? new Date().toISOString() };
        movs.push(rec);
        memStore.set("stock_movements", movs);
      } else if (sql.includes("DELETE FROM categories")) {
        const cats = memStore.get("categories") ?? [];
        memStore.set("categories", cats.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM stores")) {
        const stores = memStore.get("stores") ?? [];
        memStore.set("stores", stores.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM credits")) {
        const credits = memStore.get("credits") ?? [];
        memStore.set("credits", credits.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM credit_payments")) {
        const payments = memStore.get("credit_payments") ?? [];
        memStore.set("credit_payments", payments.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM outbox")) {
        const outbox = memStore.get("outbox") ?? [];
        memStore.set("outbox", outbox.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM product_bundles")) {
        const arr = memStore.get("product_bundles") ?? [];
        if (!sql.includes("WHERE")) memStore.set("product_bundles", []);
        else memStore.set("product_bundles", sql.includes("unit_id") ? arr.filter((x: any) => x.unit_id !== params[0]) : arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM product_prices")) {
        const arr = memStore.get("product_prices") ?? [];
        if (!sql.includes("WHERE")) memStore.set("product_prices", []);
        else memStore.set("product_prices", sql.includes("unit_id") ? arr.filter((x: any) => x.unit_id !== params[0]) : arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("INTO suspended_sale_items")) {
        const arr = memStore.get("suspended_sale_items") ?? [];
        arr.push({ id: params[0], suspended_sale_id: params[1], store_id: params[2], product_id: params[3], product_name: params[4], unit_id: params[5] ?? null, unit_name: params[6] ?? null, factor: Number(params[7] ?? 1), variant: params[8] ?? null, quantity: Number(params[9] ?? 0), base_price: Number(params[10] ?? 0), unit_price: Number(params[11] ?? 0), line_total: Number(params[12] ?? 0), bundle_applied: params[13] ? 1 : 0, created_at: params[14] ?? new Date().toISOString() });
        memStore.set("suspended_sale_items", arr);
      } else if (sql.includes("INTO suspended_sale_events")) {
        const arr = memStore.get("suspended_sale_events") ?? [];
        arr.push({ id: params[0], suspended_sale_id: params[1], actor_id: params[2] ?? null, actor_name: params[3] ?? null, action: params[4], note: params[5] ?? null, created_at: params[6] ?? new Date().toISOString() });
        memStore.set("suspended_sale_events", arr);
      } else if (sql.includes("INTO suspended_sales")) {
        const arr = memStore.get("suspended_sales") ?? [];
        const rec = { id: params[0], store_id: params[1], label: params[2], customer_id: params[3] ?? null, cashier_id: params[4] ?? null, cashier_name: params[5] ?? null, seller_role: params[6] ?? null, status: params[7] ?? "open", total: Number(params[8] ?? 0), completed_sale_id: params[9] ?? null, device_id: params[10] ?? null, created_at: params[11] ?? new Date().toISOString(), updated_at: params[12] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("suspended_sales", arr);
      } else if (sql.includes("UPDATE suspended_sales SET")) {
        const arr = memStore.get("suspended_sales") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("DELETE FROM product_units")) {
        const arr = memStore.get("product_units") ?? [];
        if (!sql.includes("WHERE")) memStore.set("product_units", []);
        else memStore.set("product_units", arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM suspended_sale_items")) {
        const arr = memStore.get("suspended_sale_items") ?? [];
        memStore.set("suspended_sale_items", arr.filter((x: any) => x.suspended_sale_id !== params[0]));
      } else if (sql.includes("UPDATE receipts SET")) {
        // Post-sale customer attach: patch stored receipt JSON content.
        const arr = memStore.get("receipts") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (rec as any)[col] = params[i]; });
        }
      } else if (sql.includes("DELETE FROM receipts")) {
        // "No receipt" choice: remove stored copies so no receipt exists at all.
        const arr = memStore.get("receipts") ?? [];
        if (sql.includes("WHERE sale_id")) {
          memStore.set("receipts", arr.filter((x: any) => x.sale_id !== params[0]));
        } else {
          memStore.set("receipts", arr.filter((x: any) => x.id !== params[0]));
        }
      } else if (/DELETE FROM (\w+)\s*$/.test(sql.trim())) {
        // Bare full-table wipe (catalog reset, seed upgrades).
        const table = sql.trim().match(/DELETE FROM (\w+)\s*$/)?.[1] ?? "";
        if (table && memStore.has(table)) memStore.set(table, []);
      }
      return { lastInsertRowId: 0, changes: 1 };
    },
    getAllAsync: async (sql: string, params?: any[]) => {
      const oTable = orderMemTable(sql);
      if (oTable) return orderMemSelect(oTable, sql, params ?? []);
      if (sql.includes("FROM outbox")) return memStore.get("outbox") ?? [];
      if (sql.includes("FROM products")) {
        const all = (memStore.get("products") ?? []).map((p: any) => ({
          ...p,
          item_type: p.item_type ?? "goods",
          is_available: p.is_available ?? 1,
          status: p.status ?? "active",
        }));
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM sales")) {
        const all = memStore.get("sales") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return all.filter((x: any) => x.customer_id === cid);
        }
        if (sql.includes("WHERE seller_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.seller_id === sid);
        }
        // Standby sales (post-report lock): `WHERE standby = 1 [AND seller_id = ?]`
        if (sql.includes("standby")) {
          const want = sql.includes("standby = 1") ? 1 : 0;
          let out = all.filter((x: any) => Number(x.standby ?? 0) === want);
          if (sql.includes("seller_id = ?")) { const sid = params?.[0]; out = out.filter((x: any) => x.seller_id === sid); }
          return out;
        }
        return all;
      }
      if (sql.includes("FROM sale_items")) {
        const all = memStore.get("sale_items") ?? [];
        if (sql.includes("WHERE sale_id")) {
          const saleId = params?.[0] ?? sql.match(/sale_id = '([^']+)'/)?.[1];
          return all.filter((x: any) => x.sale_id === saleId);
        }
        return all;
      }
      if (sql.includes("FROM employee_stores")) {
        const all = memStore.get("employee_stores") ?? [];
        if (sql.includes("WHERE employee_id")) {
          const eid = params?.[0];
          return all.filter((x: any) => x.employee_id === eid);
        }
        return all;
      }
      if (sql.includes("FROM sale_pickups")) {
        const all = memStore.get("sale_pickups") ?? [];
        if (sql.includes("WHERE sale_id")) {
          const saleId = params?.[0];
          return all.filter((x: any) => x.sale_id === saleId);
        }
        if (sql.includes("WHERE sale_item_id")) {
          const iid = params?.[0];
          return all.filter((x: any) => x.sale_item_id === iid);
        }
        return all;
      }
      if (sql.includes("FROM receipts")) {
        const all = memStore.get("receipts") ?? [];
        if (sql.includes("WHERE sale_id")) {
          const saleId = params?.[0] ?? sql.match(/sale_id = '([^']+)'/)?.[1];
          return all.filter((x: any) => x.sale_id === saleId);
        }
        return all;
      }
      if (sql.includes("FROM customers")) {
        const all = memStore.get("customers") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM employees")) return memStore.get("employees") ?? [];
      if (sql.includes("FROM suppliers")) {
        const all = (memStore.get("suppliers") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM supplier_bank_accounts")) {
        const all = (memStore.get("supplier_bank_accounts") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE supplier_id")) { const v = params?.[0]; return all.filter((x: any) => x.supplier_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM orders")) {
        const all = (memStore.get("orders") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM customer_history")) {
        const history = memStore.get("customer_history") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return history.filter((x: any) => x.customer_id === cid);
        }
        return history;
      }
      if (sql.includes("FROM customer_notes")) {
        const arr = memStore.get("customer_notes") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return arr.filter((x: any) => x.customer_id === cid);
        }
        return arr;
      }
      if (sql.includes("FROM credits")) {
        const all = memStore.get("credits") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return all.filter((x: any) => x.customer_id === cid);
        }
        if (sql.includes("WHERE sale_id")) {
          const v = params?.[0];
          return all.filter((x: any) => x.sale_id === v);
        }
        if (sql.includes("WHERE id")) {
          const v = params?.[0];
          return all.filter((x: any) => x.id === v);
        }
        return all;
      }
      if (sql.includes("FROM credit_payments")) {
        const all = memStore.get("credit_payments") ?? [];
        if (sql.includes("credit_id") || sql.includes("debt_id")) {
          const v = params?.[0];
          return all.filter((x: any) => x.credit_id === v || x.debt_id === v);
        }
        if (sql.includes("receipt_number")) {
          const v = params?.[0];
          return all.filter((x: any) => x.receipt_number === v);
        }
        return all;
      }
      if (sql.includes("FROM shifts")) return memStore.get("shifts") ?? [];
      if (sql.includes("FROM cash_movements")) {
        const all = memStore.get("cash_movements") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM debt_collections")) {
        const all = memStore.get("debt_collections") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM cash_requests")) {
        const all = memStore.get("cash_requests") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM cash_discrepancies")) {
        const all = memStore.get("cash_discrepancies") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM notifications")) {
        const all = memStore.get("notifications") ?? [];
        if (sql.includes("WHERE user_id")) {
          const uid = params?.[0];
          return all.filter((x: any) => x.user_id === uid);
        }
        if (sql.includes("WHERE status")) {
          return all.filter((x: any) => x.status === "pending");
        }
        return all;
      }
      if (sql.includes("FROM daily_reports")) {
        const all = memStore.get("daily_reports") ?? [];
        if (sql.includes("WHERE user_id")) { const v = params?.[0]; return all.filter((x: any) => x.user_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE report_date")) { const v = params?.[0]; return all.filter((x: any) => x.report_date === v); }
        return all;
      }
      if (sql.includes("FROM standby_hands")) {
        const all = memStore.get("standby_hands") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM cashier_deficits")) {
        const all = memStore.get("cashier_deficits") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM report_reviews")) {
        const all = memStore.get("report_reviews") ?? [];
        if (sql.includes("WHERE report_id")) { const v = params?.[0]; return all.filter((x: any) => x.report_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM monthly_losses")) {
        const all = memStore.get("monthly_losses") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE month")) { const v = params?.[0]; return all.filter((x: any) => x.month === v); }
        return all;
      }
      if (sql.includes("FROM deficit_settlements")) {
        const all = memStore.get("deficit_settlements") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM cash_register_checks")) {
        const all = memStore.get("cash_register_checks") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE report_id")) { const v = params?.[0]; return all.filter((x: any) => x.report_id === v); }
        return all;
      }
      if (sql.includes("FROM salary_deductions")) {
        const all = memStore.get("salary_deductions") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        return all;
      }
      if (sql.includes("FROM categories")) {
        const all = memStore.get("categories") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM category_links")) {
        const all = (memStore.get("category_links") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE child_id")) { const v = params?.[0]; return all.filter((x: any) => x.child_id === v); }
        if (sql.includes("WHERE parent_id")) { const v = params?.[0]; return all.filter((x: any) => x.parent_id === v); }
        return all;
      }
      if (sql.includes("FROM product_categories")) {
        const all = memStore.get("product_categories") ?? [];
        if (sql.includes("WHERE product_id") && sql.includes("category_id")) { const pid = params?.[0]; const cid = params?.[1]; return all.filter((x: any) => x.product_id === pid && x.category_id === cid); }
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE category_id")) { const v = params?.[0]; return all.filter((x: any) => x.category_id === v); }
        return all;
      }
      if (sql.includes("FROM stock_batches")) {
        const all = memStore.get("stock_batches") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM stock_movements")) {
        const all = memStore.get("stock_movements") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE batch_id")) { const v = params?.[0]; return all.filter((x: any) => x.batch_id === v); }
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM product_units")) {
        const all = memStore.get("product_units") ?? [];
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_prices")) {
        const all = memStore.get("product_prices") ?? [];
        if (sql.includes("WHERE unit_id")) { const v = params?.[0]; return all.filter((x: any) => x.unit_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM bundles")) {
        const all = (memStore.get("bundles") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE variant_id")) { const v = params?.[0]; return all.filter((x: any) => x.variant_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM bundle_prices")) {
        const all = (memStore.get("bundle_prices") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE bundle_id")) { const v = params?.[0]; return all.filter((x: any) => x.bundle_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_bundles")) {
        const all = memStore.get("product_bundles") ?? [];
        if (sql.includes("WHERE unit_id")) { const v = params?.[0]; return all.filter((x: any) => x.unit_id === v); }
        return all;
      }
      if (sql.includes("FROM product_supplier_costs")) {
        const all = (memStore.get("product_supplier_costs") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE product_id") && sql.includes("supplier_id")) {
          return all.filter((x: any) => x.product_id === params?.[0] && x.supplier_id === params?.[1]);
        }
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE supplier_id")) { const v = params?.[0]; return all.filter((x: any) => x.supplier_id === v); }
        if (sql.includes("WHERE unit_id")) { const v = params?.[0]; return all.filter((x: any) => x.unit_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM items")) {
        const all = (memStore.get("items") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_suppliers")) {
        const all = (memStore.get("product_suppliers") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE supplier_id")) { const v = params?.[0]; return all.filter((x: any) => x.supplier_id === v); }
        return all;
      }
      if (sql.includes("FROM batches")) {
        const all = (memStore.get("batches") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE item_id")) { const v = params?.[0]; return all.filter((x: any) => x.item_id === v); }
        if (sql.includes("WHERE supplier_id")) { const v = params?.[0]; return all.filter((x: any) => x.supplier_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM variant_prices")) {
        const all = (memStore.get("variant_prices") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE variant_id")) { const v = params?.[0]; return all.filter((x: any) => x.variant_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM variants")) {
        const all = (memStore.get("variants") ?? []).filter((x: any) => !x.is_deleted);
        if (sql.includes("WHERE item_id")) { const v = params?.[0]; return all.filter((x: any) => x.item_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sale_items")) {
        const all = memStore.get("suspended_sale_items") ?? [];
        if (sql.includes("WHERE suspended_sale_id")) { const v = params?.[0] ?? sql.match(/suspended_sale_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.suspended_sale_id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sale_events")) {
        const all = memStore.get("suspended_sale_events") ?? [];
        if (sql.includes("WHERE suspended_sale_id")) { const v = params?.[0] ?? sql.match(/suspended_sale_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.suspended_sale_id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sales")) {
        const all = memStore.get("suspended_sales") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0] ?? sql.match(/WHERE id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0] ?? sql.match(/cashier_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0] ?? sql.match(/status\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM stores")) {
        const all = memStore.get("stores") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM _meta")) {
        const all = memStore.get("_meta") ?? [];
        if (sql.includes("WHERE key")) { const v = params?.[0]; return all.filter((x: any) => x.key === v); }
        return all;
      }
      return [];
    },
  };
  // Write-through durability: every mutation on the RAM backend schedules a
  // debounced snapshot, so shift creation (and sales) are persisted, not just
  // cached in memory until the next rebundle.
  const memRunAsync = db?.runAsync?.bind(db);
  if (typeof memRunAsync === "function") {
    db.runAsync = async (sql: string, params: any[]) => {
      const r = await memRunAsync(sql, params);
      scheduleMemPersist();
      return r;
    };
  }
  // Memory backend gets the same catalog v2 cutover so web shows migrated data.
  try { await runCatalogCutover(db); } catch (e) { console.log("[cutover] memory skipped:", String(e)); }
  try { await migrateInventoryBatches(db); } catch (e) { console.log("[migrate] memory inventory skipped:", String(e)); }
  try { await backfillSkus(db); } catch (e) { console.log("[backfill] memory skus skipped:", String(e)); }
  try { await cleanupAutoBaseJunk(db); } catch (e) { console.log("[cutover] memory auto-base cleanup skipped:", String(e)); }
  try { await backfillSupplierCostItems(db); } catch (e) { console.log("[backfill] memory supplier cost items skipped:", String(e)); }
  try { await migrateBundlesToV3(db); } catch (e) { console.log("[migrate] memory bundles v3 skipped:", String(e)); }
  try { await recomputeItemCosts(db); } catch (e) { console.log("[backfill] memory item costs skipped:", String(e)); }
  return db;
}

/**
 * Persist each item's unit cost (items.cost) and queue it for upload.
 *
 * The price comes from itemCostsFor: the item's own received batches first,
 * else its supplier quote, else a cost already stored for it — then the ratio
 * chain prices the rest of the product (smaller divides, bigger multiplies).
 * When nothing can be derived the stored cost is left untouched (that is the
 * owner's own figure, typed in by hand).
 *
 * Idempotent and cheap, so it runs on every launch, after every batch is
 * received/saved, and after every item edit. Returns how many rows changed.
 * `productId` scopes it to one product (post-batch / post-edit refresh).
 */
export async function recomputeItemCosts(db: any, productId?: string): Promise<number> {
  const load = async (sql: string, args: any[] = []): Promise<any[]> => {
    try { return ((await db.getAllAsync(sql, args)) ?? []) as any[]; } catch { return []; }
  };
  const items = (await load(
    productId ? "SELECT * FROM items WHERE product_id = ?" : "SELECT * FROM items",
    productId ? [productId] : []
  )).filter((i: any) => i && !i.is_deleted);
  if (!items.length) return 0;
  const batches = (await load("SELECT * FROM batches")).filter((b: any) => b && !b.is_deleted);
  const costRows = (await load("SELECT * FROM product_supplier_costs")).filter((r: any) => r && !r.is_deleted);
  const costs = itemCostsFor(items, batches, costRows);
  const now = new Date().toISOString();
  let changed = 0;
  for (const it of items) {
    const next = Number(costs.get(String(it.id)) ?? 0) || 0;
    const prev = Number(it.cost ?? 0) || 0;
    if (Math.abs(next - prev) < 1e-9) continue;
    try {
      await db.runAsync("UPDATE items SET cost = ?, updated_at = ?, dirty = 1 WHERE id = ?", [next, now, String(it.id)]);
    } catch { continue; } // column not migrated yet — never abort init for it
    changed++;
    // Full row: the sync appliers REPLACE from the payload, so a partial one
    // would blank the name/product on the other device (and the cloud push
    // needs the NOT NULL columns anyway).
    // `now + 1ms`: the caller may have just published this same row (name edit),
    // and equal updated_at loses the LWW tie — this row must win outright.
    try {
      await insertOutbox("items", "update", {
        id: String(it.id), product_id: String(it.product_id), name: String(it.name ?? ""),
        ref_item_id: it.ref_item_id ?? null, ratio: it.ratio ?? null,
        sort_order: Number(it.sort_order ?? 0), cost: next,
        created_at: it.created_at ?? now, updated_at: new Date(Date.now() + 1).toISOString(), is_deleted: false,
      }, db);
    } catch {}
  }
  return changed;
}

// Generic helpers
// `dbOverride` keeps a caller-provided handle (used by recomputeItemCosts so the
// row and its outbox entry are written through the same connection).
export async function insertOutbox(table: string, operation: "create"|"update"|"delete", payload: any, dbOverride?: any) {
  const d = dbOverride ?? await getDb();
  const { v4 } = await import("uuid");
  // use uuid v4 for JS env
  const id = payload.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await d.runAsync(
    "INSERT INTO outbox (id, table_name, operation, payload, created_at) VALUES (?,?,?,?,?)",
    [id + ":" + Date.now(), table, operation, JSON.stringify(payload), new Date().toISOString()]
  );
}

export async function getDirtyChanges(): Promise<{ table: string; operation: string; payload: any; outboxId: string }[]> {
  const d = await getDb();
  const rows = await d.getAllAsync("SELECT * FROM outbox ORDER BY created_at ASC LIMIT 100");
  return (rows as any[]).map(r => ({
    table: r.table_name,
    operation: r.operation,
    payload: JSON.parse(r.payload),
    outboxId: String(r.id),
  }));
}

export async function clearOutbox(ids: string[]) {
  const d = await getDb();
  for (const id of ids) await d.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
}
