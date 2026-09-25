import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../../theme";
import type { RangeKey, BestItem, ProfitStats } from "./types";
import { RANGES } from "./types";
import { fmtG, fmt, monoStyle } from "../../format";

export const KR_RANGE: Record<string, string> = {
  today: "Jodi a",
  "7d": "7 jou",
  "28d": "28 jou",
  "6m": "6 mwa",
  "1y": "1 an",
  lifetime: "Vitalite",
};

export const ROLE_KR: Record<string, string> = {
  owner: "Patwon",
  admin: "Admin",
  manager: "Manadjè",
  cashier: "Kesye",
};

export type AnalyticsTabProps = {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  todayTotal: number;
  todayCount: number;
  growthPct: number;
  todayCash: number;
  todayCredit: number;
  todayMonCash: number;
  todayNatCash: number;
  todayCashPct: number;
  todayCreditPct: number;
  todayMonCashPct: number;
  todayNatCashPct: number;
  avgBasket: number;
  profitStats: ProfitStats;
  filteredSalesCount: number;
  lowStockCount: number;
  lowStockValue: number;
  dynamicTrend: import("./types").TrendPoint[];
  dynamicBestItems: BestItem[];
  dbSalesLength: number;
  role?: string;
  currentUser?: any;
};

export type AnalyticsFocus = {
  tone: "warn" | "good";
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
};

export type AnalyticsPayment = {
  label: string;
  value: number;
  pct: number;
  c: string;
};

export type TopSeriesEntry = {
  name: string;
  c: string;
  w: number;
};

export function getRangeLabel(range: RangeKey): string {
  return KR_RANGE[range] ?? range;
}

export function getRangeShort(range: RangeKey): string {
  return (
    ({ today: "08–20h", "7d": "7 jou", "28d": "4 semèn", "6m": "6 mwa", "1y": "12 mwa", lifetime: "Tout tan" } as Record<
      string,
      string
    >)[range] ?? range
  );
}

export function getFocus(args: {
  lowStockCount: number;
  lowStockValue: number;
  growthPct: number;
  profitStats: ProfitStats;
}): AnalyticsFocus {
  const { lowStockCount, lowStockValue, growthPct, profitStats } = args;
  if (lowStockCount > 0)
    return { tone: "warn", icon: "warning-outline", title: `${lowStockCount} pwodui nan dezespwa`, body: `Reyaprovizyonne kounye a (${fmtG(lowStockValue)}) pou pa pèdi vant.` } as const;
  if (growthPct < 0)
    return { tone: "warn", icon: "trending-down", title: "Revni ap bese", body: `Bese ${Math.abs(growthPct)}%. Revize pri oswa lanse yon pwomosyon pou ranvèse tandans la.` } as const;
  if (profitStats.margin < 10)
    return { tone: "warn", icon: "alert-circle", title: "Marj pwofi ba", body: `Marj ${profitStats.margin.toFixed(1)}%. Kontwole depans ak pri revand pou leve pwofi.` } as const;
  return { tone: "good", icon: "checkmark-circle", title: "Bon rit travay", body: `Kontinye konsa — magazen an ap monte. Nivel pèfòmans sa rivalize gwo siksè yo.` } as const;
}

export function getPayments(args: {
  todayCash: number;
  todayCredit: number;
  todayMonCash: number;
  todayNatCash: number;
  todayCashPct: number;
  todayCreditPct: number;
  todayMonCashPct: number;
  todayNatCashPct: number;
}): AnalyticsPayment[] {
  return [
    { label: "Kach", value: args.todayCash, pct: args.todayCashPct, c: palette.success },
    { label: "Kredi", value: args.todayCredit, pct: args.todayCreditPct, c: palette.violet },
    { label: "MonCash", value: args.todayMonCash, pct: args.todayMonCashPct, c: palette.dangerDot },
    { label: "NatCash", value: args.todayNatCash, pct: args.todayNatCashPct, c: palette.blue },
  ];
}

export function getTopSeries(dynamicBestItems: BestItem[]): TopSeriesEntry[] {
  const colors = [palette.accentGold, palette.blue, palette.violet, palette.success, palette.dangerDot];
  const items = [...dynamicBestItems].sort((a, b) => b.rank - a.rank).reverse().slice(0, 5);
  const total = items.reduce((s, it) => s + it.amount, 0);
  return total > 0 ? items.map((it, i) => ({ name: it.name, c: colors[i % colors.length], w: it.amount / total })) : [];
}

export function getRankStyle(rank: number): { bg: string; tint: string } {
  if (rank === 1) return { bg: palette.warningBg, tint: palette.warning };
  if (rank === 2) return { bg: palette.surfaceGrouped, tint: palette.muted2 };
  if (rank === 3) return { bg: palette.dangerBg, tint: palette.danger };
  return { bg: palette.surfaceGrouped, tint: palette.muted2 };
}

export function Greeting({ role = "seller", currentUser }: { role?: string; currentUser?: any }) {
  const name = currentUser?.name?.split(" ")[0] ?? "";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
      <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: palette.accentGold }}>
        <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontWeight: "700", fontSize: 15 }}>{(name || role).slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>Bonjou{name ? `, ${name}` : ""}</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.muted2, marginTop: 1 }}>{ROLE_KR[role] ?? role} • Panèl Desizyon</Text>
      </View>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2 }}>{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</Text>
    </View>
  );
}

