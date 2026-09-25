/**
 * Multi-variant pricing helpers (Hot/Cold, Box/Unit, Bundle logic).
 *
 * Catalog v2 model (source of truth):
 * - items: purchasable containers chained by ref_item_id + ratio.
 *   Stock (stock_quantity) is ALWAYS stored in base units (factor 1).
 * - variants: sellable presentations of an item (Cold, Regular...).
 * - variant_prices: effective-dated rows; current = latest date ≤ now.
 * - product_bundles: re-keyed to variant_id (see cutoverCatalog.ts).
 *
 * PricingMaps below is an in-memory VIEW over the v2 tables so every
 * existing reader (POS selectors, display price, bundle math) keeps its
 * signatures. loadPricing is the only function that touches storage.
 */

export type ProductUnit = {
  id: string;
  product_id: string;
  unit_name: string;
  /** Second variant dimension: "cold", "room temperature", null = none. */
  condition?: string | null;
  conversion_factor: number;
  created_at?: string;
  updated_at?: string;
};

export type ProductPrice = {
  id: string;
  unit_id: string;
  variant: string;
  price: number;
  updated_at?: string;
};

export type ProductBundle = {
  id: string;
  unit_id: string;
  variant: string;
  min_quantity: number;
  bundle_price: number;
  created_at?: string;
};

export type PricingMaps = {
  units: ProductUnit[];
  prices: ProductPrice[];
  bundles: ProductBundle[];
};

export const DEFAULT_VARIANT = "Regular";

/** Load all pricing rows (catalogs are small; screens keep them in state).
 *  Builds the PricingMaps view from the v2 tables (items → pseudo-units
 *  with cumulative base factors, current variant prices, variant bundles).
 *  Old tables (product_units/prices) are no longer read after the cutover.
 */
import { loadCatalogModel, currentVariantPrice, itemFactor } from "./catalogModel";
export async function loadPricing(db: any): Promise<PricingMaps> {
  const now = new Date().toISOString();
  try {
    const m = await loadCatalogModel(db);
    const liveItems = m.items.filter((i: any) => !i.is_deleted);
    const factorOf = (id: string): number => itemFactor(liveItems as any, id);
    const units: ProductUnit[] = liveItems
      .map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        unit_name: it.name,
        conversion_factor: factorOf(it.id) || 1,
        created_at: it.created_at,
        updated_at: it.updated_at,
      }))
      .filter(u => u.conversion_factor > 0);
    const prices: ProductPrice[] = [];
    for (const v of m.variants.filter((x: any) => !x.is_deleted)) {
      const cur = currentVariantPrice(m.variantPrices, v.id, now);
      prices.push({
        id: cur?.id ?? `noprice-${v.id}`,
        unit_id: v.item_id,
        variant: v.name,
        price: cur ? Number(cur.price) || 0 : 0,
        updated_at: cur?.updated_at ?? v.updated_at,
      });
    }
    const variantById = new Map(m.variants.map((v: any) => [v.id, v]));
    const bundles: ProductBundle[] = [];
    let rawBundles: any[] = [];
    try {
      rawBundles = ((await db.getAllAsync("SELECT * FROM product_bundles").catch(() => [])) ?? []) as any[];
    } catch { rawBundles = []; }
    for (const b of rawBundles) {
      const v = variantById.get(String(b.variant_id ?? ""));
      if (!v || (v as any).is_deleted) continue;
      bundles.push({
        id: String(b.id),
        unit_id: (v as any).item_id,
        variant: (v as any).name,
        min_quantity: Number(b.min_quantity) || 0,
        bundle_price: Number(b.bundle_price) || 0,
        created_at: b.created_at,
      });
    }
    return { units, prices, bundles };
  } catch {
    return { units: [], prices: [], bundles: [] };
  }
}

export function getUnitsForProduct(m: PricingMaps, productId: string): ProductUnit[] {
  return m.units.filter(u => u.product_id === productId);
}

export function getPricesForUnit(m: PricingMaps, unitId: string): ProductPrice[] {
  return m.prices.filter(p => p.unit_id === unitId);
}

export function getBundlesFor(m: PricingMaps, unitId: string, variant: string): ProductBundle[] {
  return m.bundles.filter(b => b.unit_id === unitId && b.variant === variant);
}

/** Default sell unit: the base unit (factor 1, ideally named 'Unit'), else first. */
export function getDefaultUnit(units: ProductUnit[]): ProductUnit | null {
  if (!units.length) return null;
  return (
    units.find(u => Number(u.conversion_factor) === 1 && /unit/i.test(u.unit_name ?? "")) ??
    units.find(u => Number(u.conversion_factor) === 1) ??
    units[0]
  );
}

