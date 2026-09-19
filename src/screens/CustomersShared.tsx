import React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { fmt, monoStyle } from "../format";

// Shared form shape for new-customer + edit-customer payloads (kept in shell state).
export interface CustomerFormState {
  name: string;
  id_card_number: string;
  phone: string;
  address: string;
  credit_limit: string;
}

// ── Search header + segmented control (identical on phone + tablet) ──

export interface SearchHeaderProps {
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  customers: any[];
  debts: any[];
  padH: number;
}

export function SearchHeader({ search, setSearch, showDebtOnly, setShowDebtOnly, customers, debts, padH }: SearchHeaderProps) {
  return (
    <View style={{ backgroundColor: "white", borderBottomWidth: 1, borderColor: "#E5E7EB", paddingHorizontal: padH, paddingTop: 10, paddingBottom: 12 }}>
      <View style={{ height: 42, flexDirection: "row", alignItems: "center", backgroundColor: "#F2F2F7", borderRadius: 12, paddingHorizontal: 10, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 13, color: "#9CA3AF", marginRight: 6 }}>⌕</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="Chèche pa non, NIF/CIN, telefòn oswa adrès" placeholderTextColor="#9CA3AF" style={{ flex: 1, fontSize: 14, color: "#0F172A", paddingVertical: 8 }} returnKeyType="search" />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#9CA3AF", fontSize: 13, fontWeight: "600" }}>✕</Text></Pressable>
        )}
      </View>

      {/* Segmented control — elegant, single container */}
      <View style={{ marginTop: 10, flexDirection: "row", backgroundColor: "#F2F2F7", borderRadius: 12, padding: 3, gap: 4 }}>
        <Pressable onPress={() => setShowDebtOnly(false)} style={{ flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingVertical: 8, borderRadius: 9, backgroundColor: !showDebtOnly ? "white" : "transparent", borderWidth: !showDebtOnly ? 1 : 0, borderColor: "#E5E7EB", shadowColor: !showDebtOnly ? "#0F172A" : "transparent", shadowOpacity: !showDebtOnly ? 0.06 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
          <Text style={{ fontSize: 12, color: !showDebtOnly ? "#0F172A" : "#64748B" }}>◯</Text>
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: !showDebtOnly ? "#0F172A" : "#475569", letterSpacing: -0.1 }}>Tout</Text>
          <View style={{ backgroundColor: !showDebtOnly ? "#0F172A" : "#E2E8F0", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 }}><Text style={{ fontSize: 10, fontWeight: "700", color: !showDebtOnly ? "white" : "#475569" }}>{customers.length}</Text></View>
        </Pressable>
        <Pressable onPress={() => setShowDebtOnly(true)} style={{ flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingVertical: 8, borderRadius: 9, backgroundColor: showDebtOnly ? "white" : "transparent", borderWidth: showDebtOnly ? 1 : 0, borderColor: "#E5E7EB", shadowColor: showDebtOnly ? "#0F172A" : "transparent", shadowOpacity: showDebtOnly ? 0.06 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: showDebtOnly ? "#F59E0B" : "#CBD5E1" }} />
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: showDebtOnly ? "#0F172A" : "#475569", letterSpacing: -0.1 }}>Ki gen dèt</Text>
          <View style={{ backgroundColor: showDebtOnly ? "#92400E" : "#E2E8F0", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 }}><Text style={{ fontSize: 10, fontWeight: "700", color: showDebtOnly ? "white" : "#475569" }}>{debts.length}</Text></View>
        </Pressable>
      </View>
    </View>
  );
}

// ── Customer row card (master list item, both form factors) ──

export interface CustomerRowCardProps {
  item: any;
  debts: any[];
  isSelected: boolean;
  // Phone branch renders `flex: isTablet ? 1 : undefined`; tablet master list has no flex key.
  // Pass fill={isTablet} from phone, omit from tablet — behavior identical either way.
  fill?: boolean;
  onPress: () => void;
}

