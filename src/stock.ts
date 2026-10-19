/**
 * Per-store stock (product_stock, migration 023).
 *
 * products.stock_quantity is a deprecated single scalar — it works only while
 * every store keeps its own product rows and nobody needs cross-store truth.
 * product_stock is the authoritative (store, product) quantity: baselined from
 * products.stock_quantity on first touch, then adjusted by every sale/receive
 * and synced (absolute value, LWW — same conflict semantics the products
 * scalar always had).
 */
import { mintId } from "./db/ids";
import { insertOutbox } from "./db";
import { assertWritable } from "./subscription/subscription";

/** Effective stock for (store, product): product_stock first, cache fallback. */
export async function getEffectiveStock(db: any, storeId: string, productId: string): Promise<number> {
  try {
    const rows = (await db.getAllAsync(
      "SELECT quantity FROM product_stock WHERE store_id = ? AND product_id = ? AND is_deleted = 0",
      [storeId, productId]
    )) as any[];
    if (rows?.length) return Number(rows[0].quantity ?? 0);
  } catch {}
  const p = (await db.getAllAsync(
    "SELECT stock_quantity FROM products WHERE id = ?", [productId]
  ).catch(() => [])) as any[];
  return Number(p?.[0]?.stock_quantity ?? 0);
}

/**
 * Apply a stock delta for (store, product): baseline from the products cache
 * on first touch, then adjust. Marks the row dirty and queues the WHOLE row
 * for sync (absolute value — the server LWW-arbitrates like products always
 * have). Returns the new quantity.
 */
export async function applyStockDelta(
  db: any, storeId: string, productId: string, delta: number, nowIso?: string
): Promise<number> {
  if (!storeId || !productId || !delta) return 0;
  assertWritable();
  const now = nowIso ?? new Date().toISOString();
  const rows = (await db.getAllAsync(
    "SELECT * FROM product_stock WHERE store_id = ? AND product_id = ?", [storeId, productId]
  ).catch(() => [])) as any[];
  if (!rows?.length) {
    const p = (await db.getAllAsync(
      "SELECT stock_quantity, current_amount_available FROM products WHERE id = ?", [productId]
    ).catch(() => [])) as any[];
    const qty = Number(p?.[0]?.stock_quantity ?? 0) + delta;
    const avail = Math.max(0, Number(p?.[0]?.current_amount_available ?? p?.[0]?.stock_quantity ?? 0) + delta);
    const id = mintId();
    await db.runAsync(
      "INSERT INTO product_stock (id, store_id, product_id, quantity, available, lamport_clock, is_deleted, dirty, created_at, updated_at) VALUES (?,?,?,?,?,0,0,1,?,?)",
      [id, storeId, productId, qty, avail, now, now]
    );
    try {
      await insertOutbox("product_stock", "create", {
        id, store_id: storeId, product_id: productId, quantity: qty, available: avail,
        lamport_clock: 0, is_deleted: 0, dirty: 1, created_at: now, updated_at: now,
      }, db);
    } catch {}
    return qty;
  }
  const r = rows[0];
  const qty = Number(r.quantity ?? 0) + delta;
  const avail = Math.max(0, Number(r.available ?? 0) + delta);
  const lamport = Number(r.lamport_clock ?? 0) + 1;
  await db.runAsync(
    "UPDATE product_stock SET quantity = ?, available = ?, lamport_clock = ?, dirty = 1, updated_at = ? WHERE id = ?",
    [qty, avail, lamport, now, r.id]
  );
  try {
    await insertOutbox("product_stock", "update", {
      ...r, quantity: qty, available: avail, lamport_clock: lamport,
      dirty: 0, updated_at: now,
    }, db);
  } catch {}
  return qty;
}
