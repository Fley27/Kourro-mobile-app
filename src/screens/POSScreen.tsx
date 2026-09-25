import React, { useEffect, useState, useMemo, useRef } from "react";
import { View, Text, TextInput, Pressable, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform, Animated, Easing } from "react-native";
import { getDb, insertOutbox } from "../db";
import { ht } from "../i18n";
import { palette, radius, shadow, topIconBtn } from "../theme";
import {
  loadPricing, ensurePricingForProducts, getUnitsForProduct, getPricesForUnit,
  getDefaultUnit, getBasePrice, resolveLinePrice, getDisplayPrice,
  type PricingMaps, type ProductUnit,
} from "../pricing";
import { USERS } from "../users";
import { tabsUI } from "../tabsUI";
import { fmtG, fmt, monoStyle } from "../format";
import { Ionicons } from "@expo/vector-icons";
import ReceiptModal from "../components/ReceiptModal";
import { type ReceiptData } from "../receipts";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import { POSPhone } from "./POSPhone";
import { POSTablet } from "./POSTablet";
import type { Product, CartItem, PendingSel, SuspendedTab, SearchMode, CartView, CustomerFlow, SaleRow } from "./POSShared";
import { CartLineRow, SuspendRow, PayCTA, CartSummary } from "./POSShared";
import { CartMenuView, CartCustomersView, NewCustomerView, EditCustomerView, CustomerDetailBody, CustomerProfileBody, TxnDetailBody, TenderView } from "./cartViews";
import { ProfileMenu, tenderLabel } from "../components/CustomerProfile";
import { validateCheckout, persistSale } from "../sales/checkout";
import { customerToFormData } from "../sales/customers";
import { saveCartDraft, loadCartDraft, clearCartDraft } from "../sales/cartDraft";
import { CreditPayFlow } from "../components/CreditPayFlow";
import { UploadTransition, minDelay, type UploadPhase } from "../components/UploadTransition";
import CustomerForm, {
  EMPTY_CUSTOMER_FORM, fullNameOf, composeAddress,
  type CustomerFormData,
} from "../components/CustomerForm";
import CATALOG_ALL from "../data/catalog.products.json";
// Empty-DB fallback: ubiquitous tier first (recognizable best-sellers).
const CATALOG_FALLBACK = (CATALOG_ALL as any[])
  .slice()
  .sort((a, b) => "UCNE".indexOf(a.tier ?? "C") - "UCNE".indexOf(b.tier ?? "C"))
  .slice(0, 30);