export function CustomerRowCard({ item, debts, isSelected, fill, onPress }: CustomerRowCardProps) {
  const debtRows = debts.filter(d => d.customer_id === item.id && Number(d.balance) > 0);
  const mostOverdue = debtRows.map(d => d.due_date ? new Date(d.due_date).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b)[0] ?? null;
  const isDebtCustomer = debtRows.length > 0;
  const computedDebt = debtRows.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);
  const totalDebt = Number(item.total_debt ?? 0) > 0 ? Number(item.total_debt) : computedDebt;
  const debtColor = isDebtCustomer ? "#DC2626" : "#16A34A";
  return (
    <Pressable onPress={onPress} style={{ flex: fill ? 1 : undefined, backgroundColor: "white", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: isSelected ? "#0F172A" : isDebtCustomer ? "#FECACA" : "#BBF7D0", shadowColor: "#0F172A", shadowOpacity: isSelected ? 0.08 : 0.04, shadowRadius: isSelected ? 14 : 10, shadowOffset: { width: 0, height: isSelected ? 6 : 3 }, elevation: isSelected ? 4 : 2, overflow: "hidden" }}>
      {isDebtCustomer ? <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: "#EF4444" }} /> : <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: "#22C55E" }} />}

      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {/* Avatar — initial */}
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDebtCustomer ? "#FEF2F2" : "#F0FDF4", borderWidth: 1, borderColor: isDebtCustomer ? "#FECACA" : "#BBF7D0", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: isDebtCustomer ? "#991B1B" : "#065F46", letterSpacing: -0.3 }}>{(item.name?.[0] ?? "•").toUpperCase()}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontWeight: "600", fontSize: 15, color: "#0F172A", letterSpacing: -0.2 }} numberOfLines={1}>{item.name}</Text>
            {isDebtCustomer ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#EF4444" }} /><Text style={{ fontSize: 10, fontWeight: "700", color: "#991B1B" }}>{debtRows.length} dèt</Text></View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" }} /><Text style={{ fontSize: 10, fontWeight: "700", color: "#065F46" }}>A jou</Text></View>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 11, color: "#64748B", fontWeight: "500" }}>ID {item.id_card_number || "—"}</Text></View>
            {item.phone ? <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "400" }}>{item.phone}</Text> : null}
            {item.address ? <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "400" }} numberOfLines={1}>· {item.address}</Text> : null}
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 2, minWidth: 84 }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: debtColor, letterSpacing: -0.2, textAlign: "right", ...monoStyle }}>{fmt(totalDebt)} HTG</Text>
          <Text style={{ fontSize: 11, color: isDebtCustomer ? "#FCA5A5" : "#86EFAC", fontWeight: "600" }}>{isDebtCustomer ? `${debtRows.length} aktif` : "A jou"}</Text>
        </View>

        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isSelected ? "#0F172A" : "#F8FAFC", borderWidth: 1, borderColor: isSelected ? "#0F172A" : "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10, color: isSelected ? "white" : "#94A3B8", fontWeight: "600" }}>{isSelected ? "✕" : "›"}</Text>
        </View>
      </View>

      {mostOverdue && <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }}><Text style={{ fontSize: 10, color: "#92400E" }}>◷</Text><Text style={{ fontSize: 11, color: "#92400E", fontWeight: "500" }}>Pi reta: {new Date(mostOverdue).toLocaleDateString()}</Text></View>}
    </Pressable>
  );
}

// ── Empty list state (identical on both form factors) ──

export function CustomerListEmpty() {
  return <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 16, padding: 28, alignItems: "center", marginTop: 8 }}><View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center", marginBottom: 10 }}><Text style={{ fontSize: 18, color: "#94A3B8" }}>◯</Text></View><Text style={{ fontWeight: "600", fontSize: 13, color: "#334155" }}>Pa gen kliyan</Text><Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, textAlign: "center" }}>Eseye yon lòt rechèch oswa ajoute yon nouvo kliyan</Text></View>;
}

