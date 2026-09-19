import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { getDb } from "../db";
import { useResponsive, sheetBox } from "../responsive";
import { CustomersPhone } from "./CustomersPhone";
import { CustomersTablet } from "./CustomersTablet";
import {
  DetailHeaderContent,
  GeneralInfoView,
  CreditLimitViewCard,
  ActiveDebtsCard,
  PurchaseHistoryCard,
  ModificationHistoryCard,
} from "./CustomersShared";

export default function CustomersScreen({ role = "cashier", currentUser }: { role?: string; currentUser?: any }) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [customerHistory, setCustomerHistory] = useState<any[]>([]);
  const [pastCredits, setPastCredits] = useState<any[]>([]);
  const [pastSales, setPastSales] = useState<any[]>([]);
  const [showPastCredits, setShowPastCredits] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showDebtOnly, setShowDebtOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
  const [editPayload, setEditPayload] = useState({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);

  const isCashier = role === "cashier";
  const isManagerPlus = ["owner", "admin", "manager"].includes(role || "cashier");
  const canManageCustomers = !isCashier;
  const { width, isTablet, isLandscape, padH, fabRight } = useResponsive();
  // Master-detail needs landscape width; portrait tablets use phone layout.
  const showTablet = isTablet && isLandscape;

  async function load() {
    try {
    const db = await getDb();
    const allCustomersRaw = (await db.getAllAsync("SELECT * FROM customers")) as any[];
    const allCustomers = Array.from(new Map(allCustomersRaw.map((c: any) => [c.id, c] as const)).values());
    const allDebts = (await db.getAllAsync("SELECT * FROM credits WHERE balance > 0")) as any[];
    setCustomers(allCustomers);
    setDebts(allDebts);
    if (selectedCustomerId) {
      const history = (await db.getAllAsync("SELECT * FROM customer_history WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10", [selectedCustomerId])) as any[];
      setCustomerHistory(history);
    }
    } catch (e) {
      console.log("[Customers load] failed:", e);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedCustomerId) {
      setPastCredits([]);
      setPastSales([]);
      setShowPastCredits(false);
      return;
    }
    (async () => {
      try {
      const db = await getDb();
      const history = (await db.getAllAsync("SELECT * FROM customer_history WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10", [selectedCustomerId])) as any[];
      setCustomerHistory(history);
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
      setShowPastCredits(false);
      } catch (e) {
        console.log("[Customers history] failed:", e);
      }
    })();
  }, [selectedCustomerId]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) ?? null;

  useEffect(() => {
    if (selectedCustomer) {
      setEditPayload({
        name: selectedCustomer.name ?? "",
        id_card_number: selectedCustomer.id_card_number ?? "",
        phone: selectedCustomer.phone ?? "",
        address: selectedCustomer.address ?? "",
        credit_limit: selectedCustomer.credit_limit == null ? "" : String(selectedCustomer.credit_limit),
      });
      setIsEditingCustomer(false);
    } else {
      setIsEditingCustomer(false);
    }
  }, [selectedCustomer]);

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

  async function handleAddCustomer() {
    if (isCashier) return Alert.alert("Pa gen dwa", "Kesye ka sèlman li lis kliyan yo. Li pa ka kreye nouvo klient.");
    if (!newCustomer.name.trim()) return Alert.alert("Nom obligatwa");
    if (!newCustomer.id_card_number.trim()) return Alert.alert("ID obligatwa", "Nimewo kat idantite obligatwa");
    const db = await getDb();
    const id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const parsedLimit = newCustomer.credit_limit.trim() === "" ? null : Number(newCustomer.credit_limit);
    if (newCustomer.credit_limit.trim() !== "" && (parsedLimit === null || !Number.isFinite(parsedLimit) || parsedLimit < 0)) {
      return Alert.alert("Limit pa valab");
    }
    try {
    const record = {
      id,
      store_id: "demo-store-id",
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim() || null,
      address: newCustomer.address.trim() || null,
      id_card_number: newCustomer.id_card_number.trim(),
      total_debt: 0,
      credit_limit: isManagerPlus ? (parsedLimit ?? null) : null,
      credit_limit_source: isManagerPlus && parsedLimit !== null ? "manual" : null,
      is_high_risk: false,
      open_debt_count: 0,
      created_at: new Date().toISOString(),
    };
    await db.runAsync(
      "INSERT INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [record.id, record.store_id, record.name, record.phone, record.address, record.id_card_number, record.total_debt, record.credit_limit, record.credit_limit_source, record.is_high_risk ? 1 : 0, record.open_debt_count]
    );
    await logEdit(record.id, "created", "customer", null, `${record.name} / ${record.id_card_number}${record.address ? ` / ${record.address}` : ""}`);
    setCustomers(prev => {
      if (prev.some(c => c.id === record.id)) return prev;
      return [record, ...prev];
    });
    setShowAddCustomer(false);
    setNewCustomer({ name: "", id_card_number: "", phone: "", address: "", credit_limit: "" });
    setSelectedCustomerId(record.id);
    Alert.alert("Kliyan ajoute", `${record.name} anrejistre. ${record.phone ? `Telefòn: ${record.phone}` : "Pa gen nimewo telefòn"}${record.address ? ` · Adrès: ${record.address}` : ""}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    }
  }

  async function handleSaveCustomer() {
    if (!selectedCustomer) return;
    if (isCashier) return Alert.alert("Pa gen dwa", "Kesye ka sèlman li dosye kliyan yo. Li pa ka modifye.");
    const nextName = editPayload.name.trim();
    const nextIdCard = editPayload.id_card_number.trim();
    const nextPhone = editPayload.phone.trim();
    const nextAddress = editPayload.address.trim();
    const nextLimit = editPayload.credit_limit.trim() === "" ? null : Number(editPayload.credit_limit);
    if (!nextName) return Alert.alert("Nom obligatwa");
    if (!nextIdCard) return Alert.alert("ID obligatwa");
    if (editPayload.credit_limit.trim() !== "" && (nextLimit === null || !Number.isFinite(nextLimit) || nextLimit < 0)) {
      return Alert.alert("Limit pa valab");
    }
    try {
    const db = await getDb();
    const oldLimit = selectedCustomer.credit_limit == null ? null : Number(selectedCustomer.credit_limit);
    if (editPayload.credit_limit.trim() !== "" || selectedCustomer.credit_limit != null) {
      if (!isManagerPlus && (nextLimit !== oldLimit)) {
        return Alert.alert("Pa gen dwa", "Se sèlman Manager ak pi wo ka modifye limit kredi.");
      }
    }
    await db.runAsync(
      "UPDATE customers SET name = ?, id_card_number = ?, phone = ?, address = ?, credit_limit = ?, credit_limit_source = ? WHERE id = ?",
      [nextName, nextIdCard, nextPhone || null, nextAddress || null, nextLimit, nextLimit === null ? null : (selectedCustomer.credit_limit_source ?? "manual"), selectedCustomer.id]
    );
    const fieldUpdates = [
      ["name", selectedCustomer.name, nextName],
      ["id_card_number", selectedCustomer.id_card_number, nextIdCard],
      ["phone", selectedCustomer.phone, nextPhone || null],
      ["address", selectedCustomer.address, nextAddress || null],
      ["credit_limit", selectedCustomer.credit_limit, nextLimit],
    ].filter(([, oldValue, newValue]) => String(oldValue ?? "") !== String(newValue ?? ""));
    for (const [fieldName, oldValue, newValue] of fieldUpdates) {
      await logEdit(selectedCustomer.id, "updated", fieldName, oldValue, newValue);
    }
    setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, name: nextName, id_card_number: nextIdCard, phone: nextPhone || null, address: nextAddress || null, credit_limit: nextLimit } : c));
    setSelectedCustomerId(selectedCustomer.id);
    Alert.alert("Kliyan mete ajou", "Chanjman yo anrejistre nan istwa kliyan an.");
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete kliyan ajou echwe");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#F8F9FA", alignItems: showTablet ? "center" : undefined }}>
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
          customerHistory={customerHistory}
          pastCredits={pastCredits}
          pastSales={pastSales}
          showPastCredits={showPastCredits}
          setShowPastCredits={setShowPastCredits}
          canManageCustomers={canManageCustomers}
          isManagerPlus={isManagerPlus}
          setIsEditingCustomer={setIsEditingCustomer}
          onAdd={() => setShowAddCustomer(true)}
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
          padH={padH}
          width={width}
          isTablet={isTablet}
        />
      )}

      {canManageCustomers && (
        <View style={{ position: "absolute", bottom: 20, right: fabRight }}>
          <Pressable onPress={() => setShowAddCustomer(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0F172A", borderWidth: 1, borderColor: "#3D3D40", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 }}>
            <Text style={{ fontSize: 16, color: "#C8A24A", fontWeight: "600", marginTop: -1 }}>+</Text>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 0.4 }}>NOUVO KLIYAN</Text>
          </Pressable>
        </View>
      )}

      {selectedCustomer && (
        <Modal visible={!!selectedCustomer && (!showTablet || isEditingCustomer)} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.44)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#F8FAFC", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%", overflow: "hidden" }}>
              {/* Sheet header */}
              <View style={{ backgroundColor: "white", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: "#F1F5F9", alignItems: "center" }}>
                <View style={{ width: 36, height: 4, backgroundColor: "#E2E8F0", borderRadius: 2, marginBottom: 12 }} />
                <DetailHeaderContent customer={selectedCustomer} debts={debts} />
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 24 }}>
                {/* General info — VIEW first, EDIT only on request */}
                {!isEditingCustomer ? (
                  <>
                    <GeneralInfoView customer={selectedCustomer} canManageCustomers={canManageCustomers} onEdit={() => setIsEditingCustomer(true)} />

                    <CreditLimitViewCard customer={selectedCustomer} isManagerPlus={isManagerPlus} canManageCustomers={canManageCustomers} />
                  </>
                ) : (
                  <>
                    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A", letterSpacing: -0.1 }}>Modifye enfòmasyon</Text>
                        <Pressable onPress={() => { setIsEditingCustomer(false); setEditPayload({ name: selectedCustomer.name ?? "", id_card_number: selectedCustomer.id_card_number ?? "", phone: selectedCustomer.phone ?? "", address: selectedCustomer.address ?? "", credit_limit: selectedCustomer.credit_limit == null ? "" : String(selectedCustomer.credit_limit) }); }} style={{ backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ fontSize: 11, fontWeight: "600", color: "#475569" }}>Anile edisyon</Text></Pressable>
                      </View>
                      <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Chanje sèlman sa ou vle — rès ap konsève</Text>

                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#334155", marginTop: 12 }}>Non konplè *</Text>
                      <TextInput value={editPayload.name} onChangeText={value => setEditPayload(p => ({ ...p, name: value }))} placeholder="Non kliyan" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: editPayload.name ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#0F172A", backgroundColor: "white", fontWeight: "500" }} />

                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#334155", marginTop: 10 }}>Kat idantite (NIF/CIN) *</Text>
                      <TextInput value={editPayload.id_card_number} onChangeText={value => setEditPayload(p => ({ ...p, id_card_number: value }))} placeholder="—" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: editPayload.id_card_number ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />

                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#334155", marginTop: 10 }}>Telefòn</Text>
                      <TextInput value={editPayload.phone} onChangeText={value => setEditPayload(p => ({ ...p, phone: value }))} keyboardType="phone-pad" placeholder="+509 —" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: editPayload.phone ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />

                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#334155", marginTop: 10 }}>Adrès</Text>
                      <TextInput value={editPayload.address} onChangeText={value => setEditPayload(p => ({ ...p, address: value }))} placeholder="Eg. Delmas 33, Pétion-Ville" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: editPayload.address ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />
                    </View>

                    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: isManagerPlus ? "#E9D5FF" : "#F1F5F9", padding: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A" }}>Limit kredi</Text>
                        {!isManagerPlus && <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "600", color: "#94A3B8" }}>Manager+</Text></View>}
                      </View>
                      <TextInput
                        editable={isManagerPlus}
                        value={editPayload.credit_limit}
                        onChangeText={value => setEditPayload(p => ({ ...p, credit_limit: value }))}
                        keyboardType="numeric"
                        placeholder={selectedCustomer.credit_limit == null ? "San limit" : String(selectedCustomer.credit_limit)}
                        placeholderTextColor="#94A3B8"
                        style={{ borderWidth: 1, borderColor: isManagerPlus ? (editPayload.credit_limit ? "#7C3AED" : "#E5E7EB") : "#F1F5F9", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#0F172A", backgroundColor: isManagerPlus ? "white" : "#F8FAFC", fontWeight: "600" }}
                      />
                      <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>{isManagerPlus ? "Kite vid pou san limit" : "Kesye pa ka modifye limit"}</Text>
                    </View>
                  </>
                )}

                {/* Debt details — neat cards */}
                <ActiveDebtsCard customer={selectedCustomer} debts={debts} />

                {/* Past purchases — separate Kredi vs Kach/MonCash/NatCash, strictly this client only — deduped */}
                <PurchaseHistoryCard customer={selectedCustomer} pastCredits={pastCredits} pastSales={pastSales} showPastCredits={showPastCredits} onToggle={() => setShowPastCredits(v => !v)} />

                {/* History — timeline */}
                <ModificationHistoryCard history={customerHistory} />
              </ScrollView>

              {/* Footer — view-first, edit only on request */}
              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: "white", borderTopWidth: 1, borderColor: "#F1F5F9" }}>
                {!isEditingCustomer ? (
                  <Pressable onPress={() => setSelectedCustomerId(null)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#0F172A", borderRadius: 12, alignItems: "center", shadowColor: "#0F172A", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}><Text style={{ fontWeight: "600", color: "white", fontSize: 14 }}>Fèmen</Text></Pressable>
                ) : (
                  <>
                    <Pressable onPress={() => { setIsEditingCustomer(false); if (selectedCustomer) setEditPayload({ name: selectedCustomer.name ?? "", id_card_number: selectedCustomer.id_card_number ?? "", phone: selectedCustomer.phone ?? "", address: selectedCustomer.address ?? "", credit_limit: selectedCustomer.credit_limit == null ? "" : String(selectedCustomer.credit_limit) }); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#F1F5F9", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" }}><Text style={{ fontWeight: "600", color: "#334155", fontSize: 14 }}>Anile</Text></Pressable>
                    <Pressable onPress={async () => { await handleSaveCustomer(); setIsEditingCustomer(false); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#0F172A", borderRadius: 12, alignItems: "center", shadowColor: "#0F172A", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}><Text style={{ color: "white", fontWeight: "700", fontSize: 14 }}>Anrejistre</Text></Pressable>
                  </>
                )}
              </View>
            </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      <Modal visible={showAddCustomer} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.44)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
          <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#F8FAFC", borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden", maxHeight: "88%" }}>
            <View style={{ backgroundColor: "white", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: "#F1F5F9", alignItems: "center" }}>
              <View style={{ width: 36, height: 4, backgroundColor: "#E2E8F0", borderRadius: 2, marginBottom: 12 }} />
              <Text style={{ fontWeight: "700", fontSize: 17, color: "#0F172A", letterSpacing: -0.3 }}>Nouvo kliyan</Text>
              <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 3, textAlign: "center" }}>{canManageCustomers ? "Kreye dosye kliyan — verifye NIF/CIN" : ""}</Text>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A" }}>Non konplè *</Text>
                <TextInput value={newCustomer.name} onChangeText={value => setNewCustomer(p => ({ ...p, name: value }))} placeholder="Eg. Jean Pierre" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: newCustomer.name ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#0F172A", backgroundColor: "white", fontWeight: "500" }} />

                <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A", marginTop: 12 }}>NIF / CIN *</Text>
                <TextInput value={newCustomer.id_card_number} onChangeText={value => setNewCustomer(p => ({ ...p, id_card_number: value }))} placeholder="—" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: newCustomer.id_card_number ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />

                <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A", marginTop: 12 }}>Telefòn</Text>
                <TextInput value={newCustomer.phone} onChangeText={value => setNewCustomer(p => ({ ...p, phone: value }))} keyboardType="phone-pad" placeholder="+509 —" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: newCustomer.phone ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />

                <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A", marginTop: 12 }}>Adrès</Text>
                <TextInput value={newCustomer.address} onChangeText={value => setNewCustomer(p => ({ ...p, address: value }))} placeholder="Eg. Delmas 33, Pétion-Ville" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: newCustomer.address ? "#0F172A" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#0F172A", backgroundColor: "white" }} />

                {isManagerPlus && (
                  <>
                    <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A", marginTop: 12 }}>Limit kredi <Text style={{ fontWeight: "400", color: "#94A3B8" }}>(opsyonèl)</Text></Text>
                    <TextInput value={newCustomer.credit_limit} onChangeText={value => setNewCustomer(p => ({ ...p, credit_limit: value }))} keyboardType="numeric" placeholder="San limit" placeholderTextColor="#94A3B8" style={{ borderWidth: 1, borderColor: newCustomer.credit_limit ? "#7C3AED" : "#E5E7EB", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, fontWeight: "600", color: "#0F172A", backgroundColor: "white" }} />
                    <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>Kite vid pou san limit</Text>
                  </>
                )}
              </View>
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: "white", borderTopWidth: 1, borderColor: "#F1F5F9" }}>
              <Pressable onPress={() => setShowAddCustomer(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#F1F5F9", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#F1F5F9" }}><Text style={{ fontWeight: "600", color: "#334155", fontSize: 14 }}>Anile</Text></Pressable>
              {canManageCustomers && (
                <Pressable onPress={handleAddCustomer} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#0F172A", borderRadius: 12, alignItems: "center", shadowColor: "#0F172A", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}><Text style={{ color: "white", fontWeight: "700", fontSize: 14 }}>Kreye</Text></Pressable>
              )}
            </View>
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
