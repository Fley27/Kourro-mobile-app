import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform, Share } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { buildReceipts, buildReceiptHtml, receiptToText } from "../receipts";
import { getDb } from "../db";
import { fmtG, fmt } from "../format";
import { useResponsive, sheetBox } from "../responsive";
import { CustomersPhone } from "./CustomersPhone";
import { CustomersTablet } from "./CustomersTablet";
import { NewCustomerSheet, EditCustomerContent, type EditCustomerState } from "../components/CustomerSheets";
import { CreditPayFlow } from "../components/CreditPayFlow";
import ReceiptModal from "../components/ReceiptModal";
import { TxnDetailBody } from "./cartViews";
import type { CustomerFormData } from "../components/CustomerForm";
import { fullNameOf } from "../components/CustomerForm";
import { insertCustomerRecord, updateCustomerRecord, customerToFormData, fetchCustomerNotes, addCustomerNote, fetchCustomerStats } from "../sales/customers";
import {
  CreditLimitViewCard,
} from "./CustomersShared";
import { CustomerProfileBody, CustomerProfileHeader, CustomerTxnsList, ProfileMenu, tenderLabel } from "../components/CustomerProfile";

export default function CustomersScreen({ role = "cashier", currentUser, onAddSale }: { role?: string; currentUser?: any; onAddSale?: (c: any) => void }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [pastCredits, setPastCredits] = useState<any[]>([]);
  const [pastSales, setPastSales] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editFormState, setEditFormState] = useState<EditCustomerState>({ data: null, valid: false, creditLimit: null, limitOk: true });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [showDebtOnly, setShowDebtOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editNotes, setEditNotes] = useState<any[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [profileStats, setProfileStats] = useState({ visits: 0, spent: 0, lastVisit: null as string | null, firstVisit: null as string | null });
  const [txnDetail, setTxnDetail] = useState<{ sale: any; items: any[] } | null>(null);
  const [txnCredit, setTxnCredit] = useState<any | null>(null);
  const [txnPayments, setTxnPayments] = useState<any[]>([]);
  const [showPay, setShowPay] = useState(false);
  const [payReceipt, setPayReceipt] = useState<{ customer: any; store: any } | null>(null);
  const [showPayReceipt, setShowPayReceipt] = useState(false);
  const [pendingPayReceipt, setPendingPayReceipt] = useState<{ customer: any; store: any } | null>(null);
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  // Detail views share one ScrollView — reset offset on every view change
  // so a new view never opens pre-scrolled.
  const detailScroll = useRef<any>(null);
  useEffect(() => {
    detailScroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedCustomerId, txnDetail, showAllTxns, showEditSheet, showPay]);

  const isManagerPlus = ["owner", "admin", "manager"].includes(role || "cashier");
  // Phase 4 matrix: cashiers get everything except editing; associate/cook/
  // server never reach this screen (hidden in More hub).
  const canAddCustomer = ["owner", "admin", "manager", "cashier"].includes(role || "cashier");
  const canEditCustomer = ["owner", "admin", "manager"].includes(role || "cashier");
  const { width, height, isTablet, isLandscape, padH, fabRight } = useResponsive();
  const sheetH = Math.round(height * 5 / 6);
  // Master-detail shows in portrait; landscape tablets use phone layout.
  const showTablet = isTablet && !isLandscape;

  async function load() {
    try {
    const db = await getDb();
    const allCustomersRaw = (await db.getAllAsync("SELECT * FROM customers")) as any[];
    const allCustomers = Array.from(new Map(allCustomersRaw.map((c: any) => [c.id, c] as const)).values());
    const allDebts = (await db.getAllAsync("SELECT * FROM credits WHERE balance > 0")) as any[];
    setCustomers(allCustomers);
    setDebts(allDebts);
    } catch (e) {
      console.log("[Customers load] failed:", e);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedCustomerId) {
      setPastCredits([]);
      setPastSales([]);
      setEditNotes([]);
      setTxnDetail(null);
      setTxnCredit(null);
      setTxnPayments([]);
      setShowPay(false);
      setShowAllTxns(false);
      setNoteInput("");
      setProfileStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
      return;
    }
    (async () => {
      try {
      const db = await getDb();
      try {
        const credits = (await db.getAllAsync("SELECT * FROM credits WHERE customer_id = ? ORDER BY updated_at DESC, created_at DESC", [selectedCustomerId])) as any[];
        setPastCredits(credits);
      } catch {
        try {
          const credits2 = (await db.getAllAsync("SELECT * FROM credits WHERE customer_id = ?", [selectedCustomerId])) as any[];
          setPastCredits(credits2.sort((a: any, b: any) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()));
        } catch {
          setPastCredits([]);
        }
      }
      // past sales (Kach / MonCash / NatCash) — separate from Kredi so they are never confused
      try {
        const sales = (await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ? ORDER BY updated_at DESC, created_at DESC", [selectedCustomerId])) as any[];
        setPastSales(sales);
      } catch {
        try {
          const sales2 = (await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [selectedCustomerId])) as any[];
          setPastSales(sales2.sort((a: any, b: any) => new Date(b.updated_at ?? b.created_at ?? b.sale_number ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()));
        } catch {
          setPastSales([]);
        }
      }
      try {
        const db = await getDb();
        setEditNotes(await fetchCustomerNotes(db, selectedCustomerId));
        setProfileStats(await fetchCustomerStats(db, selectedCustomerId));
      } catch {}
      } catch (e) {
        console.log("[Customers history] failed:", e);
      }
    })();
  }, [selectedCustomerId]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) ?? null;

  // Unified transaction feed for the shared profile: sales + credits, deduped
  // by sale (a credit purchase exists in both), newest first.
  const profileTxns = useMemo(() => {
    const salesRows = (pastSales ?? []).map((s: any) => ({
      id: s.id,
      sale_id: s.id,
      total: Number(s.total ?? s.amount ?? s.subtotal ?? 0),
      created_at: s.created_at ?? s.updated_at ?? null,
      payment_method: s.payment_method ?? "cash",
    }));
    const saleIds = new Set(salesRows.map((s: any) => s.sale_id));
    const creditRows = (pastCredits ?? [])
      .filter((c: any) => !saleIds.has(c.sale_id ?? c.id))
      .map((c: any) => ({
        id: c.sale_id ?? c.id,
        sale_id: c.sale_id ?? c.id,
        total: Number(c.amount ?? c.balance ?? 0),
        created_at: c.created_at ?? c.updated_at ?? null,
        payment_method: "credit",
      }));
    return [...salesRows, ...creditRows].sort(
      (a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    );
  }, [pastSales, pastCredits]);

  async function shareTxnReceipt() {
    if (!txnDetail) return;
    const s = txnDetail.sale;
    try {
      const pair = buildReceipts({
        saleId: s.sale_id ?? s.id,
        saleNumber: s.sale_number ?? String(s.sale_id ?? s.id),
        storeName: "Magazen",
        createdAt: s.created_at ?? new Date().toISOString(),
        cashier: { id: s.seller_id ?? null, name: "", role: "" },
        customer: selectedCustomer ? { name: selectedCustomer.name ?? "Kliyan", phone: selectedCustomer.phone ?? null, email: selectedCustomer.email ?? null } : null,
        items: (txnDetail.items ?? []).map((it: any) => ({
          name: it.product_name ?? "Atik",
          variant: it.variant ?? null,
          qty: Number(it.quantity ?? 0),
          unitPrice: Number(it.unit_price ?? 0),
          lineTotal: Number(it.line_total ?? 0),
        })),
        subtotal: Number(s.subtotal ?? s.total ?? 0),
        total: Number(s.total ?? 0),
        paymentMethod: s.payment_method ?? "cash",
        amountPaid: Number(s.amount_paid ?? s.total ?? 0),
        amountDue: Number(s.amount_due ?? 0),
        change: 0,
      });
      const client = pair.customer;
      const file = await Print.printToFileAsync({ html: buildReceiptHtml(client), base64: false });
      if (file.uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Pataje resi a (PDF)", UTI: "com.adobe.pdf" });
        return;
      }
      throw new Error("share-unavailable");
    } catch {
      try {
        const s2 = txnDetail.sale;
        await Share.share({ title: `Resi ${s2.sale_number ?? s2.id}`, message: `Resi ${s2.sale_number ?? s2.id} — ${fmtG(Number(s2.total ?? 0))} (${s2.created_at ?? ""})` });
      } catch {}
    }
  }

  function openTxn(t: any) {
    // Open instantly with what we have; items + credit + payments fill in.
    setTxnDetail({ sale: t, items: [] });
    setTxnCredit(null);
    setTxnPayments([]);
    (async () => {
      try {
        const db = await getDb();
        const saleId = t.sale_id ?? t.id;
        const rows = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [saleId]).catch(() => [])) as any[]) ?? [];
        setTxnDetail({ sale: t, items: rows });
        const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [saleId]).catch(() => [])) as any[]) ?? [];
        const credit = credits[0] ?? null;
        setTxnCredit(credit);
        if (credit) {
          const pays = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [credit.id, credit.id]).catch(() => [])) as any[]) ?? [];
          setTxnPayments(pays);
        }
      } catch {}
    })();
  }

  const txnDue = txnDetail ? (txnCredit
    ? Math.max(0, Number(txnCredit.amount || 0) - txnPayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0))
    : Math.max(0, Number(txnDetail.sale?.amount_due ?? 0))) : 0;
  const txnPaid = txnDetail ? Math.max(0, Number(txnDetail.sale?.total ?? 0) - (txnCredit ? txnDue : Math.max(0, Number(txnDetail.sale?.amount_due ?? 0)))) : 0;

  async function payTxnDue(amount: number) {
    if (!txnDetail || !txnCredit) throw new Error("Pa gen dèt");
    const db = await getDb();
    const { payCreditDebt } = await import("../sales/creditPayments");
    const res = await payCreditDebt(db, txnCredit, selectedCustomer, amount, currentUser?.id ?? null);
    const pays = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [txnCredit.id, txnCredit.id]).catch(() => [])) as any[]) ?? [];
    setTxnPayments(pays);
    const fresh = ((await db.getAllAsync("SELECT * FROM credits WHERE id = ?", [txnCredit.id]).catch(() => [])) as any[]) ?? [];
    if (fresh[0]) setTxnCredit(fresh[0]);
    if (selectedCustomerId) {
      const db2 = await getDb();
      setProfileStats(await fetchCustomerStats(db2, selectedCustomerId).catch(() => profileStats));
      const all = ((await db2.getAllAsync("SELECT * FROM credits WHERE customer_id = ?", [selectedCustomerId]).catch(() => [])) as any[]) ?? [];
      setPastCredits(all);
    }
    return res;
  }

  async function onPaySuccess(info: { amount: number; receipt: string; finalBalance: number }) {
    if (!txnDetail) return;
    setShowPay(false);
    try {
      const { buildCreditPaymentReceipts } = await import("../receipts");
      const db = await getDb();
      const pair = buildCreditPaymentReceipts({
        payId: `pay-${Date.now()}`,
        receiptNumber: info.receipt,
        debtId: txnCredit?.id ?? txnDetail.sale?.id,
        storeName: "Magazen",
        createdAt: new Date().toISOString(),
        cashier: { id: currentUser?.id ?? null, name: currentUser?.name ?? "", role: currentUser?.role ?? "" },
        customer: selectedCustomer ? { name: selectedCustomer.name ?? "", idCard: selectedCustomer.id_card_number ?? null, phone: selectedCustomer.phone ?? null } : null,
        debtTotal: Number(txnCredit?.amount ?? txnDetail.sale?.total ?? 0),
        previousBalance: Number(txnCredit?.amount ?? 0),
        amount: info.amount,
        finalBalance: info.finalBalance,
        paymentMethod: "cash",
        dueDate: txnCredit?.due_date ?? null,
      });
      try {
        for (const r of [pair.customer, pair.store]) {
          await db.runAsync(
            "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [r.id, "demo-store-id", txnDetail.sale?.sale_id ?? txnDetail.sale?.id ?? null, r.copyType, r.receiptNumber, txnDetail.sale?.sale_number ?? null, currentUser?.id ?? null, currentUser?.name ?? "", currentUser?.role ?? "", JSON.stringify(r), new Date().toISOString()]
          );
        }
      } catch {}
      // Payment is complete: leave the profile so the receipt presents over
      // the plain list with no competing windows.
      setShowPay(false);
      setTxnDetail(null);
      setShowAllTxns(false);
      setSelectedCustomerId(null);
      setPendingPayReceipt(pair as any);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resi echwe");
    }
  }

  useEffect(() => {
    if (!showPay && pendingPayReceipt) {
      const t = setTimeout(() => {
        setPayReceipt(pendingPayReceipt);
        setShowPayReceipt(true);
        setPendingPayReceipt(null);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [showPay, pendingPayReceipt]);

  const editNotesProps = {
    notes: editNotes,
    noteInput,
    onNoteInput: setNoteInput,
    savingNote,
    onAddNote: handleAddNote,
    notesLimit: 2,
  };

  async function handleAddNote() {    if (!selectedCustomer || !noteInput.trim() || editNotes.length >= 2) return;
    setSavingNote(true);
    try {
      const db = await getDb();
      const row = await addCustomerNote(db, "demo-store-id", selectedCustomer.id, noteInput.trim(), currentUser?.id ?? null);
      setEditNotes(prev => [row, ...prev].slice(0, 10));
      setNoteInput("");
    } finally {
      setSavingNote(false);
    }
  }

  const displayCustomers = useMemo(() => {
    // dedupe by id to prevent duplicate-key warning from legacy Date.now() collisions
    const deduped = Array.from(new Map(customers.map(c => [c.id, c] as const)).values());
    let list = [...deduped];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c => (c.name ?? "").toLowerCase().includes(q) || (c.id_card_number ?? "").toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q) || (c.address ?? "").toLowerCase().includes(q));
    }
    if (showDebtOnly) {
      const debtIds = new Set(debts.filter(d => Number(d.balance) > 0).map(d => d.customer_id));
      list = list.filter(c => debtIds.has(c.id));
    }
    if (showDebtOnly) {
      list.sort((a, b) => {
        const aDue = debts.filter(d => d.customer_id === a.id && Number(d.balance) > 0).map(d => d.due_date ? new Date(d.due_date).getTime() : Number.MAX_SAFE_INTEGER).sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
        const bDue = debts.filter(d => d.customer_id === b.id && Number(d.balance) > 0).map(d => d.due_date ? new Date(d.due_date).getTime() : Number.MAX_SAFE_INTEGER).sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      });
    }
    return list;
  }, [customers, debts, showDebtOnly, search]);

  async function logEdit(customerId: string, action: string, fieldName: string, oldValue: any, newValue: any) {
    try {
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO customer_history (id, customer_id, user_id, action, field_name, old_value, new_value, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [`cust-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, customerId, currentUser?.id ?? "unknown-user", action, fieldName, oldValue ?? null, newValue ?? null, new Date().toISOString()]
    );
    } catch (e) {
      console.log("[logEdit] failed:", e);
    }
  }

  async function handleAddCustomer(data: CustomerFormData, extra: { creditLimit: number | null }) {
    if (!canAddCustomer) return Alert.alert("Pa gen dwa", "Ou pa ka kreye nouvo kliyan.");
    // Sheet already validated; credit limit is manager-only.
    const parsedLimit = isManagerPlus ? extra.creditLimit : null;
    setSavingCustomer(true);
    try {
    const db = await getDb();
    const record = await insertCustomerRecord(db, "demo-store-id", data);
    if (parsedLimit !== null) {
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [parsedLimit, "manual", record.id]);
      record.credit_limit = parsedLimit;
      record.credit_limit_source = "manual";
    }
    await logEdit(record.id, "created", "customer", null, `${record.name} / ${record.id_card_number}${record.address ? ` / ${record.address}` : ""}`);
    setCustomers(prev => {
      if (prev.some(c => c.id === record.id)) return prev;
      return [record, ...prev];
    });
    setShowAddCustomer(false);
    setSelectedCustomerId(record.id);
    Alert.alert("Kliyan ajoute", `${record.name} anrejistre. ${record.phone ? `Telefòn: ${record.phone}` : "Pa gen nimewo telefòn"}${record.address ? ` · Adrès: ${record.address}` : ""}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    } finally {
      setSavingCustomer(false);
    }
  }

  async function handleSaveCustomer(data: CustomerFormData, extra: { creditLimit: number | null }) {
    if (!selectedCustomer) return;
    if (!canEditCustomer) return Alert.alert("Pa gen dwa", "Ou pa ka modifye dosye kliyan.");
    const nextLimit = isManagerPlus ? extra.creditLimit : (selectedCustomer.credit_limit ?? null);
    const oldLimit = selectedCustomer.credit_limit == null ? null : Number(selectedCustomer.credit_limit);
    if (!isManagerPlus && nextLimit !== oldLimit) {
      return Alert.alert("Pa gen dwa", "Se sèlman Manager ak pi wo ka modifye limit kredi.");
    }
    setSavingCustomer(true);
    try {
    const db = await getDb();
    const patch = await updateCustomerRecord(db, selectedCustomer.id, data);
    await db.runAsync(
      "UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?",
      [nextLimit, nextLimit === null ? null : (selectedCustomer.credit_limit_source ?? "manual"), selectedCustomer.id]
    );
    const nextName = fullNameOf(data);
    const fieldUpdates = [
      ["name", selectedCustomer.name, nextName],
      ["id_card_number", selectedCustomer.id_card_number, data.idDoc.trim()],
      ["phone", selectedCustomer.phone, patch.phone],
      ["address", selectedCustomer.address, patch.address],
      ["email", selectedCustomer.email, patch.email],
      ["credit_limit", selectedCustomer.credit_limit, nextLimit],
    ].filter(([, oldValue, newValue]) => String(oldValue ?? "") !== String(newValue ?? ""));
    for (const [fieldName, oldValue, newValue] of fieldUpdates) {
      await logEdit(selectedCustomer.id, "updated", fieldName as string, oldValue, newValue);
    }
    setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, ...patch, name: nextName, credit_limit: nextLimit } : c));
    setShowEditSheet(false);
    Alert.alert("Kliyan mete ajou", "Chanjman yo anrejistre nan istwa kliyan an.");
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete kliyan ajou echwe");
    } finally {
      setSavingCustomer(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: showTablet ? "#F8F9FA" : "#000", alignItems: showTablet ? "center" : undefined }}>
      {showTablet ? (
        <CustomersTablet
          customers={customers}
          debts={debts}
          displayCustomers={displayCustomers}
          search={search}
          setSearch={setSearch}
          showDebtOnly={showDebtOnly}
          setShowDebtOnly={setShowDebtOnly}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          selectedCustomer={selectedCustomer}
          canManageCustomers={canEditCustomer}
          isManagerPlus={isManagerPlus}
          onOpenMenu={() => setShowProfileMenu(true)}
          showProfileMenu={showProfileMenu}
          onCloseMenu={() => setShowProfileMenu(false)}
          onAddSale={onAddSale}
          onOpenEdit={() => setShowEditSheet(true)}
          txnDue={txnDue}
          txnPaid={txnPaid}
          txnPayments={txnPayments}
          onPayPress={txnCredit && txnDue > 0 ? () => setShowPay(true) : undefined}
          showEditSheet={showEditSheet}
          onCloseEditSheet={() => setShowEditSheet(false)}
          editNotesProps={editNotesProps}
          editFormState={editFormState}
          setEditFormState={setEditFormState}
          onSaveEdit={() => { if (editFormState.data) handleSaveCustomer(editFormState.data, { creditLimit: editFormState.creditLimit }); }}
          savingCustomer={savingCustomer}
          onOpenTxn={openTxn}
          onShareReceipt={shareTxnReceipt}
          showPay={showPay}
          onClosePay={() => setShowPay(false)}
          payDue={txnDue}
          onPayDue={payTxnDue}
          onPaySuccess={onPaySuccess}
          showAllTxns={showAllTxns}
          setShowAllTxns={setShowAllTxns}
          txnDetail={txnDetail}
          setTxnDetail={setTxnDetail}
          profileStats={profileStats}
          profileNotes={editNotes}
          profileTxns={profileTxns}
          onAdd={canAddCustomer ? () => { setAddKey(k => k + 1); setShowAddCustomer(true); } : undefined}
          padH={padH}
          width={width}
          isTablet={isTablet}
        />
      ) : (
        <CustomersPhone
          customers={customers}
          debts={debts}
          displayCustomers={displayCustomers}
          search={search}
          setSearch={setSearch}
          showDebtOnly={showDebtOnly}
          setShowDebtOnly={setShowDebtOnly}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          onAdd={canAddCustomer ? () => { setAddKey(k => k + 1); setShowAddCustomer(true); } : undefined}
          padH={padH}
          width={width}
          isTablet={isTablet}
        />
      )}

      {selectedCustomer && (
        <Modal visible={!!selectedCustomer && !showTablet} transparent={false} animationType="slide" onRequestClose={() => setSelectedCustomerId(null)}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60 }}>
            {!showPay ? (
            <CustomerProfileHeader
              onBack={() => {
                if (showPay) setShowPay(false);
                else if (showEditSheet) setShowEditSheet(false);
                else if (txnDetail) setTxnDetail(null);
                else if (showAllTxns) setShowAllTxns(false);
                else setSelectedCustomerId(null);
              }}
              backIcon={showPay || showEditSheet || txnDetail ? "close" : "back"}
              title={
                showPay ? "Touche"
                : showEditSheet ? "Modifye kliyan"
                : txnDetail ? `${fmtG(Number(txnDetail.sale?.total ?? 0))} | ${tenderLabel(txnDetail.sale?.payment_method)}`
                : showAllTxns ? "Transactions" : undefined
              }
              onMenu={!showPay && !showEditSheet && !txnDetail && !showAllTxns ? () => setShowProfileMenu(true) : undefined}
              headerAction={showEditSheet ? (
                <Pressable
                  onPress={() => { if (editFormState.data) handleSaveCustomer(editFormState.data, { creditLimit: editFormState.creditLimit }); }}
                  disabled={!editFormState.valid || savingCustomer}
                  style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: editFormState.valid && !savingCustomer ? "#fff" : "#2b2b2b", opacity: savingCustomer ? 0.7 : 1 }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 15, color: editFormState.valid && !savingCustomer ? "#000" : "#6e6e73" }}>{savingCustomer ? "…" : "Save"}</Text>
                </Pressable>
              ) : undefined}
            />
            ) : null}
            {showPay ? (
              <View style={{ flex: 1 }}>
                <CreditPayFlow
                  inline
                  visible={showPay}
                  due={txnDue}
                  onClose={() => setShowPay(false)}
                  onPay={payTxnDue}
                  onSuccess={onPaySuccess}
                />
              </View>
            ) : (
            <ScrollView ref={detailScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
              {showEditSheet && selectedCustomer ? (
                <EditCustomerContent
                  resetKey={selectedCustomer.id}
                  visible={showEditSheet}
                  initial={customerToFormData(selectedCustomer)}
                  initialCreditLimit={selectedCustomer.credit_limit ?? null}
                  showCreditLimit
                  canEditCreditLimit={isManagerPlus}
                  notesProps={editNotesProps}
                  onState={setEditFormState}
                />
              ) : txnDetail ? (
                <TxnDetailBody
                  sale={txnDetail.sale}
                  items={txnDetail.items}
                  customer={selectedCustomer}
                  onNewReceipt={shareTxnReceipt}
                  dueBalance={txnDue}
                  totalPaid={txnPaid}
                  payments={txnPayments}
                  onPayPress={txnCredit && txnDue > 0 ? () => setShowPay(true) : undefined}
                />
              ) : showAllTxns ? (
                <CustomerTxnsList transactions={profileTxns} onOpenTransaction={openTxn} />
              ) : (
                <>
                  {/* Shared full profile — identical to checkout */}
                  <CustomerProfileBody
                    customer={selectedCustomer}
                    stats={profileStats}
                    notes={editNotes}
                    transactions={profileTxns}
                    onOpenTransaction={openTxn}
                    onViewAll={() => setShowAllTxns(true)}
                    limitSection={
                      <CreditLimitViewCard customer={selectedCustomer} isManagerPlus={isManagerPlus} canManageCustomers={canEditCustomer} />
                    }
                  />
                </>
              )}
            </ScrollView>
            )}
            {showProfileMenu && selectedCustomer ? (
              <ProfileMenu
                onClose={() => setShowProfileMenu(false)}
                top={122}
                right={18}
                options={[
                  { label: "Add Sale", onPress: () => onAddSale?.(selectedCustomer) },
                  ...(canEditCustomer ? [{ label: "Edit", onPress: () => setShowEditSheet(true) }] : []),
                ]}
              />
            ) : null}
          </View>
        </Modal>
      )}

      <ReceiptModal
        visible={showPayReceipt}
        receipts={payReceipt}
        onClose={() => { setShowPayReceipt(false); setPayReceipt(null); }}
        staging={{ storeId: "demo-store-id", cashierId: currentUser?.id ?? null, customerId: selectedCustomer?.id ?? null }}
        locked
      />

      <NewCustomerSheet
        visible={showAddCustomer}        resetKey={addKey}
        onClose={() => setShowAddCustomer(false)}
        onSave={handleAddCustomer}
        saving={savingCustomer}
        showCreditLimit={isManagerPlus}
        canEditCreditLimit={isManagerPlus}
      />
    </View>
  );
}
