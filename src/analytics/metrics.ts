// General Analytics — pure aggregate metrics over rows already loaded from
// the DB. No React, no I/O: every function is (arrays) → numbers so the
// owner/admin screen stays a rendering shell and the maths is testable on
// its own (tsx).
//
// Reporting structure: VARIANT is the base figure (the actual sellable unit
// — price from variant_prices, cost from the item the variant is built on).
// Two plain upward-rolling chains, never flat or blended catalog-wide:
//   profit: variant → product → category
//   volume: variant → product → category
// Items never appear as a dimension: they only feed a variant's cost.
//
// Cost honesty: there is NO margin heuristic here. Every per-unit cost starts
// from ONE item's own anchor — its received batches (Σ total_paid / Σ quantity
// for that item alone), else that item's supplier quote, else the cost the
// owner typed in (items.cost) — and then walks the item's OWN ratio chain so
// one known price tags every container of that product (a child is `ratio ×`
// its reference: smaller divides, bigger multiplies). Costs are NEVER pooled
// across items (not even inside one batch session, where each item carries its
// own quantity and its own total_paid), never averaged catalog-wide, and never
// crossed between products. A line whose item has no cost anywhere reads as
// unknown, never as a made-up 35% margin.
import type { Batch, Item } from "../catalogModel";
import { evaluateBatchCosts } from "../inventory/compareCost";
import type { CompareLine, CostRecommendation, SupplierCostRow } from "../inventory/compareCost";
import type { RangeKey } from "../screens/home/types";
import { formatCheckoutRow } from "../labels";

export const RANGE_DAYS: Record<Exclude<RangeKey, "today" | "lifetime">, number> = {
  "7d": 7,
  "28d": 28,
  "6m": 180,
  "1y": 365,
};

/** Range start in ms; null = lifetime. "today" is the calendar day (Jodi a),
 *  the longer ranges are rolling windows counted back from `now`. */
export function rangeStart(range: RangeKey, now: number): number | null {
  if (range === "lifetime") return null;
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return now - RANGE_DAYS[range] * 86400000;
}

export function saleTime(s: any): number {
  return new Date(s?.created_at ?? s?.updated_at ?? "").getTime();
}

export function saleAmount(s: any): number {
  return Number(s?.total ?? s?.amount ?? s?.subtotal ?? 0);
}

export function salesInRange(sales: any[], range: RangeKey, now: number): any[] {
  const start = rangeStart(range, now);
  if (start === null) return sales;
  return sales.filter(s => {
    const t = saleTime(s);
    return !isNaN(t) && t >= start;
  });
}

export type CostCoverage = { withCost: number; total: number; pct: number };

/** Per-item unit cost — Σ(total_paid) / Σ(quantity) over ONE item's own
 *  received batches. A batch session records many items, each with its own
 *  quantity and its own total_paid: those are NEVER summed or averaged with
 *  each other (or with any other item in the catalog). 0 = no batch history. */
export function itemUnitCosts(batches: Batch[]): Map<string, number> {
  const agg = new Map<string, { paid: number; qty: number }>();
  for (const b of batches as any[]) {
    if (!b || b.is_deleted) continue;
    if (String(b.status ?? "") !== "received") continue;
    const qty = Number(b.quantity ?? 0);
    if (!(qty > 0)) continue;
    const g = agg.get(String(b.item_id)) ?? { paid: 0, qty: 0 };
    g.paid += Number(b.total_paid ?? 0);
    g.qty += qty;
    agg.set(String(b.item_id), g);
  }
  const out = new Map<string, number>();
  for (const [id, g] of agg) out.set(id, g.qty > 0 ? g.paid / g.qty : 0);
  return out;
}

/** Latest supplier quote per item (product_supplier_costs — "supplier S
 *  charges X for container I"). Newest last_updated wins; only live rows and
 *  positive quotes count. A quote is a real known cost: it is written from
 *  the batch being registered, so it belongs to the same purchase trail. */
