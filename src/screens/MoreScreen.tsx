// "More" (Plis) hub — houses everything that left the navbar, gated per role.
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NAV_MENU_TEXT_SCALE } from "../theme";
import { useResponsive } from "../responsive";
import type { BusinessType, Role } from "../users";
import CatalogScreen from "./CatalogScreen";
import InventoryScreen from "./InventoryScreen";
import CustomersScreen from "./CustomersScreen";
import ReportsScreen from "./ReportsScreen";
import SuppliersScreen from "./SuppliersScreen";
import OrdersScreen from "./OrdersScreen";

export type MoreEntry = "reports" | "catalog" | "inventory" | "customers" | "suppliers" | "orders" | "store" | "staff";

type EntryDef = {
  id: MoreEntry;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  roles: string[];
};

const ENTRIES: EntryDef[] = [
  { id: "reports", title: "Rapò", subtitle: "Reports", icon: "bar-chart-outline", roles: ["owner", "admin", "manager"] },
  { id: "catalog", title: "Katalòg", subtitle: "Catalog", icon: "cube-outline", roles: ["owner", "admin", "manager", "cashier", "associate", "cook"] },
  { id: "inventory", title: "Envantè", subtitle: "Inventory", icon: "archive-outline", roles: ["owner", "admin", "manager", "cashier"] },
  { id: "customers", title: "Kliyan", subtitle: "Customers", icon: "people-outline", roles: ["owner", "admin", "manager", "cashier"] },
  { id: "suppliers", title: "Founisè", subtitle: "Suppliers", icon: "storefront-outline", roles: ["owner", "admin"] },
  { id: "orders", title: "Kòmand", subtitle: "Orders", icon: "clipboard-outline", roles: ["owner", "admin", "manager", "cashier", "associate", "cook"] },
  { id: "store", title: "Magazen", subtitle: "Store", icon: "business-outline", roles: ["owner", "admin", "manager", "cashier", "associate", "cook"] },
  { id: "staff", title: "Ekip", subtitle: "Staff", icon: "people-circle-outline", roles: ["owner", "admin", "manager"] },
];

// +15% readability bump across menu text (22→25.3, 15→17.3, 12→13.8, 11→12.7, 13→15)
const scale = (n: number) => Math.round(n * NAV_MENU_TEXT_SCALE * 10) / 10;

export default function MoreScreen({
  role = "cashier",
  businessType = "retail",
  currentUser,
  storeId,
  storeName,
  inventoryVersion,
  onInventorySaved,
  onOpenStore,
  onOpenTeam,
  onLogout,
  onAddSale,
  userStoreIds = [],
  stores = [],
  deviceId = "device-unknown",
}: {
  role?: Role;
  businessType?: BusinessType;
  currentUser?: any;
  storeId: string;
  storeName?: string;
  inventoryVersion: number;
  onInventorySaved: () => void;
  onOpenStore: () => void;
  onOpenTeam?: () => void;
  onLogout: () => void;
  onAddSale?: (c: any) => void;
  userStoreIds?: string[];
  stores?: { id: string; name: string }[];
  deviceId?: string;
}) {
  const { padH } = useResponsive();
  const [selection, setSelection] = useState<MoreEntry | null>(null);
  const visible = ENTRIES.filter(e => e.roles.includes(role as string));
  const initials = String(currentUser?.name ?? role ?? "•").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w[0] ?? "").toUpperCase()).join("") || "•";

  const openEntry = (id: MoreEntry) => {
    if (id === "store") { onOpenStore(); return; }
    if (id === "staff") { onOpenTeam?.(); return; }
    setSelection(id);
  };

  const renderBody = () => {
    switch (selection) {
      case "reports":
        return (
          <ReportsScreen
            role={role}
            storeId={storeId}
            storeName={storeName}
            currentUser={currentUser}
            userStoreIds={userStoreIds}
            deviceId={deviceId}
            onBack={() => setSelection(null)}
          />
        );
      case "catalog":
        return (
          <CatalogScreen
            role={role}
            currentUser={currentUser}
            onOpenInventory={() => setSelection("inventory")}
            inventoryVersion={inventoryVersion}
            onBack={() => setSelection(null)}
          />
        );
      case "inventory":
        return (
          <InventoryScreen
            role={role}
            currentUser={currentUser}
            onClose={() => setSelection(null)}
            onSaved={onInventorySaved}
          />
        );
      case "customers":
        return <CustomersScreen role={role} currentUser={currentUser} onAddSale={onAddSale} />;
      case "suppliers":
        return (
          <SuppliersScreen
            role={role}
            currentUser={currentUser}
            storeId={storeId}
            storeName={storeName}
            userStoreIds={userStoreIds}
            stores={stores}
          />
        );
      case "orders":
        return (
          <OrdersScreen
            role={role}
            currentUser={currentUser}
            storeId={storeId}
            storeName={storeName}
            userStoreIds={userStoreIds}
            stores={stores}
          />
        );
      default:
        return null;
    }
  };

  if (selection) {
    return (
      <View style={{ flex: 1 }}>
        {renderBody()}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ paddingHorizontal: padH, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: scale(22), color: "#fff", letterSpacing: -0.4 }}>Plis</Text>
            <Text style={{ color: "#8e8e93", fontSize: scale(12), marginTop: 2 }}>
              {businessType === "retail" ? "Zouti magazen" : "Zouti biznis"} · <Text style={{ color: "#2f80ed", fontWeight: "700" }}>{role}</Text>
            </Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: "#262626", marginTop: 14 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 24 }}>
        <View style={{ height: 12 }} />
        {visible.map(e => (
        <Pressable
          key={e.id}
          onPress={() => openEntry(e.id)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 18, padding: 14, marginBottom: 10 }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={e.icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }}>{e.title}</Text>
            <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>{e.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
        </Pressable>
      ))}
      {visible.length === 0 ? (
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={{ color: "#8e8e93", fontSize: scale(13) }}>Pa gen aksè.</Text>
        </View>
      ) : null}
      <Pressable
        onPress={onLogout}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 18, padding: 14, marginTop: 2 }}
      >
        <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="log-out-outline" size={22} color="#FF453A" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 17, color: "#FF453A" }}>Dekonekte</Text>
          <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>Log out</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
      </Pressable>
    </ScrollView>
    </View>
  );
}
