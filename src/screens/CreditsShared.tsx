import React from "react";
import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import { PieChart } from "react-native-gifted-charts";
import { monoStyle, fmtHTG } from "../format";

export const LUX = {
  bg: "#fffdfd",
  ink: "#16130c",
  body: "#3D3D40",
  muted: "#837b69",
  faint: "#98989D",
  surface: "#efe7d2",
  surface2: "#EBEBEF",
  white: "#FFFFFF",
  hairline: "#E2E2E7",
  hairline2: "#D1D1D6",
  gold: "#C8A24A",
  goldSoft: "#F0EDE6",
  goldDeep: "#8A6A35",
  goldDark: "#5C4A26",
  goldBg: "#F7F5F0",
  goldBd: "#E2D9C3",
  green: "#2F7D5B",
  greenDeep: "#1F5F45",
  greenBg: "#EEF5F1",
  greenBd: "#C9DED2",
  purple: "#7C3AED",
  purpleDeep: "#5B21B6",
  purpleBg: "#F3EFFC",
  purpleBd: "#D6CCF5",
  purpleDot: "#8B5CF6",
  red: "#9C3B3B",
  redDeep: "#7A2E2E",
  redBg: "#F5ECEC",
  redBd: "#E5CECE",
  redBd2: "#D9B0AA",
  redBg2: "#F2E4E2",
  shadow: "#3E3630",
};

export type RangeKey = "today" | "7d" | "28d" | "180d" | "all";

export type CreditsView = "all" | "delinquent" | "current" | "paid";

export type AnalyticsState = {
  creditGiven: number;
  creditPaid: number;
  paidPercent: number;
  unpaidPercent: number;
  totalOutstanding: number;
};

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Jodi a" },
  { key: "7d", label: "7 jou" },
  { key: "28d", label: "28 jou" },
  { key: "180d", label: "6 mwa" },
  { key: "all", label: "Tout tan" },
];

export const FILTER_CHIPS = [
  { id: "all", label: "Tout" },
  { id: "delinquent", label: "Anreta" },
  { id: "current", label: "Pako Rive" },
  { id: "paid", label: "Peye Deja" },
] as const;

export function formatCurrency(value: number) {
  return fmtHTG(value);
}

// ---------- Metrics (trio + donut) ----------

export interface CreditsMetricsProps {
  analytics: AnalyticsState;
  ringTrace: { paidPercent: number; unpaidPercent: number };
  rangeLabel: string;
}

