// SupplierSheets — the ONLY New/Edit supplier UI in the app.
// Dark reference design, same field language as CustomerForm: body only
// (no header/save button) — the caller renders Save in its own header and
// disables it from `valid`. Data flows out via `onState`.
//
// Address: country dropdown (Haiti preselected), department dropdown = the 10
// Haitian departments + "Lòt" (reveals free text for non-Haiti provinces),
// city free text, single-line address — no line 2, no postal code.
// Payment methods are MULTI-select (cash/bank/remittance — add entries to
// SUPPLIER_PAYMENT_METHODS to extend). Bank accounts are repeatable
// sub-records shown only while "bank" is checked (owner + admin both edit);
// the legacy bank_info free text is no longer edited here — the column is
// kept and never overwritten.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomerProfileHeader, ModalScreen } from "./CustomerProfile";
import { DarkDropdown, PhoneField, CountryDialPicker, countryName, deptName, flagOf } from "./CustomerForm";
import COUNTRIES from "../data/countries.json";
import DEPARTMENTS from "../data/haitiDepartments.json";
import { KeyboardSafeScrollView } from "./KeyboardSafe";

const INK = "#fff";
const MUTED = "#8e8e93";
const BOX = "#0a0a0a";
const HAIR = "#3a3a3c";

type Opt = { code: string; name: string };

// Extensible payment-method vocabulary — append entries, nothing else changes.
export const SUPPLIER_PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: "cash", label: "Kach" },
  { id: "bank", label: "Labank" },
  { id: "remittance", label: "Remitans" },
];

// "Account type" = currency: gourde or dollar.
export const BANK_CURRENCIES: Opt[] = [
  { code: "HTG", name: "Gourde" },
  { code: "USD", name: "Dollar" },
];

const OTHER_DEPARTMENT = "OTHER";

export type SupplierBankAccountForm = {
  id?: string; // present = persisted row (diffed on save)
  bank_name: string;
  currency: string; // BANK_CURRENCIES code, "" = unset
  account_number: string;
};

export type SupplierFormValues = {
  name: string;
  phone: string;
  phone_country: string; // ISO code driving the flag + dial picker (default HT), decorative like CustomerForm
  country: string; // ISO code, Haiti ("HT") preselected
  department: string; // Haitian dept code | OTHER_DEPARTMENT | ""
  department_other: string; // free text while department === OTHER
  city: string;
  address: string; // single line
  payment_methods: string[]; // SUPPLIER_PAYMENT_METHODS ids, any combination
  payment_terms: string;
  bank_accounts: SupplierBankAccountForm[];
  notes: string;
};

export type EditSupplierState = {
  data: SupplierFormValues | null;
  valid: boolean;
};

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  name: "",
  phone: "",
  phone_country: "HT",
  country: "HT",
  department: "",
  department_other: "",
  city: "",
  address: "",
  payment_methods: [],
  payment_terms: "",
  bank_accounts: [],
  notes: "",
};

const DEPT_CODES = new Set((DEPARTMENTS as Opt[]).map(d => d.code));

// Column → form: a persisted department is either a known code or the raw
// "Other" free text (re-edit shows it under the Lòt option).
export function departmentFromColumn(raw: any): { code: string; other: string } {
  const v = String(raw ?? "").trim();
  if (!v) return { code: "", other: "" };
  if (DEPT_CODES.has(v)) return { code: v, other: "" };
  return { code: OTHER_DEPARTMENT, other: v };
}

export function departmentToColumn(v: Pick<SupplierFormValues, "department" | "department_other">): string | null {
  const out = v.department === OTHER_DEPARTMENT ? v.department_other.trim() : v.department.trim();
  return out || null;
}

