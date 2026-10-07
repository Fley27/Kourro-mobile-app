// Proformat builder — checkout replica: browse variant groups, pend a line,
// extend the cart sheet, attach a client (registered / full form / 3-field
// prospect), then Suivan → UploadTransition → receipt (no tender screen, no
// partial pickup). The 3-field "Pa kliyan ankò" save creates the record AND
// the proformat in one go.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Modal, Animated, Easing, Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { fmtG } from "../../format";
import { useResponsive } from "../../responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ht } from "../../i18n";
import { topIconBtn, radius, shadow, blackPalette as palette } from "../../theme";
import { useSaleCatalog } from "../../picker/useSaleCatalog";
import { useSaleRows, makePricing, usePendingLine, useCartLines } from "../../picker/hooks";
import { TabletProductPane } from "../../picker/tablet";
import { POSPhone } from "../POSPhone";
import { CartLinesList, CartTotalBar, CartEmptyCard, type CartItem, type SearchMode, type SaleRow } from "../POSShared";
import { CartCustomersView, NewCustomerView } from "../cartViews";
import { ScanSheet } from "../../components/ScanSheet";
import { UploadTransition, minDelay, uploadError, uploadSuccess, type UploadPhase } from "../../components/UploadTransition";
import ReceiptModal from "../../components/ReceiptModal";
import type { ReceiptData } from "../../receipts";
import { EMPTY_CUSTOMER_FORM, PhoneField, CountryDialPicker, type CustomerFormData } from "../../components/CustomerForm";
import { insertCustomerRecord } from "../../sales/customers";
import { createProformat, type ProformatLineInput } from "../../promos/promosModel";
import type { PromoActor, Proformat } from "../../promos/types";
import { PromoHeader } from "./promoUi";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

// CustomerForm's darkInput, inlined (module-private there).
const darkInput = {
  backgroundColor: "#0a0a0a",
  borderWidth: 1,
  borderColor: "#3a3a3c",
  borderRadius: 12,
  height: 60,
  paddingHorizontal: 16,
  fontSize: 16,
  color: "#fff",
} as const;

type CartView = "cart" | "customers" | "newCustomer";

