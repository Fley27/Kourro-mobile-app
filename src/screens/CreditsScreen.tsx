import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { getDb } from "../db";
import ReceiptModal from "../components/ReceiptModal";
import { buildCreditPaymentReceipts, type ReceiptData } from "../receipts";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import { LUX, RANGE_OPTIONS, formatCurrency, type AnalyticsState, type RangeKey } from "./CreditsShared";
import { DebtCustomerHeader, DebtDetailBlock } from "./CreditsShared";
import { CreditsPhone } from "./CreditsPhone";
import { CreditsTablet } from "./CreditsTablet";

function getRangeStart(range: RangeKey) {
  const now = new Date();
  const start = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "7d") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "28d") {
    start.setDate(now.getDate() - 27);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "180d") {
    start.setDate(now.getDate() - 179);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(0);
}

function isWithinRange(dateValue: string | null | undefined, range: RangeKey) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  if (range === "all") return true;
  return date >= getRangeStart(range);
}

export default function CreditsScreen({
  role = "cashier",
  storeId = "demo-store-id",
  currentUser,
  storeName = "Jesyon Magazen",
  onNewCredit,
}: { role?: string; storeId?: string; currentUser?: any; storeName?: string; onNewCredit?: (customer: any) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [range, setRange] = useState<RangeKey>("28d");
  const [selectedCust, setSelectedCust] = useState<any | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [view, setView] = useState<"all" | "delinquent" | "current" | "paid">("all");
  const [allDebts, setAllDebts] = useState<any[]>([]);
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [modalCustomer, setModalCustomer] = useState<any | null>(null);
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [allSaleItems, setAllSaleItems] = useState<any[]>([]);
  const [expandedHistoryDebtId, setExpandedHistoryDebtId] = useState<string | null>(null);
  const [expandedArticlesDebtId, setExpandedArticlesDebtId] = useState<string | null>(null);
  const [modalPayStep, setModalPayStep] = useState<"details" | "choice" | "pay">("details");
  const [modalPayDebt, setModalPayDebt] = useState<any | null>(null);
  const [modalPayAmount, setModalPayAmount] = useState("");
  const [modalSelectedDebtId, setModalSelectedDebtId] = useState<string | null>(null);
  const [showNewCreditModal, setShowNewCreditModal] = useState(false);
  const [newCreditSearch, setNewCreditSearch] = useState("");
  const [isNewCreditFlow, setIsNewCreditFlow] = useState(false);
  const [search, setSearch] = useState("");
  const [payDebtId, setPayDebtId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payIdCard, setPayIdCard] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
  const [analytics, setAnalytics] = useState<AnalyticsState>({
    creditGiven: 0,
    creditPaid: 0,
    paidPercent: 0,
    unpaidPercent: 0,
    totalOutstanding: 0,
  });
  const [lastReceipts, setLastReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const { width, isTablet, isLandscape, padH, fabRight } = useResponsive();
  // Master-detail needs landscape width; portrait tablets use phone layout.
  const showTablet = isTablet && isLandscape;

  const canManageCustomer = role !== "cashier";

  async function load() {
    try {
    const db = await getDb();
    const custsRaw = (await db.getAllAsync("SELECT * FROM customers")) as any[];
    const custs = Array.from(new Map(custsRaw.map((c: any) => [c.id, c] as const)).values());
    const allCredits = (await db.getAllAsync("SELECT * FROM credits")) as any[];
    const allPayments = (await db.getAllAsync("SELECT * FROM credit_payments")) as any[];
    let allSaleItems: any[] = [];
    try { allSaleItems = (await db.getAllAsync("SELECT * FROM sale_items")) as any[]; } catch { allSaleItems = []; }
    const openDebts = allCredits.filter(d => Number(d.balance) > 0);

    setCustomers(custs);
    setDebts(openDebts);
    setAllDebts(allCredits);
    setAllPayments(allPayments);
    setAllSaleItems(allSaleItems);

    const creditGiven = allCredits
      .filter(d => isWithinRange(d.created_at ?? d.updated_at ?? null, range))
      .reduce((sum, d) => sum + Number(d.amount || 0), 0);
    const creditPaid = allPayments
      .filter(p => isWithinRange(p.created_at ?? null, range))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalOutstanding = allCredits
      .filter(d => isWithinRange(d.created_at ?? d.updated_at ?? null, range))
      .reduce((sum, d) => sum + Number(d.balance || 0), 0);
    const paidShare = creditGiven > 0 ? (creditPaid / creditGiven) * 100 : 0;
    const unpaidShare = 100 - paidShare;

    setAnalytics({
      creditGiven,
      creditPaid,
      paidPercent: Number.isFinite(paidShare) ? paidShare : 0,
      unpaidPercent: Number.isFinite(unpaidShare) ? unpaidShare : 0,
      totalOutstanding,
    });
    } catch (e) {
      console.log("[Credits load] failed:", e);
    }
  }

  useEffect(() => { load(); }, [range]);

  const openDebts = debts.filter(d => Number(d.balance) > 0);
  const getComputedDue = (debt: any) => {
    const paid = allPayments.filter(p => p.debt_id === debt.id || p.credit_id === debt.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    return Math.max(0, Number(debt.amount || 0) - paid);
  };

  function openDebtModal(c: any, debtId?: string) {
    setModalCustomer(c);
    setModalSelectedDebtId(debtId ?? null);
    setExpandedHistoryDebtId(null);
    setExpandedArticlesDebtId(null);
    setModalPayStep("details");
    setModalPayDebt(null);
    setModalPayAmount("");
    setShowDebtModal(true);
  }
  function closeDebtModal() {
    setShowDebtModal(false);
    setExpandedHistoryDebtId(null);
    setExpandedArticlesDebtId(null);
    setModalSelectedDebtId(null);
    setModalPayStep("details");
    setModalPayDebt(null);
    setModalPayAmount("");
  }

  async function showPaymentReceipt(p: {
    payId: string;
    receiptNumber: string;
    debt: any;
    cust: any;
    amount: number;
    finalBalance: number;
    createdAt: string;
    paymentMethod: string;
    previousBalance?: number;
  }) {
    const receipts = buildCreditPaymentReceipts({
      payId: p.payId,
      receiptNumber: p.receiptNumber,
      debtId: p.debt.id,
      storeName,
      createdAt: p.createdAt,
      cashier: { id: currentUser?.id ?? null, name: currentUser?.name ?? (role === "cashier" ? "Kesye" : "Manadjè"), role: currentUser?.role ?? role },
      customer: { name: p.cust.name, idCard: p.cust.id_card_number ?? null, phone: p.cust.phone ?? null },
      debtTotal: Number(p.debt.amount),
      previousBalance: p.previousBalance ?? Number(p.debt.balance ?? p.debt.amount),
      amount: p.amount,
      finalBalance: p.finalBalance,
      paymentMethod: p.paymentMethod,
      dueDate: p.debt.due_date ?? null,
    });
    try {
      const db = await getDb();
      for (const r of [receipts.customer, receipts.store]) {
        await db.runAsync(
          "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [r.id, storeId, p.payId, r.copyType, r.receiptNumber, p.debt.id, r.cashier.id, r.cashier.name, r.cashier.role, JSON.stringify(r), r.createdAt]
        );
      }
    } catch {}
    setLastReceipts(receipts);
    setTimeout(() => setShowReceipt(true), 380);
  }

  async function handleCreateCustomerFromSearch() {
    if (!canManageCustomer) {
      return Alert.alert("Pa gen dwa", "Kesye ka sèlman li lis kliyan yo. Li pa ka kreye nouvo kliyan.");
    }
    if (!newCustomer.name.trim()) return Alert.alert("Non obligatwa");
    if (!newCustomer.id_card_number.trim()) return Alert.alert("NIF/CIN obligatwa", "Nimewo kat idantite obligatwa pou distenge kliyan ki gen menm non.");
    try {
    const db = await getDb();
    const parsedLimit = newCustomer.credit_limit.trim() === "" ? null : Number(newCustomer.credit_limit);
    if (newCustomer.credit_limit.trim() !== "" && (parsedLimit === null || Number.isNaN(parsedLimit) || parsedLimit < 0)) {
      return Alert.alert("Limit kredi pa valab");
    }
    const customer = {
      id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      store_id: "demo-store-id",
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim() || null,
      address: newCustomer.address.trim() || null,
      id_card_number: newCustomer.id_card_number.trim(),
      total_debt: 0,
      credit_limit: parsedLimit,
      credit_limit_source: parsedLimit !== null ? "manual" : null,
      is_high_risk: false,
      open_debt_count: 0,
      created_at: new Date().toISOString(),
    };
    await db.runAsync(
      "INSERT INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [customer.id, customer.store_id, customer.name, customer.phone, customer.address, customer.id_card_number, customer.total_debt, customer.credit_limit, customer.credit_limit_source, customer.is_high_risk ? 1 : 0, customer.open_debt_count]
    );
    setCustomers(prev => {
      const map = new Map(prev.map(c => [c.id, c] as const));
      if (!map.has(customer.id)) return [customer, ...prev];
      return prev;
    });
    setSearch(customer.name);
    setSelectedCust(customer);
    setShowAddCustomer(false);
    setNewCustomer({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
    Alert.alert("Kliyan ajoute", `${customer.name} anrejistre avèk NIF/CIN ${customer.id_card_number}.`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  async function handlePay() {
    if (!payDebtId.trim()) return Alert.alert("Debt ID obligatwa", "Kliyan bay Debt ID li (eg. debt-1) pou peye");
    const debt = debts.find(d => d.id === payDebtId.trim());
    if (!debt) return Alert.alert("Debt ID pa jwenn", `Pa gen dèt ak ID ${payDebtId}`);
    const cust = customers.find(c => c.id === debt.customer_id);
    if (!cust) return Alert.alert("Kliyan pa jwenn", "Peye dèt sa a pa asosye ak okenn kliyan valab");
    if (payIdCard.trim() && cust.id_card_number !== payIdCard.trim()) {
      return Alert.alert("ID pa koresponn", `Kat ${payIdCard} pa koresponn ak kliyan ${cust.name} (${cust.id_card_number}) — verifye kat idantite`);
    }
    const amt = parseFloat(payAmount) || 0;
    if (amt <= 0) return Alert.alert("Montan pa valab");
    if (amt > Number(debt.balance)) return Alert.alert(" Montan twòp", `Dèt sa a se sèlman ${debt.balance} HTG`);
    try {
    const db = await getDb();
    const receipt = `REC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const payId = `pay-${Date.now()}`;
    const createdAt = new Date().toISOString();
    await db.runAsync("INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by) VALUES (?,?,?,?,?,?,?,?,?)",
      [payId, debt.store_id, debt.id, debt.id, amt, "cash", receipt, createdAt, currentUser?.id ?? null]);
    const newPaid = Number(debt.amount_paid) + amt;
    const newBal = Number(debt.amount) - newPaid;
    const finalBalance = Math.max(0, newBal);
    await db.runAsync("UPDATE credits SET amount_paid = ?, balance = ?, status = ? WHERE id = ?", [newPaid, finalBalance, finalBalance <= 0 ? "paid" : "partial", debt.id]);
    const newTotal = Math.max(0, Number(cust.total_debt) - amt);
    await db.runAsync("UPDATE customers SET total_debt = ?, is_high_risk = ? WHERE id = ?", [newTotal, newTotal > 0 ? 1 : 0, cust.id]);

    const wasOverdue = debt.due_date && new Date(debt.due_date) < new Date();
    const existingLimit = cust.credit_limit === null || cust.credit_limit === undefined || cust.credit_limit === 0 ? null : Number(cust.credit_limit);
    if (wasOverdue && finalBalance === 0) {
      const overdueAmount = Number(debt.amount) - amt;
      const penaltyCut = existingLimit !== null ? Math.max(0, existingLimit * 0.25) : Math.max(0, overdueAmount * 0.25);
      const nextLimit = existingLimit !== null ? Math.max(0, existingLimit - penaltyCut) : Math.max(0, overdueAmount * 0.75);
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [nextLimit, "auto", cust.id]);
      Alert.alert("Limit otomatik redwi", `Peman dèt fini. Limit ${cust.name} redwi a ${nextLimit} HTG (25% pou reta san avi).`);
    }

    setPayDebtId(""); setPayAmount(""); setPayIdCard(""); setShowPay(false);
    await showPaymentReceipt({ payId, receiptNumber: receipt, debt, cust, amount: amt, finalBalance, createdAt, paymentMethod: "cash" });
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Peman echwe");
    }
  }

  async function processModalPayment(targetDebt: any, amount: number) {
    if (!modalCustomer) return;
    const cust = customers.find(c => c.id === targetDebt.customer_id) || modalCustomer;
    if (!cust) return Alert.alert("Kliyan pa jwenn");
    if (amount <= 0) return Alert.alert("Montan pa valab");
    const paidForTarget = allPayments.filter(p => p.debt_id === targetDebt.id || p.credit_id === targetDebt.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    const computedDue = Math.max(0, Number(targetDebt.amount || 0) - paidForTarget);
    if (amount > computedDue) return Alert.alert("Montan twòp", `Rès dèt sa a se sèlman ${formatCurrency(computedDue)}`);
    try {
    const db = await getDb();
    const receipt = `REC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const payId = `pay-${Date.now()}`;
    const createdAt = new Date().toISOString();
    await db.runAsync("INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by) VALUES (?,?,?,?,?,?,?,?,?)",
      [payId, targetDebt.store_id, targetDebt.id, targetDebt.id, amount, "cash", receipt, createdAt, currentUser?.id ?? null]);
    const newPaid = paidForTarget + amount;
    const newBal = Number(targetDebt.amount) - newPaid;
    const finalBalance = Math.max(0, newBal);
    await db.runAsync("UPDATE credits SET amount_paid = ?, balance = ?, status = ? WHERE id = ?", [newPaid, finalBalance, finalBalance <= 0 ? "paid" : "partial", targetDebt.id]);
    const newTotal = Math.max(0, Number(cust.total_debt) - amount);
    await db.runAsync("UPDATE customers SET total_debt = ?, is_high_risk = ? WHERE id = ?", [newTotal, newTotal > 0 ? 1 : 0, cust.id]);
    const wasOverdue = targetDebt.due_date && new Date(targetDebt.due_date) < new Date();
    const existingLimit = cust.credit_limit === null || cust.credit_limit === undefined || cust.credit_limit === 0 ? null : Number(cust.credit_limit);
    if (wasOverdue && finalBalance === 0) {
      const overdueAmount = Number(targetDebt.amount) - amount;
      const penaltyCut = existingLimit !== null ? Math.max(0, existingLimit * 0.25) : Math.max(0, overdueAmount * 0.25);
      const nextLimit = existingLimit !== null ? Math.max(0, existingLimit - penaltyCut) : Math.max(0, overdueAmount * 0.75);
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [nextLimit, "auto", cust.id]);
    }
    closeDebtModal();
    await showPaymentReceipt({ payId, receiptNumber: receipt, debt: targetDebt, cust, amount, finalBalance, createdAt, paymentMethod: "cash", previousBalance: Number(computedDue) });
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Peman echwe");
    }
  }

  function handleModalPayNowPress() {
    if (!modalCustomer || !modalSelectedDebtId) return Alert.alert("No debt selected");
    const targetDebt = allDebts.find(d => d.id === modalSelectedDebtId);
    if (!targetDebt) return Alert.alert("Debt not found");
    const paidForTarget = allPayments.filter(p => p.debt_id === targetDebt.id || p.credit_id === targetDebt.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = Math.max(0, Number(targetDebt.amount || 0) - paidForTarget);
    if (balance <= 0.01) return Alert.alert("Already paid", "This debt is already fully paid.");
    const isCashier = role === "cashier";
    if (isCashier) {
      // cashier pays in full directly - only this debt
      processModalPayment(targetDebt, balance);
    } else {
      // manager+ first sees choice: pay in full or pay partial - only this debt (placeholder shows amount, input blank for speed)
      setModalPayDebt(targetDebt);
      setModalPayAmount("");
      setModalPayStep("choice");
    }
  }

  async function handleModalConfirmPay(payFull: boolean = false) {
    if (!modalPayDebt) return;
    const paidForPayDebt = allPayments.filter(p => p.debt_id === modalPayDebt.id || p.credit_id === modalPayDebt.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = Math.max(0, Number(modalPayDebt.amount || 0) - paidForPayDebt);
    const amt = payFull ? balance : parseFloat(modalPayAmount) || 0;
    if (amt <= 0) return Alert.alert("Montan pa valab");
    if (amt > balance) return Alert.alert("Montan twòp", `Ou pa ka peye plis pase ${formatCurrency(balance)}`);
    await processModalPayment(modalPayDebt, amt);
  }

  // Nouvo Kredi: choose customer by Government ID or list, then go to sales without losing client info
  const newCreditQuery = newCreditSearch.trim().toLowerCase();
  const filteredNewCreditCustomers = useMemo(() => {
    if (!newCreditQuery) return customers.slice(0, 20);
    return customers.filter(c => {
      const name = (c.name ?? "").toLowerCase();
      const idCard = (c.id_card_number ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      const address = (c.address ?? "").toLowerCase();
      return name.includes(newCreditQuery) || idCard.includes(newCreditQuery) || phone.includes(newCreditQuery) || address.includes(newCreditQuery);
    }).slice(0, 20);
  }, [customers, newCreditQuery]);

  function handleSelectNewCreditCustomer(c: any) {
    setShowNewCreditModal(false);
    setNewCreditSearch("");
    if (onNewCredit) {
      onNewCredit(c);
    } else {
      Alert.alert("Kliyan chwazi", `${c.name} • ${c.id_card_number}`);
    }
  }

  async function handleCreateNewCreditCustomer() {
    if (!canManageCustomer) return Alert.alert("Pa gen dwa", "Kesye ka sèlman li lis kliyan yo. Li pa ka kreye nouvo kliyan.");
    if (!newCustomer.name.trim()) return Alert.alert("Non obligatwa");
    if (!newCustomer.id_card_number.trim()) return Alert.alert("NIF/CIN obligatwa", "Nimewo kat idantite obligatwa pou distenge kliyan ki gen menm non.");
    try {
    const db = await getDb();
    const parsedLimit = newCustomer.credit_limit.trim() === "" ? null : Number(newCustomer.credit_limit);
    if (newCustomer.credit_limit.trim() !== "" && (parsedLimit === null || Number.isNaN(parsedLimit) || parsedLimit < 0)) return Alert.alert("Limit kredi pa valab");
    const customer = {
      id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      store_id: "demo-store-id",
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim() || null,
      address: newCustomer.address.trim() || null,
      id_card_number: newCustomer.id_card_number.trim(),
      total_debt: 0,
      credit_limit: parsedLimit,
      credit_limit_source: parsedLimit !== null ? "manual" : null,
      is_high_risk: false,
      open_debt_count: 0,
      created_at: new Date().toISOString(),
    };
    await db.runAsync(
      "INSERT INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [customer.id, customer.store_id, customer.name, customer.phone, customer.address, customer.id_card_number, customer.total_debt, customer.credit_limit, customer.credit_limit_source, customer.is_high_risk ? 1 : 0, customer.open_debt_count]
    );
    setCustomers(prev => {
      const map = new Map(prev.map(c => [c.id, c] as const));
      if (!map.has(customer.id)) return [customer, ...prev];
      return prev;
    });
    setShowNewCreditModal(false);
    setShowAddCustomer(false);
    setIsNewCreditFlow(false);
    setNewCustomer({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
    setNewCreditSearch("");
    if (onNewCredit) onNewCredit(customer);
    Alert.alert("Kliyan kreye", `${customer.name} • ${customer.id_card_number} — ap ale nan lavant`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye kliyan echwe");
    }
  }

  const customersWithDebt = customers.filter(c => Number(c.total_debt) > 0);
  const query = search.trim().toLowerCase();
  const customerSuggestions = query
    ? customers.filter(c => {
        const name = (c.name ?? "").toLowerCase();
        const idCard = (c.id_card_number ?? "").toLowerCase();
        const phone = (c.phone ?? "").toLowerCase();
        const address = (c.address ?? "").toLowerCase();
        return name.includes(query) || idCard.includes(query) || phone.includes(query) || address.includes(query);
      }).slice(0, 8)
    : [];

  const filteredDebts = useMemo(() => {
    const q = query;
    const getCurrentDue = (d: any) => {
      const paid = allPayments.filter(p => p.debt_id === d.id || p.credit_id === d.id).reduce((s, p) => s + Number(p.amount || 0), 0);
      return Math.max(0, Number(d.amount || 0) - paid);
    };
    const base = (() => {
      if (view === "paid") return allDebts.filter(d => getCurrentDue(d) <= 0.01);
      if (view === "delinquent") return allDebts.filter(d => getCurrentDue(d) > 0.01 && d.due_date && new Date(d.due_date) < new Date());
      if (view === "current") return allDebts.filter(d => getCurrentDue(d) > 0.01 && (!d.due_date || new Date(d.due_date) >= new Date()));
      return allDebts.filter(d => getCurrentDue(d) > 0.01);
    })();
    if (!q) return base;
    return base.filter(d => {
      const cust = customers.find(c => c.id === d.customer_id);
      const custName = (cust?.name ?? "").toLowerCase();
      const custIdCard = (cust?.id_card_number ?? "").toLowerCase();
      const custPhone = (cust?.phone ?? "").toLowerCase();
      const custAddress = (cust?.address ?? "").toLowerCase();
      const debtId = (d.id ?? "").toLowerCase();
      const saleId = (d.sale_id ?? "").toLowerCase();
      return custName.includes(q) || custIdCard.includes(q) || custPhone.includes(q) || custAddress.includes(q) || debtId.includes(q) || saleId.includes(q);
    });
  }, [customers, allDebts, allPayments, view, query]);

  const ringTrace = useMemo(() => ({
    paidPercent: Math.min(100, Math.max(0, analytics.paidPercent)),
    unpaidPercent: Math.min(100, Math.max(0, analytics.unpaidPercent)),
  }), [analytics.paidPercent, analytics.unpaidPercent]);

  const rangeLabel = RANGE_OPTIONS.find(o => o.key === range)?.label ?? "";

  // Keep selectedCust/customersWithDebt referenced so state stays live (values owned by shell).
  void selectedCust;
  void customersWithDebt;
  void padH;

  const phoneProps = {
    filteredDebts,
    openDebts,
    customers,
    allPayments,
    range,
    setRange,
    rangeLabel,
    analytics,
    ringTrace,
    search,
    setSearch,
    query,
    customerSuggestions,
    setSelectedCust,
    canManageCustomer,
    setShowAddCustomer,
    view,
    setView,
    openDebtModal,
  };

  const tabletProps = {
    ...phoneProps,
    modalCustomer,
    modalSelectedDebtId,
    allDebts,
    allSaleItems,
    expandedHistoryDebtId,
    setExpandedHistoryDebtId,
    expandedArticlesDebtId,
    setExpandedArticlesDebtId,
    closeDebtModal,
    handleModalPayNowPress,
    onNewCreditPress: () => { setIsNewCreditFlow(true); setShowNewCreditModal(true); },
  };

  const modalSelectedDebt = modalSelectedDebtId ? allDebts.find(dd => dd.id === modalSelectedDebtId) : null;

  return (
    <View style={{ flex: 1, backgroundColor: "#fffdfd", alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", flex: 1 }}>
        {showTablet ? <CreditsTablet {...tabletProps} /> : <CreditsPhone {...phoneProps} />}
      </View>

      {canManageCustomer && (
        <View style={{ position: "absolute", bottom: 20, right: fabRight }}>
          <Pressable onPress={() => { setIsNewCreditFlow(true); setShowNewCreditModal(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: LUX.ink, borderWidth: 1, borderColor: "#3D3D40", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 }}>
              <Text style={{ fontSize: 16, color: LUX.gold, fontWeight: "600", marginTop: -1 }}>+</Text>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 0.4 }}>NOUVO KREDI</Text>
          </Pressable>
        </View>
      )}

      {/* Debt details bottom sheet - redesigned simple & professional */}
      <Modal visible={showDebtModal && (!showTablet || modalPayStep !== "details")} transparent animationType="slide" onRequestClose={closeDebtModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(29,29,31,0.55)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%", padding: 16 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: LUX.hairline, alignSelf: "center", marginBottom: 12 }} />
            {modalPayStep === "details" ? (
              <>
                <DebtCustomerHeader customer={modalCustomer} onClose={closeDebtModal} />
                <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} style={{ marginTop: 14, maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 24, gap: 10 }}>
                  {(() => {
                    if (!modalCustomer) return <Text style={{ color: LUX.faint, textAlign: "center", marginTop: 24, fontSize: 12 }}>Pa gen kliyan chwazi.</Text>;
                    if (!modalSelectedDebt) return <View style={{ backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 16, alignItems: "center" }}><Text style={{ color: LUX.muted, fontSize: 12, fontWeight: "600" }}>Pa gen dèt chwazi.</Text></View>;
                    return (
                      <DebtDetailBlock
                        debt={modalSelectedDebt}
                        allPayments={allPayments}
                        allSaleItems={allSaleItems}
                        historyExpanded={expandedHistoryDebtId === modalSelectedDebt.id}
                        articlesExpanded={expandedArticlesDebtId === modalSelectedDebt.id}
                        onToggleHistory={() => setExpandedHistoryDebtId(expandedHistoryDebtId === modalSelectedDebt.id ? null : modalSelectedDebt.id)}
                        onToggleArticles={() => setExpandedArticlesDebtId(expandedArticlesDebtId === modalSelectedDebt.id ? null : modalSelectedDebt.id)}
                      />
                    );
                  })()}
                </ScrollView>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <Pressable onPress={closeDebtModal} style={{ flex: 1, backgroundColor: LUX.surface2, borderRadius: 16, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: LUX.hairline }}><Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Fèmen</Text></Pressable>
                  <Pressable onPress={handleModalPayNowPress} style={{ flex: 1, backgroundColor: LUX.ink, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, paddingVertical: 13, alignItems: "center", shadowColor: LUX.ink, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }}><Text style={{ fontWeight: "800", color: LUX.goldSoft, fontSize: 13, letterSpacing: 0.2 }}>PEYE KOUNYE A</Text></Pressable>
                </View>
              </>
            ) : modalPayStep === "choice" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable onPress={() => setModalPayStep("details")} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LUX.surface2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: LUX.body }}>‹</Text></Pressable>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: LUX.ink }}>Peye dèt</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={closeDebtModal} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LUX.surface2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: LUX.body, fontWeight: "700" }}>✕</Text></Pressable>
                </View>
                {modalPayDebt && (
                  <View style={{ marginTop: 14, gap: 12 }}>
                    <View style={{ backgroundColor: LUX.goldBg, borderWidth: 1, borderColor: LUX.goldSoft, borderRadius: 16, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ fontSize: 11, color: LUX.body, fontWeight: "600" }}>Due {formatCurrency(getComputedDue(modalPayDebt))} • Inisyal {formatCurrency(Number(modalPayDebt.amount))}</Text>
                        <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 2 }}>Vant {modalPayDebt.sale_id || "—"} • {modalPayDebt.status || "ouvè"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 11, color: LUX.goldDeep, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" }}>Rès aktyèl</Text>
                        <Text style={{ fontSize: 18, fontWeight: "800", color: LUX.goldDeep, marginTop: 2 }}>{formatCurrency(getComputedDue(modalPayDebt))}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "600", textAlign: "center", marginTop: 2 }}>Chwazi kalite peman</Text>
                    <Pressable onPress={() => handleModalConfirmPay(true)} style={{ backgroundColor: "#fff", borderWidth: 1.5, borderColor: LUX.hairline2, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.goldSoft, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 14, color: LUX.goldDark, fontWeight: "800" }}>✓</Text>
                        </View>
                        <View>
                          <Text style={{ fontWeight: "800", fontSize: 13, color: LUX.ink }}>Peye tout</Text>
                          <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 1 }}>{formatCurrency(getComputedDue(modalPayDebt))} • Clear debt at once</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 14, color: LUX.ink, fontWeight: "700" }}>›</Text>
                    </Pressable>
                    <Pressable onPress={() => setModalPayStep("pay")} style={{ backgroundColor: "#fff", borderWidth: 1.5, borderColor: LUX.hairline, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "700" }}>₲</Text>
                        </View>
                        <View>
                          <Text style={{ fontWeight: "800", fontSize: 13, color: LUX.ink }}>Peye yon pati</Text>
                          <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 1 }}>Enter custom amount ≤ {formatCurrency(getComputedDue(modalPayDebt))}</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 14, color: LUX.body, fontWeight: "700" }}>›</Text>
                    </Pressable>
                    <Pressable onPress={() => setModalPayStep("details")} style={{ backgroundColor: LUX.surface2, borderRadius: 16, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: LUX.hairline }}><Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Retounen</Text></Pressable>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable onPress={() => setModalPayStep("choice")} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LUX.surface2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: LUX.body }}>‹</Text></Pressable>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: LUX.ink }}>Peye yon pati</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={closeDebtModal} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LUX.surface2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: LUX.body, fontWeight: "700" }}>✕</Text></Pressable>
                </View>
                {modalPayDebt && (
                  <View style={{ marginTop: 14, gap: 12 }}>
                    <View style={{ backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ fontSize: 11, color: LUX.body, fontWeight: "600" }}>Due {formatCurrency(getComputedDue(modalPayDebt))} • Inisyal {formatCurrency(Number(modalPayDebt.amount))}</Text>
                        <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 2 }}>Vant {modalPayDebt.sale_id || "—"} • {modalPayDebt.status || "ouvè"}</Text>
                      </View>
                      <Pressable onPress={() => setModalPayAmount(String(Math.round(Number(modalPayDebt.balance))))} style={{ backgroundColor: LUX.greenBg, borderWidth: 1, borderColor: LUX.greenBd, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: LUX.greenDeep }}>Tout: {formatCurrency(getComputedDue(modalPayDebt))}</Text>
                      </Pressable>
                    </View>
                    <View>
                      <Text style={{ fontWeight: "600", fontSize: 11, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Montan koutim (HTG)</Text>
                      <TextInput value={modalPayAmount} onChangeText={setModalPayAmount} keyboardType="numeric" placeholder={modalPayDebt ? String(Math.round(getComputedDue(modalPayDebt))) : "Antre montan"} placeholderTextColor={LUX.faint} style={{ marginTop: 8, borderWidth: 1.5, borderColor: Number(modalPayAmount) > getComputedDue(modalPayDebt) ? LUX.redBd2 : LUX.hairline, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 13, paddingHorizontal: 12, fontSize: 16, fontWeight: "700", color: LUX.ink, textAlign: "center" }} />
                      <Text style={{ fontSize: 11, color: Number(modalPayAmount) > getComputedDue(modalPayDebt) ? LUX.red : LUX.muted, marginTop: 6, textAlign: "center", fontWeight: "500" }}>
                        {Number(modalPayAmount) > getComputedDue(modalPayDebt) ? `Pa ka depase ${formatCurrency(getComputedDue(modalPayDebt))}` : `Pa depase ${formatCurrency(getComputedDue(modalPayDebt))}`}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                      <Pressable onPress={() => setModalPayStep("choice")} style={{ flex: 1, backgroundColor: LUX.surface2, borderRadius: 16, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: LUX.hairline }}><Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Retounen</Text></Pressable>
                      <Pressable onPress={() => handleModalConfirmPay(false)} style={{ flex: 1, backgroundColor: LUX.ink, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, paddingVertical: 13, alignItems: "center", shadowColor: LUX.ink, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }}><Text style={{ color: LUX.goldSoft, fontWeight: "800", fontSize: 13 }}>PEYE</Text></Pressable>
                    </View>
                  </View>
                )}
              </>
            )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showNewCreditModal} transparent animationType="slide" onRequestClose={() => setShowNewCreditModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(29,29,31,0.55)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "92%" }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: LUX.hairline, alignSelf: "center", marginBottom: 12 }} />
            <Text style={{ fontWeight: "800", fontSize: 16, color: LUX.ink, textAlign: "center" }}>Nouvo Kredi — Chwazi Kliyan</Text>
            <Text style={{ fontSize: 11, color: LUX.muted, textAlign: "center", marginTop: 4 }}>Chèche pa NIF/CIN (Government ID) oswa chwazi nan lis la</Text>
            <View style={{ marginTop: 14, backgroundColor: "#fff", borderWidth: 1.5, borderColor: LUX.hairline2, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, shadowColor: LUX.shadow, shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
              <Text style={{ fontSize: 14, color: LUX.body, fontWeight: "600" }}>⌕</Text>
              <TextInput
                value={newCreditSearch}
                onChangeText={setNewCreditSearch}
                placeholder="NIF/CIN, non, telefòn oswa adrès"
                placeholderTextColor={LUX.muted}
                style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 13, fontWeight: "500", color: LUX.ink }}
              />
              {newCreditSearch.length > 0 && (
                <Pressable onPress={() => setNewCreditSearch("")} hitSlop={8}><Text style={{ color: LUX.body, padding: 6, fontSize: 14, fontWeight: "600" }}>✕</Text></Pressable>
              )}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ maxHeight: 260, marginTop: 12 }} nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {filteredNewCreditCustomers.length === 0 ? (
                <View style={{ backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 16, alignItems: "center" }}>
                  <Text style={{ color: LUX.muted, fontSize: 12, fontWeight: "600", textAlign: "center" }}>{newCreditSearch.trim() ? "Pa jwenn kliyan" : "Pa gen kliyan — kreye youn"}</Text>
                  <Text style={{ color: LUX.faint, fontSize: 11, marginTop: 4, textAlign: "center" }}>Antre NIF/CIN oswa itilize bouton anba a</Text>
                </View>
              ) : (
                filteredNewCreditCustomers.map(c => (
                  <Pressable key={c.id} onPress={() => handleSelectNewCreditCustomer(c)} style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ fontWeight: "700", fontSize: 13, color: LUX.ink }}>{c.name}</Text>
                      <Text style={{ fontSize: 11, color: LUX.body, fontWeight: "600", marginTop: 2 }}>{c.id_card_number || "Pa gen NIF/CIN"} • {c.phone || "Pa gen telefòn"}</Text>
                      <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 1 }} numberOfLines={1}>{c.address || "Pa gen adrès"}</Text>
                      <Text style={{ fontSize: 11, color: c.total_debt > 0 ? LUX.redDeep : LUX.greenDeep, marginTop: 1, fontWeight: "600" }}>{c.total_debt > 0 ? `${formatCurrency(Number(c.total_debt))} due • ${c.credit_limit == null ? "San limit" : `Limit ${c.credit_limit} HTG`}` : "Pa gen dèt • Pare pou kredi"}</Text>
                    </View>
                    <View style={{ backgroundColor: LUX.goldSoft, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: LUX.goldDeep }}>Chwazi ›</Text>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <View style={{ marginTop: 12, backgroundColor: LUX.goldBg, borderWidth: 1, borderColor: LUX.goldSoft, borderRadius: 16, padding: 10 }}>
              <Text style={{ fontSize: 11, color: LUX.goldDeep, fontWeight: "600", textAlign: "center" }}>Chwazi kliyan an → w ap ale nan lavant pou chwazi pwodwi. Enfòmasyon kliyan ap rete.</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => { setShowNewCreditModal(false); setNewCreditSearch(""); setIsNewCreditFlow(false); }} style={{ flex: 1, backgroundColor: LUX.surface2, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, paddingVertical: 12, alignItems: "center" }}><Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Anile</Text></Pressable>
              {canManageCustomer && (
                <Pressable onPress={() => { setShowNewCreditModal(false); setIsNewCreditFlow(true); setShowAddCustomer(true); }} style={{ flex: 1, backgroundColor: LUX.ink, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}>
                  <Text style={{ color: LUX.goldSoft, fontWeight: "800", fontSize: 13 }}>＋ Kreye Kliyan</Text>
                </Pressable>
              )}
            </View>
            {canManageCustomer && <Text style={{ fontSize: 10, color: LUX.faint, textAlign: "center", marginTop: 8 }}>Kreye ak ID + NIF/CIN, apre chwazi pwodwi nan lavant</Text>}
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showPay} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(29,29,31,0.55)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: LUX.hairline, alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ fontWeight: "800", textAlign: "center", fontSize: 15, color: LUX.ink }}>Peman dèt</Text>
            <Text style={{ fontSize: 12, color: LUX.muted, textAlign: "center", marginTop: 4 }}>Verifye ID dèt & NIF/CIN • Resi ap bay otomatikman</Text>
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 16, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>ID dèt *</Text>
            <TextInput placeholder="debt-1" placeholderTextColor={LUX.faint} value={payDebtId} onChangeText={setPayDebtId} style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Kat idantite (verifikasyon)</Text>
            <TextInput placeholder="004-123-4567" placeholderTextColor={LUX.faint} value={payIdCard} onChangeText={setPayIdCard} style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Montan (HTG)</Text>
            <TextInput placeholder="500" placeholderTextColor={LUX.faint} value={payAmount} onChangeText={setPayAmount} keyboardType="numeric" style={{ borderWidth: 1, borderColor: LUX.ink, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontWeight: "700", fontSize: 13, color: LUX.ink }} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setShowPay(false)} style={{ flex: 1, paddingVertical: 13, backgroundColor: LUX.surface2, borderRadius: 16, alignItems: "center" }}><Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Anile</Text></Pressable>
              <Pressable onPress={handlePay} style={{ flex: 1, paddingVertical: 13, backgroundColor: LUX.ink, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, alignItems: "center" }}><Text style={{ color: LUX.goldSoft, fontWeight: "800", fontSize: 13 }}>PEYE & BAY RESI</Text></Pressable>
            </View>
            <Text style={{ fontSize: 10, color: LUX.faint, textAlign: "center", marginTop: 10 }}>Peman ajoute nan revni jodi a • Resi: REC-YYYYMMDD-XXXX</Text>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddCustomer} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(29,29,31,0.55)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", ...(isTablet && { alignItems: "center", width }) }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: LUX.hairline, alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ fontWeight: "800", textAlign: "center", fontSize: 15, color: LUX.ink }}>Ajoute nouvo kliyan</Text>

            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 16, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Non</Text>
            <TextInput value={newCustomer.name} onChangeText={value => setNewCustomer(p => ({ ...p, name: value }))} style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>NIF/CIN</Text>
            <TextInput value={newCustomer.id_card_number} onChangeText={value => setNewCustomer(p => ({ ...p, id_card_number: value }))} style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Telefòn</Text>
            <TextInput value={newCustomer.phone} onChangeText={value => setNewCustomer(p => ({ ...p, phone: value }))} keyboardType="phone-pad" style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Adrès</Text>
            <TextInput value={newCustomer.address} onChangeText={value => setNewCustomer(p => ({ ...p, address: value }))} placeholder="Delmas 33, Pòtoprens" placeholderTextColor={LUX.faint} style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <Text style={{ fontWeight: "600", fontSize: 11, marginTop: 12, color: LUX.body, letterSpacing: 0.3, textTransform: "uppercase" }}>Limit kredi (opsyonèl)</Text>
            <TextInput value={newCustomer.credit_limit} onChangeText={value => setNewCustomer(p => ({ ...p, credit_limit: value }))} keyboardType="numeric" style={{ borderWidth: 1, borderColor: LUX.hairline, backgroundColor: LUX.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: LUX.ink }} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setShowAddCustomer(false)} style={{ flex: 1, backgroundColor: LUX.surface2, borderRadius: 16, paddingVertical: 13, alignItems: "center" }}>
                <Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Anile</Text>
              </Pressable>
              {canManageCustomer && (
                <Pressable onPress={() => { if (isNewCreditFlow) handleCreateNewCreditCustomer(); else handleCreateCustomerFromSearch(); }} style={{ flex: 1, backgroundColor: LUX.ink, borderWidth: 1, borderColor: LUX.gold, borderRadius: 16, paddingVertical: 13, alignItems: "center" }}>
                  <Text style={{ color: LUX.goldSoft, fontWeight: "800", fontSize: 13 }}>{showNewCreditModal ? "Kreye & Ale nan lavant" : "KREYE"}</Text>
                </Pressable>
              )}
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ReceiptModal visible={showReceipt} receipts={lastReceipts} onClose={() => setShowReceipt(false)} />
    </View>
  );
}
