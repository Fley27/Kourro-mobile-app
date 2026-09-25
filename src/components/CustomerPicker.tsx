// Shared customer picker screen — THE general customer entry used by the
// cart sheet, tablet panel and pay modal. One screen, one edit applies to all.
// Owns search + recent + new-customer form + save; host only selects.
import React, { useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette } from "../theme";
import { getDb } from "../db";
import CustomerForm, { EMPTY_CUSTOMER_FORM, type CustomerFormData } from "./CustomerForm";
import { insertCustomerRecord } from "../sales/customers";

export function CustomerPicker({ storeId, customers, compact, onPick, onBack, onAdded }: {
  storeId: string;
  customers: any[];
  compact?: boolean;
  onPick: (c: any) => void;
  onBack: () => void;
  onAdded?: (c: any) => void;
}) {
  const btn = compact ? 30 : 34;
  const [view, setView] = useState<"list" | "new">("list");
  const [q, setQ] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [formValid, setFormValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });

  const recent = useMemo(() => [...customers].reverse().slice(0, 10), [customers]);
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return recent;
    return customers.filter(c => {
      const name = (c.name ?? "").toLowerCase();
      return name.includes(needle) || (c.id_card_number ?? "").toLowerCase().includes(needle) || (c.phone ?? "").toLowerCase().includes(needle);
    });
  }, [customers, recent, q]);

  async function save() {
    const { data, valid } = formRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    setSaving(true);
    try {
      const db = await getDb();
      const fresh = await insertCustomerRecord(db, storeId, data);
      onAdded?.(fresh);
      onPick(fresh);
      Alert.alert("Kliyan ajoute ✓", fresh.name);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute kliyan echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => (view === "new" ? setView("list") : onBack())} style={{ width: btn, height: btn, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={compact ? 17 : 19} color="#16130c" />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: compact ? 15 : 18, color: "#16130c" }} numberOfLines={1}>
          {view === "new" ? "New Customer" : "Kliyan"}
        </Text>
        {view === "list" ? (
          <Pressable
            onPress={() => { formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false }; setFormValid(false); setFormKey(k => k + 1); setView("new"); }}
            accessibilityLabel="New customer"
            style={{ width: btn, height: btn, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="add" size={compact ? 17 : 19} color="#fff" />
          </Pressable>
        ) : (
          <Pressable onPress={save} disabled={!formValid || saving} style={{ paddingHorizontal: 16, height: btn, borderRadius: 12, backgroundColor: formValid ? "#16130c" : "#E2E8F0", alignItems: "center", justifyContent: "center", opacity: formValid && !saving ? 1 : 0.6 }}>
            <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>Save</Text>
          </Pressable>
        )}
      </View>
      {view === "list" ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, height: 44, marginTop: 12 }}>
            <Ionicons name="search" size={15} color="#94A3B8" style={{ marginRight: 8 }} />
            <TextInput value={q} onChangeText={setQ} placeholder="Chèche kliyan (non, NIF, telefòn)" placeholderTextColor="#94A3B8" style={{ flex: 1, fontSize: 13, color: "#0F172A" }} />
            {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
          </View>
          <ScrollView style={{ marginTop: 12, flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {!q.trim() ? (
              <Text style={{ fontSize: 12, color: "#16130c", fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 }}>Apèn Kreye</Text>
            ) : null}
            {results.length === 0 ? (
              <View style={{ padding: 20, alignItems: "center" }}><Text style={{ color: "#94a3b8", fontWeight: "600", fontSize: 13 }}>Pa jwenn kliyan</Text></View>
            ) : (
              results.map(c => (
                <Pressable key={c.id} onPress={() => onPick(c)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: "#F1F5F9", backgroundColor: "white", marginBottom: 6 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 14, color: "#475569", fontWeight: "700" }}>{(c.name?.[0] ?? "•").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A" }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ fontSize: 11, color: "#94A3B8" }} numberOfLines={1}>{c.phone ?? "—"}</Text>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700" }} numberOfLines={1}>{c.id_card_number ?? "—"}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
                </Pressable>
              ))
            )}
            <View style={{ height: 12 }} />
          </ScrollView>
        </>
      ) : (
        <ScrollView style={{ marginTop: 14, flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <CustomerForm
            key={`picker-cust-${formKey}`}
            onState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }}
          />
          <View style={{ height: 16 }} />
        </ScrollView>
      )}
    </View>
  );
}