export function quoteItemRates(costRows: SupplierCostRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const stamp = new Map<string, string>();
  for (const r of (costRows ?? []) as any[]) {
    if (!r || r.is_deleted) continue;
    const id = String(r?.item_id ?? r?.unit_id ?? "");
    if (!id) continue;
    const c = Number(r?.cost ?? 0);
    if (!(c > 0)) continue;
    const at = String(r?.last_updated ?? r?.updated_at ?? "");
    const cur = stamp.get(id);
    if (cur != null && at < cur) continue;
    stamp.set(id, at);
    out.set(id, c);
  }
  return out;
}

/**
 * Walk one product's item chain and price every container from the anchors:
 * a child is `ratio ×` its reference item — ratio < 1 means the child is the
 * SMALLER unit (its cost divides), ratio > 1 the BIGGER one (multiplies).
 * Each item resolves once, so cycles and conflicting anchors cannot loop or
 * overwrite a known cost. Anchors stay inside their own product by
 * construction: the chain never leaves `ref_item_id`.
 */
export function chainItemCosts(items: Item[], anchors: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, c] of anchors) if (Number(c) > 0) out.set(String(id), Number(c));
  const byId = new Map<string, Item>();
  const kids = new Map<string, Item[]>();
  for (const it of (items ?? []) as Item[]) {
    if (!it || it.is_deleted) continue;
    const id = String(it.id);
    byId.set(id, it);
    if (it.ref_item_id) {
      const pid = String(it.ref_item_id);
      const arr = kids.get(pid) ?? [];
      arr.push(it);
      kids.set(pid, arr);
    }
  }
  const ratioOf = (it: Item): number => {
    const r = Number(it.ratio);
    return r > 0 && isFinite(r) ? r : 0;
  };
  const queue = [...out.keys()];
  while (queue.length) {
    const id = queue.shift() as string;
    const cost = out.get(id);
    if (cost == null) continue;
    const cur = byId.get(id);
    if (!cur) continue;
    for (const child of kids.get(id) ?? []) {
      const cid = String(child.id);
      if (out.has(cid)) continue;
      const r = ratioOf(child);
      if (!(r > 0)) continue;
      out.set(cid, cost * r);
      queue.push(cid);
    }
    const pid = cur.ref_item_id ? String(cur.ref_item_id) : "";
    if (pid && !out.has(pid) && byId.has(pid)) {
      const r = ratioOf(cur);
      if (!(r > 0)) continue;
      out.set(pid, cost / r);
      queue.push(pid);
    }
  }
  return out;
}

/** Spread successive cost sources over one product chain, strongest first:
 *  whatever is already resolved seeds the next pass, so a weaker source can
 *  only ever fill a hole — never overwrite a purchase. */
function chainInLayers(items: Item[], layers: Map<string, number>[]): Map<string, number> {
  let acc = new Map<string, number>();
  for (const layer of layers) {
    const seeds = new Map(acc);
    for (const [id, c] of layer) {
      const v = Number(c);
      const key = String(id);
      if (v > 0 && !seeds.has(key)) seeds.set(key, v);
    }
    acc = chainItemCosts(items, seeds);
  }
  return acc;
}

/** What the product's containers cost, derived — no stored values read:
 *  own received batches first, then supplier quotes where a purchase never
 *  landed, each spread by the ratio chain across every item of the product. */
export function deriveItemCosts(
  items: Item[], batches: Batch[], costRows: SupplierCostRow[]
): Map<string, number> {
  return chainInLayers(items, [itemUnitCosts(batches), quoteItemRates(costRows)]);
}

/**
 * The cost map everything reads (analytics and persistence): batches, then
 * supplier quotes, then a cost the owner typed by hand (items.cost) — the
 * ratio chain carries whichever source reaches furthest. A weaker source only
 * fills what stronger ones left unknown, so a real purchase always beats a
 * stale quote and a product nobody has bought still prices every container.
 */
