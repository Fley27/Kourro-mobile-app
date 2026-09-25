import React, { useEffect, useState } from "react";
import { radius, shadow } from "../theme";
import { View, Text, Pressable, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform, Modal, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../db";
import type { Role } from "../users";
import { fmtG, fmt, monoStyle } from "../format";
import { useResponsive, sheetBox } from "../responsive";
import {
  loadPricing, getUnitsForProduct,
  getDefaultUnit, getDisplayPrice, type PricingMaps,
} from "../pricing";
import {
  loadCatalogModel, currentBaseCost, mergeV2Batch, receiveV2Batch,
  currentVariantPrice, type Batch, type Item, type Variant,
} from "../catalogModel";
import {
  isGoods, statusForProduct, ProductCard, catalogDark,
} from "./CatalogShared";

type Category = { id: string; name: string; icon: string; color: string };
type Product = { id: string; name: string; sku?: string; barcode?: string; category_id?: string; stock_quantity: number; low_stock_threshold: number; cost_price: number; selling_price?: number; unit?: string };
type InvBubble = { productId: string; name: string; sku?: string; unitId: string; unitName: string; factor: number; unit?: string; qty: number; costPrice: number; sellPrice: number };

// One system: Inventory deliveries ARE catalog v2 batches (item + supplier +
// date + qty + total). Nouvo livrezon writes pending rows, Ap vini receives
// them, Istwa shows received/denied. Legacy stock_batches/movements are
// migrated once at startup (migrateInventoryBatches) and never read here.

// Dark tokens — catalog language (black + #1C1C1E cards + #2b2b2b tiles +
// white/gray text). Semantic greens/reds are lifted so they read on black.
const inv = {
  ...catalogDark,
  green: "#4cae7f",
  greenBg: "rgba(76,174,127,0.12)",
  greenBd: "rgba(76,174,127,0.35)",
  red: "#e06c5b",
  redBg: "rgba(224,108,91,0.12)",
  redBd: "rgba(224,108,91,0.4)",
  blue: "#4B9BFF",
} as const;

function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];
/** "2025-07-14" → "14 jiyè 2025". */
function fmtDateHt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const mi = Math.min(12, Math.max(1, parseInt(m[2], 10)));
  return `${parseInt(m[3], 10)} ${HT_MONTHS[mi - 1]} ${m[1]}`;
}

type DeliverLine = { batch: Batch; productId: string; productName: string; itemName: string };
type DeliverGroup = {
  key: string; ref: string; supplierId: string; supplierName: string;
  date: string; status: string; lines: DeliverLine[]; latest: number;
  transport: number;
};

