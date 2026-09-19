import React from "react";
import { View, Text } from "react-native";
import { BarChart } from "react-native-gifted-charts";
import { palette, radius, shadow } from "../../theme";
import { useResponsive } from "../../responsive";
import { fmt, monoStyle } from "../../format";
import type { AnalyticsTabProps } from "./AnalyticsShared";
import {
  RangePills,
  FocusBanner,
  ROLE_KR,
  getRangeLabel,
  getRangeShort,
  getFocus,
  getPayments,
  getTopSeries,
  getRankStyle,
} from "./AnalyticsShared";

/* Tablet-only editorial variants mirroring web Dashboard (Dashboard.tsx + styles.css).
   Shared helpers (getFocus/getPayments/getTopSeries/getRankStyle, RangePills,
   FocusBanner) are reused; hero/KPI/cards below are tablet-local. No shell import. */

function CardHeader({ title, subtitle, pill }: { title: string; subtitle: string; pill: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: palette.hairline,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13, color: palette.ink, letterSpacing: -0.2 }}>
          {title}
        </Text>
        <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: palette.muted, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <View
        style={{
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: radius.pill,
          backgroundColor: palette.surfaceGrouped,
          borderWidth: 0.5,
          borderColor: palette.hairline,
        }}
      >
        <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: "#3A3A3C", fontWeight: "600" }}>{pill}</Text>
      </View>
    </View>
  );
}

function KpiCard({
  accent,
  label,
  valueText,
  unit,
  sub,
  valueColor,
}: {
  accent: string;
  label: string;
  valueText: string | number;
  unit?: string;
  sub: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.surface,
        borderRadius: 18,
        padding: 16,
        borderWidth: 0.5,
        borderColor: palette.hairline,
        overflow: "hidden",
        position: "relative",
        ...shadow.soft,
      }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2.5, backgroundColor: accent }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
        <Text
          style={{
            fontFamily: "Roboto_400Regular",
            fontSize: 10,
            color: palette.muted2,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 0.9,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: "Quicksand_700Bold",
          fontWeight: "700",
          fontSize: 22,
          color: valueColor ?? palette.ink,
          letterSpacing: -0.8,
          marginTop: 8,
          lineHeight: 24,
          ...monoStyle,
        }}
      >
        {valueText}
        {unit ? <Text style={{ fontSize: 11, fontWeight: "700", color: palette.muted2 }}> {unit}</Text> : null}
      </Text>
      <View style={{ marginTop: 4 }}>{typeof sub === "string" ? (
        <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 12, color: palette.muted }}>{sub}</Text>
      ) : (
        sub
      )}</View>
    </View>
  );
}

