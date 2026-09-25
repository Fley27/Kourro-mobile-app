// EmployeeProfileBody — reusable dark employee profile (clone of the
// customer profile, minus transactions and notes). Sections: name + badges,
// sales stats, Enfòmasyon rows, Kontak ijans rows, built-in Aksyon rows.
// Styling is fixed-dark; the caller owns the sheet/modal chrome.
import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, monoStyle } from "../format";

const INK = "#fff";
const MUTED = "#8e8e93";
const HAIR = "#262626";
const TILE = "#2b2b2b";
const GREEN = "#30D158";
const GREEN_BG = "rgba(48,209,88,0.15)";
const RED = "#FF453A";

export type EmployeeLite = {
  id: string;
  name: string;
  role: string;
  phone?: string | null;
  address?: string | null;
  store?: string | null;
  salary?: string | null;
  active: boolean;
  isOnline?: boolean;
  emergency?: { name: string; address: string; phone: string } | null;
};

export type EmployeeStats = { sales: number; total: number };

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color: MUTED, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</Text>
      <View style={{ marginTop: 8 }}>{children}</View>
    </View>
  );
}

function EmpRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: HAIR }}>
      <Text style={{ fontSize: 15, color: MUTED }}>{label}</Text>
      <Text style={{ fontSize: 15, color: INK, fontWeight: "500", textAlign: "right", flexShrink: 1, marginLeft: 12 }} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export function EmployeeProfileBody({ employee: e, stats, canSeeSalary, roleLabel, storeLabel, isSelf, canToggleActive, canEditRole, canEditCredentials, onToggleActive, onEditRole, onEditCredentials }: {
  employee: EmployeeLite;
  stats: EmployeeStats;
  canSeeSalary: boolean;
  roleLabel: string;
  storeLabel?: string | null;
  isSelf: boolean;
  canToggleActive?: boolean;
  canEditRole?: boolean;
  canEditCredentials?: boolean;
  onToggleActive?: () => void;
  onEditRole?: () => void;
  onEditCredentials?: () => void;
}) {
  const showActions = !!(canToggleActive || canEditRole || canEditCredentials);
  const initials = e.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w[0] ?? "").toUpperCase()).join("") || "•";
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ position: "relative" }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: INK, fontWeight: "800", fontSize: 20 }}>{initials}</Text>
          </View>
          <View style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: e.isOnline ? "#34C759" : "#3a3a3c", borderWidth: 3, borderColor: "#000" }} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 28, color: INK, letterSpacing: -0.5 }} numberOfLines={2}>{e.name}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <View style={{ backgroundColor: TILE, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: INK, letterSpacing: 0.3 }}>{roleLabel}</Text>
            </View>
            <View style={{ backgroundColor: e.active ? GREEN_BG : TILE, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: e.active ? GREEN : MUTED }}>{e.active ? "Aktif" : "Inaktif"}</Text>
            </View>
            <View style={{ backgroundColor: e.isOnline ? GREEN_BG : TILE, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: "500", color: e.isOnline ? GREEN : MUTED }}>{e.isOnline ? "En ligne" : "Hors ligne"}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", marginTop: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Vant</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4, ...monoStyle }}>{stats.sales}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: HAIR, marginHorizontal: 14 }} />
        <View style={{ flex: 1.4 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Total</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4 }} numberOfLines={1}>{fmtG(Math.round(stats.total))}</Text>
        </View>
      </View>

      <View style={{ height: 5, backgroundColor: TILE, borderRadius: 3, marginTop: 20 }} />

      <Section label="Enfòmasyon">
        <EmpRow label="Telefon" value={e.phone ?? "—"} />
        <EmpRow label="Adrès" value={e.address ?? "—"} />
        <EmpRow label="Magazen" value={storeLabel ?? e.store ?? "—"} />
        <EmpRow label="Salè" value={canSeeSalary ? `${e.salary ?? "—"} / mwa` : "Konfidansyèl"} />
        <EmpRow label="Kòd" value="••••" last />
      </Section>

      {e.emergency ? (
        <Section label="Kontak ijans">
          <EmpRow label="Non" value={e.emergency.name} />
          <EmpRow label="Telefon" value={e.emergency.phone} />
          <EmpRow label="Adrès" value={e.emergency.address} last />
        </Section>
      ) : null}

      {showActions ? (
        <Section label="Aksyon">
          {canToggleActive ? (
            <Pressable onPress={onToggleActive} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: (canEditRole || canEditCredentials) ? 1 : 0, borderBottomColor: HAIR }}>
              <Ionicons name={e.active ? "pause-circle-outline" : "play-circle-outline"} size={20} color={RED} style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 15, color: RED, fontWeight: "500" }}>{e.active ? "Dezaktive" : "Aktive"}</Text>
            </Pressable>
          ) : null}
          {canEditRole ? (
            <Pressable onPress={onEditRole} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: canEditCredentials ? 1 : 0, borderBottomColor: HAIR }}>
              <Ionicons name="shield-checkmark-outline" size={20} color={RED} style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 15, color: RED, fontWeight: "500" }}>Modifye wòl</Text>
            </Pressable>
          ) : null}
          {canEditCredentials ? (
            <Pressable onPress={onEditCredentials} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13 }}>
              <Ionicons name="key-outline" size={20} color={RED} style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 15, color: RED, fontWeight: "500" }}>{isSelf ? "Chanje kòd / modpas" : "Reyinisyialize kòd / modpas"}</Text>
            </Pressable>
          ) : null}
        </Section>
      ) : null}
    </View>
  );
}