export function CreditsMetrics({ analytics, ringTrace, rangeLabel }: CreditsMetricsProps) {
  return (
    <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: LUX.hairline, padding: 16, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, borderRadius: 12, padding: 12, backgroundColor: LUX.purpleBg, borderTopWidth: 3, borderTopColor: LUX.purple }}>
          <Text style={{ fontSize: 9, color: LUX.purpleDeep, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Kredi Bay</Text>
          <Text style={{ fontWeight: "800", color: LUX.purpleDeep, fontSize: 17, marginTop: 6, letterSpacing: -0.4 }}>{formatCurrency(analytics.creditGiven)}</Text>
          <Text style={{ fontSize: 9, color: LUX.purpleDeep, marginTop: 2, opacity: 0.75 }}>{rangeLabel.toLowerCase() === "tout tan" ? "tout aktivite" : "nan peryòd sa a"}</Text>
        </View>
        <View style={{ flex: 1, borderRadius: 12, padding: 12, backgroundColor: LUX.greenBg, borderTopWidth: 3, borderTopColor: LUX.green }}>
          <Text style={{ fontSize: 9, color: LUX.greenDeep, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Kredi Peye</Text>
          <Text style={{ fontWeight: "800", color: LUX.greenDeep, fontSize: 17, marginTop: 6, letterSpacing: -0.4 }}>{formatCurrency(analytics.creditPaid)}</Text>
          <Text style={{ fontSize: 9, color: LUX.greenDeep, marginTop: 2, opacity: 0.75 }}>{formatCurrency(Math.max(0, analytics.creditGiven - analytics.creditPaid))} rete</Text>
        </View>
        <View style={{ flex: 1, borderRadius: 12, padding: 12, backgroundColor: LUX.goldBg, borderTopWidth: 3, borderTopColor: LUX.gold }}>
          <Text style={{ fontSize: 9, color: LUX.goldDeep, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Sòti</Text>
          <Text style={{ fontWeight: "800", color: LUX.goldDeep, fontSize: 17, marginTop: 6, letterSpacing: -0.4 }}>{formatCurrency(analytics.totalOutstanding)}</Text>
          <Text style={{ fontSize: 9, color: LUX.goldDeep, marginTop: 2, opacity: 0.75 }}>ann dèt</Text>
        </View>
      </View>

      {/* Repayment progress - colorful donut */}
      <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: LUX.hairline, flexDirection: "row", alignItems: "center", gap: 16 }}>
        <PieChart
          donut
          data={[
            { value: Math.max(0.0001, ringTrace.paidPercent), color: LUX.green },
            { value: Math.max(0.0001, ringTrace.unpaidPercent), color: LUX.redBg },
          ]}
          radius={46}
          innerRadius={34}
          innerCircleColor="#fff"
          strokeWidth={0}
          centerLabelComponent={() => (
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: LUX.ink, letterSpacing: -0.5 }}>{Math.round(ringTrace.paidPercent)}%</Text>
              <Text style={{ fontSize: 8, color: LUX.faint, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>peye</Text>
            </View>
          )}
        />
        <View style={{ flex: 1, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: LUX.green }} />
            <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "600" }}>Peye <Text style={{ color: LUX.greenDeep, fontWeight: "800" }}>{Math.round(ringTrace.paidPercent)}%</Text></Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: LUX.redBg }} />
            <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "600" }}>Pa peye <Text style={{ color: LUX.redDeep, fontWeight: "800" }}>{Math.round(ringTrace.unpaidPercent)}%</Text></Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: LUX.gold }} />
            <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "600" }}>Rète <Text style={{ color: LUX.goldDeep, fontWeight: "800" }}>{formatCurrency(analytics.totalOutstanding)}</Text></Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---------- Search + suggestions + filter chips ----------

export interface CreditsSearchBarProps {
  search: string;
  setSearch: (v: string) => void;
}

export function CreditsSearchBar({ search, setSearch }: CreditsSearchBarProps) {
  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline2, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 14, color: LUX.body, fontWeight: "600" }}>⌕</Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Chèche pa non, NIF/CIN, telefòn oswa adrès"
        placeholderTextColor={LUX.muted}
        style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 13, fontWeight: "500", color: LUX.ink }}
      />
      {search.length > 0 && (
        <Pressable onPress={() => setSearch("")} hitSlop={8}><Text style={{ color: LUX.body, padding: 6, fontSize: 14, fontWeight: "600" }}>✕</Text></Pressable>
      )}
    </View>
  );
}

export interface CustomerSuggestionsProps {
  suggestions: any[];
  onSelect: (c: any) => void;
}

