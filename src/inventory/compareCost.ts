/**
 * Cost-comparison engine for the batch-creation wizard.
 *
 * When a batch is about to be saved under supplier A, every line is checked
 * against the other suppliers that may actually supply that product. If one of
 * them charges ≥5% less for the same item, the line gets a Split/Keep nudge
 * showing the real currency saved.
 *
 * Two rules the UI depends on:
 *  - The "current" price for A is the price in the batch being built (we are
 *    literally being quoted it). Competitor prices come from
 *    product_supplier_costs, keyed by item_id so they line up with batch lines.
 *  - Only CURRENT prices are compared — never a historical quote. But a quote
 *    nobody has touched in a month may no longer be true, so each candidate is
 *    verified against the last time we actually bought from that supplier and
 *    faded when the evidence is older than FRESH_DAYS.
 *
 * Costs are margin-sensitive: the caller decides who may see the numbers
 * (InventoryScreen only surfaces this to owner/admin, matching canViewItemCost).
 */

export type CompareLine = {
  itemId: string;
  productId: string;
  qty: number;
  /** Unit cost in the batch being built — this is supplier A's current price. */
  unitCost: number;
};

export type CostRecommendation = {
  itemId: string;
  currentSupplierId: string;
  currentUnitCost: number;
  cheaperSupplierId: string;
  cheaperSupplierName: string;
  cheaperUnitCost: number;
  savingPerUnit: number;
  /** Saving across this line's quantity — the number the sheet leads with. */
  totalSaving: number;
  /** Evidence older than FRESH_DAYS: surface it faded, not as a firm nudge. */
  stale: boolean;
};

export type CompareSkip =
  | { itemId: string; reason: "no-product-supplier" }
  | { itemId: string; reason: "no-competitor-cost" }
  | { itemId: string; reason: "no-evidence" }
  | { itemId: string; reason: "below-threshold" };

export type CompareResult = {
  recommendations: CostRecommendation[];
  skipped: CompareSkip[];
};

/** A gap this small isn't worth splitting a delivery for. */
export const SAVINGS_THRESHOLD = 0.05;
/** Cost evidence older than this is shown faded rather than as a firm nudge. */
export const FRESH_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SupplierCostRow = {
  product_id: string;
  supplier_id: string;
  item_id?: string | null;
  unit_id: string;
  cost: number;
  last_updated?: string | null;
  is_deleted?: number | boolean;
};

export type SupplierLite = { id: string; name: string };

/**
 * Pure evaluation — no storage, no I/O. `compareBatchLines` is the storage
 * wrapper; keeping this separate is what makes the thresholds testable.
 */
