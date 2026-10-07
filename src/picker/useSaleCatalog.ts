import { useEffect, useState } from "react";
import { getDb } from "../db";
import { ensurePricingForProducts, type PricingMaps } from "../pricing";
import type { Product } from "../screens/POSShared";

// Empty-DB fallback used the deleted demo JSON — no fallback now: an empty
// catalog honestly shows empty until the owner creates products.
const CATALOG_FALLBACK: any[] = [];

type Snapshot = {
  products: Product[];
  catNames: Record<string, string>;
  pricing: PricingMaps;
  costMap: Map<string, number>;
  minFactorMap: Map<string, number>;
  variantSales: Map<string, number>;
};

// Module-level cache: checkout unmounts on every tab switch, so without this
// each open restarted from empty state + skeleton. With it, reopening shows
// the last snapshot instantly and the re-fetch only swaps in what changed —
// the skeleton animation is seen once per app session, not per open.
let cache: Snapshot | null = null;

/**
 * The sale catalog the product pickers need: ranked products, category
 * names, unit/variant pricing, per-product cost + factor minima, and the
 * 30-day per-variant sales trend (best-seller marker). Shared by
 * checkout (POSScreen) and the Orders in-screen item picker so both see the
 * same data through one loader. `enabled` lets a modal defer the load until
 * it actually opens.
 */
export function useSaleCatalog(enabled = true) {
  const [products, setProducts] = useState<Product[]>(() => cache?.products ?? []);
  const [catNames, setCatNames] = useState<Record<string, string>>(() => cache?.catNames ?? {});
  const [pricing, setPricing] = useState<PricingMaps>(() => cache?.pricing ?? { units: [], prices: [], bundles: [] });
  const [costMap, setCostMap] = useState<Map<string, number>>(() => cache?.costMap ?? new Map());
  const [minFactorMap, setMinFactorMap] = useState<Map<string, number>>(() => cache?.minFactorMap ?? new Map());
  const [variantSales, setVariantSales] = useState<Map<string, number>>(() => cache?.variantSales ?? new Map());
  // First-load flag for the pickers: skeleton until products + pricing land,
  // so an empty [] never flashes "Pa gen pwodwi" while the DB is still reading.
  // A cached snapshot skips the skeleton — reopening checkout refreshes in place.
  const [loaded, setLoaded] = useState(!enabled || !!cache);

  useEffect(() => {
    if (!enabled) return;
    // Skeleton only when there is nothing on screen yet (first load ever);
    // otherwise the reload proceeds with the cached list visible.
    if (!cache) setLoaded(false);
    let alive = true;
    let fetched = false;
    const next: Snapshot = {
      products: cache?.products ?? [],
      catNames: cache?.catNames ?? {},
      pricing: cache?.pricing ?? { units: [], prices: [], bundles: [] },
      costMap: cache?.costMap ?? new Map(),
      minFactorMap: cache?.minFactorMap ?? new Map(),
      variantSales: cache?.variantSales ?? new Map(),
    };
    (async () => {
      try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 AND (status IS NULL OR status = 'active') ORDER BY name LIMIT 50")) as Product[];
      fetched = true;
      try {
        const cats = ((await db.getAllAsync("SELECT id, name FROM categories")) as any[]) ?? [];
        const map: Record<string, string> = {};
        for (const c of cats) map[String(c.id)] = String(c.name ?? "");
        next.catNames = map;
        if (alive) setCatNames(map);
      } catch {}
      const withRank = rows
        .map(p => ({
          ...p,
          item_type: (p.item_type ?? "goods") as "goods" | "service",
          is_available: p.is_available ?? 1,
          sales_count: p.sales_count ?? 30,
          barcode: p.barcode ?? p.sku ?? "",
          category_id: p.category_id ?? "",
        }))
        // Services toggled off (86) never reach ordering screens.
        .filter(p => p.item_type !== "service" || (p.is_available !== 0 && (p.is_available as any) !== false));
      withRank.sort((a, b) => (b.sales_count! - a.sales_count!));
      if (withRank.length === 0) {
        // Empty DB (seed disabled/off): fall back to the mock catalog's
        // ubiquitous tier so POS still opens with recognizable best-sellers.
        next.products = CATALOG_FALLBACK.map(p => ({
          id: p.id, name: p.name, name_ht: p.name_ht, barcode: p.barcode, sku: p.sku,
          selling_price: p.units?.[0]?.sell ?? 0, stock_quantity: p.stock ?? 0,
          cost_price: 0, sales_count: 60,
        }));
        if (alive) setProducts(next.products);
      } else {
        next.products = withRank;
        if (alive) setProducts(withRank);
      }
      try {
        // Multi-variant pricing: units / Cold-Hot prices / bundles (+ legacy defaults)
        const pm = await ensurePricingForProducts(db, withRank);
        next.pricing = pm;
        if (alive) setPricing(pm);
      } catch (e) { console.log("[POS pricing] failed:", e); }
      try {
        // v2 cost basis per product (dropped products.cost_price) + chain minima.
        const { loadCatalogModel, currentBaseCost, minItemFactor } = await import("../catalogModel");
        const m = await loadCatalogModel(db);
        const map = new Map<string, number>();
        const mins = new Map<string, number>();
        for (const p of withRank) {
          map.set(p.id, currentBaseCost(m.items, m.batches, p.id));
          mins.set(p.id, minItemFactor(m.items, p.id));
        }
        next.costMap = map; next.minFactorMap = mins;
        if (alive) { setCostMap(map); setMinFactorMap(mins);
      } } catch { next.costMap = new Map(); next.minFactorMap = new Map(); if (alive) { setCostMap(new Map()); setMinFactorMap(new Map()); } }
      try {
        // 30-day trend per (product, unit, variant) — feeds the group card's
        // best-seller marker (trend, not all-time). sale_items has no
        // created_at; updated_at is written at insert (checkout) and never
        // touched later, so it IS the sale date. Aggregated in JS because the
        // memory backend does not evaluate GROUP BY (same as compareCost.ts);
        // the JS re-filter also covers the mock ignoring non-sale_id WHEREs.
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const items = ((await db.getAllAsync(
          "SELECT product_id, unit_id, variant, quantity, updated_at, is_deleted FROM sale_items WHERE updated_at >= ?",
          [new Date(cutoff).toISOString()],
        ).catch(() => [])) ?? []) as any[];
        const map = new Map<string, number>();
        for (const it of items) {
          if (!it || it.is_deleted) continue;
          const t = Date.parse(String(it.updated_at ?? ""));
          if (!Number.isFinite(t) || t < cutoff) continue;
          const qty = Number(it.quantity) || 0;
          if (qty <= 0) continue;
          const pid = String(it.product_id ?? "");
          if (!pid) continue;
          const key = `${pid}|${it.unit_id ? String(it.unit_id) : "base"}|${it.variant ? String(it.variant) : "Regular"}`;
          map.set(key, (map.get(key) ?? 0) + qty);
        }
        next.variantSales = map;
        if (alive) setVariantSales(map);
      } catch { next.variantSales = new Map(); if (alive) setVariantSales(new Map()); }
      } catch (e) {
        console.log("[POS products] failed:", e);
      } finally {
        // Only cache a successful read — a failed first load must keep
        // showing the skeleton on the next open rather than a poisoned empty.
        if (fetched) cache = next;
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [enabled]);

  const getBaseCost = (pid: string) => costMap.get(pid) ?? 0;
  return { products, catNames, pricing, costMap, minFactorMap, getBaseCost, variantSales, loaded };
}
