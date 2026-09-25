// CustomerProfile — the ONLY full-profile UI in the app (design authority).
// Dark reference design, black full-bleed. Checkout, receipt flow, Customers
// phone + tablet all render this. Data comes in via props; each caller maps
// what it already loads (stats, notes, transactions). Edit once here,
// it changes everywhere.
import React, { useState } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, fmt, monoStyle } from "../format";
import { deptName, countryName } from "./CustomerForm";

const INK = "#fff";
const MUTED = "#8e8e93";
const HAIR = "#262626";
const TILE = "#2b2b2b";

export function shortVisitDate(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fullVisitDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatBirthday(c: any): string | null {
  const y = parseInt(String(c?.birth_year ?? ""), 10);
  const m = parseInt(String(c?.birth_month ?? ""), 10);
  const d = parseInt(String(c?.birth_day ?? ""), 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  const t = new Date(y, m - 1, d);
  if (isNaN(t.getTime())) return null;
  return t.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export function addressLinesOf(c: any): string[] {
  const structured = [
    c?.address_line1,
    c?.address_line2,
    c?.commune,
    c?.department ? deptName(String(c.department)) : null,
    c?.country ? countryName(String(c.country)) : null,
  ].map(x => String(x ?? "").trim()).filter(Boolean);
  if (structured.length) return structured;
  if (c?.address) return String(c.address).split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

export function ProfileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: 14 }}>
      <Text style={{ fontWeight: "700", fontSize: 17, color: INK }}>{label}</Text>
      <View style={{ marginTop: 4 }}>{children}</View>
    </View>
  );
}

export function ProfileValue({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 17, color: INK }}>{children}</Text>;
}

export function NoteCard({ text, date, dark }: { text: string; date: string | null; dark?: boolean }) {
  if (!dark) {
    return (
      <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 14, padding: 12, marginTop: 8, backgroundColor: "white" }}>
        <Text style={{ fontSize: 15, color: "#0F172A" }} numberOfLines={3}>{text}</Text>
        {date ? <Text style={{ fontSize: 13, color: "#64748B", marginTop: 6 }}>{date}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ borderWidth: 1, borderColor: HAIR, borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: "#111" }}>
      <Text style={{ fontSize: 15, color: INK }} numberOfLines={3}>{text}</Text>
      {date ? <Text style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{date}</Text> : null}
    </View>
  );
}

function Hairline() {
  return <View style={{ height: 1, backgroundColor: HAIR }} />;
}

export function tenderLabel(method: string): string {
  const m = String(method ?? "").toLowerCase();
  if (m === "cash") return "Cash";
  if (m === "credit") return "Kredi";
  if (m === "moncash") return "MonCash";
  if (m === "natcash") return "NatCash";
  if (m === "mobile" || m === "mobile_money") return "Mobile";
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Cash";
}