export function itemCostsFor(
  items: Item[], batches: Batch[], costRows: SupplierCostRow[]
): Map<string, number> {
  const stored = new Map<string, number>();
  for (const it of (items ?? []) as any[]) {
    const v = Number(it?.cost ?? 0);
    if (v > 0) stored.set(String(it?.id ?? ""), v);
  }
  return chainInLayers(items, [itemUnitCosts(batches), quoteItemRates(costRows), stored]);
}

/** A sale line's cost: quantity (in the line's own unit) × that unit-item's
 *  own rate (see itemCostsFor). Missing unit_id or an item with no cost
 *  anywhere → unknown (0), never a fallback borrowed from another product. */
export function lineCost(l: any, unitCostByItem: Map<string, number>): number {
  const c = unitCostByItem.get(String(l?.unit_id ?? "")) ?? 0;
  if (!(c > 0)) return 0;
  return c * Number(l?.quantity ?? 0);
}

/** Is this line's cost KNOWN? Only when its own item has a rate — no
 *  cost_price, no blended substitute. */
export function lineCovered(l: any, unitCostByItem: Map<string, number>): boolean {
  const c = unitCostByItem.get(String(l?.unit_id ?? ""));
  return c != null && c > 0;
}

/** Coverage over the line's OWN item: a line counts as known only when its
 *  unit_id has a batch-derived rate. */
export function lineCoverage(lines: any[], unitCostByItem: Map<string, number>): CostCoverage {
  let total = 0;
  let withCost = 0;
  for (const l of lines) {
    total += 1;
    if (lineCovered(l, unitCostByItem)) withCost += 1;
  }
  return { total, withCost, pct: total > 0 ? (withCost / total) * 100 : 0 };
}

/** A line's own revenue: line_total, else quantity × unit_price. */
export function lineRevenue(l: any): number {
  const lt = Number(l?.line_total);
  if (!isNaN(lt)) return lt;
  return Number(l?.quantity ?? 0) * Number(l?.unit_price ?? 0);
}

// ── The reporting chain ─────────────────────────────────────────────────
// VARIANT is the base figure: variants are the actual sellable units (price
// from variant_prices, cost from the item the variant is built on). Items
// are NEVER a reporting dimension — they only feed a variant's cost, which
// is what later lets markup be advised when prices are set. The two chains
// are plain sums, never flat or blended:
//   profit: variant → product → category
//   volume: variant → product → category

/** Every reporting row at every level: same fields, same maths. */
export type MetricRow = {
  id: string;
  name: string;
  /** Units sold (base figure at variant level, summed above it). */
  qty: number;
  /** Line revenue of everything sold here — costed or not. */
  revenue: number;
  /** Only the revenue whose cost is known may claim profit. */
  coveredRevenue: number;
  cost: number;
  /** coveredRevenue − cost. */
  profit: number;
  /** profit as a % of coveredRevenue. */
  margin: number;
  lines: number;
  withCost: number;
  coverage: CostCoverage;
};

export type VariantMetric = MetricRow & {
  /** Catalog variant id; null = legacy line no catalog variant claims. */
  variantId: string | null;
  /** The item this variant is built on — the ONLY cost source. */
  itemId: string;
  productId: string;
  productName: string;
};
export type ProductMetric = MetricRow & { productId: string };
export type CategoryMetric = MetricRow & { categoryId: string };

export type ResolvedVariant = {
  key: string;
  variantId: string | null;
  name: string;
  itemId: string;
  productId: string;
};

export type VariantIndex = {
  resolve(l: any): ResolvedVariant;
  /** Display label for an item (cost source), "" when unknown. */
  itemName(itemId: string): string;
};

// Mirrors pricing.DEFAULT_VARIANT — kept literal so this module stays
// importable without pulling the storage layer into tests.
const DEFAULT_VARIANT = "Regular";
const normName = (v: any) => String(v ?? "").trim().toLowerCase();

/**
 * Map a sale line to the variant it sold. Resolution order:
 *  1. a live variant of the line's OWN unit (unit_id = item id) with the
 *     line's variant name — the normal POS path;
 *  2. a unique same-named variant among the product's variants;
 *  3. nothing catalogued — a legacy line keeps its own unit as identity,
 *     so its volume still counts (cost likely unknown → hidden from
 *     profit rankings by the coverage filter).
 * A resolved variant's item_id is the cost source, never the line's own
 * unit_id when those disagree.
 */
