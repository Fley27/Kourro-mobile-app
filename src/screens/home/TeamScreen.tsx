import React, { useMemo, useState, useRef, useEffect } from "react";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, StyleSheet, Animated, Easing, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, shadow } from "../../theme";
import { useResponsive, centerBox, sheetBox } from "../../responsive";

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

const ROLE_COLOR: Record<string, string> = {
  owner: "#16130c",
  admin: "#5856D6",
  manager: "#FF9F0A",
  cashier: "#837b69",
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
  employees, setEmployees, currentUser, role, activeStore,
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
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [modalView, setModalView] = useState<"detail" | "edit" | "selfEdit" | "reset">("detail");
  const [resetTargetEmp, setResetTargetEmp] = useState<Employee | null>(null);
  const { width, isTablet, padH } = useResponsive();
  const fabRight = isTablet ? Math.max(20, (width - 880) / 2 + 24) : 20;
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

  const LEVEL: Record<string, number> = { owner: 4, admin: 3, manager: 2, cashier: 1 };

const visibleEmployees = useMemo(() => {
    const inScope = employees.filter(e => e.store === currentStore || e.role === "owner");
    if (role === "cashier") return inScope;
    const myLevel = LEVEL[role] ?? 1;
    return inScope.filter(e => (LEVEL[e.role] ?? 1) <= myLevel);
  }, [employees, role, currentStore]);

  const canSeeSalary = (e: Employee) => {
    if (role !== "admin") return true;
    if (e.role !== "admin") return true;
    return e.id === currentUser?.id;
  };

  const activeCount = visibleEmployees.filter(e => e.active).length;
  const inactiveCount = visibleEmployees.length - activeCount;

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

  const filterPills: { id: "all" | "active" | "inactive"; label: string; count: number }[] = [
    { id: "all", label: "Tout", count: visibleEmployees.length },
    { id: "active", label: "Aktif", count: activeCount },
    { id: "inactive", label: "Inaktif", count: inactiveCount },
  ];

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
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: isTablet ? "center" : undefined }}>
      <ScrollView style={{ flex: 1, width: "100%" }} contentContainerStyle={{ padding: padH, paddingBottom: 24, gap: 12, ...(isTablet && { flexDirection: "row", flexWrap: "wrap" as const }) }} showsVerticalScrollIndicator={false}>
      {/* Search + filter — Apple precision */}
      <View style={{ width: "100%", backgroundColor: "white", borderRadius: 16, ...shadow.card, padding: 12 }}>
        <View style={{ flex: 1, height: 48, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#D1D1D6", borderRadius: 14, backgroundColor: "#F9F9FB", paddingHorizontal: 13 }}>
          <Text style={{ fontSize: 16, color: "#6B7280", fontWeight: "600" }}>⌕</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chèche non, wòl, telefon…"
            placeholderTextColor="#837b69"
            returnKeyType="search"
            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 9, fontSize: 15, color: "#16130c" }}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 5 }}><Text style={{ color: "#6B7280", fontSize: 13, fontWeight: "700" }}>✕</Text></Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 4, marginTop: 12, backgroundColor: "#F2F2F7", borderRadius: 11, padding: 3, borderWidth: 0.5, borderColor: "#E5E5EA" }}>
          {filterPills.map(p => {
            const active = filter === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setFilter(p.id)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 8, backgroundColor: active ? "white" : "transparent", shadowColor: "#000", shadowOpacity: active ? 0.08 : 0, shadowRadius: 4, elevation: active ? 2 : 0 }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#16130c" : "#837b69" }}>{p.label}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: active ? "#16130c" : "#a1967f" }}>{p.count}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Employee cards — Apple Settings–style */}
      {list.length === 0 ? (
        <View style={{ width: "100%", backgroundColor: "white", borderRadius: 16, padding: 32, alignItems: "center", gap: 6, ...shadow.card }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#16130c" }}>{search || filter !== "all" ? "Pa gen rezilta" : "Pa gen anplwaye"}</Text>
          <Text style={{ fontSize: 13, color: "#837b69", textAlign: "center" }}>Eseye chanje rechèch oswa filtè.</Text>
        </View>
      ) : (
        list.map((e) => {
          const meta = ROLE_META[e.role] ?? ROLE_META.cashier;
          const isSelf = e.id === currentUser?.id;
          return (
            <Pressable
              key={e.id}
              onPress={() => { setSelectedEmp(e); setModalView("detail"); }}
              style={{ backgroundColor: "white", borderRadius: 16, ...shadow.card, opacity: e.active ? 1 : 0.55, ...(isTablet && { flexBasis: "48%" as any, flexGrow: 1 }) }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 14 }}>
                {/* Avatar — circular, role-colored with gold luxury ring */}
                <View style={{ position: "relative" }}>
                  <View style={{
                    width: 50, height: 50, borderRadius: 25,
                    backgroundColor: ROLE_COLOR[e.role] ?? "#F2F2F7",
                    alignItems: "center", justifyContent: "center",
                    shadowColor: ROLE_COLOR[e.role] ?? "#000", shadowOpacity: 0.14, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                    borderWidth: 1.5, borderColor: e.role === "owner" ? GOLD : (e.active ? "rgba(200,162,74,0.45)" : "rgba(0,0,0,0.08)"),
                  }}>
                    <Text style={{ color: e.role === "cashier" ? "#16130c" : "#fff", fontWeight: "600", fontSize: 15 }}>{e.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                  </View>
                  {/* Online dot */}
                  <View style={{
                    position: "absolute", right: 0, bottom: 0,
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: e.isOnline ? "#34C759" : "#C7C7CC",
                    borderWidth: 2.5, borderColor: "white",
                  }} />
                </View>

                {/* Name + role + phone — clean single column */}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={{ fontWeight: "600", fontSize: 17, color: "#16130c", letterSpacing: -0.4 }} numberOfLines={1}>{e.name}</Text>
                    {isSelf && <Text style={{ fontSize: 11, color: "#837b69", fontWeight: "600", backgroundColor: "#F2F2F7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>OU</Text>}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ backgroundColor: meta.bg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: meta.color, letterSpacing: 0.3 }}>{meta.label}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: "#837b69" }} numberOfLines={1}>{e.phone ?? "—"}</Text>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: palette.muted2 }} numberOfLines={1}>{canSeeSalary(e) ? `${e.salary} / mwa` : "Konfidansyèl"}</Text>
                </View>

                {/* iOS Toggle */}
                {canToggle(e) ? (
                  <IOSToggle value={e.active} onToggle={() => toggleActive(e)} />
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
      </ScrollView>

      {canManageEmployees && (
        <Pressable
          onPress={() => setShowAdd(true)}
          style={{ position: "absolute", right: fabRight, bottom: 24, paddingHorizontal: 18, height: 56, borderRadius: 28, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}
        >
          <Text style={{ color: "white", fontSize: 22, fontWeight: "500", lineHeight: 24 }}>＋</Text>
          <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Nouvo Manb</Text>
        </Pressable>
      )}

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
                  setEmployees(prev => [...prev, { id, name: newEmpName.trim(), role: newEmpRole as any, phone: newEmpPhone.trim(), address: newEmpAddress.trim(), store: currentStore, emergency: { name: newEmpEmergName.trim(), phone: newEmpEmergPhone.trim(), address: newEmpEmergAddress.trim() }, secret, password: `pass-${Math.random().toString(36).slice(2, 8)}`, lastAction: "Nouvo manm", kpi: "—", salary: newEmpRole === "admin" ? "32,000 HTG" : newEmpRole === "manager" ? "25,000 HTG" : "12,000 HTG", isOnline: false, active: true } as any]);
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

      {/* Detail modal — Apple profile sheet */}
      <Modal visible={!!selectedEmp} transparent animationType="slide" onRequestClose={() => setSelectedEmp(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.4)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
          <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#F2F2F7", borderTopLeftRadius: 14, borderTopRightRadius: 14, maxHeight: "88%", overflow: "hidden" }}>
            {/* Drag indicator */}
            <View style={{ paddingTop: 8, paddingBottom: 4, alignItems: "center" }}><View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: "#D1D1D6" }} /></View>

            {/* Profile header */}
            {selectedEmp && (
              <View style={{ backgroundColor: "white", paddingTop: 12, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                {modalView !== "detail" && (
                  <Animated.View style={{ position: "absolute", top: 6, left: 10, zIndex: 10, transform: [{ translateX: slide }], opacity }}>
                    <Pressable onPress={() => setModalView("detail")} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 22, color: "#16130c", fontWeight: "500", lineHeight: 22 }}>‹</Text>
                      <Text style={{ fontSize: 15, color: "#16130c", fontWeight: "500" }}>Dèyè</Text>
                    </Pressable>
                  </Animated.View>
                )}
                <View style={{ alignItems: "center" }}>
                  <View style={{ position: "relative" }}>
                    <View style={{
                      width: 64, height: 64, borderRadius: 32,
                      backgroundColor: ROLE_COLOR[selectedEmp.role] ?? "#F2F2F7",
                      alignItems: "center", justifyContent: "center",
                      shadowColor: ROLE_COLOR[selectedEmp.role] ?? "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
                      borderWidth: 1.5, borderColor: selectedEmp.role === "owner" ? GOLD : "rgba(200,162,74,0.45)",
                    }}>
                      <Text style={{ color: selectedEmp.role === "cashier" ? "#16130c" : "#fff", fontWeight: "600", fontSize: 20 }}>{selectedEmp.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                    </View>
                    <View style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: selectedEmp.isOnline ? "#34C759" : "#C7C7CC", borderWidth: 3, borderColor: "white" }} />
                  </View>
                  <Text style={{ fontWeight: "600", fontSize: 20, color: "#16130c", marginTop: 10, letterSpacing: -0.4 }}>{selectedEmp.name}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                    <View style={{ backgroundColor: (ROLE_META[selectedEmp.role] ?? ROLE_META.cashier).bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: (ROLE_META[selectedEmp.role] ?? ROLE_META.cashier).color }}>{(ROLE_META[selectedEmp.role] ?? ROLE_META.cashier).label}</Text>
                    </View>
                    <View style={{ backgroundColor: selectedEmp.isOnline ? "#EAF6ED" : "#F2F2F7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: "500", color: selectedEmp.isOnline ? "#34C759" : "#837b69" }}>{selectedEmp.isOnline ? "En ligne" : "Hors ligne"}</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {modalView === "detail" && <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ paddingTop: 8 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
              {/* Info section */}
              {selectedEmp && (
                <View style={{ backgroundColor: "white", marginHorizontal: 16, borderRadius: 12, overflow: "hidden" }}>
                  <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#9C7A1E", textTransform: "uppercase", letterSpacing: 0.8 }}>Enfòmasyon</Text>
                  </View>
                  {[
                    { label: "Telefon", value: selectedEmp.phone ?? "—" },
                    { label: "Adrès", value: selectedEmp.address ?? "—" },
                    { label: "Magazen", value: STORE_LABELS[selectedEmp.store ?? ""] ?? selectedEmp.store ?? "—" },
                    { label: "Salè", value: canSeeSalary(selectedEmp) ? `${selectedEmp.salary} / mwa` : "Konfidansyèl" },
                    { label: "Kòd", value: "••••" },
                  ].map((row, i, arr) => (
                    <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: "#E5E5EA" }}>
                      <Text style={{ fontSize: 15, color: "#3C3C43", fontWeight: "400" }}>{row.label}</Text>
                      <Text style={{ fontSize: 15, color: "#16130c", fontWeight: "500" }}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Emergency section */}
              {selectedEmp?.emergency ? (
                <View style={{ backgroundColor: "white", marginHorizontal: 16, marginTop: 20, borderRadius: 12, overflow: "hidden" }}>
                  <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#9C7A1E", textTransform: "uppercase", letterSpacing: 0.8 }}>Kontak ijans</Text>
                  </View>
                  {[
                    { label: "Non", value: selectedEmp.emergency.name },
                    { label: "Telefon", value: selectedEmp.emergency.phone },
                    { label: "Adrès", value: selectedEmp.emergency.address },
                  ].map((row, i, arr) => (
                    <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: "#E5E5EA" }}>
                      <Text style={{ fontSize: 15, color: "#3C3C43" }}>{row.label}</Text>
                      <Text style={{ fontSize: 15, color: "#16130c", fontWeight: "500" }}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Actions section */}
              {selectedEmp && (
                <View style={{ backgroundColor: "white", marginHorizontal: 16, marginTop: 20, borderRadius: 12, overflow: "hidden" }}>
                  <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#9C7A1E", textTransform: "uppercase", letterSpacing: 0.8 }}>Aksyon</Text>
                  </View>
                  {canToggle(selectedEmp) && (
                    <Pressable onPress={() => toggleActive(selectedEmp)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                      <Ionicons name={selectedEmp.active ? "pause-circle-outline" : "play-circle-outline"} size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                      <Text style={{ fontSize: 15, color: "#FF3B30", fontWeight: "500" }}>{selectedEmp.active ? "Dezaktive" : "Aktive"}</Text>
                    </Pressable>
                  )}
                  {canAffect(selectedEmp) && selectedEmp.role !== "owner" && selectedEmp.id !== currentUser?.id ? (
                    <Pressable onPress={() => { setEditingEmp(selectedEmp); setEditEmpRole(selectedEmp.role); setModalView("edit"); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                      <Ionicons name="shield-checkmark-outline" size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                      <Text style={{ fontSize: 15, color: "#FF3B30", fontWeight: "500" }}>Modifye wòl</Text>
                    </Pressable>
                  ) : null}
                  {canChangeSelf(selectedEmp) ? (
                    <Pressable onPress={() => { setSelfEditEmp(selectedEmp); setSelfSecret(""); setSelfPassword(""); setModalView("selfEdit"); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                      <Ionicons name="key-outline" size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                      <Text style={{ fontSize: 15, color: "#FF3B30", fontWeight: "500" }}>Chanje kòd / modpas</Text>
                    </Pressable>
                  ) : canResetOther(selectedEmp) ? (
                    <Pressable onPress={() => { setResetTargetEmp(selectedEmp); setModalView("reset"); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5EA" }}>
                      <Ionicons name="refresh-outline" size={20} color="#FF3B30" style={{ marginRight: 12 }} />
                      <Text style={{ fontSize: 15, color: "#FF3B30", fontWeight: "500" }}>Reyinisyialize kòd / modpas</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </ScrollView>}

            {/* Detail view footer */}
            {modalView === "detail" && (
              <View style={{ padding: 16, paddingBottom: 28, backgroundColor: "white", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E5E5EA" }}>
                <Pressable onPress={() => setSelectedEmp(null)} style={{ backgroundColor: "#16130c", borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.35)" }}>
                  <Text style={{ color: "white", fontWeight: "600", fontSize: 17 }}>Fèmen</Text>
                </Pressable>
              </View>
            )}

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
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}