export function CustomerSuggestions({ suggestions, onSelect }: CustomerSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, overflow: "hidden" }}>
      {suggestions.map(c => (
        <Pressable key={c.id} onPress={() => onSelect(c)} style={{ padding: 12, borderBottomWidth: 1, borderColor: LUX.surface2 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: LUX.ink }}>{c.name}</Text>
          <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 2 }}>{c.id_card_number || "Pa gen NIF/CIN"} • {c.phone || "Pa gen telefòn"}</Text>
          <Text style={{ fontSize: 11, color: LUX.faint, marginTop: 1 }}>{c.address || "Pa gen adrès"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface CreditsFilterChipsProps {
  view: CreditsView;
  setView: (v: CreditsView) => void;
}

export function CreditsFilterChips({ view, setView }: CreditsFilterChipsProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16, paddingVertical: 4 }} style={{ marginHorizontal: -16, paddingHorizontal: 16 }}>
      {FILTER_CHIPS.map((chip) => {
        const active = view === (chip.id as any);
        const statusStyle =
          chip.id === "delinquent"
            ? { bg: LUX.redBg, border: LUX.redBd, text: LUX.redDeep }
            : chip.id === "current"
            ? { bg: LUX.surface, border: LUX.hairline2, text: LUX.ink }
            : chip.id === "paid"
            ? { bg: LUX.greenBg, border: LUX.greenBd, text: LUX.greenDeep }
            : { bg: LUX.surface2, border: LUX.hairline2, text: LUX.ink };
        return (
          <Pressable
            key={chip.id}
            onPress={() => setView(chip.id as any)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: active ? statusStyle.bg : "#fff",
              borderWidth: 1,
              borderColor: active ? statusStyle.border : LUX.hairline,
              alignItems: "center",
              justifyContent: "center",
              minWidth: 64,
            }}
          >
            <Text style={{ fontWeight: active ? "700" : "500", fontSize: 12, color: active ? statusStyle.text : LUX.muted }}>{chip.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------- Full list header (shared by phone + tablet master) ----------

export interface CreditsListHeaderProps {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  rangeLabel: string;
  analytics: AnalyticsState;
  ringTrace: { paidPercent: number; unpaidPercent: number };
  search: string;
  setSearch: (v: string) => void;
  query: string;
  customerSuggestions: any[];
  onSelectCustomer: (c: any) => void;
  canManageCustomer: boolean;
  onAddCustomer: () => void;
  view: CreditsView;
  setView: (v: CreditsView) => void;
  filteredCount: number;
  openCount: number;
}

export function CreditsListHeader(props: CreditsListHeaderProps) {
  const { range, setRange, rangeLabel, analytics, ringTrace, search, setSearch, query, customerSuggestions, onSelectCustomer, canManageCustomer, onAddCustomer, view, setView, filteredCount, openCount } = props;
  return (
    <View style={{ gap: 16, marginBottom: 16 }}>
      {/* Header summary - elegant colored accent */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: LUX.purpleDot }} />
          <View>
            <Text style={{ fontSize: 9, color: LUX.muted, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Portefeyo dèt</Text>
            <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "600", marginTop: 1 }}>{filteredCount} dèt • {openCount} ouvè</Text>
          </View>
        </View>
        <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: LUX.ink, letterSpacing: 0.2 }}>{rangeLabel}</Text>
        </View>
      </View>

      {/* Range selector - flat segmented */}
      <View style={{ flexDirection: "row", backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 12, padding: 4 }}>
        {RANGE_OPTIONS.map((option) => {
          const isSelected = range === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setRange(option.key)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: isSelected ? LUX.ink : "transparent", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontWeight: isSelected ? "700" : "500", fontSize: 12, color: isSelected ? "#fff" : LUX.muted }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Analytics - colorful metric trio + distribution */}
      <CreditsMetrics analytics={analytics} ringTrace={ringTrace} rangeLabel={rangeLabel} />

      {/* Search - more visible with depth and stronger placeholder */}
      <CreditsSearchBar search={search} setSearch={setSearch} />

      {query && customerSuggestions.length === 0 && canManageCustomer && (
        <Pressable onPress={onAddCustomer} style={{ backgroundColor: "#fff", borderRadius: 16, padding: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: LUX.hairline, borderStyle: "dashed" }}>
          <Text style={{ fontSize: 16, color: LUX.ink, fontWeight: "700" }}>＋</Text>
          <Text style={{ color: LUX.ink, fontWeight: "700", fontSize: 13 }}>New Customer</Text>
        </Pressable>
      )}

      <CustomerSuggestions suggestions={customerSuggestions} onSelect={onSelectCustomer} />

      {/* Filter chips - flat segmented control */}
      <CreditsFilterChips view={view} setView={setView} />

      {/* Section label for list - now debts, not customers */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: LUX.ink, letterSpacing: 0.2, textTransform: "uppercase" }}>Dèt</Text>
        <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>{filteredCount} rezilta</Text>
      </View>
    </View>
  );
}

// ---------- Debt card ----------

export interface DebtCardProps {
  debt: any;
  customer?: any;
  allPayments: any[];
  isTablet: boolean;
  onPress: () => void;
}

export function DebtCard({ debt: d, customer: cust, allPayments, isTablet, onPress }: DebtCardProps) {
  const initialAmount = Number(d.amount || 0);
  const paymentsForCard = allPayments.filter(p => p.debt_id === d.id || p.credit_id === d.id);
  const totalPaid = paymentsForCard.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = Math.max(0, initialAmount - totalPaid); // computed current due = initial - sum(partials), displayed so user knows how much to pay
  const isPaid = balance <= 0.01;
  const isOverdue = !isPaid && d.due_date && new Date(d.due_date) < new Date();
  const cardStatus = isPaid
    ? { dot: LUX.green, dotBg: LUX.greenBg, dotBd: LUX.greenBd, text: LUX.greenDeep, badgeText: LUX.greenDeep, label: "PAYE", border: LUX.greenBd, bar: LUX.green }
    : isOverdue
    ? { dot: LUX.red, dotBg: LUX.redBg, dotBd: LUX.redBd, text: LUX.redDeep, badgeText: LUX.redDeep, label: "AN RETA", border: "#ff002b", bar: LUX.red }
    : { dot: LUX.gold, dotBg: LUX.goldBg, dotBd: LUX.goldBd, text: LUX.ink, badgeText: LUX.goldDeep, label: "POKO RIVE", border: LUX.hairline, bar: LUX.gold };
  const pctPaid = initialAmount > 0 ? Math.min(100, Math.round((totalPaid / initialAmount) * 100)) : 0;
  const daysMeta = (() => {
    if (isPaid || !d.due_date) return null;
    const diff = Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000);
    if (diff < 0) return { text: `${Math.abs(diff)} jou reta`, color: LUX.redDeep };
    if (diff === 0) return { text: "Jodi a", color: LUX.goldDeep };
    return { text: `${diff} jou rete`, color: LUX.goldDeep };
  })();
  return (
    <Pressable onPress={onPress} style={{ flex: isTablet ? 1 : undefined, backgroundColor: "#fff", borderRadius: 20, marginBottom: 10, borderWidth: 1, borderColor: cardStatus.border, padding: 14, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {/* Left: who + status, like POS item */}
        <View style={{ flex: 1, paddingRight: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: LUX.ink, letterSpacing: -0.2 }} numberOfLines={1}>{cust?.name ?? "Kliyan enkoni"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: cardStatus.dotBg, borderWidth: 1, borderColor: cardStatus.dotBd, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cardStatus.dot }} />
              <Text style={{ fontSize: 10, fontWeight: "700", color: cardStatus.badgeText, letterSpacing: 0.3 }}>{cardStatus.label}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Text style={{ color: LUX.muted, fontSize: 11, fontWeight: "600" }}>{cust?.id_card_number || "—"}</Text>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: cardStatus.dot }} />
            <Text style={{ color: cardStatus.text, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>{daysMeta ? daysMeta.text : d.due_date ? `Echèans ${new Date(d.due_date).toLocaleDateString()}` : "San echèans"}</Text>
          </View>
          {cust?.phone ? <Text style={{ color: LUX.faint, fontSize: 11, marginTop: 2, fontWeight: "500" }} numberOfLines={1}>{cust.phone}</Text> : null}
          {/* Progress strip like POS sub-line */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: LUX.surface2, overflow: "hidden" }}>
              <View style={{ width: `${pctPaid}%` as any, height: 5, backgroundColor: cardStatus.bar }} />
            </View>
            <Text style={{ fontSize: 10, fontWeight: "700", color: cardStatus.text }}>{pctPaid}%</Text>
          </View>
        </View>

        {/* Right: balance, like POS price */}
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" }}>Rès</Text>
          <Text style={{ fontWeight: "900", color: cardStatus.text, fontSize: 16, letterSpacing: -0.4, textAlign: "right", ...monoStyle }}>{formatCurrency(balance)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11, color: LUX.ink, fontWeight: "700" }}>Detay</Text>
            <Text style={{ fontSize: 12, color: cardStatus.dot, fontWeight: "800" }}>›</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------- Empty state ----------

export interface CreditsEmptyStateProps {
  view: CreditsView;
}

export function CreditsEmptyState({ view }: CreditsEmptyStateProps) {
  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, padding: 24, alignItems: "center" }}>
      <Text style={{ color: LUX.faint, fontSize: 13, fontWeight: "500" }}>{view === "delinquent" ? "Pa gen dèt anreta." : view === "current" ? "Pa gen dèt Pako Rive." : view === "paid" ? "Pa gen dèt peye." : "Pa gen dèt."}</Text>
    </View>
  );
}

