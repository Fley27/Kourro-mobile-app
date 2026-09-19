/**
 * Multi-variant pricing helpers (Hot/Cold, Box/Unit, Bundle logic).
 *
 * Model:
 * - product_units: ways to sell a product (Unit factor 1, Box factor 24...).
 *   Quantities in stock_movements / stock_quantity / current_amount_available
 *   are ALWAYS stored in base units (factor 1).
 * - product_prices: price per (unit_id, variant) — Cold, Hot, Regular...
 * - product_bundles: (unit_id, variant, min_quantity) -> bundle_price.
 */

export type ProductUnit = {
  id: string;
  product_id: string;
  unit_name: string;
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

/** Load all pricing rows (catalogs are small; screens keep them in state). */
export async function loadPricing(db: any): Promise<PricingMaps> {
  const [units, prices, bundles] = await Promise.all([
    db.getAllAsync("SELECT * FROM product_units").catch(() => []),
    db.getAllAsync("SELECT * FROM product_prices").catch(() => []),
    db.getAllAsync("SELECT * FROM product_bundles").catch(() => []),
  ]);
  return {
    units: (units ?? []) as ProductUnit[],
    prices: (prices ?? []) as ProductPrice[],
    bundles: (bundles ?? []) as ProductBundle[],
  };
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
 * Safety net: guarantee at least one unit + one price row for a product,
 * migrated from legacy `selling_price` / `unit` fields when present.
 * No-op when units already exist. Returns units for the product.
 */
export async function ensurePricingForProduct(db: any, product: any): Promise<ProductUnit[]> {
  const pid = product?.id;
  if (!pid) return [];
  const existing = ((await db.getAllAsync("SELECT * FROM product_units WHERE product_id = ?", [pid]).catch(() => [])) ?? []) as ProductUnit[];
  if (existing.length) return existing;
  const now = new Date().toISOString();
  const legacyUnit = String((product as any).unit ?? "").trim() || "Unit";
  const legacyPrice = Number((product as any).selling_price ?? 0) || 0;
  const uid = `unit-${pid}-base`;
  await db.runAsync(
    "INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [uid, pid, legacyUnit, 1, now, now]
  );
  await db.runAsync(
    "INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
    [`price-${pid}-regular`, uid, DEFAULT_VARIANT, legacyPrice, now]
  );
  return [{ id: uid, product_id: pid, unit_name: legacyUnit, conversion_factor: 1, created_at: now, updated_at: now }];
}

/** Batch version (one round-trip for units, then inserts only for missing). */
export async function ensurePricingForProducts(db: any, products: any[]): Promise<PricingMaps> {
  for (const p of products ?? []) {
    try { await ensurePricingForProduct(db, p); } catch {}
  }
  return loadPricing(db);
}
