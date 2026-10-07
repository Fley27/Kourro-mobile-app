// MenuSidebar — the tablet's navigation chrome. This IS the MoreScreen menu:
// the phone's "Plis" list, grouped into sections (Rapò / Operasyon / Stock /
// Moun / Zouti) and parked permanently in the left rail, so the content area
// never needs a "back to the list". Rows route three ways:
//   • tab rows      → App.setTab (Dashboard, Vant, Tranzaksyon, Kliyan, Kòmand)
//   • tool rows     → App.setTab("more") + moreSel (bodies inside MoreScreen)
//   • overlay rows  → Shift / Store / Team callbacks App already owns
// Collapse toggle (the white panel-toggle chip in the header) shrinks the menu
// to the classic 88pt icon rail; App provides the current width via
// SidebarWidthProvider so every screen's useResponsive() width reflows in the
// same render pass.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Tab, visibleTabsFor } from "./BottomNav";
import { SIDEBAR_RAIL, MENU_W_EXPANDED } from "../responsive";
import {
  ENTRIES,
  REPORT_ROWS,
  SIDEBAR_TITLE,
  SIDEBAR_SUBTITLE,
  type EntryDef,
  type IconName,
  type MoreEntry,
} from "../menu/entries";
import { tabsUI } from "../tabsUI";
import { ordersUI } from "../ordersUI";
import { getDb } from "../db";
import { inLocalDay, localDayKey } from "../businessGuard";
import { ht } from "../i18n";
import { roleLabel as roleLabelOf, type Role, type BusinessType } from "../users";
import UserProfileSheet from "./UserProfileSheet";

const ACTIVE_BG = "rgba(255,255,255,0.10)";
const INACTIVE = "#8E8E93";

const EYEBROW = {
  fontSize: 10,
  fontWeight: "800" as const,
  letterSpacing: 1.4,
  textTransform: "uppercase" as const,
  color: "#6e6e73",
  marginTop: 18,
  marginBottom: 6,
  marginHorizontal: 12,
};

/** Panel-toggle glyph (the mock): a rounded square outline with the panel bar
 *  hugging the right edge. Built from Views — no glyph-map dependency, exact
 *  proportions at any size. */