// ---------- Debt detail (customer header + per-debt block) ----------

export interface DebtCustomerHeaderProps {
  customer: any;
  onClose: () => void;
}

export function DebtCustomerHeader({ customer, onClose }: DebtCustomerHeaderProps) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontWeight: "800", fontSize: 16, color: LUX.ink }} numberOfLines={1}>{customer?.name ?? "—"}</Text>
        <Text style={{ fontSize: 11, color: LUX.body, fontWeight: "600", marginTop: 2 }} numberOfLines={1}>{customer?.id_card_number || "—"} • {customer?.phone || "Pa gen telefòn"}</Text>
        <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "500", marginTop: 1 }} numberOfLines={1}>{customer?.address || "Pa gen adrès"}</Text>
        <Text style={{ fontSize: 11, color: LUX.muted, marginTop: 1 }}>Limit {customer?.credit_limit == null ? "—" : `${customer.credit_limit} HTG`} • Dèt total {customer ? formatCurrency(Number(customer.total_debt || 0)) : "—"}</Text>
      </View>
      <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: LUX.surface2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: LUX.body, fontWeight: "700" }}>✕</Text></Pressable>
    </View>
  );
}

export interface DebtDetailBlockProps {
  debt: any;
  allPayments: any[];
  allSaleItems: any[];
  historyExpanded: boolean;
  articlesExpanded: boolean;
  onToggleHistory: () => void;
  onToggleArticles: () => void;
}

