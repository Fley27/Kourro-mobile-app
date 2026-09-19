import React from "react";
import { View, Text } from "react-native";
import { BarChart } from "react-native-gifted-charts";
import { palette, radius, shadow } from "../../theme";
import { useResponsive } from "../../responsive";
import { fmt } from "../../format";
import type { AnalyticsTabProps } from "./AnalyticsShared";
import {
  Greeting,
  RangePills,
  HeroCard,
  FocusBanner,
  ProfitCard,
  PaymentMixCard,
  getRangeLabel,
  getRangeShort,
  getFocus,
  getPayments,
  getTopSeries,
  getRankStyle,
} from "./AnalyticsShared";

export default function AnalyticsPhone({
  range, setRange, todayTotal, todayCount, growthPct,
  todayCash, todayCredit, todayMonCash, todayNatCash,
  todayCashPct, todayCreditPct, todayMonCashPct, todayNatCashPct,
  avgBasket, profitStats, filteredSalesCount,
  lowStockCount, lowStockValue,
  dynamicTrend, dynamicBestItems, dbSalesLength,
  role = "seller", currentUser,
}: AnalyticsTabProps) {
  const { width } = useResponsive();

  const rangeLabel = getRangeLabel(range);
  const focus = getFocus({ lowStockCount, lowStockValue, growthPct, profitStats });
  const payments = getPayments({
    todayCash, todayCredit, todayMonCash, todayNatCash,
    todayCashPct, todayCreditPct, todayMonCashPct, todayNatCashPct,
  });
  const mixTotal = todayCash + todayCredit + todayMonCash + todayNatCash;
  const rangeShort = getRangeShort(range);
  const topSeries = getTopSeries(dynamicBestItems);

  return (
    <>
      <Greeting role={role} currentUser={currentUser} />

      <RangePills range={range} setRange={setRange} />

      <HeroCard
        todayTotal={todayTotal}
        todayCount={todayCount}
        growthPct={growthPct}
        avgBasket={avgBasket}
        dbSalesLength={dbSalesLength}
      />

      <FocusBanner focus={focus} />

      {/* Payment breakdown — stacked */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 16, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
        <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>Repatisyon Peman</Text>
        <View style={{ gap: 8, marginTop: 10 }}>
          {payments.map(p => (
            <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.c }} />
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 12, color: palette.muted2, width: 78 }}>{p.label}</Text>
              <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.surfaceGrouped }}>
                <View style={{ width: `${p.pct}%`, height: 5, borderRadius: 3, backgroundColor: p.c }} />
              </View>
              <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13, color: p.c, minWidth: 14, textAlign: "right" }}>{p.pct}%</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
          <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: palette.muted2 }}>{filteredSalesCount} antre</Text>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 12, color: palette.ink }}>{fmt(mixTotal)} HTG</Text>
        </View>
      </View>

      <ProfitCard profitStats={profitStats} rangeLabel={rangeLabel} />

      {/* Secondary stats — horizontal pair */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <View style={{ flex: 1, backgroundColor: palette.blueBg, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.blueBd, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.blue }} />
            <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 9, color: palette.blue, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Tranzaksyon</Text>
          </View>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 24, color: palette.blue, marginTop: 6 }}>{filteredSalesCount}</Text>
          <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: palette.blue, marginTop: 2 }}>{rangeLabel} • live</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: lowStockCount ? palette.warningBg : palette.successBg, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: lowStockCount ? palette.warningBd : palette.successBd, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: lowStockCount ? palette.warningDot : palette.success }} />
            <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 9, color: lowStockCount ? palette.warning : palette.success, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Dezespwa</Text>
          </View>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 24, color: lowStockCount ? palette.warning : palette.success, marginTop: 6 }}>{lowStockCount}</Text>
          <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: lowStockCount ? palette.warning : palette.success, marginTop: 2 }}>{fmt(lowStockValue)} HTG</Text>
        </View>
      </View>

      {/* Trend — Multi KPI Series (best sellers of the period) */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 16, ...shadow.soft, borderWidth: 0.5, borderColor: palette.hairline }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.ink2 }} />
            <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13, color: palette.ink, letterSpacing: -0.2 }}>Tandans</Text>
          </View>
          <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.surface2 }}>
            <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "600" }}>{rangeShort} • Top Vant</Text>
          </View>
        </View>
        <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2, marginTop: 2 }}>Seri plizyè KPI — kontribisyon chak pwodui nan revni a.</Text>

        <View style={{ alignItems: "center", marginTop: 14 }}>
          <BarChart
            stackData={dynamicBestItems.length
              ? dynamicTrend.map(t => ({
                  label: t.d,
                  stacks: topSeries.map(s => ({ value: Math.max(0, Math.round(t.v * s.w)), color: s.c })),
                }))
              : [{ label: "", stacks: [{ value: 1, color: palette.surfaceGrouped }] }]}
            width={Math.max(200, Math.min(400, width - 104))}
            height={150}
            barWidth={22}
            spacing={14}
            frontColor={palette.ink}
            hideRules
            noOfSections={3}
            yAxisThickness={0}
            xAxisThickness={0}
            isAnimated
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {topSeries.map(s => (
            <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: s.c }} />
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2 }} numberOfLines={1}>{s.name}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Top products — single column */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, overflow: "hidden", borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
        <View style={{ padding: 14, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13 }}>Top Pwodui</Text>
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.surfaceGrouped }}>
            <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, fontWeight: "600", color: palette.muted2 }}>TOP 5</Text>
          </View>
        </View>
        <View style={{ height: 0.5, backgroundColor: palette.separator }} />
        {dynamicBestItems.map((it, idx, arr) => {
          const rankStyle = getRankStyle(it.rank);
          return (
            <View key={it.sku} style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: idx === arr.length - 1 ? 0 : 0.5, borderBottomColor: palette.separatorSoft }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: rankStyle.bg, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 10, fontWeight: "700", color: rankStyle.tint }}>#{it.rank}</Text>
              </View>
              <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 14 }}>{it.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 12, color: palette.ink }} numberOfLines={1}>{it.name}</Text>
                <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2, marginTop: 1 }}>{it.sku} • {it.qty} vann</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 12, color: palette.ink }}>{fmt(it.amount)} HTG</Text>
                <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2 }}>{(it.amount / it.qty).toFixed(0)} /u</Text>
              </View>
            </View>
          );
        })}
      </View>

      <PaymentMixCard payments={payments} mixTotal={mixTotal} rangeLabel={rangeLabel} />
    </>
  );
}