export function variantIndex(cat: { items?: any[]; variants?: any[] }): VariantIndex {
  const items = (cat.items ?? []).filter((i: any) => !i?.is_deleted);
  const itemById = new Map<string, any>(items.map((i: any) => [String(i.id), i]));
  const byItemName = new Map<string, any>();
  const byProduct = new Map<string, any[]>();
  for (const v of (cat.variants ?? []) as any[]) {
    if (!v || v.is_deleted) continue;
    const it = itemById.get(String(v.item_id));
    if (!it) continue; // variant whose item is gone → nothing costable behind it
    byItemName.set(`${String(v.item_id)}|${normName(v.name)}`, v);
    const pid = String(it.product_id);
    const arr = byProduct.get(pid) ?? [];
    arr.push(v);
    byProduct.set(pid, arr);
  }
  const toResolved = (v: any, lineProductId: string): ResolvedVariant => {
    const it = itemById.get(String(v.item_id));
    return {
      key: String(v.id),
      variantId: String(v.id),
      name: String(v.name),
      itemId: String(v.item_id),
      productId: it ? String(it.product_id) : lineProductId,
    };
  };
  return {
    resolve(l: any): ResolvedVariant {
      const productId = String(l?.product_id ?? "");
      const unitId = String(l?.unit_id ?? "");
      const name = String(l?.variant ?? "").trim() || DEFAULT_VARIANT;
      const direct = byItemName.get(`${unitId}|${normName(name)}`);
      if (direct) return toResolved(direct, productId);
      const cands = (byProduct.get(productId) ?? []).filter(v => normName(v.name) === normName(name));
      if (cands.length === 1) return toResolved(cands[0], productId);
      return {
        key: `${productId || "no-product"}|${unitId || "no-unit"}|${name}`,
        variantId: null,
        name,
        itemId: unitId,
        productId,
      };
    },
    itemName(itemId: string): string {
      return String(itemById.get(String(itemId))?.name ?? "");
    },
  };
}

const EMPTY_INDEX: VariantIndex = variantIndex({ items: [], variants: [] });

/** Base figures — one row per variant actually sold in the window. Cost per
 *  line = quantity × the batch-derived rate of the variant's OWN item (item
 *  cost feeds variant profit; an item never becomes a row itself). */
export function metricsByVariant(
  sales: any[],
  lines: any[],
  unitCostByItem: Map<string, number>,
  vi: VariantIndex
): VariantMetric[] {
  const saleIds = new Set(sales.map(s => String(s?.id)));
  type Agg = {
    rv: ResolvedVariant; productName: string;
    qty: number; revenue: number; coveredRevenue: number; cost: number;
    lines: number; withCost: number;
  };
  const groups = new Map<string, Agg>();
  for (const l of lines) {
    if (!saleIds.has(String(l?.sale_id))) continue;
    const rv = vi.resolve(l);
    const g = groups.get(rv.key) ?? {
      rv, productName: "", qty: 0, revenue: 0, coveredRevenue: 0, cost: 0, lines: 0, withCost: 0,
    };
    if (l?.product_name) g.productName = String(l.product_name);
    const lr = lineRevenue(l);
    const rate = unitCostByItem.get(rv.itemId) ?? 0;
    g.qty += Number(l?.quantity ?? 0);
    g.revenue += lr;
    g.lines += 1;
    if (rate > 0) {
      g.coveredRevenue += lr;
      g.withCost += 1;
      g.cost += rate * Number(l?.quantity ?? 0);
    }
    groups.set(rv.key, g);
  }
  const rows: VariantMetric[] = [];
  for (const [key, g] of groups) {
    const profit = g.coveredRevenue - g.cost;
    rows.push({
      id: key,
      name: g.rv.name,
      variantId: g.rv.variantId,
      itemId: g.rv.itemId,
      productId: g.rv.productId,
      productName: g.productName,
      qty: g.qty,
      revenue: g.revenue,
      coveredRevenue: g.coveredRevenue,
      cost: g.cost,
      profit,
      margin: g.coveredRevenue > 0 ? (profit / g.coveredRevenue) * 100 : 0,
      lines: g.lines,
      withCost: g.withCost,
      coverage: { withCost: g.withCost, total: g.lines, pct: g.lines > 0 ? (g.withCost / g.lines) * 100 : 0 },
    });
  }
  // A variant's identity on screen is the app-wide "{item} {product} {variant}"
  // (spaces, standard variant dropped) — the item comes first so two variants
  // that share a bare name ("Glase" on Kès and on Boutèy) stay apart.
  for (const r of rows) {
    const variantName = r.name;
    r.name = formatCheckoutRow(vi.itemName(r.itemId) || r.itemId, r.productName, variantName);
  }
  rows.sort((a, b) => b.qty - a.qty);
  return rows;
}

