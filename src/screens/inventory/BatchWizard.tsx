// Batch creation wizard — Inventory → "+" (Nouvo livrezon).
//
// Four steps, in this order:
//   1. Supplier   — picked first so everything downstream can be scoped to it.
//   2. Items      — qty + purchase cost, filtered to what that supplier supplies.
//   3. Prices     — effective-dated variant prices (untouched = keep current).
//   4. Bundles    — optional bulk-price rules per variant.
// then a review sheet, and only then are batches written.
//
// Transport is deliberately absent here: it is asked ONCE at the end of the
// whole wizard run (several batches may be written by one run when a Split
// recommendation is accepted), and allocated across them — see InventoryScreen.
//
// Unfinished runs become device-local drafts (src/inventory/batchDraft.ts);
// they never reach the shared database.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, Pressable, TextInput, Alert, ScrollView,
  KeyboardAvoidingView, Platform, Modal, Keyboard, SafeAreaView, BackHandler,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox, recomputeItemCosts } from "../../db";
import type { Role } from "../../users";
import { fmtG, fmt, monoStyle } from "../../format";
import { radius, shadow } from "../../theme";
import { sheetBox } from "../../responsive";
import {
  loadPricing, getUnitsForProduct, getDefaultUnit, getDisplayPrice, type PricingMaps, type ProductUnit,
} from "../../pricing";
import {
  loadCatalogModel, currentVariantPrice, mergeV2Batch, upsertVariantPriceRow,
  upsertBundleRow, upsertSupplierCost, itemFactor, minItemFactor, toCanonicalQty,
  type Item, type Variant, type VariantPrice,
} from "../../catalogModel";
import { isGoods, statusForProduct, ProductCard, normName } from "../CatalogShared";
import { inv, todayStr, fs, paperPill } from "./inventoryTheme";
import { UploadTransition, type UploadPhase } from "../../components/UploadTransition";
import { compareBatchLines, type CostRecommendation } from "../../inventory/compareCost";
import {
  saveBatchDraft, loadBatchDraft, deleteBatchDraft,
  type BatchDraft, type BatchDraftStep, type DraftBubble,
} from "../../inventory/batchDraft";
import { MoneyInput } from "../../components/maskedInput";
import { itemCostsFor } from "../../analytics/metrics";
import { formatCheckoutRow } from "../../labels";

type Category = { id: string; name: string; icon: string; color: string };
type Product = {
  id: string; name: string; sku?: string; barcode?: string; category_id?: string;
  stock_quantity: number; low_stock_threshold: number; cost_price: number;
  selling_price?: number; unit?: string;
};
type InvBubble = {
  productId: string; name: string; sku?: string;
  unitId: string; unitName: string; factor: number; unit?: string;
  qty: number; costPrice: number;
};

type PriceRow = { variantId: string; variantName: string; current: number; value: string; unitRef: number };
type PriceGroup = { productId: string; productName: string; itemId: string; itemName: string; rows: PriceRow[] };
type BundleState = { on: boolean; min: string; price: string };
type ReviewLine = {
  itemId: string; productId: string; productName: string; itemName: string;
  qty: number; unitCost: number; lineTotal: number;
};

export type WizardSaved = { sessionRef: string; batchIds: string[]; summary: string };

export type BatchWizardProps = {
  role: Role;
  canInventory: boolean;
  canViewItemCost: boolean;
  products: Product[];
  categories: Category[];
  productCategories: { product_id: string; category_id: string }[];
  pricing: PricingMaps;
  costByProduct: Map<string, number>;
  batchItems: Item[];
  variants: Variant[];
  suppliers: { id: string; name: string }[];
  isTablet: boolean;
  width: number;
  padH: number;
  /** Opened from the Draft tag. */
  resumeDraftId?: string | null;
  /**
   * Parent's close handle (the "+" button). The wizard parks its own
   * requestClose here so closing from outside still saves the draft first.
   */
  closeRef?: { current: (() => void) | null } | null;
  onSaved: (info: WizardSaved) => void;
  onClose: () => void;
};

function errBox(msg: string) {
  if (!msg) return null;
  return (
    <View style={{ backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, borderRadius: 12, padding: 10 }}>
      <Text style={{ fontSize: fs(12), fontWeight: "600", color: inv.red }}>{msg}</Text>
    </View>
  );
}