export default function POSScreen({
  storeId,
  deviceId,
  role = "cashier",
  currentUser,
  storeName,
  selectedCreditCustomer = null,
  onSelectCreditCustomer,
  onTabsChanged,
  attachCustomer = null,
  onAttachCustomerConsumed,
}: {
  storeId: string;
  deviceId: string;
  role?: string;
  currentUser?: any;
  storeName?: string;
  selectedCreditCustomer?: any | null;
  onSelectCreditCustomer?: (customer: any | null) => void;
  onTabsChanged?: () => void;
  attachCustomer?: any | null;
  onAttachCustomerConsumed?: () => void;
}) {
  const responsive = useResponsive();
  const { width, height, isTablet, isLandscape, padH } = responsive;
  const sheetH = Math.round(height * 5 / 6);
  // Tablet layout shows in portrait; landscape tablets
  // render the phone layout (with its cart sheet + floating bar).
  const showTablet = isTablet && !isLandscape;
  const [products, setProducts] = useState<Product[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showTenderType, setShowTenderType] = useState(false);
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [showCartMenu, setShowCartMenu] = useState(false);
  // Pay sheet views: main | menu | plis | customer | profile | edit (in-sheet swaps, modal behavior)
  const [payView, setPayView] = useState<"main" | "menu" | "customer" | "profile" | "edit" | "payCustomers" | "payNew" | "txnDetail" | "tender">("main");
  const [tenderMode, setTenderMode] = useState<"cash" | "credit">("cash");
  const [tenderInput, setTenderInput] = useState("");
  const [nameCollapsed, setNameCollapsed] = useState(false);
  const [cartNameCollapsed, setCartNameCollapsed] = useState(false);
  const [payNotes, setPayNotes] = useState<any[]>([]);
  const [payTxns, setPayTxns] = useState<any[]>([]);
  const [lastVisitItems, setLastVisitItems] = useState<any[]>([]);
  const [txnDetail, setTxnDetail] = useState<{ sale: any; items: any[]; credit?: any | null; payments?: any[] } | null>(null);
  const [showTxnPay, setShowTxnPay] = useState(false);
  const [payReceiptLocked, setPayReceiptLocked] = useState(false);
  const [pendingPayReceipt, setPendingPayReceipt] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const txnDue = txnDetail ? (txnDetail.credit
    ? Math.max(0, Number(txnDetail.credit.amount || 0) - (txnDetail.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0))
    : Math.max(0, Number(txnDetail.sale?.amount_due ?? 0))) : 0;
  const txnPaid = txnDetail ? Math.max(0, Number(txnDetail.sale?.total ?? 0) - (txnDetail.credit ? txnDue : Math.max(0, Number(txnDetail.sale?.amount_due ?? 0)))) : 0;

  async function payTxnDue(amount: number) {
    if (!txnDetail?.credit) throw new Error("Pa gen dèt");
    const db = await getDb();
    const { payCreditDebt } = await import("../sales/creditPayments");
    const res = await payCreditDebt(db, txnDetail.credit, selectedCustomer, amount, myId);
    const pays = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [txnDetail.credit.id, txnDetail.credit.id]).catch(() => [])) as any[]) ?? [];
    const fresh = ((await db.getAllAsync("SELECT * FROM credits WHERE id = ?", [txnDetail.credit.id]).catch(() => [])) as any[]) ?? [];
    setTxnDetail({ ...txnDetail, credit: fresh[0] ?? txnDetail.credit, payments: pays });
    return res;
  }

  async function onTxnPaySuccess(info: { amount: number; receipt: string; finalBalance: number }) {
    if (!txnDetail) return;
    setShowTxnPay(false);
    try {
      const { buildCreditPaymentReceipts } = await import("../receipts");
      const db = await getDb();
      const pair = buildCreditPaymentReceipts({
        payId: `pay-${Date.now()}`,
        receiptNumber: info.receipt,
        debtId: txnDetail.credit?.id ?? txnDetail.sale?.id,
        storeName: storeName ?? "Jesyon Magazen",
        createdAt: new Date().toISOString(),
        cashier: { id: myId, name: currentUser?.name ?? "", role: currentUser?.role ?? role },
        customer: selectedCustomer ? { name: selectedCustomer.name ?? "", idCard: selectedCustomer.id_card_number ?? null, phone: selectedCustomer.phone ?? null } : null,
        debtTotal: Number(txnDetail.credit?.amount ?? txnDetail.sale?.total ?? 0),
        previousBalance: Number(txnDetail.credit?.amount ?? 0),
        amount: info.amount,
        finalBalance: info.finalBalance,
        paymentMethod: "cash",
        dueDate: txnDetail.credit?.due_date ?? null,
      });
      try {
        for (const r of [pair.customer, pair.store]) {
          await db.runAsync(
            "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [r.id, storeId, txnDetail.sale?.id ?? null, r.copyType, r.receiptNumber, txnDetail.sale?.sale_number ?? null, myId, currentUser?.name ?? "", currentUser?.role ?? role, JSON.stringify(r), new Date().toISOString()]
          );
        }
      } catch {}
      setPendingPayReceipt(pair);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resi echwe");
    }
  }

  useEffect(() => {
    if (!showTxnPay && pendingPayReceipt) {
      const t = setTimeout(() => {
        setLastReceipts(pendingPayReceipt);
        setPayReceiptLocked(true);
        setShowReceipt(true);
        setPendingPayReceipt(null);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [showTxnPay, pendingPayReceipt]);
  const [txnOrigin, setTxnOrigin] = useState<"cart" | "pay">("cart");
  const [payStats, setPayStats] = useState<{ visits: number; spent: number; lastVisit: string | null; firstVisit: string | null }>({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [detailOrigin, setDetailOrigin] = useState<"pay" | "cart">("pay");
  const [editFormKey, setEditFormKey] = useState(0);
  const [editFormValid, setEditFormValid] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editInitial, setEditInitial] = useState<Partial<CustomerFormData>>({});
  const editFormRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  type PaymentMethod = "cash" | "mobile" | "credit";
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [mobileProvider, setMobileProvider] = useState<"moncash" | "natcash">("moncash");
  const [amountGiven, setAmountGiven] = useState<string>("");
  const [akompte, setAkompte] = useState<string>("");
  const [lastReceipts, setLastReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  // Tender upload transition (shared reusable overlay — same as credit pay + suspend).
  const [payBusy, setPayBusy] = useState(false);
  const [payPhase, setPayPhase] = useState<UploadPhase>("loading");
  const [payTitle, setPayTitle] = useState("");
  const [payMsg, setPayMsg] = useState("");

  // Non-intrusive pending quantity (10s auto-add)
  const [pending, setPending] = useState<{ product: Product; qty: number; remaining: number } & PendingSel | null>(null);
  const [pendingInput, setPendingInput] = useState<string>("");
  const pendingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Multi-variant pricing (units / Cold-Hot variants / bundles)
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [costMap, setCostMap] = useState<Map<string, number>>(new Map());
  const getBaseCost = (pid: string) => costMap.get(pid) ?? 0;
  const [minFactorMap, setMinFactorMap] = useState<Map<string, number>>(new Map());

  // Open sales / tabs (Vant an Atann): suspended carts with frozen variant prices
  const [tabs, setTabs] = useState<SuspendedTab[]>([]);
  const [showTabs, setShowTabs] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [suspendLabel, setSuspendLabel] = useState("");
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendPhase, setSuspendPhase] = useState<UploadPhase>("loading");
  const [suspendMsg, setSuspendMsg] = useState("");
  const [resumedTabId, setResumedTabId] = useState<string | null>(null);
  const [resumedTabLabel, setResumedTabLabel] = useState("");
  const [transferTabId, setTransferTabId] = useState<string | null>(null);
  const isManagerPlus = ["owner", "admin", "manager"].includes(role || "cashier");
  const myId = currentUser?.id ?? null;
  const myName = currentUser?.name ?? role;

  // Cart sheet views (menu swap INSIDE the sheet — modal behavior, no stacking).
  const [cartView, setCartView] = useState<CartView>("cart");

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
      await logTabEvent(db, resumedTabId, "updated", `${lines.length} atik • ${fmtG(total)}`);
      try { await insertOutbox("suspended_sales", "update", { id: resumedTabId, total, status: "open" }); } catch {}
      setCart([]); setPending(null); setPendingInput("");
      try { await clearCartDraft(db, storeId, myId); } catch {}
      setShowCartSheet(false);
      setResumedTabId(null); setResumedTabLabel("");
      await loadTabs();
      Alert.alert("Tab mete ajou ✓", `Nouvo pwodwi yo ajoute nan tab la • ${fmtG(total)}. Tab la rete ouvè.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete ajou echwe");
    }
  }

  async function confirmSuspend() {
    const lines = cart;
    if (!lines.length) return Alert.alert("Panyen vid", "Ajoute pwodwi anvan ou kite l ouvè.");
    const label = suspendLabel.trim();
    if (!label) return Alert.alert("Non obligatwa", "Antre non kliyan / tab anvan ou anrejistre.");
    const total = lines.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0);
    // Shared reusable upload transition (same as credit pay flow) — no success alert.
    setSuspendBusy(true);
    setSuspendPhase("loading");
    setSuspendMsg(`${label} • ${fmtG(total)} • ap anrejistre…`);
    setShowSuspend(false);
    try {
      await minDelay((async () => {
        const db = await getDb();
        const now = new Date().toISOString();
        const id = `tab-${Date.now()}`;
        await db.runAsync("INSERT INTO suspended_sales (id,store_id,label,customer_id,cashier_id,cashier_name,seller_role,status,total,completed_sale_id,device_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, storeId, label, customerId, myId, myName, currentUser?.role ?? role, "open", total, null, deviceId, now, now]);
        for (let i = 0; i < lines.length; i++) {
          const it = lines[i];
          const base = it.unitId ? getBasePrice(pricing, it.unitId, it.variant) : Number(it.unitPrice ?? 0);
          await db.runAsync("INSERT INTO suspended_sale_items (id,suspended_sale_id,store_id,product_id,product_name,unit_id,unit_name,factor,variant,quantity,base_price,unit_price,line_total,bundle_applied,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [`${id}_${i}`, id, storeId, it.id, it.name, it.unitId || null, it.unitName, it.factor || 1, it.variant || null, it.qty, base, it.unitPrice, it.lineTotal, it.bundleApplied ? 1 : 0, now]);
        }
        await logTabEvent(db, id, "suspended", `${lines.length} atik • ${fmtG(total)}`);
        try { await insertOutbox("suspended_sales", "create", { id, store_id: storeId, label, total, status: "open" }); } catch {}
        try { await clearCartDraft(db, storeId, myId); } catch {}
      })(), 2000);
      setCart([]); setPending(null); setPendingInput("");
      setResumedTabId(null); setResumedTabLabel("");
      setSuspendLabel("");
      await loadTabs();
      setSuspendPhase("success");
      setSuspendMsg(`${label} • ${fmtG(total)} sove. Pri yo jele.`);
      await new Promise(r => setTimeout(r, 3500));
      setSuspendBusy(false);
    } catch (e: any) {
      setSuspendPhase("error");
      setSuspendMsg(e?.message ?? "Mete an atann echwe");
      await new Promise(r => setTimeout(r, 3500));
      setSuspendBusy(false);
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
        const minF = (prod && minFactorMap.get(prod.id)) || 1;
        // Services never clamp on stock (no stock to count).
        const maxQ = prod?.item_type === "service" ? 999999 : Math.max(0, Math.floor(stock / (factor / (minF > 0 ? minF : 1))));
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
    Alert.alert("Anile tab?", `"${t.label}" • ${fmtG(Number(t.total ?? 0))} pral efase.`, [
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
  // Credit flow from CreditScreen: lock to Kredi, sync customer, ensure transaction registers
  useEffect(() => {
    if (selectedCreditCustomer) {
      setSelectedCustomer(selectedCreditCustomer);
      setPayment("credit");
    }
  }, [selectedCreditCustomer]);
  // Add Sale from Customers: preselect customer for a regular (cash) sale.
  useEffect(() => {
    if (attachCustomer) {
      setSelectedCustomer(attachCustomer);
      onAttachCustomerConsumed?.();
    }
  }, [attachCustomer]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [custDebts, setCustDebts] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(selectedCreditCustomer ?? null);
  // Single source of truth — customerId is always derived, never stored twice.
  const customerId: string | null = selectedCustomer?.id ?? null;
  const [showAddCustomer, setShowAddCustomer] = useState(false);
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

  // Cart customer flow (tablet panel + phone cart sheet share via CustomerFlow).
  const [cartCustSearch, setCartCustSearch] = useState("");
  const [cartCustDebtOnly, setCartCustDebtOnly] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [formValid, setFormValid] = useState(false);
  const formRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });
  // Pay modal new-customer flow (payCustomers -> payNew) — THE shared full form for checkout.
  const [payFormKey, setPayFormKey] = useState(0);
  const [payFormValid, setPayFormValid] = useState(false);
  const [payInitial, setPayInitial] = useState<Partial<CustomerFormData>>({});
  const payFormRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });
  const cartCustomerResults = useMemo(() => {
    const q = cartCustSearch.trim().toLowerCase();
    let list = !q ? [...customers] : customers.filter(c => {
      const name = (c.name ?? "").toLowerCase();
      const idCard = (c.id_card_number ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(q) || idCard.includes(q) || phone.includes(q);
    });
    if (cartCustDebtOnly) {
      const debtIds = new Set((custDebts ?? []).filter(d => Number(d.balance) > 0).map(d => d.customer_id));
      list = list.filter(c => debtIds.has(c.id));
    }
    return list;
  }, [customers, custDebts, cartCustDebtOnly, cartCustSearch]);

  async function insertCustomerRecord(data: CustomerFormData) {
    const { insertCustomerRecord: insertShared } = await import("../sales/customers");
    const db = await getDb();
    return insertShared(db, storeId, data);
  }

  function pickCartCustomer(c: any) {
    selectCashCustomer(c);
    setCartCustSearch("");
    setCartView("cart");
  }

  function openNewCustomer() {
    formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false };
    setFormValid(false);
    setFormKey(k => k + 1);
    setCartView("newCustomer");
  }

  function openCartCustomers() {
    setCartCustSearch("");
    setCartView("customers");
  }

  async function saveCartCustomer() {
    const { data, valid } = formRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    try {
      const fresh = await insertCustomerRecord(data);
      setCustomers(prev => (prev.some(c => c.id === fresh.id) ? prev : [...prev, fresh]));
      selectCashCustomer(fresh);
      setCartCustSearch("");
      setCartView("cart");
      Alert.alert("Kliyan ajoute ✓", fresh.name);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  useEffect(() => {
    (async () => {
      try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 AND (status IS NULL OR status = 'active') ORDER BY name LIMIT 50")) as Product[];
      try {
        const cats = ((await db.getAllAsync("SELECT id, name FROM categories")) as any[]) ?? [];
        const map: Record<string, string> = {};
        for (const c of cats) map[String(c.id)] = String(c.name ?? "");
        setCatNames(map);
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
        setProducts(
          CATALOG_FALLBACK.map(p => ({
            id: p.id, name: p.name, name_ht: p.name_ht, barcode: p.barcode, sku: p.sku,
            selling_price: p.units?.[0]?.sell ?? 0, stock_quantity: p.stock ?? 0,
            cost_price: 0, sales_count: 60,
          }))
        );
      } else {
        setProducts(withRank);
      }
      try {
        // Multi-variant pricing: units / Cold-Hot prices / bundles (+ legacy defaults)
        const pm = await ensurePricingForProducts(db, withRank);
        setPricing(pm);
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
        setCostMap(map);
        setMinFactorMap(mins);
      } catch { setCostMap(new Map()); setMinFactorMap(new Map()); }
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
        const open = ((await db.getAllAsync("SELECT * FROM credits WHERE balance > 0").catch(() => [])) as any[]) ?? [];
        setCustDebts(open);
      } catch {}
    })();
  }, [showTenderType]);

  // Cart draft cache — resume an unfinished sale after leaving POS / restart.
  // Skipped for incoming credit-collection flows (their customer is locked).
  const draftReady = useRef(false);
  useEffect(() => {
    draftReady.current = false;
    (async () => {
      try {
        if (!selectedCreditCustomer) {
          const db = await getDb();
          const d = await loadCartDraft(db, storeId, myId);
          if (d && (d.lines.length || d.customer) && cart.length === 0 && !selectedCustomer) {
            if (d.lines.length) setCart(d.lines);
            if (d.customer) selectCashCustomer(d.customer);
          }
        }
      } catch {}
      draftReady.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, myId]);

  // Autosave the draft (debounced). Empty cart + no customer wipes the row.
  useEffect(() => {
    if (!draftReady.current) return;
    const t = setTimeout(() => {
      (async () => {
        try {
          const db = await getDb();
          await saveCartDraft(db, storeId, myId, { lines: cart, customer: selectedCustomer });
        } catch {}
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [cart, selectedCustomer, storeId, myId]);

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

  function maxQtyFor(p: Product, factor: number): number {
    // Services never clamp on stock (availability toggle decides).
    if (p.item_type === "service") return 999999;
    // Canonical stock ÷ canonical factor (identical numbers for legacy chains).
    const minF = minFactorMap.get(p.id) ?? 1;
    const eff = (Number(factor) || 1) / (minF > 0 ? minF : 1);
    return Math.max(0, Math.floor(Number(p.stock_quantity ?? 0) / eff));
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

  function commitPending(product: Product, qty: number, sel?: PendingSel) {
    if (pendingTimer.current) { clearInterval(pendingTimer.current); pendingTimer.current = null; }
    const s = sel ?? (pending && pending.product.id === product.id
      ? { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }
      : defaultSelFor(product));
    setCart(prev => mergeLine(prev, product, s, Math.max(1, qty)));
    setPending(null);
  }

  // The sales list shows variants: tapping a row pendings that exact
  // (unit, variant) — no chooser sheet, the choice IS the row.
  function handleProductPress(row: SaleRow) {
    setSearch("");
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

  const subtotal = cart.reduce((s, it) => s + (Number(it.lineTotal ?? it.qty * (it.unitPrice ?? 0)) || 0), 0);
  const pendingLine = pending ? priceFor(pending.product, { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant }, pending.qty) : null;
  const pendingMaxQ = pending ? maxQtyFor(pending.product, pending.factor) : 0;
  const amountGivenNum = parseFloat(amountGiven.replace(",", ".")) || 0;

  // Sales list = one row per priced variant (unit × variant). Legacy
  // products without pricing rows fall back to a single selling-price row.
  const filtered = useMemo(() => {
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
            factor: 1, variant: "Regular", price: legacy, maxQ: maxQtyFor(p, 1),
            variantCountForItem: 1, isTop: (p.sales_count ?? 0) >= 90,
          });
        }
        continue;
      }
      for (const { u, rs } of priced) {
        const factor = Number(u.conversion_factor) || 1;
        const maxQ = maxQtyFor(p, factor);
        for (const r of rs) {
          rows.push({
            key: `${p.id}|${u.id}|${r.variant}`, product: p, unitId: u.id,
            unitName: u.unit_name, factor, variant: r.variant, price: Number(r.price) || 0,
            maxQ, variantCountForItem: rs.length, isTop: (p.sales_count ?? 0) >= 90,
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
    const q = search.trim().toLowerCase();
    if (!q) return rows.sort(byStockThenRank);
    // Unified search: name, Kreyòl name, barcode/SKU, category, variant, unit.
    const list = rows.filter(r => {
      const p = r.product;
      if ((p.barcode?.toLowerCase() ?? "") === q || (p.sku?.toLowerCase() ?? "") === q) return true;
      if (p.name.toLowerCase().includes(q) || (p.name_ht ?? "").toLowerCase().includes(q)) return true;
      if ((p.barcode ?? "").toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)) return true;
      const cat = catNames[String(p.category_id ?? "")] ?? "";
      if (cat.toLowerCase().includes(q)) return true;
      if (r.variant.toLowerCase().includes(q) || r.unitName.toLowerCase().includes(q)) return true;
      return false;
    });
    return list.sort(byStockThenRank);
  }, [products, pricing, search, catNames, minFactorMap]);

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
      { text: "Vide tout", style: "destructive", onPress: () => { setCart([]); setPending(null); setPendingInput(""); clearCustomerSlate(); getDb().then(db => clearCartDraft(db, storeId, myId)).catch(() => {}); setShowCartSheet(false); } },
    ]);
  }

  // Soft breathing pulse for the Pay CTA so it draws the eye
  const payPulse = useRef(new Animated.Value(0)).current;
  // Pay sheet outer scroll persists across in-sheet views — reset it on every
  // navigation so the next view always starts at the top (cart sheet has no
  // outer scroll, which is why it never had this problem).
  const payScrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    // Deferred so keyboard dismissal + layout settle before snapping back.
    const t = setTimeout(() => payScrollRef.current?.scrollTo({ y: 0, animated: false }), 60);
    if (payView !== "customer") setNameCollapsed(false);
    return () => clearTimeout(t);
  }, [payView, showTenderType]);
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

  function firstRowFor(productId: string): SaleRow | null {
    return filtered.find(r => r.product.id === productId) ?? null;
  }
  function onBarcodeSubmit() {
    if (!search.trim()) return;
    const found = products.find(p => p.barcode?.toLowerCase() === search.trim().toLowerCase() || p.sku?.toLowerCase() === search.trim().toLowerCase());
    const row = found ? firstRowFor(found.id) : null;
    if (found && row) handleProductPress(row);
    else Alert.alert("Pa jwenn", `Pa gen pwodwi ak kòd ${search}`);
  }
  function simulateScan() {
    const top = products[0];
    const row = top ? firstRowFor(top.id) : null;
    if (top && row) { setSearch(top.barcode ?? top.sku ?? ""); handleProductPress(row); setShowBarcodeModal(false); }
  }

  function selectCustomer(customer: any | null) {
    setSelectedCustomer(customer);
    onSelectCreditCustomer?.(customer);
  }

  // Cash/loyalty: link an existing customer to a cash sale WITHOUT switching to credit
  function selectCashCustomer(customer: any | null) {
    setSelectedCustomer(customer);
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
    Alert.alert("Limit mete ajou", `${selectedCustomer.name} • ${nextLimit === null ? "San limit" : `${fmtG(nextLimit)}`} • Sous: ${limitEditSource === "manual" ? "manyèl" : "otomatik"}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete limit ajou echwe");
    }
  }

  function openPayMain() {
    setPayView("main");
    setNameCollapsed(false);
  }

  function splitName(full: string): { first: string; last: string } {
    const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
  }

  async function openCustomerDetail(origin: "pay" | "cart") {
    if (!selectedCustomer) return;
    setDetailOrigin(origin);
    setCartNameCollapsed(false);
    setPayNotes([]);
    setPayTxns([]);
    setLastVisitItems([]);
    setPayStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setNoteInput("");
    try {
      const db = await getDb();
      const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [selectedCustomer.id]).catch(() => [])) as any[]) ?? [];
      const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
      const spent = done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0);
      const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
      const lastVisit = dates.pop() ?? null;
      const firstVisit = dates.length ? dates[0] : lastVisit;
      setPayStats({ visits: done.length, spent, lastVisit, firstVisit });
      setPayTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
      const latest = [...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
      if (latest) {
        const lastItems = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [latest.id]).catch(() => [])) as any[]) ?? [];
        setLastVisitItems(lastItems);
      } else {
        setLastVisitItems([]);
      }
      const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [selectedCustomer.id]).catch(() => [])) as any[]) ?? [];
      setPayNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
    } catch {}
    setNameCollapsed(false);
    if (origin === "pay") setPayView("customer");
    else setCartView("custDetail");
  }

  function openPayCustomer() {
    openCustomerDetail("pay");
  }

  function addLastVisitItemToCart(saleItem: any) {
    const prod = products.find(p => p.id === saleItem.product_id);
    if (!prod) return Alert.alert("Pwodwi indisponib", "Pwodwi sa a pa nan katalòg la ankò.");
    const qty = Math.max(1, Math.floor(Number(saleItem.quantity) || 1));
    // Re-add the exact variant/unit from that purchase when it still exists.
    let sel = defaultSelFor(prod);
    const storedUnitId = saleItem.unit_id ?? "";
    if (storedUnitId) {
      const u = getUnitsForProduct(pricing, prod.id).find(x => x.id === storedUnitId);
      if (u) {
        const rows = getPricesForUnit(pricing, u.id).filter(r => Number(r.price) > 0);
        const storedVariant = saleItem.variant ?? "Regular";
        const variant = rows.some(r => r.variant === storedVariant)
          ? storedVariant
          : (rows.find(r => r.variant === "Regular") ?? rows[0])?.variant ?? "Regular";
        sel = { unitId: u.id, unitName: u.unit_name, factor: Number(u.conversion_factor) || 1, variant };
      }
    }
    setCart(prev => mergeLine(prev, prod, sel, qty));
  }

  function pressTenderKey(k: string) {
    if (k === "back") {
      setTenderInput(prev => prev.slice(0, -1));
      return;
    }
    setTenderInput(prev => {
      const add = k === "00" ? "00" : k;
      if (prev.length + add.length > 9) return prev;
      if (prev === "") return k === "0" || k === "00" ? "" : add;
      return prev + add;
    });
  }

  function submitTender() {
    const entered = tenderInput === "" ? 0 : Number(tenderInput);
    if (tenderMode === "cash") confirmPay("cash", tenderInput === "" ? undefined : entered);
    else confirmPay("credit", undefined, entered);
  }

  async function openTxnDetail(sale: any) {    if (!sale) return;
    try {
      const db = await getDb();
      const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const credit = credits[0] ?? null;
      let payments: any[] = [];
      if (credit) {
        payments = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [credit.id, credit.id]).catch(() => [])) as any[]) ?? [];
      }
      setTxnDetail({ sale, items, credit, payments });
    } catch {
      setTxnDetail({ sale, items: [], credit: null, payments: [] });
    }
    if (showTenderType) {
      setTxnOrigin("pay");
      setPayView("txnDetail");
    } else {
      setTxnOrigin("cart");
      setCartView("txnDetail");
    }
  }

  async function issueTxnReceipt() {
    if (!txnDetail) return;
    try {
      const { buildReceipts } = await import("../receipts");
      const db = await getDb();
      const sale = txnDetail.sale;
      const items = txnDetail.items.map((it: any) => ({
        name: it.product_name ?? "Atik",
        variant: it.variant ?? null,
        qty: Number(it.quantity ?? 0),
        unitPrice: Number(it.unit_price ?? 0),
        lineTotal: Number(it.line_total ?? 0),
      }));
      const total = Number(sale.total ?? 0);
      const amountPaid = Number(sale.amount_paid ?? total);
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const dueDate = credits.length ? (credits[0].due_date ?? null) : null;
      const receipts = buildReceipts({
        saleId: sale.id,
        saleNumber: sale.sale_number ?? String(sale.id),
        storeName: storeName ?? "Jesyon Magazen",
        createdAt: sale.created_at ?? new Date().toISOString(),
        cashier: { id: sale.seller_id ?? currentUser?.id ?? null, name: myName, role: sale.seller_role ?? currentUser?.role ?? role },
        customer: selectedCustomer ? {
          name: selectedCustomer.name ?? "",
          idCard: selectedCustomer.id_card_number ?? null,
          phone: selectedCustomer.phone ?? null,
          email: selectedCustomer.email ?? null,
        } : null,
        customerId: selectedCustomer?.id ?? sale.customer_id ?? null,
        items,
        subtotal: Number(sale.subtotal ?? total),
        discount: Number(sale.discount ?? 0),
        total,
        paymentMethod: String(sale.payment_method ?? "cash"),
        amountPaid,
        amountDue: Number(sale.amount_due ?? 0),
        change: String(sale.payment_method ?? "cash") === "cash" ? Math.max(0, amountPaid - total) : 0,
        dueDate,
      });
      setLastReceipts(receipts);
      if (txnOrigin === "pay") setShowTenderType(false);
      else setShowCartSheet(false);
      // Open the receipt after the sheet dismisses — same-tick modal swaps get dropped on iOS
      setTimeout(() => { setShowReceipt(true); }, showTablet ? 60 : 420);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resi echwe");
    }
  }

  async function addPayNote() {
    const text = noteInput.trim();
    if (!text || !selectedCustomer) return;
    if (payNotes.length >= 2) return Alert.alert("Limit 2 nòt", "Yon kliyan pa ka gen plis pase 2 nòt.");
    setSavingNote(true);
    try {
      const db = await getDb();
      const row = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        store_id: storeId, customer_id: selectedCustomer.id, text,
        created_by: myId, created_at: new Date().toISOString(),
      };
      await db.runAsync("INSERT INTO customer_notes (id, store_id, customer_id, text, created_by, created_at) VALUES (?,?,?,?,?,?)",
        [row.id, row.store_id, row.customer_id, row.text, row.created_by, row.created_at]);
      setPayNotes(prev => [row, ...prev]);
      setNoteInput("");
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute nòt echwe");
    } finally {
      setSavingNote(false);
    }
  }

  function backFromDetail() {
    if (detailOrigin === "pay") setPayView("main");
    else setCartView("cart");
  }

  function removePayCustomer() {
    selectCashCustomer(null);
    backFromDetail();
  }

  function openPayEdit() {
    const c = selectedCustomer;
    if (!c) return;
    const init = customerToFormData(c);
    editFormRef.current = { data: init, valid: false };
    setEditInitial(init);
    setEditFormValid(false);
    setEditFormKey(k => k + 1);
    if (detailOrigin === "pay") setPayView("edit");
    else setCartView("custEdit");
  }

  function openPayNewCustomer(prefill?: Partial<CustomerFormData>) {
    const init = { ...EMPTY_CUSTOMER_FORM, ...prefill };
    payFormRef.current = { data: init, valid: false };
    setPayInitial(prefill ?? {});
    setPayFormValid(false);
    setPayFormKey(k => k + 1);
    setPayView("payNew");
  }

  async function saveNewCustomerFromPay() {
    const { data, valid } = payFormRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    try {
      const fresh = await insertCustomerRecord(data);
      setCustomers(prev => (prev.some(c => c.id === fresh.id) ? prev : [...prev, fresh]));
      selectCashCustomer(fresh);
      setPayView("main");
      Alert.alert("Kliyan ajoute ✓", fresh.name);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  async function savePayCustomerEdit() {
    const { data, valid } = editFormRef.current;
    if (!valid || !selectedCustomer) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    setSavingEdit(true);
    try {
      const db = await getDb();
      const name = fullNameOf(data);
      const address = composeAddress(data);
      await db.runAsync("UPDATE customers SET name = ?, phone = ?, address = ?, id_card_number = ?, email = ?, first_name = ?, last_name = ?, birth_day = ?, birth_month = ?, birth_year = ?, country = ?, department = ?, commune = ?, address_line1 = ?, address_line2 = ?, marketing_consent = ? WHERE id = ?",
        [name, data.phone.trim() || null, address, data.idDoc.trim(), data.email.trim() || null, data.firstName.trim(), data.lastName.trim(), data.birthDay, data.birthMonth, data.birthYear, data.country, data.department.trim() || null, data.commune.trim(), data.line1.trim(), data.line2.trim() || null, data.marketingConsent ? 1 : 0, selectedCustomer.id]);
      const updated = {
        ...selectedCustomer, name, phone: data.phone.trim() || null, address,
        id_card_number: data.idDoc.trim(), email: data.email.trim() || null,
        first_name: data.firstName.trim(), last_name: data.lastName.trim(),
        birth_day: data.birthDay, birth_month: data.birthMonth, birth_year: data.birthYear,
        country: data.country, department: data.department.trim() || null,
        commune: data.commune.trim(), address_line1: data.line1.trim(),
        address_line2: data.line2.trim() || null,
        marketing_consent: data.marketingConsent ? 1 : 0,
      };
      setCustomers(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
      setSelectedCustomer(updated);
      if (detailOrigin === "pay") setPayView("customer");
      else setCartView("custDetail");
      Alert.alert("Kliyan mete ajou ✓", name);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete ajou echwe");
    } finally {
      setSavingEdit(false);
    }
  }

  function clearPayState() {
    setPayView("main");
    setNameCollapsed(false);
  }

  // Always land on the main pay view when the sheet opens.
  useEffect(() => {
    if (showTenderType) clearPayState();
  }, [showTenderType]);

  // Collapsing detail titles share one flag — reset whenever a detail view
  // (re)mounts so a fresh list never opens with a stale title.
  useEffect(() => {
    if (cartView === "custDetail" || cartView === "custProfile") setCartNameCollapsed(false);
  }, [cartView]);

  async function confirmPay(methodOverride?: PaymentMethod, amountOverride?: number, akompteOverride?: number, providerOverride?: "moncash" | "natcash") {
    // Commit any in-progress pending line first so checkout sees the full cart.
    let lines = cart;
    if (pending) {
      const s = { unitId: pending.unitId, unitName: pending.unitName, factor: pending.factor, variant: pending.variant };
      lines = mergeLine(cart, pending.product, s, pending.qty);
      setCart(lines);
      setPending(null);
      setPendingInput("");
    }
    if (!lines.length) return Alert.alert(ht.emptyCart);
    const givenRaw = amountGiven.trim();
    // Tapping a method pays immediately — overrides win over state (same-tick setState).
    const payMethod = methodOverride ?? payment;
    const payGiven = amountOverride ?? (givenRaw === "" ? undefined : amountGivenNum);
    const payAkompte = akompteOverride ?? (parseFloat(akompte) || 0);
    const payProvider = providerOverride ?? mobileProvider;
    try {
      validateCheckout({
        lines,
        payment: {
          method: payMethod,
          mobileProvider: payProvider,
          amountGiven: payGiven,
          akompte: payAkompte,
        },
        customer: selectedCustomer,
        canProcessCreditSale,
        creditDueDate,
      });
    } catch (e: any) {
      return Alert.alert(e?.title ?? "Erè", e?.message ?? "Peman echwe");
    }
    // Upload copy, based on tender type.
    const saleTotal = lines.reduce((s, it) => s + (Number(it.lineTotal ?? it.qty * (it.unitPrice ?? 0)) || 0), 0);
    let upTitle = "";
    let upDetail = "";
    if (payMethod === "cash") {
      const given = payGiven ?? saleTotal;
      const ch = Math.max(0, Math.round((given - saleTotal) * 100) / 100);
      upTitle = ch > 0 ? `${fmtG(ch)} change` : "No change";
      upDetail = `Out of ${fmtG(given)}`;
    } else if (payMethod === "credit") {
      const rest = Math.max(0, Math.round((saleTotal - payAkompte) * 100) / 100);
      upTitle = payAkompte > 0 ? `${fmtG(payAkompte)} akompte` : "Kredi";
      upDetail = `Rès ${fmtG(rest)}`;
    } else {
      upTitle = payProvider === "moncash" ? "MonCash" : "NatCash";
      upDetail = `${fmtG(saleTotal)}`;
    }
    setPayBusy(true);
    setPayPhase("loading");
    setPayTitle(upTitle);
    setPayMsg(upDetail);
    setShowTenderType(false);
    setShowCartSheet(false);
    try {
      const db = await getDb();
      const { receipts, customerPatch } = await minDelay(persistSale({
        db,
        storeId,
        deviceId,
        storeName: storeName ?? "Jesyon Magazen",
        cashier: { id: currentUser?.id ?? null, name: myName, role: currentUser?.role ?? role },
        lines,
        payment: {
          method: payMethod,
          mobileProvider: payProvider,
          amountGiven: payGiven,
          akompte: payAkompte,
        },
        customer: selectedCustomer,
        creditDueDate,
        resumedTabId,
        logTabEvent,
      }), 2000);
      if (resumedTabId) {
        setResumedTabId(null); setResumedTabLabel("");
      }
      if (customerPatch && customerId) {
        const cid = customerId;
        setCustomers(prev => prev.map(c => c.id === cid ? { ...c, ...customerPatch } as any : c));
        setSelectedCustomer((prev: any) => (prev && prev.id === cid ? { ...prev, ...customerPatch } : prev));
      }
      setLastReceipts(receipts);
      setPayPhase("success");
      setPayMsg(`${fmtG(saleTotal)} • vant anrejistre`);
      await new Promise(r => setTimeout(r, 3500));
      resetCheckoutForm();
      setCartView("cart");
      loadTabs();
      setPayBusy(false);
      // Open the receipt after the overlay hides — same-tick modal swaps get dropped on iOS
      setTimeout(() => { setShowReceipt(true); }, 150);
      if (isCreditFlow) {
        onSelectCreditCustomer?.(null);
        setPayment("cash");
        setCreditDueOption("30");
        const d = new Date(); d.setDate(d.getDate() + 30); setCreditDueDate(d.toISOString().slice(0, 10)); setCreditDueCustom("");
      }
    } catch (e: any) {
      setPayPhase("error");
      setPayMsg(e?.message ?? "Vant lan echwe — okenn chanjman pa anrejistre nèt. Verifye epi re-eseye.");
      await new Promise(r => setTimeout(r, 3500));
      setPayBusy(false);
    }
  }

  /** Clean slate for the customer — selection, searches, notes and stats. */
  function clearCustomerSlate() {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCartCustSearch("");
    setNoteInput("");
    setPayNotes([]);
    setPayTxns([]);
    setLastVisitItems([]);
    setPayStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
  }

  /** Single reset path after a completed sale — cart, amounts, pay sheet, customer. */
  function resetCheckoutForm() {
    setCart([]);
    setAmountGiven("");
    setAkompte("");
    clearCustomerSlate();
    getDb().then(db => clearCartDraft(db, storeId, myId)).catch(() => {});
  }

  /* Sale pipeline lives in src/sales/checkout.ts (validateCheckout + persistSale). */

  const cartCount = cart.reduce((s, it) => s + it.qty, 0);

  // Luxury entrance — Apple-like stagger
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
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
          rows={filtered}
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
          getBaseCost={getBaseCost}
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
          onPay={() => { setShowCartSheet(false); setShowTenderType(true); }}
          onOpenCartMenu={() => setCartView("menu")}
          customerFlow={{
            view: cartView,
            setView: setCartView,
            search: cartCustSearch,
            setSearch: setCartCustSearch,
            results: cartCustomerResults,
            showDebtOnly: cartCustDebtOnly,
            onToggleDebtOnly: () => setCartCustDebtOnly(v => !v),
            selectedName: selectedCustomer?.name ?? null,
            onPickCustomer: pickCartCustomer,
            onClearCustomer: () => selectCashCustomer(null),
            onOpenNewCustomer: openNewCustomer,
            formKey,
            formValid,
            onFormState: (data, valid) => { formRef.current = { data, valid }; setFormValid(valid); },
            onSaveCustomer: () => saveCartCustomer(),
            onOpenDetail: () => openCustomerDetail("cart"),
            onOpenEdit: openPayEdit,
            onSaveEdit: () => savePayCustomerEdit(),
            editFormKey,
            editInitial,
            editFormValid,
            onEditFormState: (data, valid) => { editFormRef.current = { data, valid }; setEditFormValid(valid); },
            selectedCustomer,
            stats: payStats,
            notes: payNotes,
            transactions: payTxns,
            onOpenTransaction: openTxnDetail,
            txnDetail,
            txnDue,
            txnPaid,
            onTxnPayPress: txnDetail?.credit && txnDue > 0 ? () => setShowTxnPay(true) : undefined,
            onNewReceipt: issueTxnReceipt,
            lastVisitItems,
            onAddItem: addLastVisitItemToCart,
            noteInput,
            setNoteInput,
            savingNote,
            onAddNote: addPayNote,
            onRemoveCustomer: removePayCustomer,
          } as CustomerFlow}
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
          rows={filtered}
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
          onOpenCart={() => { setCartView("cart"); setShowCartSheet(true); }}
        />
      )}

      {/* Tabs FAB lives at the app root (TabsFab) — above header and nav */}

      {/* Expanded cart sheet */}
      <Modal visible={showCartSheet && !showTablet} transparent={false} animationType="slide" onRequestClose={() => setShowCartSheet(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60 }}>
            {cartView === "cart" ? (
              <>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setShowCartSheet(false)} accessibilityLabel="Close cart" style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 17, color: "#fff", fontWeight: "700" }}>✕</Text></Pressable>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff" }}>{ht.cart}</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2, fontWeight: "600" }}>{cart.reduce((s, it) => s + it.qty, 0)} pcs • {cart.length} atik</Text>
                </View>
                <Pressable onPress={() => setShowCartMenu(true)} accessibilityLabel="More options" style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, color: "#fff", fontWeight: "800", letterSpacing: 1 }}>···</Text></Pressable>
              </View>
              {showCartMenu ? (
                <ProfileMenu
                  onClose={() => setShowCartMenu(false)}
                  top={112}
                  right={18}
                  options={[
                    { label: "Ouvèti-Kont", onPress: () => { setCartView("cart"); openSuspend(); } },
                    { label: "Anile", onPress: () => {} },
                  ]}
                />
              ) : null}
              </>
            ) : cartView === "customers" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setCartView("cart")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Chwazi Kliyan</Text>
                <Pressable onPress={openNewCustomer} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
              </View>
            ) : cartView === "custDetail" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setCartView("cart")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={24} color={topIconBtn.icon} />
                </Pressable>
                {cartNameCollapsed ? (
                  <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>{splitName(selectedCustomer?.name ?? "").last || "Kliyan"}</Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Pressable onPress={openPayEdit} style={{ paddingHorizontal: 28, height: 52, borderRadius: 26, backgroundColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Edit</Text>
                </Pressable>
              </View>
            ) : cartView === "custProfile" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setCartView("custDetail")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={24} color={topIconBtn.icon} />
                </Pressable>
                {cartNameCollapsed ? (
                  <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>{splitName(selectedCustomer?.name ?? "").last || "Kliyan"}</Text>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Pressable onPress={openPayEdit} style={{ paddingHorizontal: 28, height: 52, borderRadius: 26, backgroundColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Edit</Text>
                </Pressable>
              </View>
            ) : cartView === "txnDetail" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setCartView("custProfile")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={24} color={topIconBtn.icon} />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>
                  {`${fmtG(Number(txnDetail?.sale?.total ?? 0))} ${tenderLabel(txnDetail?.sale?.payment_method)}`}
                </Text>
                <View style={{ width: topIconBtn.size }} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setCartView(cartView === "newCustomer" ? "customers" : cartView === "custEdit" ? "custDetail" : "cart")} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-back" size={19} color="#16130c" />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>
                  {cartView === "newCustomer" ? "New Customer" : cartView === "custEdit" ? "Edit Customer" : ""}
                </Text>
                {cartView === "newCustomer" ? (
                  <Pressable onPress={() => saveCartCustomer()} disabled={!formValid} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: formValid ? 1 : 0.6 }}>
                    <Text style={{ color: formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>Save</Text>
                  </Pressable>
                ) : cartView === "custEdit" ? (
                  <Pressable onPress={() => savePayCustomerEdit()} disabled={!editFormValid || savingEdit} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: editFormValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: editFormValid && !savingEdit ? 1 : 0.6 }}>
                    <Text style={{ color: editFormValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>Save</Text>
                  </Pressable>
                ) : (
                  <View style={{ width: 34 }} />
                )}
              </View>
            )}
            {cartView === "cart" ? (
              <>
                {resumedTabId ? (
                  <View style={{ marginTop: 12 }}>
                    <SuspendRow resumedTabId={resumedTabId} resumedTabLabel={resumedTabLabel} onClear={confirmClearCart} onSuspendOrUpdate={updateResumedTab} />
                  </View>
                ) : null}
                {selectedCustomer && customerId ? (
                  <Pressable onPress={() => openCustomerDetail("cart")} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    <Ionicons name="person-outline" size={17} color="#fff" />
                    <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{selectedCustomer.name}</Text>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                ) : (
                  <Pressable onPress={openCartCustomers} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    <Ionicons name="person-add-outline" size={17} color="#fff" />
                    <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }}>Add Customer</Text>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                )}
                <ScrollView style={{ flex: 1, marginTop: 14 }} showsVerticalScrollIndicator={false}>
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
                <CartSummary subtotal={subtotal} />
                <PayCTA payPulse={payPulse} subtotal={subtotal} onPay={() => { setShowCartSheet(false); setShowTenderType(true); }} />
              </>
            ) : cartView === "customers" ? (
              <View style={{ flex: 1, marginTop: 12 }}>
                <CartCustomersView
                  dark
                  search={cartCustSearch}
                  onSearch={setCartCustSearch}
                  results={cartCustomerResults}
                  onPick={pickCartCustomer}
                  onOpenNew={openNewCustomer}
                  showDebtOnly={cartCustDebtOnly}
                  onToggleDebtOnly={() => setCartCustDebtOnly(v => !v)}
                />
              </View>
            ) : cartView === "newCustomer" ? (
              <View style={{ flex: 1, marginTop: 12 }}>
                <NewCustomerView
                  formKey={formKey}
                  onFormState={(data: any, valid: boolean) => { formRef.current = { data, valid }; setFormValid(valid); }}
                />
              </View>
            ) : cartView === "custDetail" ? (
              <View style={{ flex: 1, marginTop: 12 }}>
                <ScrollView
                  style={{ flex: 1 }}
                  showsVerticalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onScroll={e => setCartNameCollapsed(e.nativeEvent.contentOffset.y > 40)}
                >
                  <CustomerDetailBody
                    customer={selectedCustomer}
                    stats={payStats}
                    notes={payNotes}
                    onViewProfile={() => setCartView("custProfile")}
                    onRemove={removePayCustomer}
                    hideActions
                    lastVisitItems={lastVisitItems}
                    lastVisitDate={payStats.lastVisit}
                    onAddItem={addLastVisitItemToCart}
                    addedProductIds={cart.map(c => c.id)}
                  />
                </ScrollView>
                <View style={{ gap: 10, paddingTop: 10, paddingBottom: 4 }}>
                  <Pressable onPress={() => setCartView("custProfile")} style={{ height: 60, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>View Full Profile</Text>
                  </Pressable>
                  <Pressable onPress={removePayCustomer} style={{ height: 60, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: palette.danger, fontWeight: "800", fontSize: 14 }}>Remove From Sale</Text>
                  </Pressable>
                </View>
              </View>
            ) : cartView === "custProfile" ? (
              <ScrollView
                style={{ flex: 1, marginTop: 12 }}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={e => setCartNameCollapsed(e.nativeEvent.contentOffset.y > 40)}
              >
                <CustomerProfileBody customer={selectedCustomer} stats={payStats} notes={payNotes} transactions={payTxns} onOpenTransaction={openTxnDetail} />
              </ScrollView>
            ) : cartView === "custEdit" ? (
              <View style={{ flex: 1, marginTop: 12 }}>
                <EditCustomerView
                  formKey={editFormKey}
                  initial={editInitial}
                  onFormState={(data, valid) => { editFormRef.current = { data, valid }; setEditFormValid(valid); }}
                  notes={payNotes}
                  noteInput={noteInput}
                  onNoteInput={setNoteInput}
                  savingNote={savingNote}
                  onAddNote={addPayNote}
                  notesLimit={2}
                />
              </View>
            ) : cartView === "txnDetail" && txnDetail ? (
              <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
                <TxnDetailBody
                  sale={txnDetail.sale}
                  items={txnDetail.items}
                  customer={selectedCustomer}
                  onNewReceipt={issueTxnReceipt}
                  dueBalance={txnDue}
                  totalPaid={txnPaid}
                  payments={txnDetail.payments ?? []}
                  onPayPress={txnDetail.credit && txnDue > 0 ? () => setShowTxnPay(true) : undefined}
                />
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Suspend modal: label the tab (customer / table) */}
      <Modal visible={showSuspend} transparent={false} animationType="slide" onRequestClose={() => setShowSuspend(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60, paddingBottom: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable onPress={() => setShowSuspend(false)} accessibilityLabel="Back to cart" style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#e8e8ea", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={24} color="#000" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Ouvèti-Kont</Text>
              <View style={{ width: 52 }} />
            </View>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff", marginTop: 24 }}>Non kliyan / Tab *</Text>
            <TextInput placeholder="Ex. Marie — tab 3" placeholderTextColor="#8e8e93" value={suspendLabel} onChangeText={setSuspendLabel} autoFocus style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingHorizontal: 16, marginTop: 10, backgroundColor: "transparent", fontWeight: "700", fontSize: 16, color: "#fff" }} />
            <View style={{ flex: 1 }} />
            <Pressable onPress={confirmSuspend} disabled={suspendLabel.trim() === ""} style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 60, paddingHorizontal: 16, borderRadius: 14, backgroundColor: suspendLabel.trim() === "" ? "#2b2b2b" : "#fff", opacity: 1 }}>
              <Text style={{ color: suspendLabel.trim() === "" ? "#6e6e73" : "#000", fontWeight: "800", fontSize: 15 }}>✓</Text>
              <Text style={{ flex: 1, color: suspendLabel.trim() === "" ? "#6e6e73" : "#000", fontWeight: "800", fontSize: 15 }}>Anrejistre</Text>
              <Ionicons name="chevron-forward" size={16} color={suspendLabel.trim() === "" ? "#6e6e73" : "rgba(0,0,0,0.5)"} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Tabs: resume / transfer / void — dark full-screen */}
      <Modal visible={showTabs} transparent={false} animationType="slide" onRequestClose={() => setShowTabs(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60, paddingBottom: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable onPress={() => setShowTabs(false)} accessibilityLabel="Close" hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={31} color="#fff" /></Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Lis Ouvèti-Kont</Text>
              <View style={{ width: 44 }} />
            </View>
            <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 12, textAlign: "center" }}>{visibleTabs.length} tab ouvè{isManagerPlus ? " • tout kesye" : " • ou menm"}</Text>
            <ScrollView style={{ flex: 1, marginTop: 14 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              {visibleTabs.length === 0 && (
                <View style={{ padding: 24, alignItems: "center" }}><Text style={{ color: "#8e8e93", fontWeight: "600", fontSize: 13 }}>Pa gen tab ouvè</Text></View>
              )}
                {visibleTabs.map(t => (
                  <View key={t.id} style={{ backgroundColor: "#141414", borderRadius: 18, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#2b2b2b" }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }} numberOfLines={1}>{t.label}</Text>
                        <Text style={{ color: "#8e8e93", fontSize: 11, marginTop: 2 }}>{t.cashier_name ?? "?"} • {tabAge(t.created_at)}{resumedTabId === t.id ? " • ⏳ reprann" : ""}</Text>
                      </View>
                      <Text style={{ fontWeight: "900", fontSize: 15, color: "#fff", ...monoStyle }}>{fmtG(Number(t.total ?? 0))}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
                      <Pressable onPress={() => resumeTab(t)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#F2F2F7", alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "800", fontSize: 13 }}>▶ Reprann</Text></Pressable>
                      {isManagerPlus && (
                        <>
                          <Pressable onPress={() => setTransferTabId(transferTabId === t.id ? null : t.id)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#2b2b2b", borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>⇄ Transfere</Text></Pressable>
                          <Pressable onPress={() => voidTab(t)} style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(248,113,113,0.15)", borderWidth: 1, borderColor: "rgba(248,113,113,0.3)", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#f87171", fontWeight: "900" }}>✕</Text></Pressable>
                        </>
                      )}
                    </View>
                    {isManagerPlus && transferTabId === t.id && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {USERS.filter(u => u.role === "cashier" && u.id !== t.cashier_id).map(u => (
                          <Pressable key={u.id} onPress={() => confirmTransfer(t, u.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "#2b2b2b" }}>
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>{u.name} →</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pay modal */}
      <CreditPayFlow
        visible={showTxnPay}
        due={txnDue}
        onClose={() => setShowTxnPay(false)}
        onPay={payTxnDue}
        onSuccess={onTxnPaySuccess}
      />
      <Modal visible={showTenderType} transparent={false} animationType="slide" onRequestClose={() => setShowTenderType(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <ScrollView
              ref={payScrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
              bounces={false}
              scrollEventThrottle={16}
              onScroll={e => {
                if (payView === "customer") setNameCollapsed(e.nativeEvent.contentOffset.y > 140);
              }}
              contentContainerStyle={{ flexGrow: 1, padding: 18, paddingTop: 60, paddingBottom: 24 }}
            >
            {payView === "payCustomers" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => openPayMain()} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Chwazi Kliyan</Text>
                <Pressable onPress={() => openPayNewCustomer()} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
              </View>
            ) : payView === "main" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable onPress={() => setShowTenderType(false)} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
                <View style={{ flex: 1 }} />
                <View style={{ width: topIconBtn.size }} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable
                  onPress={() => {
                    if (payView === "profile" || payView === "edit") openPayCustomer();
                    else if (payView === "txnDetail") setPayView("profile");
                    else if (payView === "tender") setPayView("main");
                    else if (payView === "payNew") setPayView("payCustomers");
                    else if (payView === "customer" || payView === "menu") openPayMain();
                    else setShowTenderType(false);
                  }}
                  accessibilityLabel="Back"
                  style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>
                  {payView === "menu" ? "" : payView === "payNew" ? "New Customer" : payView === "customer" ? (nameCollapsed ? splitName(selectedCustomer?.name ?? "").last || "Kliyan" : "Kliyan") : payView === "profile" ? "Profil" : payView === "edit" ? "Edit Customer" : payView === "txnDetail" ? `${fmtG(Number(txnDetail?.sale?.total ?? 0))} ${tenderLabel(txnDetail?.sale?.payment_method)}` : payView === "tender" ? `${fmtG(subtotal)} ${tenderMode === "cash" ? "Cash" : "Kredi"}` : ""}
                </Text>
                {payView === "edit" ? (
                  <Pressable onPress={() => savePayCustomerEdit()} disabled={!editFormValid || savingEdit} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: editFormValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: editFormValid && !savingEdit ? 1 : 0.6 }}>
                    <Text style={{ color: editFormValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>Save</Text>
                  </Pressable>
                ) : payView === "payNew" ? (
                  <Pressable onPress={() => saveNewCustomerFromPay()} disabled={!payFormValid || savingEdit} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: payFormValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: payFormValid && !savingEdit ? 1 : 0.6 }}>
                    <Text style={{ color: payFormValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>Save</Text>
                  </Pressable>
                ) : payView === "customer" ? (
                  <Pressable onPress={openPayEdit} style={{ paddingHorizontal: 14, height: 34, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 13 }}>Edit</Text>
                  </Pressable>
                ) : payView === "profile" ? (
                  <Pressable onPress={openPayEdit} style={{ paddingHorizontal: 14, height: 34, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 13 }}>Edit</Text>
                  </Pressable>
                ) : (
                  <View style={{ width: 34 }} />
                )}
              </View>
            )}
            {payView === "main" ? (
              <View style={{ flex: 1 }}>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
                  <View style={{ alignItems: "center", paddingVertical: 20 }}>
                    <Text style={{ fontWeight: "900", fontSize: 32, color: "#fff", letterSpacing: -0.5, ...monoStyle }}>{fmtG(subtotal)}</Text>
                    <Text style={{ color: "#9ca3af", fontSize: 13, marginTop: 6 }}>Chwazi ki tranzaksyon ou vle</Text>
                  </View>
                </ScrollView>
                <View>
                  <View style={{ height: 1, backgroundColor: "#262626" }} />
                  {([
                    { id: "cash" as const, label: "Cash" },
                    { id: "credit" as const, label: "Kredi" },
                    { id: "moncash" as const, label: "MonCash" },
                    { id: "natcash" as const, label: "NatCash" },
                  ]).filter(opt => isCreditFlow ? opt.id === "credit" : opt.id !== "credit" || (canProcessCreditSale && !!selectedCustomer)).map(opt => {
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => {
                          if (opt.id === "moncash" || opt.id === "natcash") {
                            // Single tap pays immediately with this provider.
                            setMobileProvider(opt.id);
                            setPayment("mobile");
                            confirmPay("mobile", undefined, undefined, opt.id);
                            return;
                          }
                          // Cash / Kredi go to the tender screen (amount given / portion paid).
                          // Kredi only renders with access + a selected customer (see filter).
                          setPayment(opt.id);
                          setTenderMode(opt.id);
                          setTenderInput("");
                          setPayView("tender");
                        }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: "#262626" }}
                      >
                        <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>
                          {opt.label}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : payView === "menu" ? (
              <View style={{ marginTop: 14, gap: 10, justifyContent: "flex-end", flexGrow: 1, paddingBottom: 8 }}>
                <Pressable
                  onPress={() => { setPayView("main"); confirmClearCart(); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, height: 60, paddingHorizontal: 14 }}
                >
                  <Ionicons name="trash-bin-outline" size={16} color="#16130c" />
                  <Text style={{ flex: 1, fontWeight: "800", fontSize: 14, color: "#16130c" }}>Vide Panyen</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(22,19,12,0.5)" />
                </Pressable>
                <Pressable onPress={() => setPayView("main")} style={{ paddingVertical: 8, alignItems: "center" }}>
                  <Text style={{ color: "#16130c", fontWeight: "700", fontSize: 14, textDecorationLine: "underline" }}>Dismiss</Text>
                </Pressable>
              </View>
            ) : payView === "customer" ? (
              <View style={{ marginTop: 6, flex: 1 }}>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  <CustomerDetailBody
                    customer={selectedCustomer}
                    stats={payStats}
                    notes={payNotes}
                    onViewProfile={() => setPayView("profile")}
                    onRemove={removePayCustomer}
                    hideActions
                    lastVisitItems={lastVisitItems}
                    lastVisitDate={payStats.lastVisit}
                    onAddItem={addLastVisitItemToCart}
                    addedProductIds={cart.map(c => c.id)}
                  />
                </ScrollView>
                <View style={{ borderTopWidth: 0.5, borderTopColor: palette.hairline, marginTop: 12, paddingTop: 12, gap: 10, paddingBottom: 8 }}>
                  <Pressable onPress={() => setPayView("profile")} style={{ height: 60, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>View Full Profile</Text>
                  </Pressable>
                  <Pressable onPress={removePayCustomer} style={{ height: 60, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: palette.danger, fontWeight: "800", fontSize: 14 }}>Remove From Sale</Text>
                  </Pressable>
                </View>
              </View>
            ) : payView === "profile" ? (
              <View style={{ marginTop: 6 }}>
                <CustomerProfileBody customer={selectedCustomer} stats={payStats} notes={payNotes} transactions={payTxns} onOpenTransaction={openTxnDetail} />
              </View>
            ) : payView === "edit" ? (
              <View style={{ marginTop: 6, flexGrow: 1 }}>
                <EditCustomerView
                  formKey={editFormKey}
                  initial={editInitial}
                  onFormState={(data, valid) => { editFormRef.current = { data, valid }; setEditFormValid(valid); }}
                  notes={payNotes}
                  noteInput={noteInput}
                  onNoteInput={setNoteInput}
                  savingNote={savingNote}
                  onAddNote={addPayNote}
                  notesLimit={2}
                />
              </View>
            ) : payView === "payCustomers" ? (
              <View style={{ marginTop: 12, flexGrow: 1 }}>
                <CartCustomersView
                  dark
                  search={cartCustSearch}
                  onSearch={setCartCustSearch}
                  results={cartCustomerResults}
                  onPick={(c) => { selectCashCustomer(c); setPayView("main"); }}
                  onOpenNew={() => openPayNewCustomer()}
                  showDebtOnly={cartCustDebtOnly}
                  onToggleDebtOnly={() => setCartCustDebtOnly(v => !v)}
                />
              </View>
            ) : payView === "payNew" ? (
              <View style={{ marginTop: 12, flexGrow: 1 }}>
                <NewCustomerView
                  formKey={payFormKey}
                  initial={payInitial}
                  onFormState={(data, valid) => { payFormRef.current = { data, valid }; setPayFormValid(valid); }}
                />
              </View>
            ) : payView === "txnDetail" && txnDetail ? (
              <View style={{ marginTop: 6, flexGrow: 1 }}>
                <TxnDetailBody
                  sale={txnDetail.sale}
                  items={txnDetail.items}
                  customer={selectedCustomer}
                  onNewReceipt={issueTxnReceipt}
                  dueBalance={txnDue}
                  totalPaid={txnPaid}
                  payments={txnDetail.payments ?? []}
                  onPayPress={txnDetail.credit && txnDue > 0 ? () => setShowTxnPay(true) : undefined}
                />
              </View>
            ) : payView === "tender" ? (
              <TenderView
                mode={tenderMode}
                subtotal={subtotal}
                tenderInput={tenderInput}
                onKey={pressTenderKey}
                onTender={submitTender}
              />
            ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add customer modal - Manager/Admin only */}
      <Modal visible={showAddCustomer} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: sheetH, padding: 16 }}>
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
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 10 }}>Limit kredi (G) — kite vid pou san limit</Text>
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
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: sheetH, padding: 16 }}>
            <Text style={{ fontWeight: "900", fontSize: 16, textAlign: "center" }}>✎ Mete ajou limit kredi</Text>
            <Text style={{ color: "#64748b", textAlign: "center", fontSize: 11, marginTop: 4 }}>{selectedCustomer?.name} • {selectedCustomer?.id_card_number}</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, marginTop: 12 }}>Limit (G) — kite vid pou san limit</Text>
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

      {/* STAGING-PICKUP: pass store/cashier for gated balance step. Delete prop to remove. */}
      <ReceiptModal visible={showReceipt} receipts={lastReceipts} onClose={() => { setShowReceipt(false); setPayReceiptLocked(false); }} staging={{ storeId, cashierId: currentUser?.id ?? null, customerId }} locked={payReceiptLocked} />
      <UploadTransition visible={payBusy} phase={payPhase} title={payTitle} detail={payMsg} />
      <UploadTransition visible={suspendBusy} phase={suspendPhase} title="Vant an Atann" detail={suspendMsg} />
    </View>
  );
}