export function evaluateBatchCosts(args: {
  lines: CompareLine[];
  chosenSupplierId: string;
  costRows: SupplierCostRow[];
  productSuppliers: { product_id: string; supplier_id: string }[];
  suppliers: SupplierLite[];
  /** Most recent received batch date per (item, supplier), already de-duplicated. */
  lastPurchases: { itemId: string; supplierId: string; date: string }[];
  now?: string;
}): CompareResult {
  const now = args.now ?? new Date().toISOString();
  const recommendations: CostRecommendation[] = [];
  const skipped: CompareSkip[] = [];

  const supplierName = new Map(args.suppliers.map(s => [String(s.id), String(s.name ?? "")]));
  const lastPurchaseAt = new Map<string, string>();
  for (const p of args.lastPurchases) {
    const key = `${p.itemId}|${p.supplierId}`;
    const cur = lastPurchaseAt.get(key);
    if (!cur || String(p.date) > cur) lastPurchaseAt.set(key, String(p.date));
  }

  // Suppliers allowed to source each product (we never nudge toward a
  // supplier we cannot actually buy from). Two sources: the explicit
  // product_suppliers join, plus any supplier that has ever quoted a cost —
  // seeded catalogs only carry the second one.
  const allowed = new Map<string, Set<string>>();
  const allow = (productId: any, supplierId: any) => {
    const key = String(productId);
    const set = allowed.get(key) ?? new Set<string>();
    set.add(String(supplierId));
    allowed.set(key, set);
  };
  for (const ps of args.productSuppliers) allow(ps.product_id, ps.supplier_id);
  for (const r of args.costRows) {
    if (!r.is_deleted) allow(r.product_id, r.supplier_id);
  }

  // One cost per (product, supplier, item): a sync merge can leave a legacy
  // unit-keyed row alongside an item-keyed one — newest last_updated wins.
  const bestCost = new Map<string, SupplierCostRow>();
  for (const r of args.costRows) {
    const itemId = String(r.item_id ?? "");
    if (!itemId) continue;
    const key = `${String(r.product_id)}|${String(r.supplier_id)}|${itemId}`;
    const prev = bestCost.get(key);
    if (!prev || String(r.last_updated ?? "") > String(prev.last_updated ?? "")) bestCost.set(key, r);
  }

  for (const line of args.lines) {
    const current = Number(line.unitCost) || 0;
    if (!(current > 0) || !(Number(line.qty) > 0)) continue;

    const productId = String(line.productId);
    const allowedSuppliers = allowed.get(productId);
    if (!allowedSuppliers || !allowedSuppliers.size) {
      skipped.push({ itemId: line.itemId, reason: "no-product-supplier" });
      continue;
    }

    let cheapest: SupplierCostRow | null = null;
    for (const supplierId of allowedSuppliers) {
      if (supplierId === String(args.chosenSupplierId)) continue;
      const row = bestCost.get(`${productId}|${supplierId}|${line.itemId}`);
      if (!row) continue;
      const cost = Number(row.cost) || 0;
      if (!(cost > 0)) continue;
      if (!cheapest || cost < Number(cheapest.cost)) cheapest = row;
    }
    if (!cheapest) {
      skipped.push({ itemId: line.itemId, reason: "no-competitor-cost" });
      continue;
    }

    const cheaperCost = Number(cheapest.cost);
    const savingPerUnit = current - cheaperCost;
    const savingPct = current > 0 ? savingPerUnit / current : 0;
    if (savingPct < SAVINGS_THRESHOLD) {
      skipped.push({ itemId: line.itemId, reason: "below-threshold" });
      continue;
    }

    // Recency re-check: the quote is only actionable while someone has
    // validated it recently. Our own saves refresh last_updated, and the last
    // received batch from that supplier is independent proof — take the later
    // of the two as the moment this price was last known true.
    const quotedAt = String(cheapest.last_updated ?? "");
    if (!quotedAt) {
      skipped.push({ itemId: line.itemId, reason: "no-evidence" });
      continue;
    }
    const boughtAt = lastPurchaseAt.get(`${line.itemId}|${String(cheapest.supplier_id)}`) ?? "";
    const verifiedAt = boughtAt > quotedAt ? boughtAt : quotedAt;
    const ageDays = (Date.parse(now) - Date.parse(verifiedAt)) / DAY_MS;
    const stale = !isFinite(ageDays) || ageDays > FRESH_DAYS;

    recommendations.push({
      itemId: line.itemId,
      currentSupplierId: String(args.chosenSupplierId),
      currentUnitCost: current,
      cheaperSupplierId: String(cheapest.supplier_id),
      cheaperSupplierName: supplierName.get(String(cheapest.supplier_id)) ?? "",
      cheaperUnitCost: cheaperCost,
      savingPerUnit: Math.round(savingPerUnit * 100) / 100,
      totalSaving: Math.round(savingPerUnit * Number(line.qty) * 100) / 100,
      stale,
    });
  }

  return { recommendations, skipped };
}

/**
 * Storage wrapper: loads the rows `evaluateBatchCosts` needs and runs it.
 * Everything is read once per review pass, not once per line.
 */
export async function compareBatchLines(
  db: any,
  lines: CompareLine[],
  chosenSupplierId: string,
  opts?: { now?: string }
): Promise<CompareResult> {
  if (!lines.length || !chosenSupplierId) return { recommendations: [], skipped: [] };

  const load = async (sql: string): Promise<any[]> => {
    try { return ((await db.getAllAsync(sql)) ?? []) as any[]; } catch { return []; }
  };

  const [costRows, productSuppliers, suppliers, batches] = await Promise.all([
    load("SELECT * FROM product_supplier_costs"),
    load("SELECT * FROM product_suppliers"),
    load("SELECT * FROM suppliers"),
    load("SELECT item_id, supplier_id, date, status, is_deleted FROM batches"),
  ]);

  // Latest received batch per (item, supplier). Aggregated in JS because the
  // memory backend does not evaluate GROUP BY.
  const lastPurchases: { itemId: string; supplierId: string; date: string }[] = [];
  const seen = new Map<string, string>();
  for (const b of batches) {
    if (!b || b.is_deleted) continue;
    if (String(b.status ?? "") !== "received") continue;
    const key = `${String(b.item_id)}|${String(b.supplier_id)}`;
    const date = String(b.date ?? "");
    if (!date) continue;
    const cur = seen.get(key);
    if (!cur || date > cur) seen.set(key, date);
  }
  for (const [key, date] of seen) {
    const i = key.indexOf("|");
    lastPurchases.push({ itemId: key.slice(0, i), supplierId: key.slice(i + 1), date });
  }

  return evaluateBatchCosts({
    lines,
    chosenSupplierId,
    costRows: costRows as SupplierCostRow[],
    productSuppliers: productSuppliers as { product_id: string; supplier_id: string }[],
    suppliers: suppliers as SupplierLite[],
    lastPurchases,
    now: opts?.now,
  });
}