// ── Detail header content (avatar + name + chips; containers differ per caller) ──

export interface DetailHeaderContentProps {
  customer: any;
  debts: any[];
}

export function DetailHeaderContent({ customer, debts }: DetailHeaderContentProps) {
  const sRows = debts.filter((d: any) => d.customer_id === customer.id && Number(d.balance) > 0);
  const sComp = sRows.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);
  const disp = Number(customer.total_debt ?? 0) > 0 ? Number(customer.total_debt) : sComp;
  const hasDebt = sRows.length > 0 || disp > 0;
  return (
    <>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontWeight: "700", fontSize: 18, color: "#0F172A" }}>{(customer.name?.[0] ?? "•").toUpperCase()}</Text>
      </View>
      <Text style={{ fontWeight: "700", fontSize: 17, color: "#0F172A", letterSpacing: -0.3, marginTop: 10, textAlign: "center" }}>{customer.name}</Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "#475569", fontWeight: "500" }}>ID {customer.id_card_number || "—"}</Text></View>
        <View style={{ backgroundColor: hasDebt ? "#FEF2F2" : "#F0FDF4", borderWidth: 1, borderColor: hasDebt ? "#FECACA" : "#BBF7D0", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, fontWeight: "600", color: hasDebt ? "#991B1B" : "#065F46" }}>{fmt(disp)} HTG dèt</Text></View>
        {customer.phone ? <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "#64748B" }}>{customer.phone}</Text></View> : null}
        {customer.address ? <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "#64748B" }} numberOfLines={1}>{customer.address}</Text></View> : null}
      </View>
    </>
  );
}

// ── General info, view-first ──

export interface GeneralInfoViewProps {
  customer: any;
  canManageCustomers: boolean;
  onEdit: () => void;
}

export function GeneralInfoView({ customer, canManageCustomers, onEdit }: GeneralInfoViewProps) {
  return (
    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A", letterSpacing: -0.1 }}>Enfòmasyon jeneral</Text>
          <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Lekti sèlman — tape Modifye si ou vle chanje</Text>
        </View>
        {canManageCustomers && (
          <Pressable onPress={onEdit} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0F172A", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Text style={{ color: "white", fontSize: 11 }}>✎</Text>
            <Text style={{ color: "white", fontWeight: "600", fontSize: 12 }}>Modifye</Text>
          </Pressable>
        )}
      </View>

      <View style={{ marginTop: 12, gap: 8 }}>
        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
          <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600", letterSpacing: 0.4 }}>NON KONPLÈ</Text>
          <Text style={{ fontSize: 14, color: "#0F172A", fontWeight: "600", marginTop: 3 }}>{customer.name || "—"}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600" }}>NIF / CIN</Text>
            <Text style={{ fontSize: 13, color: "#0F172A", fontWeight: "600", marginTop: 3 }}>{customer.id_card_number || "—"}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600" }}>TELEFÒN</Text>
            <Text style={{ fontSize: 13, color: "#0F172A", fontWeight: "600", marginTop: 3 }}>{customer.phone || "—"}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
          <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600" }}>ADRÈS</Text>
          <Text style={{ fontSize: 13, color: "#0F172A", fontWeight: "600", marginTop: 3 }}>{customer.address || "—"}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Credit limit, view-first ──

export interface CreditLimitViewCardProps {
  customer: any;
  isManagerPlus: boolean;
  canManageCustomers: boolean;
}

export function CreditLimitViewCard({ customer, isManagerPlus, canManageCustomers }: CreditLimitViewCardProps) {
  return (
    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A" }}>Limit kredi</Text>
        {!isManagerPlus && <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "600", color: "#94A3B8" }}>Manager+</Text></View>}
      </View>
      <View style={{ marginTop: 8, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 12, alignItems: "center" }}>
        <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600", letterSpacing: 0.4 }}>LIMIT AKTYÈL</Text>
        <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginTop: 4 }}>{customer.credit_limit == null ? "San limit" : `${fmt(Number(customer.credit_limit))} HTG`}</Text>
        {customer.credit_limit_source ? <Text style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>Sous: {customer.credit_limit_source}</Text> : null}
      </View>
      {isManagerPlus && canManageCustomers && <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 8, textAlign: "center" }}>Tape Modifye anwo pou chanje limit</Text>}
    </View>
  );
}