export function CustomerProfileHeader({ onBack, onEdit, onMenu, backIcon, title, headerAction }: {
  onBack?: () => void;
  onEdit?: () => void;
  onMenu?: () => void;
  backIcon?: "back" | "close" | "chevron" | "x-circle";
  title?: string;
  headerAction?: React.ReactNode;
}) {
  if (!onBack && !onEdit && !onMenu && !title && !headerAction) return null;
  const backGlyph = backIcon === "close" ? "close" : backIcon === "chevron" ? "chevron-back" : backIcon === "x-circle" ? "close" : "arrow-back";
  const backBare = backIcon === "close";
  return (
    <View style={{ backgroundColor: "#000", paddingBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {onBack ? (
        backBare ? (
          <Pressable onPress={onBack} hitSlop={12} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={26} color={INK} />
          </Pressable>
        ) : (
          <Pressable onPress={onBack} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={backGlyph} size={backIcon === "chevron" ? 26 : 24} color={INK} />
          </Pressable>
        )
      ) : <View style={{ width: 56 }} />}
      {title ? (
        <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 19, color: INK }} numberOfLines={1}>{title}</Text>
      ) : <View style={{ flex: 1 }} />}
      {onMenu || onEdit || headerAction ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {headerAction}
        {onMenu ? (
          <Pressable onPress={onMenu} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="ellipsis-horizontal" size={22} color={INK} />
          </Pressable>
        ) : null}
        {onEdit && !onMenu && !headerAction ? (
          <Pressable onPress={onEdit} style={{ paddingHorizontal: 30, height: 56, borderRadius: 28, backgroundColor: INK, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 16, color: "#000" }}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
      ) : title ? <View style={{ width: 56 }} /> : null}
      </View>
      {title ? <View style={{ height: 1, backgroundColor: HAIR, marginTop: 14 }} /> : null}
    </View>
  );
}
export function CustomerProfileBody({ customer, stats, notes, transactions, onOpenTransaction, limitSection, onViewAll }: {
  customer: any;
  stats: { visits: number; spent: number; lastVisit: string | null; firstVisit: string | null };
  notes: any[];
  transactions?: any[];
  onOpenTransaction?: (sale: any) => void;
  limitSection?: React.ReactNode;
  onViewAll?: () => void;
}) {
  const [showAllTxns, setShowAllTxns] = useState(false);
  const visibleTxns = showAllTxns ? (transactions ?? []) : (transactions ?? []).slice(0, 3);
  const birthday = formatBirthday(customer);
  const addrLines = addressLinesOf(customer);
  return (
    <View style={{ backgroundColor: "#000" }}>

      <Text style={{ fontWeight: "800", fontSize: 28, color: INK, letterSpacing: -0.5 }} numberOfLines={2}>{customer?.name ?? "Kliyan"}</Text>

      <View style={{ flexDirection: "row", marginTop: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Visits</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4, ...monoStyle }}>{stats.visits}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: HAIR, marginHorizontal: 14 }} />
        <View style={{ flex: 1.4 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Last visit</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4 }} numberOfLines={1}>{shortVisitDate(stats.lastVisit)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: HAIR, marginHorizontal: 14 }} />
        <View style={{ flex: 1.4 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>First visit</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4 }} numberOfLines={1}>{shortVisitDate(stats.firstVisit)}</Text>
        </View>
      </View>

      <View style={{ height: 5, backgroundColor: TILE, borderRadius: 3, marginTop: 20 }} />

      {customer?.phone ? (
        <>
          <ProfileRow label="Phone number"><ProfileValue>{customer.phone}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {customer?.email ? (
        <>
          <ProfileRow label="Email address"><ProfileValue>{customer.email}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {customer?.id_card_number ? (
        <>
          <ProfileRow label="ID"><ProfileValue>{customer.id_card_number}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      <ProfileRow label="Marketing">
        <ProfileValue>{customer?.marketing_consent ? "Email subscribed" : "Not subscribed"}</ProfileValue>
      </ProfileRow>
      <Hairline />
      {addrLines.length ? (
        <>
          <ProfileRow label="Address">
            {addrLines.map((line, i) => (
              <Text key={i} style={{ fontSize: 17, color: INK, marginTop: i === 0 ? 0 : 2 }}>{line}</Text>
            ))}
          </ProfileRow>
          <Hairline />
        </>
      ) : null}
      {birthday ? (
        <>
          <ProfileRow label="Birthday"><ProfileValue>{birthday}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}

      <View style={{ paddingVertical: 14 }}>
        <Text style={{ fontWeight: "800", fontSize: 20, color: INK, letterSpacing: -0.3 }}>Nòt ({notes.length})</Text>
        {notes.slice(0, 3).map(n => (
          <NoteCard key={n.id} text={n.text} date={fullVisitDate(n.created_at)} dark />
        ))}
        {notes.length === 0 ? <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen nòt.</Text> : null}
      </View>
      <Hairline />
      {limitSection ? <View style={{ marginVertical: 6 }}>{limitSection}</View> : null}
      <View style={{ paddingVertical: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", fontSize: 20, color: INK, letterSpacing: -0.3 }}>Transactions</Text>
          {onViewAll ? (
            <Pressable onPress={onViewAll} hitSlop={8}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: INK, textDecorationLine: "underline" }}>View all</Text>
            </Pressable>
          ) : (transactions ?? []).length > 3 ? (
            <Pressable onPress={() => setShowAllTxns(v => !v)} hitSlop={8}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: INK, textDecorationLine: "underline" }}>{showAllTxns ? "Show less" : "View all"}</Text>
            </Pressable>
          ) : null}
        </View>
        {visibleTxns.length === 0 ? (
          <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen tranzaksyon.</Text>
        ) : (
          visibleTxns.map((t: any, i: number) => (
            <Pressable key={String(t.id ?? i)} onPress={() => onOpenTransaction?.(t)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: HAIR }}>
              <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={24} color={INK} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 17, color: INK, letterSpacing: -0.2 }} numberOfLines={1}>{fmtG(Number(t.total ?? 0))} | {tenderLabel(t.payment_method)}</Text>
                <Text style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{shortVisitDate(t.created_at ?? null)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

// Full customer transaction list — opened from "View all", designed per
// reference: back + centered title + rows with icon tile, no chevrons.
export function CustomerTxnsList({ transactions, onOpenTransaction }: {
  transactions: any[];
  onOpenTransaction?: (sale: any) => void;
}) {
  return (
    <View style={{ backgroundColor: "#000" }}>
      {(transactions ?? []).length === 0 ? (
        <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen tranzaksyon.</Text>
      ) : (
        (transactions ?? []).map((t: any, i: number) => (
          <View key={String(t.id ?? i)}>
            <Pressable onPress={() => onOpenTransaction?.(t)} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={28} color={INK} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ fontWeight: "800", fontSize: 19, color: INK, letterSpacing: -0.2 }} numberOfLines={1}>{fmtG(Number(t.total ?? 0))} | {tenderLabel(t.payment_method)}</Text>
                <Text style={{ fontSize: 15, color: MUTED, marginTop: 3 }}>{shortVisitDate(t.created_at ?? null)}</Text>
              </View>
            </Pressable>
            <Hairline />
          </View>
        ))
      )}
    </View>
  );
}

// Anchored dropdown menu for the profile dots button — renders just under
// the header, above everything (high z-index). Parent must be a positioned
// View; pass top/right for exact placement.
export function ProfileMenu({ onClose, top, right, options }: {
  onClose: () => void;
  top: number;
  right: number;
  options: { label: string; onPress: () => void }[];
}) {
  return (
    <>
      <Pressable onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, elevation: 9 }} />
      <View style={{ position: "absolute", top, right, zIndex: 50, elevation: 10, backgroundColor: "#2b2b2b", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 6, minWidth: 200 }}>
        {options.map((o, i) => (
          <Pressable
            key={o.label}
            onPress={() => { onClose(); o.onPress(); }}
            style={{ paddingVertical: 16, borderBottomWidth: i < options.length - 1 ? 1 : 0, borderBottomColor: "#3a3a3c" }}
          >
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

// ModalScreen — the single full-screen modal shell. Every modal screen
// (customer sheets, pay flow, detail) renders inside this: same black
// canvas, same top inset, always full screen height. One edit here
// restyles all of them.
export function ModalScreen({ children, topInset }: {
  children: React.ReactNode;
  topInset?: number;
}) {
  const { height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, minHeight: height, backgroundColor: "#000", padding: 18, paddingTop: topInset ?? 60 }}>
      {children}
    </View>
  );
}
