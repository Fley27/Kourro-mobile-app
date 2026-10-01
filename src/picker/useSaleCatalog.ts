import { useEffect, useState } from "react";
import { getDb } from "../db";
import { ensurePricingForProducts, type PricingMaps } from "../pricing";
import type { Product } from "../screens/POSShared";

// Empty-DB fallback used the deleted demo JSON — no fallback now: an empty
// catalog honestly shows empty until the owner creates products.
const CATALOG_FALLBACK: any[] = [];

/**
 * The sale catalog the product pickers need: ranked products, category
 * names, unit/variant pricing, per-product cost + factor minima. Shared by
 * checkout (POSScreen) and the Orders in-screen item picker so both see the
 * same data through one loader. `enabled` lets a modal defer the load until
 * it actually opens.
 */
export function useSaleCatalog(enabled = true) {
  const [products, setProducts] = useState<Product[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [costMap, setCostMap] = useState<Map<string, number>>(new Map());
  const [minFactorMap, setMinFactorMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 AND (status IS NULL OR status = 'active') ORDER BY name LIMIT 50")) as Product[];
      try {
        const cats = ((await db.getAllAsync("SELECT id, name FROM categories")) as any[]) ?? [];
        const map: Record<string, string> = {};
        for (const c of cats) map[String(c.id)] = String(c.name ?? "");
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
        if (alive) setProducts(
          CATALOG_FALLBACK.map(p => ({
            id: p.id, name: p.name, name_ht: p.name_ht, barcode: p.barcode, sku: p.sku,
            selling_price: p.units?.[0]?.sell ?? 0, stock_quantity: p.stock ?? 0,
            cost_price: 0, sales_count: 60,
          }))
        );
      } else if (alive) {
        setProducts(withRank);
      }
      try {
        // Multi-variant pricing: units / Cold-Hot prices / bundles (+ legacy defaults)
        const pm = await ensurePricingForProducts(db, withRank);
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
        if (alive) { setCostMap(map); setMinFactorMap(mins);
      } } catch { if (alive) { setCostMap(new Map()); setMinFactorMap(new Map()); } }
      } catch (e) {
        console.log("[POS products] failed:", e);
      }
    })();
    return () => { alive = false; };
  }, [enabled]);

  const getBaseCost = (pid: string) => costMap.get(pid) ?? 0;
  return { products, catNames, pricing, costMap, minFactorMap, getBaseCost };
}
