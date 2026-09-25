// Shared New Customer body form — THE general design for creating a customer
// anywhere in the app (PayScreen flow, Customers screen, credit flow...).
// Dark reference design: black boxes, flag phone picker defaulting to Haiti,
// import-from-contacts. Body only (no header/save button): the caller renders
// Save in its own header and disables it from `valid`. Data flows out via
// `onState` — store it in a ref (no re-render), keep `valid` in state.
//
// Required: everything except email, address line 2 and the marketing toggle.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Switch, FlatList, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import COUNTRIES from "../data/countries.json";
import DEPARTMENTS from "../data/haitiDepartments.json";
import DIALS from "../data/countryDial.json";

export type CustomerFormData = {
  firstName: string;
  lastName: string;
  idDoc: string;
  phone: string;
  phoneCountry: string; // ISO code driving the flag + dial picker (default HT)
  email: string;
  marketingConsent: boolean;
  country: string; // ISO code, Haiti (HT) preselected
  department: string; // Haiti department code (when country is HT)
  commune: string;
  line1: string;
  line2: string;
  birthDay: string;
  birthMonth: string;
  birthYear: string;
};

export const EMPTY_CUSTOMER_FORM: CustomerFormData = {
  firstName: "",
  lastName: "",
  idDoc: "",
  phone: "",
  phoneCountry: "HT",
  email: "",
  marketingConsent: false,
  country: "HT",
  department: "",
  commune: "",
  line1: "",
  line2: "",
  birthDay: "",
  birthMonth: "",
  birthYear: "",
};

export const MONTHS = [
  { code: "01", name: "Janvier" }, { code: "02", name: "Février" },
  { code: "03", name: "Mars" }, { code: "04", name: "Avril" },
  { code: "05", name: "Mai" }, { code: "06", name: "Juin" },
  { code: "07", name: "Juillet" }, { code: "08", name: "Août" },
  { code: "09", name: "Septembre" }, { code: "10", name: "Octobre" },
  { code: "11", name: "Novembre" }, { code: "12", name: "Décembre" },
];

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function daysInMonth(y: string, m: string): number {
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (isNaN(year) || month < 1 || month > 12) return 31;
  return new Date(year, month, 0).getDate();
}

export function validateCustomerForm(d: CustomerFormData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!d.firstName.trim()) errors.push("firstName");
  if (!d.lastName.trim()) errors.push("lastName");
  if (!d.idDoc.trim()) errors.push("idDoc");
  if (d.phone.replace(/[^0-9]/g, "").length < 7) errors.push("phone");
  if (d.email.trim() && !isValidEmail(d.email)) errors.push("email");
  if (!d.country) errors.push("country");
  if (d.country === "HT" && !d.department) errors.push("department");
  if (!d.commune.trim()) errors.push("commune");
  if (!d.line1.trim()) errors.push("line1");
  const day = parseInt(d.birthDay, 10);
  const year = parseInt(d.birthYear, 10);
  const nowYear = new Date().getFullYear();
  if (isNaN(day) || day < 1 || day > daysInMonth(d.birthYear, d.birthMonth)) errors.push("birthDay");
  if (!d.birthMonth) errors.push("birthMonth");
  if (isNaN(year) || d.birthYear.trim().length !== 4 || year < 1900 || year > nowYear) errors.push("birthYear");
  return { valid: errors.length === 0, errors };
}

export function countryName(code: string): string {
  return (COUNTRIES as Opt[]).find(c => c.code === code)?.name ?? code;
}

export function deptName(code: string): string {
  return (DEPARTMENTS as Opt[]).find(d => d.code === code)?.name ?? code;
}

export function composeAddress(d: CustomerFormData): string {
  const parts = [
    d.line1.trim(),
    d.line2.trim(),
    d.commune.trim(),
    d.country === "HT" ? deptName(d.department) : d.department.trim(),
    countryName(d.country),
  ].filter(Boolean);
  return parts.join(", ");
}

export function fullNameOf(d: CustomerFormData): string {
  return `${d.firstName.trim()} ${d.lastName.trim()}`.trim();
}

// ── Country dial directory (flag derived from ISO, Haiti preselected) ──

