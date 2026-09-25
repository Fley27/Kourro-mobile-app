// CustomerSheets — the ONLY New/Edit customer UI in the app.
// Every entry point (POS cart, receipt flow, Customers screen) renders these.
// Field inputs come from the single shared CustomerForm; persistence stays
// with the caller via onSave (store scoping, history logs and sync differ
// per screen). Edit once here, it changes everywhere.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import CustomerForm, { EMPTY_CUSTOMER_FORM, type CustomerFormData } from "./CustomerForm";
import { CustomerProfileHeader, ModalScreen } from "./CustomerProfile";

export type CustomerSaveExtra = { creditLimit: number | null };

// ── Form bodies (POS embeds these inline inside its own sheets) ──

export function NewCustomerFormBody({ formKey, initial, onFormState }: {
  formKey: number;
  initial?: Partial<CustomerFormData>;
  onFormState: (data: any, valid: boolean) => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <CustomerForm
        key={`new-cust-${formKey}`}
        initial={initial}
        onState={onFormState}
      />
      <View style={{ height: 16 }} />
    </ScrollView>
  );
}

export type CustomerNotesProps = {
  notes: any[];
  noteInput: string;
  onNoteInput: (v: string) => void;
  savingNote: boolean;
  onAddNote: () => void;
  notesLimit?: number;
};

export function EditCustomerFormBody({ formKey, initial, onFormState, notes, noteInput, onNoteInput, savingNote, onAddNote, notesLimit }: {
  formKey: number;
  initial?: Partial<CustomerFormData>;
  onFormState: (data: any, valid: boolean) => void;
} & CustomerNotesProps) {
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <CustomerForm
        key={`edit-cust-${formKey}`}
        initial={initial}
        onState={onFormState}
      />
      <NotesBlock notes={notes} noteInput={noteInput} onNoteInput={onNoteInput} savingNote={savingNote} onAddNote={onAddNote} notesLimit={notesLimit} />
      <View style={{ height: 16 }} />
    </ScrollView>
  );
}

// ── Credit-limit section (manager+ capability; same UI wherever shown) ──

function CreditLimitSection({ value, onChange, editable, current }: {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  current?: number | null;
}) {
  return (
    <View style={{ marginTop: 12, backgroundColor: "#0a0a0a", borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Limit kredi</Text>
        {!editable ? (
          <View style={{ backgroundColor: "#2b2b2b", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: "#8e8e93" }}>Manager+</Text>
          </View>
        ) : null}
      </View>
      <TextInput
        editable={editable}
        value={value}
        onChangeText={v => onChange(v.replace(/[^0-9.]/g, ""))}
        keyboardType="numeric"
        placeholder={current == null ? "San limit" : String(current)}
        placeholderTextColor="#8e8e93"
        style={{ borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, height: 60, marginTop: 10, paddingHorizontal: 14, fontSize: 16, color: "#fff", backgroundColor: "#000", fontWeight: "600" }}
      />
      <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 6 }}>{editable ? "Kite vid pou san limit" : "Kesye pa ka modifye limit"}</Text>
    </View>
  );
}

// ── Modal sheets (Customers screen; POS keeps embedding the bodies) ──

type SheetShellProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  saving?: boolean;
  children: React.ReactNode;
};

function SheetShell({ visible, title, onClose, onSave, saveLabel, saveDisabled, saving, children }: SheetShellProps) {
  const canSave = !saveDisabled && !saving;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <ModalScreen>
        <CustomerProfileHeader
          onBack={onClose}
          backIcon="x-circle"
          title={title}
          headerAction={
            <Pressable
              onPress={onSave}
              disabled={!canSave}
              style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: canSave ? "#fff" : "#2b2b2b", opacity: saving ? 0.7 : 1 }}
            >
              <Text style={{ fontWeight: "800", fontSize: 15, color: canSave ? "#000" : "#6e6e73" }}>{saving ? "…" : saveLabel}</Text>
            </Pressable>
          }
        />
        <View style={{ flex: 1 }}>{children}</View>
      </ModalScreen>
    </Modal>
  );
}

export function NewCustomerSheet({ visible, resetKey, initial, onClose, onSave, saving, showCreditLimit, canEditCreditLimit }: {
  visible: boolean;
  resetKey?: string | number;
  initial?: Partial<CustomerFormData>;
  onClose: () => void;
  onSave: (data: CustomerFormData, extra: CustomerSaveExtra) => void;
  saving?: boolean;
  showCreditLimit?: boolean;
  canEditCreditLimit?: boolean;
}) {
  const [form, setForm] = useState<{ data: CustomerFormData; valid: boolean } | null>(null);
  const [creditLimit, setCreditLimit] = useState("");
  useEffect(() => {
    if (visible) { setForm(null); setCreditLimit(""); }
  }, [visible, resetKey]);
  const parsedLimit = creditLimit.trim() === "" ? null : Number(creditLimit);
  const limitOk = creditLimit.trim() === "" || (Number.isFinite(parsedLimit) && (parsedLimit as number) >= 0);
  return (
    <SheetShell
      visible={visible}
      title="Nouvo kliyan"
      onClose={onClose}
      onSave={() => { if (form) onSave(form.data, { creditLimit: parsedLimit }); }}
      saveLabel="Kreye"
      saveDisabled={!form?.valid || !limitOk}
      saving={saving}
    >
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <CustomerForm
          key={`sheet-new-${resetKey ?? "x"}-${visible ? "open" : "shut"}`}
          initial={{ ...EMPTY_CUSTOMER_FORM, ...initial }}
          onState={(data, valid) => setForm({ data, valid })}
        />
        {showCreditLimit ? (
          <CreditLimitSection value={creditLimit} onChange={setCreditLimit} editable={!!canEditCreditLimit} current={null} />
        ) : null}
        <View style={{ height: 16 }} />
      </ScrollView>
    </SheetShell>
  );
}