/** Chain step 1: product profit/volume = the plain sum of its variants'. */
export function metricsByProduct(variantRows: VariantMetric[], products?: any[]): ProductMetric[] {
  const nameOf = new Map((products ?? []).map(p => [String(p.id), String(p.name ?? p.id)]));
  type Agg = { productName: string; qty: number; revenue: number; coveredRevenue: number; cost: number; lines: number; withCost: number };
  const groups = new Map<string, Agg>();
  for (const r of variantRows) {
    const g = groups.get(r.productId) ?? { productName: "", qty: 0, revenue: 0, coveredRevenue: 0, cost: 0, lines: 0, withCost: 0 };
    if (r.productName) g.productName = r.productName;
    g.qty += r.qty;
    g.revenue += r.revenue;
    g.coveredRevenue += r.coveredRevenue;
    g.cost += r.cost;
    g.lines += r.lines;
    g.withCost += r.withCost;
    groups.set(r.productId, g);
  }
  const rows: ProductMetric[] = [];
  for (const [productId, g] of groups) {
    const profit = g.coveredRevenue - g.cost;
    rows.push({
      id: productId,
      productId,
      name: nameOf.get(productId) || g.productName || productId,
      qty: g.qty,
      revenue: g.revenue,
      coveredRevenue: g.coveredRevenue,
      cost: g.cost,
      profit,
      margin: g.coveredRevenue > 0 ? (profit / g.coveredRevenue) * 100 : 0,
      lines: g.lines,
      withCost: g.withCost,
      coverage: { withCost: g.withCost, total: g.lines, pct: g.lines > 0 ? (g.withCost / g.lines) * 100 : 0 },
    });
  }
  rows.sort((a, b) => b.qty - a.qty);
  return rows;
}

/** Chain step 2: category profit/volume = the plain sum of its products'.
 *  A product with no primary category lands in "Uncategorized". */
export function metricsByCategory(args: {
  productRows: ProductMetric[];
  byProduct: Map<string, string>;
  categoryNames: Map<string, string>;
}): CategoryMetric[] {
  type Agg = { qty: number; revenue: number; coveredRevenue: number; cost: number; lines: number; withCost: number };
  const groups = new Map<string, Agg>();
  for (const p of args.productRows) {
    const cid = args.byProduct.get(p.productId) ?? "";
    const g = groups.get(cid) ?? { qty: 0, revenue: 0, coveredRevenue: 0, cost: 0, lines: 0, withCost: 0 };
    g.qty += p.qty;
    g.revenue += p.revenue;
    g.coveredRevenue += p.coveredRevenue;
    g.cost += p.cost;
    g.lines += p.lines;
    g.withCost += p.withCost;
    groups.set(cid, g);
  }
  const rows: CategoryMetric[] = [];
  for (const [categoryId, g] of groups) {
    const profit = g.coveredRevenue - g.cost;
    rows.push({
      id: categoryId,
      categoryId,
      name: categoryId ? args.categoryNames.get(categoryId) || "Category" : "Uncategorized",
      qty: g.qty,
      revenue: g.revenue,
      coveredRevenue: g.coveredRevenue,
      cost: g.cost,
      profit,
      margin: g.coveredRevenue > 0 ? (profit / g.coveredRevenue) * 100 : 0,
      lines: g.lines,
      withCost: g.withCost,
      coverage: { withCost: g.withCost, total: g.lines, pct: g.lines > 0 ? (g.withCost / g.lines) * 100 : 0 },
    });
  }
  rows.sort((a, b) => b.revenue - a.revenue);
  return rows;
}

