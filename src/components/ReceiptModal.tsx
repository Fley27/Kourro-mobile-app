import React from "react";
import { Modal, View, Text, Pressable, ScrollView, Share, Alert, Linking, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { fmtG, fmt, monoStyle } from "../format";
import { palette, radius, fonts } from "../theme";
import { buildReceiptHtml, receiptToText, type ReceiptData, type ReceiptCustomer } from "../receipts";
import { getDb } from "../db";
// STAGING-PICKUP: single gated import — delete this + the STAGING block below to remove.
import { usePickupEnabled, PickupSheet, useOnline } from "../pickup-staging";
import { NewCustomerView, CustomerProfileBody, EditCustomerView, TxnDetailBody } from "../screens/cartViews";
import { buildReceipts } from "../receipts";
import { CustomerPicker } from "./CustomerPicker";
import { EMPTY_CUSTOMER_FORM, fullNameOf, type CustomerFormData } from "./CustomerForm";
import { insertCustomerRecord } from "../sales/customers";

function statusLine(r: ReceiptData): { label: string; tint: string } | null {
  if (r.paymentMethod === "credit") return { label: `Kredi • Balance ${fmtG(r.amountDue)}`, tint: palette.danger };
  if (Number(r.amountDue ?? 0) > 0) return { label: `Balance ${fmtG(r.amountDue)}`, tint: palette.warning };
  return null;
}

function Row({ label, value, mono, tint }: { label: string; value: string; mono?: boolean; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: palette.muted }}>{label}</Text>
      <Text numberOfLines={1} style={[mono ? monoStyle : undefined, { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 11, color: tint ?? palette.ink, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

function Pill({ icon, label, onPress, tone }: {  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone: "ink" | "paper" | "danger";
}) {
  const bg = tone === "ink" ? palette.ink2 : "transparent";
  const fg = tone === "ink" ? "#fff" : tone === "danger" ? palette.danger : palette.ink;
  const border = tone === "danger" ? palette.dangerBd : tone === "paper" ? palette.hairline : "rgba(200,162,74,0.5)";
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: bg, borderRadius: radius.pill, paddingVertical: 17, paddingHorizontal: 18, borderWidth: tone === "ink" ? 0.5 : 1, borderColor: border }}>
      <Ionicons name={icon} size={19} color={fg} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: fg, letterSpacing: -0.2 }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export default function ReceiptModal({ visible, receipts, onClose, staging, locked }: {
  visible: boolean;
  receipts: { customer: ReceiptData; store: ReceiptData } | null;
  onClose: () => void;
  staging?: { storeId: string; cashierId?: string | null; customerId?: string | null };
  locked?: boolean;
}) {
  // STAGING-PICKUP: dormant when flag OFF. Delete block to remove.
  const stagingOn = usePickupEnabled(staging?.storeId ?? "demo-store-id");
  const online = useOnline();
  const [showPickup, setShowPickup] = React.useState(false);
  const [savedEmail, setSavedEmail] = React.useState<string | null>(null);

  const [altPair, setAltPair] = React.useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [txnView, setTxnView] = React.useState<{ sale: any; items: any[]; customer: any | null } | null>(null);
  const effReceipts = altPair ?? receipts;
  const r = effReceipts?.customer ?? null;
  const { height: winH } = useWindowDimensions();
  const pickerH = Math.round(winH * 5 / 6);
  const saleId = r?.saleId ?? "";
  const custId = r?.customerId ?? staging?.customerId ?? null;
  const [custOverride, setCustOverride] = React.useState<ReceiptCustomer | null>(null);
  const [overrideSaleId, setOverrideSaleId] = React.useState<string | null>(null);
  const [custUnlinked, setCustUnlinked] = React.useState(false);
  const customer = custUnlinked ? null : ((overrideSaleId === saleId ? custOverride : null) ?? r?.customer ?? null);
  const hasCustomer = !!customer;
  const isSale = (r?.kind ?? "sale") === "sale";
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [menuView, setMenuView] = React.useState<"main" | "add">("main");
  const [custDetail, setCustDetail] = React.useState<any | null>(null);
  const [showProfModal, setShowProfModal] = React.useState(false);
  const [profMode, setProfMode] = React.useState<"view" | "edit">("view");
  const [profNoteInput, setProfNoteInput] = React.useState("");
  const [profSavingNote, setProfSavingNote] = React.useState(false);
  const [formKey, setFormKey] = React.useState(0);
  const [formValid, setFormValid] = React.useState(false);
  const [savingCust, setSavingCust] = React.useState(false);
  const [menuCustomers, setMenuCustomers] = React.useState<any[]>([]);
  const [showCustPicker, setShowCustPicker] = React.useState(false);
  const [menuStats, setMenuStats] = React.useState({ visits: 0, spent: 0, lastVisit: null as string | null, firstVisit: null as string | null });
  const [menuNotes, setMenuNotes] = React.useState<any[]>([]);
  const [menuTxns, setMenuTxns] = React.useState<any[]>([]);
  const [profCustomer, setProfCustomer] = React.useState<any | null>(null);
  const [profStats, setProfStats] = React.useState({ visits: 0, spent: 0, lastVisit: null as string | null, firstVisit: null as string | null });
  const [profNotes, setProfNotes] = React.useState<any[]>([]);
  const [profTxns, setProfTxns] = React.useState<any[]>([]);
  const formRef = React.useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });

  // View-customer transactions: DB list + the current receipt's sale merged in
  // if absent (covers attach timing on any backend).
  const viewTxns = React.useMemo(() => {
    const list = [...menuTxns];
    if (isSale && custDetail?.id && saleId && !list.some((t: any) => String(t.id) === String(saleId))) {
      list.unshift({
        id: saleId,
        total: r?.total ?? 0,
        created_at: r?.createdAt ?? new Date().toISOString(),
        status: "completed",
        payment_method: r?.paymentMethod ?? "cash",
      });
    }
    return list;
  }, [menuTxns, isSale, custDetail, saleId, r]);

  React.useEffect(() => {
    setShowPickup(false);
    setSavedEmail(effReceipts?.customer?.customer?.email ?? null);
    resetCustomerMemory();
  }, [saleId]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetCustomerMemory() {
    setCustOverride(null);
    setOverrideSaleId(null);
    setCustUnlinked(false);
    setCustDetail(null);
    setMenuVisible(false);
    setMenuView("main");
    setShowCustPicker(false);
    setShowProfModal(false);
    setProfMode("view");
    setMenuCustomers([]);
    setMenuStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setMenuNotes([]);
    setMenuTxns([]);
    setProfCustomer(null);
    setProfStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setProfNotes([]);
    setProfTxns([]);
    formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false };
    setFormValid(false);
  }

  function handleClose() {
    setAltPair(null);
    setTxnView(null);
    resetCustomerMemory();
    onClose();
  }

  if (!visible || !receipts || !r) return null;
  const pair = (altPair ?? receipts) as { customer: ReceiptData; store: ReceiptData };
  const st = statusLine(r);

  async function printReceipt() {
    try {
      await Print.printAsync({ html: buildReceiptHtml(pair.customer) });
    } catch (e: any) {
      Alert.alert("Enpresyon", e?.message ?? "Enpresyon echwe");
    }
  }

  async function shareReceipt() {
    const client = pair.customer;
    const title = `Resi ${client.receiptNumber} - ${client.storeName}`;
    try {
      const file = await Print.printToFileAsync({ html: buildReceiptHtml(client), base64: false });
      if (!file.uri) throw new Error("no-file");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: "Pataje resi a (PDF)",
          UTI: "com.adobe.pdf",
        });
        return;
      }
      throw new Error("share-unavailable");
    } catch (e) {
      try {
        await Share.share({ title, message: receiptToText(client) });
      } catch {}
    }
  }

  async function emailReceipt(to: string, rr: ReceiptData) {
    const subject = `Resi ${rr.receiptNumber} - ${rr.storeName}`;
    const url = `mailto:${to.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(receiptToText(rr))}`;
    try {
      const can = await Linking.canOpenURL(url).catch(() => true);
      if (!can) { Alert.alert("Email", "Pa gen aplikasyon email sou aparèy sa a."); return; }
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert("Email", e?.message ?? "Voye email echwe");
    }
  }

  async function openMenu() {
    setMenuView("main");
    setCustDetail(null);
    setMenuStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setMenuNotes([]);
    setMenuTxns([]);
    formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false };
    setFormValid(false);
    setFormKey(k => k + 1);
    try {
      const db = await getDb();
      const all = (await db.getAllAsync("SELECT * FROM customers")) as any[];
      setMenuCustomers(Array.from(new Map(all.map((c: any) => [c.id, c] as const)).values()));
    } catch {}
    if (custId) {
      try {
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [custId])) as any[];
        if (rows?.length) setCustDetail(rows[0]);
        try {
          const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [custId]).catch(() => [])) as any[]) ?? [];
          const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
          const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
          setMenuStats({
            visits: done.length,
            spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
            lastVisit: dates.length ? dates[dates.length - 1] : null,
            firstVisit: dates.length ? dates[0] : null,
          });
          setMenuTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
          const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [custId]).catch(() => [])) as any[]) ?? [];
          setMenuNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
        } catch {}
      } catch {}
    }
    setMenuVisible(true);
  }

  async function openPickedProfile(c: any) {
    if (!c) return;
    setProfCustomer(c);
    setProfStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setProfNotes([]);
    setProfTxns([]);
    try {
      const db = await getDb();
      const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
      const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
      const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
      setProfStats({
        visits: done.length,
        spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
        lastVisit: dates.length ? dates[dates.length - 1] : null,
        firstVisit: dates.length ? dates[0] : null,
      });
      setProfTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
      const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
      setProfNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
    } catch {}
  }

  function closeCustPicker() {
    setShowCustPicker(false);
    setProfCustomer(null);
  }

  function getViewRecord() {
    return custDetail ?? { name: customer?.name ?? "Kliyan", phone: customer?.phone ?? null, email: customer?.email ?? null, id_card_number: customer?.idCard ?? null };
  }

  async function openTxnFromReceipt(sale: any, cust: any | null) {
    if (!sale) return;
    try {
      const db = await getDb();
      const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      setTxnView({ sale, items, customer: cust });
    } catch {
      setTxnView({ sale, items: [], customer: cust });
    }
  }

  async function printTxnReceipt() {
    if (!txnView) return;
    try {
      const db = await getDb();
      const sale = txnView.sale;
      const items = txnView.items.map((it: any) => ({
        name: it.product_name ?? "Atik",
        variant: it.variant ?? null,
        qty: Number(it.quantity ?? 0),
        unitPrice: Number(it.unit_price ?? 0),
        lineTotal: Number(it.line_total ?? 0),
      }));
      const total = Number(sale.total ?? 0);
      const amountPaid = Number(sale.amount_paid ?? total);
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const built = buildReceipts({
        saleId: sale.id,
        saleNumber: sale.sale_number ?? String(sale.id),
        storeName: r?.storeName ?? "",
        createdAt: sale.created_at ?? new Date().toISOString(),
        cashier: r?.cashier ?? { id: null, name: "", role: "" },
        customer: txnView.customer ? {
          name: txnView.customer.name ?? "",
          idCard: txnView.customer.id_card_number ?? null,
          phone: txnView.customer.phone ?? null,
          email: txnView.customer.email ?? null,
        } : null,
        customerId: txnView.customer?.id ?? sale.customer_id ?? null,
        items,
        subtotal: Number(sale.subtotal ?? total),
        discount: Number(sale.discount ?? 0),
        total,
        paymentMethod: String(sale.payment_method ?? "cash"),
        amountPaid,
        amountDue: Number(sale.amount_due ?? 0),
        change: String(sale.payment_method ?? "cash") === "cash" ? Math.max(0, amountPaid - total) : 0,
        dueDate: credits.length ? (credits[0].due_date ?? null) : null,
      });
      setAltPair(built);
      setTxnView(null);
      setShowCustPicker(false);
      setShowProfModal(false);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resi echwe");
    }
  }

  function closeProfModal() {
    setShowProfModal(false);
    setProfMode("view");
    setProfNoteInput("");
  }

  async function attachMenuCustomer(c: any) {    if (!c) return;
    try {
      const db = await getDb();
      try { await db.runAsync("UPDATE sales SET customer_id = ? WHERE id = ?", [c.id, saleId]); } catch {}
      const snapshot: ReceiptCustomer = {
        name: c.name ?? "",
        idCard: c.id_card_number ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
      };
      setCustOverride(snapshot);
      setOverrideSaleId(saleId);
      if (snapshot.email) setSavedEmail(snapshot.email);
      setCustDetail(c);
      if (!menuCustomers.some(x => x.id === c.id)) setMenuCustomers(prev => [...prev, c]);
      try {
        const rows = (await db.getAllAsync("SELECT * FROM receipts WHERE sale_id = ?", [saleId])) as any[];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.content ?? "{}");
            data.customer = snapshot;
            data.customerId = c.id;
            await db.runAsync("UPDATE receipts SET content = ? WHERE id = ?", [JSON.stringify(data), row.id]);
          } catch {}
        }
      } catch {}
      try {
        const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
        const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
        const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
        setMenuStats({
          visits: done.length,
          spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
          lastVisit: dates.length ? dates[dates.length - 1] : null,
          firstVisit: dates.length ? dates[0] : null,
        });
        setMenuTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
        const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
        setMenuNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
        // Keep the open picker profile live too — the just-linked sale is now its latest transaction.
        setProfStats({
          visits: done.length,
          spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
          lastVisit: dates.length ? dates[dates.length - 1] : null,
          firstVisit: dates.length ? dates[0] : null,
        });
        setProfTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
      } catch {}
    } catch {}
    setMenuView("main");
  }

  function openCustEdit() {
    const c = custDetail;
    if (!c) return;
    const parts = String(c.name ?? "").trim().split(/\s+/).filter(Boolean);
    formRef.current = {
      data: {
        ...EMPTY_CUSTOMER_FORM,
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        idDoc: c.id_card_number ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        marketingConsent: !!c.marketing_consent,
        country: c.country ?? "HT",
        department: c.department ?? "",
        commune: c.commune ?? "",
        line1: c.address_line1 ?? "",
        line2: c.address_line2 ?? "",
        birthDay: c.birth_day ?? "",
        birthMonth: c.birth_month ?? "",
        birthYear: c.birth_year ?? "",
      },
      valid: false,
    };
    setFormValid(false);
    setFormKey(k => k + 1);
    setProfMode("edit");
  }

  async function addProfNote() {
    const text = profNoteInput.trim();
    if (!text || !custDetail) return;
    if (menuNotes.length >= 2) return Alert.alert("Limit 2 nòt", "Yon kliyan pa ka gen plis pase 2 nòt.");
    setProfSavingNote(true);
    try {
      const db = await getDb();
      const { addCustomerNote } = await import("../sales/customers");
      const row = await addCustomerNote(db, staging?.storeId ?? "demo-store-id", custDetail.id, text, staging?.cashierId ?? null);
      setMenuNotes(prev => [row, ...prev]);
      setProfNoteInput("");
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute nòt echwe");
    } finally {
      setProfSavingNote(false);
    }
  }

  async function saveCustEdit() {
    const { data, valid } = formRef.current;
    if (!valid || !custDetail) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    setSavingCust(true);
    try {
      const db = await getDb();
      const { updateCustomerRecord } = await import("../sales/customers");
      await updateCustomerRecord(db, custDetail.id, data);
      const rows = (await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [custDetail.id])) as any[];
      if (rows?.length) {
        setCustDetail(rows[0]);
        setCustOverride({
          name: rows[0].name ?? "",
          idCard: rows[0].id_card_number ?? null,
          phone: rows[0].phone ?? null,
          email: rows[0].email ?? null,
        });
        setOverrideSaleId(saleId);
      }
      setProfMode("view");
      Alert.alert("Kliyan mete ajou ✓", fullNameOf(data));
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete ajou echwe");
    } finally {
      setSavingCust(false);
    }
  }

  function unlinkMenuCustomer() {
    Alert.alert("Retire kliyan?", `${custDetail?.name ?? "Kliyan"} ap retire nan vant sa a.`, [
      { text: "Anile", style: "cancel" },
      {
        text: "Retire",
        style: "destructive",
        onPress: async () => {
          try {
            const db = await getDb();
            try { await db.runAsync("UPDATE sales SET customer_id = ? WHERE id = ?", [null, saleId]); } catch {}
            try {
              const rows = (await db.getAllAsync("SELECT * FROM receipts WHERE sale_id = ?", [saleId])) as any[];
              for (const row of rows) {
                try {
                  const d = JSON.parse(row.content ?? "{}");
                  d.customer = null;
                  d.customerId = null;
                  await db.runAsync("UPDATE receipts SET content = ? WHERE id = ?", [JSON.stringify(d), row.id]);
                } catch {}
              }
            } catch {}
          } catch {}
          setCustOverride(null);
          setCustUnlinked(true);
          setCustDetail(null);
          closeProfModal();
        },
      },
    ]);
  }

  async function saveCustomer() {    const { data, valid } = formRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    const store = staging?.storeId ?? "demo-store-id";
    setSavingCust(true);
    try {
      const db = await getDb();
      // Same creation path as pre-sale add-customer.
      const fresh = await insertCustomerRecord(db, store, data);
      const id = fresh.id;
      const email = data.email.trim() || null;
      try { await db.runAsync("UPDATE sales SET customer_id = ? WHERE id = ?", [id, saleId]); } catch {}
      const snapshot: ReceiptCustomer = {
        name: fullNameOf(data),
        idCard: data.idDoc.trim() || null,
        phone: data.phone.trim() || null,
        email,
      };
      setCustOverride(snapshot);
      setOverrideSaleId(saleId);
      if (snapshot.email) setSavedEmail(snapshot.email);
      try {
        const rows = (await db.getAllAsync("SELECT * FROM receipts WHERE sale_id = ?", [saleId])) as any[];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.content ?? "{}");
            data.customer = snapshot;
            data.customerId = id;
            await db.runAsync("UPDATE receipts SET content = ? WHERE id = ?", [JSON.stringify(data), row.id]);
          } catch {}
        }
      } catch {}
      try {
        const rows = (await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [id])) as any[];
        if (rows?.length) setCustDetail(rows[0]);
        setMenuCustomers(prev => (prev.some(x => x.id === id) ? prev : [...prev, rows?.[0] ?? fresh]));
        try {
          const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [id]).catch(() => [])) as any[]) ?? [];
          const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
          const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
          setMenuStats({
            visits: done.length,
            spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
            lastVisit: dates.length ? dates[dates.length - 1] : null,
            firstVisit: dates.length ? dates[0] : null,
          });
          setMenuTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
        } catch {}
      } catch {}
      setMenuView("main");
      Alert.alert("Kliyan ajoute ✓", fullNameOf(formRef.current.data));
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    } finally {
      setSavingCust(false);
    }
  }

  async function paVleResi() {
    // Decline the receipt entirely: remove stored copies, close everything, back to sales.
    try {
      const db = await getDb();
      await db.runAsync("DELETE FROM receipts WHERE sale_id = ?", [saleId]);
    } catch {}
    setShowPickup(false);
    handleClose();
  }

  return (
    <Modal visible animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: "#16db65", paddingTop: 52 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 6 }}>
          {locked ? <View style={{ width: 38 }} /> : (
          <Pressable onPress={openMenu} accessibilityLabel="Plis opsyon" style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={palette.ink} />
          </Pressable>
          )}
          <Pressable onPress={handleClose} accessibilityLabel="Fèmen" style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 18, paddingBottom: 16, paddingTop: 10, gap: 18 }}>
          {/* Hero — paid amount, centered */}
          <View style={{ alignItems: "center", paddingVertical: 10 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: palette.muted2, letterSpacing: 1.2 }}>TOTAL</Text>
            <Text style={[monoStyle, { fontFamily: fonts.bold, fontSize: 44, color: palette.ink, letterSpacing: -1.5, marginTop: 4 }]}>{fmtG(r.total)}</Text>
            {st ? <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: st.tint, marginTop: 6 }}>{st.label}</Text> : null}
            {Number(r.change ?? 0) > 0 ? (
              <Text style={[monoStyle, { fontFamily: fonts.semibold, fontSize: 14, color: palette.blue, marginTop: 6 }]}>Remèt {fmtG(r.change)}</Text>
            ) : null}
            {Number(r.total ?? 0) !== Number(r.amountPaid ?? 0) ? (
              <Text style={[monoStyle, { fontFamily: fonts.semibold, fontSize: 12, color: palette.muted2, marginTop: 2 }]}>Peye {fmtG(r.amountPaid)}</Text>
            ) : null}
          </View>

          {/* Email setup states stay with the content; send action lives in the bottom bar */}
          {hasCustomer && savedEmail && !online ? (
            <Text style={{ fontSize: 11, color: palette.muted, textAlign: "center" }}>Offline — email indisponib</Text>
          ) : null}
        </ScrollView>

        {/* Bottom action bar — thumb reach, one hand, all centered */}
        <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34, gap: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, backgroundColor: "#16db65", alignItems: "stretch" }}>
          {/* STAGING-PICKUP: partial pickup option, right above the question. Delete block to remove. */}
          {isSale && stagingOn && staging?.storeId && !locked ? (
            <Pressable onPress={() => setShowPickup(true)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: palette.ink2, borderRadius: radius.pill, paddingVertical: 17, borderWidth: 0.5, borderColor: "rgba(47,125,91,0.4)" }}>
              <Ionicons name="cube-outline" size={19} color="#fff" />
              <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Partial pickup</Text>
            </Pressable>
          ) : null}
          {isSale && stagingOn && staging?.storeId ? (
            <PickupSheet visible={showPickup} saleId={r.saleId} storeId={staging.storeId} cashierId={staging.cashierId ?? null} storeName={r.storeName} cashierName={r.cashier.name} onClose={() => setShowPickup(false)} onSaved={handleClose} />
          ) : null}
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: palette.muted2, textAlign: "center", letterSpacing: 0.2 }}>
            Kijan ou vle resi a?
          </Text>
          {hasCustomer && savedEmail && online ? (
            <Pill icon="mail-outline" label={`Email • ${savedEmail}`} tone="ink" onPress={() => emailReceipt(savedEmail, { ...r, customer })} />
          ) : null}
          <Pill icon="print-outline" label="Print receipt" tone="paper" onPress={printReceipt} />
          <Pill icon="share-outline" label="Share" tone="paper" onPress={shareReceipt} />
          {isSale ? (
            <Pill icon="close-circle-outline" label="Pa vle resi" tone="danger" onPress={paVleResi} />
          ) : null}
        </View>

        {/* Options menu — customer actions (in-tree overlay: immune to Modal stacking) */}
        {menuVisible ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", zIndex: 50, elevation: 8 }}>
            <Pressable onPress={() => { setMenuVisible(false); setMenuView("main"); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(22,19,12,0.5)" }} />
            <View style={{ backgroundColor: "#16db65", borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34, gap: 12, maxHeight: "88%" }}>
              <View style={{ width: 36, height: 4, backgroundColor: palette.hairlineStrong, borderRadius: 2, alignSelf: "center", marginBottom: 2 }} />
              {menuView === "main" ? (
                <>
                  {hasCustomer ? (
                    <Pressable onPress={() => {
                      setMenuVisible(false); setMenuView("main"); setProfMode("view");
                      setShowProfModal(true);
                      // Fresh pull, never cache: sale by id -> customer id from it -> live data.
                      (async () => {
                        try {
                          const db = await getDb();
                          const srows = ((await db.getAllAsync("SELECT * FROM sales WHERE id = ?", [saleId]).catch(() => [])) as any[]) ?? [];
                          const cid = srows?.[0]?.customer_id ?? custId ?? null;
                          if (!cid) return;
                          const crows = ((await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [cid]).catch(() => [])) as any[]) ?? [];
                          if (!crows?.length) return;
                          const c = crows[0];
                          setCustDetail(c);
                          const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [cid]).catch(() => [])) as any[]) ?? [];
                          const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
                          const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
                          setMenuStats({
                            visits: done.length,
                            spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
                            lastVisit: dates.length ? dates[dates.length - 1] : null,
                            firstVisit: dates.length ? dates[0] : null,
                          });
                          setMenuTxns([...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 20));
                          const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [cid]).catch(() => [])) as any[]) ?? [];
                          setMenuNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
                        } catch {}
                      })();
                    }} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "transparent", borderRadius: 12, height: 60, paddingHorizontal: 4 }}>
                      <Ionicons name="person-outline" size={19} color={palette.ink} />
                      <Text style={{ fontWeight: "800", fontSize: 15, color: palette.ink }}>View customer</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => { setMenuVisible(false); setMenuView("main"); setShowCustPicker(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "transparent", borderRadius: 12, height: 60, paddingHorizontal: 4 }}>
                      <Ionicons name="person-add-outline" size={19} color={palette.ink} />
                      <Text style={{ fontWeight: "800", fontSize: 15, color: palette.ink }}>Add customer</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ fontWeight: "800", fontSize: 16, color: palette.ink, textAlign: "center" }}>Add customer</Text>
                  <View style={{ maxHeight: 380 }}>
                    <NewCustomerView
                      formKey={formKey}
                      onFormState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }}
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => setMenuView("main")} style={{ flex: 1, padding: 13, backgroundColor: palette.surfaceGrouped, borderRadius: radius.pill, alignItems: "center" }}>
                      <Text style={{ fontWeight: "700", color: palette.ink }}>Retounen</Text>
                    </Pressable>
                    <Pressable onPress={saveCustomer} disabled={!formValid || savingCust} style={{ flex: 2, padding: 13, backgroundColor: formValid ? palette.ink2 : "#E2E8F0", borderRadius: radius.pill, alignItems: "center", opacity: formValid && !savingCust ? 1 : 0.6 }}>
                      <Text style={{ fontWeight: "800", color: "#fff" }}>{savingCust ? "…" : "Anrejistre"}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        ) : null}
        {/* Standalone customers picker — dots menu closes first (no stacked modals) */}
        {showCustPicker ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", zIndex: 60, elevation: 9 }}>
            <Pressable onPress={closeCustPicker} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(22,19,12,0.5)" }} />
            <View style={{ backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, height: pickerH }}>
              {profCustomer ? (
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable onPress={() => setProfCustomer(null)} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="chevron-back" size={19} color="#16130c" />
                    </Pressable>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={() => { attachMenuCustomer(profCustomer); closeCustPicker(); }} style={{ paddingHorizontal: 18, height: 40, borderRadius: 20, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Add to sale</Text>
                    </Pressable>
                  </View>
                  <ScrollView style={{ flex: 1, marginTop: 6 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <CustomerProfileBody customer={profCustomer} stats={profStats} notes={profNotes} transactions={profTxns} onOpenTransaction={(s) => openTxnFromReceipt(s, profCustomer)} />
                  </ScrollView>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, alignSelf: "center", marginBottom: 10 }} />
                  <CustomerPicker
                    storeId={staging?.storeId ?? "demo-store-id"}
                    customers={menuCustomers}
                    onPick={openPickedProfile}
                    onBack={closeCustPicker}
                    onAdded={(fresh) => setMenuCustomers(prev => (prev.some(x => x.id === fresh.id) ? prev : [...prev, fresh]))}
                  />
                </View>
              )}
            </View>
          </View>
        ) : null}
        {/* Standalone full profile — dots menu closes first (no stacked modals) */}
        {showProfModal && (custDetail || customer) ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", zIndex: 70, elevation: 10 }}>
            <Pressable onPress={closeProfModal} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(22,19,12,0.5)" }} />
            <View style={{ backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, height: pickerH }}>
              {profMode === "view" ? (
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable onPress={closeProfModal} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#2E2A23", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={20} color="#fff" />
                    </Pressable>
                    <View style={{ flex: 1 }} />
                    {custDetail?.id ? (
                      <>
                        <Pressable onPress={openCustEdit} style={{ paddingHorizontal: 20, height: 40, borderRadius: 20, backgroundColor: "#2E2A23", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Edit</Text>
                        </Pressable>
                        <Pressable onPress={unlinkMenuCustomer} style={{ paddingHorizontal: 20, height: 40, borderRadius: 20, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>Remove</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                  <ScrollView style={{ flex: 1, marginTop: 6 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <CustomerProfileBody customer={getViewRecord()} stats={menuStats} notes={menuNotes} transactions={viewTxns} onOpenTransaction={(s) => openTxnFromReceipt(s, getViewRecord())} />
                  </ScrollView>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable onPress={() => setProfMode("view")} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="chevron-back" size={19} color={palette.ink} />
                    </Pressable>
                    <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 16, color: palette.ink }} numberOfLines={1}>Edit Customer</Text>
                    <Pressable onPress={saveCustEdit} disabled={!formValid || savingCust} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: formValid ? "#16130c" : "#E2E8F0", alignItems: "center", justifyContent: "center", opacity: formValid && !savingCust ? 1 : 0.6 }}>
                      <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>Save</Text>
                    </Pressable>
                  </View>
                  <ScrollView style={{ flex: 1, marginTop: 6 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <EditCustomerView
                      formKey={formKey}
                      initial={formRef.current.data}
                      onFormState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }}
                      notes={menuNotes}
                      noteInput={profNoteInput}
                      onNoteInput={setProfNoteInput}
                      savingNote={profSavingNote}
                      onAddNote={addProfNote}
                      notesLimit={2}
                    />
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        ) : null}
        {/* Standalone txn detail — in-tree overlay (no stacked modals) */}
        {txnView ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", zIndex: 80, elevation: 10 }}>
            <Pressable onPress={() => setTxnView(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(22,19,12,0.5)" }} />
            <View style={{ backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, height: pickerH }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pressable onPress={() => setTxnView(null)} style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-back" size={19} color="#16130c" />
                </Pressable>
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#16130c" }} numberOfLines={1}>
                  {`${fmtG(Number(txnView.sale?.total ?? 0))} Purchase`}
                </Text>
                <View style={{ width: 34 }} />
              </View>
              <ScrollView style={{ flex: 1, marginTop: 6 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <TxnDetailBody sale={txnView.sale} items={txnView.items} customer={txnView.customer} onNewReceipt={printTxnReceipt} />
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
