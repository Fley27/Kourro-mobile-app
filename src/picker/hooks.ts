import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Alert } from "react-native";
import { getUnitsForProduct, getPricesForUnit, getDefaultUnit, resolveLinePrice, type PricingMaps } from "../pricing";
import { normName } from "../screens/CatalogShared";
import type { Product, CartItem, PendingSel, PendingState, SaleRow, SaleGroup, PriceLine } from "../screens/POSShared";

// ---- Sale logic shared between checkout (POSScreen) and the Orders in-screen
// item picker. Extracted from POSScreen so one edit updates both flows. ----

// Services never clamp on stock (availability toggle decides).
// Canonical stock ÷ canonical factor (identical numbers for legacy chains).
export function maxQtyForP(minFactorMap: Map<string, number>, p: Product, factor: number): number {
  if (p.item_type === "service") return 999999;
  const minF = minFactorMap.get(p.id) ?? 1;
  const eff = (Number(factor) || 1) / (minF > 0 ? minF : 1);
  return Math.max(0, Math.floor(Number(p.stock_quantity ?? 0) / eff));
}

// ---- Multi-variant pricing (bound to pricing maps) ----
export function makePricing(pricing: PricingMaps, minFactorMap: Map<string, number>) {
  function legacySel(p: Product): PendingSel {
    return { unitId: "", unitName: p.unit ?? "pcs", factor: 1, variant: "Regular" };
  }
  function defaultSelFor(p: Product): PendingSel {
    const units = getUnitsForProduct(pricing, p.id).filter(u => getPricesForUnit(pricing, u.id).some(r => Number(r.price) > 0));
    const u = getDefaultUnit(units);
    if (!u) return legacySel(p);
    const rows = getPricesForUnit(pricing, u.id).filter(r => Number(r.price) > 0);
    const v = rows.find(r => r.variant === "Regular") ?? rows[0];
    return { unitId: u.id, unitName: u.unit_name, factor: Number(u.conversion_factor) || 1, variant: v?.variant ?? "Regular" };
  }
  function maxQtyFor(p: Product, factor: number): number {
    return maxQtyForP(minFactorMap, p, factor);
  }
  function priceFor(p: Product, sel: PendingSel, qty: number, frozenBase?: number) {
    if (!sel.unitId) {
      const up = frozenBase != null && !isNaN(frozenBase) ? Number(frozenBase) : Number(p.selling_price ?? 0) || 0;
      const lineTotal = Math.round(up * Math.max(0, qty) * 100) / 100;
      return { unitPrice: up, lineTotal, bundleApplied: false };
    }
    return resolveLinePrice(pricing, sel.unitId, sel.variant, qty, frozenBase);
  }
  function cartKey(productId: string, sel: PendingSel): string {
    return `${productId}|${sel.unitId || "base"}|${sel.variant}`;
  }
  function repriceLine(x: CartItem, qty: number): Pick<CartItem, "qty" | "unitPrice" | "lineTotal" | "bundleApplied"> {
    const pr = priceFor(x, { unitId: x.unitId, unitName: x.unitName, factor: x.factor, variant: x.variant }, qty, x.frozenBase);
    return { qty, unitPrice: pr.unitPrice, lineTotal: pr.lineTotal, bundleApplied: pr.bundleApplied };
  }
  function mergeLine(prev: CartItem[], product: Product, sel: PendingSel, addQty: number): CartItem[] {
    const key = cartKey(product.id, sel);
    const maxQ = maxQtyFor(product, sel.factor);
    const safeAdd = Math.max(0, Math.min(Math.max(1, Math.floor(addQty)), Math.max(0, maxQ)));
    if (safeAdd <= 0) { Alert.alert("Stòk ensifizan", `Rete sèlman ${product.stock_quantity} nan stòk`); return prev; }
    const ex = prev.find(x => x.key === key);
    if (ex) {
      const newQty = Math.min(ex.qty + safeAdd, Math.max(1, maxQ));
      if (newQty <= ex.qty) { Alert.alert("Stòk ensifizan", `Rete sèlman ${product.stock_quantity} nan stòk`); return prev; }
      return prev.map(x => x.key === key ? { ...x, ...repriceLine(x, newQty) } : x);
    }
    const pr = priceFor(product, sel, safeAdd);
    return [...prev, { ...product, key, qty: safeAdd, unitId: sel.unitId, unitName: sel.unitName, factor: sel.factor, variant: sel.variant, unitPrice: pr.unitPrice, lineTotal: pr.lineTotal, bundleApplied: pr.bundleApplied }];
  }
  return { legacySel, defaultSelFor, maxQtyFor, priceFor, cartKey, repriceLine, mergeLine };
}