export default function BatchWizard(props: BatchWizardProps) {
  const {
    role, canInventory, canViewItemCost, products, categories, productCategories,
    pricing, costByProduct, batchItems, variants, suppliers,
    isTablet, width, padH, resumeDraftId, closeRef, onSaved, onClose,
  } = props;

  const [step, setStep] = useState<BatchDraftStep>(1);
  const [bubbles, setBubbles] = useState<InvBubble[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [error, setError] = useState("");

  const [pickSearch, setPickSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<Set<string> | null>(null);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selUnitId, setSelUnitId] = useState("");
  const [inputQty, setInputQty] = useState("");
  const [inputTotal, setInputTotal] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showCart, setShowCart] = useState(false);

  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([]);
  // Transport (G) typed on step 3, spread across lines by weight at save.
  // In-memory only — a draft resume starts it blank.
  const [transport, setTransport] = useState("");
  const [bundleStates, setBundleStates] = useState<Record<string, BundleState>>({});
  // Variants this run creates (an item that had none gets a silent Standard),
  // plus the draft's working copy of step 3/4 input so moving between steps
  // never drops what was typed.
  const [madeVariants, setMadeVariants] = useState<Variant[]>([]);
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [draftBundles, setDraftBundles] = useState<BatchDraft["bundles"]>([]);

  const [showReview, setShowReview] = useState(false);
  const [recommendations, setRecommendations] = useState<CostRecommendation[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "split" | "keep">>({});

  const [busy, setBusy] = useState(false);

  const [draftId, setDraftId] = useState<string>(`draft-${Date.now().toString(36)}`);
  const [sessionRef, setSessionRef] = useState("");
  const [sessionBatchIds, setSessionBatchIds] = useState<string[]>([]);

  const [keyboardH, setKeyboardH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const supName = (id: string) => suppliers.find(s => s.id === id)?.name ?? "?";
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  // The parent's variant list only refreshes with its own reload, so overlay
  // the Standard rows ensureVariants just wrote for this run.
  const allVariants = useMemo(
    () => [...variants, ...madeVariants.filter(m => !variants.some(v => v.id === m.id))],
    [variants, madeVariants],
  );

  // --- session + draft boot ------------------------------------------------
  useEffect(() => {
    (async () => {
      const db = await getDb();
      // The session belongs to THIS run only: batches parked in _meta by an
      // earlier run (saved but never submitted) are deliberately not restored
      // here, so the review panel and Soumèt only ever cover what this wizard
      // run actually saved. Resuming a draft continues its own run below.
      if (!resumeDraftId) return;
      try {
        const d = await loadBatchDraft(db, resumeDraftId);
        if (d) {
          setDraftId(d.id);
          setStep(d.step);
          setSupplierId(d.supplierId);
          setBubbles((d.bubbles ?? []) as InvBubble[]);
          setDecisions(d.decisions ?? {});
          setDraftPrices(d.prices ?? {});
          setDraftBundles(d.bundles ?? []);
          if (d.sessionRef) setSessionRef(d.sessionRef);
          if (d.finalizedBatchIds?.length) setSessionBatchIds(d.finalizedBatchIds);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftId]);

  // Which products the chosen supplier may source. product_suppliers is the
  // explicit join, but seeded catalogs only record costs — use both, and fall
  // back to unfiltered when the supplier has no links at all.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supplierId) { setSupplierProducts(null); return; }
      const db = await getDb();
      const ids = new Set<string>();
      try {
        const rows = (await db.getAllAsync("SELECT * FROM product_suppliers WHERE supplier_id = ?", [supplierId])) as any[];
        for (const r of rows ?? []) if (!r.is_deleted) ids.add(String(r.product_id));
      } catch {}
      try {
        const rows = (await db.getAllAsync("SELECT * FROM product_supplier_costs WHERE supplier_id = ?", [supplierId])) as any[];
        for (const r of rows ?? []) if (!r.is_deleted) ids.add(String(r.product_id));
      } catch {}
      if (!alive) return;
      setSupplierProducts(ids.size ? ids : null);
    })();
    return () => { alive = false; };
  }, [supplierId]);

  // --- draft persistence ---------------------------------------------------
  async function persistDraft(next?: Partial<{ step: BatchDraftStep; supplierId: string; bubbles: InvBubble[] }>) {
    try {
      const db = await getDb();
      await saveBatchDraft(db, {
        id: draftId,
        step: next?.step ?? step,
        supplierId: next?.supplierId ?? supplierId,
        bubbles: (next?.bubbles ?? bubbles) as DraftBubble[],
        prices: Object.fromEntries(priceGroups.flatMap(g => g.rows.map(r => [r.variantId, r.value]))),
        bundles: Object.entries(bundleStates).map(([variantId, s]) => ({
          variantId, minQuantity: s.min, price: s.price, active: s.on,
        })),
        decisions, sessionRef, finalizedBatchIds: sessionBatchIds,
        splitTarget: null,
        createdAt: "", updatedAt: new Date().toISOString(),
      });
    } catch {}
  }

  function requestClose() {
    const hasContent = bubbles.length > 0 || !!supplierId;
    (async () => {
      try {
        if (hasContent) await persistDraft();
        else await deleteBatchDraft(await getDb(), draftId);
      } catch {}
      onClose();
    })();
  }

  // Parent "+" button routes through here so the draft lands before unmount.
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = requestClose;
    return () => { if (closeRef.current === requestClose) closeRef.current = null; };
  });

  function goStep(next: BatchDraftStep) {
    setError("");
    setStep(next);
    persistDraft({ step: next });
  }

  // --- step 2 helpers ------------------------------------------------------
  function unitsFor(productId: string) { return getUnitsForProduct(pricing, productId); }
  // A shot is a serving measure the POS pours out of a bottle — stock is never
  // bought by the shot, so inventory hides it everywhere (chips, default unit,
  // card hint). "chòt" is how it is sometimes spelled locally.
  const HIDDEN_UNIT = /^(shot|chòt|chot)$/i;
  /** Purchase containers for this screen: shot hidden, biggest → smallest. */
  function invUnits(productId: string): ProductUnit[] {
    return unitsFor(productId)
      .filter(u => !HIDDEN_UNIT.test(String(u.unit_name ?? "").trim()))
      .sort((a, b) => (Number(b.conversion_factor) || 0) - (Number(a.conversion_factor) || 0));
  }
  /** Last known cost of ONE unit of the given container (base cost × ratio). */
  function lastUnitCost(productId: string, unit: ProductUnit | null): number {
    const base = costByProduct.get(productId) ?? 0;
    if (!(base > 0)) return 0;
    return base * (Number(unit?.conversion_factor) || 1);
  }
  function displayPriceNum(p: Product): number {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return d.price;
    return Number(p.selling_price ?? 0) || 0;
  }
  function defaultUnitName(productId: string): string {
    return getDefaultUnit(invUnits(productId))?.unit_name ?? "pcs";
  }
  function selUnit() {
    if (!selectedProduct) return null;
    const us = invUnits(selectedProduct.id);
    return us.find(u => u.id === selUnitId) ?? us[0] ?? null;
  }
  function getProductCategoriesDisplay(productId: string): Category[] {
    const linked = productCategories.filter(pc => pc.product_id === productId).map(pc => pc.category_id);
    const ids = linked.length ? linked : (products.find(p => p.id === productId)?.category_id ? [products.find(p => p.id === productId)!.category_id!] : []);
    return ids.map(id => categories.find(c => c.id === id)).filter(Boolean) as Category[];
  }
  function visibleProducts(): Product[] {
    const qq = normName(pickSearch.trim());
    return products.filter(p => {
      if (!isGoods(p)) return false;
      if (supplierProducts && !supplierProducts.has(p.id)) return false;
      if (lowOnly && !((p.stock_quantity ?? 0) <= (p.low_stock_threshold ?? 0))) return false;
      if (!qq) return true;
      return normName(p.name).includes(qq) || normName(p.sku ?? "").includes(qq) || normName(p.barcode ?? "").includes(qq);
    });
  }
  const itemsCost = () => bubbles.reduce((s, b) => s + b.qty * b.costPrice, 0);

  function openAddSheet(p: Product) {
    setSelectedProduct(p);
    setEditIdx(null);
    // Biggest container first — that is how a delivery actually arrives.
    const us = invUnits(p.id);
    setSelUnitId(us[0]?.id ?? "");
    setInputQty("");
    setInputTotal("");
    setError("");
  }
  function openEditSheet(idx: number, b: InvBubble) {
    const p = productById.get(b.productId) ?? null;
    setSelectedProduct(p);
    setEditIdx(idx);
    setSelUnitId(b.unitId ?? "");
    setInputQty(String(b.qty));
    setInputTotal(String(Math.round(b.qty * b.costPrice * 100) / 100));
    setError("");
    setShowCart(false);
  }
  function closeAddSheet() {
    setSelectedProduct(null); setEditIdx(null); setSelUnitId("");
    setInputQty(""); setInputTotal("");
  }
  function confirmAdd() {
    if (!selectedProduct) return;
    const qty = parseFloat(inputQty) || 0;
    const totalText = inputTotal.trim();
    const total = parseFloat(totalText);
    if (qty <= 0) { setError("Antre yon kantite valid (> 0)"); return; }
    if (totalText === "" || isNaN(total)) { setError("Antre total acha a"); return; }
    if (total < 0) { setError("Total acha pa ka negatif"); return; }
    // The sheet collects qty + total; cost per item is derived here so every
    // downstream total (comparison, revient) stays exact.
    const cost = total / qty;
    const units = invUnits(selectedProduct.id);
    const u = units.find(x => x.id === selUnitId) ?? units[0] ?? null;
    const unitId = u?.id ?? "";
    const unitName = u?.unit_name ?? selectedProduct.unit ?? "Unit";
    const factor = Number(u?.conversion_factor) || 1;
    const bubble: InvBubble = {
      productId: selectedProduct.id, name: selectedProduct.name, sku: selectedProduct.sku,
      unitId, unitName, factor, unit: unitName, qty, costPrice: cost,
    };
    if (editIdx !== null) {
      setBubbles(prev => prev.map((b, i) => i === editIdx ? bubble : b));
    } else {
      const existing = bubbles.findIndex(b => b.productId === bubble.productId && (b.unitId || "") === (bubble.unitId || ""));
      if (existing >= 0) {
        setBubbles(prev => prev.map((b, i) => i === existing ? {
          ...b,
          qty: b.qty + bubble.qty,
          // Weighted average, so the merged line keeps both totals exact.
          costPrice: (b.qty * b.costPrice + bubble.qty * bubble.costPrice) / (b.qty + bubble.qty),
        } : b));
      } else {
        setBubbles(prev => [...prev, bubble]);
      }
    }
    closeAddSheet();
  }

  // Cart sheet stepper — same gesture as checkout: − at qty 1 asks first.
  function decBubble(idx: number) {
    const b = bubbles[idx];
    if (!b) return;
    if (b.qty <= 1) {
      Alert.alert("Retire atik la?", b.name, [
        { text: "Kanseye", style: "cancel" },
        { text: "Retire", style: "destructive", onPress: () => setBubbles(prev => prev.filter((_, i) => i !== idx)) },
      ]);
      return;
    }
    setBubbles(prev => prev.map((x, i) => i === idx ? { ...x, qty: x.qty - 1 } : x));
  }
  function incBubble(idx: number) {
    setBubbles(prev => prev.map((x, i) => i === idx ? { ...x, qty: x.qty + 1 } : x));
  }

  // --- step 3/4 data -------------------------------------------------------
  // Items with no variant get a silent Standard, same rule as PricesStep, so
  // the price step is never empty.
  // NOTE: variants are read fresh from SQLite — the parent's `variants` prop
  // only refreshes with its own reload, so rows created in the catalog (or
  // another session) would otherwise be invisible here and each item would
  // wrongly show a lone "Standard / Pa gen pri".
  const [freshVariants, setFreshVariants] = useState<Variant[]>([]);
  // Every item of the staged products (id, product, name) — steps 3/4 price
  // the whole product, not just the received units.
  const [pricedItems, setPricedItems] = useState<{ id: string; productId: string; name: string }[]>([]);
  async function stagedProductItems(db: any): Promise<any[]> {
    const productIds = [...new Set(bubbles.map(b => b.productId))];
    const rows = (((await db.getAllAsync("SELECT * FROM items").catch(() => [])) ?? []) as any[])
      .filter((i: any) => !i.is_deleted && productIds.includes(String(i.product_id)))
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return rows;
  }
  async function ensureVariants(scope?: Set<string>): Promise<Variant[]> {
    const db = await getDb();
    const itemIds = scope ?? new Set(bubbles.map(b => b.unitId));
    let live: Variant[] = [];
    try {
      live = ((((await db.getAllAsync("SELECT * FROM variants").catch(() => [])) ?? []) as any[])
        .filter((v: any) => !v.is_deleted && itemIds.has(String(v.item_id))) as Variant[]);
    } catch { live = []; }
    // Overlay this run's creations (same safety as allVariants).
    for (const m of madeVariants) {
      if (!live.some(v => String(v.id) === String(m.id)) && itemIds.has(String(m.item_id))) live.push(m);
    }
    const missing = [...itemIds].filter(id => !live.some(v => String(v.item_id) === id));
    if (missing.length) {
      const now = new Date().toISOString();
      const taken = new Set(live.map(v => v.id));
      const created: Variant[] = [];
      for (const itemId of missing) {
        let id = `var-${itemId}-standard`;
        let n = 2;
        while (taken.has(id)) id = `var-${itemId}-standard-${n++}`;
        taken.add(id);
        const rec = { id, item_id: itemId, name: "Standard", sort_order: 0, created_at: now, updated_at: now, is_deleted: 0 };
        await db.runAsync(
          "INSERT OR REPLACE INTO variants (id, item_id, name, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
          [rec.id, rec.item_id, rec.name, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
        );
        try { await insertOutbox("variants", "create", { ...rec, is_deleted: false }); } catch {}
        live.push(rec as Variant);
        created.push(rec as Variant);
      }
      if (created.length) setMadeVariants(prev => [...prev, ...created]);
    }
    setFreshVariants(live);
    return live;
  }

  /**
   * Price rows for the staged items: a variant with no price yet is blank and
   * required, one that has a price is prefilled and editable. Returns the rows
   * so callers can validate before React re-renders.
   */
  async function loadPriceStep(): Promise<PriceGroup[]> {
    try {
      const db = await getDb();
      // Whole product, not just the received units: every item of each
      // staged product gets a group so all variants can be priced.
      const itemsRows = await stagedProductItems(db);
      setPricedItems(itemsRows.map((i: any) => ({ id: String(i.id), productId: String(i.product_id), name: String(i.name ?? "?") })));
      const itemIds = new Set(itemsRows.map((i: any) => String(i.id)));
      const vs = await ensureVariants(itemIds);
      const vids = new Set(vs.map(v => v.id));
      let prices: VariantPrice[] = [];
      try {
        prices = (((await db.getAllAsync("SELECT * FROM variant_prices")) ?? []) as any[])
          .filter((p: any) => !p.is_deleted && vids.has(String(p.variant_id)));
      } catch {}
      // Whatever was typed in this run — or saved into the draft — wins over
      // the blank working copy, so stepping back and forth loses nothing.
      const typed = new Map<string, string>();
      for (const g of priceGroups) for (const r of g.rows) typed.set(r.variantId, r.value);
      // Reference unit cost per variant (ember, display only): one known batch
      // prices the whole chain — canonical smallest-unit cost × each item's
      // ratio. Pending pool first, else latest received. Same rule as PricesStep.
      let prodBatches: any[] = [];
      try {
        prodBatches = ((((await db.getAllAsync("SELECT * FROM batches").catch(() => [])) ?? []) as any[])
          .filter((b: any) => !b.is_deleted && itemIds.has(String(b.item_id))));
      } catch {}
      // The delivery being staged isn't a saved batch yet — fold its
      // quantities/totals in as the newest pending rows, otherwise a first
      // delivery always shows "—". The step-3 transport input is folded in
      // too (same by-weight spread as the save), so the ember preview is live.
      const tIn = Math.max(0, parseFloat(transport) || 0);
      const lineTotals = bubbles.map(b => (Number(b.qty) || 0) * (Number(b.costPrice) || 0));
      const lineAll = lineTotals.reduce((s, x) => s + x, 0);
      const stagedRows = bubbles.map((b, idx) => ({ b, idx }))
        .filter(({ b }) => itemIds.has(String(b.unitId)) && (Number(b.qty) || 0) > 0)
        .map(({ b, idx }) => {
          const lt = lineTotals[idx];
          const share = tIn > 0
            ? Math.round((lineAll > 0 ? tIn * (lt / lineAll) : tIn / bubbles.length) * 100) / 100
            : 0;
          return {
            item_id: b.unitId, product_id: b.productId,
            quantity: Number(b.qty) || 0, total_paid: lt + share,
            status: "pending", date: "", created_at: "",
          };
        });
      const liveItems = itemsRows as Item[];
      const byRecency = (a: any, b: any) =>
        String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
      const canonOf = (b: any): number => {
        const c = toCanonicalQty(liveItems, String(b.product_id ?? ""), String(b.item_id), Number(b.quantity));
        if (!(c > 0)) return 0;
        return (Number(b.total_paid) || 0) / c;
      };
      // What is ALREADY registered for these units (batches → supplier quote →
      // stored cost) — the fallback when this delivery prices nothing, so the
      // ember line shows the number that is actually in items.cost instead of
      // a dash.
      let costRows: any[] = [];
      try {
        costRows = (((await db.getAllAsync("SELECT * FROM product_supplier_costs").catch(() => [])) ?? []) as any[])
          .filter((r: any) => !r.is_deleted && itemIds.has(String(r.item_id ?? r.unit_id)));
      } catch {}
      const savedRef = itemCostsFor(itemsRows as Item[], prodBatches, costRows);
      const unitRefOf = (itemId: string, productId: string): number => {
        const f = itemFactor(liveItems, itemId);
        const m = minItemFactor(liveItems, productId);
        const perUnit = f > 0 && m > 0 ? f / m : 0;
        // Rows of THIS product only — a staged row from another product would
        // otherwise be scaled in and shown as this unit's purchase cost.
        const ownProduct = new Set(
          itemsRows.filter(r => String((r as any).product_id) === productId).map(r => String((r as any).id)),
        );
        if (perUnit > 0) {
          // Staged rows first: they are the delivery being entered now.
          const pend = [...stagedRows, ...prodBatches
            .filter((b: any) => String(b.status) === "pending" && Number(b.quantity) > 0)
            .sort(byRecency)]
            .filter(r => ownProduct.has(String(r.item_id)));
          if (pend.length) {
            // Prefer a row for this exact item (usually the staged one), else
            // the newest pending — one known batch prices the whole chain.
            const own = pend.find(r => String(r.item_id) === String(itemId)) ?? pend[0];
            const canon = canonOf(own);
            if (canon > 0) return canon * perUnit;
          }
          const recv = prodBatches
            .filter((b: any) => String(b.status) === "received" && Number(b.quantity) > 0 && ownProduct.has(String(b.item_id)))
            .sort(byRecency)[0];
          if (recv) {
            const canon = canonOf(recv);
            if (canon > 0) return canon * perUnit;
          }
        }
        // Nothing staged or receivable here — echo the registered cost.
        return Number(savedRef.get(String(itemId)) ?? 0);
      };
      const groups: PriceGroup[] = [];
      for (const it of itemsRows) {
        const itemId = String(it.id);
        const itemVars = vs.filter(v => String(v.item_id) === itemId);
        if (!itemVars.length) continue;
        const pid = String(it.product_id);
        const ref = unitRefOf(itemId, pid);
        groups.push({
          productId: pid,
          productName: productById.get(pid)?.name ?? bubbles.find(b => b.productId === pid)?.name ?? "?",
          itemId, itemName: String(it.name ?? "?"),
          rows: itemVars.map(v => {
            const id = String(v.id);
            return {
              variantId: id, variantName: String(v.name ?? ""),
              current: Number(currentVariantPrice(prices, id)?.price ?? 0),
              value: typed.get(id) ?? draftPrices[id] ?? "",
              unitRef: ref,
            };
          }),
        });
      }
      setPriceGroups(groups);
      return groups;
    } catch { setPriceGroups([]); return []; }
  }

  async function loadBundleStep(): Promise<Record<string, BundleState>> {
    try {
      const db = await getDb();
      const itemsRows = await stagedProductItems(db);
      setPricedItems(itemsRows.map((i: any) => ({ id: String(i.id), productId: String(i.product_id), name: String(i.name ?? "?") })));
      const vs = await ensureVariants(new Set(itemsRows.map((i: any) => String(i.id))));
      const vids = new Set(vs.map(v => v.id));
      let bundles: any[] = [];
      let bundlePrices: any[] = [];
      try { bundles = ((await db.getAllAsync("SELECT * FROM bundles")) ?? []) as any[]; } catch {}
      try { bundlePrices = ((await db.getAllAsync("SELECT * FROM bundle_prices")) ?? []) as any[]; } catch {}
      const drafted = new Map(draftBundles.map(d => [String(d.variantId), d]));
      const states: Record<string, BundleState> = {};
      const now = new Date().toISOString();
      for (const v of vs) {
        if (!vids.has(String(v.id))) continue;
        const id = String(v.id);
        const existing = bundles.find(b => String(b.variant_id) === id && !b.is_deleted);
        let base: BundleState = { on: false, min: "", price: "" };
        if (existing) {
          const cur = bundlePrices
            .filter(p => String(p.bundle_id) === String(existing.id) && !p.is_deleted && String(p.date) <= now)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          base = {
            on: !(existing.active === 0 || existing.active === false),
            min: String(Number(existing.min_quantity) || 0),
            price: cur ? String(Number(cur.price) || 0) : "",
          };
        }
        const d = drafted.get(id);
        // Working copy (this run) → draft → saved bundle.
        states[id] = bundleStates[id] ?? (d ? { on: !!d.active, min: String(d.minQuantity ?? ""), price: String(d.price ?? "") } : base);
      }
      setBundleStates(states);
      return states;
    } catch { setBundleStates({}); return {}; }
  }

  // Steps 3 and 4 build themselves the first time they are shown — and again
  // if the staged items change — so a variant without a price (or an item
  // without a variant) is always reachable for editing.
  const stagedKey = bubbles.map(b => b.unitId).join("|");
  useEffect(() => {
    if (step === 3) { void loadPriceStep(); return; }
    if (step === 4) void loadBundleStep();
    // transport is a dep so the ember cost preview folds it in live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stagedKey, transport]);

  function priceError(groups: PriceGroup[] = priceGroups): string {
    if ((parseFloat(transport) || 0) < 0) return "Transpò pa ka negatif.";
    for (const g of groups) {
      for (const r of g.rows) {
        const v = r.value.trim();
        if (!v) {
          if (!(r.current > 0)) return `Pri obligatwa pou ${formatCheckoutRow(g.itemName, g.productName, r.variantName)}`;
          continue;
        }
        const n = parseFloat(v);
        if (isNaN(n) || n <= 0) return `Pri pa valab pou ${formatCheckoutRow(g.itemName, g.productName, r.variantName)}`;
      }
    }
    return "";
  }

  function bundleError(states: Record<string, BundleState> = bundleStates): string {
    for (const [variantId, s] of Object.entries(states)) {
      if (!s.on) continue;
      const min = parseFloat(s.min) || 0;
      const price = parseFloat(s.price) || 0;
      if (min <= 0) return `Kantite minimòm obligatwa pou bout ${variantId}`;
      if (price <= 0) return `Pri bout obligatwa pou ${variantId}`;
    }
    return "";
  }

  // --- review + save -------------------------------------------------------
  function foldedLines(): ReviewLine[] {
    const map = new Map<string, ReviewLine>();
    for (const b of bubbles) {
      const prod = productById.get(b.productId);
      const e = map.get(b.unitId);
      if (e) { e.qty += b.qty; e.lineTotal += b.qty * b.costPrice; }
      else {
        map.set(b.unitId, {
          itemId: b.unitId, productId: b.productId,
          productName: prod?.name ?? b.name, itemName: b.unitName,
          qty: b.qty, unitCost: b.costPrice, lineTotal: b.qty * b.costPrice,
        });
      }
    }
    return [...map.values()];
  }

  async function openReview() {
    console.log("[review] open start", { upBusy, bubbles: bubbles.length, priceGroups: priceGroups.length, bundles: Object.keys(bundleStates).length, canViewItemCost });
    if (upBusy) return; // the transition card is already preparing this step
    if (!supplierId) { setStep(1); setError("Chwazi founisè a."); return; }
    if (!bubbles.length) { setError("Ajoute omwen yon pwodwi nan livrezon an"); return; }
    for (const b of bubbles) {
      if (isNaN(b.qty) || b.qty <= 0) { setError(`Kantite pa valab pou ${b.name}`); return; }
      if (isNaN(b.costPrice) || b.costPrice < 0) { setError(`Pri acha pa valab pou ${b.name}`); return; }
    }
    // Feedback while steps 3/4 build and the cost comparison runs (both hit
    // SQLite) — same transition card the save uses, titled for this step.
    // The card must ALWAYS come down: any throw or a read that never returns
    // would otherwise freeze the wizard on a stuck loading screen.
    const t0 = Date.now();
    setUpTitle("Revizyon");
    setUpPhase("loading");
    setUpMsg("Ap prepare revizyon…");
    setUpBusy(true);
    let outcome: "ok" | "redirect" | "failed" = "ok";
    try {
      const prepare = async (): Promise<"ok" | "redirect"> => {
        // The cart sheet jumps straight here, so build steps 3/4 on the way in
        // — that is what guarantees a variant with no price is never skipped.
        // Detail text doubles as a breadcrumb: whatever it is frozen on is the
        // step that never returned.
        if (!priceGroups.length) setUpMsg("1/3 · Pri…");
        const groups = priceGroups.length ? priceGroups : await loadPriceStep();
        console.log("[review] pri done", groups.length);
        const pe = priceError(groups);
        if (pe) { setStep(3); setError(pe); return "redirect"; }
        if (!Object.keys(bundleStates).length) setUpMsg("2/3 · Bout…");
        const bStates = Object.keys(bundleStates).length ? bundleStates : await loadBundleStep();
        console.log("[review] bout done", Object.keys(bStates).length);
        const be = bundleError(bStates);
        if (be) { setStep(4); setError(be); return "redirect"; }
        setError("");
        setRecommendations([]);
        setDecisions({});
        try {
          const db = await getDb();
          if (canViewItemCost) {
            setUpMsg("3/3 · Konpare pri…");
            const res = await compareBatchLines(db, foldedLines(), supplierId);
            console.log("[review] konpare done", res.recommendations.length);
            setRecommendations(res.recommendations);
          }
        } catch (e) { console.log("[review] konpare threw", e); setRecommendations([]); }
        setUpMsg("Louvri revizyon…");
        return "ok";
      };
      // Arm the ceiling BEFORE the work starts (a synchronous stall inside
      // prepare would otherwise block the timer from ever being registered).
      const timeout = new Promise<"timeout">(res => setTimeout(() => res("timeout"), 6000));
      const r = await Promise.race([prepare(), timeout]);
      console.log("[review] race →", r, "elapsed", Date.now() - t0);
      if (r === "timeout") { outcome = "failed"; setError("Prepare revizyon an pran twò lontan. Eseye yon lòt fwa."); }
      else if (r === "redirect") outcome = "redirect";
    } catch (e) {
      console.log("[review] threw", e);
      outcome = "failed";
      setError("Pa t kapab prepare revizyon an. Eseye yon lòt fwa.");
    }
    // Never flash: the review is an in-tree overlay, so it can go up in the
    // same tick the transition card's dialog comes down — no second native
    // window is involved and step 4 is never revealed in between.
    console.log("[review] outcome", outcome);
    const hold = Math.max(0, 450 - (Date.now() - t0));
    if (hold > 0) await new Promise(r => setTimeout(r, hold));
    if (outcome === "ok") { console.log("[review] presenting review"); setShowReview(true); }
    setUpBusy(false);
    console.log("[review] done");
  }

  // The sheet has no native window anymore, so Android back has to be handled
  // in JS: close the review before letting the rest of the app handle it.
  useEffect(() => {
    if (!showReview) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowReview(false);
      setError("");
      return true;
    });
    return () => sub.remove();
  }, [showReview]);

  useEffect(() => { console.log("[review] showReview =", showReview); }, [showReview]);

  const [upTitle, setUpTitle] = useState("Livrezon anrejistre");
  const [upBusy, setUpBusy] = useState(false);
  const [upPhase, setUpPhase] = useState<UploadPhase>("loading");
  const [upMsg, setUpMsg] = useState("");

  // Safety net: a card left in "loading" forever would freeze the wizard.
  // The prepare pass has its own 6s ceiling; this covers a save whose DB write
  // never returns (the promise still finishes later and hands over normally).
  useEffect(() => {
    if (!upBusy || upPhase !== "loading") return;
    const t = setTimeout(() => {
      setUpPhase("error");
      setUpMsg("Baz done a pa reponn — verifye si livrezon an anrejistre anvan eseye ankò.");
      setUpBusy(false);
    }, 45000);
    return () => clearTimeout(t);
  }, [upBusy, upPhase]);

  async function handleSave() {
    if (busy) return;
    const dateStr = todayStr(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { setError("Dat la pa valab."); return; }
    const unresolved = recommendations.filter(r => !decisions[r.itemId]);
    if (unresolved.length) { setError("Rezoud tout rekòmandasyon yo anvan."); return; }
    const tSave = parseFloat(transport) || 0;
    if (tSave < 0) { setError("Transpò pa ka negatif."); return; }

    setBusy(true);
    // DB-upload monitor: loading never flashes (min 1.5s), success readable
    // (2s), error held (3s) — same reusable transition as the catalog.
    setUpTitle("Livrezon anrejistre");
    setUpBusy(true);
    setUpPhase("loading");
    setUpMsg("Ap anrejistre livrezon…");
    const t0 = Date.now();
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const allLines = foldedLines();
      const splitRecs = recommendations.filter(r => decisions[r.itemId] === "split");
      const splitIds = new Set(splitRecs.map(r => r.itemId));
      const keep = allLines.filter(l => !splitIds.has(l.itemId));
      // Choosing split creates the cheaper supplier's batch right now — same
      // qty, quoted unit cost — so every decision leaves a batch behind.
      const splitToSave = splitRecs.map(r => {
        const line = allLines.find(l => l.itemId === r.itemId);
        if (!line) return null;
        return { line, supplier: String(r.cheaperSupplierId), unitCost: r.cheaperUnitCost, total: line.qty * r.cheaperUnitCost };
      }).filter((x): x is { line: ReviewLine; supplier: string; unitCost: number; total: number } => !!x);

      // Prices (step 3): untouched field = keep current, never overwrite.
      for (const g of priceGroups) {
        for (const r of g.rows) {
          const raw = r.value.trim();
          if (!raw) continue;
          const n = parseFloat(raw);
          if (isNaN(n) || n <= 0) continue;
          if (r.current > 0 && n === r.current) continue;
          await upsertVariantPriceRow(db, { variantId: r.variantId, price: n, date: dateStr });
        }
      }
      // Bundles (step 4): off = leave alone; on = record + effective price.
      for (const [variantId, s] of Object.entries(bundleStates)) {
        if (!s.on) continue;
        const min = parseFloat(s.min) || 0;
        const price = parseFloat(s.price) || 0;
        if (min <= 0 || price <= 0) continue;
        await upsertBundleRow(db, { variantId, minQuantity: min, price, date: dateStr });
      }

      const taken = new Set(sessionBatchIds);
      const ref = sessionRef || `SES-${Date.now().toString().slice(-6)}`;
      const deliveryRef = `LIV-${Date.now().toString().slice(-6)}`;
      // Every saved line — kept under this supplier plus split lines under
      // their cheaper supplier — with step-3 transport spread by weight (same
      // rule as the catalog PricesStep).
      const toSave = [
        ...keep.map(l => ({ line: l, supplier: supplierId, unitCost: l.unitCost, total: l.lineTotal })),
        ...splitToSave,
      ];
      const saveTotal = toSave.reduce((s, x) => s + x.total, 0);
      const priced = toSave.map(x => {
        const share = tSave > 0 && toSave.length
          ? Math.round((saveTotal > 0 ? tSave * (x.total / saveTotal) : tSave / toSave.length) * 100) / 100
          : 0;
        return { ...x, total: x.total + share, transportShare: share };
      });
      const newIds: string[] = [];
      const touchedProducts = new Set<string>();
      for (const x of priced) {
        const l = x.line;
        const id = await mergeV2Batch(db, now, taken, {
          itemId: l.itemId, supplierId: x.supplier,
          qty: l.qty, total: x.total, date: dateStr,
          deliveryRef, transportShare: x.transportShare, sessionRef: ref, source: "inventory",
        });
        taken.add(id);
        newIds.push(id);
        // Cost catalog: remember what this delivery really cost per unit —
        // the same landed figure the step-3 ember line shows (line total +
        // this line's transport share), so what you see is what gets saved.
        // Written only after the comparison ran, so it can never influence
        // this pass.
        const item = batchItems.find(i => i.id === l.itemId);
        const productId = item ? String(item.product_id) : l.productId;
        const landed = l.qty > 0 ? Math.round((x.total / l.qty) * 100) / 100 : x.unitCost;
        await upsertSupplierCost(db, { productId, supplierId: x.supplier, itemId: l.itemId, cost: landed });
        touchedProducts.add(productId);
      }
      // Fresh supplier quotes just landed — republish every unit cost of
      // those products so no item is left without a price.
      for (const pid of touchedProducts) {
        try { await recomputeItemCosts(db, pid); } catch {}
      }

      const allIds = [...sessionBatchIds, ...newIds];
      setSessionRef(ref);
      setSessionBatchIds(allIds);

      await deleteBatchDraft(db, draftId);
      try { await loadPricing(db); } catch {}

      const splitNames = [...new Set(splitToSave.map(s => supName(s.supplier)))].join(", ");
      const summary = `${supName(supplierId)} · ${dateStr} · ${toSave.length} atik` +
        (splitToSave.length ? ` • ${splitToSave.length} split ak ${splitNames}` : "");

      // Loading holds only until the DB work is done (min 1.5s), success is a
      // short beat, then hand over straight to the deliveries list.
      await new Promise(r => setTimeout(r, Math.max(0, 1500 - (Date.now() - t0))));
      setUpPhase("success");
      setUpMsg(tSave > 0 ? `${summary} · transpò ${fmtG(tSave)} enkl.` : summary);
      await new Promise(r => setTimeout(r, 700));
      // One tick: the review sheet closes and the wizard unmounts together
      // under the opaque success card, so no intermediate screen (step 4 /
      // emptied review) is ever revealed during the hand-off.
      setBubbles([]); setDecisions({}); setRecommendations([]); setTransport(""); setShowReview(false);
      onSaved({ sessionRef: ref, batchIds: allIds, summary });
      // Belt & braces: if the parent ever keeps the wizard mounted, the
      // success card still closes instead of sticking on screen.
      setUpBusy(false);
    } catch (e: any) {
      setUpPhase("error");
      setUpMsg(`Livrezon an pa anrejistre: ${e?.message ?? e}`);
      setError(`Erè baz done: ${e?.message ?? e}`);
      await new Promise(r => setTimeout(r, 3000));
      setUpBusy(false);
    } finally {
      setBusy(false);
    }
  }

  // --- header chrome -------------------------------------------------------
  // Nav sits top-left — bare X on step 1 (the only step that shows it), bare
  // back arrow on steps 2-4 (the only thing they show on that side) — and the
  // step's primary action sits top-right, so there is no bottom footer. Equal
  // width slots keep the title optically centered. Both nav buttons are
  // icon-only and transparent.
  const HEADER_SLOT = 88;
  type StepPrimary = { label: string; onPress: () => void; disabled?: boolean };

  function stepHeader(n: BatchDraftStep, title: string, sub: string, primary: StepPrimary, back?: { label: string; onPress: () => void }) {
    return (
      <View style={{ backgroundColor: "#000", paddingHorizontal: padH, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* The slot stays HEADER_SLOT wide so the title stays centered; the
              button itself only ever hugs its icon. */}
          <View style={{ width: HEADER_SLOT, alignItems: "flex-start" }}>
            {n === 1 ? (
              <Pressable
                onPress={requestClose}
                accessibilityLabel="Kite"
                hitSlop={10}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={40} color="#fff" />
              </Pressable>
            ) : (
              <Pressable
                onPress={back?.onPress}
                accessibilityLabel={back?.label}
                disabled={!back}
                hitSlop={10}
                style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </Pressable>
            )}
          </View>
          <View style={{ flex: 1, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontWeight: "800", fontSize: fs(16), color: inv.text }} numberOfLines={1}>{title}</Text>
              <View style={{ backgroundColor: "#fff", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
                <Text style={{ fontSize: fs(9), fontWeight: "800", color: "#000" }}>{n}/4</Text>
              </View>
            </View>
            <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 1, textAlign: "center" }} numberOfLines={1}>{sub}</Text>
          </View>
          <Pressable
            onPress={primary.onPress}
            disabled={primary.disabled}
            style={{ width: HEADER_SLOT, height: 44, borderRadius: radius.pill, backgroundColor: primary.disabled ? inv.tile : "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontWeight: "800", fontSize: fs(14), color: primary.disabled ? inv.faint : "#000" }} numberOfLines={1}>{primary.label}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- steps ---------------------------------------------------------------
  function filteredSuppliers(): { id: string; name: string }[] {
    const q = normName(supplierSearch.trim());
    if (!q) return suppliers;
    return suppliers.filter(s => normName(s.name).includes(q));
  }

  function renderStep1() {
    const shownSuppliers = filteredSuppliers();
    return (
      <View style={{ flex: 1 }}>
        {stepHeader(1, "Founisè", "Chwazi moun k ap vann ou a", { label: "Kontinye", onPress: () => { if (!supplierId) { setError("Chwazi founisè a."); return; } goStep(2); }, disabled: !supplierId })}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 14, gap: 10, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {error ? errBox(error) : null}
          <View style={{ backgroundColor: inv.card, borderRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 14 }}>
            <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Founisè *</Text>
            {suppliers.length === 0 ? (
              <Text style={{ fontSize: fs(12), color: inv.sub, marginTop: 6 }}>Pa gen founisè — kreye youn nan Founisè.</Text>
            ) : (
              <>
                <View style={{ height: 46, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 23, paddingHorizontal: 14, marginTop: 10 }}>
                  <Ionicons name="search" size={17} color="#fff" style={{ marginRight: 8 }} />
                  <TextInput
                    value={supplierSearch}
                    onChangeText={setSupplierSearch}
                    placeholder="Chèche founisè..."
                    placeholderTextColor="#8e8e93"
                    style={{ flex: 1, fontSize: fs(15), color: "#fff", paddingVertical: 8 }}
                    returnKeyType="search"
                  />
                  {supplierSearch.length > 0 ? (
                    <Pressable onPress={() => setSupplierSearch("")} hitSlop={8} style={{ padding: 4 }}>
                      <Ionicons name="close-circle" size={17} color="#8e8e93" />
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {shownSuppliers.map(s => {
                    const active = supplierId === s.id;
                    return (
                      <Pressable key={s.id} onPress={() => { setSupplierId(active ? "" : s.id); if (error) setError(""); }} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}>
                        <Text style={{ color: active ? "#000" : "#fff", fontWeight: "700", fontSize: fs(12) }}>{s.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {shownSuppliers.length === 0 && (
                  <Text style={{ fontSize: fs(12), color: inv.sub, marginTop: 10 }}>Pa jenn founisè pou "{supplierSearch.trim()}".</Text>
                )}
              </>
            )}
            {supplierId ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                <Ionicons name="filter-outline" size={13} color={inv.green} />
                <Text style={{ fontSize: fs(11), color: inv.sub, flex: 1 }}>
                  Etap 2 ap montre sèlman pwodwi {supName(supplierId)} ka founi.
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ backgroundColor: inv.card, borderRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 14, gap: 8 }}>
            <Text style={{ fontSize: fs(11), fontWeight: "800", color: inv.text, letterSpacing: 0.6 }}>KIJAN L FONKSYONE</Text>
            {[
              ["1", "Founisè", "Chwazi anvan tout bagay"],
              ["2", "Pwodwi", "Kantite + pri acha"],
              ["3", "Pri vann", "Dat efè, istwa konsève"],
              ["4", "Bout", "Opsyonèl — pri an gwo"],
            ].map(([n, t, d]) => (
              <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: fs(11), fontWeight: "800", color: inv.sub }}>{n}</Text>
                </View>
                <Text style={{ fontSize: fs(12), fontWeight: "700", color: inv.text, width: 74 }}>{t}</Text>
                <Text style={{ fontSize: fs(11), color: inv.sub, flex: 1 }}>{d}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderStep2() {
    return (
      <View style={{ flex: 1 }}>
        {stepHeader(2, "Pwodwi", `${bubbles.length} pwodwi · ${fmt(bubbles.reduce((s, b) => s + b.qty, 0))} total atik`, { label: "Pri vann", onPress: () => { if (!bubbles.length) { setError("Ajoute omwen yon pwodwi nan livrezon an"); return; } goStep(3); } }, { label: "Founisè", onPress: () => goStep(1) })}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, paddingTop: 8, marginBottom: 8 }}>
          <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
            <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
            <TextInput value={pickSearch} onChangeText={setPickSearch} placeholder="Chèche pwodwi..." placeholderTextColor="#8e8e93" style={{ flex: 1, fontSize: fs(16), color: "#fff", paddingVertical: 10 }} returnKeyType="search" />
            {pickSearch.length > 0 ? (
              <Pressable onPress={() => setPickSearch("")} hitSlop={8} style={{ padding: 4 }}><Ionicons name="close-circle" size={18} color="#8e8e93" /></Pressable>
            ) : null}
          </View>
          <Pressable onPress={() => setLowOnly(v => !v)} style={{ width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: lowOnly ? "#fff" : "#000", borderWidth: 1, borderColor: lowOnly ? "#fff" : "#3a3a3c" }}>
            <Ionicons name="filter" size={20} color={lowOnly ? "#000" : "#fff"} />
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 4, gap: 10, paddingBottom: bubbles.length ? 110 : 40, ...(isTablet && { flexDirection: "row" as const, flexWrap: "wrap" as const }) }} showsVerticalScrollIndicator={false}>
          {error ? errBox(error) : null}
          {supplierId && supplierProducts && (
            <Text style={{ fontSize: fs(11), color: inv.sub }}>Ap montre pwodwi {supName(supplierId)} ka founi.</Text>
          )}
          {visibleProducts().map(p => {
            const inShip = bubbles.some(b => b.productId === p.id);
            const card = (
              <ProductCard
                item={p} role={role} prodCats={getProductCategoriesDisplay(p.id)}
                status={statusForProduct(p)} recentMoves={[]} displayPrice={displayPriceNum(p)}
                unitName={defaultUnitName(p.id)} isTablet={isTablet} canEdit={canInventory}
                canViewCost={canViewItemCost} baseCost={costByProduct.get(p.id)}
                stockItems={batchItems} variants={allVariants} selected={inShip}
                onPress={() => { if (canInventory) openAddSheet(p); }}
              />
            );
            return isTablet
              ? <View key={p.id} style={{ flexBasis: "48%" as any, flexGrow: 1 }}>{card}</View>
              : <View key={p.id}>{card}</View>;
          })}
          {products.length === 0 && <EmptyState icon="cube-outline" title="Katalòg vid" sub="Kreye pwodwi anvan" />}
          {products.length > 0 && visibleProducts().length === 0 && <EmptyState icon="search-outline" title="Pa gen rezilta" sub="Chanje rechèch la oswa founisè a" />}
        </ScrollView>
        {bubbles.length > 0 && (
          <View style={{ position: "absolute", bottom: 16, left: 14, right: 14, alignItems: "center" }}>
            <Pressable onPress={() => setShowCart(true)} style={{ width: "100%", maxWidth: isTablet ? 560 : 390, backgroundColor: paperPill.bg, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", ...shadow.soft }}>
              <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: paperPill.chip, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "900", color: paperPill.ink, fontSize: fs(13) }}>{bubbles.length}</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
                <Text style={{ fontWeight: "800", color: paperPill.green, fontSize: fs(12) }}>Tape pou ouvè</Text>
                <Text style={{ fontWeight: "900", color: paperPill.ink, fontSize: fs(15), ...monoStyle }}>{fmtG(itemsCost())}</Text>
              </View>
              <Ionicons name="chevron-up" size={30} color={paperPill.ink} />
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  function renderStep3() {
    // One card per product (all of its items/variants inside), rows read
    // `{item} {product} {variant}` with the live price (or blank) in the box.
    const byProduct: { id: string; name: string; groups: PriceGroup[] }[] = [];
    for (const g of priceGroups) {
      const f = byProduct.find(x => x.id === g.productId);
      if (f) f.groups.push(g); else byProduct.push({ id: g.productId, name: g.productName, groups: [g] });
    }
    return (
      <View style={{ flex: 1 }}>
        {stepHeader(3, "Pri vann", `${byProduct.length} pwodwi · pri dat efè`, { label: "Bout", onPress: () => { const e = priceError(); if (e) { setError(e); return; } goStep(4); } }, { label: "Pwodwi", onPress: () => goStep(2) })}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 12, gap: 10, paddingBottom: 24 + (Platform.OS === "android" ? keyboardH : 0) }} showsVerticalScrollIndicator={false}>
          {error ? errBox(error) : null}
          <Text style={{ fontSize: fs(11), color: inv.sub }}>
            Kase chan = nouvo pri dat {todayStr(date)} (istwa konsève). Kite vid = kenbe pri aktyèl la.
          </Text>
          <View style={{ borderWidth: 1, borderColor: inv.border, borderRadius: 16, padding: 14, gap: 6 }}>
            <Text style={{ fontWeight: "700", fontSize: fs(13), color: inv.text }}>Transpò (opsyonèl)</Text>
            <MoneyInput value={transport} onChangeText={v => setTransport(v)} placeholder="0" placeholderTextColor={inv.faint}
              keyboardType="numeric"
              style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, fontSize: fs(14), color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
            <Text style={{ fontSize: fs(10), color: inv.sub }}>Reparti sou atik yo (pa pwa) lè livrezon an anrejistre.</Text>
          </View>
          {byProduct.map(p => (
            <View key={p.id} style={{ backgroundColor: inv.card, borderRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 14 }}>
              <Text style={{ fontWeight: "800", fontSize: fs(13), color: inv.text }} numberOfLines={1}>{p.name}</Text>
              {p.groups.map(g => g.rows.map(r => (
                <View key={r.variantId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600", fontSize: fs(12), color: inv.text }} numberOfLines={1}>{formatCheckoutRow(g.itemName, g.productName, r.variantName)}</Text>
                    <Text style={{ fontSize: fs(10), color: "#ff4d00", marginTop: 1 }} numberOfLines={1}>
                      ≈ {r.unitRef > 0 ? fmtG(Math.round(r.unitRef * 100) / 100) : "—"} / {g.itemName} · pri acha
                    </Text>
                  </View>
                  <MoneyInput
                    value={r.value}
                    onChangeText={v => setPriceGroups(prev => prev.map(gg => gg.itemId !== g.itemId ? gg : { ...gg, rows: gg.rows.map(rr => rr.variantId !== r.variantId ? rr : { ...rr, value: v }) }))}
                    placeholder={r.current > 0 ? String(r.current) : "—"}
                    placeholderTextColor={inv.faint}
                    keyboardType="numeric" selectTextOnFocus
                    style={{ width: 110, borderWidth: 1, borderColor: r.value ? inv.borderStrong : (r.current > 0 ? inv.borderStrong : inv.amberBd), borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10, textAlign: "center", fontWeight: "800", fontSize: fs(14), color: "#fff", backgroundColor: "transparent" }}
                  />
                </View>
              )))}
            </View>
          ))}
          {!priceGroups.length && <EmptyState icon="pricetag-outline" title="Pa gen pri pou mete" sub="Tounen nan etap 2 epi ajoute pwodwi." />}
        </ScrollView>
      </View>
    );
  }

  function renderStep4() {
    // Prefer the fresh list ensureVariants just read (falls back to the
    // parent snapshot before step 4 loads) so every variant gets a row.
    // Whole staged products, not just received units — same scope as step 3.
    const stagedPids = new Set(bubbles.map(b => b.productId));
    const meta = new Map(pricedItems.map(i => [i.id, i]));
    const pidOf = (itemId: string): string =>
      meta.get(itemId)?.productId ?? bubbles.find(b => b.unitId === itemId)?.productId ?? "";
    const listVars = freshVariants.length ? freshVariants : allVariants;
    const itemVars = listVars.filter(v => !v.is_deleted && stagedPids.has(pidOf(String(v.item_id))));
    // Group the flat variant list by product: one left-aligned product label,
    // its variant cards underneath. Order = first appearance in itemVars.
    type VarGroup = { pid: string; label: string; vars: typeof itemVars };
    const groups: VarGroup[] = [];
    const byPid = new Map<string, VarGroup>();
    for (const v of itemVars) {
      const iid = String(v.item_id);
      const pid = pidOf(iid);
      let g = byPid.get(pid);
      if (!g) {
        const itName = meta.get(iid)?.name ?? bubbles.find(b => b.unitId === iid)?.name ?? "";
        g = { pid, label: productById.get(pid)?.name || itName || "?", vars: [] };
        byPid.set(pid, g);
        groups.push(g);
      }
      g.vars.push(v);
    }
    // Under the product label the row still names its item and variant — the
    // app-wide "{item} {product} {variant}" (a repeated token drops out).
    const rowLabel = (v: (typeof itemVars)[number]) => {
      const iid = String(v.item_id);
      const itName = meta.get(iid)?.name ?? bubbles.find(b => b.unitId === iid)?.unitName ?? "—";
      const g = byPid.get(pidOf(iid));
      return formatCheckoutRow(itName, g?.label ?? "", v.name ?? null);
    };
    return (
      <View style={{ flex: 1 }}>
        {stepHeader(4, "Bout", `${groups.length} pwodwi · ${itemVars.length} variant · opsyonèl`, { label: "Revizyon", onPress: () => { const e = bundleError(); if (e) { setError(e); return; } openReview(); } }, { label: "Pri vann", onPress: () => goStep(3) })}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 12, gap: 10, paddingBottom: 24 + (Platform.OS === "android" ? keyboardH : 0) }} showsVerticalScrollIndicator={false}>
          {error ? errBox(error) : null}
          <Text style={{ fontSize: fs(11), color: inv.sub }}>
            Bout = pri an gwo lè kliyan pran anpil. Sòti l si ou pa bezwen l — istwa li rete.
          </Text>
          {groups.map(g => (
            <View key={g.pid} style={{ gap: 10 }}>
              {/* Product label sits above its variants, left-aligned. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: fs(11), fontWeight: "800", color: inv.text, letterSpacing: 0.4 }} numberOfLines={1}>{g.label}</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: inv.hairline }} />
                <Text style={{ fontSize: fs(10), color: inv.faint, fontWeight: "700" }}>{g.vars.length} variant</Text>
              </View>
              {g.vars.map(v => {
                const vid = String(v.id);
                const s = bundleStates[vid] ?? { on: false, min: "", price: "" };
                return (
                  <View key={vid} style={{ backgroundColor: inv.card, borderRadius: 18, borderWidth: 0.5, borderColor: s.on ? inv.amberBd : inv.border, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "800", fontSize: fs(13), color: inv.text }} numberOfLines={1}>{rowLabel(v)}</Text>
                        <Text style={{ fontSize: fs(10), color: inv.faint, marginTop: 2 }}>{s.on ? "Kounye a: aktif" : "Pa aktif"}</Text>
                      </View>
                      <Pressable
                        onPress={() => setBundleStates(prev => ({ ...prev, [vid]: { ...s, on: !s.on } }))}
                        style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: s.on ? inv.amber : inv.tile, alignItems: s.on ? "flex-end" : "flex-start", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1, borderColor: s.on ? inv.amber : inv.borderStrong }}
                      >
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: s.on ? "#000" : "#8e8e93" }} />
                      </Pressable>
                    </View>
                    {s.on && (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700", fontSize: fs(11), color: inv.text }}>Kantite minimòm *</Text>
                          <TextInput value={s.min} onChangeText={v => setBundleStates(prev => ({ ...prev, [vid]: { ...s, min: v.replace(/[^0-9.]/g, "") } }))} placeholder="3" placeholderTextColor={inv.faint} keyboardType="numeric" selectTextOnFocus style={{ height: 48, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 10, marginTop: 5, textAlign: "center", fontWeight: "800", fontSize: fs(14), color: "#fff", backgroundColor: "transparent" }} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700", fontSize: fs(11), color: inv.text }}>Pri bout (G) *</Text>
                          <MoneyInput value={s.price} onChangeText={v => setBundleStates(prev => ({ ...prev, [vid]: { ...s, price: v } }))} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" selectTextOnFocus style={{ height: 48, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 10, marginTop: 5, textAlign: "center", fontWeight: "800", fontSize: fs(14), color: "#fff", backgroundColor: "transparent" }} />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
          {!itemVars.length && <EmptyState icon="albums-outline" title="Pa gen variant" sub="Tounen nan etap 2 epi ajoute pwodwi." />}
        </ScrollView>
      </View>
    );
  }

  // --- modals --------------------------------------------------------------
  function renderAddSheet() {
    return (
      <Modal visible={!!selectedProduct} transparent animationType="slide" onRequestClose={closeAddSheet}>
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", flex: 1, backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, overflow: "hidden" }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: inv.sub, fontWeight: "800", fontSize: fs(20) }}>{selectedProduct?.name?.[0]?.toUpperCase() ?? "•"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: fs(15), color: inv.text }} numberOfLines={1}>{selectedProduct?.name}</Text>
                    <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 1 }}>{selectedProduct?.sku ?? ""}{editIdx !== null ? " · MODIFYE" : ""}</Text>
                  </View>
                  <Pressable onPress={closeAddSheet} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </Pressable>
                </View>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>
                {selectedProduct && invUnits(selectedProduct.id).length > 1 && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    {invUnits(selectedProduct.id).map(u => {
                      const active = (selUnitId || selUnit()?.id) === u.id;
                      return (
                        <Pressable key={u.id} onPress={() => setSelUnitId(u.id)} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}>
                          <Text style={{ color: active ? "#000" : "#fff", fontWeight: "700", fontSize: fs(12) }}>{u.unit_name}{Number(u.conversion_factor) > 1 ? ` ×${u.conversion_factor}` : ""}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Kantite{selUnit() ? ` (${selUnit()!.unit_name})` : ""} *</Text>
                    <TextInput value={inputQty} onChangeText={v => { setInputQty(v.replace(/[^0-9.]/g, "")); if (error) setError(""); }} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" selectTextOnFocus style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, textAlign: "center", fontWeight: "800", fontSize: fs(16), color: "#fff", backgroundColor: "transparent" }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Total acha G *</Text>
                    <MoneyInput value={inputTotal} onChangeText={v => { setInputTotal(v); if (error) setError(""); }} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" selectTextOnFocus style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, textAlign: "center", fontWeight: "800", fontSize: fs(16), color: "#fff", backgroundColor: "transparent" }} />
                  </View>
                </View>
                {(() => {
                  const q = parseFloat(inputQty) || 0;
                  const tText = inputTotal.trim();
                  const t = parseFloat(tText);
                  const unit = selUnit();
                  const hint = lastUnitCost(selectedProduct?.id ?? "", unit);
                  return (
                    <View style={{ marginTop: 10, backgroundColor: inv.tile, borderRadius: 12, borderWidth: 0.5, borderColor: inv.borderStrong, paddingHorizontal: 12, paddingVertical: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="calculator-outline" size={15} color={inv.green} />
                        <Text style={{ fontSize: fs(11), color: inv.sub, flex: 1 }}>Pri acha pa inite (kalkile otomatikman)</Text>
                        <Text style={{ fontSize: fs(14), fontWeight: "900", color: "#fff" }}>
                          {q > 0 && tText !== "" && !isNaN(t) ? `${fmtG(t / q, 2)} / ${unit?.unit_name ?? ""}` : "—"}
                        </Text>
                      </View>
                      {hint > 0 && tText === "" ? (
                        <Text style={{ fontSize: fs(10), color: inv.faint, marginTop: 6 }}>
                          Dènye pri acha: {fmtG(hint, 2)} / {unit?.unit_name ?? ""} — antre total la pou kalkile
                        </Text>
                      ) : null}
                    </View>
                  );
                })()}
                <Text style={{ fontSize: fs(10), color: inv.faint, marginTop: 8, textAlign: "center" }}>Pri vann yo mete nan etap 3.</Text>
              </ScrollView>
              <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: (Platform.OS === "android" ? keyboardH : 0) + 20, borderTopWidth: 0.5, borderColor: inv.hairline, gap: 10 }}>
                {error ? <View>{errBox(error)}</View> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {editIdx !== null && (
                    <Pressable onPress={() => { setBubbles(prev => prev.filter((_, i) => i !== editIdx)); closeAddSheet(); }} style={{ paddingVertical: 14, paddingHorizontal: 16, backgroundColor: inv.redBg, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: inv.redBd }}>
                      <Ionicons name="trash-outline" size={17} color={inv.red} />
                    </Pressable>
                  )}
                  <Pressable onPress={confirmAdd} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12 }}>
                    <Text style={{ color: "#000", fontWeight: "800", fontSize: fs(14) }}>{editIdx !== null ? "✓ Mete ajou" : "✓ Ajoute"}</Text>
                    {((parseFloat(inputQty) || 0) > 0 && (parseFloat(inputTotal) || 0) > 0) && (
                      <View style={{ backgroundColor: inv.tile, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: fs(11), fontWeight: "900", color: "#fff" }}>{fmtG(parseFloat(inputTotal))}</Text>
                      </View>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderCartSheet() {
    return (
      <Modal visible={showCart} transparent animationType="slide" onRequestClose={() => setShowCart(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", flex: 1, backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, overflow: "hidden" }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chatbubble-ellipses-outline" size={17} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: fs(14), color: inv.text }}>Atik nan livrezon</Text>
                    <Text style={{ fontSize: fs(10), color: inv.sub }}>{bubbles.length} pwodwi · Tape pou modifye</Text>
                  </View>
                  <Pressable onPress={() => setShowCart(false)} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </Pressable>
                </View>
              </View>
              {/* Same row design as checkout's CartLineRow (POSShared): dark
                  card · name + ✕ · PRI / QTÉ / SOU-TOTAL columns. */}
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
                {bubbles.map((b, idx) => (
                  <Pressable key={idx} onPress={() => openEditSheet(idx, b)} style={{ backgroundColor: "#141414", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#2b2b2b" }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={{ flex: 1, fontWeight: "700", fontSize: fs(15), color: "#fff" }} numberOfLines={1}>{b.name}</Text>
                      <Pressable onPress={() => setBubbles(prev => prev.filter((_, i) => i !== idx))} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#f87171", fontWeight: "900", fontSize: fs(13) }}>✕</Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: "row", marginTop: 12, alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: fs(10), fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>PRI</Text>
                        <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "800", fontSize: fs(16), color: "#fff" }}>{fmt(b.costPrice, 2)}</Text>
                        <Text style={{ fontSize: fs(10), color: "#8e8e93", fontWeight: "600" }}>G / {b.unitName ?? b.unit ?? "pcs"}</Text>
                      </View>
                      <View style={{ alignItems: "center", marginHorizontal: 6 }}>
                        <Text style={{ fontSize: fs(10), fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>QTÉ</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
                          <Pressable onPress={() => decBubble(idx)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontWeight: "900", fontSize: fs(16), color: "#fff" }}>−</Text>
                          </Pressable>
                          <Pressable onPress={() => openEditSheet(idx, b)} style={{ width: 52, height: 34, borderRadius: 8, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontWeight: "900", ...monoStyle, fontSize: fs(15), color: "#fff" }}>{b.qty}</Text>
                          </Pressable>
                          <Pressable onPress={() => incBubble(idx)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2f80ed", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "white", fontWeight: "900", fontSize: fs(16) }}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={{ fontSize: fs(10), fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>SOU-TOTAL</Text>
                        <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "900", fontSize: fs(15), color: "#fff" }}>{fmtG(b.qty * b.costPrice)}</Text>
                      </View>
                    </View>
                    {Number(b.factor) > 1 ? (
                      <Text style={{ fontSize: fs(10), color: "#8e8e93", marginTop: 8 }}>{fmt(b.qty * Number(b.factor))} inite baz</Text>
                    ) : null}
                  </Pressable>
                ))}
                {!bubbles.length ? (
                  <View style={{ backgroundColor: inv.card, borderWidth: 1, borderColor: inv.border, borderRadius: 18, padding: 20, alignItems: "center" }}>
                    <Text style={{ color: inv.sub, fontWeight: "600", fontSize: fs(12) }}>Pwodwi vid</Text>
                    <Text style={{ color: inv.faint, fontSize: fs(11), marginTop: 4, textAlign: "center" }}>Fèmen epi ajoute atik sou lis la.</Text>
                  </View>
                ) : null}
              </ScrollView>
              {/* Foot — same #141414 card the checkout cart foot uses; only the
                  total stays pinned at every list length (close via ✕, then the
                  header's "Pri vann" advances). */}
              <View style={{ padding: 12, borderTopWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 18, padding: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: fs(16), fontWeight: "800", color: "#fff" }}>Total acha</Text>
                    <Text style={{ fontSize: fs(17), fontWeight: "900", color: "#2f80ed", ...monoStyle }}>{fmtG(itemsCost())}</Text>
                  </View>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderReviewSheet() {
    // In-tree overlay, not a Modal: on Android every Modal is its own native
    // window, and presenting one while the transition card's dialog is going
    // away is silently rejected (the sheet never appears). Painted by the same
    // window as the step content, it cannot be dropped like that.
    if (!showReview) return null;
    const lines = foldedLines();
    const unresolved = recommendations.filter(r => !decisions[r.itemId]);
    const saving = recommendations.reduce((s, r) => s + (decisions[r.itemId] === "keep" ? 0 : r.totalSaving), 0);
    return (
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }}>
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 680), width: "100%", flex: 1, backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, overflow: "hidden" }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="document-text-outline" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: fs(15), color: inv.text }}>Revizyon livrezon</Text>
                    <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 1 }}>{supName(supplierId)} · {lines.length} atik · {fmtG(lines.reduce((s, l) => s + l.lineTotal, 0))}</Text>
                  </View>
                </View>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>

                {error ? <View style={{ marginTop: 10 }}>{errBox(error)}</View> : null}

                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Dat livrezon *</Text>
                  <Pressable onPress={() => setShowDatePicker(v => !v)} style={{ height: 52, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6 }}>
                    <Ionicons name="calendar-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs(13) }}>{date.toLocaleDateString()}</Text>
                    <Ionicons name="chevron-down" size={14} color={inv.sub} style={{ marginLeft: "auto" }} />
                  </Pressable>
                  {showDatePicker && (
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {[{ label: "Jodi a", delta: 0 }, { label: "Yè", delta: -1 }, { label: "2 jou", delta: -2 }].map(o => (
                        <Pressable key={o.label} onPress={() => { const d = new Date(); d.setDate(d.getDate() + o.delta); setDate(d); setShowDatePicker(false); }} style={{ backgroundColor: inv.tile, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: inv.borderStrong }}>
                          <Text style={{ fontSize: fs(11), fontWeight: "700", color: "#fff" }}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {canViewItemCost && recommendations.length > 0 && (
                  <View style={{ marginTop: 14, backgroundColor: inv.amberBg, borderWidth: 1, borderColor: inv.amberBd, borderRadius: 16, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="swap-horizontal-outline" size={15} color={inv.amber} />
                      <Text style={{ fontWeight: "800", fontSize: fs(13), color: inv.amber }}>Gen pi bon mache</Text>
                      {saving > 0 && <Text style={{ fontSize: fs(11), fontWeight: "800", color: inv.amber, marginLeft: "auto" }}>−{fmtG(saving)} HTG</Text>}
                    </View>
                    <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 3 }}>
                      {unresolved.length ? `${unresolved.length} pou rezoud.` : "Tout rezoud."} Split = kreye batch atik la dirèkteman ak founisè ki pi bon mache a (menm kantite, pri pa l).
                    </Text>
                    {recommendations.map(r => {
                      const d = decisions[r.itemId];
                      const line = lines.find(l => l.itemId === r.itemId);
                      return (
                        <View key={r.itemId} style={{ marginTop: 10, backgroundColor: inv.card, borderRadius: 12, borderWidth: 0.5, borderColor: inv.border, padding: 10, opacity: r.stale ? 0.6 : 1 }}>
                          <Text style={{ fontWeight: "800", fontSize: fs(12), color: inv.text }} numberOfLines={1}>{line?.productName ?? r.itemId}</Text>
                          <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 2 }}>
                            {supName(r.currentSupplierId)} {fmtG(r.currentUnitCost)} → {r.cheaperSupplierName || supName(r.cheaperSupplierId)} {fmtG(r.cheaperUnitCost)}
                            {" · "}eparg {fmtG(r.totalSaving)} HTG
                          </Text>
                          {r.stale && <Text style={{ fontSize: fs(10), color: inv.faint, marginTop: 2}}>Done ki granmoun — verifye anvan.</Text>}
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                            <Pressable onPress={() => setDecisions(prev => ({ ...prev, [r.itemId]: "split" }))} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: d === "split" ? "#fff" : inv.borderStrong, backgroundColor: d === "split" ? "#fff" : "transparent" }}>
                              <Text style={{ fontWeight: "800", fontSize: fs(12), color: d === "split" ? "#000" : "#fff" }}>Chwazi {r.cheaperSupplierName || "li"}</Text>
                            </Pressable>
                            <Pressable onPress={() => setDecisions(prev => ({ ...prev, [r.itemId]: "keep" }))} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: d === "keep" ? inv.amber : inv.borderStrong, backgroundColor: d === "keep" ? inv.amberBg : "transparent" }}>
                              <Text style={{ fontWeight: "800", fontSize: fs(12), color: d === "keep" ? inv.amber : "#fff" }}>Rete ak {supName(r.currentSupplierId)}</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={{ marginTop: 14, gap: 6 }}>
                  <Text style={{ fontSize: fs(11), fontWeight: "800", color: inv.text, letterSpacing: 0.6 }}>ATIK ({lines.length})</Text>
                  {lines.map(l => (
                    <View key={l.itemId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: fs(12), color: inv.text, flex: 1 }} numberOfLines={1}>{l.productName}</Text>
                      <Text style={{ fontSize: fs(12), color: inv.sub }}>{l.qty} × {fmtG(l.unitCost, 2)}</Text>
                      <Text style={{ fontSize: fs(12), fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(l.lineTotal)}</Text>
                    </View>
                  ))}
                  <View style={{ height: 1, backgroundColor: inv.hairline, marginTop: 4 }} />
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontSize: fs(12), color: inv.sub, flex: 1 }}>Total atik</Text>
                    <Text style={{ fontSize: fs(15), fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(lines.reduce((s, l) => s + l.lineTotal, 0))}</Text>
                  </View>
                  <Text style={{ fontSize: fs(10), color: inv.faint }}>Frè transpò antre nan etap Transpò a epi li distribye otomatikman sou chak atik.</Text>
                </View>

              </ScrollView>
              <View style={{ flexDirection: "row", gap: 8, padding: 16, paddingBottom: (Platform.OS === "android" ? keyboardH : 0) + 20, borderTopWidth: 0.5, borderColor: inv.hairline }}>
                <Pressable onPress={() => { setShowReview(false); setError(""); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}>
                    <Text style={{ fontWeight: "700", color: "#fff", fontSize: fs(14) }}>Retounen</Text>
                  </Pressable>
                  <Pressable onPress={handleSave} disabled={busy || unresolved.length > 0} style={{ flex: 2, paddingVertical: 14, backgroundColor: busy || unresolved.length > 0 ? inv.tile : "#fff", borderRadius: 12, alignItems: "center" }}>
                    <Text style={{ color: busy || unresolved.length > 0 ? inv.faint : "#000", fontWeight: "800", fontSize: fs(14) }}>
                      {busy ? "Ap anrejistre…" : "✓ Anrejistre"}
                    </Text>
                  </Pressable>
                </View>
              </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  if (!canInventory) return null;

  return (
    <View style={{ flex: 1 }}>
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      {renderAddSheet()}
      {renderCartSheet()}
      {renderReviewSheet()}
      <UploadTransition visible={upBusy} phase={upPhase} title={upTitle} detail={upMsg} />
    </View>
  );
}

function EmptyState({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) {
  return (
    <View style={{ backgroundColor: inv.card, borderWidth: 0.5, borderColor: inv.border, borderRadius: 20, padding: 28, alignItems: "center", gap: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={26} color={inv.sub} />
      </View>
      <Text style={{ fontWeight: "800", fontSize: fs(14), color: inv.text, marginTop: 4 }}>{title}</Text>
      <Text style={{ fontSize: fs(12), color: inv.sub, textAlign: "center", lineHeight: 17 }}>{sub}</Text>
    </View>
  );
}
