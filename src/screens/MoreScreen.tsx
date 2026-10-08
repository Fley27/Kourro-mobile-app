// "More" (Plis) hub — houses everything that left the navbar, gated per role.
// Phone: the Plis tab renders the list hub, then bodies (its selection is
// internal). Tablet: the MenuSidebar owns navigation, so this component is
// passed a CONTROLLED selection and renders only the body — the hub never
// shows (the sidebar is the menu). Entry definitions/ranking are shared
// with the sidebar via src/menu/entries.ts so the two navs can't drift.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NAV_MENU_TEXT_SCALE } from "../theme";
import { useResponsive } from "../responsive";
import { getDb } from "../db";
import type { BusinessType, Role } from "../users";
import CatalogScreen from "./CatalogScreen";
import InventoryScreen from "./InventoryScreen";
import CustomersScreen from "./CustomersScreen";
import ReportsScreen from "./ReportsScreen";
import SalesReportScreen from "./SalesReportScreen";
import CreditReportScreen from "./credit/CreditReportScreen";
import BusinessGuardScreen from "./BusinessGuardScreen";
import SuppliersScreen from "./SuppliersScreen";
import OrdersScreen from "../orders/OrdersScreen";
import PickupsScreen from "./PickupsScreen";
import ProformatScreen from "./promos/ProformatScreen";
import { ordersUI } from "../ordersUI";
import { inLocalDay, localDayKey } from "../businessGuard";
import { confirmClearCatalog } from "../menu/clearCatalog";
import { ENTRIES, rank, type MoreEntry } from "../menu/entries";
import type { Proformat } from "../promos/types";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

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
  onOpenShift,
  onLogout,
  userStoreIds = [],
  stores = [],
  deviceId = "device-unknown",
  onLoadIntoCart,
  selection: controlledSelection,
  onSelectionChange,
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
  onOpenShift?: () => void;
  onLogout: () => void;
  userStoreIds?: string[];
  stores?: { id: string; name: string }[];
  deviceId?: string;
  /** Hand a proformat's lines to the POS tab (App swaps the seed into POS). */
  onLoadIntoCart?: (proformat: Proformat, customerId: string | null) => void;
  /** CONTROLLED selection — the tablet passes it (App's moreSel) so the
   *  sidebar drives the body. Omit both on the phone: the hub stays
   *  uncontrolled so re-pressing Plis can remount/reset it. */
  selection?: MoreEntry | null;
  onSelectionChange?: (s: MoreEntry | null) => void;
}) {
  const { padH, isTablet } = useResponsive();
  const [internalSelection, setInternalSelection] = useState<MoreEntry | null>(null);
  const selection = controlledSelection !== undefined ? controlledSelection : internalSelection;
  const setSelection = (s: MoreEntry | null) => {
    if (controlledSelection !== undefined) onSelectionChange?.(s);
    else setInternalSelection(s);
  };
  // Pending deliveries waiting on "Rive" — surfaced as a badge on Envantè.
  // Re-read every time the hub becomes visible (a receive inside Inventory
  // doesn't bump inventoryVersion) and whenever a save does. Skipped on the
  // tablet: the sidebar owns the badges (this component only shows bodies).
  const [pendingBatches, setPendingBatches] = useState(0);
  useEffect(() => {
    if (isTablet || selection) return;
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const rows = (await db.getAllAsync(
          "SELECT COUNT(*) AS n FROM batches WHERE status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL)"
        )) as any[];
        if (alive) setPendingBatches(Number(rows?.[0]?.n ?? 0));
      } catch {}
    })();
    return () => { alive = false; };
  }, [selection, inventoryVersion]);
  // Not-yet-paid orders badge on the Kòmand row — the same live count the
  // root OrdersFab shows (OrdersScreen reloads + the root DB refresh own it).
  // Tablet: the sidebar's Kòmand badge owns it instead.
  const [ordersCount, setOrdersCount] = useState(0);
  useEffect(() => (isTablet ? undefined : ordersUI.subscribeCount(setOrdersCount)), []);
  const badges: Partial<Record<MoreEntry, number>> = { inventory: pendingBatches };
  if (ordersCount > 0) badges.orders = ordersCount;
  // Live shift status for the Shift row — one continuous flow: the row shows
  // whether YOU have a shift and what the team needs, no separate screens.
  const [shiftLive, setShiftLive] = useState<{ mine: string | null; active: number; pending: number } | null>(null);
  useEffect(() => {
    if (isTablet || selection) return;
    let alive = true;
    const refreshShiftLive = async () => {
      try {
        const db = await getDb();
        const day = localDayKey();
        const shifts = ((await db.getAllAsync("SELECT * FROM shifts").catch(() => [])) ?? []) as any[];
        const reps = ((await db.getAllAsync("SELECT * FROM daily_reports").catch(() => [])) ?? []) as any[];
        // Overnight-proof: any open/pending shift counts, whatever day it started.
        const mine = shifts.find((s: any) => (s.cashier_id ?? null) === (currentUser?.id ?? null) && (s.status === "pending" || s.status === "open")) ?? null;
        const teamToday = shifts.filter((s: any) => inLocalDay(s.start_time, day));
        const active = teamToday.filter((s: any) => s.status === "open").length;
        const pending = teamToday.filter((s: any) => s.status === "pending").length
          + reps.filter((r: any) => r.report_date === day && r.status === "submitted").length;
        if (alive) setShiftLive({ mine: mine ? mine.status : null, active, pending });
      } catch {}
    };
    refreshShiftLive();
    const t = setInterval(refreshShiftLive, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [selection, currentUser?.id]);
  const isFloorSup = role === "manager" || role === "admin" || role === "owner";
  const shiftBadge = !shiftLive ? 0 : !isFloorSup
    ? (shiftLive.mine ? 0 : 1)
    : shiftLive.pending;
  if (shiftBadge > 0) badges.shift = shiftBadge;
  const [menuSearch, setMenuSearch] = useState("");
  // Search runs over role-visible entries only — access levels always apply.
  const visible = ENTRIES.filter(e => e.roles.includes(role as string))
    .filter(e => {
      const q = menuSearch.trim().toLowerCase();
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.subtitle.toLowerCase().includes(q);
    })
    .sort((a, b) => rank(role, a.id) - rank(role, b.id));
  const initials = String(currentUser?.name ?? role ?? "•").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w[0] ?? "").toUpperCase()).join("") || "•";

  const openEntry = (id: MoreEntry) => {
    if (id === "store") { onOpenStore(); return; }
    if (id === "staff") { onOpenTeam?.(); return; }
    if (id === "shift") { onOpenShift?.(); return; }
    setSelection(id);
  };

  // Back-to-hub only exists on the phone (bodies can bounce to the Plis
  // list). On the tablet there is no hub — the sidebar never unmounts and
  // its rows ARE the navigation, so bodies get onBack=undefined and hide
  // their chevron (Pickups takes showBack={false} for the same reason).
  const back = isTablet ? undefined : () => setSelection(null);

  const renderBody = () => {
    switch (selection) {
      // Tablet sidebar rows — the Rapò hub flattened (the phone mounts
      // ReportsScreen, which keeps its own hub of these three).
      case "sales":
        return (
          <SalesReportScreen
            role={role}
            storeId={storeId}
            storeName={storeName}
            currentUser={currentUser}
            userStoreIds={userStoreIds}
            deviceId={deviceId}
            onBack={back}
          />
        );
      case "credits":
        return (
          <CreditReportScreen
            role={role}
            storeId={storeId}
            storeName={storeName}
            userStoreIds={userStoreIds}
            deviceId={deviceId}
            onBack={back}
          />
        );
      case "guard":
        return (
          <BusinessGuardScreen
            role={role}
            storeId={storeId}
            storeName={storeName}
            currentUser={currentUser}
            userStoreIds={userStoreIds}
            deviceId={deviceId}
            onBack={back}
          />
        );
      case "reports":
        return (
          <ReportsScreen
            role={role}
            storeId={storeId}
            storeName={storeName}
            currentUser={currentUser}
            userStoreIds={userStoreIds}
            deviceId={deviceId}
            onBack={back}
          />
        );
      case "catalog":
        return (
          <CatalogScreen
            role={role}
            currentUser={currentUser}
            onOpenInventory={() => setSelection("inventory")}
            inventoryVersion={inventoryVersion}
            onBack={back}
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
        return <CustomersScreen role={role} currentUser={currentUser} />;
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
            storeId={storeId}
            deviceId={deviceId}
            storeName={storeName}
            role={role}
            currentUser={currentUser}
            businessType={businessType}
          />
        );
      case "pickups":
        return (
          <PickupsScreen
            role={role}
            currentUser={currentUser}
            storeId={storeId}
            storeName={storeName}
            onBack={back}
            showBack={!isTablet}
          />
        );
      case "proformat":
        return (
          <ProformatScreen
            role={role}
            currentUser={currentUser}
            storeId={storeId}
            storeName={storeName}
            deviceId={deviceId}
            onBack={back}
            onLoadIntoCart={onLoadIntoCart}
          />
        );
      default:
        return null;
    }
  };

  if (selection && !isTablet) {
    return (
      <View style={{ flex: 1 }}>
        {renderBody()}
      </View>
    );
  }

  // Tablet: bodies only — the MenuSidebar IS the menu (it sits permanently in
  // the rail), so the list hub never renders here and tool rows land directly
  // on their screen. Empty state = a body without a selection (can happen
  // after Inventory closes itself).
  if (isTablet) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {selection ? (
          renderBody()
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(47,128,237,0.12)", borderWidth: 1, borderColor: "rgba(47,128,237,0.3)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="grid-outline" size={28} color="#2f80ed" />
            </View>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, marginTop: 14, textAlign: "center" }}>Chwazi yon zouti</Text>
            <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 }}>Tape yon zouti nan meni an pou louvri l isit la.</Text>
          </View>
        )}
      </View>
    );
  }

  const hubView = (
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
      <View style={{ paddingHorizontal: padH, paddingBottom: 4 }}>
        <View style={{ height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
          <TextInput placeholder="Chèche zouti…" placeholderTextColor="#8e8e93" value={menuSearch} onChangeText={setMenuSearch} style={{ flex: 1, fontSize: 16, color: "#fff" }} returnKeyType="search" />
          {menuSearch.length > 0 && <Pressable onPress={() => setMenuSearch("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
        </View>
      </View>
      <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 24 }}>
        <View style={{ height: 12 }} />
        {visible.map(e => {
          const isShiftRow = e.id === "shift";
          const shiftDot = !isShiftRow || !shiftLive ? null
            : !isFloorSup
              ? (shiftLive.mine === "open" ? "#34d399" : shiftLive.mine === "pending" ? "#fbbf24" : "#fb7185")
              : shiftLive.pending > 0 ? "#fbbf24" : shiftLive.active > 0 ? "#34d399" : "#8e8e93";
          const shiftSub = !isShiftRow || !shiftLive ? e.subtitle
            : !isFloorSup
              ? (shiftLive.mine === "open" ? "Aktif • vant debloke" : shiftLive.mine === "pending" ? "An atant konfimasyon • vant debloke" : "Ouvri chanjman • aksyon")
              : `${shiftLive.active} aktif • ${shiftLive.pending} ap tann • live jodi a`;
          return (
        <Pressable
          key={e.id}
          onPress={() => openEntry(e.id)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: isShiftRow && shiftLive && ((!isFloorSup && !shiftLive.mine) || (isFloorSup && shiftLive.pending > 0)) ? "#fbbf24" : "#2b2b2b", borderRadius: 18, padding: 14, marginBottom: 10 }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={e.icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }}>{e.title}</Text>
              {shiftDot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shiftDot }} /> : null}
            </View>
            <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>{shiftSub}</Text>
          </View>
          {badges[e.id] ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(77,163,224,0.16)", borderWidth: 1, borderColor: "rgba(77,163,224,0.35)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#4da3e0" }} />
              <Text style={{ fontSize: 12, fontWeight: "800", color: "#4da3e0" }}>{badges[e.id]}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
        </Pressable>
          );
        })}
      {visible.length === 0 ? (
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={{ color: "#8e8e93", fontSize: scale(13) }}>{menuSearch.trim() ? "Pa gen rezilta." : "Pa gen aksè."}</Text>
        </View>
      ) : null}
      {role === "owner" && (
        <Pressable
          onPress={() => confirmClearCatalog()}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(224,108,91,0.08)", borderWidth: 1, borderColor: "rgba(224,108,91,0.4)", borderRadius: 18, padding: 14, marginTop: 2 }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "rgba(224,108,91,0.16)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="trash-outline" size={22} color="#e06c5b" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 17, color: "#e06c5b" }}>Efase done katalòg</Text>
            <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>Pwodwi, inite, variant, batch, pri, founisè</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
        </Pressable>
      )}
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
    </KeyboardSafeScrollView>
    </View>
  );

  return hubView;
}
