import React, { useMemo, useState, useRef, useEffect } from "react";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, StyleSheet, Animated, Easing, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, shadow } from "../../theme";
import { useResponsive, centerBox, sheetBox } from "../../responsive";
import { storeIdForLocation } from "../../org";
import { getDb } from "../../db";
import { EmployeeProfileBody } from "../../components/EmployeeProfile";

const GOLD = palette.accentGold;
const GOLD_SOFT = palette.accentGoldSoft;
const GOLD_BD = "#E3D6B8";

export type Employee = {
  id: string;
  name: string;
  role: string;
  phone?: string;
  salary: string;
  address?: string;
  store?: string;
  isOnline?: boolean;
  active: boolean;
  secret: string;
  password: string;
  lastAction: string;
  kpi: string;
  emergency?: { name: string; address: string; phone: string };
};

const ROLE_META: Record<string, { label: string; color: string; bg: string; bd: string }> = {
  owner: { label: "OWNER", color: "#7A5C10", bg: GOLD_SOFT, bd: GOLD_BD },
  admin: { label: "ADMIN", color: "#1E40AF", bg: "#EFF6FF", bd: "#BFDBFE" },
  manager: { label: "MANAGER", color: "#92400E", bg: "#FFFBEB", bd: "#FDE68A" },
  cashier: { label: "KESYE", color: "#6D28D9", bg: "#F5F3FF", bd: "#DDD6FE" },
};

const STORE_LABELS: Record<string, string> = {
  Petyonvil: "Pétion-Ville",
  Dèlma: "Dèlma",
  Sant: "Sant",
};