export default function AnalyticsTablet({
  range, setRange, todayTotal, todayCount, growthPct,
  todayCash, todayCredit, todayMonCash, todayNatCash,
  todayCashPct, todayCreditPct, todayMonCashPct, todayNatCashPct,
  avgBasket, profitStats, filteredSalesCount,
  lowStockCount, lowStockValue,
  dynamicTrend, dynamicBestItems, dbSalesLength,
  role = "seller",
}: AnalyticsTabProps) {
  const { width, padH } = useResponsive();

  const rangeLabel = getRangeLabel(range);
  const focus = getFocus({ lowStockCount, lowStockValue, growthPct, profitStats });
  const payments = getPayments({
    todayCash, todayCredit, todayMonCash, todayNatCash,
    todayCashPct, todayCreditPct, todayMonCashPct, todayNatCashPct,
  });
  const mixTotal = todayCash + todayCredit + todayMonCash + todayNatCash;
  const rangeShort = getRangeShort(range);
  const topSeries = getTopSeries(dynamicBestItems);

  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const roleLabel = (ROLE_KR[role] ?? role).toUpperCase();
  const cashShare = todayTotal > 0 ? Math.min(100, Math.round((todayCash / todayTotal) * 100)) : 0;
  // Half-width trend card: content minus padding & gap, left column share, minus card padding.
  const trendWidth = Math.max(260, Math.min(480, Math.floor((width - padH * 2 - 12) * (1.65 / 2.65)) - 32));

  return (
    <>
      <RangePills range={range} setRange={setRange} />

      <FocusBanner focus={focus} />

      {/* HERO — dark editorial (web .hero): ink2 bg, gold glow, copy + 3 glass metrics */}
      <View
        style={{
          marginTop: 14,
          backgroundColor: palette.ink2,
          borderRadius: 24,
          padding: 22,
          overflow: "hidden",
          borderWidth: 0.5,
          borderColor: "rgba(255,255,255,0.06)",
          position: "relative",
          ...shadow.elevated,
        }}
      >
        {/* gold-tinted glow accents */}
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: -120, left: -80, width: 320, height: 200, borderRadius: 160, backgroundColor: "rgba(200,162,74,0.16)" }}
        />
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: -100, right: -60, width: 280, height: 190, borderRadius: 140, backgroundColor: "rgba(255,255,255,0.06)" }}
        />

        <View style={{ flexDirection: "row", gap: 20 }}>
          {/* hero copy */}
          <View style={{ flex: 1.42, position: "relative" }}>
            <View
              style={{
                alignSelf: "flex-start",
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: "rgba(255,255,255,0.07)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Text
                style={{
                  fontFamily: "Quicksand_700Bold",
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.92)",
                }}
                numberOfLines={2}
              >
                ● LIVE • {dateStr} • {roleLabel} • PANÈL DESIZYON
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "Quicksand_700Bold",
                fontWeight: "700",
                fontSize: 30,
                color: "#FFFFFF",
                letterSpacing: -1.2,
                lineHeight: 31,
                marginTop: 14,
              }}
            >
              Bati yon{" "}
              <Text style={{ fontFamily: "Quicksand_300Light", fontStyle: "italic", fontWeight: "300", color: palette.accentGold }}>
                biznis
              </Text>
              {"\n"}ki ap siviv ou.
            </Text>
            <Text
              style={{
                fontFamily: "Roboto_400Regular",
                fontSize: 13,
                color: "rgba(255,255,255,0.60)",
                lineHeight: 20,
                marginTop: 10,
              }}
            >
              Command center pou pwopriyetè. Tout vant an dirèk, pwofi brit, maj, ak stòk fèb — san rafrechi. Offline-first, senkronize ak CRDT.
            </Text>
          </View>

          {/* hero glass metrics */}
          <View style={{ flex: 0.98, gap: 10, position: "relative" }}>
            <View
              style={{
                padding: 14,
                paddingBottom: 12,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.06)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text
                style={{
                  fontFamily: "Roboto_400Regular",
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.54)",
                }}
              >
                Revni — {rangeLabel}
              </Text>
              <Text
                style={{
                  fontFamily: "Quicksand_700Bold",
                  fontWeight: "700",
                  fontSize: 22,
                  letterSpacing: -0.8,
                  color: "#FFFFFF",
                  marginTop: 6,
                  ...monoStyle,
                }}
              >
                {fmt(todayTotal)} HTG
              </Text>
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: "rgba(255,255,255,0.48)", marginTop: 2 }}>
                {todayCount} tranzaksyon • Kach {fmt(todayCash)} • Kredi {fmt(todayCredit)} • {dbSalesLength ? "live" : "demo"}
              </Text>
              <View style={{ marginTop: 8, height: 4, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999, overflow: "hidden" }}>
                <View style={{ width: `${cashShare}%`, height: 4, backgroundColor: "#30D158" }} />
              </View>
            </View>

            <View
              style={{
                padding: 14,
                paddingBottom: 12,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.06)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text
                style={{
                  fontFamily: "Roboto_400Regular",
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.54)",
                }}
              >
                Maj brit • Pwofi
              </Text>
              <Text
                style={{
                  fontFamily: "Quicksand_700Bold",
                  fontWeight: "700",
                  fontSize: 22,
                  letterSpacing: -0.8,
                  color: "#efe7d2",
                  marginTop: 6,
                  ...monoStyle,
                }}
              >
                {fmt(profitStats.profit)} HTG{" "}
                <Text style={{ fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.58)" }}>
                  • {profitStats.margin.toFixed(1)}%
                </Text>
              </Text>
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: "rgba(255,255,255,0.48)", marginTop: 2 }}>
                Revni {fmt(profitStats.revenue)} • Kout {fmt(profitStats.cost)}
              </Text>
            </View>

            <View
              style={{
                padding: 14,
                paddingBottom: 12,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.06)",
                borderWidth: 0.5,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text
                style={{
                  fontFamily: "Roboto_400Regular",
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.54)",
                }}
              >
                Stòk fèb & Valè
              </Text>
              <Text
                style={{
                  fontFamily: "Quicksand_700Bold",
                  fontWeight: "700",
                  fontSize: 22,
                  letterSpacing: -0.8,
                  color: "#FFFFFF",
                  marginTop: 6,
                  ...monoStyle,
                }}
              >
                {lowStockCount} atik{" "}
                <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.68)" }}>{fmt(lowStockValue)} HTG</Text>
              </Text>
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: "rgba(255,255,255,0.48)", marginTop: 2 }}>
                {lowStockCount > 0 ? `${lowStockCount} pwodui • Reyaprovizyonne` : "Okenn alèt kritik"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* KPI 4-grid (web .kpi-grid): 2.5px left accent bars */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <KpiCard
          accent="#30D158"
          label="Vant Jodi a"
          valueText={fmt(todayTotal)}
          unit="HTG"
          sub={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  borderRadius: radius.pill,
                  backgroundColor: growthPct >= 0 ? palette.successBg : palette.dangerBg,
                  borderWidth: 0.5,
                  borderColor: growthPct >= 0 ? palette.successBd : palette.dangerBd,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Quicksand_700Bold",
                    fontSize: 11,
                    fontWeight: "700",
                    color: growthPct >= 0 ? palette.success : palette.danger,
                  }}
                >
                  {growthPct >= 0 ? "↗" : "↘"} {growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}
                </Text>
              </View>
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 12, color: palette.muted }}>
                vs yè • {todayCount} tikè
              </Text>
            </View>
          }
        />
        <KpiCard
          accent="#0A84FF"
          label="Panyen Mwayèn"
          valueText={fmt(avgBasket)}
          unit="HTG"
          sub={`Maj ${profitStats.margin.toFixed(1)}% • ${filteredSalesCount} vant total`}
        />
        <KpiCard
          accent="#AF52DE"
          label="Tranzaksyon"
          valueText={filteredSalesCount}
          sub={`Kredi ${fmt(todayCredit)} HTG • ${todayCreditPct}% sou kredi`}
        />
        <KpiCard
          accent="#FF9F0A"
          label="Stòk Fèb"
          valueText={lowStockCount}
          valueColor={lowStockCount ? palette.danger : palette.ink}
          sub={`Valè ${fmt(lowStockValue)} HTG • ${lowStockCount ? "Achte prese" : "Stab"}`}
        />
      </View>

      {/* Insight row (web .insight-grid 1.65fr/1fr): trend + payment breakdown */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12, alignItems: "flex-start" }}>
        <View
          style={{
            flex: 1.65,
            backgroundColor: palette.surface,
            borderRadius: radius.xl,
            borderWidth: 0.5,
            borderColor: palette.hairline,
            overflow: "hidden",
            ...shadow.soft,
          }}
        >
          <CardHeader title="Tandans" subtitle="Seri plizyè KPI — kontribisyon chak pwodui nan revni a." pill={`${rangeShort} • Top Vant`} />
          <View style={{ padding: 16 }}>
            <View style={{ alignItems: "center" }}>
              <BarChart
                stackData={dynamicBestItems.length
                  ? dynamicTrend.map(t => ({
                      label: t.d,
                      stacks: topSeries.map(s => ({ value: Math.max(0, Math.round(t.v * s.w)), color: s.c })),
                    }))
                  : [{ label: "", stacks: [{ value: 1, color: palette.surfaceGrouped }] }]}
                width={trendWidth}
                height={190}
                barWidth={22}
                spacing={12}
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
                  <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View
          style={{
            flex: 1,
            backgroundColor: palette.surface,
            borderRadius: radius.xl,
            borderWidth: 0.5,
            borderColor: palette.hairline,
            overflow: "hidden",
            ...shadow.soft,
          }}
        >
          <CardHeader title="Repatisyon Peman" subtitle="Jodi a • 4 metòd • Kach / Kredi / MonCash / NatCash" pill={`${fmt(mixTotal)} HTG`} />
          <View style={{ padding: 16 }}>
            <View style={{ gap: 8 }}>
              {payments.map(p => (
                <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.c }} />
                  <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 12, color: palette.muted2, width: 62 }}>{p.label}</Text>
                  <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.surfaceGrouped }}>
                    <View style={{ width: `${p.pct}%`, height: 5, borderRadius: 3, backgroundColor: p.c }} />
                  </View>
                  <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13, color: p.c, minWidth: 14, textAlign: "right" }}>
                    {p.pct}%
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
              <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 11, color: palette.muted2 }}>{filteredSalesCount} antre</Text>
              <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 12, color: palette.ink }}>{fmt(mixTotal)} HTG</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Split row (web .split): top-products ledger + payment mix */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12, alignItems: "flex-start" }}>
        <View
          style={{
            flex: 1.15,
            backgroundColor: palette.surface,
            borderRadius: radius.xl,
            overflow: "hidden",
            borderWidth: 0.5,
            borderColor: palette.hairline,
            ...shadow.soft,
          }}
        >
          <CardHeader title="Top Pwodui" subtitle="Atik ki pi pèfòme • pa kantite & revni" pill="TOP 5" />
          <View>
            {dynamicBestItems.map((it, idx) => {
              const rankStyle = getRankStyle(it.rank);
              return (
                <View
                  key={it.sku}
                  style={{
                    padding: 12,
                    paddingHorizontal: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    borderTopWidth: idx === 0 ? 0 : 0.5,
                    borderTopColor: palette.separatorSoft,
                  }}
                >
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      backgroundColor: rankStyle.bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 10, fontWeight: "700", color: rankStyle.tint }}>
                      #{it.rank}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      backgroundColor: palette.surfaceGrouped,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{it.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 12, color: palette.ink }} numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2, marginTop: 1 }}>
                      {it.sku} • {it.qty} vann
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={{
                        fontFamily: "Quicksand_700Bold",
                        fontWeight: "700",
                        fontSize: 12,
                        color: palette.ink,
                        ...monoStyle,
                      }}
                    >
                      {fmt(it.amount)} HTG
                    </Text>
                    <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 10, color: palette.muted2 }}>
                      {(it.amount / it.qty).toFixed(0)} /u
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View
          style={{
            flex: 0.85,
            backgroundColor: palette.surface,
            borderRadius: radius.xl,
            borderWidth: 0.5,
            borderColor: palette.hairline,
            overflow: "hidden",
            ...shadow.soft,
          }}
        >
          <CardHeader title="Peye pa Mwayen" subtitle={rangeLabel} pill={`${rangeShort} • Live`} />
          <View style={{ padding: 16, gap: 8 }}>
            {payments.map(p => {
              const pct = mixTotal > 0 ? Math.round((p.value / mixTotal) * 100) : 0;
              return (
                <View key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: p.c }} />
                  <Text style={{ fontFamily: "Roboto_400Regular", fontSize: 12, color: palette.muted2, width: 62 }}>{p.label}</Text>
                  <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: palette.surfaceGrouped }}>
                    <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: p.c }} />
                  </View>
                  <Text
                    style={{
                      fontFamily: "Quicksand_700Bold",
                      fontWeight: "700",
                      fontSize: 12,
                      color: palette.ink,
                      minWidth: 76,
                      textAlign: "right",
                      ...monoStyle,
                    }}
                  >
                    {p.value ? `${fmt(p.value)} HTG` : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}
