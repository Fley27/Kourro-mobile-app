import React, { useEffect, useState, useMemo, useRef } from "react";
import { View, Text, TextInput, Pressable, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform, Animated, Easing } from "react-native";
import { getDb, insertOutbox } from "../db";
import { ht } from "../i18n";
import { palette, radius, shadow } from "../theme";
import {
  loadPricing, ensurePricingForProducts, getUnitsForProduct, getPricesForUnit,
  getDefaultUnit, getBasePrice, resolveLinePrice, getDisplayPrice,
  type PricingMaps, type ProductUnit,
} from "../pricing";
import { USERS } from "../users";
import { tabsUI } from "../tabsUI";
import { fmt, monoStyle } from "../format";
import { Ionicons } from "@expo/vector-icons";
import ReceiptModal from "../components/ReceiptModal";
import { buildReceipts, type ReceiptData } from "../receipts";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import { POSPhone } from "./POSPhone";
import { POSTablet } from "./POSTablet";
import type { Product, CartItem, PendingSel, SuspendedTab, SearchMode } from "./POSShared";
import { CartLineRow, CartTotalsBar, SuspendRow, PayCTA } from "./POSShared";

export default function POSScreen({
  storeId,
  deviceId,
  role = "cashier",
  currentUser,
  storeName,
  selectedCreditCustomer = null,
  onSelectCreditCustomer,
  onTabsChanged,
}: {
  storeId: string;
  deviceId: string;
  role?: string;
  currentUser?: any;
  storeName?: string;
  selectedCreditCustomer?: any | null;
  onSelectCreditCustomer?: (customer: any | null) => void;
  onTabsChanged?: () => void;
}) {
  const responsive = useResponsive();
  const { width, isTablet, isLandscape, padH } = responsive;
  // Side-by-side tablet layout needs landscape width; portrait tablets
  // render the phone layout (with its cart sheet + floating bar).
  const showTablet = isTablet && isLandscape;
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  type PaymentMethod = "cash" | "mobile" | "credit";
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [mobileProvider, setMobileProvider] = useState<"moncash" | "natcash">("moncash");
  const [showMobilePicker, setShowMobilePicker] = useState(false);
  const [amountGiven, setAmountGiven] = useState<string>("");
  const [clientLegalName, setClientLegalName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [akompte, setAkompte] = useState<string>("");
  const [showCashCustomer, setShowCashCustomer] = useState(false);
  const [lastReceipts, setLastReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  // Non-intrusive pending quantity (10s auto-add)
  const [pending, setPending] = useState<{ product: Product; qty: number; remaining: number } & PendingSel | null>(null);
  const [pendingInput, setPendingInput] = useState<string>("");
  const pendingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Multi-variant pricing (units / Cold-Hot variants / bundles)
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [variantSel, setVariantSel] = useState<{ product: Product; unitId: string; variant: string; qty: number } | null>(null);

  // Open sales / tabs (Vant an Atann): suspended carts with frozen variant prices
  const [tabs, setTabs] = useState<SuspendedTab[]>([]);
  const [showTabs, setShowTabs] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [suspendLabel, setSuspendLabel] = useState("");
  const [resumedTabId, setResumedTabId] = useState<string | null>(null);
  const [resumedTabLabel, setResumedTabLabel] = useState("");
  const [transferTabId, setTransferTabId] = useState<string | null>(null);
  const isManagerPlus = ["owner", "admin", "manager"].includes(role || "cashier");
  const myId = currentUser?.id ?? null;
  const myName = currentUser?.name ?? role;

  async function loadTabs() {
    try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM suspended_sales WHERE status = 'open'")) as SuspendedTab[];
      setTabs((rows ?? []).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
      onTabsChanged?.();
    } catch { setTabs([]); }
  }
  useEffect(() => { loadTabs(); }, []);
  const visibleTabs = isManagerPlus ? tabs : tabs.filter(t => (t.cashier_id ?? null) === myId);
  const canResumeTab = (t: SuspendedTab) => isManagerPlus || (t.cashier_id ?? null) === myId;
  // Bridge to the root-level TabsFab: badge count + sheet opener
  useEffect(() => tabsUI.registerOpener(() => { setTransferTabId(null); loadTabs(); setShowTabs(true); }), []);
  useEffect(() => { tabsUI.setCount((tabs ?? []).length); }, [tabs.length]);

  async function logTabEvent(db: any, tabId: string, action: string, note?: string) {
    try {
      await db.runAsync("INSERT INTO suspended_sale_events (id,suspended_sale_id,actor_id,actor_name,action,note,created_at) VALUES (?,?,?,?,?,?,?)",
        [`tev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, tabId, myId, myName, action, note ?? null, new Date().toISOString()]);
    } catch {}
  }

  // Fresh suspend only — opens the label modal so the user can name the new tab.
  function openSuspend() {
    let lines = cart;
    if (pending) {
      const s = { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant };
      lines = mergeLine(cart, pending.product, s, Math.max(1, pending.qty));
      setCart(lines);
      setPending(null); setPendingInput("");
    }
    if (!lines.length) return Alert.alert("Panyen vid", "Ajoute pwodwi anvan ou mete vant lan an atann.");
    setShowCartSheet(false);
    setSuspendLabel("");
    // Open after the cart sheet dismisses — same-tick modal swaps get dropped on iOS
    setTimeout(() => setShowSuspend(true), 350);
  }

  // Add the whole cart (existing + newly added products) into the opened tab.
  // Direct action — no label modal — and the tab STAYS OPEN after saving.
  async function updateResumedTab() {
    if (!resumedTabId) return;
    let lines = cart;
    if (pending) {
      const s = { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant };
      lines = mergeLine(cart, pending.product, s, Math.max(1, pending.qty));
      setCart(lines);
      setPending(null); setPendingInput("");
    }
    if (!lines.length) return Alert.alert("Panyen vid", "Ajoute pwodwi anvan ou mete ajou.");
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const total = lines.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0);
      const stillOpen = (await db.getAllAsync("SELECT * FROM suspended_sales WHERE id = ?", [resumedTabId])) as any[];
      if (!stillOpen.length) {
        setResumedTabId(null); setResumedTabLabel("");
        return Alert.alert("Tab pa egziste", "Tab sa a pa egziste ankò. Panyen an konsève.");
      }
      await db.runAsync("DELETE FROM suspended_sale_items WHERE suspended_sale_id = ?", [resumedTabId]);
      for (let i = 0; i < lines.length; i++) {
        const it = lines[i];
        const base = it.frozenBase ?? (it.unitId ? getBasePrice(pricing, it.unitId, it.variant) : Number(it.unitPrice ?? 0));
        await db.runAsync("INSERT INTO suspended_sale_items (id,suspended_sale_id,store_id,product_id,product_name,unit_id,unit_name,factor,variant,quantity,base_price,unit_price,line_total,bundle_applied,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [`${resumedTabId}_${i}`, resumedTabId, storeId, it.id, it.name, it.unitId || null, it.unitName, it.factor || 1, it.variant || null, it.qty, base, it.unitPrice, it.lineTotal, it.bundleApplied ? 1 : 0, now]);
      }
      await db.runAsync("UPDATE suspended_sales SET total = ?, updated_at = ? WHERE id = ? AND status = 'open'", [total, now, resumedTabId]);
      await logTabEvent(db, resumedTabId, "updated", `${lines.length} atik • ${fmt(total)} HTG`);
      try { await insertOutbox("suspended_sales", "update", { id: resumedTabId, total, status: "open" }); } catch {}
      setCart([]); setPending(null); setPendingInput("");
      setShowCartSheet(false);
      setResumedTabId(null); setResumedTabLabel("");
      await loadTabs();
      Alert.alert("Tab mete ajou ✓", `Nouvo pwodwi yo ajoute nan tab la • ${fmt(total)} HTG. Tab la rete ouvè.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete ajou echwe");
    }
  }

  async function confirmSuspend() {
    const lines = cart;
    if (!lines.length) return Alert.alert("Panyen vid", "Ajoute pwodwi anvan ou kite l ouvè.");
    const label = suspendLabel.trim() || `Tab • ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const total = lines.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0);
      async function writeLines(tabId: string) {
        for (let i = 0; i < lines.length; i++) {
          const it = lines[i];
          const base = it.unitId ? getBasePrice(pricing, it.unitId, it.variant) : Number(it.unitPrice ?? 0);
          await db.runAsync("INSERT INTO suspended_sale_items (id,suspended_sale_id,store_id,product_id,product_name,unit_id,unit_name,factor,variant,quantity,base_price,unit_price,line_total,bundle_applied,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [`${tabId}_${i}`, tabId, storeId, it.id, it.name, it.unitId || null, it.unitName, it.factor || 1, it.variant || null, it.qty, base, it.unitPrice, it.lineTotal, it.bundleApplied ? 1 : 0, now]);
        }
      }
      const id = `tab-${Date.now()}`;
      await db.runAsync("INSERT INTO suspended_sales (id,store_id,label,customer_id,cashier_id,cashier_name,seller_role,status,total,completed_sale_id,device_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, storeId, label, customerId, myId, myName, currentUser?.role ?? role, "open", total, null, deviceId, now, now]);
      await writeLines(id);
      await logTabEvent(db, id, "suspended", `${lines.length} atik • ${fmt(total)} HTG`);
      try { await insertOutbox("suspended_sales", "create", { id, store_id: storeId, label, total, status: "open" }); } catch {}
      setCart([]); setPending(null); setPendingInput("");
      setResumedTabId(null); setResumedTabLabel("");
      setShowSuspend(false); setSuspendLabel("");
      await loadTabs();
      Alert.alert("Vant an atann ✓", `${label} • ${fmt(total)} HTG sove. Pri yo jele.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete an atann echwe");
    }
  }

  function tabAge(created?: string): string {
    if (!created) return "";
    const mins = Math.max(0, Math.round((Date.now() - new Date(created).getTime()) / 60000));
    if (mins < 1) return "kounye a";
    if (mins < 60) return `il y a ${mins} min`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `il y a ${h}h` : `il y a ${Math.floor(h / 24)}j`;
  }

  function resumeTab(t: SuspendedTab) {
    if (!canResumeTab(t)) return Alert.alert("Pa gen dwa", "Se pwòp vant ou oswa yon manadjè ka reprann tab sa a.");
    if (cart.length || pending) {
      Alert.alert("Ranplase panyen?", `Panyen an gen atik. Reprann "${t.label}" ap ranplase l.`, [
        { text: "Anile", style: "cancel" },
        { text: "Reprann", onPress: () => doResume(t) },
      ]);
      return;
    }
    doResume(t);
  }

  async function doResume(t: SuspendedTab) {
    try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM suspended_sale_items WHERE suspended_sale_id = ?", [t.id])) as any[];
      if (!rows.length) return Alert.alert("Tab vid", "Tab sa a pa gen atik.");
      const lines: CartItem[] = [];
      let clamped = 0;
      for (const r of rows) {
        const prod = products.find(p => p.id === r.product_id);
        const factor = Number(r.factor) || 1;
        const stock = Number(prod?.stock_quantity ?? 999999);
        const maxQ = Math.max(0, Math.floor(stock / factor));
        let qty = Math.max(1, Math.floor(Number(r.quantity) || 1));
        if (qty > maxQ) { qty = Math.max(0, maxQ); clamped++; }
        if (qty <= 0) { clamped++; continue; }
        const sel: PendingSel = { unitId: r.unit_id ?? "", unitName: r.unit_name ?? "pcs", factor, variant: r.variant ?? "Regular" };
        const frozenBase = Number(r.base_price);
        const baseProd = { ...(prod ?? { id: r.product_id, name: r.product_name, stock_quantity: stock, cost_price: 0 }) } as Product;
        const pr = priceFor(baseProd, sel, qty, isNaN(frozenBase) ? undefined : frozenBase);
        lines.push({
          ...baseProd,
          key: `${r.product_id}|${sel.unitId || "base"}|${sel.variant}`,
          qty, unitId: sel.unitId, unitName: sel.unitName, factor, variant: sel.variant,
          unitPrice: pr.unitPrice, lineTotal: pr.lineTotal, bundleApplied: pr.bundleApplied,
          frozenBase: isNaN(frozenBase) ? undefined : frozenBase,
        });
      }
      if (!lines.length) return Alert.alert("Stòk ensifizan", "Pa gen ase stòk pou reprann tab sa a kounye a.");
      setCart(lines);
      setPending(null); setPendingInput("");
      setResumedTabId(t.id); setResumedTabLabel(t.label);
      await logTabEvent(db, t.id, "resumed", `${myName} reprann${clamped ? ` (${clamped} liy koupe pa stòk)` : ""}`);
      setShowTabs(false);
      // Open after the tabs sheet dismisses — same-tick modal swaps get dropped on iOS
      setTimeout(() => setShowCartSheet(true), 350);
      if (clamped) Alert.alert("Stòk chanje", `${clamped} liy te koupe paske stòk bese depi suspansyon an. Pri yo rete jele.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Reprann tab echwe");
    }
  }

  function voidTab(t: SuspendedTab) {
    if (!isManagerPlus) return Alert.alert("Pa gen dwa", "Se Manadjè ak pi wo ka anile yon tab.");
    Alert.alert("Anile tab?", `"${t.label}" • ${fmt(Number(t.total ?? 0))} HTG pral efase.`, [
      { text: "Kenbe", style: "cancel" },
      {
        text: "Anile tab", style: "destructive", onPress: () => { (async () => {
          try {
            const db = await getDb();
            await db.runAsync("UPDATE suspended_sales SET status = ? WHERE id = ?", ["voided", t.id]);
            await logTabEvent(db, t.id, "voided", `${myName} anile`);
            try { await insertOutbox("suspended_sales", "update", { id: t.id, status: "voided" }); } catch {}
            if (resumedTabId === t.id) { setResumedTabId(null); setResumedTabLabel(""); }
            await loadTabs();
          } catch (e: any) { Alert.alert("Erè", e?.message ?? "Anile tab echwe"); }
        })(); },
      },
    ]);
  }

  async function confirmTransfer(t: SuspendedTab, targetId: string) {
    const target = USERS.find(u => u.id === targetId);
    if (!target) return;
    if (target.id === t.cashier_id) { setTransferTabId(null); return; }
    try {
      const db = await getDb();
      await db.runAsync("UPDATE suspended_sales SET cashier_id = ?, cashier_name = ? WHERE id = ?", [target.id, target.name, t.id]);
      await logTabEvent(db, t.id, "transferred", `${t.cashier_name ?? "?"} → ${target.name} (pa ${myName})`);
      try { await insertOutbox("suspended_sales", "update", { id: t.id, cashier_id: target.id }); } catch {}
      setTransferTabId(null);
      await loadTabs();
      Alert.alert("Tab transfere ✓", `"${t.label}" kounye a pou ${target.name}.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Transfè echwe");
    }
  }

  // Credit sales are manager+ only; cashiers are read-only for customer records.
  const canRegisterCustomer = ["owner", "admin", "manager"].includes(role || "cashier");
  const canProcessCreditSale = ["owner", "admin", "manager"].includes(role || "cashier");
  const isCreditFlow = !!selectedCreditCustomer;
  // If cashier, Kredi is not an available payment option — ensure selection falls back to cash (except credit flow)
  useEffect(() => {
    if (!canProcessCreditSale && payment === "credit" && !isCreditFlow) {
      setPayment("cash");
    }
  }, [canProcessCreditSale, payment, isCreditFlow]);
  // When switching away from cash, hide cash-customer picker (selection stays for potential return)
  useEffect(() => {
    if (payment !== "cash") setShowCashCustomer(false);
  }, [payment]);
  // Credit flow from CreditScreen: lock to Kredi, sync customerId, ensure transaction registers
  useEffect(() => {
    if (selectedCreditCustomer) {
      setSelectedCustomer(selectedCreditCustomer);
      setCustomerId(selectedCreditCustomer.id ?? null);
      setPayment("credit");
      setShowInlineKrediAdd(false);
    }
  }, [selectedCreditCustomer]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(selectedCreditCustomer ?? null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showInlineKrediAdd, setShowInlineKrediAdd] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustIdCard, setNewCustIdCard] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustAddress, setNewCustAddress] = useState("");
  const [newCustLimit, setNewCustLimit] = useState("");
  const [showLimitEdit, setShowLimitEdit] = useState(false);
  const [limitEditValue, setLimitEditValue] = useState("");
  const [limitEditSource, setLimitEditSource] = useState<"manual" | "auto">("manual");
  // Due date for credit — Apple neat: segmented pills, auto-calculated, custom on demand
  const [creditDueOption, setCreditDueOption] = useState<string>("30");
  const [creditDueDate, setCreditDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [creditDueCustom, setCreditDueCustom] = useState("");

  useEffect(() => {
    (async () => {
      try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 ORDER BY name LIMIT 50")) as Product[];
      const withRank = rows.map(p => ({
        ...p,
        sales_count: p.sales_count ?? (p.sku === "RICE-25KG" ? 120 : p.sku === "PREST-330" ? 95 : p.sku === "OIL-5L" ? 60 : 30),
        barcode: p.barcode ?? p.sku ?? "",
        category_id: p.category_id ?? "",
      }));
      withRank.sort((a, b) => (b.sales_count! - a.sales_count!));
      if (withRank.length === 0) {
        setProducts([
          { id: "prod-1", name: "Rice 25kg", name_ht: "Diri 25kg", barcode: "RICE-25KG", sku: "RICE-25KG", selling_price: 3200, stock_quantity: 40, cost_price: 2500, sales_count: 120 },
          { id: "prod-2", name: "Cooking Oil 5L", barcode: "OIL-5L", sku: "OIL-5L", selling_price: 1100, stock_quantity: 25, cost_price: 800, sales_count: 60 },
          { id: "prod-3", name: "Prestige Beer", barcode: "PREST-330", sku: "PREST-330", selling_price: 100, stock_quantity: 3, cost_price: 75, sales_count: 95 },
          { id: "prod-4", name: "Laundry Soap", barcode: "SOAP-001", sku: "SOAP-001", selling_price: 50, stock_quantity: 200, cost_price: 30, sales_count: 30 },
          { id: "prod-5", name: "Flour 25kg", name_ht: "Farin 25kg", barcode: "FARIN-25KG", sku: "FARIN-25KG", selling_price: 2800, stock_quantity: 30, cost_price: 2200, sales_count: 45 },
          { id: "prod-6", name: "White Sugar 10kg", name_ht: "Sik Blan 10kg", barcode: "SIK-10KG", sku: "SIK-10KG", selling_price: 950, stock_quantity: 35, cost_price: 700, sales_count: 50 },
          { id: "prod-7", name: "Spaghetti 500g", name_ht: "Pasta 500g", barcode: "PASTA-500", sku: "PASTA-500", selling_price: 75, stock_quantity: 80, cost_price: 45, sales_count: 70 },
          { id: "prod-8", name: "Tomato Paste 400g", name_ht: "Tomat 400g", barcode: "TOMAT-400", sku: "TOMAT-400", selling_price: 120, stock_quantity: 60, cost_price: 80, sales_count: 55 },
          { id: "prod-9", name: "Sardine Tin 120g", name_ht: "Sardine 120g", barcode: "SARDINE-120", sku: "SARDINE-120", selling_price: 85, stock_quantity: 100, cost_price: 55, sales_count: 65 },
          { id: "prod-10", name: "Milk Powder 400g", name_ht: "Lèt 400g", barcode: "LET-400", sku: "LET-400", selling_price: 650, stock_quantity: 40, cost_price: 480, sales_count: 40 },
          { id: "prod-11", name: "Rea Coffee 200g", name_ht: "Kafe 200g", barcode: "KAFE-200", sku: "KAFE-200", selling_price: 450, stock_quantity: 50, cost_price: 320, sales_count: 35 },
          { id: "prod-12", name: "Sayo Biscuit", name_ht: "Biskè Sayo", barcode: "BISK-30", sku: "BISK-30", selling_price: 25, stock_quantity: 150, cost_price: 15, sales_count: 80 },
          { id: "prod-13", name: "Couronne Cola 500ml", name_ht: "Kola 500ml", barcode: "KOLA-500", sku: "KOLA-500", selling_price: 50, stock_quantity: 90, cost_price: 30, sales_count: 75 },
          { id: "prod-14", name: "Water 5gal", name_ht: "Dlo 5 gal", barcode: "DLO-19L", sku: "DLO-19L", selling_price: 150, stock_quantity: 25, cost_price: 100, sales_count: 25 },
          { id: "prod-15", name: "Detergent Powder 1kg", name_ht: "Savon Poud 1kg", barcode: "SAVON-DET", sku: "SAVON-DET", selling_price: 120, stock_quantity: 45, cost_price: 85, sales_count: 38 },
          { id: "prod-16", name: "Colgate Toothpaste", name_ht: "Pat Colgate", barcode: "PAT-COLG", sku: "PAT-COLG", selling_price: 180, stock_quantity: 60, cost_price: 130, sales_count: 32 },
          { id: "prod-17", name: "Corn Meal 10kg", name_ht: "Mayi 10kg", barcode: "MAYI-10KG", sku: "MAYI-10KG", selling_price: 800, stock_quantity: 20, cost_price: 600, sales_count: 28 },
          { id: "prod-18", name: "Salt 5kg", name_ht: "Sèl 5kg", barcode: "SEL-5KG", sku: "SEL-5KG", selling_price: 300, stock_quantity: 30, cost_price: 200, sales_count: 22 },
        ]);
      } else {
        setProducts(withRank);
      }
      try {
        // Multi-variant pricing: units / Cold-Hot prices / bundles (+ legacy defaults)
        const pm = await ensurePricingForProducts(db, withRank);
        setPricing(pm);
      } catch (e) { console.log("[POS pricing] failed:", e); }
      } catch (e) {
        console.log("[POS products] failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM customers")) as any[];
        // dedupe by id — legacy Date.now() could have collided
        setCustomers(Array.from(new Map(rows.map((c: any) => [c.id, c] as const)).values()));
      } catch {}
    })();
  }, [showPayModal]);

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

  // ---- multi-variant pricing (bound to pricing state) ----
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
  function isSinglePrice(p: Product): boolean {
    const units = getUnitsForProduct(pricing, p.id);
    if (units.length === 0) return true; // legacy fallback: single price
    if (units.length !== 1) return false;
    return getPricesForUnit(pricing, units[0].id).filter(r => Number(r.price) > 0).length <= 1;
  }
  function maxQtyFor(p: Product, factor: number): number {
    return Math.max(0, Math.floor(Number(p.stock_quantity ?? 0) / (Number(factor) || 1)));
  }
  function priceFor(p: Product, sel: PendingSel, qty: number, frozenBase?: number) {
    if (!sel.unitId) {
      const up = frozenBase != null && !isNaN(frozenBase) ? Number(frozenBase) : Number(p.selling_price ?? 0) || 0;
      const lineTotal = Math.round(up * Math.max(0, qty) * 100) / 100;
      return { unitPrice: up, lineTotal, bundleApplied: false };
    }
    return resolveLinePrice(pricing, sel.unitId, sel.variant, qty, frozenBase);
  }
  function displayPriceFor(p: Product): string {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return `${fmt(d.price)} HTG${d.variant && d.variant !== "Regular" ? ` · ${d.variant}` : ""}`;
    const legacy = Number(p.selling_price ?? 0) || 0;
    return legacy > 0 ? `${fmt(legacy)} HTG` : "—";
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

  function commitPending(product: Product, qty: number, sel?: PendingSel) {
    if (pendingTimer.current) { clearInterval(pendingTimer.current); pendingTimer.current = null; }
    const s = sel ?? (pending && pending.product.id === product.id
      ? { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }
      : defaultSelFor(product));
    setCart(prev => mergeLine(prev, product, s, Math.max(1, qty)));
    setPending(null);
  }

  function handleProductPress(p: Product) {
    setSearch("");
    if (pending && pending.product.id === p.id && isSinglePrice(p)) {
      const maxQ = Math.max(1, maxQtyFor(p, pending.factor));
      const next = Math.min(pending.qty + 1, maxQ);
      setPending({ ...pending, qty: next, remaining: 10 });
      setPendingInput("");
      return;
    }
    if (pending) {
      commitPending(pending.product, pending.qty, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant });
    }
    if (isSinglePrice(p)) {
      setPending({ product: p, qty: 1, remaining: 10, ...defaultSelFor(p) });
    } else {
      // Multi-variant (Unit/Box, Cold/Hot...) → choose in the variant sheet
      const s = defaultSelFor(p);
      setVariantSel({ product: p, unitId: s.unitId, variant: s.variant, qty: 1 });
    }
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

  const subtotal = cart.reduce((s, it) => s + (Number(it.lineTotal ?? it.qty * (it.unitPrice ?? 0)) || 0), 0);
  const pendingLine = pending ? priceFor(pending.product, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }, pending.qty) : null;
  const pendingMaxQ = pending ? maxQtyFor(pending.product, pending.factor) : 0;
  const amountGivenNum = parseFloat(amountGiven.replace(",", ".")) || 0;
  const change = payment === "cash" && amountGiven ? Math.max(0, amountGivenNum - subtotal) : 0;

  const filtered = useMemo(() => {
    const outRank = (p: Product) => (p.stock_quantity <= 0 ? 1 : 0); // out-of-stock to bottom in sales
    const byStockThenRank = (a: Product, b: Product) => {
      const ra = outRank(a), rb = outRank(b);
      if (ra !== rb) return ra - rb;
      return (b.sales_count ?? 0) - (a.sales_count ?? 0);
    };
    const q = search.trim().toLowerCase();
    if (!q) return [...products].sort(byStockThenRank);
    let list = products;
    if (searchMode === "barcode") {
      list = products.filter(p => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q);
    } else if (searchMode === "category") {
      list = products.filter(p => (p.category_id ?? "").toLowerCase().includes(q));
    } else {
      list = products.filter(p => p.name.toLowerCase().includes(q) || p.name_ht?.toLowerCase().includes(q));
    }
    return [...list].sort(byStockThenRank);
  }, [products, search, searchMode]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => {
      const name = (c.name ?? "").toLowerCase();
      const idCard = (c.id_card_number ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(q) || idCard.includes(q) || phone.includes(q);
    });
  }, [customers, customerSearch]);

  function addToCart(p: Product) { handleProductPress(p); }

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

  function confirmClearCart() {
    if (!cart.length) return;
    Alert.alert("Vide panyen?", `${cart.length} atik • ${cart.reduce((s, it) => s + it.qty, 0)} pcs pral efase.`, [
      { text: "Anile", style: "cancel" },
      { text: "Vide tout", style: "destructive", onPress: () => { setCart([]); setPending(null); setPendingInput(""); setShowCartSheet(false); } },
    ]);
  }

  // Soft breathing pulse for the Pay CTA so it draws the eye
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

  function onBarcodeSubmit() {
    if (!search.trim()) return;
    const found = products.find(p => p.barcode?.toLowerCase() === search.trim().toLowerCase() || p.sku?.toLowerCase() === search.trim().toLowerCase());
    if (found) handleProductPress(found);
    else Alert.alert("Pa jwenn", `Pa gen pwodwi ak kòd ${search}`);
  }
  function simulateScan() {
    const top = products[0];
    if (top) { setSearch(top.barcode ?? top.sku ?? ""); handleProductPress(top); setShowBarcodeModal(false); }
  }

  function selectCustomer(customer: any | null) {
    setSelectedCustomer(customer);
    setCustomerId(customer?.id ?? null);
    onSelectCreditCustomer?.(customer);
  }

  // Cash/loyalty: link an existing customer to a cash sale WITHOUT switching to credit
  function selectCashCustomer(customer: any | null) {
    setSelectedCustomer(customer);
    setCustomerId(customer?.id ?? null);
  }

  function pickDueOption(opt: string) {
    setCreditDueOption(opt);
    if (opt !== "custom") {
      const days = Number(opt);
      const d = new Date();
      d.setDate(d.getDate() + (isNaN(days) ? 30 : days));
      setCreditDueDate(d.toISOString().slice(0, 10));
      setCreditDueCustom("");
    }
  }

  function renderAkompteBlock() {
    if (!selectedCustomer) return null;
    const a = parseFloat(akompte) || 0;
    const over = a > subtotal;
    return (
      <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12 }}>💰</Text></View>
            <View>
              <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A", letterSpacing: -0.2 }}>Akompte (opsyonèl)</Text>
              <Text style={{ fontSize: 10, color: "#94A3B8", marginTop: 1 }}>Rès la vin premye tranch dèt</Text>
            </View>
          </View>
          {akompte.trim() !== "" && (
            <Pressable onPress={() => setAkompte("")} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 16, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9" }}>
              <Ionicons name="close" size={12} color="#94A3B8" />
              <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "600" }}>Retire</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: over ? "#FECACA" : "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, height: 46 }}>
          <TextInput placeholder="Montan peye kounye a" placeholderTextColor="#CBD5E1" value={akompte} onChangeText={setAkompte} keyboardType="numeric" style={{ flex: 1, fontSize: 15, fontWeight: "700", color: "#0F172A", textAlign: "right", ...monoStyle }} />
          <Text style={{ fontSize: 12, color: "#94A3B8", fontWeight: "800" }}>HTG</Text>
          <Pressable onPress={() => setAkompte(String(subtotal))} style={{ paddingHorizontal: 12, height: 28, borderRadius: 9, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "white", fontWeight: "800", fontSize: 11 }}>Tout</Text>
          </Pressable>
        </View>
        {akompte.trim() !== "" && (() => {
          const r = Math.max(0, Math.round((subtotal - a) * 100) / 100);
          return (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" }}>
                <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "700", letterSpacing: 0.5 }}>AKOMPTE</Text>
                <Text style={{ fontWeight: "800", fontSize: 14, color: a > 0 ? "#7C3AED" : "#94A3B8", marginTop: 2, ...monoStyle }}>{a > 0 ? `${fmt(Math.min(a, subtotal))} HTG` : "—"}</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: "center", borderWidth: 1, backgroundColor: r <= 0 ? "#F5F3FF" : "#F0FDF4" }}>
                <Text style={{ fontSize: 10, color: r <= 0 ? "#6D28D9" : "#166534", fontWeight: "700", letterSpacing: 0.5 }}>RÈS KREDI</Text>
                <Text style={{ fontWeight: "800", fontSize: 14, color: r <= 0 ? "#6D28D9" : "#16A34A", marginTop: 2, ...monoStyle }}>{r <= 0 ? "Peze nan" : `${fmt(r)} HTG`}</Text>
              </View>
            </View>
          );
        })()}
      </View>
    );
  }

  async function handleAddCustomer() {
    if (!newCustName.trim()) return Alert.alert("Non obligatwa");
    if (!newCustIdCard.trim()) return Alert.alert("ID obligatwa", "Nimewo kat idantite (NIF/CIN) obligatwa pou distenge kliyan ki gen menm non");
    if (!canRegisterCustomer) return Alert.alert("Pa gen dwa", "Kesye ka sèlman li lis kliyan yo. Li pa ka kreye nouvo klient.");
    const limit = newCustLimit.trim() === "" ? null : parseInt(newCustLimit, 10);
    if (newCustLimit.trim() !== "" && (isNaN(limit as number) || (limit as number) < 0)) return Alert.alert("Limit pa valab");
    const id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newCust = { id, store_id: storeId, name: newCustName.trim(), id_card_number: newCustIdCard.trim(), phone: newCustPhone.trim() || null, address: newCustAddress.trim() || null, credit_limit: limit, credit_limit_source: limit !== null ? "manual" : null, total_debt: 0, is_high_risk: false, open_debt_count: 0, created_at: new Date().toISOString() };
    try {
    const db = await getDb();
    await db.runAsync("INSERT INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [newCust.id, newCust.store_id, newCust.name, newCust.phone, newCust.address, newCust.id_card_number, newCust.total_debt, newCust.credit_limit, newCust.credit_limit_source, newCust.is_high_risk ? 1 : 0, newCust.open_debt_count]);
    // persist with all fields, then fetch back to ensure DB record is source of truth — dedupe prevents duplicate key
    const fresh = { ...newCust };
    setCustomers(prev => (prev.some(c => c.id === fresh.id) ? prev : [...prev, fresh]));
    selectCustomer(fresh);
    setCustomerSearch("");
    setNewCustName(""); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); setNewCustLimit("");
    setShowAddCustomer(false);
    setShowInlineKrediAdd(false);
    // auto-selected with full info (incl. address) — proceed to Konfime peye
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  async function handleEditCustomerLimit() {
    if (!selectedCustomer || !canRegisterCustomer) return;
    const nextLimit = limitEditValue.trim() === "" ? null : Number(limitEditValue);
    if (nextLimit !== null && (Number.isNaN(nextLimit) || nextLimit < 0)) {
      return Alert.alert("Limit pa valab");
    }
    try {
    const db = await getDb();
    await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [nextLimit, limitEditSource, selectedCustomer.id]);
    setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, credit_limit: nextLimit, credit_limit_source: nextLimit === null ? null : limitEditSource } : c));
    setSelectedCustomer((prev: any) => prev ? { ...prev, credit_limit: nextLimit, credit_limit_source: nextLimit === null ? null : limitEditSource } : prev);
    setShowLimitEdit(false);
    setLimitEditValue("");
    Alert.alert("Limit mete ajou", `${selectedCustomer.name} • ${nextLimit === null ? "San limit" : `${nextLimit} HTG`} • Sous: ${limitEditSource === "manual" ? "manyèl" : "otomatik"}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete limit ajou echwe");
    }
  }

  async function confirmPay() {
    if (!cart.length) return Alert.alert(ht.emptyCart);
    if (pending) { commitPending(pending.product, pending.qty); }
    // defer to next tick to include pending
    setTimeout(async () => {
      const currentCart = pending ? [...cart, { ...pending.product, qty: pending.qty } as CartItem] : cart;
      // Actually cart state may not have updated yet; use fresh
    }, 0);
    if (payment === "cash" && amountGiven && amountGivenNum < subtotal) {
      return Alert.alert("Kòb ensifizan", `Kliyan bay ${amountGivenNum} HTG, total se ${subtotal} HTG. Rès pou peye: ${subtotal - amountGivenNum} HTG`);
    }
    if (payment === "mobile" && (!clientLegalName.trim() || !clientPhone.trim())) {
      return Alert.alert("Enfòmasyon kliyan obligatwa", "Non legal ak telefòn obligatwa pou MonCash/NatCash — ranpli tou de chan yo.");
    }
    if (payment === "credit" && !canProcessCreditSale) {
      return Alert.alert("Pa gen dwa", "Se Manager ak pi wo ka fè vant sou kredi. Kesye pa ka fè vant sou kredi.");
    }
    if (payment === "credit") {
      if (!selectedCustomer) return Alert.alert("Kliyan obligatwa", "Chwazi yon kliyan ki anrejistre anvan vant kredi — verifye kat idantite");
      if (!selectedCustomer.id_card_number) return Alert.alert("ID obligatwa", "Kliyan sa a pa gen nimewo kat idantite — enskri ak NIF/CIN pou distenge menm non");
      const bal = Number(selectedCustomer.total_debt ?? 0);
      const lim = selectedCustomer.credit_limit === null || selectedCustomer.credit_limit === undefined || selectedCustomer.credit_limit === 0 ? null : Number(selectedCustomer.credit_limit);
      const isHighRisk = !!selectedCustomer.is_high_risk || bal > 0;
      if (isHighRisk) {
        // Visibility flag for staff judgment; hard-block is driven by the credit-limit rule.
      }
      if (bal < 0) {
        return Alert.alert("⚠️ Balans negatif", `${selectedCustomer.name} (${selectedCustomer.id_card_number}) gen dèt negatif (${bal} HTG). Pa konseye bay kredi — mande kach oswa kontakte Manadjè.`, [{ text: "Mande kach", style: "cancel" }, { text: "Kontinye kanmenm", onPress: () => {} }]);
      }
      if (lim !== null && bal + subtotal > lim) {
        return Alert.alert("⚠️ Depase limit kredi — BLOKE", `${selectedCustomer.name} (${selectedCustomer.id_card_number}) • Limit: ${lim} HTG (${selectedCustomer.credit_limit_source ?? "manyèl/oto"}) • Dèt kounye a: ${bal} HTG • Apre vant: ${bal + subtotal} HTG\n\nSistèm bloke vant kredi sa a!`, [{ text: "Mande kach", style: "cancel" }]);
      }
      if (!creditDueDate || isNaN(new Date(creditDueDate).getTime())) {
        return Alert.alert("Echèans obligatwa", "Chwazi yon dat echèans pou kredi a (7/15/30/60 jou oswa lòt dat)");
      }
      if (akompte.trim() !== "" && ((parseFloat(akompte) || 0) < 0 || (parseFloat(akompte) || 0) > subtotal)) {
        return Alert.alert("Akompte pa valab", `Akompte a dwe ant 0 ak ${fmt(subtotal)} HTG`);
      }
    }
    // If pending exists, commit it now before checkout
    let finalCart = cart;
    if (pending) {
      const s = { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant };
      finalCart = mergeLine(cart, pending.product, s, pending.qty);
      setCart(finalCart);
      setPending(null);
    }
    if (!finalCart.length) return Alert.alert(ht.emptyCart);
    const finalSubtotal = finalCart.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0);
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const saleNumber = `VTE-${Date.now().toString().slice(-6)}`;
    const isCashLike = payment === "cash" || payment === "mobile";
    const akompteNum = payment === "credit" ? Math.min(Math.max(parseFloat(akompte) || 0, 0), finalSubtotal) : 0;
    const amountPaid = isCashLike ? (amountGiven ? amountGivenNum : finalSubtotal) : akompteNum;
    const pm: string = payment === "mobile" ? mobileProvider : payment;
    const sale = {
      id: saleId, store_id: storeId, sale_number: saleNumber,
      customer_id: customerId, status: payment === "credit" ? "credit" : "completed",
      payment_method: pm, subtotal: finalSubtotal, discount: 0, total: finalSubtotal, amount_paid: amountPaid,
      amount_due: Math.max(0, finalSubtotal - amountPaid),
      seller_id: currentUser?.id ?? null, seller_role: currentUser?.role ?? null,
      device_id: deviceId, lamport_clock: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false,
    };
    try {
    const db = await getDb();
    await db.runAsync("INSERT INTO sales (id,store_id,sale_number,customer_id,status,payment_method,subtotal,total,amount_paid,amount_due,seller_id,seller_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [sale.id, sale.store_id, sale.sale_number, sale.customer_id, sale.status, sale.payment_method, sale.subtotal, sale.total, sale.amount_paid, sale.amount_due, sale.seller_id, sale.seller_role, sale.created_at, sale.updated_at]);
    for (let lineIdx = 0; lineIdx < finalCart.length; lineIdx++) {
      const it = finalCart[lineIdx];
      const itemId = `${saleId}_${lineIdx}_${it.id}`;
      // FIFO batch consumption in BASE units (selected qty × conversion factor)
      const baseQty = (Number(it.qty) || 0) * (Number(it.factor) || 1);
      let remainingToSell = baseQty;
      let consumedCost = 0;
      const batchRows = ((await db.getAllAsync(
        "SELECT * FROM stock_movements WHERE product_id = ? AND type = 'in' AND remaining_qty > 0 AND status = 'delivered' ORDER BY created_at ASC, id ASC",
        [it.id]
      )) as any[])
        .filter((br: any) => br && br.type === "in" && Number(br.remaining_qty) > 0 && br.status === "delivered")
        .sort((a: any, b: any) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
      for (const br of batchRows) {
        if (remainingToSell <= 0) break;
        const consume = Math.min(br.remaining_qty, remainingToSell);
        const unitCostWithTransport = br.quantity > 0 && br.allocated_transport ? (Number(br.unit_cost) + Number(br.allocated_transport) / Number(br.quantity)) : Number(br.unit_cost);
        consumedCost += consume * unitCostWithTransport;
        await db.runAsync("UPDATE stock_movements SET remaining_qty = remaining_qty - ? WHERE id = ?", [consume, br.id]);
        remainingToSell -= consume;
      }
      await db.runAsync("INSERT INTO sale_items (id,store_id,sale_id,product_id,product_name,unit_id,variant,quantity,unit_price,cost_price,line_total,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [itemId, storeId, saleId, it.id, it.name, it.unitId || null, it.variant || null, it.qty, it.unitPrice, consumedCost, it.lineTotal, new Date().toISOString()]);
      await db.runAsync("UPDATE products SET stock_quantity = stock_quantity - ?, current_amount_available = current_amount_available - ? WHERE id = ?", [baseQty, baseQty, it.id]);
    }
    await insertOutbox("sales", "create", sale);
    if (resumedTabId) {
      await db.runAsync("UPDATE suspended_sales SET status = ?, completed_sale_id = ? WHERE id = ?", ["completed", saleId, resumedTabId]);
      await logTabEvent(db, resumedTabId, "completed", `${saleNumber} • ${fmt(finalSubtotal)} HTG`);
      try { await insertOutbox("suspended_sales", "update", { id: resumedTabId, status: "completed" }); } catch {}
      setResumedTabId(null); setResumedTabLabel("");
    }
    if (payment === "credit" && customerId) {
      const creditBalance = Math.max(0, finalSubtotal - akompteNum);
      const credit = { id: `cr_${saleId}`, store_id: storeId, sale_id: saleId, customer_id: customerId, amount: finalSubtotal, amount_paid: akompteNum, balance: creditBalance, status: creditBalance <= 0 ? "paid" : (akompteNum > 0 ? "partial" : "pending"), due_date: creditDueDate, updated_at: new Date().toISOString() };
      await db.runAsync("INSERT INTO credits (id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [credit.id, credit.store_id, credit.sale_id, credit.customer_id, credit.amount, credit.amount_paid, credit.balance, credit.status, credit.due_date, credit.updated_at]);
      await insertOutbox("credits", "create", credit);
      // First installment — down payment (if any)
      if (akompteNum > 0) {
        const receipt = `REC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
        await db.runAsync("INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by) VALUES (?,?,?,?,?,?,?,?,?)",
          [`pay-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, storeId, credit.id, credit.id, akompteNum, "cash", receipt, new Date().toISOString(), currentUser?.id ?? null]);
      }
      // update customer's debt total — only the unpaid remainder is debt
      const custForUpdate = selectedCustomer ?? customers.find((c: any) => c.id === customerId) as any;
      const newTotalDebt = Number(custForUpdate?.total_debt ?? 0) + creditBalance;
      const newOpenCount = Number(custForUpdate?.open_debt_count ?? 0) + (creditBalance > 0 ? 1 : 0);
      await db.runAsync("UPDATE customers SET total_debt = ? WHERE id = ?", [newTotalDebt, customerId]);
      await db.runAsync("UPDATE customers SET is_high_risk = ? WHERE id = ?", [creditBalance > 0 ? 1 : 0, customerId]);
      await db.runAsync("UPDATE customers SET open_debt_count = ? WHERE id = ?", [newOpenCount, customerId]);
      setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, total_debt: newTotalDebt, is_high_risk: true, open_debt_count: newOpenCount } as any : c));
      setSelectedCustomer((prev: any) => (prev && prev.id === customerId ? { ...prev, total_debt: newTotalDebt, is_high_risk: true, open_debt_count: newOpenCount } : prev));
    }
    const finalChange = payment === "cash" && amountGiven ? Math.max(0, amountGivenNum - finalSubtotal) : 0;
    let receiptCustomer: { name: string; idCard?: string | null; phone?: string | null } | null = null;
    if (selectedCustomer && customerId) {
      receiptCustomer = { name: selectedCustomer.name, idCard: selectedCustomer.id_card_number ?? null, phone: selectedCustomer.phone ?? null };
    } else if (payment === "mobile" && clientLegalName.trim()) {
      receiptCustomer = { name: clientLegalName.trim(), idCard: null, phone: clientPhone.trim() || null };
    }
    const receipts = buildReceipts({
      saleId,
      saleNumber,
      storeName: storeName ?? "Jesyon Magazen",
      createdAt: new Date().toISOString(),
      cashier: { id: currentUser?.id ?? null, name: myName, role: currentUser?.role ?? role },
      customer: receiptCustomer,
      items: finalCart.map(it => ({
        name: it.name,
        variant: it.variant !== "Regular" ? it.variant : null,
        unitName: it.unitName ?? null,
        qty: it.qty,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
      })),
      subtotal: finalSubtotal,
      discount: 0,
      total: finalSubtotal,
      paymentMethod: pm,
      amountPaid,
      amountDue: Math.max(0, finalSubtotal - amountPaid),
      change: finalChange,
      dueDate: payment === "credit" ? creditDueDate : null,
    });
    for (const r of [receipts.customer, receipts.store]) {
      await db.runAsync(
        "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.id, storeId, saleId, r.copyType, r.receiptNumber, saleNumber, r.cashier.id, r.cashier.name, r.cashier.role, JSON.stringify(r), r.createdAt]
      );
    }
    // Realtime: notify Home/Analytics instantly without polling delay
    try { const { salesEvents } = await import("../salesEvents"); salesEvents.emit(); } catch {}
    setLastReceipts(receipts);
    setCart([]);
    loadTabs();
    setAmountGiven("");
    setClientLegalName("");
    setClientPhone("");
    setAkompte("");
    setShowPayModal(false);
    setShowCartSheet(false);
    // Open the receipt after the pay/cart sheets dismiss — same-tick modal swaps get dropped on iOS
    setTimeout(() => setShowReceipt(true), 420);
    if (isCreditFlow) {
      onSelectCreditCustomer?.(null);
      setSelectedCustomer(null);
      setCustomerId(null);
      setPayment("cash");
      setCreditDueOption("30");
      const d = new Date(); d.setDate(d.getDate() + 30); setCreditDueDate(d.toISOString().slice(0, 10)); setCreditDueCustom("");
      setShowInlineKrediAdd(false);
    }
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Vant lan echwe — okenn chanjman pa anrejistre nèt. Verifye epi re-eseye.");
    }
  }

  const cartCount = cart.reduce((s, it) => s + it.qty, 0);
  const cartTotalItems = cart.length;

  // Luxury entrance — Apple-like stagger
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {showTablet ? (
        <POSTablet
          search={search}
          searchMode={searchMode}
          entrance={entrance}
          payPulse={payPulse}
          pending={pending}
          pendingInput={pendingInput}
          pendingLine={pendingLine}
          pendingMaxQ={pendingMaxQ}
          products={filtered}
          cart={cart}
          subtotal={subtotal}
          resumedTabId={resumedTabId}
          resumedTabLabel={resumedTabLabel}
          visibleTabsCount={visibleTabs.length}
          editingQtyId={editingQtyId}
          editingQtyVal={editingQtyVal}
          onSearchChange={setSearch}
          onSearchModeChange={setSearchMode}
          onBarcodeSubmit={onBarcodeSubmit}
          onOpenScanner={() => setShowBarcodeModal(true)}
          onAdjustPending={adjustPending}
          onPendingCustom={setPendingCustom}
          onPendingBlurClear={() => setPendingInput('')}
          onCommitPending={commitPendingWithInput}
          onCancelPending={() => setPending(null)}
          onProductPress={handleProductPress}
          displayPriceFor={displayPriceFor}
          onClearCart={confirmClearCart}
          onSuspend={openSuspend}
          onUpdateResumedTab={updateResumedTab}
          onOpenTabs={() => { setTransferTabId(null); loadTabs(); setShowTabs(true); }}
          onDecQty={decQty}
          onIncQty={incQty}
          onRemoveLine={removeFromCart}
          onEditQtyStart={(key) => { setEditingQtyId(key); setEditingQtyVal(''); }}
          onEditQtyChange={setCustomQty}
          onEditQtyBlur={() => setEditingQtyId(null)}
          onPay={() => { setShowCartSheet(false); setShowPayModal(true); }}
        />
      ) : (
        <POSPhone
          search={search}
          searchMode={searchMode}
          entrance={entrance}
          pending={pending}
          pendingInput={pendingInput}
          pendingLine={pendingLine}
          pendingMaxQ={pendingMaxQ}
          products={filtered}
          cart={cart}
          subtotal={subtotal}
          onSearchChange={setSearch}
          onSearchModeChange={setSearchMode}
          onBarcodeSubmit={onBarcodeSubmit}
          onOpenScanner={() => setShowBarcodeModal(true)}
          onAdjustPending={adjustPending}
          onPendingCustom={setPendingCustom}
          onPendingBlurClear={() => setPendingInput('')}
          onCommitPending={commitPendingWithInput}
          onCancelPending={() => setPending(null)}
          onProductPress={handleProductPress}
          displayPriceFor={displayPriceFor}
          onOpenCart={() => setShowCartSheet(true)}
        />
      )}

      {/* Tabs FAB lives at the app root (TabsFab) — above header and nav */}

      {/* Expanded cart sheet */}
      <Modal visible={showCartSheet && !showTablet} transparent animationType="slide" onRequestClose={() => setShowCartSheet(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(17,24,39,0.42)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "85%", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 16 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={{ fontWeight: "900", fontSize: 22, color: "#16130c" }}>{ht.cart}</Text>
                <Text style={{ color: "#9ca3af", fontSize: 12, marginTop: 2, fontWeight: "600" }}>{cart.reduce((s, it) => s + it.qty, 0)} pcs • {cart.length} atik</Text>
              </View>
              <Pressable onPress={() => setShowCartSheet(false)} accessibilityLabel="Close cart" style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, color: "#6b7280", fontWeight: "700" }}>⌄</Text></Pressable>
            </View>
            <View style={{ marginTop: 12 }}>
              <SuspendRow resumedTabId={resumedTabId} resumedTabLabel={resumedTabLabel} onClear={confirmClearCart} onSuspendOrUpdate={resumedTabId ? updateResumedTab : openSuspend} />
            </View>
            <ScrollView style={{ marginTop: 14, maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {cart.map(c => (
                <CartLineRow
                  key={c.key}
                  item={c}
                  editingQtyId={editingQtyId}
                  editingQtyVal={editingQtyVal}
                  onDec={() => decQty(c.key)}
                  onInc={() => incQty(c.key)}
                  onRemove={() => removeFromCart(c.key)}
                  onEditStart={() => { setEditingQtyId(c.key); setEditingQtyVal(""); }}
                  onEditChange={(v) => setCustomQty(c.key, v)}
                  onEditBlur={() => setEditingQtyId(null)}
                />
              ))}
            </ScrollView>
            <CartTotalsBar subtotal={subtotal} />
            <PayCTA payPulse={payPulse} subtotal={subtotal} onPay={() => { setShowCartSheet(false); setShowPayModal(true); }} />
            <Pressable onPress={() => setShowCartSheet(false)} style={{ marginTop: 8, padding: 10, alignItems: "center" }}><Text style={{ color: "#64748b", fontWeight: "600" }}>Kontinye achte</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Variant selector: Unit/Box → Cold/Hot → qty (bundle auto-applied) */}
      {variantSel && (() => {
        const units = getUnitsForProduct(pricing, variantSel.product.id).filter(u => getPricesForUnit(pricing, u.id).some(r => Number(r.price) > 0));
        const selUnit = units.find(u => u.id === variantSel.unitId) ?? getDefaultUnit(units);
        const variants = selUnit ? getPricesForUnit(pricing, selUnit.id).filter(r => Number(r.price) > 0) : [];
        const factor = Number(selUnit?.conversion_factor) || 1;
        const maxQ = Math.max(1, maxQtyFor(variantSel.product, factor));
        const qty = Math.max(1, Math.min(variantSel.qty, maxQ));
        const line = selUnit ? resolveLinePrice(pricing, selUnit.id, variantSel.variant, qty) : { unitPrice: 0, lineTotal: 0, bundleApplied: false };
        return (
          <Modal visible transparent animationType="slide" onRequestClose={() => setVariantSel(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28 }}>
                <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 17, color: "#16130c" }} numberOfLines={1}>{variantSel.product.name}</Text>
                    <Text style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{Math.floor(Number(variantSel.product.stock_quantity ?? 0))} inite baz disponib</Text>
                  </View>
                  <Pressable onPress={() => setVariantSel(null)} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, color: "#6b7280", fontWeight: "700" }}>✕</Text></Pressable>
                </View>
                <Text style={{ fontWeight: "700", fontSize: 12, color: "#374151", marginTop: 14, marginBottom: 7 }}>Inite</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {units.map(u => {
                    const active = selUnit?.id === u.id;
                    return (
                      <Pressable key={u.id} onPress={() => {
                        const rows = getPricesForUnit(pricing, u.id).filter(r => Number(r.price) > 0);
                        const v = rows.find(r => r.variant === "Regular") ?? rows[0];
                        setVariantSel(prev => prev && ({ ...prev, unitId: u.id, variant: v?.variant ?? "Regular", qty: 1 }));
                      }} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: active ? "#16130c" : "#f9f9fb", borderWidth: 1, borderColor: active ? "#16130c" : "#e5e5ea" }}>
                        <Text style={{ color: active ? "white" : "#374151", fontWeight: "800", fontSize: 13 }}>{u.unit_name}{Number(u.conversion_factor) > 1 ? ` ×${u.conversion_factor}` : ""}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={{ fontWeight: "700", fontSize: 12, color: "#374151", marginTop: 14, marginBottom: 7 }}>Variant</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {variants.map(r => {
                    const active = variantSel.variant === r.variant;
                    return (
                      <Pressable key={r.id} onPress={() => setVariantSel(prev => prev && ({ ...prev, variant: r.variant }))} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: active ? "#16130c" : "#f9f9fb", borderWidth: 1, borderColor: active ? "#16130c" : "#e5e5ea" }}>
                        <Text style={{ color: active ? "white" : "#374151", fontWeight: "800", fontSize: 13 }}>{r.variant} · {fmt(Number(r.price))}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 3 }}>
                    <Pressable onPress={() => setVariantSel(prev => prev && ({ ...prev, qty: Math.max(1, prev.qty - 1) }))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "500", fontSize: 20, color: "#0F172A" }}>−</Text></Pressable>
                    <View style={{ width: 56, alignItems: "center" }}><Text style={{ fontWeight: "800", fontSize: 18, color: "#0F172A" }}>{qty}</Text></View>
                    <Pressable onPress={() => setVariantSel(prev => prev && ({ ...prev, qty: Math.min(maxQ, prev.qty + 1) }))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "700", fontSize: 18 }}>+</Text></Pressable>
                  </View>
                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    <Text style={{ fontWeight: "900", fontSize: 20, color: "#16130c", textAlign: "right", ...monoStyle }}>{fmt(line.lineTotal)} HTG</Text>
                    <Text style={{ color: "#6b7280", fontSize: 11, fontWeight: "600" }}>{qty} {selUnit?.unit_name} · {variantSel.variant}{line.bundleApplied ? " · Bundle ✓" : ""}</Text>
                  </View>
                </View>
                <Pressable onPress={() => {
                  if (!selUnit) return;
                  setCart(prev => mergeLine(prev, variantSel.product, { unitId: selUnit.id, unitName: selUnit.unit_name, factor, variant: variantSel.variant }, qty));
                  setVariantSel(null);
                }} style={{ marginTop: 16, backgroundColor: "#10B981", borderRadius: 16, paddingVertical: 15, alignItems: "center" }}>
                  <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>✓ Ajoute • {fmt(line.lineTotal)} HTG</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* Suspend modal: label the tab (customer / table) */}
      <Modal visible={showSuspend} transparent animationType="slide" onRequestClose={() => setShowSuspend(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 }}>
              <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
              <Text style={{ fontWeight: "800", fontSize: 18, color: "#16130c" }}>Kite l Ouvè ⏸</Text>
              <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>{cart.length} liy • {fmt(cart.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0))} HTG — pri yo ap jele.</Text>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#374151", marginTop: 14 }}>Non kliyan / Tab *</Text>
              <TextInput placeholder="Ex. Marie — tab 3" placeholderTextColor="#8e8e93" value={suspendLabel} onChangeText={setSuspendLabel} autoFocus style={{ height: 52, borderWidth: 1.5, borderColor: "#16130c", borderRadius: 12, paddingHorizontal: 14, marginTop: 8, backgroundColor: "white", fontWeight: "700", fontSize: 16, color: "#16130c" }} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                <Pressable onPress={() => setShowSuspend(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#efe7d2", borderRadius: 14, alignItems: "center" }}><Text style={{ fontWeight: "700", color: "#374151" }}>Anile</Text></Pressable>
                <Pressable onPress={confirmSuspend} style={{ flex: 2, paddingVertical: 14, backgroundColor: "#16130c", borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.5)" }}><Text style={{ color: "white", fontWeight: "800" }}>✓ Kite l Ouvè</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Tabs sheet: resume / transfer / void */}
      <Modal visible={showTabs} transparent animationType="slide" onRequestClose={() => setShowTabs(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(17,24,39,0.42)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "85%", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 }}>
              <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Text style={{ fontWeight: "800", fontSize: 20, color: "#16130c" }}>Vant an Atann</Text>
                  <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 3 }}>{visibleTabs.length} tab ouvè{isManagerPlus ? " • tout kesye" : " • ou menm"}</Text>
                </View>
                <Pressable onPress={() => setShowTabs(false)} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, color: "#6b7280", fontWeight: "700" }}>⌄</Text></Pressable>
              </View>
              <ScrollView style={{ marginTop: 14, maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {visibleTabs.length === 0 && (
                  <View style={{ padding: 24, alignItems: "center" }}><Text style={{ color: "#94a3b8", fontWeight: "600", fontSize: 13 }}>Pa gen tab ouvè</Text></View>
                )}
                {visibleTabs.map(t => (
                  <View key={t.id} style={{ backgroundColor: "#f9f9fb", borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#e5e5ea" }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "800", fontSize: 14, color: "#16130c" }} numberOfLines={1}>{t.label}</Text>
                        <Text style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{t.cashier_name ?? "?"} • {tabAge(t.created_at)}{resumedTabId === t.id ? " • ⏳ reprann" : ""}</Text>
                      </View>
                      <Text style={{ fontWeight: "900", fontSize: 15, color: "#16130c" }}>{fmt(Number(t.total ?? 0))} HTG</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
                      <Pressable onPress={() => resumeTab(t)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center" }}><Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>▶ Reprann</Text></Pressable>
                      {isManagerPlus && (
                        <>
                          <Pressable onPress={() => setTransferTabId(transferTabId === t.id ? null : t.id)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#e5e5ea", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 13, color: "#374151" }}>⇄ Transfere</Text></Pressable>
                          <Pressable onPress={() => voidTab(t)} style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#fee2e2", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#dc2626", fontWeight: "900" }}>✕</Text></Pressable>
                        </>
                      )}
                    </View>
                    {isManagerPlus && transferTabId === t.id && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {USERS.filter(u => u.role === "cashier" && u.id !== t.cashier_id).map(u => (
                          <Pressable key={u.id} onPress={() => confirmTransfer(t, u.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "#16130c" }}>
                            <Text style={{ color: "white", fontWeight: "700", fontSize: 12 }}>{u.name} →</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pay modal */}
      <Modal visible={showPayModal} transparent animationType="slide" onRequestClose={() => setShowPayModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 16 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <Text style={{ fontWeight: "800", fontSize: 21, color: "#16130c" }}>{ht.pay}</Text>
                <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 3 }}>{cart.length} atik • {cart.reduce((s,it)=>s+it.qty,0)} pcs</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: "#6b7280", fontSize: 11, fontWeight: "600" }}>Total</Text>
                <Text style={{ fontWeight: "900", fontSize: 21, color: "#16130c", marginTop: 1, textAlign: "right", ...monoStyle }}>{fmt(subtotal)} HTG</Text>
              </View>
            </View>
            <Text style={{ color: "#6b7280", fontSize: 12, fontWeight: "600", marginTop: 18, marginBottom: 7 }}>Chwazi metòd peman</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16, paddingHorizontal: 16 }}>
              {[
                { id: "cash", label: "Kach", icon: "$", activeBg: "#16130c", activeBorder: "#16130c" },
                { id: "mobile", label: "Peman Mobil", icon: "M", activeBg: "#dc2626", activeBorder: "#dc2626" },
                { id: "credit", label: "Kredi", icon: "C", activeBg: "#7c3aed", activeBorder: "#7c3aed" },
              ].filter(opt => isCreditFlow ? opt.id === "credit" : opt.id !== "credit" || canProcessCreditSale).map(opt => {
                const active = payment === opt.id;
                const onPress = () => {
                  if (opt.id === "credit" && !canProcessCreditSale) {
                    Alert.alert("Pa gen dwa", "Se Manager ak pi wo ka fè vant sou kredi. Kesye pa ka fè vant sou kredi.");
                    return;
                  }
                  setPayment(opt.id as any);
                };
                return (
                  <Pressable key={opt.id} onPress={onPress} style={{ width: 94, height: 68, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 14, backgroundColor: active ? opt.activeBg : "#f9f9fb", borderWidth: 1, borderColor: active ? opt.activeBorder : "#e5e5ea" }}>
                    <View style={{ width: 25, height: 25, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: active ? "rgba(255,255,255,0.18)" : "#e5e5ea" }}>
                      <Text style={{ fontSize: 12, color: active ? "white" : "#4b5563", fontWeight: "900" }}>{opt.icon}</Text>
                    </View>
                    <Text style={{ color: active ? "white" : "#374151", fontWeight: "700", fontSize: 11 }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {payment === "cash" ? (
              <>
              <View style={{ marginTop: 14, backgroundColor: "white", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E5E7EB", gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A", letterSpacing: -0.2 }}>{ht.amountGiven} (HTG)</Text>
                    <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Montan kliyan bay la</Text>
                  </View>
                  <Pressable onPress={() => setAmountGiven(String(subtotal))} accessibilityLabel="Metri montan egzak" style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" }}>
                    <Ionicons name="checkmark-circle" size={14} color="#059669" />
                    <Text style={{ color: "#047857", fontWeight: "700", fontSize: 11 }}>Egzak {fmt(subtotal)}</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: amountGiven && (parseFloat(amountGiven) || 0) > 0 ? "#22C55E" : "#E5E7EB", borderRadius: 14, paddingHorizontal: 14, height: 56 }}>
                  <TextInput placeholder="0" placeholderTextColor="#CBD5E1" value={amountGiven} onChangeText={setAmountGiven} keyboardType="numeric" autoFocus style={{ flex: 1, fontSize: 24, fontWeight: "900", color: "#16130c", textAlign: "right", ...monoStyle }} />
                  <Text style={{ fontSize: 13, color: "#94A3B8", fontWeight: "800" }}>HTG</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" }}>
                    <Text style={{ fontSize: 10, color: "#64748B", fontWeight: "700", letterSpacing: 0.4 }}>TOTAL</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#0F172A", marginTop: 2, ...monoStyle }}>{fmt(subtotal)} HTG</Text>
                  </View>
                  <View style={{ flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center", borderWidth: 1, backgroundColor: amountGiven && amountGivenNum >= subtotal ? "#ECFDF5" : amountGiven ? "#FEF2F2" : "#F8FAFC", borderColor: amountGiven && amountGivenNum >= subtotal ? "#A7F3D0" : amountGiven ? "#FECACA" : "#F1F5F9" }}>
                    <Text style={{ fontSize: 10, color: amountGiven && amountGivenNum >= subtotal ? "#047857" : amountGiven ? "#B91C1C" : "#64748B", fontWeight: "700", letterSpacing: 0.4 }}>{amountGiven && amountGivenNum >= subtotal ? ht.change : amountGiven ? ht.amountDue : "RÉS"}</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: amountGiven && amountGivenNum >= subtotal ? "#047857" : amountGiven ? "#B91C1C" : "#94A3B8", marginTop: 2, ...monoStyle }}>
                      {amountGiven ? (amountGivenNum >= subtotal ? `${fmt(change)} HTG` : `${fmt(subtotal - amountGivenNum)} HTG`) : "—"}
                    </Text>
                  </View>
                </View>
              </View>
              {/* Cash — optional existing customer only (no create) */}
              {!isCreditFlow && (
                <View style={{ marginTop: 12, backgroundColor: "white", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#E5E7EB", gap: 10 }}>
                  {selectedCustomer && customerId ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: "#7C3AED" }}>{(selectedCustomer.name?.[0] ?? "•").toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A" }} numberOfLines={1}>{selectedCustomer.name}</Text>
                        <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }} numberOfLines={1}>Lye • ID {selectedCustomer.id_card_number || "—"}{selectedCustomer.phone ? ` • ${selectedCustomer.phone}` : ""}</Text>
                      </View>
                      <Pressable onPress={() => { setSelectedCustomer(null); setCustomerId(null); setCustomerSearch(""); }} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, color: "#64748B", fontWeight: "700" }}>✕</Text></Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => setShowCashCustomer(v => !v)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" }}><Ionicons name="person-outline" size={15} color="#64748B" /></View>
                        <View>
                          <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A" }}>Kliyan (opsyonèl)</Text>
                          <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }}>Ajoute kliyan kont la</Text>
                        </View>
                      </View>
                      <Ionicons name={showCashCustomer ? "chevron-up" : "chevron-down"} size={18} color="#94A3B8" />
                    </Pressable>
                  )}
                  {showCashCustomer && !(selectedCustomer && customerId) && (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, height: 42 }}>
                        <Ionicons name="search" size={14} color="#94A3B8" style={{ marginRight: 8 }} />
                        <TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Chèche kliyan (non, NIF)" placeholderTextColor="#94A3B8" style={{ flex: 1, fontSize: 13, color: "#0F172A" }} />
                        {customerSearch.length > 0 && <Pressable onPress={() => setCustomerSearch("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
                      </View>
                      <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {filteredCustomers.length === 0 ? (
                          <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 14, alignItems: "center", gap: 4 }}>
                            <Ionicons name="person-outline" size={16} color="#CBD5E1" />
                            <Text style={{ fontSize: 12, color: "#94A3B8", textAlign: "center" }}>{customerSearch ? `Pa jwenn "${customerSearch}"` : "Tape non oswa NIF pou chèche"}</Text>
                          </View>
                        ) : (
                          filteredCustomers.slice(0, 8).map((c: any, idx: number) => {
                            const isSelected = selectedCustomer?.id === c.id;
                            return (
                              <Pressable key={`${c.id}__cash__${idx}`} onPress={() => { selectCashCustomer(c); setShowCashCustomer(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: isSelected ? "#DDD6FE" : "#F1F5F9", backgroundColor: isSelected ? "#F5F3FF" : "white" }}>
                                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: isSelected ? "#7C3AED" : "#F8FAFC", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, color: isSelected ? "white" : "#475569", fontWeight: "700" }}>{(c.name?.[0] ?? "•").toUpperCase()}</Text></View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A" }} numberOfLines={1}>{c.name}</Text>
                                  <Text style={{ fontSize: 11, color: "#94A3B8" }} numberOfLines={1}>ID {c.id_card_number || "—"}{c.phone ? ` • ${c.phone}` : ""}</Text>
                                </View>
                                {Number(c.total_debt ?? 0) > 0 ? <View style={{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={{ fontSize: 10, fontWeight: "700", color: "#B91C1C" }}>{fmt(Number(c.total_debt) || 0)} dèt</Text></View> : null}
                                {isSelected ? <Ionicons name="checkmark-circle" size={18} color="#7C3AED" /> : null}
                              </Pressable>
                            );
                          })
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}
              </>
            ) : payment === "mobile" ? (
              <View style={{ marginTop: 14, backgroundColor: "#f9f9fb", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e5e5ea" }}>
                <Text style={{ fontWeight: "800", fontSize: 13, color: "#0f172a" }}>Chwazi pòtvant mobil</Text>
                <Pressable onPress={() => setShowMobilePicker(v => !v)} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "white", borderWidth: 1, borderColor: showMobilePicker ? "#B91C1C" : "#e5e5ea", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: mobileProvider === "moncash" ? "#dc2626" : "#2563eb", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>{mobileProvider === "moncash" ? "M" : "N"}</Text>
                    </View>
                    <View>
                      <Text style={{ fontWeight: "800", fontSize: 14, color: "#0f172a" }}>{mobileProvider === "moncash" ? "MonCash" : "NatCash"}</Text>
                      <Text style={{ fontSize: 11, color: "#64748b" }}>{mobileProvider === "moncash" ? "Digicel" : "Natcom"}</Text>
                    </View>
                  </View>
                  <Ionicons name={showMobilePicker ? "chevron-up" : "chevron-down"} size={18} color="#6b7280" />
                </Pressable>
                {showMobilePicker ? (
                  <View style={{ marginTop: 6, backgroundColor: "white", borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 12, overflow: "hidden" }}>
                    {[{ id: "moncash", label: "MonCash", sub: "Digicel", bg: "#dc2626", icon: "M" }, { id: "natcash", label: "NatCash", sub: "Natcom", bg: "#2563eb", icon: "N" }].map(o => {
                      const active = mobileProvider === o.id;
                      return (
                        <Pressable key={o.id} onPress={() => { setMobileProvider(o.id as any); setShowMobilePicker(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: active ? "#F9FAFB" : "white", borderTopWidth: 1, borderTopColor: "#F3F4F6" }}>
                          <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: o.bg, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>{o.icon}</Text></View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: "700", fontSize: 13, color: "#0f172a" }}>{o.label}</Text>
                            <Text style={{ fontSize: 11, color: "#64748b" }}>{o.sub}</Text>
                          </View>
                          <Ionicons name="checkmark" size={18} color={active ? "#059669" : "#D1D5DB"} />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                <Text style={{ fontWeight: "800", fontSize: 13, color: "#0f172a", marginTop: 14 }}>Enfòmasyon kliyan *</Text>
                <Text style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Non legal ak telefòn obligatwa pou {mobileProvider === "moncash" ? "MonCash" : "NatCash"}</Text>
                <Text style={{ fontWeight: "700", fontSize: 11, color: "#334155", marginTop: 10 }}>Non legal *</Text>
                <TextInput placeholder="Non konplè kliyan" placeholderTextColor="#94a3b8" value={clientLegalName} onChangeText={setClientLegalName} style={{ borderWidth: 1.5, borderColor: clientLegalName.trim() ? "#e2e8f0" : "#fecaca", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, backgroundColor: "white", fontWeight: "600", fontSize: 13, color: "#0f172a" }} />
                <Text style={{ fontWeight: "700", fontSize: 11, color: "#334155", marginTop: 10 }}>Telefòn *</Text>
                <TextInput placeholder="+509 3xxx xxxx" placeholderTextColor="#94a3b8" value={clientPhone} onChangeText={setClientPhone} keyboardType="phone-pad" style={{ borderWidth: 1.5, borderColor: clientPhone.trim() ? "#e2e8f0" : "#fecaca", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, backgroundColor: "white", fontWeight: "600", fontSize: 13, color: "#0f172a" }} />
                <View style={{ marginTop: 12, backgroundColor: "white", borderRadius: 12, padding: 11, borderWidth: 1, borderColor: "#e5e5ea", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: "#64748b", fontWeight: "600" }}>Total pou peye</Text>
                  <Text style={{ fontWeight: "900", fontSize: 16, color: "#0f172a", marginTop: 2 }}>{subtotal} HTG</Text>
                  <Text style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Pa bezwen montan bay kliyan pou {mobileProvider === "moncash" ? "MonCash" : "NatCash"}</Text>
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 14, gap: 10 }}>
                {/* Neat header — credit flow locked */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12 }}>💳</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A", letterSpacing: -0.2 }}>{isCreditFlow ? "Kredi — kliyan chwazi" : "Kredi — chwazi kliyan"}</Text>
                    <Text style={{ fontSize: 11, color: "#64748B", marginTop: 1 }}>{isCreditFlow ? "Acha sou kredi pou kliyan sa a" : "Chwazi yon kliyan ki egziste oswa kreye nouvo"}</Text>
                  </View>
                  {isCreditFlow ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ fontSize: 10, fontWeight: "700", color: "#6D28D9" }}>KREDI</Text></View>
                      <Pressable onPress={() => { onSelectCreditCustomer?.(null); setSelectedCustomer(null); setCustomerId(null); setPayment("cash"); setShowInlineKrediAdd(false); }} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>✕</Text></Pressable>
                    </View>
                  ) : customers.length > 0 && canRegisterCustomer && (
                    <Pressable onPress={() => { setNewCustName(""); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); setCustomerSearch(""); setShowInlineKrediAdd(true); }} hitSlop={8} style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ fontSize: 11, fontWeight: "600", color: "#7C3AED" }}>＋ Nouvo</Text></Pressable>
                  )}
                </View>

                {isCreditFlow ? (
                  <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 16, padding: 12, gap: 10 }}>
                    {selectedCustomer ? (
                      <>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: "#6D28D9", fontWeight: "700" }}>{(selectedCustomer.name?.[0] ?? "•").toUpperCase()}</Text></View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: "600", fontSize: 14, color: "#0F172A" }} numberOfLines={1}>{selectedCustomer.name}</Text>
                            <Text style={{ fontSize: 11, color: "#64748B", marginTop: 1 }} numberOfLines={1}>ID {selectedCustomer.id_card_number || "—"} • {selectedCustomer.phone || "Pa gen telefòn"}</Text>
                            {selectedCustomer.address ? <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 1 }} numberOfLines={1}>{selectedCustomer.address}</Text> : null}
                          </View>
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 11, fontWeight: "800" }}>✓</Text></View>
                        </View>
                        {(() => {
                          const bal = Number(selectedCustomer.total_debt ?? 0);
                          const lim = selectedCustomer.credit_limit === null || selectedCustomer.credit_limit === undefined || Number(selectedCustomer.credit_limit) === 0 ? null : Number(selectedCustomer.credit_limit);
                          const newBal = bal + subtotal;
                          const overLimit = lim !== null && newBal > lim;
                          return (
                            <View style={{ backgroundColor: overLimit ? "#FEF2F2" : "#F0FDF4", borderWidth: 1, borderColor: overLimit ? "#FECACA" : "#BBF7D0", borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: overLimit ? "#DC2626" : "#16A34A", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{overLimit ? "!" : "✓"}</Text></View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: "700", fontSize: 12, color: overLimit ? "#991B1B" : "#065F46" }} numberOfLines={1}>{selectedCustomer.name} · ID {selectedCustomer.id_card_number}</Text>
                                <Text style={{ fontSize: 11, color: overLimit ? "#991B1B" : "#15803D", marginTop: 1 }}>
                                  {overLimit ? `Depase limit • Limit ${lim} HTG` : lim !== null ? `Limit ${fmt(lim)} HTG · Apre vant ${fmt(newBal)} HTG` : `San limit · Apre vant ${fmt(newBal)} HTG`}
                                </Text>
                              </View>
                            </View>
                          );
                        })()}
                        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10, gap: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ fontSize: 12 }}>📅</Text>
                              <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A" }}>Echèans</Text>
                            </View>
                            <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 11, fontWeight: "600", color: "#475569" }}>{creditDueDate ? new Date(creditDueDate + "T00:00:00").toLocaleDateString() : "—"}</Text>
                            </View>
                          </View>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                            {["7", "15", "30", "60"].map(opt => {
                              const active = creditDueOption === opt;
                              return (
                                <Pressable key={opt} onPress={() => pickDueOption(opt)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: active ? "#0F172A" : "white", borderWidth: 1, borderColor: active ? "#0F172A" : "#E5E7EB" }}>
                                  <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "white" : "#475569" }}>{opt} jou</Text>
                                </Pressable>
                              );
                            })}
                            <Pressable onPress={() => setCreditDueOption("custom")} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: creditDueOption === "custom" ? "#0F172A" : "white", borderWidth: 1, borderColor: creditDueOption === "custom" ? "#0F172A" : "#E5E7EB" }}>
                              <Text style={{ fontSize: 12, fontWeight: "600", color: creditDueOption === "custom" ? "white" : "#475569" }}>Lòt dat</Text>
                            </Pressable>
                          </ScrollView>
                          {creditDueOption === "custom" && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <TextInput placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" value={creditDueCustom} onChangeText={v => { setCreditDueCustom(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime())) setCreditDueDate(v); }} style={{ flex: 1, borderWidth: 1, borderColor: creditDueCustom && !/^\d{4}-\d{2}-\d{2}$/.test(creditDueCustom) ? "#FECACA" : "#E5E7EB", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, fontSize: 12, color: "#0F172A", backgroundColor: "white" }} />
                              <Text style={{ fontSize: 11, color: "#64748B" }}>{creditDueDate ? new Date(creditDueDate + "T00:00:00").toLocaleDateString() : ""}</Text>
                            </View>
                          )}
                        </View>
                        {selectedCustomer && renderAkompteBlock()}
                      </>
                    ) : (
                      <View style={{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 12, padding: 12, alignItems: "center" }}><Text style={{ fontSize: 12, color: "#991B1B", fontWeight: "600" }}>Pa gen kliyan chwazi</Text></View>
                    )}
                  </View>
                ) : showInlineKrediAdd ? (
                  <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 16, padding: 12, gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12 }}>👤</Text></View>
                        <Text style={{ fontWeight: "700", fontSize: 13, color: "#4C1D95" }}>Nouvo kliyan</Text>
                      </View>
                      <Pressable onPress={() => { setShowInlineKrediAdd(false); setNewCustName(""); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); }} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>✕</Text></Pressable>
                    </View>
                    <View style={{ gap: 8 }}>
                      <TextInput placeholder="Non konplè *" placeholderTextColor="#94A3B8" value={newCustName} onChangeText={setNewCustName} style={{ borderWidth: 1, borderColor: newCustName ? "#7C3AED" : "#E5E7EB", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: "#0F172A", backgroundColor: "white" }} />
                      <TextInput placeholder="NIF/CIN * — pou distenge menm non" placeholderTextColor="#94A3B8" value={newCustIdCard} onChangeText={setNewCustIdCard} style={{ borderWidth: 1, borderColor: newCustIdCard ? "#7C3AED" : "#E5E7EB", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: "#0F172A", backgroundColor: "white" }} />
                      <TextInput placeholder="Telefòn (opsyonèl)" placeholderTextColor="#94A3B8" value={newCustPhone} onChangeText={setNewCustPhone} keyboardType="phone-pad" style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: "#0F172A", backgroundColor: "white" }} />
                      <TextInput placeholder="Adrès (opsyonèl) — Eg. Delmas 33" placeholderTextColor="#94A3B8" value={newCustAddress} onChangeText={setNewCustAddress} style={{ borderWidth: 1, borderColor: newCustAddress ? "#7C3AED" : "#E5E7EB", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: "#0F172A", backgroundColor: "white" }} />
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                      <Pressable onPress={() => { setShowInlineKrediAdd(false); setNewCustName(""); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); }} style={{ flex: 1, paddingVertical: 11, backgroundColor: "#F1F5F9", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" }}><Text style={{ fontWeight: "600", color: "#475569", fontSize: 12 }}>Anile</Text></Pressable>
                      <Pressable onPress={handleAddCustomer} style={{ flex: 1, paddingVertical: 11, backgroundColor: "#7C3AED", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "700", fontSize: 12 }}>Kreye & Chwazi</Text></Pressable>
                    </View>
                  </View>
                ) : customers.length === 0 ? (
                  <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 16, padding: 20, alignItems: "center", gap: 8 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18 }}>👤</Text></View>
                    <Text style={{ fontWeight: "600", fontSize: 13, color: "#334155" }}>Pa gen kliyan anrejistre</Text>
                    <Text style={{ fontSize: 11, color: "#94A3B8", textAlign: "center" }}>Kreye kliyan an premye, li pral chwazi otomatikman</Text>
                    {canRegisterCustomer && (
                      <Pressable onPress={() => { setShowInlineKrediAdd(true); setNewCustName(""); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); }} style={{ marginTop: 6, backgroundColor: "#7C3AED", borderWidth: 1, borderColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}><Text style={{ color: "white", fontWeight: "700", fontSize: 12 }}>＋ Kreye kliyan</Text></Pressable>
                    )}
                  </View>
                ) : (
                  <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 16, padding: 10, gap: 8 }}>
                    {/* Search — neat iOS field */}
                    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 10, height: 40 }}>
                      <Text style={{ fontSize: 12, color: "#94A3B8", marginRight: 6 }}>⌕</Text>
                      <TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Chèche pa non, NIF/CIN, telefòn" placeholderTextColor="#94A3B8" style={{ flex: 1, fontSize: 13, color: "#0F172A" }} />
                      {customerSearch.length > 0 && <Pressable onPress={() => setCustomerSearch("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
                    </View>

                    <ScrollView style={{ maxHeight: 168 }} nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {filteredCustomers.length === 0 ? (
                        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 14, alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "500" }}>Pa jwenn kliyan</Text>
                          <Text style={{ fontSize: 11, color: "#94A3B8" }}>"{customerSearch}" pa egziste</Text>
                          {canRegisterCustomer && (
                            <Pressable onPress={() => { setNewCustName(customerSearch); setNewCustIdCard(""); setNewCustPhone(""); setNewCustAddress(""); setShowInlineKrediAdd(true); }} style={{ marginTop: 4, backgroundColor: "#7C3AED", borderWidth: 1, borderColor: "#7C3AED", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}><Text style={{ color: "white", fontWeight: "700", fontSize: 11 }}>{`＋ Ajoute "${customerSearch}" kòm kliyan`}</Text></Pressable>
                          )}
                        </View>
                      ) : (
                        filteredCustomers.map((c: any, idx: number) => {
                          const isSelected = selectedCustomer?.id === c.id;
                          return (
                            <Pressable key={`${c.id}__${c.id_card_number ?? ""}__${idx}`} onPress={() => selectCustomer(c)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: isSelected ? "#7C3AED" : "#F1F5F9", backgroundColor: isSelected ? "#F5F3FF" : "white" }}>
                              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isSelected ? "#7C3AED" : "#F8FAFC", borderWidth: 1, borderColor: isSelected ? "#7C3AED" : "#F1F5F9", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, color: isSelected ? "white" : "#475569", fontWeight: "700" }}>{(c.name?.[0] ?? "•").toUpperCase()}</Text></View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: "600", fontSize: 13, color: isSelected ? "#4C1D95" : "#0F172A" }} numberOfLines={1}>{c.name}</Text>
                                <Text style={{ fontSize: 11, color: isSelected ? "#7C3AED" : "#64748B", marginTop: 1 }} numberOfLines={1}>{c.id_card_number ? `ID ${c.id_card_number}` : c.phone || "—"}{c.phone && c.id_card_number ? ` • ${c.phone}` : ""}</Text>
                              </View>
                              {isSelected ? (
                                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 11, fontWeight: "800" }}>✓</Text></View>
                              ) : (
                                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#94A3B8", fontSize: 10 }}>›</Text></View>
                              )}
                            </Pressable>
                          );
                        })
                      )}
                    </ScrollView>

                    {/* Selected summary — minimal, neat */}
                    {selectedCustomer ? (
                      (() => {
                        const bal = Number(selectedCustomer.total_debt ?? 0);
                        const lim = selectedCustomer.credit_limit === null || selectedCustomer.credit_limit === undefined || Number(selectedCustomer.credit_limit) === 0 ? null : Number(selectedCustomer.credit_limit);
                        const newBal = bal + subtotal;
                        const overLimit = lim !== null && newBal > lim;
                        return (
                          <View style={{ backgroundColor: overLimit ? "#FEF2F2" : "#F0FDF4", borderWidth: 1, borderColor: overLimit ? "#FECACA" : "#BBF7D0", borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: overLimit ? "#DC2626" : "#16A34A", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{overLimit ? "!" : "✓"}</Text></View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontWeight: "700", fontSize: 12, color: overLimit ? "#991B1B" : "#065F46" }} numberOfLines={1}>{selectedCustomer.name} · ID {selectedCustomer.id_card_number}</Text>
                              <Text style={{ fontSize: 11, color: overLimit ? "#991B1B" : "#15803D", marginTop: 1 }}>
                                {overLimit ? `Depase limit • Limit ${lim} HTG` : lim !== null ? `Limit ${fmt(lim)} HTG · Apre vant ${fmt(newBal)} HTG` : `San limit · Apre vant ${fmt(newBal)} HTG`}
                              </Text>
                            </View>
                          </View>
                        );
                      })()
                    ) : (
                      <View style={{ backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 12, padding: 10, alignItems: "center" }}><Text style={{ fontSize: 11, fontWeight: "600", color: "#92400E" }}>Chwazi yon kliyan pou kontinye</Text></View>
                    )}

                    {/* Due date — Apple neat: segmented pills, auto date, custom on demand */}
                    {selectedCustomer && (
                      <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10, gap: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 12 }}>📅</Text>
                            <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A" }}>Echèans</Text>
                          </View>
                          <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: "#475569" }}>{creditDueDate ? new Date(creditDueDate + "T00:00:00").toLocaleDateString() : "—"}</Text>
                          </View>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                          {["7", "15", "30", "60"].map(opt => {
                            const active = creditDueOption === opt;
                            return (
                              <Pressable key={opt} onPress={() => pickDueOption(opt)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: active ? "#0F172A" : "white", borderWidth: 1, borderColor: active ? "#0F172A" : "#E5E7EB" }}>
                                <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "white" : "#475569" }}>{opt} jou</Text>
                              </Pressable>
                            );
                          })}
                          <Pressable onPress={() => setCreditDueOption("custom")} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: creditDueOption === "custom" ? "#0F172A" : "white", borderWidth: 1, borderColor: creditDueOption === "custom" ? "#0F172A" : "#E5E7EB" }}>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: creditDueOption === "custom" ? "white" : "#475569" }}>Lòt dat</Text>
                          </Pressable>
                        </ScrollView>
                        {creditDueOption === "custom" && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <TextInput placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" value={creditDueCustom} onChangeText={v => { setCreditDueCustom(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime())) setCreditDueDate(v); }} style={{ flex: 1, borderWidth: 1, borderColor: creditDueCustom && !/^\d{4}-\d{2}-\d{2}$/.test(creditDueCustom) ? "#FECACA" : "#E5E7EB", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, fontSize: 12, color: "#0F172A", backgroundColor: "white" }} />
                            <Text style={{ fontSize: 11, color: "#64748B" }}>{creditDueDate ? new Date(creditDueDate + "T00:00:00").toLocaleDateString() : ""}</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {selectedCustomer && renderAkompteBlock()}
                  </View>
                )}
              </View>
            )}
            <Animated.View style={{ transform: [{ scale: payPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
            <Pressable onPress={confirmPay} style={{ marginTop: 16, backgroundColor: "#10B981", borderRadius: 26, paddingVertical: 17, paddingHorizontal: 18, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10, shadowColor: "#10B981", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14, borderWidth: 1, borderColor: "#34d399" }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={18} color="#fff" />
              </View>
              <Text style={{ color: "white", fontWeight: "900", fontSize: 17, letterSpacing: 0.4 }}>Konfime {ht.pay}</Text>
              <View style={{ flex: 1 }} />
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "#059669", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </View>
            </Pressable>
            </Animated.View>
            <Pressable onPress={() => setShowPayModal(false)} style={{ marginTop: 6, minHeight: 40, padding: 10, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#6b7280", fontWeight: "600" }}>Retounen</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add customer modal - Manager/Admin only */}
      <Modal visible={showAddCustomer} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 }}>
            <View style={{ width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
            <Text style={{ fontWeight: "900", fontSize: 16, textAlign: "center" }}>👔 Enskri Kliyan Kredi (Manadjè)</Text>
            <Text style={{ color: "#64748b", textAlign: "center", fontSize: 11, marginTop: 4 }}>Sèlman non-kesye ka enskri • Kesye pa gen dwa</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 12 }}>Non konplè *</Text>
            <TextInput placeholder="Eg. Jean Baptiste" value={newCustName} onChangeText={setNewCustName} style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6 }} />
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Nimewo kat idantite (NIF/CIN) * — pou distenge menm non</Text>
            <TextInput placeholder="Eg. 004-123-4567" value={newCustIdCard} onChangeText={setNewCustIdCard} style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6 }} />
            <Text style={{ fontSize: 10, color: "#64748b" }}>Obligatwa pou kredi — verifye kat idantite kliyan</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Telefòn</Text>
            <TextInput placeholder="+509 ..." value={newCustPhone} onChangeText={setNewCustPhone} keyboardType="phone-pad" style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6 }} />
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Adrès</Text>
            <TextInput placeholder="Eg. Delmas 33, Pétion-Ville" value={newCustAddress} onChangeText={setNewCustAddress} style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6 }} />
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Limit kredi (HTG) — kite vid pou san limit</Text>
            <TextInput placeholder="San limit (vid) oswa 5000" value={newCustLimit} onChangeText={setNewCustLimit} keyboardType="numeric" style={{ borderWidth: 1, borderColor: "#7c3aed", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6, fontWeight: "700" }} />
            <Text style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Vid = san limit • Manadjè ka mete manyèl oswa sistèm ap mete otomatik 25% apre reta san avi</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Pressable onPress={() => setShowAddCustomer(false)} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "#f1f5f9", borderRadius: 24, alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "700" }}>Anile</Text></Pressable>
              {canRegisterCustomer && (
                <Pressable onPress={handleAddCustomer} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "#7c3aed", borderRadius: 24, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "800" }}>Enskri</Text></Pressable>
              )}
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showLimitEdit} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 }}>
            <Text style={{ fontWeight: "900", fontSize: 16, textAlign: "center" }}>✎ Mete ajou limit kredi</Text>
            <Text style={{ color: "#64748b", textAlign: "center", fontSize: 11, marginTop: 4 }}>{selectedCustomer?.name} • {selectedCustomer?.id_card_number}</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 12 }}>Limit (HTG) — kite vid pou san limit</Text>
            <TextInput placeholder={selectedCustomer?.credit_limit == null ? "San limit" : String(selectedCustomer.credit_limit)} value={limitEditValue} onChangeText={setLimitEditValue} keyboardType="numeric" style={{ borderWidth: 1, borderColor: "#7c3aed", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 6, fontWeight: "700" }} />
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Sous limit</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Pressable onPress={() => setLimitEditSource("manual")} style={{ flex: 1, padding: 12, borderRadius: 24, borderWidth: 1, borderColor: limitEditSource === "manual" ? "#7c3aed" : "#e2e8f0", backgroundColor: limitEditSource === "manual" ? "#f5f3ff" : "white", alignItems: "center" }}><Text style={{ fontWeight: "700", color: limitEditSource === "manual" ? "#7c3aed" : "#0f172a" }}>Manyèl</Text></Pressable>
              <Pressable onPress={() => setLimitEditSource("auto")} style={{ flex: 1, padding: 12, borderRadius: 24, borderWidth: 1, borderColor: limitEditSource === "auto" ? "#7c3aed" : "#e2e8f0", backgroundColor: limitEditSource === "auto" ? "#f5f3ff" : "white", alignItems: "center" }}><Text style={{ fontWeight: "700", color: limitEditSource === "auto" ? "#7c3aed" : "#0f172a" }}>Otomatik</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Pressable onPress={() => setShowLimitEdit(false)} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "#f1f5f9", borderRadius: 24, alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "700" }}>Anile</Text></Pressable>
              <Pressable onPress={handleEditCustomerLimit} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "#7c3aed", borderRadius: 24, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "800" }}>Anrejistre</Text></Pressable>
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Barcode modal */}
      <Modal visible={showBarcodeModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, minHeight: 320 }}>
            <View style={{ width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
            <Text style={{ fontWeight: "900", fontSize: 18, textAlign: "center" }}>📷 {ht.scan}</Text>
            <View style={{ height: 160, backgroundColor: "#0f172a", borderRadius: 24, marginTop: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#22c55e", borderStyle: "dashed" }}>
              <Text style={{ color: "#22c55e", fontSize: 40 }}>▢</Text>
              <Text style={{ color: "white", marginTop: 8, fontWeight: "700" }}>Kamera ap chèche kòd...</Text>
            </View>
            <Pressable onPress={simulateScan} style={{ marginTop: 16, backgroundColor: "#22c55e", padding: 14, borderRadius: 24, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "800" }}>Simile Eskane • Ajoute "{products[0]?.name ?? ""}"</Text></Pressable>
            <Pressable onPress={() => setShowBarcodeModal(false)} style={{ marginTop: 10, padding: 12, alignItems: "center" }}><Text style={{ color: "#64748b", fontWeight: "600" }}>Fèmen</Text></Pressable>
          </View>
        </View>
      </Modal>

      <ReceiptModal visible={showReceipt} receipts={lastReceipts} onClose={() => setShowReceipt(false)} />
    </View>
  );
}