type Props = {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  role: string;
  currentUser?: any;
  activeStore: string;
  userStoreIds?: string[];
  editingEmp: any | null;
  setEditingEmp: (e: any | null) => void;
  editEmpRole: string;
  setEditEmpRole: (r: string) => void;
  resetTarget: any | null;
  setResetTarget: (e: any | null) => void;
  selfEditEmp: any | null;
  setSelfEditEmp: (e: any | null) => void;
  selfSecret: string;
  setSelfSecret: (s: string) => void;
  selfPassword: string;
  setSelfPassword: (s: string) => void;
  newEmpName: string;
  setNewEmpName: (s: string) => void;
  newEmpRole: string;
  setNewEmpRole: (s: string) => void;
  newEmpPhone: string;
  setNewEmpPhone: (s: string) => void;
  newEmpAddress: string;
  setNewEmpAddress: (s: string) => void;
  newEmpEmergName: string;
  setNewEmpEmergName: (s: string) => void;
  newEmpEmergPhone: string;
  setNewEmpEmergPhone: (s: string) => void;
  newEmpEmergAddress: string;
  setNewEmpEmergAddress: (s: string) => void;
  newEmpError: string;
  setNewEmpError: (s: string) => void;
  canManageEmployees: boolean;
  canAddRole: (targetRole: string) => boolean;
  canEditRoleFor: (target: any, newRole: string) => boolean;
  canAffect: (target: any) => boolean;
  canToggle: (target: any) => boolean;
  canResetOther: (target: any) => boolean;
  canChangeSelf: (target: any) => boolean;
  addRoleOptions: string[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
};

export default function TeamScreen({
  employees, setEmployees, currentUser, role, activeStore, userStoreIds = [],
  editingEmp, setEditingEmp, editEmpRole, setEditEmpRole,
  resetTarget, setResetTarget,
  selfEditEmp, setSelfEditEmp, selfSecret, setSelfSecret, selfPassword, setSelfPassword,
  newEmpName, setNewEmpName, newEmpRole, setNewEmpRole,
  newEmpPhone, setNewEmpPhone, newEmpAddress, setNewEmpAddress,
  newEmpEmergName, setNewEmpEmergName, newEmpEmergPhone, setNewEmpEmergPhone,
  newEmpEmergAddress, setNewEmpEmergAddress,
  newEmpError, setNewEmpError,
  canManageEmployees, canAddRole, canEditRoleFor, canAffect, canToggle, canResetOther, canChangeSelf,
  addRoleOptions, showAdd, setShowAdd,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilter, setDraftFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [empStats, setEmpStats] = useState({ sales: 0, total: 0 });
  // Refetch on every open (id transition null↔id) — same-object reopens
  // would otherwise skip the fetch and show stale zeros.
  const selectedEmpId = selectedEmp?.id ?? null;
  const selectedEmpName = String(selectedEmp?.name ?? "").trim().toLowerCase();
  useEffect(() => {
    if (!selectedEmpId) return;
    (async () => {
      try {
        const db = await getDb();
        const allSales = ((await db.getAllAsync("SELECT * FROM sales").catch(() => [])) as any[]) ?? [];
        // Receipts snapshot the cashier too (id + name columns) — second
        // attribution path for sales stamped under a different login id or
        // before seller_id existed.
        const allReceipts = ((await db.getAllAsync("SELECT sale_id, cashier_id, cashier_name FROM receipts").catch(() => [])) as any[]) ?? [];
        const receiptSaleIds = new Set(
          allReceipts
            .filter(r => String(r.cashier_id ?? "") === selectedEmpId || String(r.cashier_name ?? "").trim().toLowerCase() === selectedEmpName)
            .map(r => r.sale_id)
        );
        const mine = allSales.filter(s =>
          String(s.status ?? "") !== "cancelled" &&
          (String(s.seller_id ?? "") === selectedEmpId || receiptSaleIds.has(s.id))
        );
        setEmpStats({ sales: mine.length, total: mine.reduce((a: number, s: any) => a + Number(s.total ?? s.amount ?? s.subtotal ?? 0), 0) });
      } catch { setEmpStats({ sales: 0, total: 0 }); }
    })();
  }, [selectedEmpId, selectedEmpName]);
  const [empNameCollapsed, setEmpNameCollapsed] = useState(false);
  const titleFade = useRef(new Animated.Value(0)).current;
  const detailScrollRef = useRef<any>(null);
  const empLastName = useMemo(() => {
    const parts = String(selectedEmp?.name ?? "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(1).join(" ") || parts[0] || "";
  }, [selectedEmp]);
  useEffect(() => {
    Animated.timing(titleFade, { toValue: empNameCollapsed ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [empNameCollapsed, titleFade]);
  useEffect(() => {
    setEmpNameCollapsed(false);
    detailScrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedEmp]);
  const [modalView, setModalView] = useState<"detail" | "edit" | "selfEdit" | "reset">("detail");
  const [resetTargetEmp, setResetTargetEmp] = useState<Employee | null>(null);
  const { width, isTablet, padH } = useResponsive();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: modalView === "detail" ? 0 : 1,
      duration: modalView === "detail" ? 250 : 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [modalView]);

  const slide = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const opacity = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const currentStore = activeStore || currentUser?.store || "Petyonvil";

  const LEVEL: Record<string, number> = { owner: 4, admin: 3, manager: 2, cashier: 1, associate: 1, cook: 1 };

  // Phase 4 matrix — store scope via the employee<->store relationship, then
  // role subsets: owner sees everything; admin sees self + managers/cashiers/
  // associates/cooks in his stores (never other admins); manager sees self +
  // cashiers/associates/cooks in his stores.
  const myStoreIds = userStoreIds.length ? userStoreIds : [storeIdForLocation(currentUser?.store)];
  const inMyStores = (e: Employee) =>
    role === "owner" ? true : myStoreIds.includes(storeIdForLocation((e as any).store));
  const visibleEmployees = useMemo(() => {
    const inScope = employees.filter(e => inMyStores(e) || e.role === "owner");
    if (role === "owner") return inScope;
    if (role === "admin") {
      return inScope.filter(e =>
        ["manager", "cashier", "associate", "cook"].includes(e.role) ||
        (e.role === "admin" && e.id === currentUser?.id)
      );
    }
    if (role === "manager") {
      return inScope.filter(e =>
        ["cashier", "associate", "cook"].includes(e.role) || e.id === currentUser?.id
      );
    }
    return [];
  }, [employees, role, currentUser?.id, myStoreIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSeeSalary = (e: Employee) => {
    if (role !== "admin") return true;
    if (e.role !== "admin") return true;
    return e.id === currentUser?.id;
  };

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = visibleEmployees;
    if (filter === "active") result = result.filter(e => e.active);
    if (filter === "inactive") result = result.filter(e => !e.active);
    if (q) {
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        String(e.phone ?? "").toLowerCase().includes(q) ||
        String(e.salary ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [visibleEmployees, search, filter]);

  const toggleActive = (e: Employee) => {
    if (e.role === "owner") { Alert.alert("Pa ka dezaktive Owner."); return; }
    setEmployees(prev => prev.map(x => (x.id === e.id ? { ...x, active: !x.active } : x)));
  };

  const IOSToggle = ({ value, onToggle }: { value: boolean; onToggle: () => void }) => (
    <Pressable
      onPress={onToggle}
      style={{
        width: 51, height: 31, borderRadius: 16,
        backgroundColor: value ? "#34C759" : "#E5E5EA",
        justifyContent: "center",
        padding: 2,
        shadowColor: value ? "#34C759" : "#000",
        shadowOpacity: value ? 0.2 : 0.04,
        shadowRadius: value ? 8 : 4,
        shadowOffset: { width: 0, height: value ? 3 : 1 },
      }}
    >
      <View style={{
        width: 27, height: 27, borderRadius: 14,
        backgroundColor: "white",
        marginLeft: value ? 22 : 0,
        shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
      }} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Title + add */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: padH, paddingTop: 18, paddingBottom: 14 }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Ekip</Text>
        {canManageEmployees ? (
          <Pressable
            onPress={() => setShowAdd(true)}
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        ) : null}
      </View>
      {/* Search + filter */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, marginBottom: 8 }}>
        <View style={{ flex: 1, height: 56, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 28, paddingHorizontal: 16 }}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chèche non, wòl, telefon…"
            placeholderTextColor="#8e8e93"
            returnKeyType="search"
            style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: "#fff" }}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color="#8e8e93" />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => { setDraftFilter(filter); setShowFilters(true); }}
          style={{
            width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
            backgroundColor: filter !== "all" ? "#fff" : "#000",
            borderWidth: 1, borderColor: filter !== "all" ? "#fff" : "#3a3a3c",
          }}
        >
          <Ionicons name="filter" size={20} color={filter !== "all" ? "#000" : "#fff"} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      {/* Employee rows — customers-list style */}
      {list.length === 0 ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>{search || filter !== "all" ? "Pa gen rezilta" : "Pa gen anplwaye"}</Text>
          <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>Eseye chanje rechèch oswa filtè.</Text>
        </View>
      ) : (
        [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))).map((e) => {
          const meta = ROLE_META[e.role] ?? ROLE_META.cashier;
          const isSelf = e.id === currentUser?.id;
          return (
            <Pressable
              key={e.id}
              onPress={() => { setSelectedEmp(e); setModalView("detail"); }}
              style={{ opacity: e.active ? 1 : 0.55 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingVertical: 14 }}>
                <View>
                  <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{e.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                  </View>
                  <View style={{
                    position: "absolute", right: -2, bottom: -2,
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: e.isOnline ? "#34C759" : "#3a3a3c",
                    borderWidth: 2, borderColor: "#000",
                  }} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontWeight: "600", fontSize: 17, color: "#fff", flexShrink: 1 }} numberOfLines={1}>{e.name}</Text>
                    {isSelf ? <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", backgroundColor: "#2b2b2b", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>OU</Text> : null}
                  </View>
                  <Text style={{ fontSize: 14, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{meta.label} · {e.phone ?? "—"}</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 1 }} numberOfLines={1}>{canSeeSalary(e) ? `${e.salary} / mwa` : "Konfidansyèl"}</Text>
                </View>
                {canToggle(e) ? (
                  <IOSToggle value={e.active} onToggle={() => toggleActive(e)} />
                ) : null}
              </View>
              <View style={{ height: 1, backgroundColor: "#262626", marginLeft: padH + 64 }} />
            </Pressable>
          );
        })
      )}
      </ScrollView>

      {/* Filters sheet — Transactions style */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFilters(false)} />
          <View style={{ backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32, maxHeight: "85%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>Filters</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setDraftFilter("all")}
                  style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: draftFilter !== "all" ? "#fff" : "#6e6e73" }}>Clear All</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setFilter(draftFilter); setShowFilters(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {(["all", "active", "inactive"] as const).map(key => {
              const checked = draftFilter === key;
              const label = key === "all" ? "Tout" : key === "active" ? "Aktif" : "Inaktif";
              return (
                <Pressable
                  key={key}
                  onPress={() => setDraftFilter(key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Add member modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#efe7d2", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "94%", overflow: "hidden" }}>
            <View style={{ backgroundColor: "white", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5ea" }}>
              <View style={{ width: 36, height: 4, backgroundColor: "#d1d1d6", borderRadius: 2, marginBottom: 12, alignSelf: "center" }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center", shadowColor: "#16130c", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderWidth: 1.5, borderColor: GOLD }}>
                  <Ionicons name="person-add" size={24} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 19, color: "#16130c", letterSpacing: -0.4 }}>Nouvo Manb</Text>
                  <Text style={{ fontSize: 12, color: "#837b69", marginTop: 2 }}>{role === "owner" ? "Admin · Manager · Cashier" : "Manager · Cashier"}</Text>
                </View>
              </View>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ padding: 16 }} contentContainerStyle={{ gap: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              {/* Informasyon pèsonèl */}
              <View style={{ gap: 6 }}>
                <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Enfòmasyon pèsonèl</Text>
                <View style={{ backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.05)" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="person-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Non konplè" placeholderTextColor="#a1967f" value={newEmpName} onChangeText={v => { setNewEmpName(v); if(newEmpError) setNewEmpError(""); }} style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E5EA", marginLeft: 44 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="call-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Telefon" placeholderTextColor="#a1967f" value={newEmpPhone} onChangeText={v => { setNewEmpPhone(v); if(newEmpError) setNewEmpError(""); }} keyboardType="phone-pad" style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E5EA", marginLeft: 44 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="home-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Adrès" placeholderTextColor="#a1967f" value={newEmpAddress} onChangeText={v => { setNewEmpAddress(v); if(newEmpError) setNewEmpError(""); }} style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                </View>
              </View>

              {/* Wòl */}
              <View style={{ gap: 6 }}>
                <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Wòl</Text>
                <View style={{ flexDirection: "row", backgroundColor: "#E9E9EB", borderRadius: 14, padding: 4, gap: 4 }}>
                  {addRoleOptions.map(r => {
                    const active = newEmpRole === r;
                    return (
                      <Pressable key={r} onPress={() => setNewEmpRole(r)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? "white" : "transparent", alignItems: "center", shadowColor: active ? "#000" : "transparent", shadowOpacity: active ? 0.1 : 0, shadowRadius: 4, elevation: active ? 2 : 0 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#16130c" : "#837b69", letterSpacing: 0.3 }}>{r.toUpperCase()}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Kontak ijans */}
              <View style={{ gap: 6 }}>
                <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Kontak ijans</Text>
                <View style={{ backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.05)" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="person-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Non ijans" placeholderTextColor="#a1967f" value={newEmpEmergName} onChangeText={v => { setNewEmpEmergName(v); if(newEmpError) setNewEmpError(""); }} style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E5EA", marginLeft: 44 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="call-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Telefon ijans" placeholderTextColor="#a1967f" value={newEmpEmergPhone} onChangeText={v => { setNewEmpEmergPhone(v); if(newEmpError) setNewEmpError(""); }} keyboardType="phone-pad" style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E5EA", marginLeft: 44 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="home-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Adrès ijans" placeholderTextColor="#a1967f" value={newEmpEmergAddress} onChangeText={v => { setNewEmpEmergAddress(v); if(newEmpError) setNewEmpError(""); }} style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                  </View>
                </View>
              </View>

              {newEmpError ? <View style={{ backgroundColor: "#FFF1F2", borderWidth: 0.5, borderColor: "#FECDD3", borderRadius: 12, padding: 12 }}><Text style={{ fontSize: 13, fontWeight: "600", color: "#B00020", textAlign: "center" }}>{newEmpError}</Text></View> : null}
            </ScrollView>
            <View style={{ padding: 16, backgroundColor: "white", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5ea", gap: 8 }}>
              <Pressable
                onPress={() => {
                  setNewEmpError("");
                  if (!newEmpName.trim()) { setNewEmpError("Non obligatwa."); return; }
                  if (!newEmpPhone.trim()) { setNewEmpError("Telefon obligatwa."); return; }
                  if (!newEmpAddress.trim()) { setNewEmpError("Adrès obligatwa."); return; }
                  if (!newEmpEmergName.trim() || !newEmpEmergPhone.trim() || !newEmpEmergAddress.trim()) { setNewEmpError("Kontak ijans konplè obligatwa: non, telefon, adrès."); return; }
                  if (!canAddRole(newEmpRole)) { setNewEmpError("Ou pa gen dwa kreye wòl sa a — se sèlman siperyè strik ka kreye (pa menm nivo, pa Owner)."); return; }
                  const id = `emp-${Date.now()}`;
                  const secret = String(employees.length + 1);
                  setEmployees(prev => [...prev, { id, name: newEmpName.trim(), role: newEmpRole as any, phone: newEmpPhone.trim(), address: newEmpAddress.trim(), store: currentStore, emergency: { name: newEmpEmergName.trim(), phone: newEmpEmergPhone.trim(), address: newEmpEmergAddress.trim() }, secret, password: `pass-${Math.random().toString(36).slice(2, 8)}`, lastAction: "Nouvo manm", kpi: "—", salary: newEmpRole === "admin" ? "G 32 000" : newEmpRole === "manager" ? "G 25 000" : "G 12 000", isOnline: false, active: true } as any]);
                  setNewEmpName(""); setNewEmpPhone(""); setNewEmpAddress(""); setNewEmpEmergName(""); setNewEmpEmergPhone(""); setNewEmpEmergAddress(""); setNewEmpRole("cashier"); setNewEmpError("");
                  setShowAdd(false);
                }}
                style={{ backgroundColor: "#16130c", borderRadius: 14, paddingVertical: 15, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, shadowColor: "#16130c", shadowOpacity: 0.15, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, borderWidth: 1, borderColor: "rgba(200,162,74,0.35)" }}>
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Ajoute anplwaye</Text>
              </Pressable>
              <Pressable onPress={() => setShowAdd(false)} style={{ paddingVertical: 6, alignItems: "center" }}><Text style={{ fontSize: 13, color: "#837b69", fontWeight: "500" }}>Fèmen</Text></Pressable>
            </View>
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail modal — full-screen dark profile */}
      <Modal visible={!!selectedEmp} transparent={false} animationType="slide" onRequestClose={() => setSelectedEmp(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60, paddingBottom: 24 }}>
            {modalView === "detail" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setSelectedEmp(null)} accessibilityLabel="Close" hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={31} color="#fff" />
                  </Pressable>
                  <Animated.View style={{ flex: 1, opacity: titleFade }}>
                    <Text style={{ textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>{empLastName}</Text>
                  </Animated.View>
                  <View style={{ width: 44 }} />
                </View>

            {modalView === "detail" && selectedEmp && <ScrollView ref={detailScrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1, marginTop: 6 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={e => setEmpNameCollapsed(e.nativeEvent.contentOffset.y > 100)}>
              <View style={{ marginTop: 10 }}>
              <EmployeeProfileBody
                employee={selectedEmp}
                stats={empStats}
                canSeeSalary={canSeeSalary(selectedEmp)}
                roleLabel={(ROLE_META[selectedEmp.role] ?? ROLE_META.cashier).label}
                storeLabel={STORE_LABELS[selectedEmp.store ?? ""] ?? selectedEmp.store}
                isSelf={selectedEmp.id === currentUser?.id}
                canToggleActive={canToggle(selectedEmp)}
                canEditRole={canAffect(selectedEmp) && selectedEmp.role !== "owner" && selectedEmp.id !== currentUser?.id}
                canEditCredentials={canChangeSelf(selectedEmp) || canResetOther(selectedEmp)}
                onToggleActive={() => { toggleActive(selectedEmp); setSelectedEmp({ ...selectedEmp, active: !selectedEmp.active }); }}
                onEditRole={() => { setEditingEmp(selectedEmp); setEditEmpRole(selectedEmp.role); setModalView("edit"); }}
                onEditCredentials={() => {
                  if (canChangeSelf(selectedEmp)) { setSelfEditEmp(selectedEmp); setSelfSecret(""); setSelfPassword(""); setModalView("selfEdit"); }
                  else { setResetTargetEmp(selectedEmp); setModalView("reset"); }
                }}
              />
              </View>
            </ScrollView>}
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingRight: 16 }}>
                    <Text style={{ fontSize: 24, color: "#fff", fontWeight: "500", lineHeight: 24 }}>‹</Text>
                    <Text style={{ fontSize: 16, color: "#fff", fontWeight: "500", marginLeft: 4 }}>Dèyè</Text>
                  </Pressable>
                  <View style={{ flex: 1 }} />
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1, marginTop: 6 }} contentContainerStyle={{ paddingBottom: 24 }}>

            {/* Edit role — inside modal */}
            {modalView === "edit" && editingEmp && (
              <Animated.View style={{ backgroundColor: "white", padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#16130c", letterSpacing: -0.4 }}>Modifye wòl</Text>
                  <Text style={{ fontSize: 13, color: "#837b69", textAlign: "center", marginTop: 2 }}>{editingEmp.role.toUpperCase()} → {editEmpRole.toUpperCase()}</Text>
                </View>
                {editingEmp.role === "owner" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF1F2", borderRadius: 12, padding: 12 }}>
                    <Ionicons name="alert-circle" size={18} color="#FF3B30" />
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: "#FF3B30" }}>Pa ka modifye aksè Owner.</Text>
                  </View>
                ) : null}
                {editingEmp.id === currentUser?.id && role === "admin" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFBEB", borderRadius: 12, padding: 12 }}>
                    <Ionicons name="alert-circle" size={18} color="#92400E" />
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: "#92400E" }}>Admin pa ka bese tèt li.</Text>
                  </View>
                ) : null}
                <View style={{ gap: 6 }}>
                  <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Nouvo wòl</Text>
                  <View style={{ backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.05)" }}>
                    {(["admin", "manager", "cashier"] as const).filter(r => canEditRoleFor(editingEmp, r)).map((r, i, arr) => (
                      <Pressable key={r} onPress={() => setEditEmpRole(r)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: "#E5E5EA" }}>
                        <Ionicons name="person-outline" size={18} color="#837b69" style={{ marginRight: 12 }} />
                        <Text style={{ flex: 1, fontSize: 15, color: "#16130c", fontWeight: "500" }}>{r.charAt(0).toUpperCase() + r.slice(1)}</Text>
                        {editEmpRole === r && <Ionicons name="checkmark-circle" size={20} color="#16130c" />}
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#F2F2F7", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#16130c" }}>Anile</Text></Pressable>
                  <Pressable
                    onPress={() => {
                      if (!canEditRoleFor(editingEmp, editEmpRole as any)) { Alert.alert("Refize", "Pa ka pwomouvwa nan Owner, pa ka manyen Owner, Admin pa ka bese tèt li."); return; }
                      setEmployees(prev => prev.map(x => x.id === editingEmp.id ? { ...x, role: editEmpRole as any } : x));
                      setSelectedEmp(null); setModalView("detail");
                    }}
                    style={{ flex: 1, paddingVertical: 14, backgroundColor: canEditRoleFor(editingEmp, editEmpRole as any) ? "#16130c" : "#E5E5EA", borderRadius: 12, alignItems: "center" }}>
                    <Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Anrejistre</Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Self edit — inside modal */}
            {modalView === "selfEdit" && selfEditEmp && (
              <Animated.View style={{ backgroundColor: "white", padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#16130c", letterSpacing: -0.4 }}>Chanje pa mwen</Text>
                  <Text style={{ fontSize: 13, color: "#837b69", textAlign: "center", marginTop: 2 }}>Se sèlman ou ki ka chanje kòd / modpas ou.</Text>
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Modpas / Kòd</Text>
                  <View style={{ backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.05)" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                      <Ionicons name="key-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                      <TextInput placeholder="Nouvo kòd — kite vid" placeholderTextColor="#a1967f" value={selfSecret} onChangeText={setSelfSecret} secureTextEntry style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                    </View>
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#E5E5EA", marginLeft: 44 }} />
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                      <Ionicons name="lock-closed-outline" size={18} color="#837b69" style={{ position: "absolute", left: 14 }} />
                      <TextInput placeholder="Nouvo modpas — kite vid" placeholderTextColor="#a1967f" value={selfPassword} onChangeText={setSelfPassword} secureTextEntry style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#16130c" }} />
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#F2F2F7", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#16130c" }}>Anile</Text></Pressable>
                  <Pressable
                    onPress={() => {
                      if (!selfSecret.trim() && !selfPassword.trim()) { Alert.alert("Antre kòd oswa modpas"); return; }
                      setEmployees(prev => prev.map(x => x.id === selfEditEmp.id ? { ...x, secret: selfSecret.trim() || x.secret, password: selfPassword.trim() || x.password } : x));
                      setSelfEditEmp(null); setSelfSecret(""); setSelfPassword(""); setSelectedEmp(null); setModalView("detail");
                    }}
                    style={{ flex: 1, paddingVertical: 14, backgroundColor: "#16130c", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Anrejistre pa mwen</Text></Pressable>
                </View>
              </Animated.View>
            )}

            {/* Reset — inside modal */}
            {modalView === "reset" && resetTargetEmp && (
              <Animated.View style={{ backgroundColor: "white", padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#16130c", letterSpacing: -0.4 }}>Reyinisyialize</Text>
                  <Text style={{ fontSize: 13, color: "#837b69", textAlign: "center", marginTop: 2 }}>Ou pa wè ansyen kòd/modpas. Reyinisyializasyon fòse itilizatè a mete nouvo pa li menm.</Text>
                </View>
                <View style={{ backgroundColor: "white", borderRadius: 16, overflow: "hidden", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.05)" }}>
                  <Pressable onPress={() => { setEmployees(prev => prev.map(x => x.id === resetTargetEmp.id ? { ...x, secret: String(1000 + Math.floor(Math.random()*9000)).slice(-4) } : x)); setSelectedEmp(null); setModalView("detail"); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                    <Ionicons name="key-outline" size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, fontSize: 15, color: "#FF3B30", fontWeight: "600" }}>Reyinisyialize kòd</Text>
                    <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
                  </Pressable>
                  <Pressable onPress={() => { setEmployees(prev => prev.map(x => x.id === resetTargetEmp.id ? { ...x, password: `tmp-${Math.random().toString(36).slice(2,8)}` } : x)); setSelectedEmp(null); setModalView("detail"); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14 }}>
                    <Ionicons name="lock-closed-outline" size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, fontSize: 15, color: "#FF3B30", fontWeight: "600" }}>Reyinisyialize modpas</Text>
                    <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#F2F2F7", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#16130c" }}>Anile</Text></Pressable>
                </View>
              </Animated.View>
            )}
                </ScrollView>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}
