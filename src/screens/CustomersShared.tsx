import React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { fmtG, fmt, monoStyle } from "../format";

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
          <Text style={{ fontWeight: "700", fontSize: 14, color: debtColor, letterSpacing: -0.2, textAlign: "right", ...monoStyle }}>{fmtG(totalDebt)}</Text>
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

export interface CreditLimitViewCardProps {
  customer: any;
  isManagerPlus: boolean;
  canManageCustomers: boolean;
}

export function CreditLimitViewCard({ customer, isManagerPlus, canManageCustomers }: CreditLimitViewCardProps) {
  return (
    <View style={{ paddingVertical: 14 }}>
      <Text style={{ fontWeight: "700", fontSize: 17, color: "#fff" }}>Limit kredi</Text>
      <Text style={{ fontSize: 17, color: "#fff", marginTop: 4 }}>
        {customer.credit_limit == null ? "San limit" : `${fmtG(Number(customer.credit_limit))}`}
      </Text>
    </View>
  );
}