export type EditCustomerState = {
  data: CustomerFormData | null;
  valid: boolean;
  creditLimit: number | null;
  limitOk: boolean;
};

// Inner content of the Edit sheet, usable inline (no Modal) or in the modal.
export function EditCustomerContent({ resetKey, visible, initial, initialCreditLimit, showCreditLimit, canEditCreditLimit, notesProps, onState }: {
  resetKey?: string | number;
  visible: boolean;
  initial: Partial<CustomerFormData>;
  initialCreditLimit?: number | null;
  showCreditLimit?: boolean;
  canEditCreditLimit?: boolean;
  notesProps: CustomerNotesProps;
  onState: (s: EditCustomerState) => void;
}) {
  const [form, setForm] = useState<{ data: CustomerFormData; valid: boolean } | null>(null);
  const [creditLimit, setCreditLimit] = useState(initialCreditLimit == null ? "" : String(initialCreditLimit));
  useEffect(() => {
    if (visible) { setForm(null); setCreditLimit(initialCreditLimit == null ? "" : String(initialCreditLimit)); }
  }, [visible, resetKey]);
  const parsedLimit = creditLimit.trim() === "" ? null : Number(creditLimit);
  const limitOk = creditLimit.trim() === "" || (Number.isFinite(parsedLimit) && (parsedLimit as number) >= 0);
  const cb = useRef(onState);
  cb.current = onState;
  useEffect(() => {
    cb.current({ data: form?.data ?? null, valid: !!form?.valid && limitOk, creditLimit: parsedLimit, limitOk });
  }, [form, parsedLimit, limitOk]);
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <CustomerForm
        key={`sheet-edit-${resetKey ?? "x"}-${visible ? "open" : "shut"}`}
        initial={{ ...EMPTY_CUSTOMER_FORM, ...initial }}
        onState={(data, valid) => setForm({ data, valid })}
      />
      {showCreditLimit ? (
        <CreditLimitSection value={creditLimit} onChange={setCreditLimit} editable={!!canEditCreditLimit} current={initialCreditLimit ?? null} />
      ) : null}
      <NotesBlock {...notesProps} />
      <View style={{ height: 16 }} />
    </ScrollView>
  );
}

export function EditCustomerSheet({ visible, resetKey, initial, initialCreditLimit, onClose, onSave, saving, showCreditLimit, canEditCreditLimit, notesProps }: {
  visible: boolean;
  resetKey?: string | number;
  initial: Partial<CustomerFormData>;
  initialCreditLimit?: number | null;
  onClose: () => void;
  onSave: (data: CustomerFormData, extra: CustomerSaveExtra) => void;
  saving?: boolean;
  showCreditLimit?: boolean;
  canEditCreditLimit?: boolean;
  notesProps: CustomerNotesProps;
}) {
  const [st, setSt] = useState<EditCustomerState>({ data: null, valid: false, creditLimit: null, limitOk: true });
  return (
    <SheetShell
      visible={visible}
      title="Modifye kliyan"
      onClose={onClose}
      onSave={() => { if (st.data) onSave(st.data, { creditLimit: st.creditLimit }); }}
      saveLabel="Save"
      saveDisabled={!st.valid}
      saving={saving}
    >
      <EditCustomerContent
        resetKey={resetKey}
        visible={visible}
        initial={initial}
        initialCreditLimit={initialCreditLimit}
        showCreditLimit={showCreditLimit}
        canEditCreditLimit={canEditCreditLimit}
        notesProps={notesProps}
        onState={setSt}
      />
    </SheetShell>
  );
}

function NotesBlock({ notes, noteInput, onNoteInput, savingNote, onAddNote, notesLimit }: CustomerNotesProps) {
  const limit = notesLimit ?? 2;
  const atLimit = notes.length >= limit;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: "#262626", marginTop: 14, paddingTop: 12 }}>
      <Text style={{ fontWeight: "800", fontSize: 16, color: "#fff" }}>Notes</Text>
      {notes.length === 0 ? (
        <Text style={{ fontSize: 14, color: "#8e8e93", marginTop: 6 }}>Pa gen nòt pou kliyan sa a.</Text>
      ) : (
        notes.map(n => (
          <View key={n.id} style={{ marginTop: 8, backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, padding: 12 }}>
            <Text style={{ fontSize: 14, color: "#fff" }}>{n.text}</Text>
            <Text style={{ fontSize: 10, color: "#8e8e93", marginTop: 6, textAlign: "left" }}>
              {n.created_at ? new Date(n.created_at).toLocaleDateString() : ""}
            </Text>
          </View>
        ))
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TextInput value={noteInput} onChangeText={onNoteInput} placeholder="Ekri yon nòt…" placeholderTextColor="#8e8e93"
          style={{ flex: 1, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, height: 60, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "#0a0a0a" }} />
        <Pressable onPress={onAddNote} disabled={savingNote || !noteInput.trim() || atLimit} style={{ paddingHorizontal: 18, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", opacity: savingNote || !noteInput.trim() || atLimit ? 0.4 : 1 }}>
          <Text style={{ color: "#000", fontWeight: "800", fontSize: 13 }}>{savingNote ? "…" : "Add"}</Text>
        </Pressable>
      </View>
      {atLimit ? (
        <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 6 }}>Limit {limit} nòt — yon kliyan pa ka gen plis.</Text>
      ) : null}
    </View>
  );
}
