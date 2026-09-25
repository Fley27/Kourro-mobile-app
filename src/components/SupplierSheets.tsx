// SupplierSheets — the ONLY New/Edit supplier UI in the app.
// Dark reference design, same field language as CustomerForm: body only
// (no header/save button) — the caller renders Save in its own header and
// disables it from `valid`. Data flows out via `onState`.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal } from "react-native";
import { CustomerProfileHeader, ModalScreen } from "./CustomerProfile";

const INK = "#fff";
const MUTED = "#8e8e93";
const BOX = "#0a0a0a";
const HAIR = "#3a3a3c";

export type SupplierFormValues = {
  name: string;
  phone: string;
  address: string;
  payment_terms: string;
  bank_info: string;
  notes: string;
};

export type EditSupplierState = {
  data: SupplierFormValues | null;
  valid: boolean;
};

export const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  name: "",
  phone: "",
  address: "",
  payment_terms: "",
  bank_info: "",
  notes: "",
};

export function supplierToFormValues(s: any): SupplierFormValues {
  return {
    name: s?.name ?? "",
    phone: s?.phone ?? "",
    address: s?.address ?? "",
    payment_terms: s?.payment_terms ?? "",
    bank_info: s?.bank_info ?? "",
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

// Inner content of the New/Edit sheet, usable inline (no Modal) or in the
// modal — mirrors EditCustomerContent.
export function EditSupplierContent({ resetKey, visible, initial, isOwner, onState }: {
  resetKey?: string | number;
  visible: boolean;
  initial: SupplierFormValues;
  isOwner: boolean;
  onState: (s: EditSupplierState) => void;
}) {
  const [v, setV] = useState<SupplierFormValues>(initial);
  const set = (k: keyof SupplierFormValues) => (val: string) => setV(p => ({ ...p, [k]: val }));
  useEffect(() => {
    if (visible) setV(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, resetKey]);
  const cb = useRef(onState);
  cb.current = onState;
  useEffect(() => {
    cb.current({ data: v, valid: v.name.trim().length > 0 });
  }, [v]);

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Field placeholder="Non founisè *" value={v.name} onChange={set("name")} />
      <Field placeholder="Telefòn" value={v.phone} onChange={set("phone")} keyboardType="phone-pad" />
      <Field placeholder="Adrès" value={v.address} onChange={set("address")} />
      <Field placeholder="Kondisyon peman" value={v.payment_terms} onChange={set("payment_terms")} />
      {isOwner ? (
        <Field
          placeholder="Enfòmasyon labank (sansib — Owner sèlman)"
          value={v.bank_info}
          onChange={set("bank_info")}
          multiline
        />
      ) : (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: INK, marginBottom: 8 }}>Enfòmasyon labank</Text>
          <View style={{ backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 12, minHeight: 60, paddingHorizontal: 16, justifyContent: "center" }}>
            <Text style={{ color: MUTED, fontWeight: "700", fontSize: 14 }}>🔒 Kache — Owner sèlman</Text>
          </View>
        </View>
      )}
      <Field placeholder="Nòt" value={v.notes} onChange={set("notes")} multiline />
      <View style={{ height: 16 }} />
    </ScrollView>
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
  isOwner: boolean;
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
