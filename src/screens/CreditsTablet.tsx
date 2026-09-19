import React from "react";
import { View, Text, FlatList, Pressable, ScrollView } from "react-native";
import { useResponsive } from "../responsive";
import { monoStyle } from "../format";
import {
  LUX,
  RANGE_OPTIONS,
  CreditsSearchBar,
  CustomerSuggestions,
  CreditsFilterChips,
  CreditsEmptyState,
  formatCurrency,
} from "./CreditsShared";
import type { CreditsPhoneProps } from "./CreditsPhone";

export interface CreditsTabletProps extends CreditsPhoneProps {
  modalCustomer: any | null;
  modalSelectedDebtId: string | null;
  allDebts: any[];
  allSaleItems: any[];
  expandedHistoryDebtId: string | null;
  setExpandedHistoryDebtId: (id: string | null) => void;
  expandedArticlesDebtId: string | null;
  setExpandedArticlesDebtId: (id: string | null) => void;
  closeDebtModal: () => void;
  handleModalPayNowPress: () => void;
  onNewCreditPress?: () => void;
}

// Web desktop tints (CreditsPage.tsx) — applied as tablet-local variants.
const WEB = {
  successBg: "#EAF6EE",
  successBd: "#A7D8B5",
  successTx: "#065F46",
  successDeep: "#064E3B",
  successSub: "#0A7C3E",
  dangerBg: "#FFF1F2",
  dangerBd: "#FECDD3",
  dangerTx: "#7F1D1D",
  warnBg: "#FFFBEB",
  warnBd: "#FDE68A",
  warnTx: "#92400E",
  amberBg: "#FFF7ED",
  amberBd: "#FED7AA",
  amberLabel: "#9A3412",
  amberValue: "#7C2D12",
  amberSub: "#C2410C",
  groupedBg: "#F9F9FB",
  groupedBd: "#E8E8EC",
  trackBg: "#FEE2E2",
  barGreen: "#0A7C3E",
  dotPink: "#FCA5A5",
  barRed: "#FF3B30",
  barAmber: "#FF9F0A",
  ink: "#16130c",
};

function TabletPageHeader({
  filteredCount,
  openCount,
  canManageCustomer,
  onNewCreditPress,
}: {
  filteredCount: number;
  openCount: number;
  canManageCustomer: boolean;
  onNewCreditPress?: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>
          JESYON DÈT • PEMAN • RÈS
        </Text>
        <Text style={{ fontSize: 28, fontWeight: "800", color: WEB.ink, letterSpacing: -0.5, marginTop: 4 }}>
          Kredi / Dèt
        </Text>
        <Text style={{ fontSize: 12, color: LUX.muted, marginTop: 4, lineHeight: 17 }}>
          Pa janm pèdi tras dèt kliyan — repatisyon, echèans, peman pasyèl, resi REC-, ak penalite reta otomatik.
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        {canManageCustomer && onNewCreditPress ? (
          <Pressable
            onPress={onNewCreditPress}
            style={{
              backgroundColor: WEB.ink,
              borderWidth: 1,
              borderColor: "#3D3D40",
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 5 },
              elevation: 5,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 0.4 }}>＋ Nouvo Kredi</Text>
          </Pressable>
        ) : null}
        <View
          style={{
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: LUX.hairline2,
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: WEB.ink, letterSpacing: 0.2 }}>
            {filteredCount} dèt • {openCount} ouvè
          </Text>
        </View>
      </View>
    </View>
  );
}