export function paymentMethodsFromColumn(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  const v = String(raw ?? "").trim();
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function paymentMethodsToColumn(list: string[]): string | null {
  return list.length ? JSON.stringify(list) : null;
}

export function paymentMethodLabel(id: string): string {
  return SUPPLIER_PAYMENT_METHODS.find(m => m.id === id)?.label ?? id;
}

export function bankCurrencyLabel(currency: any): string {
  const c = String(currency ?? "").trim();
  return BANK_CURRENCIES.find(x => x.code === c)?.name ?? c;
}

// Profile/search address: structured parts joined; legacy rows (address only)
// come out exactly as stored.
export function composeSupplierAddress(s: any): string {
  const dept = departmentFromColumn(s?.department);
  const deptLabel = dept.code === OTHER_DEPARTMENT ? dept.other : dept.code ? deptName(dept.code) : "";
  const countryLabel = String(s?.country ?? "").trim() ? countryName(String(s.country).trim()) : "";
  return [s?.address, s?.city, deptLabel, countryLabel]
    .map(x => String(x ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function supplierToFormValues(s: any, accounts: any[] = []): SupplierFormValues {
  const dept = departmentFromColumn(s?.department);
  return {
    name: s?.name ?? "",
    phone: s?.phone ?? "",
    phone_country: "HT",
    country: String(s?.country ?? "").trim() || "HT",
    department: dept.code,
    department_other: dept.other,
    city: s?.city ?? "",
    address: s?.address ?? "",
    payment_methods: paymentMethodsFromColumn(s?.payment_methods),
    payment_terms: s?.payment_terms ?? "",
    bank_accounts: (accounts ?? []).map(a => ({
      id: a?.id ?? undefined,
      bank_name: a?.bank_name ?? "",
      currency: a?.currency ?? "",
      account_number: a?.account_number ?? "",
    })),
    notes: s?.notes ?? "",
  };
}

function darkInput(multiline?: boolean) {
  return {
    backgroundColor: BOX,
    borderWidth: 1,
    borderColor: HAIR,
    borderRadius: 12,
    height: multiline ? 84 : 60,
    paddingHorizontal: 16,
    paddingTop: multiline ? 14 : 0,
    fontSize: 16,
    color: INK,
    textAlignVertical: (multiline ? "top" : "center") as "top" | "center",
  } as const;
}

function Field({ placeholder, value, onChange, multiline, keyboardType }: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  keyboardType?: any;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        multiline={!!multiline}
        keyboardType={keyboardType}
        style={darkInput(multiline) as any}
      />
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: INK, fontWeight: "700", fontSize: 13, marginBottom: 8 }}>{children}</Text>
  );
}

// Inner content of the New/Edit sheet, usable inline (no Modal) or in the
// modal — mirrors EditCustomerContent.
export function EditSupplierContent({ resetKey, visible, initial, onState }: {
  resetKey?: string | number;
  visible: boolean;
  initial: SupplierFormValues;
  isOwner?: boolean;
  onState: (s: EditSupplierState) => void;
}) {
  const [v, setV] = useState<SupplierFormValues>(initial);
  const set = (k: keyof SupplierFormValues) => (val: string) => setV(p => ({ ...p, [k]: val }));
  const [dialOpen, setDialOpen] = useState(false);
  useEffect(() => {
    if (visible) { setV(initial); setDialOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, resetKey]);
  const cb = useRef(onState);
  cb.current = onState;
  useEffect(() => {
    cb.current({ data: v, valid: v.name.trim().length > 0 });
  }, [v]);

  const countryOptions = useMemo(
    () => (COUNTRIES as Opt[]).map(c => ({ code: c.code, name: `${flagOf(c.code)}  ${c.name}` })),
    []
  );
  const departmentOptions = useMemo(
    () => [...(DEPARTMENTS as Opt[]).map(d => ({ code: d.code, name: d.name })), { code: OTHER_DEPARTMENT, name: "Lòt" }],
    []
  );

  const bankOn = v.payment_methods.includes("bank");

  const setAccount = (i: number, patch: Partial<SupplierBankAccountForm>) =>
    setV(p => ({ ...p, bank_accounts: p.bank_accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const addAccount = () =>
    setV(p => ({ ...p, bank_accounts: [...p.bank_accounts, { bank_name: "", currency: "", account_number: "" }] }));
  const removeAccount = (i: number) =>
    setV(p => ({ ...p, bank_accounts: p.bank_accounts.filter((_, j) => j !== i) }));

  return (
    <KeyboardSafeScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Field placeholder="Non founisè *" value={v.name} onChange={set("name")} />

      <PhoneField
        value={v.phone}
        onChange={set("phone")}
        country={v.phone_country || "HT"}
        onPressFlag={() => setDialOpen(true)}
      />

      <DarkDropdown
        label="Peyi"
        value={v.country}
        options={countryOptions}
        onSelect={set("country")}
        searchable
      />
      <DarkDropdown
        label="Depatman / Pwovens"
        value={v.department}
        options={departmentOptions}
        onSelect={set("department")}
      />
      {v.department === OTHER_DEPARTMENT ? (
        <Field placeholder="Lòt pwovens / eta" value={v.department_other} onChange={set("department_other")} />
      ) : null}
      <Field placeholder="Ville" value={v.city} onChange={set("city")} />
      <Field placeholder="Adrès (yon sèl liy)" value={v.address} onChange={set("address")} />

      <Label>Mwayen peman</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {SUPPLIER_PAYMENT_METHODS.map(m => {
          const on = v.payment_methods.includes(m.id);
          return (
            <Pressable
              key={m.id}
              onPress={() =>
                setV(p => ({
                  ...p,
                  payment_methods: p.payment_methods.includes(m.id)
                    ? p.payment_methods.filter(x => x !== m.id)
                    : [...p.payment_methods, m.id],
                }))
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: on ? "#fff" : HAIR,
                backgroundColor: on ? "#fff" : BOX,
              }}
            >
              <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={16} color={on ? "#000" : MUTED} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: on ? "#000" : INK }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {bankOn ? (
        <View style={{ marginBottom: 14 }}>
          <Label>Kont labank</Label>
          {v.bank_accounts.map((acc, i) => (
            <View
              key={acc.id ?? `acc-${i}`}
              style={{ backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 12, padding: 12, marginBottom: 10 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: MUTED, fontWeight: "700", fontSize: 12, letterSpacing: 0.6 }}>
                  KONT {i + 1}
                </Text>
                <Pressable onPress={() => removeAccount(i)} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={MUTED} />
                </Pressable>
              </View>
              <TextInput
                value={acc.bank_name}
                onChangeText={t => setAccount(i, { bank_name: t })}
                placeholder="Non labank"
                placeholderTextColor={MUTED}
                style={[darkInput(), { marginBottom: 10 }] as any}
              />
              <DarkDropdown
                label="Kalite kont"
                value={acc.currency}
                options={BANK_CURRENCIES}
                onSelect={code => setAccount(i, { currency: code })}
                placeholder="Kalite kont (Gourde / Dollar)"
              />
              <TextInput
                value={acc.account_number}
                onChangeText={t => setAccount(i, { account_number: t })}
                placeholder="Nimewo kont"
                placeholderTextColor={MUTED}
                style={darkInput() as any}
              />
            </View>
          ))}
          <Pressable
            onPress={addAccount}
            style={{
              height: 52,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: HAIR,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Ionicons name="add" size={18} color={INK} />
            <Text style={{ color: INK, fontWeight: "700", fontSize: 15 }}>Ajoute yon lòt kont</Text>
          </Pressable>
        </View>
      ) : null}

      <Field placeholder="Nòt" value={v.notes} onChange={set("notes")} multiline />
      <View style={{ height: 16 }} />

      <CountryDialPicker
        visible={dialOpen}
        onClose={() => setDialOpen(false)}
        onPick={iso => set("phone_country")(iso)}
        title="Area code"
      />
    </KeyboardSafeScrollView>
  );
}

// Full-screen dark sheet for creating a supplier (mirrors NewCustomerSheet).
export function NewSupplierSheet({ visible, resetKey, initial, onClose, onSave, saving, isOwner }: {
  visible: boolean;
  resetKey?: string | number;
  initial?: Partial<SupplierFormValues>;
  onClose: () => void;
  onSave: (vals: SupplierFormValues) => void;
  saving?: boolean;
  isOwner?: boolean;
}) {
  const [st, setSt] = useState<EditSupplierState>({ data: null, valid: false });
  useEffect(() => {
    if (visible) setSt({ data: null, valid: false });
  }, [visible, resetKey]);
  const canSave = st.valid && !saving;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <ModalScreen>
        <CustomerProfileHeader
          onBack={onClose}
          backIcon="x-circle"
          title="Nouvo founisè"
          headerAction={
            <Pressable
              onPress={() => { if (canSave && st.data) onSave(st.data); }}
              disabled={!canSave}
              style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: canSave ? "#fff" : "#2b2b2b", opacity: saving ? 0.7 : 1 }}
            >
              <Text style={{ fontWeight: "800", fontSize: 15, color: canSave ? "#000" : "#6e6e73" }}>{saving ? "…" : "Kreye"}</Text>
            </Pressable>
          }
        />
        <EditSupplierContent
          resetKey={`${String(resetKey ?? "x")}-${visible ? "open" : "shut"}`}
          visible={visible}
          initial={{ ...EMPTY_SUPPLIER_FORM, ...initial }}
          isOwner={isOwner}
          onState={setSt}
        />
      </ModalScreen>
    </Modal>
  );
}
