/**
 * Dev mock catalog seed — single source: packages/mock-catalog
 * (mirrored at ../data/catalog.*.json by `npm run generate` — never hand-edit).
 *
 * Gate (best-dev-gate): fires ONLY when
 *   1. dev mode is on: EXPO_PUBLIC_SEED_DEMO_CATALOG=1 OR __DEV__, AND
 *   2. `products` + `categories` are both empty, AND
 *   3. _meta.seed_catalog_v1 is unset.
 * Strictly once-ever: the marker is adopted when tables are non-empty, and
 * legacy seed_v1 demo rows (18 products) are wiped first on dev upgrades.
 * Seeded rows write dirty=0 with NO outbox entries — dev data never syncs.
 */
import CATS from "../data/catalog.categories.json";
import SUPS from "../data/catalog.suppliers.json";
import PRODS from "../data/catalog.products.json";
import COSTS from "../data/catalog.costs.json";

export const DEV_SEED_KEY = "seed_catalog_v1";
const LEGACY_SEED_KEY = "seed_v1";
const DEV_STORE = "demo-store-id";

type Cat = { id: string; name: string; icon: string; color: string; sort_order: number; parents: string[] };
type Sup = { id: string; name: string; phone: string | null; address: string | null; payment_terms: string | null; bank_info: string | null; notes: string | null };
type Unit = { id: string; label: string; factor: number; condition: string | null; sell: number };
type Prod = {
  id: string; sku: string; barcode: string; name: string; name_ht: string;
  categories: string[]; item_type: string; stock: number; low: number;
  units: Unit[]; bundles: { unit_id: string; variant: string; minQty: number; price: number }[];
};
type Cost = { product_id: string; supplier_id: string; unit_id: string; cost: number };

const cats = CATS as unknown as Cat[];
const sups = SUPS as unknown as Sup[];
const prods = PRODS as unknown as Prod[];
const costs = COSTS as unknown as Cost[];

export function devSeedEnabled(): boolean {
  try {
    if (typeof process !== "undefined" && (process as any).env?.EXPO_PUBLIC_SEED_DEMO_CATALOG === "1") return true;
  } catch {}
  try {
    if ((globalThis as any).__DEV__ === true) return true;
  } catch {}
  return false;
}

const variantFor = (condition: string | null) =>
  condition ? condition.charAt(0).toUpperCase() + condition.slice(1) : "Regular";

function avgCost(pid: string): number {
  const rows = costs.filter((c) => c.product_id === pid);
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, c) => s + c.cost, 0) / rows.length);
}

async function mark(db: any) {
  await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [DEV_SEED_KEY, "1"]);
}

async function wipeLegacyCatalog(db: any) {
  for (const t of ["product_supplier_costs", "product_categories", "category_links", "product_bundles", "product_prices", "product_units", "products", "categories"]) {
    try { await db.runAsync(`DELETE FROM ${t}`); } catch {}
  }
}

/** Insert the full mock catalog. Assumes tables exist and are empty. */
export async function insertDevCatalog(db: any): Promise<void> {
  const now = new Date().toISOString();
  for (const c of cats) {
    await db.runAsync(
      "INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [c.id, DEV_STORE, c.name, c.icon, c.color, c.sort_order, now, now]
    );
    for (const parent of c.parents) {
      await db.runAsync(
        "INSERT OR REPLACE INTO category_links (id, child_id, parent_id, device_id, lamport_clock, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
        [`${c.id}__${parent}`, c.id, parent, null, 0, now, 0, 0]
      );
    }
  }
  for (const p of prods) {
      await db.runAsync(
        "INSERT OR REPLACE INTO products (id, store_id, sku, barcode, name, name_ht, category_id, item_type, is_available, stock_quantity, current_amount_available, low_stock_threshold, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [p.id, DEV_STORE, p.sku, p.barcode, p.name, p.name_ht, null, "goods", 1, p.stock, p.stock, p.low, now]
      );
    for (const u of p.units) {
      await db.runAsync(
        "INSERT OR REPLACE INTO product_units (id, product_id, unit_name, condition, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        [u.id, p.id, u.label, u.condition, u.factor, now, now]
      );
      await db.runAsync(
        "INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
        [`price-${u.id}`, u.id, variantFor(u.condition), u.sell, now]
      );
    }
    p.bundles.forEach((b, i) => {
      db.runAsync(
        "INSERT OR REPLACE INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
        [`bundle-${p.id}-${i}`, b.unit_id, b.variant, b.minQty, b.price, now]
      ).catch(() => {});
    });
    for (const cid of p.categories) {
      await db.runAsync("INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)", [p.id, cid]);
    }
  }
  for (const s of sups) {
    await db.runAsync(
      "INSERT OR REPLACE INTO suppliers (id, store_id, name, phone, address, payment_terms, bank_info, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [s.id, DEV_STORE, s.name, s.phone, s.address, s.payment_terms, s.bank_info, s.notes, now]
    );
  }
  for (const c of costs) {
    await db.runAsync(
      "INSERT OR REPLACE INTO product_supplier_costs (id, product_id, supplier_id, unit_id, cost, last_updated, device_id, lamport_clock, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [`psc-${c.product_id}-${c.supplier_id}-${c.unit_id}`.slice(0, 120), c.product_id, c.supplier_id, c.unit_id, c.cost, now, null, 0, now, 0, 0]
    );
  }
  await mark(db);
}