export type ProfitTotals = {
  /** Total sales revenue in the window — every sale, costed or not. */
  revenue: number;
  /** The revenue a profit claim may rest on: total revenue minus the
   *  revenue of lines (and sales) that have NO cost data. */
  coveredRevenue: number;
  cost: number;
  /** coveredRevenue − cost: lines without cost data claim no profit, so
   *  partial coverage can never masquerade as a ~100% margin. */
  profit: number;
  /** Profit as a % of coveredRevenue (never of un-costed revenue). */
  margin: number;
  coverage: CostCoverage;
};

/** Window headline, built FROM the variant chain (variant sums = product
 *  sums = category sums): the same covered-revenue rule, now with each
 *  line's cost taken from the item its variant is built on. Sales with no
 *  lines claim no profit; coverage ships so the UI can show "—". */
export function profitTotals(
  sales: any[],
  lines: any[],
  unitCostByItem: Map<string, number>,
  vi: VariantIndex = EMPTY_INDEX
): ProfitTotals {
  const ids = new Set(sales.map(s => String(s?.id)));
  const revenue = sales.reduce((a, s) => a + saleAmount(s), 0);
  const inScope = lines.filter(l => ids.has(String(l?.sale_id)));
  const saleWithLines = new Set(inScope.map(l => String(l?.sale_id)));
  let lineless = 0;
  for (const s of sales) {
    if (!saleWithLines.has(String(s?.id))) lineless += saleAmount(s);
  }
  const rows = metricsByVariant(sales, lines, unitCostByItem, vi);
  let lineRev = 0;
  let coveredLineRev = 0;
  let cost = 0;
  let linesTotal = 0;
  let withCost = 0;
  for (const r of rows) {
    lineRev += r.revenue;
    coveredLineRev += r.coveredRevenue;
    cost += r.cost;
    linesTotal += r.lines;
    withCost += r.withCost;
  }
  // Unknown-cost revenue = sales without lines + lines without a rate.
  const unknown = lineless + (lineRev - coveredLineRev);
  const coveredRevenue = Math.max(0, revenue - unknown);
  const profit = coveredRevenue - cost;
  return {
    revenue,
    coveredRevenue,
    cost,
    profit,
    margin: coveredRevenue > 0 ? (profit / coveredRevenue) * 100 : 0,
    coverage: {
      withCost,
      total: linesTotal,
      pct: linesTotal > 0 ? (withCost / linesTotal) * 100 : 0,
    },
  };
}

export type PrimaryCategory = { byProduct: Map<string, string>; names: Map<string, string> };

/** A product rolls up under exactly ONE category — its first by sort_order
 *  (id breaks ties) so multi-category products are never double-counted. */
export function primaryCategoryByProduct(productCategories: any[], categories: any[]): PrimaryCategory {
  const order = new Map<string, number>();
  const names = new Map<string, string>();
  for (const c of categories ?? []) {
    if (c?.is_deleted) continue;
    order.set(String(c.id), Number(c.sort_order ?? 0));
    names.set(String(c.id), String(c.name ?? ""));
  }
  const best = new Map<string, { id: string; ord: number }>();
  for (const pc of productCategories ?? []) {
    const pid = String(pc?.product_id);
    const cid = String(pc?.category_id);
    const ord = order.get(cid);
    if (ord === undefined) continue; // category gone → uncategorized
    const cur = best.get(pid);
    if (!cur || ord < cur.ord || (ord === cur.ord && cid < cur.id)) best.set(pid, { id: cid, ord });
  }
  const byProduct = new Map<string, string>();
  for (const [pid, c] of best) byProduct.set(pid, c.id);
  return { byProduct, names };
}