export default function InventoryScreen({ role = "cashier", currentUser, onClose, onSaved }: { role?: Role; currentUser?: any; onClose: () => void; onSaved?: () => void }) {
  const { width, isTablet, padH } = useResponsive();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCategories, setProductCategories] = useState<{ product_id: string; category_id: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [batchItems, setBatchItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [invStep, setInvStep] = useState<1 | 2>(1);
  const [invBubbles, setInvBubbles] = useState<InvBubble[]>([]);
  const [invSelectedProduct, setInvSelectedProduct] = useState<Product | null>(null);
  const [invSelUnitId, setInvSelUnitId] = useState<string>("");
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [costByProduct, setCostByProduct] = useState<Map<string, number>>(new Map());
  const [invInputQty, setInvInputQty] = useState("");
  const [invInputCost, setInvInputCost] = useState("");
  const [invInputSell, setInvInputSell] = useState("");
  const [invEditIdx, setInvEditIdx] = useState<number | null>(null);
  const [invShowCart, setInvShowCart] = useState(false);
  const [invError, setInvError] = useState("");
  const [invSupplierId, setInvSupplierId] = useState("");
  const [invTransport, setInvTransport] = useState("");
  const [invDate, setInvDate] = useState<Date>(new Date());
  const [invShowDatePicker, setInvShowDatePicker] = useState(false);
  const [invProductSearch, setInvProductSearch] = useState("");
  const [invLowOnly, setInvLowOnly] = useState(false);
  // Post-save price review: batch saved (pending) → offer new effective-dated
  // variant_prices (history preserved, never overwritten).
  type PriceReviewRow = { variantId: string; itemName: string; variant: string; current: number; price: string };
  type PriceReviewProduct = { productId: string; name: string; rows: PriceReviewRow[] };
  const [priceReview, setPriceReview] = useState<PriceReviewProduct[] | null>(null);
  const [priceReviewSummary, setPriceReviewSummary] = useState("");

  // Android uses softwareKeyboardLayoutMode="pan" (see app.json), so
  // KeyboardAvoidingView behavior="height" never shrinks inside a Modal.
  // Track keyboard height manually to pad the sheet above the keyboard.
  const [invKeyboardH, setInvKeyboardH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setInvKeyboardH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setInvKeyboardH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const canInventory = role === "owner" || role === "admin" || role === "manager";
  // Receiving + cost visibility (Inventory matrix): managers see batch totals
  // and transport but never per-item cost; cashiers see items + quantities +
  // total cost only; associate/cook/server have no access.
  const canReceive = role === "owner" || role === "admin" || role === "manager" || role === "cashier";
  const canViewItemCost = role === "owner" || role === "admin";
  const canViewBatchMeta = role === "owner" || role === "admin" || role === "manager";
  // Main screen is the delivery list: one status tag at a time. The Nouvo
  // livrezon creation flow opens behind the + button (creating).
  const [statusTag, setStatusTag] = useState<"pending" | "received" | "denied">("pending");
  const [creating, setCreating] = useState(false);
  const [invPickSearch, setInvPickSearch] = useState("");
  const [deliverGroup, setDeliverGroup] = useState<DeliverGroup | null>(null);
  const [deliverFee, setDeliverFee] = useState("");
  const [delivering, setDelivering] = useState(false);

  async function load() {
    const db = await getDb();
    try {
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE (is_deleted=0 OR is_deleted IS NULL) AND (status IS NULL OR status = 'active')")) as Product[];
      setProducts(rows);
      const pc = (await db.getAllAsync("SELECT * FROM product_categories")) as any[];
      setProductCategories(pc);
      const cats = (await db.getAllAsync("SELECT * FROM categories")) as any[];
      setCategories(cats);
      try {
        setPricing(await loadPricing(db));
      } catch (e) { console.log("[Inventory pricing] failed:", e); }
      try {
        const ss = (((await db.getAllAsync("SELECT id, name FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => [])) ?? []) as any[])
          .map((s: any) => ({ id: String(s.id), name: String(s.name ?? "—") }));
        setSuppliers(ss);
      } catch { setSuppliers([]); }
      try {
        const model = await loadCatalogModel(db);
        setBatchItems((model.items ?? []).filter((i: any) => !i.is_deleted));
        setVariants(((model.variants ?? []) as Variant[]).filter(v => !v.is_deleted));
        setBatches(((model.batches ?? []) as Batch[]).filter(b => !b.is_deleted));
        const map = new Map<string, number>();
        for (const p of rows) map.set(p.id, currentBaseCost(model.items, model.batches, p.id));
        setCostByProduct(map);
      } catch {
        setBatchItems([]);
        setVariants([]);
        setBatches([]);
        setCostByProduct(new Map());
      }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function displayPriceNum(p: Product): number {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return d.price;
    return Number(p.selling_price ?? 0) || 0;
  }
  function unitsFor(productId: string) {
    return getUnitsForProduct(pricing, productId);
  }
  function defaultUnitName(productId: string): string {
    return getDefaultUnit(unitsFor(productId))?.unit_name ?? "pcs";
  }
  function selUnit() {
    if (!invSelectedProduct) return null;
    const us = unitsFor(invSelectedProduct.id);
    return us.find(u => u.id === invSelUnitId) ?? getDefaultUnit(us);
  }
  /** Current sell price of a unit (Regular preferred) — follows the selected unit. */
  function unitSellPrice(unitId: string): string {
    if (!unitId) return "";
    const rows = pricing.prices.filter(r => r.unit_id === unitId);
    const row = rows.find(r => r.variant === "Regular") ?? rows[0];
    return row && Number(row.price) > 0 ? String(row.price) : "";
  }
  const supName = (id: string) => suppliers.find(s => s.id === id)?.name ?? "?";

  function getProductCats(productId: string): string[] {
    const linked = productCategories.filter(pc => pc.product_id === productId).map(pc => pc.category_id);
    if (linked.length) return linked;
    const prod = products.find(p => p.id === productId);
    if (prod?.category_id) return [prod.category_id];
    return [];
  }
  function getProductCategoriesDisplay(productId: string): Category[] {
    const ids = getProductCats(productId);
    return ids.map(id => categories.find(c => c.id === id)).filter(Boolean) as Category[];
  }
  function visibleProducts(): Product[] {
    const qq = invPickSearch.trim().toLowerCase();
    return products.filter(p => {
      if (!isGoods(p)) return false; // services carry no stock — never receivable
      if (invLowOnly && !((p.stock_quantity ?? 0) <= (p.low_stock_threshold ?? 0))) return false;
      if (!qq) return true;
      return p.name.toLowerCase().includes(qq) || (p.sku ?? "").toLowerCase().includes(qq) || (p.barcode ?? "").toLowerCase().includes(qq);
    });
  }

  function invTotalItemsCost() {
    return invBubbles.reduce((s, b) => s + b.qty * b.costPrice, 0);
  }
  function invTotalTransport() {
    return parseFloat(invTransport) || 0;
  }

  // Group v2 batches into delivery cards (delivery_ref, else supplier ×
  // date × status for rows that predate refs).
  function groupBatches(statuses: string[], qq: string): DeliverGroup[] {
    const map = new Map<string, DeliverGroup>();
    for (const b of batches) {
      const st = String(b.status ?? "pending");
      if (!statuses.includes(st)) continue;
      const it = batchItems.find(i => i.id === String(b.item_id));
      if (!it) continue;
      const prod = products.find(p => p.id === String(it.product_id));
      const ref = String((b as any).delivery_ref ?? "");
      const key = ref || `${b.supplier_id}|${b.date}|${st}`;
      let g = map.get(key);
      if (!g) {
        g = { key, ref, supplierId: String(b.supplier_id), supplierName: supName(String(b.supplier_id)), date: String(b.date ?? ""), status: st, lines: [], latest: 0, transport: 0 };
        map.set(key, g);
      }
      const ts = Date.parse(String((b as any).created_at ?? "")) || 0;
      if (ts > g.latest) g.latest = ts;
      g.transport += Number((b as any).transport_share) || 0;
      g.lines.push({
        batch: b, productId: String(it.product_id),
        productName: prod?.name ?? "?", itemName: it.name,
      });
    }
    // Header search filters deliveries by ref, supplier, date, product/unit.
    let out = [...map.values()];
    if (qq) {
      out = out.filter(g =>
        g.ref.toLowerCase().includes(qq) ||
        g.supplierName.toLowerCase().includes(qq) ||
        g.date.includes(qq) ||
        g.lines.some(l => l.productName.toLowerCase().includes(qq) || l.itemName.toLowerCase().includes(qq))
      );
    }
    // Most recent first (creation time, then batch date as tiebreak).
    out.sort((a, b) => (b.latest - a.latest) || String(b.date ?? "").localeCompare(String(a.date ?? "")));
    for (const g of out) g.lines.sort((a, b) => a.productName.localeCompare(b.productName));
    return out;
  }
  const deliveryQuery = invProductSearch.trim().toLowerCase();
  const shownGroups = React.useMemo(
    () => groupBatches([statusTag], deliveryQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, batchItems, products, suppliers, statusTag, deliveryQuery]
  );
  const statusCounts = React.useMemo(() => ({
    pending: groupBatches(["pending"], "").length,
    received: groupBatches(["received"], "").length,
    denied: groupBatches(["denied"], "").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [batches, batchItems, products, suppliers]);

  async function handleCreateInventory() {
    if (!canInventory) return Alert.alert("Pa gen dwa", "Se sèlman Owner/Admin/Manager ka fè antre stòk");
    if (invBubbles.length === 0) { setInvError("Ajoute omwen yon pwodwi nan livrezon an"); return; }
    for (const b of invBubbles) {
      if (isNaN(b.qty) || b.qty <= 0) { setInvError(`Kantite pa valab pou ${b.name}`); return; }
      if (isNaN(b.costPrice) || b.costPrice < 0) { setInvError(`Pri acha pa valab pou ${b.name}`); return; }
    }
    if (!suppliers.some(s => s.id === invSupplierId)) { setInvError("Chwazi founisè a."); return; }
    const transport = invTotalTransport();
    if (transport < 0) { setInvError("Frè transpò pa valab"); return; }
    const dateStr = todayStr(invDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { setInvError("Dat la pa valab."); return; }
    // Same item folds into one line (qty adds, totals add); transport spreads
    // by line weight and folds into each line's total (revient basis).
    const folded = new Map<string, { itemId: string; qty: number; lineTotal: number }>();
    for (const b of invBubbles) {
      const e = folded.get(b.unitId);
      const lt = b.qty * b.costPrice;
      if (e) { e.qty += b.qty; e.lineTotal += lt; }
      else folded.set(b.unitId, { itemId: b.unitId, qty: b.qty, lineTotal: lt });
    }
    const lines = [...folded.values()];
    const totalItems = lines.reduce((s, l) => s + l.lineTotal, 0);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(batches.map(b => b.id));
      const model = await loadCatalogModel(db);
      // One delivery = one ref shared by all its lines.
      const deliveryRef = `LIV-${Date.now().toString().slice(-6)}`;
      for (const l of lines) {
        const share = totalItems > 0 ? transport * (l.lineTotal / totalItems) : transport / lines.length;
        taken.add(await mergeV2Batch(db, now, taken, {
          itemId: l.itemId, supplierId: invSupplierId,
          qty: l.qty, total: l.lineTotal + share, date: dateStr,
          deliveryRef, transportShare: share, source: "inventory",
        }));
      }
      const summary = `${supName(invSupplierId)} · ${dateStr} · ${lines.length} atik • ${fmtG(totalItems + transport)} (transpò ${fmtG(transport)}). Stòk la parèt nan "Ap vini" jouk li rive.`;
      // Opportunity: new sell prices for the touched variants — only offered
      // when the batch saved successfully. Snapshot current rows.
      const review: PriceReviewProduct[] = [];
      const liveVariants = (model.variants ?? []).filter((v: any) => !v.is_deleted);
      for (const b of invBubbles) {
        const itemVars = liveVariants.filter((v: any) => String(v.item_id) === String(b.unitId));
        if (!itemVars.length) continue;
        const rows: PriceReviewRow[] = [];
        for (const v of itemVars) {
          const cur = currentVariantPrice(model.variantPrices ?? [], String(v.id));
          const curNum = cur ? Number(cur.price) || 0 : 0;
          // Preset the bubble's sell price when it pins one variant (single
          // or generic); otherwise prefill the live price for review.
          const single = itemVars.length === 1;
          const generic = ["standard", "regular", "default"].includes(String(v.name ?? "").trim().toLowerCase());
          const preset = b.sellPrice > 0 && (single || generic) ? String(b.sellPrice) : String(curNum > 0 ? curNum : "");
          rows.push({ variantId: String(v.id), itemName: b.unitName, variant: String(v.name ?? ""), current: curNum, price: preset });
        }
        if (rows.length) {
          const prev = review.find(r => r.productId === b.productId);
          if (prev) prev.rows.push(...rows);
          else review.push({ productId: b.productId, name: b.name, rows });
        }
      }
      await load();
      if (!review.length) {
        Alert.alert("Livrezon anrejistre ✓", summary);
        resetDraft();
        setCreating(false);
        onSaved?.();
        return;
      }
      try {
        setPricing(await loadPricing(db));
      } catch {}
      setPriceReviewSummary(summary);
      setPriceReview(review);
      return;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setInvError(`Erè baz done: ${msg}`);
      Alert.alert("Erè", `Livrezon an pa anrejistre: ${msg}`);
      return;
    }
  }

  async function finishPriceReview(save: boolean) {
    if (save && priceReview) {
      try {
        const db = await getDb();
        const now = new Date().toISOString();
        const dateStr = todayStr();
        const existing = (((await db.getAllAsync("SELECT id FROM variant_prices").catch(() => [])) ?? []) as any[])
          .map((r: any) => String(r.id));
        const taken = new Set<string>(existing);
        for (const p of priceReview) {
          for (const r of p.rows) {
            const v = parseFloat(r.price);
            if (isNaN(v) || v <= 0) continue; // empty/invalid = keep unchanged
            if (r.current > 0 && v === r.current) continue; // unchanged = no new row
            let id = `vpr-${r.variantId}-${dateStr}`;
            let n = 2;
            while (taken.has(id)) id = `vpr-${r.variantId}-${dateStr}-${n++}`;
            taken.add(id);
            await db.runAsync(
              "INSERT INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
              [id, r.variantId, v, dateStr, now, now, 0, 1]
            );
            try {
              const { insertOutbox } = await import("../db");
              await insertOutbox("variant_prices", "create", { id, variant_id: r.variantId, price: v, date: dateStr, created_at: now, updated_at: now, is_deleted: false });
            } catch {}
          }
        }
        setPricing(await loadPricing(db));
      } catch (e: any) {
        Alert.alert("Erè", `Pri yo pa sove nèt: ${e?.message ?? e}`);
        return; // stay open so nothing is lost
      }
    }
    setPriceReview(null);
    resetDraft();
    setCreating(false);
    onSaved?.();
  }

  function resetDraft() {
    setInvBubbles([]);
    setInvSupplierId("");
    setInvTransport("");
    setInvDate(new Date());
    setInvStep(1);
    setInvPickSearch("");
    setInvError("");
  }

  function setReviewRowPrice(pi: number, ri: number, v: string) {
    setPriceReview(prev => prev ? prev.map((p, i) => i === pi ? { ...p, rows: p.rows.map((r, j) => j === ri ? { ...r, price: v.replace(/[^0-9.]/g, "") } : r) } : p) : prev);
  }

  function invOpenAddSheet(p: Product) {
    setInvSelectedProduct(p);
    setInvEditIdx(null);
    const units = unitsFor(p.id);
    const du = getDefaultUnit(units);
    setInvSelUnitId(du?.id ?? "");
    setInvInputQty("");
    setInvInputCost((costByProduct.get(p.id) ?? 0) > 0 ? String(costByProduct.get(p.id)) : "");
    const dp = getDisplayPrice(pricing, p.id);
    setInvInputSell(dp && dp.price > 0 ? String(dp.price) : (p.selling_price ? String(p.selling_price) : ""));
    setInvError("");
  }
  function invOpenEditSheet(idx: number, bubble: InvBubble) {
    const p = products.find(pr => pr.id === bubble.productId) ?? null;
    setInvSelectedProduct(p);
    setInvEditIdx(idx);
    setInvSelUnitId(bubble.unitId ?? "");
    setInvInputQty(String(bubble.qty));
    setInvInputCost(String(bubble.costPrice));
    setInvInputSell(String(bubble.sellPrice > 0 ? bubble.sellPrice : unitSellPrice(bubble.unitId ?? "")));
    setInvError("");
    setInvShowCart(false);
  }
  function invCloseAddSheet() {
    setInvSelectedProduct(null);
    setInvEditIdx(null);
    setInvSelUnitId("");
    setInvInputQty(""); setInvInputCost(""); setInvInputSell("");
  }
  function handleInvAjoute() {
    if (!invSelectedProduct) return;
    const qty = parseFloat(invInputQty) || 0;
    const cost = parseFloat(invInputCost) || 0;
    const sell = parseFloat(invInputSell) || 0;
    if (qty <= 0) { setInvError("Antre yon kantite valid (> 0)"); return; }
    if (cost < 0) { setInvError("Pri acha pa ka negatif"); return; }
    if (sell < 0) { setInvError("Pri vann pa ka negatif"); return; }
    const units = unitsFor(invSelectedProduct.id);
    const u = units.find(x => x.id === invSelUnitId) ?? getDefaultUnit(units);
    const unitId = u?.id ?? "";
    const unitName = u?.unit_name ?? invSelectedProduct.unit ?? "Unit";
    const factor = Number(u?.conversion_factor) || 1;
    const bubble: InvBubble = { productId: invSelectedProduct.id, name: invSelectedProduct.name, sku: invSelectedProduct.sku, unitId, unitName, factor, unit: unitName, qty, costPrice: cost, sellPrice: sell };
    if (invEditIdx !== null) {
      setInvBubbles(prev => prev.map((b, i) => i === invEditIdx ? bubble : b));
    } else {
      const existing = invBubbles.findIndex(b => b.productId === bubble.productId && (b.unitId || "") === (bubble.unitId || ""));
      if (existing >= 0) {
        setInvBubbles(prev => prev.map((b, i) => i === existing ? { ...b, qty: b.qty + bubble.qty, costPrice: bubble.costPrice, sellPrice: bubble.sellPrice } : b));
      } else {
        setInvBubbles(prev => [...prev, bubble]);
      }
    }
    invCloseAddSheet();
  }

  async function handleDeliverGroup(g: DeliverGroup, extraFeeInput: string) {
    if (!canReceive) return Alert.alert("Pa gen dwa", "Ou pa ka resevwa livrezon.");
    if (!g.lines.length) return;
    const extra = Math.max(0, parseFloat(extraFeeInput) || 0);
    setDelivering(true);
    try {
      const db = await getDb();
      const total = g.lines.reduce((s, l) => s + (Number(l.batch.total_paid) || 0), 0);
      let done = 0;
      const failed: string[] = [];
      for (const l of g.lines) {
        const share = total > 0
          ? extra * ((Number(l.batch.total_paid) || 0) / total)
          : extra / g.lines.length;
        try {
          await receiveV2Batch(db, {
            batchId: l.batch.id, productId: l.productId, itemId: String(l.batch.item_id),
            quantity: Number(l.batch.quantity), receivedBy: currentUser?.id ?? "system",
            extraTotal: Math.round(share * 100) / 100,
          });
          done++;
        } catch {
          failed.push(l.productName);
        }
      }
      if (failed.length) {
        Alert.alert("Rive pasyèl", `${done} atik rive${extra > 0 ? ` • +${fmtG(extra)} frè anplis` : ""}. Echwe: ${failed.join(", ")}`, [
          { text: "OK", onPress: () => { setDeliverGroup(null); setDeliverFee(""); } }
        ]);
      } else {
        Alert.alert("Livrezon rive ✓", `${g.supplierName} · ${g.date} • ${done} atik ajoute nan stòk${extra > 0 ? ` • +${fmtG(extra)} frè anplis` : ""}`, [
          { text: "OK", onPress: () => { setDeliverGroup(null); setDeliverFee(""); } }
        ]);
      }
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Imposib delivre livrezon an");
    }
    setDelivering(false);
    load();
  }

  function handleInvRemoveBubble(idx: number) {
    setInvBubbles(prev => prev.filter((_, i) => i !== idx));
  }

  function errBox(msg: string) {
    if (!msg) return null;
    return (
      <View style={{ backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, borderRadius: 12, padding: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: inv.red }}>{msg}</Text>
      </View>
    );
  }

  function emptyState(icon: keyof typeof Ionicons.glyphMap, title: string, sub: string) {
    return (
      <View style={{ backgroundColor: inv.card, borderWidth: 0.5, borderColor: inv.border, borderRadius: 20, padding: 28, alignItems: "center", gap: 8 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={26} color={inv.sub} />
        </View>
        <Text style={{ fontWeight: "800", fontSize: 14, color: inv.text, marginTop: 4 }}>{title}</Text>
        <Text style={{ fontSize: 12, color: inv.sub, textAlign: "center", lineHeight: 17 }}>{sub}</Text>
      </View>
    );
  }

  // Warm delivery-card language: paper text on warm charcoal, blue AP VINI
  // pill, gold total, orange Rive button.
  const paper = "#f6f1e4";
  const paperSub = "#a89f88";
  const cardBg = "#211d14";
  const cardBd = "rgba(246,241,228,0.12)";
  const cardDiv = "rgba(246,241,228,0.08)";
  const pillBlue = "#4da3e0";
  const pillBlueBg = "rgba(77,163,224,0.16)";
  const pillBlueBd = "rgba(77,163,224,0.35)";
  const gold = "#e0a83c";
  const orange = "#dd8a3e";

  function statusPill(status: string) {
    if (status === "received") {
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: inv.greenBg, borderWidth: 1, borderColor: inv.greenBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="checkmark" size={9} color={inv.green} />
          <Text style={{ fontSize: 10, fontWeight: "800", color: inv.green, letterSpacing: 0.3 }}>RIVE</Text>
        </View>
      );
    }
    if (status === "denied") {
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="close" size={9} color={inv.red} />
          <Text style={{ fontSize: 10, fontWeight: "800", color: inv.red, letterSpacing: 0.3 }}>REFIZE</Text>
        </View>
      );
    }
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: pillBlueBg, borderWidth: 1, borderColor: pillBlueBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
        <Text style={{ fontSize: 10, fontWeight: "800", color: pillBlue, letterSpacing: 0.3 }}>AP VINI</Text>
      </View>
    );
  }

  function renderGroupCard(g: DeliverGroup, opts: { receive: boolean }) {
    const groupTotal = g.lines.reduce((s, l) => s + (Number(l.batch.total_paid) || 0), 0);
    const isPending = g.status === "pending";
    const shown = g.lines.slice(0, 3);
    const rest = g.lines.length - shown.length;
    const title = g.ref || fmtDateHt(g.date);
    return (
      <View key={g.key} style={{ backgroundColor: cardBg, borderRadius: 20, borderWidth: 1, borderColor: cardBd, overflow: "hidden" }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "800", fontSize: 17, color: paper, letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>{title}</Text>
            {statusPill(g.status)}
            <View style={{ alignItems: "flex-end", marginLeft: 4 }}>
              <Text style={{ fontSize: 12, color: paperSub }}>{fmtDateHt(g.date)}</Text>
              <Text style={{ fontSize: 12, color: paperSub, marginTop: 1 }}>{g.lines.length} pwodui</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Ionicons name="storefront-outline" size={14} color={paperSub} />
            <Text style={{ fontSize: 14, color: paper, flex: 1 }} numberOfLines={1}>{g.supplierName}</Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: cardDiv }} />
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 9 }}>
          {shown.map(l => (
            <View key={l.batch.id}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ fontSize: 15, color: paper, flex: 1 }} numberOfLines={1}>{l.productName}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: paper }}>{fmt(Number(l.batch.quantity) || 0)} <Text style={{ fontSize: 14, fontWeight: "400", color: paperSub }}>{l.itemName}</Text></Text>
              </View>
              {l.batch.reason ? <Text style={{ fontSize: 11, color: paperSub, marginTop: 2 }}>Rezon: {l.batch.reason}</Text> : null}
            </View>
          ))}
          {rest > 0 && <Text style={{ fontSize: 13, color: paperSub }}>+ {rest} lòt...</Text>}
        </View>
        <View style={{ height: 1, backgroundColor: cardDiv }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
          {canViewBatchMeta && (
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: paperSub }}>Transpò</Text>
                <Text style={{ fontSize: 17, fontWeight: "800", color: paper, marginTop: 2 }}>{fmt(Math.round(g.transport))} <Text style={{ fontSize: 12, fontWeight: "400", color: paperSub }}>HTG</Text></Text>
              </View>
              <View style={{ width: 1, alignSelf: "stretch", backgroundColor: cardDiv }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: paperSub }}>Total</Text>
                <Text style={{ fontSize: 17, fontWeight: "800", color: gold, marginTop: 2 }}>{fmt(Math.round(groupTotal))} <Text style={{ fontSize: 12, fontWeight: "400", color: paperSub }}>HTG</Text></Text>
              </View>
            </>
          )}
          {opts.receive && isPending && canReceive ? (
            <Pressable onPress={() => { setDeliverGroup(g); setDeliverFee(""); }} disabled={delivering} style={{ flex: canViewBatchMeta ? 1.2 : 1, backgroundColor: orange, paddingVertical: 13, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 }}>
              <Ionicons name="cube-outline" size={17} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Rive</Text>
            </Pressable>
          ) : null}
          {g.status === "received" && !canViewBatchMeta ? (
            <View style={{ flex: 1, backgroundColor: inv.greenBg, borderRadius: 14, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: inv.greenBd }}>
              <Ionicons name="checkmark-circle" size={15} color={inv.green} />
              <Text style={{ color: inv.green, fontWeight: "700", fontSize: 13 }}>Nan stòk</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (!canReceive) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed-outline" size={24} color={inv.sub} />
        </View>
        <Text style={{ fontWeight: "800", fontSize: 15, color: inv.text, marginTop: 12 }}>Pa gen aksè</Text>
        <Text style={{ fontSize: 12, color: inv.sub, marginTop: 4, textAlign: "center" }}>Envantè rezève pou jesyon magazen.</Text>
      </View>
    );
  }

  const tags = [
    { k: "pending" as const, label: "Ap vini", count: statusCounts.pending },
    { k: "received" as const, label: "Rive", count: statusCounts.received },
    { k: "denied" as const, label: "Refize", count: statusCounts.denied },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", flex: 1 }}>
      {/* Title + add (Customers header language). + toggles the Nouvo flow. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: padH, paddingTop: 18, paddingBottom: 14 }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Envantè</Text>
        <Pressable
          onPress={() => { if (canInventory) setCreating(v => !v); }}
          disabled={!canInventory}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center", opacity: canInventory ? 1 : 0.4 }}
        >
          <Ionicons name={creating ? "close" : "add"} size={26} color="#fff" />
        </Pressable>
      </View>

      {/* Search pill (filters deliveries on the main list) */}
      {!creating && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, marginBottom: 8 }}>
          <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
            <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
            <TextInput
              value={invProductSearch}
              onChangeText={setInvProductSearch}
              placeholder="Chèche"
              placeholderTextColor="#8e8e93"
              style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
              returnKeyType="search"
            />
            {invProductSearch.length > 0 ? (
              <Pressable onPress={() => setInvProductSearch("")} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={18} color="#8e8e93" />
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
      {/* Status tags: the 3 delivery states */}
      {!creating && (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: padH, paddingTop: 4 }}>
          {tags.map(t => {
            const active = statusTag === t.k;
            return (
              <Pressable
                key={t.k}
                onPress={() => setStatusTag(t.k)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: radius.pill, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}
              >
                <Text style={{ fontSize: 13, fontWeight: "800", color: active ? "#000" : inv.sub }}>{t.label}</Text>
                <View style={{ backgroundColor: active ? "rgba(0,0,0,0.08)" : inv.tile, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: active ? "#000" : inv.sub }}>{t.count}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {creating && canInventory ? (
      invStep === 1 ? (
        <View style={{ flex: 1 }}>
          {/* Product search + low-stock filter (creation flow only) */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, paddingTop: 4, marginBottom: 8 }}>
            <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
              <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
              <TextInput
                value={invPickSearch}
                onChangeText={setInvPickSearch}
                placeholder="Chèche pwodwi..."
                placeholderTextColor="#8e8e93"
                style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
                returnKeyType="search"
              />
              {invPickSearch.length > 0 ? (
                <Pressable onPress={() => setInvPickSearch("")} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={18} color="#8e8e93" />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => setInvLowOnly(v => !v)}
              style={{
                width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
                backgroundColor: invLowOnly ? "#fff" : "#000",
                borderWidth: 1, borderColor: invLowOnly ? "#fff" : "#3a3a3c",
              }}
            >
              <Ionicons name="filter" size={20} color={invLowOnly ? "#000" : "#fff"} />
            </Pressable>
          </View>
          {/* Product list (reusable store cards) */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 12, gap: 10, paddingBottom: invBubbles.length ? 110 : 40, ...(isTablet && { flexDirection: "row" as const, flexWrap: "wrap" as const }) }} showsVerticalScrollIndicator={false}>
            {invError ? errBox(invError) : null}
            {visibleProducts().map(p => {
              const inShip = invBubbles.some(b => b.productId === p.id);
              const card = (
                <ProductCard
                  item={p}
                  role={role}
                  prodCats={getProductCategoriesDisplay(p.id)}
                  status={statusForProduct(p)}
                  recentMoves={[]}
                  displayPrice={displayPriceNum(p)}
                  unitName={defaultUnitName(p.id)}
                  isTablet={isTablet}
                  canEdit={canInventory}
                  canViewCost={canViewItemCost}
                  baseCost={costByProduct.get(p.id)}
                  stockItems={batchItems}
                  variants={variants}
                  selected={inShip}
                  onPress={() => { if (canInventory) invOpenAddSheet(p); }}
                />
              );
              return isTablet ? (
                <View key={p.id} style={{ flexBasis: "48%" as any, flexGrow: 1 }}>{card}</View>
              ) : (
                <View key={p.id}>{card}</View>
              );
            })}
            {products.length === 0 && emptyState("cube-outline", "Katalòg vid", "Kreye pwodwi anvan")}
            {products.length > 0 && visibleProducts().length === 0 && emptyState("search-outline", "Pa gen rezilta", "Chanje rechèch la oswa kategori a")}
          </ScrollView>
          {/* Bubble bar (cart) */}
          {invBubbles.length > 0 && (
            <View style={{ position: "absolute", bottom: 16, left: 14, right: 14, alignItems: "center" }}>
              <Pressable onPress={() => setInvShowCart(true)} style={{ width: "100%", maxWidth: isTablet ? 560 : 390, backgroundColor: inv.card, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", ...shadow.card }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontWeight: "900", color: "#000", fontSize: 13 }}>{invBubbles.length}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontWeight: "800", color: "#fff", fontSize: 12 }}>{invBubbles.length} pwodwi nan livrezon</Text>
                  <Text style={{ fontSize: 10, color: inv.sub, marginTop: 1 }}>Tape pou wè detay · retire · modifye</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14, textAlign: "right", ...monoStyle }}>{fmtG(invBubbles.reduce((s, b) => s + b.qty * b.costPrice, 0))}</Text>
                  <Text style={{ fontSize: 9, color: inv.sub }}>pri acha</Text>
                </View>
                <Ionicons name="chevron-up" size={16} color={inv.sub} style={{ marginLeft: 8 }} />
              </Pressable>
            </View>
          )}
          {/* Add/edit item sheet */}
          <Modal visible={!!invSelectedProduct} transparent animationType="slide" onRequestClose={invCloseAddSheet}>
            <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
              <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
                <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingBottom: Platform.OS === "android" ? invKeyboardH : 0 }}>
                <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 16, paddingBottom: 28 }}>
                  <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: inv.sub, fontWeight: "800", fontSize: 20 }}>{invSelectedProduct?.name?.[0]?.toUpperCase() ?? "•"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "800", fontSize: 15, color: inv.text }} numberOfLines={1}>{invSelectedProduct?.name}</Text>
                      <Text style={{ fontSize: 11, color: inv.sub, marginTop: 1 }}>{invSelectedProduct?.sku ?? ""}{invEditIdx !== null ? " · MODIFYE" : ""}</Text>
                    </View>
                    <Pressable onPress={invCloseAddSheet} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color="#fff" /></Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    {invSelectedProduct && unitsFor(invSelectedProduct.id).map(u => {
                      const active = (invSelUnitId || selUnit()?.id) === u.id;
                      return (
                        <Pressable key={u.id} onPress={() => { setInvSelUnitId(u.id); setInvInputSell(unitSellPrice(u.id)); }} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}>
                          <Text style={{ color: active ? "#000" : "#fff", fontWeight: "700", fontSize: 12 }}>{u.unit_name}{Number(u.conversion_factor) > 1 ? ` ×${u.conversion_factor}` : ""}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Kantite{selUnit() ? ` (${selUnit()!.unit_name})` : ""} *</Text>
                      <TextInput value={invInputQty} onChangeText={v => { setInvInputQty(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, textAlign: "center", fontWeight: "800", fontSize: 16, color: "#fff", backgroundColor: "transparent" }} selectTextOnFocus />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Pri achte G{selUnit() ? ` / ${selUnit()!.unit_name}` : ""} *</Text>
                      <TextInput value={invInputCost} onChangeText={v => { setInvInputCost(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, textAlign: "center", fontWeight: "800", fontSize: 16, color: "#fff", backgroundColor: "transparent" }} selectTextOnFocus />
                    </View>
                  </View>
                  <View style={{ marginTop: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Pri vann{selUnit() ? ` (${selUnit()!.unit_name})` : ""} G</Text>
                      <View style={{ backgroundColor: inv.tile, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: inv.borderStrong }}><Text style={{ fontSize: 10, fontWeight: "800", color: inv.sub }}>KATALÒG</Text></View>
                    </View>
                    <TextInput value={invInputSell} onChangeText={v => { setInvInputSell(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} placeholder="—" placeholderTextColor={inv.faint} keyboardType="numeric" style={{ height: 60, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, textAlign: "center", fontWeight: "800", fontSize: 16, color: "#fff", backgroundColor: "transparent" }} selectTextOnFocus />
                    <Text style={{ fontSize: 10, color: inv.faint, marginTop: 5, textAlign: "center" }}>Pre-ranpli: pri aktyèl katalòg la. Chanje = pwopoze nouvo pri nan revizyon an.</Text>
                  </View>
                  {invError ? <View style={{ marginTop: 10 }}>{errBox(invError)}</View> : null}
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    {invEditIdx !== null && (
                      <Pressable onPress={() => { handleInvRemoveBubble(invEditIdx); invCloseAddSheet(); }} style={{ paddingVertical: 14, paddingHorizontal: 16, backgroundColor: inv.redBg, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: inv.redBd }}>
                        <Ionicons name="trash-outline" size={17} color={inv.red} />
                      </Pressable>
                    )}
                    <Pressable onPress={handleInvAjoute} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12 }}>
                      <Text style={{ color: "#000", fontWeight: "800", fontSize: 14 }}>{invEditIdx !== null ? "✓ Mete ajou" : "✓ Ajoute"}</Text>
                      {((parseFloat(invInputQty) || 0) > 0 && (parseFloat(invInputCost) || 0) > 0) && <View style={{ backgroundColor: inv.tile, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ fontSize: 11, fontWeight: "900", color: "#fff" }}>{fmtG((parseFloat(invInputQty) || 0) * (parseFloat(invInputCost) || 0))}</Text></View>}
                    </Pressable>
                  </View>
                </View>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      ) : (
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0}
          style={{ flex: 1 }}>
          {/* Step 2 header */}
          <View style={{ backgroundColor: "#000", paddingHorizontal: padH, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}><Ionicons name="document-text-outline" size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontWeight: "800", fontSize: 16, color: inv.text }}>Detay livrezon</Text>
                  <View style={{ backgroundColor: "#fff", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}><Text style={{ fontSize: 9, fontWeight: "800", color: "#000" }}>2/2</Text></View>
                </View>
                <Text style={{ fontSize: 11, color: inv.sub, marginTop: 1 }}>{invBubbles.length} pwodwi · {fmt(invBubbles.reduce((s, b) => s + b.qty, 0))} total atik</Text>
              </View>
              <Pressable onPress={() => setInvStep(1)} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "transparent", paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: inv.borderStrong }}>
                <Ionicons name="arrow-back" size={13} color="#fff" />
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>Pwodwi</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1 }} contentContainerStyle={{ padding: padH, paddingTop: 12, gap: 10, paddingBottom: 24 + (Platform.OS === "android" ? invKeyboardH : 0) }} showsVerticalScrollIndicator={false}>
            {invError ? errBox(invError) : null}
            <View style={{ backgroundColor: inv.card, borderRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 14, gap: 12 }}>
              <View>
                <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Founisè *</Text>
                {suppliers.length === 0 ? (
                  <Text style={{ fontSize: 12, color: inv.sub, marginTop: 6 }}>Pa gen founisè — kreye youn nan Founisè.</Text>
                ) : (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {suppliers.map(s => {
                      const active = invSupplierId === s.id;
                      return (
                        <Pressable key={s.id} onPress={() => { setInvSupplierId(active ? "" : s.id); if (invError) setInvError(""); }} style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}>
                          <Text style={{ color: active ? "#000" : "#fff", fontWeight: "700", fontSize: 12 }}>{s.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Frè transpò G</Text>
                  <TextInput value={invTransport} onChangeText={v => { setInvTransport(v); if (invError) setInvError(""); }} placeholder="0" placeholderTextColor={inv.faint} keyboardType="numeric" style={{ height: 52, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                  <Text style={{ fontSize: 10, color: inv.faint, marginTop: 4 }}>Reparti otomatik sou chak atik (revient)</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 12, color: inv.text }}>Dat *</Text>
                  <Pressable onPress={() => setInvShowDatePicker(!invShowDatePicker)} style={{ height: 52, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, backgroundColor: "transparent" }}>
                    <Ionicons name="calendar-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{invDate.toLocaleDateString()}</Text>
                    <Ionicons name="chevron-down" size={14} color={inv.sub} style={{ marginLeft: "auto" }} />
                  </Pressable>
                  {invShowDatePicker && (
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {[{ label: "Jodi a", delta: 0 }, { label: "Yè", delta: -1 }, { label: "2 jou", delta: -2 }].map((o: any) => (
                        <Pressable key={o.label} onPress={() => { const d = new Date(); d.setDate(d.getDate() + o.delta); setInvDate(d); setInvShowDatePicker(false); }} style={{ backgroundColor: inv.tile, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: inv.borderStrong }}>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </View>
            {/* Allocation preview */}
            {invTotalItemsCost() > 0 && invTotalTransport() > 0 && (
              <View style={{ backgroundColor: inv.card, borderWidth: 0.5, borderColor: inv.border, borderRadius: 20, padding: 14 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: inv.text, letterSpacing: 0.6 }}>REPARTISYON TRANSPÒ</Text>
                <View style={{ height: 10, flexDirection: "row", borderRadius: 5, overflow: "hidden", marginTop: 8, backgroundColor: inv.tile }}>
                  {invBubbles.map((b, idx) => {
                    const total = invTotalItemsCost();
                    const pct = total > 0 ? (b.qty * b.costPrice) / total * 100 : 0;
                    const colors = ["#fff", inv.green, inv.blue, "#a78bfa", "#EC4899"];
                    return <View key={idx} style={{ width: `${pct}%` as any, backgroundColor: colors[idx % colors.length] }} />;
                  })}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                  <Text style={{ fontSize: 11, color: inv.sub }}>Total atik {fmtG(invTotalItemsCost())}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>+ {fmtG(invTotalTransport())} → {fmtG(invTotalItemsCost() + invTotalTransport())} revient</Text>
                </View>
              </View>
            )}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, padding: 14, paddingBottom: 14 + (Platform.OS === "android" ? invKeyboardH : 0), backgroundColor: "#000", borderTopWidth: 0.5, borderColor: inv.hairline }}>
            <Pressable onPress={() => setInvStep(1)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}><Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Retounen</Text></Pressable>
            <Pressable onPress={handleCreateInventory} style={{ flex: 2, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "800", fontSize: 14 }}>✓ Anrejistre livrezon</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      )
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 40, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
          {shownGroups.length === 0
            ? deliveryQuery
              ? emptyState("search-outline", "Pa gen rezilta", "Chanje rechèch la.")
              : statusTag === "pending"
                ? emptyState("boat-outline", "Poko gen livrezon ap vini", "Stòk la parèt isit la sèlman lè li rive.")
                : statusTag === "received"
                  ? emptyState("checkmark-circle-outline", "Poko gen livrezon rive", "Livrezon ki rive ap parèt isit la.")
                  : emptyState("close-circle-outline", "Poko gen refi", "Batch ki refize ap parèt isit la.")
            : shownGroups.map(g => renderGroupCard(g, { receive: statusTag === "pending" }))}
        </ScrollView>
      )}

      {/* Deliver pending group — extra cost folds into totals, then receive */}
      <Modal visible={!!deliverGroup} transparent animationType="slide" onRequestClose={() => !delivering && setDeliverGroup(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, overflow: "hidden" }}>
              <View style={{ backgroundColor: "transparent", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.greenBg, borderWidth: 1, borderColor: inv.greenBd, alignItems: "center", justifyContent: "center" }}><Ionicons name="checkmark-circle-outline" size={20} color={inv.green} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15, color: inv.text, letterSpacing: -0.2 }} numberOfLines={1}>{deliverGroup?.supplierName} · {deliverGroup?.date} rive!</Text>
                    <Text style={{ fontSize: 11, color: inv.sub, marginTop: 1 }} numberOfLines={1}>{deliverGroup?.lines.length ?? 0} atik · {fmtG(Math.round((deliverGroup?.lines ?? []).reduce((s, l) => s + (Number(l.batch.total_paid) || 0), 0)))}</Text>
                  </View>
                </View>
              </View>
              <View style={{ padding: 14, gap: 10 }}>
                <View style={{ backgroundColor: "transparent", borderRadius: 16, borderWidth: 1, borderColor: inv.greenBd, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cash-outline" size={15} color={inv.green} /><Text style={{ fontWeight: "800", fontSize: 13, color: inv.text }}>Frè anplis? <Text style={{ fontWeight: "400", color: inv.faint, fontSize: 11 }}>(opsyonèl)</Text></Text></View>
                  <Text style={{ fontSize: 11, color: inv.sub, marginTop: 2 }}>Transpò oswa douan ki rive kounye a — ap ajoute nan pri revand a.</Text>
                  <TextInput
                    placeholder="Eg. 250"
                    placeholderTextColor={inv.faint}
                    value={deliverFee}
                    onChangeText={setDeliverFee}
                    keyboardType="numeric"
                    style={{ height: 56, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 8, fontWeight: "700", fontSize: 15, color: "#fff", backgroundColor: "transparent" }}
                  />
                </View>
                <View style={{ backgroundColor: "transparent", borderRadius: 16, borderWidth: 1, borderColor: inv.border, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cube-outline" size={15} color="#fff" /><Text style={{ fontWeight: "800", fontSize: 13, color: inv.text }}>Atik yo ap vin disponib</Text></View>
                  <Text style={{ fontSize: 11, color: inv.sub, marginTop: 2 }}>Lè ou konfime, kantite yo ap ajoute nan stòk.</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: "transparent", borderTopWidth: 0.5, borderColor: inv.hairline }}>
                <Pressable onPress={() => { setDeliverGroup(null); setDeliverFee(""); }} disabled={delivering} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}><Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Retounen</Text></Pressable>
                <Pressable onPress={() => deliverGroup && handleDeliverGroup(deliverGroup, deliverFee)} disabled={delivering} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "800", fontSize: 14 }}>{delivering ? "Ap delivre…" : "✓ Konfime rive"}</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Post-save: new sell prices per variant (history preserved) */}
      <Modal visible={priceReview !== null} transparent animationType="slide" onRequestClose={() => finishPriceReview(false)}>
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingBottom: Platform.OS === "android" ? invKeyboardH : 0 }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 16, paddingBottom: 28, maxHeight: "88%" }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: inv.greenBg, borderWidth: 1, borderColor: inv.greenBd, alignItems: "center", justifyContent: "center" }}><Ionicons name="pricetag-outline" size={18} color={inv.green} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 14, color: inv.text }}>Livrezon anrejistre ✓</Text>
                    <Text style={{ fontSize: 10, color: inv.sub, marginTop: 1 }} numberOfLines={2}>{priceReviewSummary}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 11, color: inv.sub, marginTop: 10 }}>Nouvo pri vann pa variant — opsyonèl. Vid = kenbe pri aktyèl la. Chanjman an ekri kòm nouvo pri dat jodi a (istwa konsève).</Text>
                {(priceReview ?? []).map((p, pi) => (
                  <View key={p.productId} style={{ marginTop: 10, backgroundColor: inv.tile, borderRadius: 12, padding: 10, borderWidth: 0.5, borderColor: inv.borderStrong }}>
                    <Text style={{ fontWeight: "800", fontSize: 12, color: inv.text }} numberOfLines={1}>{p.name}</Text>
                    {p.rows.map((r, ri) => (
                      <View key={r.variantId} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "600", fontSize: 12, color: inv.text }} numberOfLines={1}>{r.itemName} · {r.variant}</Text>
                          {r.current > 0 && <Text style={{ fontSize: 10, color: inv.faint, marginTop: 1 }}>Kounye a: {fmtG(r.current)}</Text>}
                        </View>
                        <TextInput value={r.price} onChangeText={v => setReviewRowPrice(pi, ri, v)} keyboardType="numeric" placeholder="—" placeholderTextColor={inv.faint} selectTextOnFocus style={{ width: 110, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10, textAlign: "center", fontWeight: "800", fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                      </View>
                    ))}
                  </View>
                ))}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <Pressable onPress={() => finishPriceReview(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}><Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Kite konsa</Text></Pressable>
                  <Pressable onPress={() => finishPriceReview(true)} style={{ flex: 2, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "800", fontSize: 14 }}>✓ Sove pri yo</Text></Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Expanded messenger cart sheet */}
      <Modal visible={invShowCart} transparent animationType="slide" onRequestClose={() => setInvShowCart(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, maxHeight: "80%", overflow: "hidden" }}>
              <View style={{ backgroundColor: "transparent", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: inv.hairline }}>
                <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: inv.tile, borderWidth: 0.5, borderColor: inv.borderStrong, alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={17} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 14, color: inv.text }}>Atik nan livrezon</Text>
                    <Text style={{ fontSize: 10, color: inv.sub }}>{invBubbles.length} pwodwi · Tape pou modifye</Text>
                  </View>
                  <Pressable onPress={() => setInvShowCart(false)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color="#fff" /></Pressable>
                </View>
              </View>
              <ScrollView style={{ padding: 12 }} contentContainerStyle={{ gap: 8, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
                {invBubbles.map((b, idx) => (
                  <Pressable key={idx} onPress={() => invOpenEditSheet(idx, b)} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "transparent", borderWidth: 1, borderColor: inv.border, borderRadius: 16, padding: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontWeight: "800", fontSize: 13, color: inv.text, flex: 1 }} numberOfLines={1}>{b.name}</Text>
                        {b.sellPrice > 0 && <Text style={{ fontSize: 10, fontWeight: "700", color: inv.sub }}>vann {fmtG(b.sellPrice)}</Text>}
                      </View>
                      <Text style={{ fontSize: 11, color: inv.sub, marginTop: 2 }}>{b.qty} {b.unitName ?? b.unit ?? "pcs"} × {fmtG(b.costPrice)} = {fmtG(b.qty * b.costPrice)}{Number(b.factor) > 1 ? ` (${fmt(b.qty * Number(b.factor))} inite baz)` : ""}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ backgroundColor: inv.tile, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: inv.borderStrong }}>
                        <Text style={{ fontSize: 10, fontWeight: "800", color: "#fff" }}>{b.qty} {b.unitName ?? b.unit ?? "pcs"}</Text>
                      </View>
                      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: inv.borderStrong }}>
                        <Ionicons name="create-outline" size={14} color="#fff" />
                      </View>
                      <Pressable onPress={() => handleInvRemoveBubble(idx)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="trash-outline" size={14} color={inv.red} />
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: "transparent", borderTopWidth: 0.5, borderColor: inv.hairline }}>
                <Pressable onPress={() => setInvShowCart(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}><Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Kontinye</Text></Pressable>
                <Pressable onPress={() => { setInvShowCart(false); setInvStep(2); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "800", fontSize: 14 }}>Founisè/Transpò</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </View>
  );
}