export default function ProformatCreateView({
  storeId,
  storeName,
  deviceId = "device-unknown",
  actor,
  onBack,
  onCreated,
}: {
  storeId: string;
  storeName?: string;
  deviceId?: string;
  actor: PromoActor;
  onBack: () => void;
  onCreated: (p: Proformat) => void;
}) {
  const { padH, isTablet } = useResponsive();
  const insets = useSafeAreaInsets();

  // ── Browse/cart state (declared first — the sale hooks read it) ─────────
  const [searchState, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showScan, setShowScan] = useState(false);

  // ── Catalog + checkout sale logic (same wiring as POS) ──────────────────
  const { products, catNames, pricing, minFactorMap, variantSales, loaded: catalogLoaded } = useSaleCatalog(true);
  const { mergeLine } = makePricing(pricing, minFactorMap);
  const {
    pending, setPending, pendingInput, setPendingInput, pendingLine, pendingMaxQ,
    handleProductPress, adjustPending, setPendingCustom, commitPendingWithInput,
  } = usePendingLine({
    pricing,
    minFactorMap,
    onCommit: (p, q, s) => setCart(prev => mergeLine(prev, p, s, Math.max(1, q))),
    onRowPress: () => setSearch(""),
  });
  const {
    editingQtyId, setEditingQtyId, editingQtyVal, setEditingQtyVal,
    decQty, incQty, removeFromCart, setCustomQty,
  } = useCartLines({ cart, setCart, products, pricing, minFactorMap });
  const rows = useSaleRows({ products, pricing, minFactorMap, catNames, search: searchState, variantSales });

  // ── Cart sheet + customer flow ──────────────────────────────────────────
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [cartView, setCartView] = useState<CartView>("cart");
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [custSearch, setCustSearch] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [formValid, setFormValid] = useState(false);
  const formRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });
  const [showNoClient, setShowNoClient] = useState(false);
  const [showProspect, setShowProspect] = useState(false);
  const [prospectSaving, setProspectSaving] = useState(false);
  const [prospectFirst, setProspectFirst] = useState("");
  const [prospectLast, setProspectLast] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [prospectCountry, setProspectCountry] = useState("HT");
  const [dialOpen, setDialOpen] = useState(false);

  // ── Upload transition + receipt ─────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("loading");
  const [busyTitle, setBusyTitle] = useState("");
  const [busyDetail, setBusyDetail] = useState("");
  const [receipts, setReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const lastPfoRef = useRef<Proformat | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [entrance]);

  // Pulsing gold CTA — same loop as POS CartTotalBar.
  const payPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(payPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(payPulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [payPulse]);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        const list = (await db.getAllAsync("SELECT * FROM customers")) as any[];
        setCustomers(Array.from(new Map(list.map((c: any) => [c.id, c] as const)).values()));
      } catch {}
    })();
  }, []);

  const custResults = useMemo(() => {
    const t = custSearch.trim().toLowerCase();
    if (!t) return customers;
    return customers.filter(c =>
      String(c.name ?? "").toLowerCase().includes(t) ||
      String(c.id_card_number ?? "").toLowerCase().includes(t) ||
      String(c.phone ?? "").toLowerCase().includes(t)
    );
  }, [customers, custSearch]);

  const subtotal = Math.round(cart.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0) * 100) / 100;
  const qtyTotal = cart.reduce((s, it) => s + it.qty, 0);

  function firstRowFor(productId: string) {
    return rows.find(r => r.product.id === productId) ?? null;
  }
  function onBarcodeSubmit() {
    if (!searchState.trim()) return;
    const found = products.find(p => p.barcode?.toLowerCase() === searchState.trim().toLowerCase() || p.sku?.toLowerCase() === searchState.trim().toLowerCase());
    const row = found ? firstRowFor(found.id) : null;
    if (found && row) handleProductPress(row);
    else Alert.alert("Pa jwenn", `Pa gen pwodwi ak kòd ${searchState}`);
  }
  function simulateScan() {
    const top = products[0];
    const row = top ? firstRowFor(top.id) : null;
    if (top && row) { setSearch(top.barcode ?? top.sku ?? ""); handleProductPress(row); setShowScan(false); }
  }

  function confirmBack() {
    if (cart.length) {
      Alert.alert("Koupe proformat?", "Panyen an gen atik — si ou soti, yo p ap sove.", [
        { text: "Kenbe", style: "cancel" },
        { text: "Soti", style: "destructive", onPress: onBack },
      ]);
    } else onBack();
  }

  // ── Cart sheet customer actions (same semantics as POS cart views) ─────
  function pickCustomer(c: any) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCartView("cart");
  }
  function openCustomers() {
    setCustSearch("");
    setCartView("customers");
  }
  function openNewCustomer() {
    formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false };
    setFormValid(false);
    setFormKey(k => k + 1);
    setCartView("newCustomer");
  }
  async function saveNewCustomer() {
    const { data, valid } = formRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    try {
      const db = await getDb();
      const fresh = await insertCustomerRecord(db, storeId, data);
      setCustomers(prev => (prev.some(c => c.id === fresh.id) ? prev : [...prev, fresh]));
      setSelectedCustomer(fresh);
      setCustSearch("");
      setCartView("cart");
      uploadSuccess("Kliyan ajoute ✓", fresh.name);
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  // ── Suivan: client attached → create; otherwise the no-client modal ─────
  function handleSuivan() {
    let lines = cart;
    if (pending) {
      const s = { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant };
      lines = mergeLine(cart, pending.product, s, Math.max(1, pending.qty));
      setCart(lines);
      setPending(null);
      setPendingInput("");
    }
    if (!lines.length) { Alert.alert("Panyen vid", "Ajoute omwen yon pwodwi."); return; }
    if (!selectedCustomer) { setShowNoClient(true); return; }
    setShowCartSheet(false);
    doSave(selectedCustomer, lines);
  }

  function buildPfoReceipt(pfo: Proformat, customer: any): { customer: ReceiptData; store: ReceiptData } {
    const items = (pfo.items ?? []).map(it => ({
      name: String(it.name),
      variant: it.variant ?? undefined,
      unitName: it.unit_name ?? undefined,
      qty: Number(it.qty),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_total),
    }));
    const r: ReceiptData = {
      id: `pfo-${pfo.id}`,
      kind: "proformat",
      copyType: "customer",
      receiptNumber: pfo.receipt_number,
      saleNumber: pfo.receipt_number,
      saleId: String(pfo.id),
      storeName: storeName ?? "Jesyon Magazen",
      createdAt: pfo.created_at ?? new Date().toISOString(),
      cashier: {
        id: pfo.created_by ?? actor.id,
        name: String(pfo.created_by_name ?? actor.name ?? "—"),
        role: String(pfo.created_by_role ?? actor.role ?? "—"),
      },
      customer: customer ? { name: String(customer.name ?? ""), phone: customer.phone ?? undefined } : null,
      customerId: String(pfo.customer_id),
      items,
      subtotal: Number(pfo.subtotal),
      discount: 0,
      total: Number(pfo.total),
      paymentMethod: "proformat",
      amountPaid: Number(pfo.total),
      amountDue: 0,
      change: 0,
      dueDate: null,
    };
    return { customer: r, store: { ...r, id: `${r.id}-store`, copyType: "store" } };
  }

  async function doSave(customer: any, lines: CartItem[]) {
    if (!lines.length) { uploadError("Panyen vid", "Ajoute omwen yon pwodwi."); return; }
    setShowCartSheet(false);
    // Let the cart sheet dismiss first — same-tick Modal swaps get dropped on iOS.
    await new Promise(r => setTimeout(r, 350));
    setBusy(true);
    setPhase("loading");
    setBusyTitle("Ap kreye proformat…");
    setBusyDetail(`${lines.length} atik • ${String(customer?.name ?? "")}`);
    try {
      const db = await getDb();
      const input: ProformatLineInput[] = lines.map(li => ({
        product_id: String(li.id),
        name: String(li.name),
        unit_id: li.unitId || null,
        unit_name: li.unitName || null,
        factor: li.factor,
        variant: li.variant,
        qty: li.qty,
        unit_price: li.unitPrice,
        base_price: li.frozenBase ?? li.unitPrice,
      }));
      const pfo = await minDelay(
        createProformat(db, { storeId, deviceId, actor, customerId: String(customer.id), lines: input }),
        1800
      );
      lastPfoRef.current = pfo;
      setReceipts(buildPfoReceipt(pfo, customer));
      setPhase("success");
      setBusyTitle("Proformat kreye ✓");
      setBusyDetail(`${pfo.receipt_number} • ${fmtG(pfo.total)}`);
      await new Promise(r => setTimeout(r, 1500));
      setBusy(false);
      // Open the receipt after the overlay hides — same-tick modal swaps get dropped on iOS.
      setTimeout(() => setShowReceipt(true), 150);
    } catch (e: any) {
      setPhase("error");
      setBusyTitle("Echwe");
      setBusyDetail(e?.message ?? String(e));
      await new Promise(r => setTimeout(r, 3500));
      setBusy(false);
    }
  }

  function onReceiptClose() {
    setShowReceipt(false);
    setReceipts(null);
    const pfo = lastPfoRef.current;
    lastPfoRef.current = null;
    if (pfo) onCreated(pfo);
  }

  // ── 3-field prospect modal ──────────────────────────────────────────────
  const prospectValid = !!(prospectFirst.trim() && prospectLast.trim() && prospectPhone.replace(/[^0-9]/g, "").length >= 7);
  function openProspect() {
    setProspectFirst("");
    setProspectLast("");
    setProspectPhone("");
    setProspectCountry("HT");
    setShowProspect(true);
  }
  async function saveProspect() {
    if (!prospectValid) return Alert.alert("Enkonplè", "Bay non ak yon nimewo telefòn valab.");
    setProspectSaving(true);
    try {
      const db = await getDb();
      const fresh = await insertCustomerRecord(
        db,
        storeId,
        { ...EMPTY_CUSTOMER_FORM, firstName: prospectFirst.trim(), lastName: prospectLast.trim(), phone: prospectPhone, phoneCountry: prospectCountry },
        { isProspect: true }
      );
      setCustomers(prev => (prev.some(c => c.id === fresh.id) ? prev : [...prev, fresh]));
      setSelectedCustomer(fresh);
      setShowProspect(false);
      setShowNoClient(false);
      // Save the proformat right after the prospect save.
      await doSave(fresh, cart);
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Ajoute kliyan echwe");
    } finally {
      setProspectSaving(false);
    }
  }

  // ── Tablet right pane (proforma's own cart card — checkout's foot is
  // tabs/suspend/coupon aware; this one only clears, picks a client and
  // runs Suivan, mirroring the phone sheet exactly). ──────────────────────
  const inCartQtyFor = (row: SaleRow) => cart.filter(c => c.key === row.key).reduce((s, c) => s + c.qty, 0);

  function confirmClearCart() {
    if (!cart.length && !pending) return;
    Alert.alert("Vide panyen?", "Atik yo pral retire nan panyen an.", [
      { text: "Kenbe", style: "cancel" },
      { text: "Vide", style: "destructive", onPress: () => { setCart([]); setPending(null); setPendingInput(""); } },
    ]);
  }

  function renderCartPaneBody() {
    if (cartView === "customers" || cartView === "newCustomer") {
      const isNew = cartView === "newCustomer";
      return (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => setCartView(isNew ? "customers" : "cart")} style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>
              {isNew ? "New Customer" : "Chwazi Kliyan"}
            </Text>
            {isNew ? (
              <Pressable onPress={saveNewCustomer} disabled={!formValid} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: formValid ? 1 : 0.6 }}>
                <Text style={{ color: formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 12 }}>Save</Text>
              </Pressable>
            ) : (
              <Pressable onPress={openNewCustomer} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
              </Pressable>
            )}
          </View>
          <View style={{ marginTop: 12, flex: 1 }}>
            {isNew ? (
              <NewCustomerView formKey={formKey} onFormState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }} />
            ) : (
              <CartCustomersView
                dark
                search={custSearch}
                onSearch={setCustSearch}
                results={custResults}
                onPick={pickCustomer}
                onOpenNew={openNewCustomer}
              />
            )}
          </View>
        </>
      );
    }
    return (
      <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: "#fff", letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
            {ht.cart} • {cart.length} atik • {qtyTotal} pcs
          </Text>
          <Pressable onPress={confirmClearCart} accessibilityLabel="Vide panyen" style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
          </Pressable>
        </View>
        {selectedCustomer ? (
          <Pressable onPress={() => setSelectedCustomer(null)} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
            <Ionicons name="person-outline" size={16} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{selectedCustomer.name}</Text>
              {!!selectedCustomer.is_prospect ? (
                <Text style={{ color: "#ffd60a", fontSize: 10, fontWeight: "700", marginTop: 1 }}>PWOSPÈK</Text>
              ) : null}
            </View>
            <Pressable onPress={() => setSelectedCustomer(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color="#8e8e93" />
            </Pressable>
          </Pressable>
        ) : (
          <Pressable onPress={() => setCartView("customers")} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }}>Add Customer</Text>
            <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
          </Pressable>
        )}
        <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 4 }}>
          {cart.length ? "Glise kantite • tape ✕ pou retire" : "Tape yon pwodwi pou ajoute"}
        </Text>
        {cart.length === 0 ? (
          <CartEmptyCard />
        ) : (
          <CartLinesList
            cart={cart}
            editingQtyId={editingQtyId}
            editingQtyVal={editingQtyVal}
            onDec={decQty}
            onInc={incQty}
            onRemove={removeFromCart}
            onEditStart={(key) => { setEditingQtyId(key); setEditingQtyVal(""); }}
            onEditChange={setCustomQty}
            onEditBlur={() => setEditingQtyId(null)}
            style={{ marginTop: 12 }}
          />
        )}
        <View style={{ marginTop: 12, gap: 10 }}>
          <CartTotalBar payPulse={payPulse} subtotal={subtotal} onPay={handleSuivan} label="Suivan" icon="arrow-forward" />
        </View>
      </>
    );
  }

  // ── No-client + prospect layers — extracted so the phone sheet keeps its
  // absolute overlays and the tablet pane presents the SAME markup in root
  // modals (its sheet never opens). ────────────────────────────────────────
  function renderNoClientOverlay() {
    return (
      <Pressable onPress={() => setShowNoClient(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: "#161616", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 34 + insets.bottom }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 16 }} />
          <Text style={{ color: "#fff", fontSize: 19, fontWeight: "800" }}>Ou pa gen kliyan sou vant sa a.</Text>
          <Pressable
            onPress={() => { setShowNoClient(false); openCustomers(); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23", borderWidth: 1, borderColor: "#3a3a3c" }}
          >
            <Ionicons name="person-add-outline" size={17} color="#fff" />
            <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 15 }}>Ajoute kliyan</Text>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <Pressable
            onPress={openProspect}
            style={{ marginTop: 10, height: 56, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Pa kliyan ankò</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    );
  }

  function renderProspectLayer() {
    return (
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000" }}>
        <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: insets.top + 12, paddingBottom: 18 + insets.bottom }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 8 }}>
            <Pressable onPress={() => setShowProspect(false)} accessibilityLabel="Close" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
            <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 19, color: "#fff" }}>Pa kliyan ankò</Text>
            <Pressable
              onPress={saveProspect}
              disabled={!prospectValid || prospectSaving}
              style={{ paddingHorizontal: 22, paddingVertical: 13, borderRadius: 26, backgroundColor: prospectValid && !prospectSaving ? "#fff" : "#2b2b2b", opacity: prospectSaving ? 0.7 : 1 }}
            >
              <Text style={{ color: prospectValid && !prospectSaving ? "#000" : "#6e6e73", fontWeight: "800", fontSize: 15 }}>
                {prospectSaving ? "…" : "Anrejistre"}
              </Text>
            </Pressable>
          </View>
          <KeyboardSafeScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 10, marginBottom: 16 }}>
              Sèlvman non ak telefòn — li pral anrejistre kòm <Text style={{ color: "#ffd60a", fontWeight: "700" }}>pwospèk</Text>.
            </Text>
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={prospectFirst}
                onChangeText={setProspectFirst}
                placeholder="First name"
                placeholderTextColor="#8e8e93"
                autoCapitalize="words"
                style={darkInput}
              />
            </View>
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={prospectLast}
                onChangeText={setProspectLast}
                placeholder="Last name"
                placeholderTextColor="#8e8e93"
                autoCapitalize="words"
                style={darkInput}
              />
            </View>
            <PhoneField
              value={prospectPhone}
              onChange={setProspectPhone}
              country={prospectCountry}
              onPressFlag={() => setDialOpen(true)}
              placeholder="Phone number"
            />
          </KeyboardSafeScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ paddingHorizontal: padH }}>
        <PromoHeader
          title="Nouvo proformat"
          subtitle="Chwazi pwodwi • tape Suivan lè ou fini"
          onBack={confirmBack}
        />
      </View>

      {isTablet ? (
        /* Two-pane like checkout: products left, sticky cart card right. */
        <View style={{ width: "100%", flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: padH, paddingBottom: 12, paddingTop: 8 }}>
          <TabletProductPane
            entrance={entrance}
            search={searchState}
            searchMode={searchMode}
            rows={rows}
            catNames={catNames}
            catalogLoaded={catalogLoaded}
            pending={pending}
            pendingInput={pendingInput}
            pendingLine={pendingLine}
            pendingMaxQ={pendingMaxQ}
            onSearchChange={setSearch}
            onSearchModeChange={setSearchMode}
            onBarcodeSubmit={onBarcodeSubmit}
            onOpenScanner={() => setShowScan(true)}
            onAdjustPending={adjustPending}
            onPendingCustom={setPendingCustom}
            onPendingBlurClear={() => setPendingInput("")}
            onCommitPending={commitPendingWithInput}
            onCancelPending={() => { setPending(null); setPendingInput(""); }}
            onProductPress={handleProductPress}
            onDecQty={decQty}
            inCartQtyFor={inCartQtyFor}
          />
          <View style={{ flex: 2, minWidth: 300, backgroundColor: "#000", borderRadius: radius.lg, borderWidth: 0.5, borderColor: "#262626", ...shadow.card, padding: 14 }}>
            {renderCartPaneBody()}
          </View>
        </View>
      ) : (
        <POSPhone
          search={searchState}
          searchMode={searchMode}
          entrance={entrance}
          pending={pending}
          pendingInput={pendingInput}
          pendingLine={pendingLine}
          pendingMaxQ={pendingMaxQ}
          rows={rows}
          catNames={catNames}
          catalogLoaded={catalogLoaded}
          cart={cart}
          subtotal={subtotal}
          onSearchChange={setSearch}
          onSearchModeChange={setSearchMode}
          onBarcodeSubmit={onBarcodeSubmit}
          onOpenScanner={() => setShowScan(true)}
          onAdjustPending={adjustPending}
          onPendingCustom={setPendingCustom}
          onPendingBlurClear={() => setPendingInput("")}
          onCommitPending={commitPendingWithInput}
          onCancelPending={() => { setPending(null); setPendingInput(""); }}
          onProductPress={handleProductPress}
          onDecQty={decQty}
          onOpenCart={() => { setCartView("cart"); setShowCartSheet(true); }}
          alwaysShowCartPill
        />
      )}

      <ScanSheet visible={showScan} onClose={() => setShowScan(false)} onSimulate={simulateScan} productLabel={products[0]?.name ?? ""} />

      {/* ── Extended cart sheet — the no-client + prospect layers live INSIDE
          this window (later siblings) so they can never fall under it. ── */}
      <Modal
        visible={showCartSheet}
        transparent={false}
        animationType="slide"
        onRequestClose={() => {
          if (showProspect) setShowProspect(false);
          else if (showNoClient) setShowNoClient(false);
          else setShowCartSheet(false);
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: insets.top + 12, paddingBottom: 18 + insets.bottom }}>
            {cartView === "cart" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setShowCartSheet(false)} accessibilityLabel="Close cart" style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 17, color: "#fff", fontWeight: "700" }}>✕</Text>
                  </Pressable>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff" }}>{ht.cart}</Text>
                    <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2, fontWeight: "600" }}>{qtyTotal} pcs • {cart.length} atik</Text>
                  </View>
                  <View style={{ width: 44 }} />
                </View>

                {selectedCustomer ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    <Ionicons name="person-outline" size={17} color="#fff" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{selectedCustomer.name}</Text>
                      {!!selectedCustomer.is_prospect ? (
                        <Text style={{ color: "#ffd60a", fontSize: 10, fontWeight: "700", marginTop: 1 }}>PWOSPÈK</Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => setSelectedCustomer(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color="#8e8e93" />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={openCustomers} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    <Ionicons name="person-add-outline" size={17} color="#fff" />
                    <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }}>Add Customer</Text>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                )}

                <CartLinesList
                  cart={cart}
                  editingQtyId={editingQtyId}
                  editingQtyVal={editingQtyVal}
                  onDec={decQty}
                  onInc={incQty}
                  onRemove={removeFromCart}
                  onEditStart={(key) => { setEditingQtyId(key); setEditingQtyVal(""); }}
                  onEditChange={setCustomQty}
                  onEditBlur={() => setEditingQtyId(null)}
                  style={{ marginTop: 14 }}
                />
                <CartTotalBar payPulse={payPulse} subtotal={subtotal} onPay={handleSuivan} label="Suivan" icon="arrow-forward" />
              </>
            ) : cartView === "customers" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setCartView("cart")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                  </Pressable>
                  <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Chwazi Kliyan</Text>
                  <Pressable onPress={openNewCustomer} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                  </Pressable>
                </View>
                <View style={{ flex: 1, marginTop: 12 }}>
                  <CartCustomersView
                    dark
                    search={custSearch}
                    onSearch={setCustSearch}
                    results={custResults}
                    onPick={pickCustomer}
                    onOpenNew={openNewCustomer}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setCartView("customers")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                  </Pressable>
                  <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>New Customer</Text>
                  <Pressable onPress={saveNewCustomer} disabled={!formValid} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: formValid ? 1 : 0.6 }}>
                    <Text style={{ color: formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>Save</Text>
                  </Pressable>
                </View>
                <View style={{ flex: 1, marginTop: 12 }}>
                  <NewCustomerView
                    formKey={formKey}
                    onFormState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }}
                  />
                </View>
              </>
            )}

            {/* ── No-client + prospect layers (extracted — the tablet root
                modals below render the same functions). ── */}
            {showNoClient ? renderNoClientOverlay() : null}
            {showProspect ? renderProspectLayer() : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Tablet: the sheet never opens here, so the SAME layers present
          as root modals above the two panes. ── */}
      <Modal visible={isTablet && showNoClient} transparent animationType="fade" onRequestClose={() => setShowNoClient(false)}>
        <View style={{ flex: 1 }}>{renderNoClientOverlay()}</View>
      </Modal>
      <Modal visible={isTablet && showProspect} animationType="slide" onRequestClose={() => setShowProspect(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>{renderProspectLayer()}</View>
      </Modal>

      {/* Hoisted to root — RN modals portal globally, so the phone prospect
          flow (inside the sheet) presents identically to before. */}
      <CountryDialPicker
        visible={dialOpen}
        onClose={() => setDialOpen(false)}
        onPick={iso => setProspectCountry(iso)}
        title="Chwazi peyi a"
      />

      <UploadTransition visible={busy} phase={phase} title={busyTitle} detail={busyDetail} />
      <ReceiptModal visible={showReceipt} receipts={receipts} onClose={onReceiptClose} locked />
    </View>
  );
}
