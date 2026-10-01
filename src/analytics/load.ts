// General Analytics — the DB reads behind the owner/admin screen. One pass,
// plain rows, scoped the same way Reports scopes: owner sees every store,
// others get their assigned stores plus this device's selling store.
import { loadCatalogModel } from "../catalogModel";
import type { CatalogModel } from "../catalogModel";
import type { SupplierCostRow } from "../inventory/compareCost";

export type AnalyticsData = {
  /** Live (non-cancelled) sales inside the store scope. */
  sales: any[];
  /** sale_items belonging to those sales — the cost source. */
  lines: any[];
  products: any[];
  categories: any[];
  productCategories: any[];
  /** Items/batches/variants — cost trend + supplier comparison live here. */
  model: CatalogModel;
  costRows: SupplierCostRow[];
  productSuppliers: any[];
  suppliers: any[];
};

export async function loadAnalyticsData(db: any, storeIds: string[] | null): Promise<AnalyticsData> {
  const load = async (sql: string): Promise<any[]> => {
    try {
      return ((await db.getAllAsync(sql)) ?? []) as any[];
    } catch {
      return [];
    }
  };
  const [sales, lines, products, categories, productCategories, costRows, productSuppliers, suppliers, model] =
    await Promise.all([
      load("SELECT * FROM sales"),
      load("SELECT * FROM sale_items"),
      load("SELECT * FROM products"),
      load("SELECT * FROM categories"),
      load("SELECT * FROM product_categories"),
      load("SELECT * FROM product_supplier_costs"),
      load("SELECT * FROM product_suppliers"),
      load("SELECT * FROM suppliers"),
      loadCatalogModel(db),
    ]);

  const live = sales.filter(
    s =>
      String(s?.status ?? "") !== "cancelled" &&
      !s?.is_deleted &&
      (!storeIds || storeIds.includes(String(s?.store_id ?? "")))
  );
  const ids = new Set(live.map(s => String(s?.id)));

  return {
    sales: live,
    lines: lines.filter(l => ids.has(String(l?.sale_id))),
    products: products.filter(p => !p?.is_deleted),
    categories: categories.filter(c => !c?.is_deleted),
    productCategories,
    model,
    costRows: costRows as SupplierCostRow[],
    productSuppliers,
    suppliers: suppliers.filter(s => !s?.is_deleted),
  };
}