export async function seedDevCatalogIfNeeded(db: any): Promise<boolean> {
  if (!devSeedEnabled()) return false;
  let marked: any[] = [];
  try { marked = await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [DEV_SEED_KEY]); } catch {}
  if (marked.length) return false;
  let nProd = 0, nCat = 0;
  try { nProd = (await db.getAllAsync("SELECT id FROM products").catch(() => []))?.length ?? 0; } catch {}
  try { nCat = (await db.getAllAsync("SELECT id FROM categories").catch(() => []))?.length ?? 0; } catch {}
  if (nProd > 0 || nCat > 0) {
    // Non-empty without the marker: legacy demo (seed_v1) gets wiped + reseeded
    // on dev so testers always land on the real mock; real catalogs are adopted.
    let legacy = false;
    try { legacy = (await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [LEGACY_SEED_KEY]).catch(() => []))?.length > 0; } catch {}
    if (!legacy) { await mark(db); return false; }
    await wipeLegacyCatalog(db);
  }
  await insertDevCatalog(db);
  return true;
}

/** Memory-mock (Expo web) rows built from the same JSON. */
export function buildDevCatalogMemory(now: string) {
  return {
    categories: cats.map((c) => ({ id: c.id, store_id: DEV_STORE, name: c.name, icon: c.icon, color: c.color, sort_order: c.sort_order, created_at: now, updated_at: now })),
    category_links: cats.flatMap((c) => c.parents.map((p) => ({ id: `${c.id}__${p}`, child_id: c.id, parent_id: p, device_id: null, lamport_clock: 0, updated_at: now, is_deleted: 0 }))),
    products: prods.map((p) => {
      const avg = avgCost(p.id);
      return {
        id: p.id, store_id: DEV_STORE, sku: p.sku, barcode: p.barcode, name: p.name, name_ht: p.name_ht,
        unit: p.units[0]?.label ?? "Unit", cost_price: avg, selling_price: p.units[0]?.sell ?? 0,
        stock_quantity: p.stock, current_amount_available: p.stock, low_stock_threshold: p.low,
        item_type: "goods", is_available: 1, updated_at: now, is_deleted: 0, dirty: 0,
      };
    }),
    product_categories: prods.flatMap((p) => p.categories.map((cid) => ({ product_id: p.id, category_id: cid }))),
    product_units: prods.flatMap((p) => p.units.map((u) => ({ id: u.id, product_id: p.id, unit_name: u.label, condition: u.condition, conversion_factor: u.factor, created_at: now, updated_at: now }))),
    product_prices: prods.flatMap((p) => p.units.map((u) => ({ id: `price-${u.id}`, unit_id: u.id, variant: variantFor(u.condition), price: u.sell, updated_at: now }))),
    product_bundles: prods.flatMap((p) => p.bundles.map((b, i) => ({ id: `bundle-${p.id}-${i}`, unit_id: b.unit_id, variant: b.variant, min_quantity: b.minQty, bundle_price: b.price, created_at: now }))),
    suppliers: sups.map((s) => ({ ...s, store_id: DEV_STORE, created_at: now, updated_at: now, is_deleted: 0 })),
    product_supplier_costs: costs.map((c) => ({ id: `psc-${c.product_id}-${c.supplier_id}-${c.unit_id}`.slice(0, 120), ...c, last_updated: now, device_id: null, lamport_clock: 0, updated_at: now, is_deleted: 0 })),
  };
}