/** Base price for (unit, variant): exact variant, else 'Regular', else first price, else 0. */
export function getBasePrice(m: PricingMaps, unitId: string, variant: string): number {
  const rows = getPricesForUnit(m, unitId);
  if (!rows.length) return 0;
  return (
    Number(rows.find(r => r.variant === variant)?.price ??
      rows.find(r => r.variant === DEFAULT_VARIANT)?.price ??
      rows[0].price ?? 0)
  );
}

export type LinePrice = { unitPrice: number; lineTotal: number; bundleApplied: boolean };

/**
 * Price `qty` (in SELECTED units) of (unitId, variant), applying the best
 * bundle rule. unitPrice is the effective per-unit price (lineTotal / qty).
 * Pass `frozenBase` to freeze the base price (suspended tabs keep the price
 * from suspension time); bundles are always evaluated live.
 */
export function resolveLinePrice(
  m: PricingMaps, unitId: string, variant: string, qty: number, frozenBase?: number
): LinePrice {
  const q = Math.max(0, Number(qty) || 0);
  const base = frozenBase != null && !(isNaN(frozenBase)) ? Number(frozenBase) : getBasePrice(m, unitId, variant);
  if (q <= 0 || base <= 0) return { unitPrice: 0, lineTotal: 0, bundleApplied: false };
  let best = q * base;
  let bundleApplied = false;
  for (const b of getBundlesFor(m, unitId, variant)) {
    const min = Number(b.min_quantity) || 0;
    const bp = Number(b.bundle_price) || 0;
    if (min > 0 && bp > 0 && q >= min) {
      const sets = Math.floor(q / min);
      const rest = q - sets * min;
      const total = sets * bp + rest * base;
      if (total < best) { best = total; bundleApplied = true; }
    }
  }
  const lineTotal = Math.round(best * 100) / 100;
  return { unitPrice: Math.round((lineTotal / q) * 100) / 100, lineTotal, bundleApplied };
}

/** One-line display price for catalog rows: default unit + preferred variant. */
export function getDisplayPrice(
  m: PricingMaps, productId: string
): { price: number; unitName: string; variant: string } | null {
  const units = getUnitsForProduct(m, productId);
  const unit = getDefaultUnit(units);
  if (!unit) return null;
  const rows = getPricesForUnit(m, unit.id);
  if (!rows.length) return null;
  const row =
    rows.find(r => r.variant === DEFAULT_VARIANT) ??
    rows.find(r => Number(r.price) > 0) ??
    rows[0];
  return { price: Number(row.price) || 0, unitName: unit.unit_name, variant: row.variant };
}

/** Convert a quantity in selected units to base units for stock writes. */
export function toBaseUnits(qty: number, factor: number): number {
  return (Number(qty) || 0) * (Number(factor) || 1);
}

/**
 * Safety net: guarantee at least one (base) item for a product.
 * No-op when items already exist. Never auto-creates variants or prices —
 * variant prices are effective-dated history and must come from real entry.
 * Returns pseudo-units for the product (same shape as loadPricing).
 */
export async function ensurePricingForProduct(db: any, product: any): Promise<ProductUnit[]> {
  const pid = product?.id;
  if (!pid) return [];
  // Drafts are unfinished chains — never plant anchors on them. Units come
  // from the Inite step only.
  if ((product as any)?.status === "draft") return [];
  const existing = (((await db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [pid]).catch(() => [])) ?? []) as any[])
    .filter((i: any) => !i.is_deleted);
  if (existing.length) {
    return existing.map((i: any) => ({
      id: i.id, product_id: pid, unit_name: i.name, conversion_factor: 1,
      created_at: i.created_at, updated_at: i.updated_at,
    }));
  }
  const now = new Date().toISOString();
  const iid = `item-${pid}-single`;
  await db.runAsync(
    "INSERT OR REPLACE INTO items (id, product_id, name, ref_item_id, ratio, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [iid, pid, "Single", null, null, 0, now, now, 0, 1]
  );
  return [{ id: iid, product_id: pid, unit_name: "Single", conversion_factor: 1, created_at: now, updated_at: now }];
}

/** Batch version (one round-trip for units, then inserts only for missing). */
export async function ensurePricingForProducts(db: any, products: any[]): Promise<PricingMaps> {
  for (const p of products ?? []) {
    try { await ensurePricingForProduct(db, p); } catch {}
  }
  return loadPricing(db);
}
