import React from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput } from "react-native";
import { centerBox } from "../responsive";
import { palette, radius, shadow } from "../theme";
import { fmt, monoStyle } from "../format";
import { CustomerListEmpty } from "./CustomersShared";

export interface CustomersTabletProps {
  customers: any[];
  debts: any[];
  displayCustomers: any[];
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  selectedCustomer: any | null;
  customerHistory: any[];
  pastCredits: any[];
  pastSales: any[];
  showPastCredits: boolean;
  setShowPastCredits: React.Dispatch<React.SetStateAction<boolean>>;
  canManageCustomers: boolean;
  isManagerPlus: boolean;
  setIsEditingCustomer: (v: boolean) => void;
  padH: number;
  width: number;
  isTablet: boolean;
  /** Wired to the shell's existing add-customer handler (setShowAddCustomer(true)). Optional so older callers keep compiling. */
  onAdd?: () => void;
}

// ── Web-mirror atoms (tablet-local; math + copy match CustomersShared) ──

function TabletSearchBlock(props: {
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  customers: any[];
  debts: any[];
}) {
  const { search, setSearch, showDebtOnly, setShowDebtOnly, customers, debts } = props;
  return (
    <View style={{ padding: 12, borderBottomWidth: 0.5, borderColor: palette.hairline, backgroundColor: palette.surface, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 }}>
        <Text style={{ fontSize: 13, color: palette.muted3 }}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Chèche pa non, NIF/CIN, telefòn oswa adrès"
          placeholderTextColor={palette.muted3}
          style={{ flex: 1, fontSize: 13.5, color: palette.ink, paddingVertical: 0 }}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "600" }}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Small segmented — web .segmented, compact */}
      <View style={{ alignSelf: "flex-start", flexDirection: "row", backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, padding: 2, gap: 2 }}>
        <Pressable
          onPress={() => setShowDebtOnly(false)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: !showDebtOnly ? palette.surface : "transparent",
            borderWidth: !showDebtOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: !showDebtOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: !showDebtOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Tout • {customers.length}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowDebtOnly(true)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: showDebtOnly ? palette.surface : "transparent",
            borderWidth: showDebtOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: showDebtOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: showDebtOnly ? palette.warningDot : "#CBD5E1" }} />
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: showDebtOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Ki gen dèt • {debts.length}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TabletCustomerRow(props: { item: any; debts: any[]; isSelected: boolean; onPress: () => void }) {
  const { item, debts, isSelected, onPress } = props;
  // Same math as CustomersShared.CustomerRowCard
  const debtRows = debts.filter((d: any) => d.customer_id === item.id && Number(d.balance) > 0);
  const computedDebt = debtRows.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);
  const totalDebt = Number(item.total_debt ?? 0) > 0 ? Number(item.total_debt) : computedDebt;
  const hasDebt = debtRows.length > 0;
  const active = isSelected;
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? palette.ink : palette.surface,
        borderWidth: 0.5,
        borderColor: active ? palette.ink : hasDebt ? palette.dangerBd : palette.hairline,
        borderRadius: radius.md,
        padding: 12,
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: active ? 0.12 : 0.04,
        shadowRadius: active ? 16 : 4,
        shadowOffset: { width: 0, height: active ? 4 : 1 },
        elevation: active ? 4 : 1,
      }}
    >
      {hasDebt && !active && (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: palette.dangerDot }} />
      )}
      <View
        style={{
          width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
          backgroundColor: active ? palette.surface : hasDebt ? palette.dangerBg : palette.successBg,
        }}
      >
        <Text style={{ fontWeight: "800", fontSize: 13, color: active ? palette.ink : hasDebt ? "#7F1D1D" : "#065F46" }}>
          {(item.name?.[0] ?? "•").toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", fontSize: 13, color: active ? "#FFFFFF" : palette.ink }} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.64)" : palette.muted2, marginTop: 1 }} numberOfLines={1}>
          ID {item.id_card_number || "—"}{item.phone ? ` • ${item.phone}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", minWidth: 76 }}>
        <Text style={{ fontWeight: "800", fontSize: 12, color: active ? "#FFFFFF" : hasDebt ? palette.danger : palette.success, textAlign: "right", ...monoStyle }}>
          {fmt(totalDebt)} HTG
        </Text>
        <Text style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.54)" : palette.muted2, marginTop: 1 }}>
          {hasDebt ? `${debtRows.length} dèt` : "A jou"}
        </Text>
      </View>
    </Pressable>
  );
}

function TabletProfileCard(props: { customer: any; debts: any[]; canManageCustomers: boolean; onEdit: () => void }) {
  const { customer, debts, canManageCustomers, onEdit } = props;
  // Same math as CustomersShared.DetailHeaderContent
  const sRows = debts.filter((d: any) => d.customer_id === customer.id && Number(d.balance) > 0);
  const sComp = sRows.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);
  const disp = Number(customer.total_debt ?? 0) > 0 ? Number(customer.total_debt) : sComp;
  const hasDebt = sRows.length > 0 || disp > 0;
  const openCount = customer.open_debt_count ?? sRows.length;
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
      {/* Profile header — web inspector top block */}
      <View style={{ padding: 16, flexDirection: "row", gap: 12, alignItems: "center", borderBottomWidth: 0.5, borderColor: palette.hairline }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 16, color: palette.ink }}>{(customer.name?.[0] ?? "•").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <Text style={{ fontWeight: "800", fontSize: 16, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>
              {customer.name}
            </Text>
            <View style={{ backgroundColor: sRows.length > 0 ? palette.dangerBg : palette.successBg, borderWidth: 0.5, borderColor: sRows.length > 0 ? palette.dangerBd : palette.successBd, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: sRows.length > 0 ? "#7F1D1D" : "#065F46" }}>
                {sRows.length > 0 ? `${sRows.length} dèt aktif` : "A jou"}
              </Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, color: palette.muted, marginTop: 3 }} numberOfLines={2}>
            NIF/CIN {customer.id_card_number || "—"} • {customer.phone || "Pa gen telefòn"}{customer.address ? ` • ${customer.address}` : ""}
          </Text>
        </View>
        {canManageCustomers && (
          <Pressable onPress={onEdit} style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.soft }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>✎ Modifye</Text>
          </Pressable>
        )}
      </View>

      {/* 2-col tiles — web DÈT TOTAL / LIMIT KREDI */}
      <View style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: 14, padding: 12 }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: palette.muted2, letterSpacing: 0.6 }}>DÈT TOTAL</Text>
            <Text style={{ fontWeight: "800", fontSize: 16, color: hasDebt ? palette.danger : palette.success, marginTop: 4, ...monoStyle }}>
              {fmt(disp)} HTG
            </Text>
            <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{openCount} dèt ouvè</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: 14, padding: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: palette.muted2, letterSpacing: 0.6 }}>LIMIT KREDI</Text>
            <Text style={{ fontWeight: "800", fontSize: 16, color: palette.ink, marginTop: 4 }}>
              {customer.credit_limit == null ? "San limit" : `${fmt(Number(customer.credit_limit))} HTG`}
            </Text>
            {customer.credit_limit_source ? (
              <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>Sous: {customer.credit_limit_source}</Text>
            ) : null}
          </View>
        </View>
        {/* Phone / address tiles row */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: palette.muted2, letterSpacing: 0.6 }}>TELEFÒN</Text>
            <Text style={{ fontWeight: "600", fontSize: 13, color: palette.ink, marginTop: 2 }} numberOfLines={1}>{customer.phone || "—"}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: palette.muted2, letterSpacing: 0.6 }}>ADRÈS</Text>
            <Text style={{ fontWeight: "600", fontSize: 13, color: palette.ink, marginTop: 2 }} numberOfLines={1}>{customer.address || "—"}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function TabletActiveDebtsCard(props: { customer: any; debts: any[] }) {
  const { customer, debts } = props;
  // Same math as CustomersShared.ActiveDebtsCard
  const active = debts.filter((d: any) => d.customer_id === customer.id && Number(d.balance) > 0);
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", letterSpacing: -0.2, color: palette.ink }}>Dèt aktif</Text>
          <Text style={{ fontSize: 11.5, color: palette.muted, marginTop: 2 }}>
            {active.length > 0 ? `${active.length} dèt ki poko peye` : "Okenn dèt — kliyan a jou"}
          </Text>
        </View>
        <View style={{ backgroundColor: active.length > 0 ? palette.dangerBg : palette.successBg, borderWidth: 0.5, borderColor: active.length > 0 ? palette.dangerBd : palette.successBd, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: active.length > 0 ? "#7F1D1D" : "#065F46" }}>
            {active.length > 0 ? "Atansyon" : "A jou"}
          </Text>
        </View>
      </View>
      {active.length === 0 ? (
        <Text style={{ padding: 16, color: palette.muted2, fontSize: 13, textAlign: "center" }}>Okenn dèt aktif • Kliyan ka pran nouvo kredi</Text>
      ) : (
        <View>
          {active.map((d: any) => {
            const due = d.due_date ? new Date(d.due_date) : null;
            const overdue = due ? due.getTime() < Date.now() : false;
            return (
              <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 0.5, borderColor: palette.hairline, backgroundColor: overdue ? palette.dangerBg : palette.warningBg }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: "700", fontSize: 12, color: palette.ink }} numberOfLines={1}>
                    {d.sale_id ?? d.id} • {fmt(Number(d.amount ?? 0))} HTG
                  </Text>
                  <Text style={{ fontSize: 11, color: overdue ? "#7F1D1D" : palette.warning, marginTop: 2 }}>
                    {overdue ? "An reta" : "Poko rive"} • Echèans {due ? due.toLocaleDateString() : "—"}
                  </Text>
                </View>
                <View style={{ backgroundColor: overdue ? palette.danger : palette.warning, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ fontWeight: "800", fontSize: 12, color: "#FFFFFF", ...monoStyle }}>{fmt(Number(d.balance))} HTG</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function TabletPurchaseHistoryPanels(props: {
  customer: any;
  pastCredits: any[];
  pastSales: any[];
  showPastCredits: boolean;
  onToggle: () => void;
}) {
  const { customer, pastCredits, pastSales, showPastCredits, onToggle } = props;
  // Same math as CustomersShared.PurchaseHistoryCard — strictly this client, deduped
  const filteredKredi = Array.from(
    new Map(pastCredits.filter((c: any) => c.customer_id === customer?.id).map((c: any) => [c.id, c] as const)).values()
  );
  const filteredOtherRaw = pastSales.filter((s: any) => s.customer_id === customer?.id && String(s.payment_method ?? "").toLowerCase() !== "credit");
  const filteredOther = Array.from(new Map(filteredOtherRaw.map((s: any) => [s.id, s] as const)).values());
  const krediCount = filteredKredi.length;
  const otherCount = filteredOther.length;
  const payMeta = (m: string) => {
    const v = String(m ?? "").toLowerCase();
    if (v === "moncash") return { label: "MonCash", bg: palette.dangerBg, bd: palette.dangerBd, tx: "#7F1D1D", dot: palette.dangerDot };
    if (v === "natcash") return { label: "NatCash", bg: palette.blueBg, bd: palette.blueBd, tx: "#1E40AF", dot: palette.blue };
    return { label: "Kach", bg: palette.successBg, bd: palette.successBd, tx: "#065F46", dot: palette.successDot };
  };
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", letterSpacing: -0.2, color: palette.ink }}>Istwa acha — Kredi vs Kach</Text>
          <Text style={{ fontSize: 11.5, color: palette.muted, marginTop: 2 }}>
            {krediCount} Kredi · {otherCount} Kach/Mobil · Separe klèman
          </Text>
        </View>
        <Pressable
          onPress={onToggle}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7,
            backgroundColor: showPastCredits ? palette.ink : palette.surfaceGrouped,
            borderWidth: 0.5, borderColor: showPastCredits ? palette.ink : palette.hairline,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: showPastCredits ? "#FFFFFF" : palette.muted }}>{showPastCredits ? "Kache" : "Wè"}</Text>
          <Text style={{ fontSize: 10, color: showPastCredits ? "#FFFFFF" : palette.muted2 }}>{showPastCredits ? "▴" : "▾"}</Text>
        </Pressable>
      </View>

      {showPastCredits && (
        <View style={{ flexDirection: "row", gap: 12, padding: 16 }}>
          {/* Kredi panel — purple tint */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#5B21B6" }} />
              <Text style={{ fontSize: 11, fontWeight: "800", color: "#5B21B6", letterSpacing: 0.4 }}>KREDI • {krediCount}</Text>
            </View>
            <View style={{ marginTop: 8, gap: 8 }}>
              {krediCount === 0 ? (
                <View style={{ backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 12, color: palette.muted2 }}>Poko gen Kredi</Text>
                </View>
              ) : (
                filteredKredi.map((c: any) => {
                  const bal = Number(c.balance ?? 0);
                  const amt = Number(c.amount ?? 0);
                  const paid = Math.max(0, amt - bal);
                  const isPaid = bal <= 0.01;
                  const isPartial = !isPaid && paid > 0;
                  const badge = isPaid
                    ? { bg: palette.successBg, bd: palette.successBd, tx: "#065F46", label: "Peye" }
                    : isPartial
                      ? { bg: palette.warningBg, bd: palette.warningBd, tx: palette.warning, label: "Pasyèl" }
                      : { bg: palette.dangerBg, bd: palette.dangerBd, tx: "#7F1D1D", label: "Dwe" };
                  const due = c.due_date ? new Date(c.due_date) : null;
                  const dt = c.updated_at ?? c.created_at ?? null;
                  return (
                    <View key={c.id} style={{ backgroundColor: palette.violetBg, borderWidth: 0.5, borderColor: palette.violetBd, borderRadius: radius.sm, padding: 10 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, flex: 1 }} numberOfLines={1}>
                          {c.sale_id ?? c.id} • {fmt(amt)} HTG
                        </Text>
                        <View style={{ backgroundColor: badge.bg, borderWidth: 0.5, borderColor: badge.bd, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: badge.tx }}>{badge.label}</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: palette.muted, marginTop: 3 }}>
                        Rès {fmt(bal)} HTG • {dt ? new Date(dt).toLocaleDateString() : "—"}{due ? ` • Echèans ${due.toLocaleDateString()}` : ""} • Peye {fmt(paid)} HTG
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          {/* Kach panel — green accent */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.success }} />
              <Text style={{ fontSize: 11, fontWeight: "800", color: "#065F46", letterSpacing: 0.4 }}>KACH • {otherCount}</Text>
            </View>
            <View style={{ marginTop: 8, gap: 8 }}>
              {otherCount === 0 ? (
                <View style={{ backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 12, color: palette.muted2 }}>Poko gen Kach/Mobil</Text>
                </View>
              ) : (
                filteredOther.map((s: any) => {
                  const m = payMeta(s.payment_method);
                  const dt = s.updated_at ?? s.created_at ?? null;
                  return (
                    <View key={s.id} style={{ backgroundColor: palette.bgWarm, borderWidth: 0.5, borderColor: palette.hairline, borderLeftWidth: 2, borderLeftColor: palette.success, borderRadius: radius.sm, padding: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, flex: 1 }} numberOfLines={1}>{s.sale_number ?? s.id}</Text>
                        <View style={{ backgroundColor: m.bg, borderWidth: 0.5, borderColor: m.bd, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: m.tx }}>{m.label}</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: palette.muted, marginTop: 3 }}>
                        {fmt(Number(s.total ?? s.amount ?? 0))} HTG • Peye • {dt ? new Date(dt).toLocaleDateString() : "—"}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function TabletAuditCard(props: { history: any[] }) {
  const { history } = props;
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", letterSpacing: -0.2, color: palette.ink }}>Odit modifikasyon</Text>
          <Text style={{ fontSize: 11.5, color: palette.muted, marginTop: 2 }}>customer_history — 10 dènye</Text>
        </View>
        <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#3A3A3C" }}>{history.length} antre</Text>
        </View>
      </View>
      {history.length === 0 ? (
        <Text style={{ padding: 16, color: palette.muted2, fontSize: 13, textAlign: "center" }}>Poko gen modifikasyon anrejistre pou kliyan sa a</Text>
      ) : (
        <View>
          {history.map((h: any) => (
            <View key={h.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 0.5, borderColor: palette.hairline }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: palette.ink }}>
                {h.field_name} • {h.action} • {h.created_at ? new Date(h.created_at).toLocaleDateString() : ""} • Itilizatè {h.user_id}
              </Text>
              <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }} numberOfLines={2}>
                {(h.old_value ?? "—") + " → " + (h.new_value ?? "—")}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Tablet shell (master-detail) ──

export function CustomersTablet(props: CustomersTabletProps) {
  const {
    customers, debts, displayCustomers, search, setSearch, showDebtOnly, setShowDebtOnly,
    selectedCustomerId, setSelectedCustomerId, selectedCustomer, customerHistory,
    pastCredits, pastSales, showPastCredits, setShowPastCredits,
    canManageCustomers, setIsEditingCustomer, padH, width, isTablet, onAdd,
  } = props;
  return (
    <View style={{ width: "100%", flex: 1 }}>
      {/* Page header — web .page-header */}
      <View style={{ paddingHorizontal: padH, paddingTop: 16, paddingBottom: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={{ fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", color: palette.muted2 }}>CRM • ISTWA • LIMIT</Text>
          <Text style={{ fontSize: 28, fontWeight: "700", letterSpacing: -1, lineHeight: 30, color: palette.ink }}>Kliyan</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.muted, maxWidth: 620 }}>
            Dosye kliyan sou desktop — chèche pa NIF/CIN, wè dèt, limit, istwa acha Kredi vs Kach, ak odit modifikasyon.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#3A3A3C" }}>{customers.length} kliyan • {debts.length} dèt aktif</Text>
          </View>
          {canManageCustomers && (
            <Pressable
              onPress={onAdd}
              style={{ backgroundColor: palette.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>＋ Nouvo Kliyan</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: padH, paddingBottom: 16, minHeight: 0 }}>
        {/* Master list card — web left column */}
        <View style={{ flex: 5, minWidth: 280, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card, flexDirection: "column" }}>
          <TabletSearchBlock
            search={search}
            setSearch={setSearch}
            showDebtOnly={showDebtOnly}
            setShowDebtOnly={setShowDebtOnly}
            customers={customers}
            debts={debts}
          />
          <View style={{ flex: 1, backgroundColor: palette.surface2, padding: 10 }}>
            <FlatList
              data={displayCustomers}
              keyExtractor={(item, index) => `${item.id}__${index}`}
              key="tablet-1"
              numColumns={1}
              contentContainerStyle={{ paddingBottom: 24, gap: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCustomerId;
                return (
                  <TabletCustomerRow item={item} debts={debts} isSelected={isSelected} onPress={() => setSelectedCustomerId(isSelected ? null : item.id)} />
                );
              }}
              ListEmptyComponent={<CustomerListEmpty />}
            />
          </View>
        </View>

        {/* Inspector — web right column */}
        <View style={{ flex: 7, minWidth: 0, flexDirection: "column", minHeight: 0 }}>
          {!selectedCustomer ? (
            <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, padding: 28, alignItems: "center", justifyContent: "center", ...shadow.card }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 18, color: palette.muted2 }}>◯</Text>
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, textAlign: "center" }}>Chwazi yon kliyan</Text>
              <Text style={{ color: palette.muted2, fontSize: 13, marginTop: 4, textAlign: "center" }}>Klike sou lis la pou wè dosye konplè — dèt, limit, istwa Kredi ak Kach separe.</Text>
            </View>
          ) : (
            <View style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: 12 }}>
              <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                <TabletProfileCard customer={selectedCustomer} debts={debts} canManageCustomers={canManageCustomers} onEdit={() => setIsEditingCustomer(true)} />

                <TabletActiveDebtsCard customer={selectedCustomer} debts={debts} />

                <TabletPurchaseHistoryPanels
                  customer={selectedCustomer}
                  pastCredits={pastCredits}
                  pastSales={pastSales}
                  showPastCredits={showPastCredits}
                  onToggle={() => setShowPastCredits(v => !v)}
                />

                <TabletAuditCard history={customerHistory} />
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.lg, ...shadow.soft }}>
                <Pressable
                  onPress={() => setSelectedCustomerId(null)}
                  style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.ink, borderRadius: radius.pill, alignItems: "center" }}
                >
                  <Text style={{ fontWeight: "600", color: "#FFFFFF", fontSize: 14 }}>Fèmen</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
