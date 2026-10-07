// Catalog v2 model — Product (abstract) → Item (container chain) → Variant
// (presentation) → VariantPrice (effective-dated). Cost enters only via
// batches; stock_quantity on products is system-maintained (receive path).
//
// Chain-only rule (one base item per product) is what keeps per-product
// stock and cost unambiguous — see schema.ts note.
import { getDb, insertOutbox, recomputeItemCosts } from "./db";
import { mintId } from "./db/ids";

export type Item = {
  id: string; product_id: string; name: string;
  ref_item_id: string | null; ratio: number | null;
  /** Persisted unit purchase cost (see recomputeItemCosts). 0 = not priced. */
  cost?: number;
  sort_order?: number; created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type ProductSupplier = { product_id: string; supplier_id: string };

export type BatchStatus = "pending" | "received" | "denied";

export type Batch = {
  id: string; item_id: string; supplier_id: string;
  date: string; quantity: number; total_paid: number;
  delivery_ref?: string | null; transport_share?: number;
  status: BatchStatus;
  received_by?: string | null; received_at?: string | null;
  denied_by?: string | null; denied_at?: string | null;
  reason?: string | null; source?: string;
  created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type Variant = {
  id: string; item_id: string; name: string;
  sort_order?: number; created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type VariantPrice = {
  id: string; variant_id: string; price: number;
  date: string; created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

// Display labels live in ./labels (dependency-free) — re-exported here so
// existing catalog imports keep working.
export { GENERIC_VARIANT_NAMES, isStandardVariant, formatCheckoutRow, formatSaleLine } from "./labels";

export function itemsForProduct(items: Item[], productId: string): Item[] {
  return items.filter(i => i.product_id === productId && !i.is_deleted);
}

/**
 * Reference (factor-1) item: no ref — the anchor all math starts from.
 * Any size (owners usually pick what they buy, e.g. Sack). Chain-only ⇒ one.
 */
export function baseItem(items: Item[]): Item | null {
  return items.find(i => !i.ref_item_id) ?? null;
}

/**
 * Smallest item by cumulative factor — the canonical storage unit.
 * Stock is ALWAYS stored in smallest-unit counts (integers); display
 * converts to any unit. Falls back to the reference item when empty.
 */
export function smallestItem(items: Item[]): Item | null {
  let best: Item | null = null;
  let bestF = Infinity;
  for (const it of items) {
    if (it.is_deleted) continue;
    const f = itemFactor(items, it.id);
    if (f > 0 && f < bestF) {
      bestF = f;
      best = it;
    }
  }
  return best ?? baseItem(items);
}

/** Minimum cumulative factor across a product's items (canonical divisor). */
export function minItemFactor(allItems: Item[], productId: string): number {
  const items = itemsForProduct(allItems, productId);
  let m = Infinity;
  for (const it of items) {
    const f = itemFactor(allItems, it.id);
    if (f > 0 && f < m) m = f;
  }
  return m === Infinity ? 1 : m;
}

/**
 * Convert a quantity expressed in an item's units to canonical
 * (smallest-unit) storage counts. factor/minFactor is always integral in
 * practice (whole-number relations); Math.round kills float dust.
 */
export function toCanonicalQty(
  allItems: Item[],
  productId: string,
  itemId: string,
  qty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return Math.round(((Number(qty) || 0) * f) / m);
}

/** Canonical counts → counts in the given item's units (may fractionalize). */
export function fromCanonicalQty(
  allItems: Item[],
  productId: string,
  itemId: string,
  canonicalQty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return (Number(canonicalQty) || 0) / (f / m);
}

/** Floored sellable/available count of an item from canonical stock. */
export function countInUnit(
  allItems: Item[],
  productId: string,
  itemId: string,
  canonicalQty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return Math.floor((Number(canonicalQty) || 0) / (f / m) + 1e-9);
}

/**
 * Mixed breakdown display: "120 Sack · 4 Mamit · 5 Vè" (largest first,
 * zero levels omitted; bare "120 Sack" when the rest is empty).
 */
export function breakdownStock(
  allItems: Item[],
  productId: string,
  canonicalQty: number
): string {
  const items = itemsForProduct(allItems, productId)
    .map(it => ({ it, per: itemFactor(allItems, it.id) / minItemFactor(allItems, productId) }))
    .filter(x => x.per > 0)
    .sort((a, b) => b.per - a.per);
  let rest = Number(canonicalQty) || 0;
  const parts: string[] = [];
  for (const { it, per } of items) {
    const n = Math.floor(rest / per + 1e-9);
    if (n > 0) {
      parts.push(`${n} ${it.name}`);
      rest -= n * per;
    }
  }
  const smallest = items.length ? items[items.length - 1].it : null;
  return parts.length ? parts.join(" · ") : `0 ${smallest?.name ?? ""}`.trim();
}

/**
 * Cumulative factor of an item in base units (case→4-pack→single with
 * ratios 6,4 ⇒ case = 24 base). Returns 1 for the base item, 0 when the
 * chain is broken (missing link) so callers never divide by garbage.
 */
export function itemFactor(allItems: Item[], itemId: string): number {
  let factor = 1;
  let cur = allItems.find(i => i.id === itemId);
  const seen = new Set<string>();
  while (cur?.ref_item_id) {
    if (seen.has(cur.id)) return 0; // cycle guard (should be impossible)
    seen.add(cur.id);
    const r = Number(cur.ratio) || 0;
    if (!(r > 0)) return 0;
    factor *= r;
    cur = allItems.find(i => i.id === cur!.ref_item_id);
  }
  return cur ? factor : 0;
}

/** Children (directly larger items) of an item, for lock/descendant walks. */
export function itemChildren(allItems: Item[], itemId: string): Item[] {
  return allItems.filter(i => i.ref_item_id === itemId && !i.is_deleted);
}

export function itemDescendants(allItems: Item[], itemId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const c of itemChildren(allItems, id)) {
      if (!out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(itemId);
  return out;
}

/** Ratio locked once the item has any batch or variant attached. */
export function isItemLocked(
  itemId: string,
  batches: Batch[],
  variants: Variant[]
): boolean {
  return (
    batches.some(b => b.item_id === itemId && !b.is_deleted) ||
    variants.some(v => v.item_id === itemId && !v.is_deleted)
  );
}

/**
 * Current selling price for a variant: latest effective date ≤ now;
 * same-date tie → latest created wins. Null when no price applies yet.
 */
export function currentVariantPrice(
  prices: VariantPrice[],
  variantId: string,
  nowIso?: string
): VariantPrice | null {
  const now = nowIso ?? new Date().toISOString();
  const rows = prices.filter(
    p => p.variant_id === variantId && !p.is_deleted && p.date <= now
  );
  if (!rows.length) return null;
  rows.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return rows[0];
}

export type Bundle = {
  id: string; variant_id: string; min_quantity: number; active?: number | boolean;
  created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type BundlePrice = {
  id: string; bundle_id: string; price: number;
  date: string; created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

/** Effective-dated bundle price: latest row dated ≤ now (same rule as variant prices). */
export function currentBundlePrice(
  prices: BundlePrice[],
  bundleId: string,
  nowIso?: string
): BundlePrice | null {
  const now = nowIso ?? new Date().toISOString();
  const rows = prices.filter(
    p => p.bundle_id === bundleId && !p.is_deleted && p.date <= now
  );
  if (!rows.length) return null;
  rows.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return rows[0];
}

/**
 * Append one effective-dated variant price (history is never overwritten).
 * Returns the row id so callers can surface it. Passing the same `date` as
 * the current row replaces that row instead of stacking a duplicate.
 */
export async function upsertVariantPriceRow(db: any, args: {
  variantId: string; price: number; date: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const price = Math.max(0, Number(args.price) || 0);
  const id = mintId();
  const rec = {
    id, variant_id: args.variantId, price, date: args.date,
    created_at: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
    [rec.id, rec.variant_id, rec.price, rec.date, rec.created_at, rec.updated_at, 0, 1]
  );
  try { await insertOutbox("variant_prices", "create", { ...rec, is_deleted: false }); } catch {}
  return id;
}

/**
 * Create or amend a bundle (wizard step 4). `minQuantity`/`active` live on
 * the bundle record; every price change is a new effective-dated row so the
 * old price survives. Returns the bundle id.
 */
export async function upsertBundleRow(db: any, args: {
  bundleId?: string; variantId: string; minQuantity: number;
  price: number; date: string; active?: boolean;
}): Promise<string> {
  const now = new Date().toISOString();
  const id = args.bundleId || mintId();
  const minQuantity = Math.max(0, Number(args.minQuantity) || 0);
  const active = args.active === false ? 0 : 1;
  const rec = {
    id, variant_id: args.variantId, min_quantity: minQuantity, active,
    created_at: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO bundles (id, variant_id, min_quantity, active, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
    [rec.id, rec.variant_id, rec.min_quantity, rec.active, rec.created_at, rec.updated_at, 0, 1]
  );
  try { await insertOutbox("bundles", "create", { ...rec, is_deleted: false }); } catch {}

  const price = Math.max(0, Number(args.price) || 0);
  const priceRec = {
    id: `bpri-${id}-${args.date}`, bundle_id: id, price, date: args.date,
    created_at: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO bundle_prices (id, bundle_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
    [priceRec.id, priceRec.bundle_id, priceRec.price, priceRec.date, priceRec.created_at, priceRec.updated_at, 0, 1]
  );
  try { await insertOutbox("bundle_prices", "create", { ...priceRec, is_deleted: false }); } catch {}
  return id;
}

/**
 * Record "supplier S charges X for item I" — the row the cost-comparison
 * engine reads. Keyed by item_id so it lines up with batch lines; unit_id is
 * still required by the schema, so it mirrors item_id for v2-written rows.
 * Always written AFTER the comparison runs, never before.
 */
export async function upsertSupplierCost(db: any, args: {
  productId: string; supplierId: string; itemId: string; cost: number;
}): Promise<void> {
  const now = new Date().toISOString();
  const cost = Math.max(0, Number(args.cost) || 0);
  const existing = ((await db.getAllAsync(
    "SELECT * FROM product_supplier_costs WHERE product_id = ? AND supplier_id = ?",
    [args.productId, args.supplierId]
  ).catch(() => [])) ?? []) as any[];
  // Prefer an item-keyed hit, then a legacy unit-keyed hit (pre-backfill row).
  const hit = existing.find(r => String(r.item_id) === String(args.itemId))
    ?? existing.find(r => String(r.unit_id) === String(args.itemId));
  if (hit) {
    await db.runAsync(
      "UPDATE product_supplier_costs SET cost = ?, item_id = ?, last_updated = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      [cost, args.itemId, now, now, String(hit.id)]
    );
    try {
      await insertOutbox("product_supplier_costs", "update", {
        id: String(hit.id), cost, item_id: args.itemId, last_updated: now, updated_at: now, is_deleted: false,
      });
    } catch {}
    return;
  }
  const id = mintId();
  const rec = {
    id, product_id: args.productId, supplier_id: args.supplierId,
    unit_id: args.itemId, item_id: args.itemId, cost,
    last_updated: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO product_supplier_costs (id, product_id, supplier_id, unit_id, item_id, cost, last_updated, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [rec.id, rec.product_id, rec.supplier_id, rec.unit_id, rec.item_id, rec.cost, rec.last_updated, rec.updated_at, 0, 1]
  );
  try {
    await insertOutbox("product_supplier_costs", "create", { ...rec, is_deleted: false });
  } catch {}
}

export type UnpricedVariantRow = {
  productId: string; productName: string;
  itemId: string; itemName: string;
  /** Null when the item has no variants yet — saving creates Standard. */
  variantId: string | null; variantName: string;
  /** Live price when known (prefill for bulk edit). */
  current?: number;
};

/**
 * Variants with no live price (nothing sellable in checkout): variants
 * whose current price is missing/zero, plus items with zero variants
 * (auto-Standard on save). Drafts excluded — unfinished chains.
 */
export function unpricedVariantRows(
  items: Item[],
  variants: Variant[],
  prices: VariantPrice[],
  products: { id: string; name: string; status?: string | null; is_deleted?: number | boolean }[],
  nowIso?: string,
  includePriced?: boolean
): UnpricedVariantRow[] {
  const now = nowIso ?? new Date().toISOString();
  const liveItems = items.filter(i => !i.is_deleted);
  const liveVariants = variants.filter(v => !v.is_deleted);
  const out: UnpricedVariantRow[] = [];
  for (const p of products) {
    if (p.is_deleted) continue;
    if (String((p as any).status ?? "active") === "draft") continue;
    const pItems = liveItems.filter(i => String(i.product_id) === String(p.id));
    if (!pItems.length) continue;
    for (const it of pItems) {
      const vs = liveVariants.filter(v => String(v.item_id) === String(it.id));
      if (!vs.length) {
        out.push({
          productId: String(p.id), productName: String(p.name ?? "?"),
          itemId: String(it.id), itemName: String(it.name ?? "?"),
          variantId: null, variantName: "Standard",
        });
        continue;
      }
      for (const v of vs) {
        const cur = currentVariantPrice(prices, String(v.id), now);
        const curNum = cur ? Number(cur.price) || 0 : 0;
        if (includePriced || !(curNum > 0)) {
          out.push({
            productId: String(p.id), productName: String(p.name ?? "?"),
            itemId: String(it.id), itemName: String(it.name ?? "?"),
            variantId: String(v.id), variantName: String(v.name ?? "?"),
            current: curNum > 0 ? curNum : undefined,
          });
        }
      }
    }
  }
  return out;
}

/** Latest received batch for an item (by date, then created). */
export function latestReceivedBatch(batches: Batch[], itemId: string): Batch | null {
  const rows = batches.filter(
    b => b.item_id === itemId && b.status === "received" && !b.is_deleted
  );
  if (!rows.length) return null;
  rows.sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
  return rows[0];
}

/**
 * Current base-unit cost for a product: latest received batch across its
 * items, converted down to base units. 0 when nothing received yet.
 * (Replaces the dropped products.cost_price — same call shape, new source.)
 */
export function currentBaseCost(
  allItems: Item[],
  batches: Batch[],
  productId: string
): number {
  const items = itemsForProduct(allItems, productId);
  let best: { date: string; created: string; base: number } | null = null;
  for (const it of items) {
    const b = latestReceivedBatch(batches, it.id);
    if (!b || !(Number(b.quantity) > 0)) continue;
    const f = itemFactor(allItems, it.id);
    if (!(f > 0)) continue;
    const base = Number(b.total_paid) / Number(b.quantity) / f;
    const key = `${b.date} ${b.created_at ?? ""}`;
    if (!best || key > `${best.date} ${best.created}`) {
      best = { date: b.date, created: b.created_at ?? "", base };
    }
  }
  return best ? Math.max(0, best.base) : 0;
}

/** Cost at a specific item level, derived from the base cost. */
export function costForItem(
  allItems: Item[],
  batches: Batch[],
  productId: string,
  itemId: string
): number {
  const base = currentBaseCost(allItems, batches, productId);
  if (!(base > 0)) return 0;
  const f = itemFactor(allItems, itemId);
  return f > 0 ? base * f : 0;
}

/**
 * Cost per CANONICAL (smallest-unit) count — for margin math against
 * canonical quantities (checkout freeze, stock value, coupon discount).
 * `currentBaseCost` is per anchor (factor-1) unit; the smallest item's
 * cumulative factor is minItemFactor, so the smallest unit costs
 * `base × minItemFactor` — the same formula `costForItem` uses at item level.
 * The anchor always has factor 1, so minItemFactor ≤ 1 and the canonical
 * unit can never cost more than the anchor.
 */
export function currentCanonicalCost(
  allItems: Item[],
  batches: Batch[],
  productId: string
): number {
  const base = currentBaseCost(allItems, batches, productId);
  if (!(base > 0)) return 0;
  const m = minItemFactor(allItems, productId);
  return m > 0 ? base * Math.min(m, 1) : 0;
}

/** Cost-per-unit preview for a draft batch (display only, any status). */
export function previewBatchUnitCost(quantity: number, totalPaid: number): number {
  if (!(quantity > 0)) return 0;
  return Number(totalPaid) / Number(quantity);
}

// ---- loaders (single place both UI flows read the new model) ----

export type CatalogModel = {
  items: Item[];
  productSuppliers: ProductSupplier[];
  batches: Batch[];
  variants: Variant[];
  variantPrices: VariantPrice[];
};

export async function loadCatalogModel(db: any): Promise<CatalogModel> {
  const [items, productSuppliers, batches, variants, variantPrices] = await Promise.all([
    db.getAllAsync("SELECT * FROM items").catch(() => []),
    db.getAllAsync("SELECT * FROM product_suppliers").catch(() => []),
    db.getAllAsync("SELECT * FROM batches").catch(() => []),
    db.getAllAsync("SELECT * FROM variants").catch(() => []),
    db.getAllAsync("SELECT * FROM variant_prices").catch(() => []),
  ]);
  return {
    items: (items ?? []) as Item[],
    productSuppliers: (productSuppliers ?? []) as ProductSupplier[],
    batches: (batches ?? []) as Batch[],
    variants: (variants ?? []) as Variant[],
    variantPrices: (variantPrices ?? []) as VariantPrice[],
  };
}

export async function loadCatalogModelDefault(): Promise<CatalogModel> {
  return loadCatalogModel(await getDb());
}

/**
 * Soft-delete a product + everything it owns (items, variants, prices,
 * batches; pair rows hard-deleted like product_categories). Used both for
 * explicit deletes and for discarding an unfinished create chain — closing
 * the flow without finishing must never leave a registered product behind.
 */
export async function softDeleteProduct(db: any, productId: string): Promise<void> {
  const now = new Date().toISOString();
  const pid = String(productId);
  const itemRows = (((await db.getAllAsync("SELECT id FROM items WHERE product_id = ?", [pid]).catch(() => [])) ?? []) as any[]).map((r: any) => String(r.id));
  const varRows = itemRows.length
    ? (((await db.getAllAsync(`SELECT id FROM variants WHERE item_id IN (${itemRows.map(() => "?").join(",")})`, itemRows).catch(() => [])) ?? []) as any[]).map((r: any) => String(r.id))
    : [];
  await db.execAsync("BEGIN");
  try {
    for (const vid of varRows) {
      await db.runAsync("UPDATE variant_prices SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE variant_id = ?", [now, vid]);
      try { await insertOutbox("variant_prices", "update", { variant_id: vid, is_deleted: 1, updated_at: now }); } catch {}
      await db.runAsync("UPDATE variants SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?", [now, vid]);
      try { await insertOutbox("variants", "update", { id: vid, is_deleted: 1, updated_at: now }); } catch {}
    }
    for (const iid of itemRows) {
      await db.runAsync("UPDATE batches SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE item_id = ?", [now, iid]);
      try { await insertOutbox("batches", "update", { item_id: iid, is_deleted: 1, updated_at: now }); } catch {}
      await db.runAsync("UPDATE items SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?", [now, iid]);
      try { await insertOutbox("items", "update", { id: iid, is_deleted: 1, updated_at: now }); } catch {}
    }
    await db.runAsync("DELETE FROM product_categories WHERE product_id = ?", [pid]);
    await db.runAsync("DELETE FROM product_suppliers WHERE product_id = ?", [pid]);
    await db.runAsync("UPDATE products SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?", [now, pid]);
    try { await insertOutbox("products", "update", { id: pid, is_deleted: 1, updated_at: now }); } catch {}
    await db.execAsync("COMMIT");
  } catch (txErr) {
    try { await db.execAsync("ROLLBACK"); } catch {}
    throw txErr;
  }
}

function slugBatch(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function batchUid(taken: Set<string>, _base: string): string {
  let id = mintId();
  while (taken.has(id)) id = mintId();
  taken.add(id);
  return id;
}

export type V2BatchInput = {
  itemId: string; supplierId: string;
  qty: string | number; total: string | number; date: string;
  deliveryRef?: string | null; transportShare?: number;
  /** One wizard run: groups every batch it writes so transport can be patched later. */
  sessionRef?: string | null;
  source?: string;
};

/**
 * Insert one pending v2 batch (cost enters only here). Shared by the
 * catalog batch step and Inventory deliveries — one system, one rule.
 */
export async function insertV2Batch(
  db: any, now: string, taken: Set<string>, c: V2BatchInput
): Promise<string> {
  const itemRows = (((await db.getAllAsync("SELECT name FROM items WHERE id = ?", [c.itemId]).catch(() => [])) ?? []) as any[]);
  const id = batchUid(taken, `${slugBatch(String(itemRows[0]?.name ?? "batch")) || "batch"}-${c.date}`);
  const rec = {
    id, item_id: c.itemId, supplier_id: c.supplierId, date: c.date,
    quantity: Number(c.qty) || 0, total_paid: Number(c.total) || 0,
    status: "pending", received_by: null, received_at: null,
    denied_by: null, denied_at: null, reason: null,
    delivery_ref: c.deliveryRef ?? null, transport_share: Number(c.transportShare) || 0,
    session_ref: c.sessionRef ?? null,
    source: c.source ?? "user", created_at: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO batches (id, item_id, supplier_id, date, quantity, total_paid, status, received_by, received_at, denied_by, denied_at, reason, delivery_ref, transport_share, session_ref, source, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [rec.id, rec.item_id, rec.supplier_id, rec.date, rec.quantity, rec.total_paid, rec.status, rec.received_by, rec.received_at, rec.denied_by, rec.denied_at, rec.reason, rec.delivery_ref, rec.transport_share, rec.session_ref, rec.source, rec.created_at, rec.updated_at, 0, 1]
  );
  try { await insertOutbox("batches", "create", { ...rec, is_deleted: false }); } catch {}
  return id;
}

/**
 * Same item + same supplier folds into one pending row (qty adds onto qty,
 * total onto total). Different suppliers stay separate rows. Only pending
 * batches merge — received/denied are locked history.
 */
export async function mergeV2Batch(
  db: any, now: string, taken: Set<string>, c: V2BatchInput
): Promise<string> {
  const addQ = Number(c.qty) || 0;
  const addT = Number(c.total) || 0;
  const rows = (((await db.getAllAsync(
    "SELECT id, item_id, supplier_id, status, quantity, total_paid, transport_share, session_ref FROM batches WHERE item_id = ? AND supplier_id = ? AND status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1",
    [c.itemId, c.supplierId]
  ).catch(() => [])) ?? []) as any[]);
  // Re-asserted in JS (not just SQL) so the memory backend — which applies
  // only the first WHERE clause it recognises — folds on exactly the same
  // basis as SQLite. A line never lands on a batch from another wizard run:
  // that batch already owns its own transport slice.
  const scoped = rows.filter(r =>
    String(r.supplier_id ?? "") === String(c.supplierId) &&
    String(r.status ?? "pending") === "pending" &&
    (!c.sessionRef || String(r.session_ref ?? "") === String(c.sessionRef))
  );
  const hit = scoped[0];
  if (hit) {
    const newQ = (Number(hit.quantity) || 0) + addQ;
    const newT = (Number(hit.total_paid) || 0) + addT;
    const newS = (Number(hit.transport_share) || 0) + (Number(c.transportShare) || 0);
    await db.runAsync("UPDATE batches SET quantity = ?, total_paid = ?, transport_share = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      [newQ, newT, newS, now, String(hit.id)]);
    try { await insertOutbox("batches", "update", { id: String(hit.id), quantity: newQ, total_paid: newT, transport_share: newS, updated_at: now, is_deleted: false }); } catch {}
    return String(hit.id);
  }
  return insertV2Batch(db, now, taken, c);
}

/**
 * End-of-session transport: one amount, spread across every batch the wizard
 * run wrote, in proportion to each line's items cost (revient basis). Batches
 * already carrying a transport slice are skipped so a re-run never double
 * charges. Returns the batches that were touched.
 */
export async function patchSessionTransport(
  db: any, sessionRef: string, totalTransport: number
): Promise<{ batchIds: string[] }> {
  const transport = Math.max(0, Number(totalTransport) || 0);
  const ref = String(sessionRef || "");
  if (!ref) return { batchIds: [] };
  const now = new Date().toISOString();
  let rows: any[] = [];
  try {
    rows = ((await db.getAllAsync(
      "SELECT id, total_paid, transport_share FROM batches WHERE session_ref = ? AND (is_deleted = 0 OR is_deleted IS NULL)",
      [ref]
    )) ?? []) as any[];
  } catch { rows = []; }
  const pending = rows.filter(r => !(Number(r.transport_share) > 0));
  if (!pending.length) return { batchIds: [] };

  const base = pending.reduce((s, r) => s + (Number(r.total_paid) || 0), 0);
  const touched: string[] = [];
  for (const r of pending) {
    const share = transport > 0
      ? (base > 0 ? transport * ((Number(r.total_paid) || 0) / base) : transport / pending.length)
      : 0;
    const newTotal = (Number(r.total_paid) || 0) + share;
    await db.runAsync(
      "UPDATE batches SET total_paid = ?, transport_share = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      [newTotal, share, now, String(r.id)]
    );
    try {
      await insertOutbox("batches", "update", {
        id: String(r.id), total_paid: newTotal, transport_share: share, updated_at: now, is_deleted: false,
      });
    } catch {}
    touched.push(String(r.id));
  }
  return { batchIds: touched };
}

/**
 * Receive one pending v2 batch: optional extra cost folds into total_paid
 * first (transport/douane at arrival), then status flips and canonical
 * smallest-unit counts land on the product. Shared by catalog receive and
 * Inventory deliveries.
 */
export async function receiveV2Batch(
  db: any, args: {
    batchId: string; productId: string; itemId: string;
    quantity: number; receivedBy: string; extraTotal?: number;
  }
): Promise<{ baseQty: number }> {
  const now = new Date().toISOString();
  // Drafts can never receive: unfinished chains must not become real stock.
  const pRows = (((await db.getAllAsync("SELECT status FROM products WHERE id = ?", [args.productId]).catch(() => [])) ?? []) as any[]);
  if (!pRows.length) throw new Error("Pwodwi introuvab.");
  if (String(pRows[0]?.status ?? "active") === "draft") throw new Error("Pwodwi a poko fini (draft) — pa ka resevwa batch.");
  const items = (((await db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [args.productId]).catch(() => [])) ?? []) as any[])
    .filter((i: any) => !i.is_deleted) as Item[];
  const f = itemFactor(items, args.itemId);
  if (!(f > 0)) throw new Error("Chenn inite a kase — pa ka konvèti.");
  const baseQty = toCanonicalQty(items, args.productId, args.itemId, Number(args.quantity));
  const curRows = (((await db.getAllAsync("SELECT stock_quantity FROM products WHERE id = ?", [args.productId]).catch(() => [])) ?? []) as any[]);
  const newTotal = (Number(curRows[0]?.stock_quantity) || 0) + baseQty;
  const extra = Number(args.extraTotal) || 0;
  await db.execAsync("BEGIN");
  try {
    if (extra > 0) {
      await db.runAsync("UPDATE batches SET total_paid = total_paid + ?, updated_at = ?, dirty = 1 WHERE id = ?",
        [extra, now, args.batchId]);
    }
    await db.runAsync("UPDATE batches SET status = ?, received_by = ?, received_at = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      ["received", args.receivedBy, now, now, args.batchId]);
    try { await insertOutbox("batches", "update", { id: args.batchId, status: "received", received_by: args.receivedBy, received_at: now, ...(extra > 0 ? { extra_total: extra } : {}), updated_at: now, is_deleted: 0 }); } catch {}
    await db.runAsync("UPDATE products SET stock_quantity = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      [newTotal, now, args.productId]);
    try { await insertOutbox("products", "update", { id: args.productId, stock_quantity: newTotal, updated_at: now, is_deleted: 0 }); } catch {}
    await db.execAsync("COMMIT");
  } catch (tx) {
    try { await db.execAsync("ROLLBACK"); } catch {}
    throw tx;
  }
  // A real purchase just landed: republish this product's unit costs so every
  // container carries the new figure (and it reaches the other devices).
  try { await recomputeItemCosts(db, args.productId); } catch {}
  return { baseQty };
}