function PanelToggleIcon({ size = 18, color = "#16130c" }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        borderWidth: Math.max(1.4, size * 0.09),
        borderColor: color,
        padding: size * 0.16,
        justifyContent: "center",
      }}
    >
      <View
        style={{
          alignSelf: "flex-end",
          width: size * 0.24,
          height: "100%",
          borderRadius: size * 0.09,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

type Badge = { n: number; bg: string; fg: string };

type Row = {
  key: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  active?: boolean;
  badge?: Badge;
  /** Small status dot on the icon (Shift's live state). */
  dot?: string | null;
  iconColor?: string;
  titleColor?: string;
  onPress: () => void;
};

type Section = { header?: string; rows: Row[] };

export function MenuSidebar({
  role,
  currentUserId,
  userName,
  storeName,
  businessType,
  inventoryVersion,
  activeTab,
  moreSelection,
  collapsed,
  onToggle,
  onTab,
  onTool,
  onPosOpen,
  onOpenStore,
  onOpenTeam,
  onOpenShift,
  onLogout,
}: {
  role: string;
  currentUserId: string | null;
  /** Header profile card — display only, no account management here. */
  userName: string;
  storeName: string;
  businessType: BusinessType;
  inventoryVersion: number;
  activeTab: Tab;
  moreSelection: MoreEntry | null;
  collapsed: boolean;
  onToggle: () => void;
  onTab: (t: Tab) => void;
  onTool: (id: MoreEntry) => void;
  /** Vant with open suspended sales → jump to POS + raise the tabs sheet. */
  onPosOpen?: () => void;
  onOpenStore: () => void;
  onOpenTeam: () => void;
  onOpenShift: () => void;
  onLogout: () => void;
}) {
  const insets = useSafeAreaInsets();
  const width = collapsed ? SIDEBAR_RAIL : MENU_W_EXPANDED;
  // Header profile card — lives in the rail header, not the row list.
  const [profileOpen, setProfileOpen] = useState(false);
  const roleName = roleLabelOf(role as Role, businessType);

  // ── Badges — same sources the old rail + Plis list used, but always live
  // here (the sidebar never unmounts while it's shown) ──
  const [suspended, setSuspended] = useState(0);
  useEffect(() => tabsUI.subscribeCount(setSuspended), []);
  const [ordersCount, setOrdersCount] = useState(0);
  useEffect(() => ordersUI.subscribeCount(setOrdersCount), []);
  // Pending deliveries waiting on "Rive" — Envantè row badge.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const rows = (await db.getAllAsync(
          "SELECT COUNT(*) AS n FROM batches WHERE status = 'pending' AND (is_deleted = 0 OR is_deleted IS NULL)"
        )) as any[];
        if (alive) setPending(Number(rows?.[0]?.n ?? 0));
      } catch {}
    })();
    return () => { alive = false; };
  }, [inventoryVersion]);
  // Live shift status — Shift row subtitle, dot and badge (one continuous
  // flow: the row shows whether YOU have a shift and what the team needs).
  const [shiftLive, setShiftLive] = useState<{ mine: string | null; active: number; pending: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const db = await getDb();
        const day = localDayKey();
        const shifts = ((await db.getAllAsync("SELECT * FROM shifts").catch(() => [])) ?? []) as any[];
        const reps = ((await db.getAllAsync("SELECT * FROM daily_reports").catch(() => [])) ?? []) as any[];
        // Overnight-proof: any open/pending shift counts, whatever day it started.
        const mine = shifts.find((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null) && (s.status === "pending" || s.status === "open")) ?? null;
        const teamToday = shifts.filter((s: any) => inLocalDay(s.start_time, day));
        const active = teamToday.filter((s: any) => s.status === "open").length;
        const pendingN = teamToday.filter((s: any) => s.status === "pending").length
          + reps.filter((r: any) => r.report_date === day && r.status === "submitted").length;
        if (alive) setShiftLive({ mine: mine ? mine.status : null, active, pending: pendingN });
      } catch {}
    };
    refresh();
    const t = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [currentUserId]);

  const isFloorSup = role === "manager" || role === "admin" || role === "owner";
  const shiftBadge = !shiftLive ? 0 : !isFloorSup
    ? (shiftLive.mine ? 0 : 1)
    : shiftLive.pending;
  const shiftDot = !shiftLive ? null
    : !isFloorSup
      ? (shiftLive.mine === "open" ? "#34d399" : shiftLive.mine === "pending" ? "#fbbf24" : "#fb7185")
      : shiftLive.pending > 0 ? "#fbbf24" : shiftLive.active > 0 ? "#34d399" : "#8e8e93";
  const shiftSub = !shiftLive
    ? "Chanjman • rapò • kès"
    : !isFloorSup
      ? (shiftLive.mine === "open" ? "Aktif • vant debloke" : shiftLive.mine === "pending" ? "An atant konfimasyon • vant debloke" : "Ouvri chanjman • aksyon")
      : `${shiftLive.active} aktif • ${shiftLive.pending} ap tann • live jodi a`;

  // ── Row assembly — gating mirrors today's reachability exactly:
  //  • tab rows gate on visibleTabsFor(role) (the old rail's set);
  //  • tool rows gate on EntryDef.roles (the old Plis list);
  //  • Kliyan / Kòmand take the UNION (cook got Kliyan from the rail, manager
  //    got Kòmand from Plis — either source keeps their access). ──
  const vt = visibleTabsFor(role);
  const defOf = (id: MoreEntry): EntryDef | undefined =>
    ENTRIES.find(e => e.id === id) ?? REPORT_ROWS.find(e => e.id === id);
  const roleHas = (id: MoreEntry) => defOf(id)?.roles.includes(role) ?? false;
  const titleOf = (id: MoreEntry) => SIDEBAR_TITLE[id] ?? defOf(id)?.title ?? "";
  const subOf = (id: MoreEntry) => SIDEBAR_SUBTITLE[id] ?? defOf(id)?.subtitle;
  const iconOf = (id: MoreEntry) => defOf(id)?.icon ?? "grid-outline";
  const toolRow = (id: MoreEntry, extra?: Partial<Row>): Row => ({
    key: id,
    title: titleOf(id),
    subtitle: subOf(id),
    icon: iconOf(id),
    active: activeTab === "more" && moreSelection === id,
    onPress: () => onTool(id),
    ...extra,
  });

  const sections: Section[] = [];

  // RAPÒ — Dashboard is the role-based Kay router; the report bodies are the
  // phone's Rapò hub flattened (Sales hidden for managers: it duplicates
  // their Dashboard).
  const rapot: Row[] = [];
  if (vt.includes("home")) {
    rapot.push({
      key: "dashboard",
      title: "Dashboard",
      subtitle: "Kay",
      icon: "grid-outline",
      active: activeTab === "home",
      onPress: () => onTab("home"),
    });
  }
  for (const r of REPORT_ROWS) {
    if (r.roles.includes(role)) rapot.push(toolRow(r.id));
  }
  if (rapot.length) sections.push({ header: "Rapò", rows: rapot });

  // OPERASYON — the day-to-day selling loop.
  const ops: Row[] = [];
  if (vt.includes("pos")) {
    ops.push({
      key: "pos",
      title: ht.sale,
      subtitle: "Pwen vant",
      icon: "cart-outline",
      active: activeTab === "pos",
      badge: suspended > 0 ? { n: suspended, bg: "#CE1126", fg: "#fff" } : undefined,
      onPress: () => (suspended > 0 && onPosOpen ? onPosOpen() : onTab("pos")),
    });
  }
  if (vt.includes("transactions")) {
    ops.push({
      key: "transactions",
      title: ht.transactions,
      subtitle: "Istwa vant jou",
      icon: "card-outline",
      active: activeTab === "transactions",
      onPress: () => onTab("transactions"),
    });
  }
  if (roleHas("proformat")) ops.push(toolRow("proformat"));
  if (roleHas("orders") || vt.includes("orders")) {
    ops.push({
      key: "orders",
      title: titleOf("orders"),
      subtitle: subOf("orders"),
      icon: iconOf("orders"),
      active: activeTab === "orders",
      badge: ordersCount > 0 ? { n: ordersCount, bg: "#F0B429", fg: "#1a1200" } : undefined,
      onPress: () => onTab("orders"),
    });
  }
  if (ops.length) sections.push({ header: "Operasyon", rows: ops });

  // STOCK — catalog lives here with the counts it moves.
  const stock: Row[] = [];
  if (roleHas("inventory")) {
    stock.push(toolRow("inventory", {
      badge: pending > 0 ? { n: pending, bg: "#4da3e0", fg: "#fff" } : undefined,
    }));
  }
  if (roleHas("pickups")) stock.push(toolRow("pickups"));
  if (roleHas("catalog")) stock.push(toolRow("catalog"));
  if (stock.length) sections.push({ header: "Stock", rows: stock });

  // MOUN — people the role works with.
  const moun: Row[] = [];
  if (roleHas("customers") || vt.includes("customers")) {
    moun.push({
      key: "customers",
      title: titleOf("customers"),
      subtitle: subOf("customers"),
      icon: iconOf("customers"),
      active: activeTab === "customers",
      onPress: () => onTab("customers"),
    });
  }
  if (roleHas("suppliers")) moun.push(toolRow("suppliers"));
  if (roleHas("staff")) {
    moun.push({ key: "staff", title: titleOf("staff"), subtitle: subOf("staff"), icon: iconOf("staff"), onPress: onOpenTeam });
  }
  if (moun.length) sections.push({ header: "Moun", rows: moun });

  // ZOUTI — overlays (nothing stays "active": they float above the content).
  const zouti: Row[] = [];
  if (roleHas("shift")) {
    zouti.push({
      key: "shift",
      title: "Shift",
      subtitle: shiftSub,
      icon: "key-outline",
      dot: shiftDot,
      badge: shiftBadge > 0 ? { n: shiftBadge, bg: "#fbbf24", fg: "#1a1200" } : undefined,
      onPress: onOpenShift,
    });
  }
  if (roleHas("store")) {
    zouti.push({ key: "store", title: titleOf("store"), subtitle: subOf("store"), icon: iconOf("store"), onPress: onOpenStore });
  }
  if (zouti.length) sections.push({ header: "Zouti", rows: zouti });

  // No footer rows anymore — Dekonekte lives in the profile sheet (tap the
  // avatar) and the owner-only catalog wipe stays on the phone's Plis list.

  const renderRow = (r: Row) => {
    if (collapsed) {
      // Icon-only rail — the classic 88pt footprint, badges as bubbles.
      return (
        <Pressable
          key={r.key}
          onPress={r.onPress}
          accessibilityRole="button"
          accessibilityLabel={r.title}
          style={{ width: 72, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: r.active ? ACTIVE_BG : "transparent", marginBottom: 2 }}
        >
          <View>
            <Ionicons name={r.icon} size={23} color={r.active ? "#FFFFFF" : r.iconColor ?? INACTIVE} />
            {r.badge ? (
              <View
                style={{
                  position: "absolute",
                  top: -5,
                  right: -10,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 4,
                  backgroundColor: r.badge.bg,
                  borderWidth: 2,
                  borderColor: "#0B0B0D",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 9, fontWeight: "900", color: r.badge.fg }}>{r.badge.n > 99 ? "99+" : r.badge.n}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    }
    // Expanded — MoreScreen's row language, compacted for the 264pt menu.
    return (
      <Pressable
        key={r.key}
        onPress={r.onPress}
        accessibilityRole="button"
        accessibilityLabel={r.title}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: r.active ? ACTIVE_BG : "transparent", marginHorizontal: 8, marginBottom: 2 }}
      >
        <View style={{ width: 26, alignItems: "center" }}>
          <Ionicons name={r.icon} size={20} color={r.active ? "#FFFFFF" : r.iconColor ?? INACTIVE} />
          {r.dot ? (
            <View style={{ position: "absolute", top: -3, right: -5, width: 7, height: 7, borderRadius: 4, backgroundColor: r.dot }} />
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "700", color: r.titleColor ?? "#fff", letterSpacing: -0.1 }}>
            {r.title}
          </Text>
          {r.subtitle ? (
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 1 }}>{r.subtitle}</Text>
          ) : null}
        </View>
        {r.badge ? (
          <View style={{ backgroundColor: r.badge.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: r.badge.fg }}>{r.badge.n > 99 ? "99+" : r.badge.n}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  // ── Header controls — profile on the left edge of the rail, the toggle chip
  // on the right (it's the visual handle for the rail). White circle (same
  // language as the app's primary white buttons, pops off the near-black
  // rail) carrying the panel-toggle glyph. Snaps 40⇄36 with the rail's
  // instant width change so it shares the 88pt collapsed rail with the
  // 36pt profile button.
  const headerChevron = (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={collapsed ? "Elaji meni an" : "Redui meni an"}
      accessibilityState={{ expanded: !collapsed }}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: collapsed ? 36 : 40,
          height: collapsed ? 36 : 40,
          borderRadius: collapsed ? 18 : 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FFFFFF",
          borderWidth: 0.5,
          borderColor: "rgba(0,0,0,0.14)",
        },
        pressed && { transform: [{ scale: 0.94 }], opacity: 0.85 },
      ]}
    >
      <PanelToggleIcon size={collapsed ? 16 : 18} />
    </Pressable>
  );
  const headerProfile = (
    <Pressable
      onPress={() => setProfileOpen(true)}
      accessibilityRole="button"
      accessibilityLabel="Pwofil"
      hitSlop={8}
      style={{ width: collapsed ? 36 : 40, height: collapsed ? 36 : 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }}
    >
      <Ionicons name="person-circle-outline" size={collapsed ? 24 : 26} color="#8e8e93" />
    </Pressable>
  );

  return (
    <View
      style={{
        width,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom,
        backgroundColor: "#0B0B0D",
        borderRightWidth: 0.5,
        borderRightColor: "#262626",
      }}
    >
      {/* Profile sits on the rail's left edge (both states); the white panel
          toggle stays against the content edge — it's the rail's handle. */}
      <View
        style={{
          height: 44,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: collapsed ? 6 : 8,
        }}
      >
        {headerProfile}
        {headerChevron}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16, alignItems: collapsed ? "center" : "stretch" }}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((s, si) => (
          <View key={s.header ?? "footer"}>
            {si > 0 ? (
              collapsed ? (
                <View style={{ width: 40, height: 1, backgroundColor: "#262626", marginVertical: 10 }} />
              ) : (
                <View style={{ height: 1, backgroundColor: "#262626", marginHorizontal: 14, marginTop: 14 }} />
              )
            ) : null}
            {s.header && !collapsed ? <Text style={EYEBROW}>{s.header}</Text> : null}
            {s.rows.map(renderRow)}
          </View>
        ))}
      </ScrollView>

      <UserProfileSheet
        visible={profileOpen}
        onClose={() => setProfileOpen(false)}
        userName={userName}
        roleLabel={roleName}
        storeName={storeName}
        onLogout={onLogout}
      />
    </View>
  );
}
