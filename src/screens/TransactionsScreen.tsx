// Transactions hub — Credits + sales history, scoped by role and store.
// Cashiers/associates/cooks see only their own sales; managers+ see their
// stores; owners see everything. Sale detail reuses the shared TxnDetailBody
// and reprints through ReceiptModal.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert, Modal, SectionList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow, topIconBtn } from "../theme";
import { fmtG, fmt, monoStyle } from "../format";
import { useResponsive } from "../responsive";
import { getDb } from "../db";
import { getUserById } from "../users";
import { PAYMENT_LABELS, buildReceipts, type ReceiptData } from "../receipts";
import ReceiptModal from "../components/ReceiptModal";
import { TxnDetailBody } from "./cartViews";
import { CreditPayFlow } from "../components/CreditPayFlow";

type TxnViewState = { name: "hub" } | { name: "sale"; saleId: string };

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];

function sectionTitleFor(t: number, now: Date): { key: string; title: string; sort: number } {
  const d = new Date(t);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day === today) return { key, title: "Jodi a", sort: day };
  if (day === today - 86400000) return { key, title: "Yè", sort: day };
  return { key, title: `${d.getDate()} ${HT_MONTHS[d.getMonth()]} ${d.getFullYear()}`, sort: day };
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TransactionsScreen({
  role = "cashier",
  storeId = "demo-store-id",
  storeName,
  currentUser,
  userStoreIds = [],
}: {
  role?: string;
  storeId?: string;
  storeName?: string;
  currentUser?: any;
  userStoreIds?: string[];
}) {
  const { padH } = useResponsive();
  const [view, setView] = useState<TxnViewState>({ name: "hub" });
  const [sales, setSales] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [hubCredits, setHubCredits] = useState<any[]>([]);
  const [hubPayments, setHubPayments] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [methods, setMethods] = useState<string[] | null>(null);
  const [krediStates, setKrediStates] = useState<string[]>([]);
  const [krediAges, setKrediAges] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterView, setFilterView] = useState<"main" | "kredi">("main");
  const [draftMethods, setDraftMethods] = useState<string[]>([]);
  const [draftStates, setDraftStates] = useState<string[]>([]);
  const [draftAges, setDraftAges] = useState<string[]>([]);

  const KREDI_STATES = [
    { key: "paid", label: "Fin peye" },
    { key: "partial", label: "Kòmanse Peye" },
    { key: "unpaid", label: "Pa Ko Peye" },
    { key: "none", label: "Pa Gen Okenn Pèman" },
  ];
  const KREDI_AGES = [
    { key: "1w", label: "Plis pase 1 semèn", days: 7 },
    { key: "2w", label: "Plis pase 2 semèn", days: 14 },
    { key: "1m", label: "Plis pase 1 mwa", days: 30 },
    { key: "3m", label: "Plis pase 1 trimès", days: 90 },
    { key: "1y", label: "Plis pase 1 an", days: 365 },
  ];

  function saleCreditInfo(sale: any) {
    const credit = hubCredits.find(c => c.sale_id === sale.id) ?? null;
    if (!credit) return null;
    const paid = hubPayments
      .filter(p => p.credit_id === credit.id || p.debt_id === credit.id)
      .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const amount = Number(credit.amount || 0);
    const start = new Date(credit.created_at ?? sale.created_at ?? "").getTime();
    return {
      credit,
      paid,
      balance: Math.max(0, amount - paid),
      ageDays: isNaN(start) ? 0 : (Date.now() - start) / 86400000,
    };
  }

  function krediMatch(sale: any, states: string[], ages: string[]): boolean {
    const info = saleCreditInfo(sale);
    if (!info) return false;
    const stateOk = !states.length || states.some(st =>
      st === "paid" ? info.balance <= 0.01 :
      st === "partial" ? (info.paid > 0 && info.balance > 0.01) :
      st === "unpaid" ? info.balance > 0.01 :
      info.paid <= 0
    );
    const ageOk = !ages.length || ages.some(a => {
      const t = KREDI_AGES.find(x => x.key === a)?.days ?? 0;
      return info.ageDays > t;
    });
    return stateOk && ageOk;
  }
  const [detail, setDetail] = useState<{ sale: any; items: any[]; credit?: any | null; payments?: any[] } | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [payReceiptLocked, setPayReceiptLocked] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const detailScroll = useRef<any>(null);
  useEffect(() => {
    detailScroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [detail, showPay]);
  const [receipts, setReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  // Bumped on every open so the receipt window remounts on top of the detail.

  const myId = currentUser?.id ?? null;
  // Assigned stores PLUS this device's selling store — POS records under the
  // device store id, otherwise an admin's own sales vanish here.
  const scopedStores = (() => {
    const ids = userStoreIds.length ? [...userStoreIds] : [];
    if (!ids.includes(storeId)) ids.push(storeId);
    return ids;
  })();

  async function load() {
    try {
      const db = await getDb();
      const rows = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
      const live = rows.filter((s: any) => String(s.status ?? "") !== "cancelled");
      let list = live;
      if (role !== "owner") {
        list = list.filter((s: any) => scopedStores.includes(String(s.store_id ?? storeId)));
      }
      if (role === "cashier" || role === "associate" || role === "cook") {
        list = list.filter((s: any) => (s.seller_id ?? null) === myId);
      }
      list.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
      setSales(list);
      const custs = ((await db.getAllAsync("SELECT * FROM customers")) as any[]) ?? [];
      setCustomers(custs);
      try { setHubCredits(((await db.getAllAsync("SELECT * FROM credits")) as any[]) ?? []); } catch {}
      try { setHubPayments(((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]) ?? []); } catch {}
    } catch {}
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (view.name === "hub") load(); }, [view]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const krediActive = krediStates.length > 0 || krediAges.length > 0;
    const byMethod = (!methods || !methods.length) && !krediActive
      ? sales
      : sales.filter(s => {
        const m = String(s.payment_method ?? "cash").toLowerCase();
        if (methods && methods.includes(m)) return true;
        if (krediActive && krediMatch(s, krediStates, krediAges)) return true;
        return false;
      });
    if (!needle) return byMethod;
    return byMethod.filter(s => {
      const c = customers.find(x => x.id === s.customer_id);
      return (
        String(s.sale_number ?? s.id ?? "").toLowerCase().includes(needle) ||
        (c?.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [sales, customers, q, methods, krediStates, krediAges, hubCredits, hubPayments]);

  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { key: string; title: string; sort: number; data: any[] }>();
    for (const s of filtered) {
      const t = new Date(s.created_at ?? "").getTime();
      if (isNaN(t)) {
        const g = map.get("nodate") ?? { key: "nodate", title: "San dat", sort: -1, data: [] };
        g.data.push(s);
        map.set("nodate", g);
        continue;
      }
      const meta = sectionTitleFor(t, now);
      const g = map.get(meta.key) ?? { ...meta, data: [] };
      g.data.push(s);
      map.set(meta.key, g);
    }
    return [...map.values()].sort((a, b) => b.sort - a.sort);
  }, [filtered]);

  async function openSale(sale: any) {
    try {
      const db = await getDb();
      const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const credit = credits[0] ?? null;
      let payments: any[] = [];
      if (credit) {
        payments = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [credit.id, credit.id]).catch(() => [])) as any[]) ?? [];
      }
      setDetail({ sale, items, credit, payments });
    } catch {
      setDetail({ sale, items: [], credit: null, payments: [] });
    }
    setView({ name: "sale", saleId: sale.id });
  }

  async function reprintSale() {
    if (!detail) return;
    try {
      const db = await getDb();
      const sale = detail.sale;
      const cust = customers.find(x => x.id === sale.customer_id) ?? null;
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const total = Number(sale.total ?? 0);
      const amountPaid = Number(sale.amount_paid ?? total);
      const seller = getUserById(sale.seller_id) as any;
      setReceipts(buildReceipts({
        saleId: sale.id,
        saleNumber: sale.sale_number ?? String(sale.id),
        storeName: storeName ?? "Jesyon Magazen",
        createdAt: sale.created_at ?? new Date().toISOString(),
        cashier: { id: sale.seller_id ?? null, name: seller?.name ?? myId ?? "", role: sale.seller_role ?? "" },
        customer: cust ? { name: cust.name ?? "", idCard: cust.id_card_number ?? null, phone: cust.phone ?? null, email: cust.email ?? null } : null,
        customerId: cust?.id ?? sale.customer_id ?? null,
        items: detail.items.map((it: any) => ({
          name: it.product_name ?? "Atik",
          variant: it.variant ?? null,
          qty: Number(it.quantity ?? 0),
          unitPrice: Number(it.unit_price ?? 0),
          lineTotal: Number(it.line_total ?? 0),
        })),
        subtotal: Number(sale.subtotal ?? total),
        discount: Number(sale.discount ?? 0),
        total,
        paymentMethod: String(sale.payment_method ?? "cash"),
        amountPaid,
        amountDue: Number(sale.amount_due ?? 0),
        change: String(sale.payment_method ?? "cash") === "cash" ? Math.max(0, amountPaid - total) : 0,
        dueDate: credits.length ? (credits[0].due_date ?? null) : null,
      }));
      setDetail(null);
      setShowReceipt(true);
    } catch {}
  }

  const detailCustomer = detail ? customers.find(x => x.id === detail.sale.customer_id) ?? null : null;
  const detailDue = detail ? (detail.credit
    ? Math.max(0, Number(detail.credit.amount || 0) - (detail.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0))
    : Math.max(0, Number(detail.sale?.amount_due ?? 0))) : 0;
  const detailPaid = detail ? Math.max(0, Number(detail.sale?.total ?? 0) - (detail.credit ? detailDue : Math.max(0, Number(detail.sale?.amount_due ?? 0)))) : 0;

  async function payDetailDue(amount: number) {
    if (!detail?.credit) throw new Error("Pa gen dèt");
    const db = await getDb();
    const { payCreditDebt } = await import("../sales/creditPayments");
    const res = await payCreditDebt(db, detail.credit, detailCustomer, amount, myId);
    const pays = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [detail.credit.id, detail.credit.id]).catch(() => [])) as any[]) ?? [];
    const fresh = ((await db.getAllAsync("SELECT * FROM credits WHERE id = ?", [detail.credit.id]).catch(() => [])) as any[]) ?? [];
    setDetail({ ...detail, credit: fresh[0] ?? detail.credit, payments: pays });
    return res;
  }

  async function onPaySuccess(info: { amount: number; receipt: string; finalBalance: number }) {
    if (!detail) return;
    setShowPay(false);
    try {
      const { buildCreditPaymentReceipts } = await import("../receipts");
      const db = await getDb();
      const pays = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE receipt_number = ?", [info.receipt]).catch(() => [])) as any[]) ?? [];
      const payRow = pays[0];
      const pair = buildCreditPaymentReceipts({
        payId: payRow?.id ?? `pay-${Date.now()}`,
        receiptNumber: info.receipt,
        debtId: detail.credit?.id ?? detail.sale?.id,
        storeName: storeName ?? "Jesyon Magazen",
        createdAt: new Date().toISOString(),
        cashier: { id: myId, name: currentUser?.name ?? "", role: currentUser?.role ?? role },
        customer: detailCustomer ? { name: detailCustomer.name ?? "", idCard: detailCustomer.id_card_number ?? null, phone: detailCustomer.phone ?? null } : null,
        debtTotal: Number(detail.credit?.amount ?? detail.sale?.total ?? 0),
        previousBalance: Number(detail.credit?.amount ?? 0),
        amount: info.amount,
        finalBalance: info.finalBalance,
        paymentMethod: "cash",
        dueDate: detail.credit?.due_date ?? null,
      });
      try {
        for (const r of [pair.customer, pair.store]) {
          await db.runAsync(
            "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [r.id, storeId, detail.sale?.id ?? null, r.copyType, r.receiptNumber, detail.sale?.sale_number ?? null, myId, currentUser?.name ?? "", currentUser?.role ?? role, JSON.stringify(r), new Date().toISOString()]
          );
        }
      } catch {}
      // Stage the receipt; it presents from an effect once the flow window
      // has fully unmounted (never stacked mid-dismissal).
      setPendingReceipt(pair);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resi echwe");
    }
  }

  useEffect(() => {
    if (!showPay && pendingReceipt) {
      const t = setTimeout(() => {
        setReceipts(pendingReceipt);
        setPayReceiptLocked(true);
        setShowReceipt(true);
        setPendingReceipt(null);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [showPay, pendingReceipt]);

  if (view.name === "sale" && detail) {
    return (
      <>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {!showPay ? (
        <View style={{ padding: 12, backgroundColor: "#000", flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: "#262626" }}>
          <Pressable onPress={() => { setDetail(null); setShowPay(false); setPendingReceipt(null); setView({ name: "hub" }); }} style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={24} color={topIconBtn.icon} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>
            {`${fmtG(Number(detail.sale?.total ?? 0))}`}
          </Text>
          <View style={{ width: 90 }} />
        </View>
        ) : null}
        {showPay ? (
          <View style={{ flex: 1, padding: padH }}>
            <CreditPayFlow
              inline
              visible={showPay}
              due={detailDue}
              onClose={() => setShowPay(false)}
              onPay={payDetailDue}
              onSuccess={onPaySuccess}
            />
          </View>
        ) : (
        <ScrollView ref={detailScroll} style={{ flex: 1, backgroundColor: "#000" }} contentContainerStyle={{ padding: padH, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <TxnDetailBody
            sale={detail.sale}
            items={detail.items}
            customer={detailCustomer}
            onNewReceipt={reprintSale}
            dueBalance={detailDue}
            totalPaid={detailPaid}
            payments={detail.payments ?? []}
            onPayPress={detail.credit && detailDue > 0 ? () => setShowPay(true) : undefined}
          />
        </ScrollView>
        )}
      </View>
      <ReceiptModal
        visible={showReceipt}
        receipts={receipts}
        onClose={() => { setShowReceipt(false); setReceipts(null); setPayReceiptLocked(false); }}
        staging={{ storeId, cashierId: currentUser?.id ?? null, customerId: detailCustomer?.id ?? null }}
        locked={payReceiptLocked}
      />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <SectionList
        sections={grouped}
        keyExtractor={s => s.id}
        stickySectionHeadersEnabled
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: "#000" }}
        contentContainerStyle={{ padding: padH, paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            <View style={{ marginTop: 4 }}>
              <View style={{ height: 8 }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16, height: 52 }}>
                <Ionicons name="search" size={20} color="#fff" />
                <TextInput value={q} onChangeText={setQ} placeholder="Chèche resi, kliyan…" placeholderTextColor="#8e8e93" style={{ flex: 1, fontSize: 16, color: "#fff" }} />
                {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
              </View>
              <Pressable
                onPress={() => { setDraftMethods(methods ?? []); setDraftStates(krediStates); setDraftAges(krediAges); setFilterView("main"); setShowFilters(true); }}
                style={{
                  width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
                  backgroundColor: (methods && methods.length) || krediStates.length || krediAges.length ? "#fff" : "#000",
                  borderWidth: 1, borderColor: (methods && methods.length) || krediStates.length || krediAges.length ? "#fff" : "#3a3a3c",
                }}
              >
                <Ionicons name="filter" size={20} color={(methods && methods.length) || krediStates.length || krediAges.length ? "#000" : "#fff"} />
              </Pressable>
            </View>
            {((methods && methods.length) || krediStates.length || krediAges.length) ? (
              <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 6 }}>
                Filtre: {[
                  ...(methods ?? []).map(m => m === "cash" ? "Cash" : m === "moncash" ? "MonCash" : "NatCash"),
                  ...(krediStates.length || krediAges.length ? ["Kredi"] : []),
                ].join(" • ")}
              </Text>
            ) : null}
            <View style={{ height: 20 }} />
          </>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: "#000", paddingVertical: 8 }}>
            <Text style={{ fontSize: 12, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item: s }) => {
          const c = customers.find(x => x.id === s.customer_id);
          const label = PAYMENT_LABELS[String(s.payment_method ?? "cash")] ?? String(s.payment_method ?? "");
          return (
            <Pressable
              key={s.id}
              onPress={() => openSale(s)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 14, padding: 12, marginBottom: 10 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={20} color="#000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }} numberOfLines={1}>{fmtG(Number(s.total ?? 0))} · {label}</Text>
                <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>
                  {String(s.sale_number ?? s.id)} · {c?.name ?? "San kliyan"} · {shortDate(s.created_at)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#8e8e93" />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 24, alignItems: "center" }}><Text style={{ color: palette.muted2, fontSize: 13 }}>Pa gen vant.</Text></View>
        }
      />
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFilters(false)} />
          <View style={{ backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32, maxHeight: "85%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            {filterView === "kredi" ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <Pressable onPress={() => setFilterView("main")} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="arrow-back" size={22} color="#fff" />
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => { setDraftMethods([]); setDraftStates([]); setDraftAges([]); setMethods(null); setKrediStates([]); setKrediAges([]); }}
                      style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                    >
                      <Text style={{ fontWeight: "700", fontSize: 14, color: (draftMethods.length || draftStates.length || draftAges.length) ? "#fff" : "#6e6e73" }}>Clear All</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setMethods(draftMethods.length ? draftMethods : null); setKrediStates(draftStates); setKrediAges(draftAges); setShowFilters(false); }}
                      style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                    >
                      <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff", marginBottom: 12 }}>Kredi</Text>
                <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 }}>ETA PEMAN</Text>
                {KREDI_STATES.map(o => {
                  const checked = draftStates.includes(o.key);
                  return (
                    <Pressable
                      key={o.key}
                      onPress={() => setDraftStates(prev => prev.includes(o.key) ? prev.filter(x => x !== o.key) : [...prev, o.key])}
                      style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                        {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                      </View>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{o.label}</Text>
                    </Pressable>
                  );
                })}
                <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.8, marginTop: 8, marginBottom: 8 }}>LAJ KREDI</Text>
                {KREDI_AGES.map(o => {
                  const checked = draftAges.includes(o.key);
                  return (
                    <Pressable
                      key={o.key}
                      onPress={() => setDraftAges(prev => prev.includes(o.key) ? prev.filter(x => x !== o.key) : [...prev, o.key])}
                      style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                        {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                      </View>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>Filters</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => { setDraftMethods([]); setDraftStates([]); setDraftAges([]); setMethods(null); setKrediStates([]); setKrediAges([]); }}
                  style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: (draftMethods.length || draftStates.length || draftAges.length) ? "#fff" : "#6e6e73" }}>Clear All</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setMethods(draftMethods.length ? draftMethods : null); setKrediStates(draftStates); setKrediAges(draftAges); setShowFilters(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {(["cash", "moncash", "natcash"] as const).map(m => {
              const checked = draftMethods.includes(m);
              const label = m === "cash" ? "Cash" : m === "moncash" ? "Moncash" : "NatCash";
              return (
                <Pressable
                  key={m}
                  onPress={() => setDraftMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setFilterView("kredi")}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: draftStates.length || draftAges.length ? "#fff" : "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>Kredi</Text>
                {draftStates.length || draftAges.length ? (
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                    {draftStates.length ? `${draftStates.length} eta` : ""}{draftStates.length && draftAges.length ? " • " : ""}{draftAges.length ? `${draftAges.length} laj` : ""}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
            </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
      <ReceiptModal
        visible={showReceipt}
        receipts={receipts}
        onClose={() => { setShowReceipt(false); setReceipts(null); setPayReceiptLocked(false); }}
        staging={{ storeId, cashierId: currentUser?.id ?? null, customerId: detailCustomer?.id ?? null }}
        locked={payReceiptLocked}
      />
    </View>
  );
}
