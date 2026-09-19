import React, { useEffect, useState } from "react";
import { palette, radius, shadow } from "../theme";
import { View, Text, Pressable, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform, Modal, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../db";
import type { Role } from "../users";
import { fmt, monoStyle } from "../format";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import {
  loadPricing, ensurePricingForProducts, getUnitsForProduct, getPricesForUnit,
  getDefaultUnit, getDisplayPrice, type PricingMaps,
} from "../pricing";

type Category = { id: string; name: string; icon: string; color: string };
type Product = { id: string; name: string; sku?: string; barcode?: string; category_id?: string; stock_quantity: number; low_stock_threshold: number; cost_price: number; selling_price?: number; unit?: string };
type InvBubble = { productId: string; name: string; sku?: string; unitId: string; unitName: string; factor: number; unit?: string; qty: number; costPrice: number; sellPrice: number };

export default function InventoryScreen({ role = "cashier", currentUser, onClose, onSaved }: { role?: Role; currentUser?: any; onClose: () => void; onSaved?: () => void }) {
  const { width, isTablet, padH } = useResponsive();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCategories, setProductCategories] = useState<{ product_id: string; category_id: string }[]>([]);

  const [invStep, setInvStep] = useState<1 | 2>(1);
  const [invBubbles, setInvBubbles] = useState<InvBubble[]>([]);
  const [invSelectedProduct, setInvSelectedProduct] = useState<Product | null>(null);
  const [invSelUnitId, setInvSelUnitId] = useState<string>("");
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [invInputQty, setInvInputQty] = useState("");
  const [invInputCost, setInvInputCost] = useState("");
  const [invInputSell, setInvInputSell] = useState("");
  const [invEditIdx, setInvEditIdx] = useState<number | null>(null);
  const [invShowCart, setInvShowCart] = useState(false);
  const [invError, setInvError] = useState("");
  const [invSupplier, setInvSupplier] = useState("");
  const [invTransport, setInvTransport] = useState("");
  const [invDate, setInvDate] = useState<Date>(new Date());
  const [invShowDatePicker, setInvShowDatePicker] = useState(false);
  const [invReference, setInvReference] = useState<string>(() => `LIV-${Date.now().toString().slice(-6)}`);
  const [invNotes, setInvNotes] = useState("");
  const [invProductSearch, setInvProductSearch] = useState("");
  // Post-save price review: batch saved (pending) → offer to update ALL variants
  type PriceReviewRow = { unitId: string; unitName: string; variant: string; priceId: string | null; price: string };
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

  async function load() {
    const db = await getDb();
    try {
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 OR is_deleted IS NULL")) as Product[];
      setProducts(rows);
      const pc = (await db.getAllAsync("SELECT * FROM product_categories")) as any[];
      setProductCategories(pc);
      const cats = (await db.getAllAsync("SELECT * FROM categories")) as any[];
      setCategories(cats);
      try {
        const pm = await ensurePricingForProducts(db, rows);
        setPricing(pm);
      } catch (e) { console.log("[Inventory pricing] failed:", e); }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function displayPriceFor(p: Product): string {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return `${fmt(d.price)} HTG`;
    const legacy = Number(p.selling_price ?? 0) || 0;
    return legacy > 0 ? `${fmt(legacy)} HTG` : "—";
  }
  function unitsFor(productId: string) {
    return getUnitsForProduct(pricing, productId);
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

  function invTotalItemsCost() {
    return invBubbles.reduce((s, b) => s + b.qty * b.costPrice, 0);
  }
  function invTotalTransport() {
    return parseFloat(invTransport) || 0;
  }
  function invAllocForBubble(b: { qty: number; costPrice: number }, total: number, transport: number) {
    const lineTotal = b.qty * b.costPrice;
    if (total <= 0 || transport <= 0 || lineTotal <= 0) return 0;
    return (lineTotal / total) * transport;
  }

  async function handleCreateInventory() {
    if (!canInventory) return Alert.alert("Pa gen dwa", "Se sèlman Owner/Admin/Manager ka fè antre stòk");
    if (invBubbles.length === 0) { setInvError("Ajoute omwen yon pwodwi nan livrezon an"); return; }
    for (const b of invBubbles) {
      if (isNaN(b.qty) || b.qty <= 0) { setInvError(`Kantite pa valab pou ${b.name}`); return; }
      if (isNaN(b.costPrice) || b.costPrice < 0) { setInvError(`Pri acha pa valab pou ${b.name}`); return; }
    }
    const transport = invTotalTransport();
    if (transport < 0) { setInvError("Frè transpò pa valab"); return; }
    const totalItems = invBubbles.reduce((s, b) => s + b.qty * b.costPrice, 0);
    const batchId = `batch-${Date.now()}`;
    const reference = invReference.trim() || `LIV-${Date.now().toString().slice(-6)}`;
    const now = new Date().toISOString();
    const receivedAt = invDate.toISOString();
    const totalCost = totalItems + transport;
    try {
    const db = await getDb();
    await db.runAsync("INSERT INTO stock_batches (id, store_id, reference, supplier, transport_cost, notes, total_items_cost, total_cost, received_at, created_by, created_at, updated_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [batchId, "demo-store-id", reference, invSupplier.trim() || null, transport, invNotes.trim() || null, totalItems, totalCost, receivedAt, currentUser?.id ?? "system", now, now, "pending", null]);
    for (const b of invBubbles) {
      const qty = b.qty;
      const factor = Number((b as any).factor) || 1;
      // Stock is always tracked in BASE units (smallest unit): 10 Box × 24 = 240
      const baseQty = qty * factor;
      const unitCost = factor > 0 ? b.costPrice / factor : b.costPrice;
      const lineTotal = qty * b.costPrice;
      const allocated = totalItems > 0 ? (lineTotal / totalItems) * transport : (transport / invBubbles.length);
      const totalLine = lineTotal + allocated;
      await db.runAsync("INSERT INTO stock_movements (id, batch_id, store_id, product_id, type, quantity, initial_qty, remaining_qty, unit_cost, total_cost, allocated_transport, reason, created_by, created_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`mov-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, batchId, "demo-store-id", b.productId, "in", baseQty, baseQty, baseQty, unitCost, totalLine, allocated, invNotes.trim() || null, currentUser?.id ?? "system", now, "pending", null]);
      if (!isNaN(b.sellPrice) && b.sellPrice > 0) {
        // Sell price follows the bubble's SELECTED unit (not always the base Unit):
        // update that unit's Regular price (else its first variant price).
        try {
          const punits = (await db.getAllAsync("SELECT * FROM product_units WHERE product_id = ?", [b.productId])) as any[];
          let punit = punits.find((u: any) => u.id === (b as any).unitId)
            ?? punits.find((u: any) => Number(u.conversion_factor) === 1)
            ?? punits[0];
          if (!punit) {
            const nuid = `unit-${b.productId}-base`;
            await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
              [nuid, b.productId, (b as any).unitName ?? "Unit", 1, now, now]);
            punit = { id: nuid };
          }
          const prows = (await db.getAllAsync("SELECT * FROM product_prices WHERE unit_id = ?", [punit.id])) as any[];
          const prow = prows.find((r: any) => r.variant === "Regular") ?? prows[0];
          if (prow) {
            await db.runAsync("UPDATE product_prices SET price = ?, updated_at = ? WHERE id = ?", [b.sellPrice, now, prow.id]);
          } else {
            await db.runAsync("INSERT INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
              [`price-${b.productId}-regular`, punit.id, "Regular", b.sellPrice, now]);
          }
        } catch {}
      }
    }
    const summary = `${reference} • ${invBubbles.length} pwodwi • ${fmt(totalCost)} HTG (transpò ${fmt(transport)} HTG) • dat ${invDate.toLocaleDateString()}. Stòk la parèt nan "Incoming" jouk li rive.`;
    // Opportunity: update sell prices for ALL variants — only offered when the
    // batch saved successfully (status pending). Snapshot current rows.
    const review: PriceReviewProduct[] = [];
    for (const b of invBubbles) {
      const units = (await db.getAllAsync("SELECT * FROM product_units WHERE product_id = ?", [b.productId])) as any[];
      const rows: PriceReviewRow[] = [];
      for (const u of units) {
        const prs = (await db.getAllAsync("SELECT * FROM product_prices WHERE unit_id = ?", [u.id])) as any[];
        if (!prs.length) rows.push({ unitId: u.id, unitName: u.unit_name, variant: "Regular", priceId: null, price: "" });
        else for (const r of prs) rows.push({ unitId: u.id, unitName: u.unit_name, variant: r.variant, priceId: r.id, price: String(r.price ?? "") });
      }
      if (rows.length) review.push({ productId: b.productId, name: b.name, rows });
    }
    if (!review.length) {
      Alert.alert("Livrezon anrejistre ✓", summary);
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
        for (const p of priceReview) {
          for (const r of p.rows) {
            const v = parseFloat(r.price);
            if (isNaN(v) || v < 0) continue; // empty/invalid = keep unchanged
            if (r.priceId) {
              await db.runAsync("UPDATE product_prices SET price = ?, updated_at = ? WHERE id = ?", [v, now, r.priceId]);
            } else if (v > 0) {
              await db.runAsync("INSERT INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
                [`price-${r.unitId}-${Date.now().toString().slice(-6)}`, r.unitId, r.variant, v, now]);
            }
          }
        }
      } catch (e: any) {
        Alert.alert("Erè", `Pri yo pa sove nèt: ${e?.message ?? e}`);
        return; // stay open so nothing is lost
      }
    }
    setPriceReview(null);
    onSaved?.();
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
    setInvInputCost(p.cost_price ? String(p.cost_price) : "");
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
  function handleInvRemoveBubble(idx: number) {
    setInvBubbles(prev => prev.filter((_, i) => i !== idx));
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", flex: 1 }}>
      {invStep === 1 ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          {/* Step 1 header */}
          <View style={{ backgroundColor: palette.surface, paddingHorizontal: padH, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}><Ionicons name="cube-outline" size={20} color={palette.accentGold} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink }}>Livrezon — Chwazi pwodwi</Text>
                  <View style={{ backgroundColor: palette.accentGold, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}><Text style={{ fontSize: 9, fontWeight: "800", color: "#fff" }}>1/2</Text></View>
                </View>
                <Text style={{ fontSize: 11, color: palette.muted }}>Tape yon pwodwi → kantite, pri acha & pri vann → Ajoute</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1, height: 40, flexDirection: "row", alignItems: "center", backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, paddingHorizontal: 10, borderWidth: 1, borderColor: palette.separatorSoft }}>
                <Ionicons name="search" size={14} color={palette.muted3} style={{ marginRight: 6 }} />
                <TextInput placeholder="Chèche pwodwi nan katalòg..." placeholderTextColor={palette.muted3} value={invProductSearch} onChangeText={setInvProductSearch} style={{ flex: 1, fontSize: 13, color: palette.ink, paddingVertical: 6 }} />
                {invProductSearch.length > 0 && <Pressable onPress={() => setInvProductSearch("")} hitSlop={8}><Ionicons name="close-circle" size={14} color={palette.muted3} /></Pressable>}
              </View>
            </View>
          </View>
          {/* Catalog list */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, gap: 10, paddingBottom: invBubbles.length ? 110 : 40, ...(isTablet && { flexDirection: "row", flexWrap: "wrap" as const }) }} showsVerticalScrollIndicator={false}>
            {invError ? <View style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.sm, padding: 10 }}><Text style={{ fontSize: 12, fontWeight: "600", color: palette.danger }}>{invError}</Text></View> : null}
            {products.filter(p => {
              const qq = invProductSearch.toLowerCase();
              if (!qq) return true;
              return p.name.toLowerCase().includes(qq) || (p.sku ?? "").toLowerCase().includes(qq) || (p.barcode ?? "").toLowerCase().includes(qq);
            }).map(p => {
              const pcats = getProductCategoriesDisplay(p.id);
              const inShip = invBubbles.some(b => b.productId === p.id);
              return (
                <Pressable key={p.id} onPress={() => canInventory && invOpenAddSheet(p)} disabled={!canInventory} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: inShip ? "rgba(200,162,74,0.6)" : palette.hairline, padding: 10, ...shadow.soft, opacity: canInventory ? 1 : 0.6, ...(isTablet && { flexBasis: "48%" as any, flexGrow: 1 }) }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: inShip ? palette.accentGoldSoft : palette.surfaceGrouped, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: inShip ? palette.accentGold : palette.separatorSoft }}>
                    <Ionicons name="cube-outline" size={17} color={inShip ? palette.accentGold : palette.muted2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }} numberOfLines={1}>{p.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <Text style={{ fontSize: 10, color: palette.muted, fontWeight: "600" }}>{p.sku}</Text>
                      {pcats.slice(0, 2).map(c => <View key={c.id} style={{ backgroundColor: palette.surfaceGrouped, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}><Text style={{ fontSize: 9, fontWeight: "600", color: palette.muted2 }}>{c.name}</Text></View>)}
                    </View>
                  </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: palette.ink, textAlign: "right", ...monoStyle }}>{displayPriceFor(p)}</Text>
                      <Text style={{ fontSize: 9, color: palette.muted, marginTop: 1 }}>{p.stock_quantity} pcs</Text>
                    </View>
                  {inShip ? <View style={{ backgroundColor: palette.accentGold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }}><Text style={{ fontSize: 9, fontWeight: "800", color: "#fff" }}>✓</Text></View> : <Ionicons name="add-circle-outline" size={20} color={palette.ink2} />}
                </Pressable>
              );
            })}
            {products.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
                <Ionicons name="cube-outline" size={36} color={palette.muted3} />
                <Text style={{ fontSize: 12, color: palette.muted2 }}>Katalòg vid — kreye pwodwi anvan</Text>
              </View>
            )}
          </ScrollView>
          {/* Messenger bubble bar (cart) */}
          {invBubbles.length > 0 && (
            <View style={{ position: "absolute", bottom: 16, left: 14, right: 14, alignItems: "center" }}>
              <Pressable onPress={() => setInvShowCart(true)} style={{ width: "100%", maxWidth: isTablet ? 560 : 390, backgroundColor: palette.ink, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", ...shadow.card }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontWeight: "900", color: "#fff", fontSize: 13 }}>{invBubbles.length}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontWeight: "800", color: "#fff", fontSize: 12 }}>{invBubbles.length} pwodwi nan livrezon</Text>
                  <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", marginTop: 1 }}>Tape pou wè detay · retire · modifye</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: palette.accentGold, fontWeight: "800", fontSize: 14, textAlign: "right", ...monoStyle }}>{fmt(invBubbles.reduce((s, b) => s + b.qty * b.costPrice, 0))} HTG</Text>
                  <Text style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}>pri acha</Text>
                </View>
                <Ionicons name="chevron-up" size={16} color="rgba(255,255,255,0.7)" style={{ marginLeft: 8 }} />
              </Pressable>
            </View>
          )}
          {/* Modal for adding/editing an item — keyboard-safe bottom sheet.
              iOS: KeyboardAvoidingView padding pushes sheet up.
              Android (pan mode): KAV height does nothing inside Modal, so pad
              ScrollView content by measured keyboard height instead. */}
          <Modal visible={!!invSelectedProduct} transparent animationType="slide" onRequestClose={invCloseAddSheet}>
            <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
              <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
                <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingBottom: Platform.OS === "android" ? invKeyboardH : 0 }}>
                <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, ...shadow.card }}>
                  <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Ionicons name="pricetag-outline" size={18} color={palette.accentGold} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }} numberOfLines={1}>{invSelectedProduct?.name}</Text>
                      <Text style={{ fontSize: 10, color: palette.muted }}>{invSelectedProduct?.sku ?? ""}{invEditIdx !== null ? " · MODIFYE" : ""}</Text>
                    </View>
                    <Pressable onPress={invCloseAddSheet} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={15} color={palette.muted} /></Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    {invSelectedProduct && unitsFor(invSelectedProduct.id).map(u => {
                      const active = (invSelUnitId || selUnit()?.id) === u.id;
                      return (
                        <Pressable key={u.id} onPress={() => { setInvSelUnitId(u.id); setInvInputSell(unitSellPrice(u.id)); }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: active ? palette.ink2 : palette.surfaceGrouped, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}>
                          <Text style={{ color: active ? "#fff" : palette.ink, fontWeight: "700", fontSize: 12 }}>{u.unit_name}{Number(u.conversion_factor) > 1 ? ` ×${u.conversion_factor}` : ""}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600", fontSize: 11, color: palette.ink }}>Kantite{selUnit() ? ` (${selUnit()!.unit_name})` : ""} *</Text>
                      <TextInput value={invInputQty} onChangeText={v => { setInvInputQty(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} placeholder="0" keyboardType="numeric" style={{ borderWidth: 1, borderColor: invInputQty ? palette.ink2 : palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, textAlign: "center", fontWeight: "700", fontSize: 15, color: palette.ink, backgroundColor: "#fff" }} selectTextOnFocus />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600", fontSize: 11, color: palette.ink }}>Pri achte HTG{selUnit() ? ` / ${selUnit()!.unit_name}` : ""} *</Text>
                      <TextInput value={invInputCost} onChangeText={v => { setInvInputCost(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} placeholder="0" keyboardType="numeric" style={{ borderWidth: 1, borderColor: invInputCost ? palette.ink2 : palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, textAlign: "center", fontWeight: "700", fontSize: 15, color: palette.ink, backgroundColor: "#fff" }} selectTextOnFocus />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontWeight: "600", fontSize: 11, color: palette.ink }}>Pri vann{selUnit() ? ` (${selUnit()!.unit_name})` : ""} HTG</Text>
                        <View style={{ backgroundColor: palette.accentGoldSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 0.5, borderColor: palette.accentGold }}><Text style={{ fontSize: 9, fontWeight: "700", color: palette.accentGold }}>Katalòg</Text></View>
                      </View>
                      <TextInput value={invInputSell} onChangeText={v => { setInvInputSell(v.replace(/[^0-9.]/g, "")); if (invError) setInvError(""); }} keyboardType="numeric" style={{ borderWidth: 1, borderColor: invInputSell ? palette.ink2 : palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, textAlign: "center", fontWeight: "700", fontSize: 15, color: palette.ink, backgroundColor: "#fff" }} selectTextOnFocus />
                      <Text style={{ fontSize: 9, color: palette.muted3, marginTop: 4, textAlign: "center" }}>Pre-ranpli: pri aktyèl katalòg la. Chanje = mete ajou pou tout magazen.</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    {invEditIdx !== null && (
                      <Pressable onPress={() => { handleInvRemoveBubble(invEditIdx); invCloseAddSheet(); }} style={{ paddingVertical: 13, paddingHorizontal: 14, backgroundColor: palette.dangerBg, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.dangerBd }}>
                        <Ionicons name="trash-outline" size={16} color={palette.danger} />
                      </Pressable>
                    )}
                    <Pressable onPress={handleInvAjoute} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, backgroundColor: palette.ink2, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{invEditIdx !== null ? "✓ Mete ajou" : "✓ Ajoute"}</Text>
                      {((parseFloat(invInputQty) || 0) > 0 && (parseFloat(invInputCost) || 0) > 0) && <View style={{ backgroundColor: palette.accentGold, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ fontSize: 11, fontWeight: "900", color: "#fff" }}>{fmt((parseFloat(invInputQty) || 0) * (parseFloat(invInputCost) || 0))} HTG</Text></View>}
                    </Pressable>
                  </View>
                </View>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0}
          style={{ flex: 1 }}>
          {/* Step 2 header */}
          <View style={{ backgroundColor: palette.surface, paddingHorizontal: padH, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}><Ionicons name="document-text-outline" size={20} color={palette.accentGold} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink }}>Detay livrezon</Text>
                  <View style={{ backgroundColor: palette.accentGold, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}><Text style={{ fontSize: 9, fontWeight: "800", color: "#fff" }}>2/2</Text></View>
                </View>
                <Text style={{ fontSize: 11, color: palette.muted }}>{invBubbles.length} pwodwi · {fmt(invBubbles.reduce((s, b) => s + b.qty, 0))} total atik</Text>
              </View>
              <Pressable onPress={() => setInvStep(1)} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.surfaceGrouped, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.hairline }}>
                <Ionicons name="arrow-back" size={13} color={palette.inkSoft} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: palette.inkSoft }}>Pwodwi</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1 }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 24 + (Platform.OS === "android" ? invKeyboardH : 0) }} showsVerticalScrollIndicator={false}>
            {invError ? <View style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.sm, padding: 10 }}><Text style={{ fontSize: 12, fontWeight: "600", color: palette.danger }}>{invError}</Text></View> : null}
            <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Referans</Text><TextInput value={invReference} onChangeText={setInvReference} placeholder="LIV-123456" autoCapitalize="characters" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Founisè</Text><TextInput value={invSupplier} onChangeText={setInvSupplier} placeholder="Eg. Haiti Import" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} /></View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Frè transpò HTG</Text>
                  <TextInput value={invTransport} onChangeText={v => { setInvTransport(v); if (invError) setInvError(""); }} placeholder="0" keyboardType="numeric" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} />
                  <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 3 }}>Reparti otomatik sou chak pwodwi</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Dat arive *</Text>
                  <Pressable onPress={() => setInvShowDatePicker(!invShowDatePicker)} style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, backgroundColor: "#fff" }}>
                    <Ionicons name="calendar-outline" size={15} color={palette.accentGold} style={{ marginRight: 6 }} />
                    <Text style={{ color: palette.ink, fontWeight: "600", fontSize: 13 }}>{invDate.toLocaleDateString()}</Text>
                    <Ionicons name="chevron-down" size={14} color={palette.muted} style={{ marginLeft: "auto" }} />
                  </Pressable>
                  {invShowDatePicker && (
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {[{ label: "Jodi a", delta: 0 }, { label: "Yè", delta: -1 }, { label: "2 jou", delta: -2 }].map((o: any) => (
                        <Pressable key={o.label} onPress={() => { const d = new Date(); d.setDate(d.getDate() + o.delta); setInvDate(d); setInvShowDatePicker(false); }} style={{ backgroundColor: palette.surfaceGrouped, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.hairline }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>
              <View>
                <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Nòt (opsyonèl)</Text>
                <TextInput value={invNotes} onChangeText={setInvNotes} placeholder="Eg. Livrezon maten, wout Delmas" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink, minHeight: 44 }} />
              </View>
            </View>
            {/* Allocation preview */}
            {invTotalItemsCost() > 0 && invTotalTransport() > 0 && (
              <View style={{ backgroundColor: palette.ink2, borderRadius: radius.sm, padding: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff", letterSpacing: 0.4 }}>REPARTISYON TRANSPÒ — preview</Text>
                <View style={{ height: 10, flexDirection: "row", borderRadius: 5, overflow: "hidden", marginTop: 8, backgroundColor: "rgba(255,255,255,0.15)" }}>
                  {invBubbles.map((b, idx) => {
                    const total = invTotalItemsCost();
                    const pct = total > 0 ? (b.qty * b.costPrice) / total * 100 : 0;
                    const colors = [palette.accentGold, palette.successDot, palette.warningDot, "#8B5CF6", "#EC4899"];
                    return <View key={idx} style={{ width: `${pct}%` as any, backgroundColor: colors[idx % colors.length] }} />;
                  })}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>Total atik {fmt(invTotalItemsCost())} HTG</Text>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: palette.accentGold }}>+ {fmt(invTotalTransport())} HTG → {fmt(invTotalItemsCost() + invTotalTransport())} HTG revient</Text>
                </View>
              </View>
            )}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, padding: 14, paddingBottom: 14 + (Platform.OS === "android" ? invKeyboardH : 0), backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
            <Pressable onPress={() => setInvStep(1)} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Retounen</Text></Pressable>
            <Pressable onPress={handleCreateInventory} style={{ flex: 2, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>✓ Anrejistre livrezon</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Post-save: review sell prices for ALL variants (batch saved, pending) */}
      <Modal visible={priceReview !== null} transparent animationType="slide" onRequestClose={() => finishPriceReview(false)}>
        <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingBottom: Platform.OS === "android" ? invKeyboardH : 0 }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, maxHeight: "88%", ...shadow.card }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}><Ionicons name="pricetag-outline" size={18} color={palette.accentGold} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>Livrezon anrejistre ✓</Text>
                    <Text style={{ fontSize: 10, color: palette.muted, marginTop: 1 }} numberOfLines={2}>{priceReviewSummary}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 10 }}>Mete pri vann yo ajou pou tout variant — opsyonèl. Vid = kenbe pri aktyèl la.</Text>
                {(priceReview ?? []).map((p, pi) => (
                  <View key={p.productId} style={{ marginTop: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Text style={{ fontWeight: "700", fontSize: 12, color: palette.ink }} numberOfLines={1}>{p.name}</Text>
                    {p.rows.map((r, ri) => (
                      <View key={`${r.unitId}-${r.variant}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }} numberOfLines={1}>{r.unitName} · {r.variant}</Text>
                        </View>
                        <TextInput value={r.price} onChangeText={v => setReviewRowPrice(pi, ri, v)} keyboardType="numeric" placeholder="—" placeholderTextColor={palette.muted3} selectTextOnFocus style={{ width: 110, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 10, textAlign: "center", fontWeight: "700", fontSize: 14, color: palette.ink, backgroundColor: "#fff" }} />
                      </View>
                    ))}
                  </View>
                ))}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <Pressable onPress={() => finishPriceReview(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Kite konsa</Text></Pressable>
                  <Pressable onPress={() => finishPriceReview(true)} style={{ flex: 2, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>✓ Sove pri yo</Text></Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Expanded messenger cart sheet */}
      <Modal visible={invShowCart} transparent animationType="slide" onRequestClose={() => setInvShowCart(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "80%", overflow: "hidden" }}>
              <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Ionicons name="chatbubble-ellipses-outline" size={17} color={palette.accentGold} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>Atik nan livrezon</Text>
                    <Text style={{ fontSize: 10, color: palette.muted }}>{invBubbles.length} pwodwi · Tape pou modifye</Text>
                  </View>
                  <Pressable onPress={() => setInvShowCart(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color={palette.muted} /></Pressable>
                </View>
              </View>
              <ScrollView style={{ padding: 12 }} contentContainerStyle={{ gap: 8, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
                {invBubbles.map((b, idx) => (
                  <Pressable key={idx} onPress={() => invOpenEditSheet(idx, b)} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontWeight: "700", fontSize: 12.5, color: palette.ink }} numberOfLines={1}>{b.name}</Text>
                        {b.sellPrice > 0 && <Text style={{ fontSize: 9, fontWeight: "700", color: palette.muted2 }}>vann {fmt(b.sellPrice)} HTG</Text>}
                      </View>
                      <Text style={{ fontSize: 10, color: palette.muted, marginTop: 2 }}>{b.qty} {b.unitName ?? b.unit ?? "pcs"} × {fmt(b.costPrice)} HTG = {fmt(b.qty * b.costPrice)} HTG{Number(b.factor) > 1 ? ` (${fmt(b.qty * Number(b.factor))} inite baz)` : ""}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ backgroundColor: palette.accentGoldSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: "800", color: palette.accentGold }}>{b.qty} {b.unitName ?? b.unit ?? "pcs"}</Text>
                      </View>
                      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline }}>
                        <Ionicons name="create-outline" size={13} color={palette.ink2} />
                      </View>
                      <Pressable onPress={() => handleInvRemoveBubble(idx)} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: palette.dangerBg, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="trash-outline" size={13} color={palette.danger} />
                      </Pressable>
</View>
                    </Pressable>
                  ))}
                </ScrollView>
              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                <Pressable onPress={() => setInvShowCart(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Kontinye</Text></Pressable>
                <Pressable onPress={() => { setInvShowCart(false); setInvStep(2); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Founisè/Transpò</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </View>
  );
}