function TabletAnalyticsCard({
  analytics,
  ringTrace,
  range,
  setRange,
  filteredCount,
  openCount,
}: {
  analytics: CreditsTabletProps["analytics"];
  ringTrace: CreditsTabletProps["ringTrace"];
  range: CreditsTabletProps["range"];
  setRange: CreditsTabletProps["setRange"];
  filteredCount: number;
  openCount: number;
}) {
  const paidPct = Math.round(ringTrace.paidPercent);
  const unpaidPct = Math.round(ringTrace.unpaidPercent);
  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: "#837b69" }}>
          {filteredCount} dèt • {openCount} ouvè • {formatCurrency(analytics.totalOutstanding)} dwe
        </Text>
        <View style={{ flexDirection: "row", backgroundColor: WEB.groupedBg, borderWidth: 1, borderColor: WEB.groupedBd, borderRadius: 12, padding: 4, gap: 2 }}>
          {RANGE_OPTIONS.map((option) => {
            const isSelected = range === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setRange(option.key)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: isSelected ? WEB.ink : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontWeight: isSelected ? "700" : "500", fontSize: 11, color: isSelected ? "#fff" : LUX.muted }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <View style={{ flex: 1, backgroundColor: WEB.amberBg, borderWidth: 0.5, borderColor: WEB.amberBd, borderRadius: 16, padding: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: WEB.amberLabel }}>KREDI BAY</Text>
          <Text style={{ fontWeight: "800", fontSize: 18, color: WEB.amberValue, marginTop: 6, letterSpacing: -0.3 }}>
            {formatCurrency(analytics.creditGiven)}
          </Text>
          <Text style={{ fontSize: 11, color: WEB.amberSub, marginTop: 2 }}>nan peryòd sa a</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: WEB.successBg, borderWidth: 0.5, borderColor: WEB.successBd, borderRadius: 16, padding: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.7, color: WEB.successTx }}>KREDI PEYE</Text>
          <Text style={{ fontWeight: "800", fontSize: 18, color: WEB.successDeep, marginTop: 6, letterSpacing: -0.3 }}>
            {formatCurrency(analytics.creditPaid)}
          </Text>
          <Text style={{ fontSize: 11, color: WEB.successSub, marginTop: 2 }}>{paidPct}% ranbouse</Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: WEB.groupedBg,
          borderWidth: 0.5,
          borderColor: WEB.groupedBd,
          borderRadius: 14,
          padding: 12,
          marginTop: 12,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 4,
            borderColor: WEB.dotPink,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fff",
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 12, color: WEB.successSub }}>{paidPct}%</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: WEB.ink }}>To ranbousman</Text>
          <View style={{ marginTop: 6, height: 6, backgroundColor: WEB.trackBg, borderRadius: 999, overflow: "hidden" }}>
            <View style={{ width: `${Math.min(100, Math.max(0, ringTrace.paidPercent))}%` as any, height: 6, backgroundColor: WEB.barGreen }} />
          </View>
          <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: WEB.barGreen }} />
              <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Peye {paidPct}%</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: WEB.dotPink }} />
              <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Pa peye {unpaidPct}%</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function TabletDebtRow({
  debt: d,
  customer: cust,
  allPayments,
  selected,
  onPress,
}: {
  debt: any;
  customer?: any;
  allPayments: any[];
  selected: boolean;
  onPress: () => void;
}) {
  const initialAmount = Number(d.amount || 0);
  const paymentsForCard = allPayments.filter((p) => p.debt_id === d.id || p.credit_id === d.id);
  const totalPaid = paymentsForCard.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = Math.max(0, initialAmount - totalPaid);
  const isPaid = balance <= 0.01;
  const isOverdue = !isPaid && d.due_date && new Date(d.due_date) < new Date();
  const cardBg = selected ? WEB.ink : isPaid ? WEB.successBg : isOverdue ? WEB.dangerBg : WEB.warnBg;
  const cardBd = selected ? WEB.ink : isPaid ? WEB.successBd : isOverdue ? WEB.dangerBd : WEB.warnBd;
  const strongTx = selected ? "#FFFFFF" : isPaid ? WEB.successTx : isOverdue ? WEB.dangerTx : WEB.warnTx;
  const softTx = selected ? "rgba(255,255,255,0.64)" : "#837b69";
  const faintTx = selected ? "rgba(255,255,255,0.54)" : "#837b69";
  const barColor = isPaid ? WEB.barGreen : isOverdue ? WEB.barRed : WEB.barAmber;
  const pctPaid = initialAmount > 0 ? Math.min(100, Math.round((totalPaid / initialAmount) * 100)) : 0;
  const dueLabel = d.due_date ? new Date(d.due_date).toLocaleDateString() : "—";
  const pillBg = selected ? "rgba(255,255,255,0.14)" : isPaid ? WEB.successBg : isOverdue ? WEB.dangerBg : WEB.warnBg;
  const pillBd = selected ? "rgba(255,255,255,0.18)" : cardBd;
  const pillTx = selected ? "#fff" : strongTx;
  const avatarLetter = (cust?.name ?? "K")?.charAt(0)?.toUpperCase() ?? "K";

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: cardBg,
        borderWidth: 0.5,
        borderColor: cardBd,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        shadowColor: "#000",
        shadowOpacity: selected ? 0.12 : 0.04,
        shadowRadius: selected ? 16 : 2,
        shadowOffset: { width: 0, height: selected ? 4 : 1 },
        elevation: selected ? 4 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 15, color: selected ? WEB.ink : strongTx }}>{avatarLetter}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <Text style={{ fontWeight: "700", fontSize: 13, color: selected ? "#fff" : WEB.ink }} numberOfLines={1}>
              {cust?.name ?? "Kliyan enkoni"}
            </Text>
            <View
              style={{
                backgroundColor: pillBg,
                borderWidth: 0.5,
                borderColor: pillBd,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 999,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: "700", color: pillTx }}>{isPaid ? "PAYE" : isOverdue ? "AN RETA" : "POKO RIVE"}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 11, color: softTx, marginTop: 2 }} numberOfLines={1}>
            {cust?.id_card_number || "—"} • {cust?.phone || "Pa gen telefòn"}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontWeight: "800", fontSize: 13, color: selected ? "#FFFFFF" : strongTx, ...monoStyle }}>
            {formatCurrency(balance)}
          </Text>
          <Text style={{ fontSize: 11, color: faintTx, marginTop: 1 }}>sou {formatCurrency(initialAmount)}</Text>
        </View>
      </View>
      <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, color: faintTx }} numberOfLines={1}>
          {d.sale_id || d.id} • Echèans {dueLabel}
        </Text>
        <Text style={{ fontSize: 11, fontWeight: "700", color: selected ? "#fff" : WEB.ink }}>{pctPaid}% peye</Text>
      </View>
      <View
        style={{
          marginTop: 8,
          height: 4,
          backgroundColor: selected ? "rgba(255,255,255,0.14)" : "#FFFFFF",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${pctPaid}%` as any, height: 4, backgroundColor: barColor }} />
      </View>
    </Pressable>
  );
}

function TabletInspector({
  customer,
  debt: d,
  allPayments,
  allSaleItems,
  historyExpanded,
  articlesExpanded,
  onToggleHistory,
  onToggleArticles,
  onClose,
  onPayNow,
}: {
  customer: any;
  debt: any;
  allPayments: any[];
  allSaleItems: any[];
  historyExpanded: boolean;
  articlesExpanded: boolean;
  onToggleHistory: () => void;
  onToggleArticles: () => void;
  onClose: () => void;
  onPayNow: () => void;
}) {
  const payments = allPayments
    .filter((p) => p.debt_id === d.id || p.credit_id === d.id)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const initialAmount = Number(d.amount || 0);
  const paidDisplay = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const currentDue = Math.max(0, initialAmount - paidDisplay);
  const isPaid = currentDue <= 0.01;
  const isOverdue = !isPaid && d.due_date && new Date(d.due_date) < new Date();
  const saleItems = allSaleItems.filter((it) => it.sale_id === d.sale_id);
  const statusBg = isPaid ? WEB.successBg : isOverdue ? WEB.dangerBg : WEB.warnBg;
  const statusBd = isPaid ? WEB.successBd : isOverdue ? WEB.dangerBd : WEB.warnBd;
  const statusTx = isPaid ? WEB.successTx : isOverdue ? WEB.dangerTx : WEB.warnTx;
  const dueLabel = d.due_date ? new Date(d.due_date).toLocaleDateString() : "—";

  return (
    <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: LUX.hairline, overflow: "hidden" }}>
      <View
        style={{
          padding: 16,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottomWidth: 0.5,
          borderColor: WEB.groupedBd,
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, color: WEB.ink }} numberOfLines={1}>
            {customer?.name ?? "—"}
          </Text>
          <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 2 }} numberOfLines={1}>
            {customer?.id_card_number || "—"} • {customer?.phone || "Pa gen telefòn"} • Limit{" "}
            {customer?.credit_limit == null ? "—" : `${customer.credit_limit} HTG`}
          </Text>
        </View>
        <View style={{ backgroundColor: statusBg, borderWidth: 0.5, borderColor: statusBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: statusTx, letterSpacing: 0.4 }}>
            {isPaid ? "PAYE" : isOverdue ? "AN RETA" : "POKO RIVE"}
          </Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 460 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 10 }}
      >
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: WEB.groupedBg,
              borderWidth: 0.5,
              borderColor: WEB.groupedBd,
              borderRadius: 14,
              padding: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: "700", color: "#837b69" }}>MONTAN INISYAL</Text>
            <Text style={{ fontWeight: "800", fontSize: 15, marginTop: 4, color: WEB.ink }}>{formatCurrency(initialAmount)}</Text>
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: isPaid ? WEB.successBg : isOverdue ? WEB.dangerBg : WEB.warnBg,
              borderWidth: 0.5,
              borderColor: isPaid ? WEB.successBd : isOverdue ? WEB.dangerBd : WEB.warnBd,
              borderRadius: 14,
              padding: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: "700", color: statusTx }}>RÈS AKTYÈL</Text>
            <Text style={{ fontWeight: "800", fontSize: 15, color: statusTx, marginTop: 4 }}>{formatCurrency(currentDue)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: WEB.groupedBg,
              borderWidth: 0.5,
              borderColor: WEB.groupedBd,
              borderRadius: 12,
              padding: 10,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Peye</Text>
            <Text style={{ fontWeight: "800", fontSize: 12, color: WEB.successSub }}>{formatCurrency(paidDisplay)}</Text>
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: WEB.groupedBg,
              borderWidth: 0.5,
              borderColor: WEB.groupedBd,
              borderRadius: 12,
              padding: 10,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Echèans</Text>
            <Text style={{ fontWeight: "700", fontSize: 12, color: WEB.ink }}>{dueLabel}</Text>
          </View>
        </View>

        <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 14, padding: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "700", fontSize: 13, color: WEB.ink }}>
              Istwa peman{" "}
              {payments.length > 0 ? (
                <Text style={{ fontSize: 10, fontWeight: "800", color: LUX.muted }}>• {payments.length} resi</Text>
              ) : null}
            </Text>
            <Pressable onPress={onToggleHistory} hitSlop={8}>
              <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "700" }}>{historyExpanded ? "▾ Kache" : "▸ Wè"}</Text>
            </Pressable>
          </View>
          {historyExpanded ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {payments.length === 0 ? (
                <View style={{ backgroundColor: WEB.groupedBg, borderWidth: 0.5, borderColor: WEB.groupedBd, borderRadius: 12, padding: 12 }}>
                  <Text style={{ color: "#837b69", fontSize: 12, textAlign: "center" }}>Poko gen peman pasyèl.</Text>
                </View>
              ) : (
                payments.map((p) => (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      backgroundColor: WEB.groupedBg,
                      borderWidth: 0.5,
                      borderColor: WEB.groupedBd,
                      borderRadius: 12,
                      padding: 10,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: LUX.body, flex: 1, paddingRight: 8 }} numberOfLines={1}>
                      {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"} • {p.payment_method || "Kach"} •{" "}
                      {p.receipt_number || p.receipt || "—"}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: WEB.ink }}>{formatCurrency(Number(p.amount || 0))}</Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={onToggleArticles}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: WEB.groupedBg,
            borderWidth: 0.5,
            borderColor: WEB.groupedBd,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: LUX.body }}>
            Atik yo {saleItems.length > 0 ? `• ${saleItems.length} atik` : ""}
          </Text>
          <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "700" }}>{articlesExpanded ? "▾ Kache" : "▸ Wè"}</Text>
        </Pressable>
        {articlesExpanded && (
          <View style={{ gap: 0, backgroundColor: "#fff", borderWidth: 1, borderColor: WEB.groupedBd, borderRadius: 12, paddingHorizontal: 8, overflow: "hidden" }}>
            {saleItems.length === 0 ? (
              <Text style={{ fontSize: 11, color: LUX.faint, textAlign: "center", padding: 12 }}>
                Poko gen detay atik pou vant sa — gade sale_items.
              </Text>
            ) : (
              saleItems.map((it, idx) => (
                <View
                  key={it.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: 8,
                    borderBottomWidth: idx === saleItems.length - 1 ? 0 : 0.5,
                    borderColor: WEB.groupedBd,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: WEB.ink }} numberOfLines={1}>
                      {it.product_name ?? it.product_id}
                    </Text>
                    <Text style={{ fontSize: 11, color: LUX.muted }}>
                      {it.quantity} × {formatCurrency(Number(it.unit_price || 0))}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: WEB.ink }}>
                    {formatCurrency(Number(it.line_total ?? it.quantity * it.unit_price))}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <View style={{ padding: 16, paddingTop: 8, gap: 8 }}>
        <Pressable
          onPress={onPayNow}
          style={{
            backgroundColor: WEB.ink,
            borderWidth: 1,
            borderColor: LUX.gold,
            borderRadius: 12,
            paddingVertical: 13,
            alignItems: "center",
            shadowColor: WEB.ink,
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Text style={{ fontWeight: "800", color: LUX.goldSoft, fontSize: 13, letterSpacing: 0.2 }}>PEYE KOUNYE A</Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          style={{
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: LUX.hairline,
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "700", color: LUX.body, fontSize: 13 }}>Fèmen</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CreditsTablet(props: CreditsTabletProps) {
  const { padH } = useResponsive();
  const {
    filteredDebts,
    openDebts,
    customers,
    allPayments,
    allDebts,
    allSaleItems,
    range,
    setRange,
    analytics,
    ringTrace,
    search,
    setSearch,
    query,
    customerSuggestions,
    setSelectedCust,
    canManageCustomer,
    setShowAddCustomer,
    view,
    setView,
    openDebtModal,
    modalCustomer,
    modalSelectedDebtId,
    expandedHistoryDebtId,
    setExpandedHistoryDebtId,
    expandedArticlesDebtId,
    setExpandedArticlesDebtId,
    closeDebtModal,
    handleModalPayNowPress,
    onNewCreditPress,
  } = props;

  const selectedDebt = modalSelectedDebtId ? allDebts.find((dd) => dd.id === modalSelectedDebtId) : null;

  return (
    <View style={{ flex: 1, backgroundColor: LUX.bg }}>
      <View style={{ paddingHorizontal: padH, paddingTop: 16, paddingBottom: 12 }}>
        <TabletPageHeader
          filteredCount={filteredDebts.length}
          openCount={openDebts.length}
          canManageCustomer={canManageCustomer}
          onNewCreditPress={onNewCreditPress}
        />
      </View>
      <View style={{ flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: padH, paddingBottom: 12 }}>
        <View style={{ flex: 3 }}>
          <FlatList
            data={filteredDebts}
            keyExtractor={(i) => i.id}
            key="tablet-master"
            numColumns={1}
            columnWrapperStyle={undefined}
            showsVerticalScrollIndicator={true}
            bounces={true}
            contentContainerStyle={{ paddingBottom: 96, gap: 0 }}
            ListHeaderComponent={
              <View style={{ gap: 12, marginBottom: 12 }}>
                <TabletAnalyticsCard
                  analytics={analytics}
                  ringTrace={ringTrace}
                  range={range}
                  setRange={setRange}
                  filteredCount={filteredDebts.length}
                  openCount={openDebts.length}
                />
                <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 12, gap: 10 }}>
                  <CreditsSearchBar search={search} setSearch={setSearch} />
                  {query && customerSuggestions.length === 0 && canManageCustomer && (
                    <Pressable
                      onPress={() => setShowAddCustomer(true)}
                      style={{
                        backgroundColor: "#fff",
                        borderRadius: 16,
                        padding: 12,
                        alignItems: "center",
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 8,
                        borderWidth: 1,
                        borderColor: LUX.hairline,
                        borderStyle: "dashed",
                      }}
                    >
                      <Text style={{ fontSize: 16, color: LUX.ink, fontWeight: "700" }}>＋</Text>
                      <Text style={{ color: LUX.ink, fontWeight: "700", fontSize: 13 }}>New Customer</Text>
                    </Pressable>
                  )}
                  <CustomerSuggestions
                    suggestions={customerSuggestions}
                    onSelect={(c) => {
                      setSearch(c.name);
                      setSelectedCust(c);
                    }}
                  />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <CreditsFilterChips view={view} setView={setView} />
                    </View>
                    <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>{filteredDebts.length} rezilta</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: LUX.ink, letterSpacing: 0.2, textTransform: "uppercase" }}>Dèt</Text>
                  <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>{filteredDebts.length} rezilta</Text>
                </View>
              </View>
            }
            ListEmptyComponent={<CreditsEmptyState view={view} />}
            renderItem={({ item: d }) => {
              const cust = customers.find((c) => c.id === d.customer_id);
              return (
                <TabletDebtRow
                  debt={d}
                  customer={cust}
                  allPayments={allPayments}
                  selected={modalSelectedDebtId === d.id}
                  onPress={() => {
                    if (cust) openDebtModal(cust, d.id);
                    else {
                      const paidForFallback = allPayments
                        .filter((p) => p.debt_id === d.id || p.credit_id === d.id)
                        .reduce((s, p) => s + Number(p.amount || 0), 0);
                      const fallbackBalance = Math.max(0, Number(d.amount || 0) - paidForFallback);
                      openDebtModal(
                        { id: d.customer_id, name: "Enkoni", id_card_number: "—", phone: "—", total_debt: fallbackBalance, credit_limit: null },
                        d.id
                      );
                    }
                  }}
                />
              );
            }}
          />
        </View>
        <View style={{ flex: 2, minWidth: 300 }}>
          {modalCustomer && modalSelectedDebtId && selectedDebt ? (
            <TabletInspector
              customer={modalCustomer}
              debt={selectedDebt}
              allPayments={allPayments}
              allSaleItems={allSaleItems}
              historyExpanded={expandedHistoryDebtId === selectedDebt.id}
              articlesExpanded={expandedArticlesDebtId === selectedDebt.id}
              onToggleHistory={() =>
                setExpandedHistoryDebtId(expandedHistoryDebtId === selectedDebt.id ? null : selectedDebt.id)
              }
              onToggleArticles={() =>
                setExpandedArticlesDebtId(expandedArticlesDebtId === selectedDebt.id ? null : selectedDebt.id)
              }
              onClose={closeDebtModal}
              onPayNow={handleModalPayNowPress}
            />
          ) : (
            <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: LUX.hairline, padding: 28, alignItems: "center" }}>
              <Text style={{ fontSize: 22, color: LUX.hairline2 }}>◇</Text>
              <Text style={{ color: LUX.muted, fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 8 }}>
                Chwazi yon dèt pou wè detay
              </Text>
              <Text style={{ color: LUX.faint, fontSize: 11, textAlign: "center", marginTop: 4 }}>
                Klike sou yon dèt pou wè detay, istwa peman, atik, ak bouton peman.
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