export function RangePills({ range, setRange }: { range: RangeKey; setRange: (r: RangeKey) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 6, marginTop: 8 }}>
      {RANGES.map(r => {
        const active = range === r.key;
        return (
          <Pressable key={r.key} onPress={() => setRange(r.key)} style={{ paddingVertical: 6, paddingHorizontal: 2, borderBottomWidth: active ? 2 : 0, borderBottomColor: active ? palette.accentGold : "transparent" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, fontWeight: active ? "700" : "500", color: active ? palette.ink : palette.muted2 }}>{KR_RANGE[r.key] ?? r.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function HeroCard({
  todayTotal,
  todayCount,
  growthPct,
  avgBasket,
  dbSalesLength,
}: {
  todayTotal: number;
  todayCount: number;
  growthPct: number;
  avgBasket: number;
  dbSalesLength: number;
}) {
  return (
    <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 18, ...shadow.card, borderWidth: 0.5, borderColor: palette.hairline, borderTopWidth: 3, borderTopColor: palette.accentGold }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)" }}>
          <Ionicons name="cash-outline" size={19} color={palette.accentGold} />
        </View>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>Revni Jodi a</Text>
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 36, color: palette.ink, letterSpacing: -0.8, marginTop: 6, textAlign: "right", ...monoStyle }}>{fmt(todayTotal)} <Text style={{ fontSize: 15, color: palette.muted2 }}>G</Text></Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
        <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: growthPct >= 0 ? palette.successBg : palette.dangerBg }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, fontWeight: "700", color: growthPct >= 0 ? palette.success : palette.danger }}>{growthPct >= 0 ? "↗" : "↘"} {growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}</Text>
        </View>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.muted2 }}>{todayCount} antre • {dbSalesLength ? "live" : "demo"}</Text>
      </View>

      <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 16 }} />

      <View style={{ flexDirection: "row", backgroundColor: palette.surface2, borderRadius: radius.md, padding: 12, marginTop: 12 }}>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>Mwayèn Dekòk</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15, color: palette.ink, marginTop: 2 }}>{fmtG(avgBasket)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: palette.separator }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>Bòdwo</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15, color: palette.ink, marginTop: 2 }}>{todayCount}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: palette.separator }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>Kwasans</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15, color: growthPct >= 0 ? palette.success : palette.danger, marginTop: 2 }}>{growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}</Text>
        </View>
      </View>
    </View>
  );
}

export function FocusBanner({ focus }: { focus: AnalyticsFocus }) {
  return (
    <View style={{ marginTop: 14, backgroundColor: focus.tone === "good" ? palette.successBg : palette.warningBg, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: focus.tone === "good" ? palette.successBd : palette.warningBd, flexDirection: "row", alignItems: "flex-start", gap: 10, ...shadow.soft }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: focus.tone === "good" ? palette.successBg : palette.warningBg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={focus.icon} size={19} color={focus.tone === "good" ? palette.success : palette.accentGold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, color: focus.tone === "good" ? palette.success : palette.warning }}>{focus.title}</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: focus.tone === "good" ? palette.success : palette.warning, marginTop: 2 }}>{focus.body}</Text>
      </View>
    </View>
  );
}

export function ProfitCard({ profitStats, rangeLabel }: { profitStats: ProfitStats; rangeLabel: string }) {
  return (
    <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 16, ...shadow.card, borderWidth: 0.5, borderColor: palette.hairline, borderTopWidth: 3, borderTopColor: profitStats.profit >= 0 ? palette.success : palette.dangerDot }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: profitStats.profit >= 0 ? palette.successBg : palette.dangerBg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={profitStats.profit >= 0 ? "checkmark-circle-outline" : "warning-outline"} size={18} color={profitStats.profit >= 0 ? palette.success : palette.danger} />
          </View>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>Pwofi • {rangeLabel}</Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: profitStats.margin >= 20 ? palette.successBg : profitStats.margin >= 10 ? palette.warningBg : palette.dangerBg }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, fontWeight: "700", color: profitStats.margin >= 20 ? palette.success : profitStats.margin >= 10 ? palette.warning : palette.danger }}>{profitStats.margin.toFixed(1)}% marj</Text>
        </View>
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 30, color: profitStats.profit >= 0 ? palette.ink : palette.danger, letterSpacing: -0.8, marginTop: 8 }}>{fmtG(profitStats.profit)}</Text>
      <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 12 }} />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.3 }}>Revni</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 3 }}>{fmtG(profitStats.revenue)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: palette.separator }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.3 }}>Depans</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 3 }}>{fmtG(profitStats.cost)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: palette.separator }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.3 }}>Marj</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 3 }}>{profitStats.margin.toFixed(1)}%</Text>
        </View>
      </View>
    </View>
  );
}

export function PaymentMixCard({
  payments,
  mixTotal,
  rangeLabel,
}: {
  payments: AnalyticsPayment[];
  mixTotal: number;
  rangeLabel: string;
}) {
  return (
    <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 16, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 }}>Peye pa Mwayen</Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 2 }}>{rangeLabel}</Text>
      <View style={{ gap: 8, marginTop: 10 }}>
        {payments.map(p => {
          const pct = Math.round((p.value / mixTotal) * 100);
          return (
            <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.c }} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.muted2, width: 70 }}>{p.label}</Text>
              <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.surfaceGrouped }}>
                <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: p.c }} />
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, color: palette.ink, width: 84, textAlign: "right" }}>{p.value ? fmtG(p.value) : "—"}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