/** Rows a margin/contribution ranking may show: at least one line with a real
 *  batch-derived cost. A zero-coverage row has no costed revenue at all, so
 *  its profit/margin would be 0-of-nothing — dropped entirely rather than
 *  printed as a confident figure. */
export function costCoveredRows<T extends { coverage: CostCoverage }>(rows: T[]): T[] {
  return rows.filter(r => r.coverage.withCost > 0);
}

export type ProfitContribution = MetricRow & { share: number };

/** Profit-contribution ranking (profit desc) — works on ANY level of the
 *  chain (variant rows, product rows, category rows). Share is of the
 *  POSITIVE profit mass, so a loss-making row can never push another past
 *  100%. */
export function profitContribution(rows: MetricRow[]): ProfitContribution[] {
  const positive = rows.reduce((a, r) => a + Math.max(0, r.profit), 0);
  return rows
    .map(r => ({ ...r, share: positive > 0 && r.profit > 0 ? (r.profit / positive) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit);
}

export type CostPoint = { date: string; unitCost: number };
export type CostVerdict = "up" | "down" | "steady" | "none";
export type CostTrend = { points: CostPoint[]; verdict: CostVerdict; deltaPct: number | null };

/** Unit-cost history for ONE item from its own received batches: each date's
 *  point is Σ total_paid / Σ quantity for that item alone. Items recorded in
 *  the same batch session stay separate — their money and quantities are
 *  never pooled. Verdict compares first → last: |Δ| ≥ 2 points is up/down,
 *  below that is steady. */
export function costTrendForItem(batches: Batch[], itemId: string): CostTrend {
  const byDate = new Map<string, { paid: number; qty: number }>();
  for (const b of batches as any[]) {
    if (!b || b.is_deleted) continue;
    if (String(b.status ?? "") !== "received") continue;
    if (String(b.item_id) !== itemId) continue;
    const qty = Number(b.quantity ?? 0);
    const date = String(b.date ?? "");
    if (!(qty > 0) || !date) continue;
    const g = byDate.get(date) ?? { paid: 0, qty: 0 };
    g.paid += Number(b.total_paid ?? 0);
    g.qty += qty;
    byDate.set(date, g);
  }

  const points: CostPoint[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, g]) => ({ date, unitCost: g.qty > 0 ? g.paid / g.qty : 0 }));

  if (points.length < 2 || !(points[0].unitCost > 0)) {
    return { points, verdict: "none", deltaPct: null };
  }
  const first = points[0].unitCost;
  const last = points[points.length - 1].unitCost;
  const deltaPct = ((last - first) / first) * 100;
  const verdict: CostVerdict = deltaPct >= 2 ? "up" : deltaPct <= -2 ? "down" : "steady";
  return { points, verdict, deltaPct };
}

export type SupplierRec = CostRecommendation & { productId: string; productName: string };
export type SupplierGroup = {
  supplierId: string;
  supplierName: string;
  lines: number;
  recommendations: SupplierRec[];
  stale: number;
  skipped: number;
  /** Sum of per-unit savings (lines are quoted at qty 1 — see below). */
  saving: number;
};

/** Latest RECEIVED batch per product (across its items), by date then created. */
export function latestBatchByProduct(batches: Batch[], allItems: Item[]): Map<string, Batch> {
  const productOfItem = new Map<string, string>();
  for (const it of allItems ?? []) productOfItem.set(String(it.id), String(it.product_id));
  const best = new Map<string, Batch>();
  const key = (b: any) => `${String(b.date ?? "")} ${String(b.created_at ?? "")}`;
  for (const b of batches as any[]) {
    if (!b || b.is_deleted) continue;
    if (String(b.status ?? "") !== "received") continue;
    const pid = productOfItem.get(String(b.item_id));
    if (!pid) continue;
    const cur = best.get(pid) as any;
    if (!cur || key(b) > key(cur)) best.set(pid, b);
  }
  return best;
}

