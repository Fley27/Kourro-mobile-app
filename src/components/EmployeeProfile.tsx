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
  email?: string | null;
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

export function EmployeeProfileBody({ employee: e, stats, canSeeSalary, roleLabel, storeLabel, isSelf, canToggleActive, canEditRole, canEditCredentials, canEditEmail, canEditEmergency, canEditSalary, payroll, payments, onToggleActive, onEditRole, onEditCredentials, onEditEmail, onEditEmergency, onEditSalary, onOpenPayment }: {
  employee: EmployeeLite;
  stats: EmployeeStats;
  canSeeSalary: boolean;
  roleLabel: string;
  storeLabel?: string | null;
  isSelf: boolean;
  canToggleActive?: boolean;
  canEditRole?: boolean;
  canEditCredentials?: boolean;
  canEditEmail?: boolean;
  canEditEmergency?: boolean;
  canEditSalary?: boolean;
  /** Live expected payment for the OPEN period (028) — display only. */
  payroll?: { salary: number; deficits: number; expected: number; periodLabel: string } | null;
  /** Closed payment rows (newest first) with resolved period labels. */
  payments?: Array<{ id: string; label?: string; salary_amount?: number; deficit_total?: number; net_amount?: number; closed_at?: string }> | null;
  onToggleActive?: () => void;
  onEditRole?: () => void;
  onEditCredentials?: () => void;
  onEditEmail?: () => void;
  onEditEmergency?: () => void;
  onEditSalary?: () => void;
  onOpenPayment?: (p: any) => void;
}) {
  const showActions = !!(canToggleActive || canEditRole || canEditCredentials || canEditEmail || canEditEmergency || canEditSalary);
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

      {canSeeSalary && payroll ? (
        <Section label={`Peman prevwa — ${payroll.periodLabel}`}>
          <View style={{ backgroundColor: TILE, borderRadius: 14, padding: 16 }}>
            <Text style={{ fontWeight: "800", fontSize: 30, color: INK }}>{fmtG(Math.round(payroll.expected))}</Text>
            <Text style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
              Salè {fmtG(Math.round(payroll.salary))}{payroll.deficits > 0 ? ` − defisit ${fmtG(Math.round(payroll.deficits))}` : ""}
            </Text>
            <Text style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Estimasyon an dirèk — figi final la fikse lè peryòd la fèmen.</Text>
          </View>
        </Section>
      ) : null}

      <Section label="Enfòmasyon">
        <EmpRow label="Telefon" value={e.phone ?? "—"} />
        <EmpRow label="Imel" value={e.email ?? "—"} />
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

      {canSeeSalary ? (
        <Section label="Istwa peman">
          {payments && payments.length ? (
            payments.map((p, i) => (
              <Pressable
                key={String(p.id ?? i)}
                onPress={() => onOpenPayment?.(p)}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: i < payments.length - 1 ? 1 : 0, borderBottomColor: HAIR }}
              >
                <Text style={{ fontSize: 15, color: MUTED }}>{p.label ?? String(p.closed_at ?? "").slice(0, 10)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 15, color: INK, fontWeight: "500" }}>{fmtG(Number(p.net_amount ?? 0))}</Text>
                  <Ionicons name="chevron-forward" size={16} color={MUTED} />
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={{ fontSize: 13, color: MUTED }}>Pa gen peman ankò — peryòd la fèmen poukont li dènye jou kalandriye a.</Text>
          )}
        </Section>
      ) : null}

      {showActions ? (
        <Section label="Aksyon">
          {(() => {
            const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: string; onPress?: () => void }[] = [];
            if (canToggleActive) rows.push({ icon: e.active ? "pause-circle-outline" : "play-circle-outline", label: e.active ? "Dezaktive" : "Aktive", tone: RED, onPress: onToggleActive });
            if (canEditRole) rows.push({ icon: "shield-checkmark-outline", label: "Modifye wòl", tone: RED, onPress: onEditRole });
            if (canEditSalary) rows.push({ icon: "cash-outline", label: "Modifye salè", tone: RED, onPress: onEditSalary });
            if (canEditEmail) rows.push({ icon: "mail-outline", label: "Modifye imel", tone: RED, onPress: onEditEmail });
            if (canEditEmergency) rows.push({ icon: "call-outline", label: "Kontak ijans", tone: RED, onPress: onEditEmergency });
            if (canEditCredentials) rows.push({ icon: "key-outline", label: isSelf ? "Chanje kòd / modpas" : "Reyinisyialize kòd / modpas", tone: RED, onPress: onEditCredentials });
            return rows.map((r, i) => (
              <Pressable key={r.label} onPress={r.onPress} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: HAIR }}>
                <Ionicons name={r.icon} size={20} color={r.tone} style={{ marginRight: 12 }} />
                <Text style={{ fontSize: 15, color: r.tone, fontWeight: "500" }}>{r.label}</Text>
              </Pressable>
            ));
          })()}
        </Section>
      ) : null}
    </View>
  );
}
