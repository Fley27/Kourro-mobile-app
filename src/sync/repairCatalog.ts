// One-time republish of stranded catalog rows.
//
// Background: device-local catalog writes always queue an outbox entry, but
// an entry the server keeps rejecting is dropped after MAX_PUSH_ATTEMPTS —
// and anything created while sync itself was broken (e.g. the pull-503 era)
// may never have been queued at all. Those rows live only on their home
// register: products/variants/prices show there, new devices never see them.
//
// This routine runs ONCE per device (guarded by a _meta flag): it re-queues
// local catalog rows that look unsynced (dirty=1) into the normal outbox, and
// the regular push loop carries them up with its usual retry semantics. LWW
// on the server makes re-sending an already-synced row a harmless no-op, and
// rows already sitting in the outbox are skipped by id.
//
// Deliberately catalog-only: transactional tables are covered by the cursor,
// and legacy cut-over tables (product_units, stock_batches) are unread.
import { getDb, insertOutbox } from "../db";

const FLAG = "catalog_republish_v1";

// Local tables with a dirty column in the catalog/cost chain.
const DIRTY_TABLES = [
  "items",
  "variants",
  "variant_prices",
  "batches",
  "bundles",
  "bundle_prices",
  "product_suppliers",
  "category_links",
  "products",
  "suppliers",
  "customers",
  "product_supplier_costs",
] as const;

/** Queue one payload per row id, skipping ids already waiting in the outbox. */
async function queueMissing(db: any, table: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  let queued = 0;
  try {
    const pending = ((await db.getAllAsync("SELECT payload FROM outbox WHERE table_name = ?", [table]).catch(() => [])) ?? []) as any[];
    const pendingIds = new Set<string>();
    for (const p of pending) {
      try {
        const id = String(JSON.parse(String(p?.payload ?? "{}"))?.id ?? "");
        if (id) pendingIds.add(id);
      } catch {}
    }
    for (const r of rows) {
      // product_categories is pair-keyed with no id column — synthesize the
      // same `${a}__${b}` id the write paths and the server both use.
      const id = String(r?.id ?? (r?.product_id != null && r?.category_id != null
        ? `${r.product_id}__${r.category_id}`
        : ""));
      if (!id || pendingIds.has(id)) continue;
      const deleted = r.is_deleted === 1 || r.is_deleted === true;
      try {
        await insertOutbox(table, deleted ? "delete" : "create", { ...r, id, is_deleted: deleted }, db);
        queued += 1;
      } catch {}
    }
  } catch {}
  return queued;
}

export async function republishStrandedCatalog(): Promise<number> {
  const db = await getDb();
  try {
    const flagged = ((await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [FLAG]).catch(() => [])) ?? []) as any[];
    if (flagged.length > 0) return 0;
  } catch {
    return 0;
  }
  let total = 0;
  for (const table of DIRTY_TABLES) {
    try {
      const rows = ((await db.getAllAsync(`SELECT * FROM ${table} WHERE dirty = 1`).catch(() => [])) ?? []) as any[];
      total += await queueMissing(db, table, rows);
    } catch {}
  }
  // product_categories has no dirty column and hard-deletes locally: republish
  // every live link once (small table; server upserts by pair id, idempotent).
  try {
    const links = ((await db.getAllAsync("SELECT * FROM product_categories").catch(() => [])) ?? []) as any[];
    total += await queueMissing(db, "product_categories", links);
  } catch {}
  try {
    await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", [FLAG, new Date().toISOString()]);
  } catch {}
  if (total > 0) console.log(`[sync] republished ${total} stranded catalog rows`);
  return total;
}