/**
 * Supplier cost comparison: group stocked products by the supplier we last
 * bought them through, then run the batch wizard's own comparison engine per
 * group (same 5% threshold, same 30-day freshness fade — nothing redefined).
 * Lines are quoted at qty 1 so savings read per item-unit; stock counts are
 * canonical units and would not match the item-level cost rows.
 */
export function supplierComparison(args: {
  products: any[];
  allItems: Item[];
  batches: Batch[];
  costRows: SupplierCostRow[];
  productSuppliers: { product_id: string; supplier_id: string }[];
  suppliers: { id: string; name: string }[];
  now?: string;
}): SupplierGroup[] {
  const latest = latestBatchByProduct(args.batches, args.allItems);
  // Current cost per line = that item's OWN cost (its batch rate, else its
  // quote, else the chain from a sibling) — never the latest batch alone
  // pooled with siblings, never a catalog average.
  const costOfItem = itemCostsFor(args.allItems, args.batches, args.costRows);
  const nameOfProduct = new Map(args.products.map(p => [String(p.id), String(p.name ?? p.id)]));
  const nameOfSupplier = new Map(args.suppliers.map(s => [String(s.id), String(s.name ?? "")]));

  // Latest purchase per (item, supplier) — the engine's freshness re-check.
  const seen = new Map<string, string>();
  for (const b of args.batches as any[]) {
    if (!b || b.is_deleted || String(b.status ?? "") !== "received") continue;
    const date = String(b.date ?? "");
    if (!date) continue;
    const k = `${String(b.item_id)}|${String(b.supplier_id)}`;
    const cur = seen.get(k);
    if (!cur || date > cur) seen.set(k, date);
  }
  const lastPurchases = [...seen.entries()].map(([k, date]) => {
    const i = k.indexOf("|");
    return { itemId: k.slice(0, i), supplierId: k.slice(i + 1), date };
  });

  const groups = new Map<string, CompareLine[]>();
  const productOfLine = new Map<string, string>();
  for (const p of args.products) {
    if (p?.is_deleted) continue;
    if (!(Number(p.stock_quantity ?? 0) > 0)) continue; // stocked only
    const b = latest.get(String(p.id));
    if (!b || !(Number(b.quantity ?? 0) > 0)) continue;
    const supplierId = String(b.supplier_id ?? "");
    if (!supplierId) continue;
    const line: CompareLine = {
      itemId: String(b.item_id),
      productId: String(p.id),
      qty: 1,
      unitCost: costOfItem.get(String(b.item_id)) ?? (Number(b.quantity ?? 0) > 0 ? Number(b.total_paid ?? 0) / Number(b.quantity) : 0),
    };
    productOfLine.set(line.itemId, line.productId);
    const g = groups.get(supplierId) ?? [];
    g.push(line);
    groups.set(supplierId, g);
  }

  const out: SupplierGroup[] = [];
  for (const [supplierId, lines] of groups) {
    const res = evaluateBatchCosts({
      lines,
      chosenSupplierId: supplierId,
      costRows: args.costRows,
      productSuppliers: args.productSuppliers,
      suppliers: args.suppliers,
      lastPurchases,
      now: args.now,
    });
    const recommendations: SupplierRec[] = res.recommendations.map(r => {
      const productId = productOfLine.get(r.itemId) ?? "";
      return { ...r, productId, productName: nameOfProduct.get(productId) ?? "" };
    });
    out.push({
      supplierId,
      supplierName: nameOfSupplier.get(supplierId) || "Supplier",
      lines: lines.length,
      recommendations,
      stale: recommendations.filter(r => r.stale).length,
      skipped: res.skipped.length,
      saving: recommendations.reduce((a, r) => a + r.savingPerUnit, 0),
    });
  }
  out.sort((a, b) => b.saving - a.saving || b.lines - a.lines);
  return out;
}
