// Reports (Rapò) — hub with three entries: Sales (the aggregate numbers
// dashboard, its own screen), Credits (the rule-based credit health view)
// and Business Guard (renamed from KPI: weekly action queue, business
// health, per-employee profiles). Each entry owns its data loading; this
// file only routes and lists them.
import React, { useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text } from "../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import { palette, topIconBtn } from "../theme";
import SalesReportScreen from "./SalesReportScreen";
import CreditReportScreen from "./credit/CreditReportScreen";
import BusinessGuardScreen from "./BusinessGuardScreen";

export default function ReportsScreen({
  role = "cashier",
  storeId = "demo-store-id",
  storeName,
  currentUser,
  userStoreIds = [],
  deviceId = "device-unknown",
  onBack,
}: {
  role?: string;
  storeId?: string;
  storeName?: string;
  currentUser?: any;
  userStoreIds?: string[];
  deviceId?: string;
  onBack?: () => void;
}) {
  const [view, setView] = useState<"hub" | "sales" | "guard" | "credit">("hub");

  // Decision-support views: owner, admin, manager only — never cashier or
  // stock (Business Guard carries salaries, deficit actions and net profit).
  const showCredit = ["owner", "admin", "manager"].includes(String(role));
  const showGuard = showCredit;

  if (view === "sales") {
    return (
      <SalesReportScreen
        role={role}
        storeId={storeId}
        storeName={storeName}
        currentUser={currentUser}
        userStoreIds={userStoreIds}
        deviceId={deviceId}
        onBack={() => setView("hub")}
      />
    );
  }

  if (view === "credit") {
    return (
      <CreditReportScreen
        role={role}
        storeId={storeId}
        storeName={storeName}
        userStoreIds={userStoreIds}
        deviceId={deviceId}
        onBack={() => setView("hub")}
      />
    );
  }

  if (view === "guard") {
    return (
      <BusinessGuardScreen
        role={role}
        storeId={storeId}
        storeName={storeName}
        currentUser={currentUser}
        userStoreIds={userStoreIds}
        deviceId={deviceId}
        onBack={() => setView("hub")}
      />
    );
  }

  const Row = ({ title, sub, onPress }: { title: string; sub?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 }}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        ) : (
          <View style={{ width: topIconBtn.size }} />
        )}
        <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Reports</Text>
        <View style={{ width: topIconBtn.size }} />
      </View>
      <View style={{ height: 1, backgroundColor: "#262626", marginTop: 14 }} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Row title="Sales" onPress={() => setView("sales")} />
        {showCredit ? <Row title="Credits" sub="Outstanding, aging and per-customer limits" onPress={() => setView("credit")} /> : null}
        {showGuard ? (
          <Row title="Business Guard" sub="Weekly queue, business health and employee profiles" onPress={() => setView("guard")} />
        ) : null}
      </ScrollView>
    </View>
  );
}