export function DebtDetailBlock({ debt: d, allPayments, allSaleItems, historyExpanded, articlesExpanded, onToggleHistory, onToggleArticles }: DebtDetailBlockProps) {
  const payments = allPayments.filter(p => p.debt_id === d.id || p.credit_id === d.id).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const initialAmount = Number(d.amount || 0);
  const paidTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paidDisplay = paidTotal; // sum of all partial payments
  const currentDue = Math.max(0, initialAmount - paidDisplay); // computed current due, not necessarily stored, displayed so user knows how much to pay
  const isPaid = currentDue <= 0.01;
  const isOverdue = !isPaid && d.due_date && new Date(d.due_date) < new Date();
  const saleItems = allSaleItems.filter(it => it.sale_id === d.sale_id);
  return (
    <View key={d.id} style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: isPaid ? LUX.greenBd : isOverdue ? LUX.redBd : LUX.hairline, borderRadius: 16, padding: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ backgroundColor: isPaid ? LUX.greenBg : isOverdue ? LUX.redBg : LUX.goldBg, borderWidth: 1, borderColor: isPaid ? LUX.greenBd : isOverdue ? LUX.redBd : LUX.goldSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", color: isPaid ? LUX.greenDeep : isOverdue ? LUX.redDeep : LUX.goldDeep }}>{isPaid ? "Paye Deja" : isOverdue ? "Anreta" : "Pako Rive"}</Text>
        </View>
        <Text style={{ fontSize: 10, color: LUX.faint, fontWeight: "500" }}>{d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}{d.due_date ? ` • Echèans ${new Date(d.due_date).toLocaleDateString()}` : ""}</Text>
      </View>
      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: LUX.surface, borderRadius: 16, padding: 10, alignItems: "center", borderWidth: 1, borderColor: LUX.surface2 }}>
          <Text style={{ fontSize: 10, color: LUX.muted, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" }}>Montan inisyal</Text>
          <Text style={{ fontSize: 13, color: LUX.ink, fontWeight: "800", marginTop: 4 }}>{formatCurrency(initialAmount)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: currentDue <= 0.01 ? LUX.greenBg : LUX.goldBg, borderRadius: 16, padding: 10, alignItems: "center", borderWidth: 1, borderColor: currentDue <= 0.01 ? LUX.greenBd : LUX.goldSoft }}>
          <Text style={{ fontSize: 10, color: currentDue <= 0.01 ? LUX.greenDeep : LUX.goldDeep, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" }}>Rès aktyèl</Text>
          <Text style={{ fontSize: 13, color: currentDue <= 0.01 ? LUX.greenDeep : LUX.goldDeep, fontWeight: "800", marginTop: 4 }}>{formatCurrency(currentDue)}</Text>
        </View>
      </View>
      <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: LUX.surface, borderRadius: 16, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: LUX.surface2 }}>
          <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Peye</Text>
          <Text style={{ fontSize: 12, color: LUX.greenDeep, fontWeight: "800" }}>{formatCurrency(paidDisplay)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: LUX.surface, borderRadius: 16, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: LUX.surface2 }}>
          <Text style={{ fontSize: 11, color: LUX.muted, fontWeight: "600" }}>Fwa peye</Text>
          <Text style={{ fontSize: 12, color: LUX.ink, fontWeight: "800" }}>{payments.length}</Text>
        </View>
      </View>
      <Pressable onPress={onToggleHistory} style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: LUX.body }}>Istwa peman {payments.length > 0 ? `• ${payments.length}` : ""}</Text>
        <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "700" }}>{historyExpanded ? "▾ Kache" : "▸ Wè"}</Text>
      </Pressable>
      {historyExpanded && (
        <View style={{ marginTop: 8, gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.surface2, borderRadius: 16, padding: 8 }}>
          {payments.length === 0 ? (
            <Text style={{ fontSize: 11, color: LUX.faint, textAlign: "center", padding: 8 }}>Poko gen peman pasyèl.</Text>
          ) : (
            payments.map(p => (
              <View key={p.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderColor: LUX.surface }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LUX.green }} />
                  <Text style={{ fontSize: 11, color: LUX.body, fontWeight: "500" }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: "800", color: LUX.ink }}>{formatCurrency(Number(p.amount || 0))}</Text>
              </View>
            ))
          )}
        </View>
      )}
      <Pressable onPress={onToggleArticles} style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: LUX.surface, borderWidth: 1, borderColor: LUX.hairline, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: LUX.body }}>Atik yo {saleItems.length > 0 ? `• ${saleItems.length} atik` : ""}</Text>
        <Text style={{ fontSize: 12, color: LUX.body, fontWeight: "700" }}>{articlesExpanded ? "▾ Kache" : "▸ Wè"}</Text>
      </Pressable>
      {articlesExpanded && (
        <View style={{ marginTop: 8, gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: LUX.surface2, borderRadius: 16, padding: 8 }}>
          {saleItems.length === 0 ? (
            <Text style={{ fontSize: 11, color: LUX.faint, textAlign: "center", padding: 8 }}>Poko gen detay atik pou vant sa — gade sale_items.</Text>
          ) : (
            saleItems.map(it => (
              <View key={it.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderColor: LUX.surface }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: LUX.ink }} numberOfLines={1}>{it.product_name ?? it.product_id}</Text>
                  <Text style={{ fontSize: 11, color: LUX.muted }}>{it.quantity} × {formatCurrency(Number(it.unit_price || 0))}</Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: "800", color: LUX.ink }}>{formatCurrency(Number(it.line_total ?? it.quantity * it.unit_price))}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}