// ---- Sales list: one row per priced variant (unit × variant). Legacy
// products without pricing rows fall back to a single selling-price row.
// `variantSales` (key → 30-day units sold) stamps each row's trend count. ----
export function computeSaleRows(
  products: Product[],
  pricing: PricingMaps,
  minFactorMap: Map<string, number>,
  catNames: Record<string, string>,
  search: string,
  variantSales?: Map<string, number>,
): SaleRow[] {
  const rows: SaleRow[] = [];
  for (const p of products) {
    const units = getUnitsForProduct(pricing, p.id);
    const priced = units
      .map(u => ({ u, rs: getPricesForUnit(pricing, u.id).filter(r => Number(r.price) > 0) }))
      .filter(x => x.rs.length);
    if (!priced.length) {
      const legacy = Number(p.selling_price ?? 0) || 0;
      if (legacy > 0) {
        rows.push({
          key: `${p.id}|base|Regular`, product: p, unitId: "", unitName: p.unit ?? "pcs",
          factor: 1, variant: "Regular", price: legacy, maxQ: maxQtyForP(minFactorMap, p, 1),
          variantCountForItem: 1, isTop: (p.sales_count ?? 0) >= 90,
          salesQty: variantSales?.get(`${p.id}|base|Regular`) ?? 0,
        });
      }
      continue;
    }
    for (const { u, rs } of priced) {
      const factor = Number(u.conversion_factor) || 1;
      const maxQ = maxQtyForP(minFactorMap, p, factor);
      for (const r of rs) {
        rows.push({
          key: `${p.id}|${u.id}|${r.variant}`, product: p, unitId: u.id,
          unitName: u.unit_name, factor, variant: r.variant, price: Number(r.price) || 0,
          maxQ, variantCountForItem: rs.length, isTop: (p.sales_count ?? 0) >= 90,
          salesQty: variantSales?.get(`${p.id}|${u.id}|${r.variant}`) ?? 0,
        });
      }
    }
  }
  const outRank = (r: SaleRow) => {
    const p = r.product;
    if (p.item_type === "service") return (p.is_available !== 0 && (p.is_available as any) !== false) ? 0 : 1;
    return r.maxQ <= 0 ? 1 : 0; // out-of-stock rows to bottom
  };
  const byStockThenRank = (a: SaleRow, b: SaleRow) => {
    const ra = outRank(a), rb = outRank(b);
    if (ra !== rb) return ra - rb;
    return (b.product.sales_count ?? 0) - (a.product.sales_count ?? 0);
  };
  const q = normName(search.trim());
  if (!q) return rows.sort(byStockThenRank);
  // Unified search: name, Kreyòl name, barcode/SKU, category, variant, unit.
  const list = rows.filter(r => {
    const p = r.product;
    if (normName(p.barcode ?? "") === q || normName(p.sku ?? "") === q) return true;
    if (normName(p.name).includes(q) || normName(p.name_ht ?? "").includes(q)) return true;
    if (normName(p.barcode ?? "").includes(q) || normName(p.sku ?? "").includes(q)) return true;
    const cat = catNames[String(p.category_id ?? "")] ?? "";
    if (normName(cat).includes(q)) return true;
    if (normName(r.variant).includes(q) || normName(r.unitName).includes(q)) return true;
    return false;
  });
  return list.sort(byStockThenRank);
}

export function useSaleRows(opts: {
  products: Product[];
  pricing: PricingMaps;
  minFactorMap: Map<string, number>;
  catNames: Record<string, string>;
  search: string;
  variantSales?: Map<string, number>;
}): SaleRow[] {
  const { products, pricing, minFactorMap, catNames, search, variantSales } = opts;
  return useMemo(
    () => computeSaleRows(products, pricing, minFactorMap, catNames, search, variantSales),
    [products, pricing, minFactorMap, catNames, search, variantSales],
  );
}