export function flagOf(iso: string): string {
  const code = String(iso ?? "").toUpperCase();
  if (code.length !== 2) return "🏳";
  return code.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

export function dialOf(iso: string): string {
  return (DIALS as { c: string; n: string; d: string }[]).find(x => x.c === String(iso ?? "").toUpperCase())?.d ?? "";
}

export function dialName(iso: string): string {
  const code = String(iso ?? "").toUpperCase();
  return (DIALS as { c: string; n: string; d: string }[]).find(x => x.c === code)?.n ?? countryName(code);
}

// ── Dark theme primitives ──

const INK = "#fff";
const MUTED = "#8e8e93";
const BOX = "#0a0a0a";
const HAIR = "#3a3a3c";
const TILE = "#2b2b2b";

function darkInput() {
  return {
    backgroundColor: BOX,
    borderWidth: 1,
    borderColor: HAIR,
    borderRadius: 12,
    height: 60,
    paddingHorizontal: 16,
    fontSize: 16,
    color: INK,
  };
}

function Divider() {
  return <View style={{ height: 4, backgroundColor: TILE, borderRadius: 2, marginVertical: 22, opacity: 0.7 }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: INK, fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 12 }}>{children}</Text>;
}

type Opt = { code: string; name: string };

function DarkDropdown(props: {
  label: string;
  value: string;
  options: Opt[];
  onSelect: (code: string) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = props.options.find(o => o.code === props.value);
  const filtered = props.searchable && q.trim()
    ? props.options.filter(o => o.name.toLowerCase().includes(q.trim().toLowerCase()))
    : props.options;
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable
        onPress={() => { setQ(""); setOpen(true); }}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 12, height: 60, paddingHorizontal: 16 }}
      >
        <Text style={{ fontSize: 16, color: current ? INK : MUTED }} numberOfLines={1}>
          {current ? current.name : props.placeholder ?? props.label}
        </Text>
        <Ionicons name="chevron-down" size={18} color={MUTED} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#161616", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, maxHeight: "70%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 10 }} />
            <Text style={{ fontWeight: "800", fontSize: 15, color: INK, marginBottom: 10 }}>{props.label}</Text>
            {props.searchable ? (
              <TextInput value={q} onChangeText={setQ} placeholder="Chèche…" placeholderTextColor={MUTED}
                style={{ backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 14, color: INK }} />
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false}>
              {filtered.map(o => (
                <Pressable key={o.code} onPress={() => { props.onSelect(o.code); setOpen(false); }}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
                  <Text style={{ fontSize: 15, fontWeight: props.value === o.code ? "800" : "500", color: INK }}>{o.name}</Text>
                  {props.value === o.code ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                </Pressable>
              ))}
              {filtered.length === 0 ? <Text style={{ color: MUTED, textAlign: "center", padding: 16 }}>Pa jwenn</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Country picker with flag + dial code, Haiti first, searchable.
function CountryDialPicker({ visible, onClose, onPick, title }: {
  visible: boolean;
  onClose: () => void;
  onPick: (iso: string) => void;
  title: string;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const all = DIALS as { c: string; n: string; d: string }[];
    const ht = all.filter(x => x.c === "HT");
    const rest = all.filter(x => x.c !== "HT");
    const needle = q.trim().toLowerCase();
    const list = needle
      ? all.filter(x => x.n.toLowerCase().includes(needle) || x.d.includes(needle))
      : [...ht, ...rest];
    return list;
  }, [q]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#161616", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, maxHeight: "75%" }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 10 }} />
          <Text style={{ fontWeight: "800", fontSize: 15, color: INK, marginBottom: 10 }}>{title}</Text>
          <TextInput value={q} onChangeText={setQ} placeholder="Chèche peyi oswa kòd…" placeholderTextColor={MUTED}
            style={{ backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 14, color: INK }} />
          <FlatList
            data={rows}
            keyExtractor={x => x.c}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable onPress={() => { onPick(item.c); onClose(); }}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
                <Text style={{ fontSize: 22, marginRight: 12 }}>{flagOf(item.c)}</Text>
                <Text style={{ flex: 1, fontSize: 15, color: INK }} numberOfLines={1}>{item.n}</Text>
                <Text style={{ fontSize: 14, color: MUTED }}>+{item.d}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

// ── The form ──

export default function CustomerForm({ initial, onState }: {
  initial?: Partial<CustomerFormData>;
  onState?: (data: CustomerFormData, valid: boolean) => void;
}) {
  const [d, setD] = useState<CustomerFormData>({ ...EMPTY_CUSTOMER_FORM, ...initial });
  const set = (k: keyof CustomerFormData) => (v: string | boolean) =>
    setD(prev => ({ ...prev, [k]: v }));
  const { valid } = useMemo(() => validateCustomerForm(d), [d]);
  const cb = useRef(onState);
  cb.current = onState;
  const last = useRef("");
  useEffect(() => {
    const key = JSON.stringify([d, valid]);
    if (key !== last.current) { last.current = key; cb.current?.(d, valid); }
  }, [d, valid]);

  const days = useMemo(() => {
    const max = daysInMonth(d.birthYear || "2000", d.birthMonth || "01");
    return Array.from({ length: max }, (_, i) => ({ code: String(i + 1).padStart(2, "0"), name: String(i + 1) }));
  }, [d.birthYear, d.birthMonth]);

  const [dialOpen, setDialOpen] = useState<"phone" | "country" | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsQ, setContactsQ] = useState("");
  const [contactsLoading, setContactsLoading] = useState(false);

  async function openContacts() {
    setContactsLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Pa gen aksè", "Bay aksè kontak pou enpòte yon kliyan.");
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      });
      setContacts((data ?? []).filter((c: any) => c.name || (c.phoneNumbers ?? []).length > 0));
      setContactsQ("");
      setContactsOpen(true);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Enpòte kontak echwe");
    } finally {
      setContactsLoading(false);
    }
  }

  function importContact(c: any) {
    const name = String(c.name ?? "").trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const phones: string[] = (c.phoneNumbers ?? []).map((p: any) => String(p.number ?? "")).filter(Boolean);
    const emails: string[] = (c.emails ?? []).map((e: any) => String(e.email ?? "")).filter(Boolean);
    setD(prev => ({
      ...prev,
      firstName: parts[0] ?? prev.firstName,
      lastName: parts.slice(1).join(" ") || prev.lastName,
      phone: phones[0] ? phones[0].replace(/[^0-9+ ]/g, "") : prev.phone,
      email: !prev.email.trim() && emails[0] ? emails[0] : prev.email,
    }));
    setContactsOpen(false);
  }

  const filteredContacts = useMemo(() => {
    const needle = contactsQ.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter(c =>
      String(c.name ?? "").toLowerCase().includes(needle) ||
      (c.phoneNumbers ?? []).some((p: any) => String(p.number ?? "").includes(needle))
    );
  }, [contacts, contactsQ]);

  const phoneIso = d.phoneCountry || "HT";

  return (
    <View>
      <Pressable
        onPress={openContacts}
        disabled={contactsLoading}
        style={{ backgroundColor: TILE, borderRadius: 26, paddingVertical: 15, alignItems: "center", marginBottom: 12, opacity: contactsLoading ? 0.6 : 1 }}
      >
        {contactsLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: INK, fontSize: 16, fontWeight: "700" }}>Import from contacts</Text>
        )}
      </Pressable>

      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.firstName} onChangeText={set("firstName")} placeholder="First name" placeholderTextColor={MUTED} style={darkInput()} />
      </View>
      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.lastName} onChangeText={set("lastName")} placeholder="Last name" placeholderTextColor={MUTED} style={darkInput()} />
      </View>

      <View style={{ marginBottom: 12, flexDirection: "row", alignItems: "center", backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 12, height: 60, paddingHorizontal: 8 }}>
        <Pressable onPress={() => setDialOpen("phone")} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, height: 60, justifyContent: "center" }}>
          <Text style={{ fontSize: 24 }}>{flagOf(phoneIso)}</Text>
          <Ionicons name="chevron-down" size={18} color={MUTED} style={{ marginLeft: 6 }} />
        </Pressable>
        <TextInput
          value={d.phone}
          onChangeText={v => set("phone")(v.replace(/[^0-9+ ]/g, ""))}
          keyboardType="phone-pad"
          placeholder="Phone number"
          placeholderTextColor={MUTED}
          style={{ flex: 1, fontSize: 16, color: INK, height: 58, paddingHorizontal: 6 }}
        />
      </View>

      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="Email address" placeholderTextColor={MUTED} style={darkInput()} />
      </View>

      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.idDoc} onChangeText={set("idDoc")} placeholder="CIN / NIF / Passport" placeholderTextColor={MUTED} autoCapitalize="characters" style={darkInput()} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, marginBottom: 4 }}>
        <Text style={{ flex: 1, color: INK, fontSize: 16, fontWeight: "700", marginRight: 12 }}>Subscribe to email marketing</Text>
        <Switch value={d.marketingConsent} onValueChange={v => set("marketingConsent")(v)} />
      </View>

      <Divider />
      <SectionTitle>Address</SectionTitle>

      <Pressable
        onPress={() => setDialOpen("country")}
        style={{ marginBottom: 12, flexDirection: "row", alignItems: "center", backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 12, minHeight: 60, paddingVertical: 8, paddingHorizontal: 16 }}
      >
        <Text style={{ fontSize: 22, marginRight: 12 }}>{flagOf(d.country || "HT")}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: INK, fontSize: 16, fontWeight: "700" }}>Country</Text>
          <Text style={{ color: INK, fontSize: 16, marginTop: 2 }}>{dialName(d.country || "HT")}</Text>
        </View>
        <Ionicons name="chevron-down" size={20} color={MUTED} />
      </Pressable>

      {d.country === "HT" ? (
        <DarkDropdown label="Department / Province" value={d.department} options={(DEPARTMENTS as Opt[]).map(x => ({ code: x.code, name: x.name }))} onSelect={set("department")} />
      ) : (
        <View style={{ marginBottom: 12 }}>
          <TextInput value={d.department} onChangeText={set("department")} placeholder="Province / State" placeholderTextColor={MUTED} style={darkInput()} />
        </View>
      )}
      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.commune} onChangeText={set("commune")} placeholder="Commune / City" placeholderTextColor={MUTED} style={darkInput()} />
      </View>
      <View style={{ marginBottom: 12 }}>
        <TextInput value={d.line1} onChangeText={set("line1")} placeholder="Address line 1" placeholderTextColor={MUTED} style={darkInput()} />
      </View>
      <View style={{ marginBottom: 4 }}>
        <TextInput value={d.line2} onChangeText={set("line2")} placeholder="Address line 2" placeholderTextColor={MUTED} style={darkInput()} />
      </View>

      <Divider />
      <SectionTitle>Birthday</SectionTitle>
      <DarkDropdown label="Day" value={d.birthDay} options={days} onSelect={set("birthDay")} placeholder="Day" />
      <DarkDropdown label="Month" value={d.birthMonth} options={MONTHS} onSelect={set("birthMonth")} placeholder="Month" />
      <View style={{ marginBottom: 4 }}>
        <TextInput value={d.birthYear} onChangeText={v => set("birthYear")(v.replace(/[^0-9]/g, "").slice(0, 4))} keyboardType="numeric" placeholder="Year" placeholderTextColor={MUTED} style={darkInput()} />
      </View>

      <CountryDialPicker
        visible={dialOpen !== null}
        onClose={() => setDialOpen(null)}
        onPick={iso => {
          if (dialOpen === "phone") set("phoneCountry")(iso);
          else set("country")(iso);
        }}
        title={dialOpen === "phone" ? "Area code" : "Country"}
      />

      <Modal visible={contactsOpen} transparent animationType="slide" onRequestClose={() => setContactsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#161616", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, maxHeight: "75%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 10 }} />
            <Text style={{ fontWeight: "800", fontSize: 15, color: INK, marginBottom: 10 }}>Contacts</Text>
            <TextInput value={contactsQ} onChangeText={setContactsQ} placeholder="Chèche…" placeholderTextColor={MUTED}
              style={{ backgroundColor: BOX, borderWidth: 1, borderColor: HAIR, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 14, color: INK }} />
            <FlatList
              data={filteredContacts}
              keyExtractor={(item, i) => item.id ?? `${item.name}-${i}`}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const num = item.phoneNumbers?.[0]?.number ?? "";
                return (
                  <Pressable onPress={() => importContact(item)} style={{ paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: INK }} numberOfLines={1}>{item.name ?? "—"}</Text>
                    {!!num ? <Text style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{num}</Text> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
