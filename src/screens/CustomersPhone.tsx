import React from "react";
import { View, Text, TextInput, Pressable, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Dark reference design: black list, pill search + filter, initial tiles,
// name + phone|email rows with hairline separators. Phone only.

export interface CustomersPhoneProps {
  customers: any[];
  debts: any[];
  displayCustomers: any[];
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  onAdd?: () => void;
  padH: number;
  width: number;
  isTablet: boolean;
}

function initials(name: string) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function CustomersPhone(props: CustomersPhoneProps) {
  const { displayCustomers, search, setSearch, showDebtOnly, setShowDebtOnly, selectedCustomerId, setSelectedCustomerId, onAdd, padH } = props;
  const sorted = [...displayCustomers].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Title + overflow */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: padH, paddingTop: 18, paddingBottom: 14 }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Kliyan</Text>
        <Pressable
          onPress={onAdd}
          disabled={!onAdd}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center", opacity: onAdd ? 1 : 0.4 }}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      </View>

      {/* Search pill + filter */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, marginBottom: 8 }}>
        <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chèche"
            placeholderTextColor="#8e8e93"
            style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color="#8e8e93" />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setShowDebtOnly(!showDebtOnly)}
          style={{
            width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
            backgroundColor: showDebtOnly ? "#fff" : "#000",
            borderWidth: 1, borderColor: showDebtOnly ? "#fff" : "#3a3a3c",
          }}
        >
          <Ionicons name="filter" size={20} color={showDebtOnly ? "#000" : "#fff"} />
        </Pressable>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item, index) => `${item.id}__${index}`}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const isSelected = item.id === selectedCustomerId;
          const contact = [item.phone, item.email].filter(Boolean).join(" | ");
          return (
            <Pressable onPress={() => setSelectedCustomerId(isSelected ? null : item.id)} style={{ backgroundColor: isSelected ? "#161616" : "#000" }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingVertical: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initials(item.name)}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }} numberOfLines={1}>{contact || "—"}</Text>
                </View>
              </View>
              <View style={{ height: 1, backgroundColor: "#262626", marginLeft: padH + 64 }} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Pa gen kliyan</Text>
            <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>Eseye yon lòt rechèch</Text>
          </View>
        }
      />
    </View>
  );
}