// ---- Group the flat variant list by product for the grouped checkout card:
// identity once in the header, variants as sub-rows. Group order follows the
// list's existing rank (out-of-stock last); inside a group: in-stock first,
// smallest factor first, best-seller (30-day) marked as bestKey. ----
export function groupSaleRows(rows: SaleRow[], catNames: Record<string, string> = {}): SaleGroup[] {
  const groups: SaleGroup[] = [];
  const byProduct = new Map<string, SaleGroup>();
  for (const r of rows) {
    let g = byProduct.get(r.product.id);
    if (!g) {
      g = {
        product: r.product,
        categoryName: catNames[String(r.product.category_id ?? "")] ?? "",
        rows: [],
        variantCount: 0,
        bestKey: null,
      };
      byProduct.set(r.product.id, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  for (const g of groups) {
    g.variantCount = g.rows.length;
    // Mirrors computeSaleRows' outRank: unavailable/out-of-stock last.
    const outRank = (r: SaleRow) => {
      const p = r.product;
      if (p.item_type === "service") return (p.is_available !== 0 && (p.is_available as any) !== false) ? 0 : 1;
      return r.maxQ <= 0 ? 1 : 0;
    };
    g.rows.sort((a, b) => {
      const ra = outRank(a), rb = outRank(b);
      if (ra !== rb) return ra - rb;
      if (a.factor !== b.factor) return a.factor - b.factor;
      return a.variant.localeCompare(b.variant);
    });
    let best: SaleRow | null = null;
    for (const r of g.rows) {
      if (r.salesQty > 0 && (!best || r.salesQty > best.salesQty)) best = r;
    }
    g.bestKey = best ? best.key : null;
  }
  return groups;
}

// ---- Pending line (tap → 10s hero countdown → commit). The committed line
// lands wherever onCommit puts it (checkout cart, order lines, …). ----
export function usePendingLine(opts: {
  pricing: PricingMaps;
  minFactorMap: Map<string, number>;
  onCommit: (product: Product, qty: number, sel: PendingSel) => void;
  onRowPress?: () => void;
}) {
  const { pricing, minFactorMap, onCommit, onRowPress } = opts;
  const { maxQtyFor, priceFor, defaultSelFor } = makePricing(pricing, minFactorMap);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [pendingInput, setPendingInput] = useState<string>("");
  const pendingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPending() {
    setPending(null);
    setPendingInput("");
  }

  function commitPending(product: Product, qty: number, sel?: PendingSel) {
    if (pendingTimer.current) { clearInterval(pendingTimer.current); pendingTimer.current = null; }
    const s = sel ?? (pending && pending.product.id === product.id
      ? { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }
      : defaultSelFor(product));
    onCommit(product, qty, s);
    setPending(null);
  }

  // The sales list shows variants: tapping a row pendings that exact
  // (unit, variant) — no chooser sheet, the choice IS the row.
  function handleProductPress(row: SaleRow) {
    onRowPress?.();
    const p = row.product;
    if (pending && pending.product.id === p.id && pending.unitId === row.unitId && pending.variant === row.variant) {
      const maxQ = Math.max(1, maxQtyFor(p, pending.factor));
      const next = Math.min(pending.qty + 1, maxQ);
      setPending({ ...pending, qty: next, remaining: 10 });
      setPendingInput("");
      return;
    }
    if (pending) {
      commitPending(pending.product, pending.qty, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant });
    }
    setPending({ product: p, qty: 1, remaining: 10, unitId: row.unitId, unitName: row.unitName, factor: row.factor, variant: row.variant });
    setPendingInput("");
  }

  function adjustPending(delta: number) {
    if (!pending) return;
    const next = pending.qty + delta;
    if (next <= 0) {
      Alert.alert("Anile pwodwi?", `Kantite 0 — vle anile "${pending.product.name}"? Sa p ap afekte pwodwi ki deja nan panyen an.`, [
        { text: "Kenbe", style: "cancel", onPress: () => setPending({ ...pending, remaining: 10 }) },
        { text: "Anile", style: "destructive", onPress: () => { setPending(null); setPendingInput(""); } },
      ]);
      return;
    }
    const maxQ = Math.max(1, maxQtyFor(pending.product, pending.factor));
    const clamped = Math.max(1, Math.min(next, maxQ));
    setPending({ ...pending, qty: clamped, remaining: 10 });
    setPendingInput("");
  }

  function setPendingCustom(val: string) {
    if (!pending) return;
    setPendingInput(val);
    if (!val.trim()) return; // keep placeholder
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    if (n === 0) {
      Alert.alert("Anile pwodwi?", `Kantite 0 — vle anile "${pending.product.name}"? Sa p ap afekte pwodwi ki deja nan panyen an.`, [
        { text: "Kenbe", style: "cancel", onPress: () => { setPendingInput(""); setPending({ ...pending, remaining: 10 }); } },
        { text: "Anile", style: "destructive", onPress: () => { setPending(null); setPendingInput(""); } },
      ]);
      return;
    }
    if (n < 0) return;
    const maxQ = Math.max(1, maxQtyFor(pending.product, pending.factor));
    const clamped = Math.max(1, Math.min(n, maxQ));
    setPending({ ...pending, qty: clamped, remaining: 10 });
  }

  function commitPendingWithInput() {
    if (!pending) {
      Alert.alert("Pa gen pwodwi", "Tape yon pwodwi anvan ou ajoute nan panyen");
      return;
    }
    const raw = pendingInput.trim();
    const parsed = raw ? parseInt(raw, 10) : NaN;
    const maxQ = Math.max(1, maxQtyFor(pending.product, pending.factor));
    const qtyToAdd = !isNaN(parsed) && parsed > 0 ? Math.max(1, Math.min(parsed, maxQ)) : pending.qty;
    if (qtyToAdd > maxQ) {
      Alert.alert("Stòk ensifizan", `Rete sèlman ${pending.product.stock_quantity} nan stòk`);
      return;
    }
    commitPending(pending.product, qtyToAdd, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant });
    setPendingInput("");
  }

  // 10s countdown for pending
  useEffect(() => {
    if (!pending) {
      if (pendingTimer.current) { clearInterval(pendingTimer.current); pendingTimer.current = null; }
      return;
    }
    pendingTimer.current = setInterval(() => {
      setPending(prev => {
        if (!prev) return null;
        if (prev.remaining <= 1) {
          // auto-add
          commitPending(prev.product, prev.qty, { unitId: (prev as any).unitId ?? "", unitName: (prev as any).unitName ?? "pcs", factor: (prev as any).factor ?? 1, variant: (prev as any).variant ?? "Regular" });
          return null;
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);
    return () => { if (pendingTimer.current) clearInterval(pendingTimer.current); };
  }, [pending?.product.id]);

  const pendingLine: PriceLine | null = pending ? priceFor(pending.product, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }, pending.qty) : null;
  const pendingMaxQ = pending ? maxQtyFor(pending.product, pending.factor) : 0;

  return {
    pending, setPending, pendingInput, setPendingInput, pendingLine, pendingMaxQ,
    handleProductPress, adjustPending, setPendingCustom, commitPendingWithInput,
    commitPending, clearPending,
  };
}

// ---- Cart line quantity edits (dec/inc/remove/custom) with stock clamps ----
export function useCartLines(opts: {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  products: Product[];
  pricing: PricingMaps;
  minFactorMap: Map<string, number>;
}) {
  const { cart, setCart, products, pricing, minFactorMap } = opts;
  const { maxQtyFor, repriceLine } = makePricing(pricing, minFactorMap);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState<string>("");

  function decQty(key: string) {
    const item = cart.find(x => x.key === key);
    if (!item) return;
    if (item.qty <= 1) {
      Alert.alert("Retire pwodwi?", `Vle retire "${item.name}" nan panyen an?`, [
        { text: "Anile", style: "cancel" },
        { text: "Retire", style: "destructive", onPress: () => setCart(prev => prev.filter(x => x.key !== key)) },
      ]);
      return;
    }
    setCart(prev => prev.map(x => x.key === key ? { ...x, ...repriceLine(x, x.qty - 1) } : x));
  }
  function incQty(key: string) {
    const prod = products.find(p => p.id === cart.find(x => x.key === key)?.id);
    setCart(prev => {
      const ex = prev.find(x => x.key === key);
      if (!ex || !prod) return prev;
      if ((ex.qty + 1) * ex.factor > prod.stock_quantity) { Alert.alert("Stòk ensifizan"); return prev; }
      return prev.map(x => x.key === key ? { ...x, ...repriceLine(x, x.qty + 1) } : x);
    });
  }
  function removeFromCart(key: string) {
    const item = cart.find(x => x.key === key);
    Alert.alert("Retire pwodwi?", `Vle retire "${item?.name ?? ""}" nan panyen an?`, [
      { text: "Anile", style: "cancel" },
      { text: "Retire", style: "destructive", onPress: () => setCart(prev => prev.filter(x => x.key !== key)) },
    ]);
  }
  function setCustomQty(key: string, val: string) {
    // Placeholder behavior: empty keeps original (placeholder shows current)
    if (!val.trim()) { setEditingQtyVal(""); return; }
    const n = parseInt(val, 10);
    if (isNaN(n)) { setEditingQtyVal(val); return; }
    const item = cart.find(x => x.key === key);
    if (n === 0) {
      Alert.alert("Retire pwodwi?", `Kantite 0 — vle retire "${item?.name ?? ""}" nan panyen an?`, [
        { text: "Anile", style: "cancel", onPress: () => setEditingQtyVal("") },
        { text: "Retire", style: "destructive", onPress: () => { setCart(prev => prev.filter(x => x.key !== key)); setEditingQtyId(null); setEditingQtyVal(""); } },
      ]);
      return;
    }
    if (n < 0 || !item) { setEditingQtyVal(val); return; }
    const prod = products.find(p => p.id === item.id);
    const maxQ = Math.max(1, maxQtyFor(prod ?? item, item.factor));
    if (n > maxQ) { Alert.alert("Stòk ensifizan"); setEditingQtyVal(String(maxQ)); setCart(prev => prev.map(x => x.key === key ? { ...x, ...repriceLine(x, maxQ) } : x)); return; }
    setCart(prev => prev.map(x => x.key === key ? { ...x, ...repriceLine(x, n) } : x));
    setEditingQtyVal(val);
  }

  return { editingQtyId, setEditingQtyId, editingQtyVal, setEditingQtyVal, decQty, incQty, removeFromCart, setCustomQty };
}