// ── Active debts ──

export interface ActiveDebtsCardProps {
  customer: any;
  debts: any[];
}

export function ActiveDebtsCard({ customer, debts }: ActiveDebtsCardProps) {
  const active = debts.filter(d => d.customer_id === customer.id && Number(d.balance) > 0);
  return (
    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A" }}>Dèt aktif</Text>
        <View style={{ backgroundColor: active.length > 0 ? "#FEF2F2" : "#F0FDF4", borderWidth: 1, borderColor: active.length > 0 ? "#FECACA" : "#BBF7D0", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 11, fontWeight: "700", color: active.length > 0 ? "#991B1B" : "#065F46" }}>{active.length} aktif</Text></View>
      </View>
      {active.length === 0 ? (
        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 14, marginTop: 10, alignItems: "center" }}><Text style={{ fontSize: 12, color: "#94A3B8", fontWeight: "500" }}>Okenn dèt aktif</Text><Text style={{ fontSize: 11, color: "#CBD5E1", marginTop: 2 }}>Kliyan sa a pa gen balans</Text></View>
      ) : (
        active.map(d => {
          const due = d.due_date ? new Date(d.due_date) : null;
          const overdue = due ? due.getTime() < Date.now() : false;
          return (
            <View key={d.id} style={{ backgroundColor: overdue ? "#FEF2F2" : "#FFFBEB", borderWidth: 1, borderColor: overdue ? "#FECACA" : "#FDE68A", borderRadius: 12, padding: 12, marginTop: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A" }} numberOfLines={1}>{d.id}</Text>
                <View style={{ backgroundColor: overdue ? "#DC2626" : "#F59E0B", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "700", color: "white" }}>{fmt(Number(d.balance))} HTG</Text></View>
              </View>
              <Text style={{ fontSize: 11, color: overdue ? "#991B1B" : "#92400E", marginTop: 4, fontWeight: "500" }}>{overdue ? "An reta" : "Poko rive"} · Echèans {due ? due.toLocaleDateString() : "—"}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

// ── Past purchases: Kredi vs Kach/MonCash/NatCash, strictly this client only ──

export interface PurchaseHistoryCardProps {
  customer: any;
  pastCredits: any[];
  pastSales: any[];
  showPastCredits: boolean;
  onToggle: () => void;
}

export function PurchaseHistoryCard({ customer, pastCredits, pastSales, showPastCredits, onToggle }: PurchaseHistoryCardProps) {
  const filteredKredi = Array.from(new Map(pastCredits.filter((c: any) => c.customer_id === customer?.id).map(c => [c.id, c] as const)).values());
  const filteredOtherRaw = pastSales.filter((s: any) => s.customer_id === customer?.id && String(s.payment_method ?? "").toLowerCase() !== "credit");
  const filteredOther = Array.from(new Map(filteredOtherRaw.map(s => [s.id, s] as const)).values());
  const otherSales = filteredOther;
  const krediCount = filteredKredi.length;
  const otherCount = filteredOther.length;
  const payMeta = (m: string) => {
    const v = String(m ?? "").toLowerCase();
    if (v === "moncash") return { label: "MonCash", bg: "#FEF2F2", bd: "#FECACA", tx: "#991B1B", dot: "#EF4444" };
    if (v === "natcash") return { label: "NatCash", bg: "#EFF6FF", bd: "#BFDBFE", tx: "#1E40AF", dot: "#3B82F6" };
    return { label: "Kach", bg: "#F0FDF4", bd: "#BBF7D0", tx: "#065F46", dot: "#22C55E" };
  };
  return (
    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
      <Pressable onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A", letterSpacing: -0.1 }}>Istwa acha kliyan an</Text>
          <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{krediCount} Kredi · {otherCount} Kach/Mobil · {showPastCredits ? "devwale" : "tape pou wè"}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: showPastCredits ? "#0F172A" : "#F8FAFC", borderWidth: 1, borderColor: showPastCredits ? "#0F172A" : "#F1F5F9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: showPastCredits ? "white" : "#475569" }}>{showPastCredits ? "Kache" : "Wè"}</Text>
          <Text style={{ fontSize: 10, color: showPastCredits ? "white" : "#94A3B8" }}>{showPastCredits ? "▴" : "▾"}</Text>
        </View>
      </Pressable>

      {showPastCredits && (
        <View style={{ marginTop: 12, gap: 14 }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12 }}>💳</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#6D28D9", letterSpacing: 0.3 }}>KREDI</Text>
              <View style={{ backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 11, fontWeight: "700", color: "#6D28D9" }}>{krediCount}</Text></View>
              <View style={{ flex: 1, height: 1, backgroundColor: "#EDE9FE", marginLeft: 6 }} />
            </View>
            {krediCount === 0 ? (
              <View style={{ backgroundColor: "#FAF5FF", borderWidth: 1, borderColor: "#E9D5FF", borderRadius: 12, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: "#7C3AED", fontWeight: "600" }}>Poko gen acha Kredi</Text>
                <Text style={{ fontSize: 11, color: "#A78BFA", marginTop: 2 }}>Okenn vant sou kredi pou kliyan sa a</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {filteredKredi.map((c: any) => {
                  const bal = Number(c.balance ?? 0);
                  const amt = Number(c.amount ?? 0);
                  const paid = Math.max(0, amt - bal);
                  const isPaid = bal <= 0.01;
                  const isPartial = !isPaid && paid > 0;
                  const badge = isPaid
                    ? { bg: "#F0FDF4", bd: "#BBF7D0", tx: "#065F46", label: "Peye" }
                    : isPartial
                    ? { bg: "#FFFBEB", bd: "#FDE68A", tx: "#92400E", label: "Pasyèl" }
                    : { bg: "#FEF2F2", bd: "#FECACA", tx: "#991B1B", label: "Dwe" };
                  const due = c.due_date ? new Date(c.due_date) : null;
                  const dt = c.updated_at ?? c.created_at ?? null;
                  return (
                    <View key={c.id} style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E9D5FF", borderRadius: 12, padding: 10, borderLeftWidth: 3, borderLeftColor: "#7C3AED" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={{ backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "700", color: "#6D28D9" }}>KREDI</Text></View>
                            <Text style={{ fontWeight: "600", fontSize: 11, color: "#0F172A" }} numberOfLines={1}>{c.sale_id ?? c.id}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{dt ? new Date(dt).toLocaleDateString() : "—"}{due ? ` · Echèans ${due.toLocaleDateString()}` : ""}</Text>
                        </View>
                        <View style={{ backgroundColor: badge.bg, borderWidth: 1, borderColor: badge.bd, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: badge.tx }}>{badge.label}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                        <View style={{ flex: 1, backgroundColor: "#FAF5FF", borderWidth: 1, borderColor: "#E9D5FF", borderRadius: 10, padding: 8, alignItems: "center" }}>
                          <Text style={{ fontSize: 10, color: "#7C3AED", fontWeight: "600", letterSpacing: 0.3 }}>MONTAN</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#0F172A", marginTop: 2 }}>{fmt(amt)} HTG</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: badge.bg, borderWidth: 1, borderColor: badge.bd, borderRadius: 10, padding: 8, alignItems: "center" }}>
                          <Text style={{ fontSize: 10, color: badge.tx, fontWeight: "600", letterSpacing: 0.3 }}>RÈS</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: badge.tx, marginTop: 2 }}>{fmt(bal)} HTG</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 10, padding: 8, alignItems: "center" }}>
                          <Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600", letterSpacing: 0.3 }}>PEYE</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#0F172A", marginTop: 2 }}>{fmt(paid)} HTG</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12 }}>💵</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#065F46", letterSpacing: 0.3 }}>KACH · MONCASH · NATCASH</Text>
              <View style={{ backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontSize: 11, fontWeight: "700", color: "#065F46" }}>{otherCount}</Text></View>
              <View style={{ flex: 1, height: 1, backgroundColor: "#BBF7D0", marginLeft: 6 }} />
            </View>
            {otherCount === 0 ? (
              <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "500" }}>Poko gen acha Kach/Mobil</Text>
                <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Okenn vant comptant pou kliyan sa a</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {otherSales.map((s: any) => {
                  const m = payMeta(s.payment_method);
                  const dt = s.updated_at ?? s.created_at ?? null;
                  return (
                    <View key={s.id} style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 10, borderLeftWidth: 3, borderLeftColor: m.dot }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={{ backgroundColor: m.bg, borderWidth: 1, borderColor: m.bd, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "700", color: m.tx }}>{m.label.toUpperCase()}</Text></View>
                            <Text style={{ fontWeight: "600", fontSize: 11, color: "#0F172A" }} numberOfLines={1}>{s.sale_number ?? s.id}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{dt ? new Date(dt).toLocaleDateString() : "—"} · {fmt(Number(s.total ?? s.amount ?? 0))} HTG</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontWeight: "700", fontSize: 12, color: "#0F172A" }}>{fmt(Number(s.total ?? s.amount ?? 0))} HTG</Text>
                          <Text style={{ fontSize: 10, color: "#64748B", marginTop: 1 }}>{s.status ?? "completed"}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Modification history timeline ──

export interface ModificationHistoryCardProps {
  history: any[];
}

export function ModificationHistoryCard({ history }: ModificationHistoryCardProps) {
  return (
    <View style={{ backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#F1F5F9", padding: 12 }}>
      <Text style={{ fontWeight: "600", fontSize: 13, color: "#0F172A" }}>Istwa modifikasyon</Text>
      <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>10 dènye chanjman</Text>
      {history.length === 0 ? (
        <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 14, marginTop: 10, alignItems: "center" }}><Text style={{ fontSize: 12, color: "#94A3B8" }}>Poko gen istwa</Text></View>
      ) : (
        <View style={{ marginTop: 10, gap: 8 }}>
          {history.map((h: any) => (
            <View key={h.id} style={{ flexDirection: "row", gap: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: "#64748B" }}>✎</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: "#0F172A" }}>{h.field_name}</Text>
                  <View style={{ backgroundColor: "#0F172A", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 10, fontWeight: "600", color: "white" }}>{h.action}</Text></View>
                  <Text style={{ fontSize: 10, color: "#94A3B8" }}>{h.created_at ? new Date(h.created_at).toLocaleDateString() : ""}</Text>
                </View>
                <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }} numberOfLines={1}>Itilizatè {h.user_id}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  <View style={{ flex: 1, backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 8, padding: 6 }}><Text style={{ fontSize: 10, color: "#94A3B8", fontWeight: "600" }}>ANSYEN</Text><Text style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>{h.old_value ?? "—"}</Text></View>
                  <View style={{ flex: 1, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 8, padding: 6 }}><Text style={{ fontSize: 10, color: "#15803D", fontWeight: "700" }}>NOUVO</Text><Text style={{ fontSize: 11, color: "#0F172A", marginTop: 1, fontWeight: "600" }}>{h.new_value ?? "—"}</Text></View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
