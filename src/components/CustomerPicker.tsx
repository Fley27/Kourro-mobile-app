// Shared customer picker — THE customer list used by the receipt flow.
// Dark reference design (POS "Chwazi Kliyan" / Customers phone list): gray
// circle header buttons, pill search + debt filter, initial tiles, name +
// contact rows with hairline separators on black. Owns search + new-customer
// form + save; host only selects.
import React, { useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { topIconBtn } from "../theme";
import { getDb } from "../db";
import CustomerForm, { EMPTY_CUSTOMER_FORM, type CustomerFormData } from "./CustomerForm";
import { insertCustomerRecord } from "../sales/customers";
import { uploadSuccess, uploadError } from "./UploadTransition";
import { KeyboardSafeScrollView } from "./KeyboardSafe";

function initialsOf(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function CustomerPicker({ storeId, customers, debts, onPick, onBack, onAdded }: {
  storeId: string;
  customers: any[];
  debts?: any[];
  onPick: (c: any) => void;
  onBack: () => void;
  onAdded?: (c: any) => void;
}) {
  const [view, setView] = useState<"list" | "new">("list");
  const [q, setQ] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [formValid, setFormValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<{ data: CustomerFormData; valid: boolean }>({ data: EMPTY_CUSTOMER_FORM, valid: false });

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = customers.filter(c => {
      if (!needle) return true;
      const name = (c.name ?? "").toLowerCase();
      return name.includes(needle) || (c.id_card_number ?? "").toLowerCase().includes(needle) || (c.phone ?? "").toLowerCase().includes(needle);
    });
    if (debtOnly) {
      const debtIds = new Set((debts ?? []).filter(d => Number(d.balance) > 0).map(d => d.customer_id));
      list = list.filter(c => debtIds.has(c.id));
    }
    return [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  }, [customers, debts, debtOnly, q]);

  function openNew() {
    formRef.current = { data: EMPTY_CUSTOMER_FORM, valid: false };
    setFormValid(false);
    setFormKey(k => k + 1);
    setView("new");
  }

  async function save() {
    const { data, valid } = formRef.current;
    if (!valid) return Alert.alert("Enkonplè", "Ranpli tout chan obligatwa (*) anvan ou anrejistre.");
    setSaving(true);
    try {
      const db = await getDb();
      const fresh = await insertCustomerRecord(db, storeId, data);
      onAdded?.(fresh);
      onPick(fresh);
      uploadSuccess("Kliyan ajoute ✓", fresh.name);
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Ajoute kliyan echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {view === "list" ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={onBack} accessibilityLabel="Retounen" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Chwazi Kliyan</Text>
          <Pressable onPress={openNew} accessibilityLabel="Nouvo kliyan" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => setView("list")} accessibilityLabel="Retounen" style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "#efe7d2", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={19} color="#16130c" />
          </Pressable>
          <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>New Customer</Text>
          <Pressable onPress={save} disabled={!formValid || saving} style={{ paddingHorizontal: 16, height: 34, borderRadius: 12, backgroundColor: formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: formValid && !saving ? 1 : 0.6 }}>
            <Text style={{ color: formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 13 }}>{saving ? "…" : "Save"}</Text>
          </Pressable>
        </View>
      )}

      {view === "list" ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, marginBottom: 6 }}>
            <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
              <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Chèche"
                placeholderTextColor="#8e8e93"
                style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
                returnKeyType="search"
              />
              {q.length > 0 ? (
                <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={18} color="#8e8e93" />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => setDebtOnly(v => !v)}
              accessibilityLabel="Ki gen dèt"
              style={{ width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: debtOnly ? "#fff" : "#000", borderWidth: 1, borderColor: debtOnly ? "#fff" : "#3a3a3c" }}
            >
              <Ionicons name="filter" size={20} color={debtOnly ? "#000" : "#fff"} />
            </Pressable>
          </View>
          <KeyboardSafeScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {results.length === 0 ? (
              <View style={{ padding: 32, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>{debtOnly ? "Pa gen kliyan ki gen dèt" : "Pa gen kliyan"}</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>Eseye yon lòt rechèch</Text>
              </View>
            ) : (
              results.map(c => (
                <Pressable key={c.id} onPress={() => onPick(c)}>
                  <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}>
                    <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initialsOf(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }} numberOfLines={1}>{c.name}</Text>
                      <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }} numberOfLines={1}>{c.phone ?? c.id_card_number ?? "—"}</Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#262626", marginLeft: 64 }} />
                </Pressable>
              ))
            )}
            <View style={{ height: 12 }} />
          </KeyboardSafeScrollView>
        </>
      ) : (
        <KeyboardSafeScrollView style={{ marginTop: 14, flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <CustomerForm
            key={`picker-cust-${formKey}`}
            onState={(data, valid) => { formRef.current = { data, valid }; setFormValid(valid); }}
          />
          <View style={{ height: 16 }} />
        </KeyboardSafeScrollView>
      )}
    </View>
  );
}
