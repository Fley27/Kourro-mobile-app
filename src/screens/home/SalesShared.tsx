import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { PieChart, BarChart } from "react-native-gifted-charts";
import { palette, radius, shadow } from "../../theme";
import { TABLET_MIN } from "../../responsive";
import type { RangeKey, TeamKPI } from "./types";
import { RANGES } from "./types";
import { fmt } from "../../format";

export type SalesTabProps = {
  teamKPI: TeamKPI;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
};

// Brand palette — charcoal ink + gold accent, with warm complementary tones
export const BRAND = {
  ink: "#16130c",
  gold: "#C8A24A",
  goldSoft: "#D9BE8F",
  goldDeep: "#8A6A35",
  goldBg: "#efe7d2",
  red: "#C0392B",
  warmth: "#A0522D",
  warmGrey: "#837b69",
  warmGreySoft: "#a1967f",
};

export function RangeSelector({ range, setRange }: { range: RangeKey; setRange: (r: RangeKey) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingVertical: 4 }}>
      {RANGES.map(r => {
        const active = range === r.key;
        return (
          <Pressable key={r.key} onPress={() => setRange(r.key)} style={{ paddingBottom: 6, borderBottomWidth: active ? 2.5 : 0, borderBottomColor: palette.ink }}>
            <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? palette.ink : palette.muted2 }}>{r.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: string }) {
  return (
    <View style={styles.cardHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <Text style={styles.cardRight}>{right}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function LegendItem({ color, label, value, total, unit }: { color: string; label: string; value: number; total?: number; unit?: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{fmt(value)}{unit ? ` ${unit}` : ""}{total !== undefined ? ` • ${total ? Math.round((value / total) * 100) : 0}%` : ""}</Text>
    </View>
  );
}

export function PieCashCredit({ kpi }: { kpi: TeamKPI }) {
  const total = kpi.cashSales + kpi.creditSales;
  const data = total > 0
    ? [
        { value: kpi.cashSales, color: BRAND.ink, text: fmt(kpi.cashSales), textColor: "#FFFFFF" },
        { value: kpi.creditSales, color: BRAND.gold, text: fmt(kpi.creditSales), textColor: "#16130c" },
      ]
    : [{ value: 1, color: BRAND.goldBg }];
  return (
    <Card>
      <CardHeader title="Cash / Crédit" subtitle="Répartition des ventes" />
      <View style={styles.chartRow}>
        <PieChart
          data={data}
          radius={70}
          innerRadius={0}
          showText={total > 0}
          textColor="#16130c"
          textSize={11}
          centerLabelComponent={() => (
            <View style={styles.pieCenter}>
              <Text style={styles.pieCenterValue}>{fmt(total)}</Text>
              <Text style={styles.pieCenterLabel}>HTG</Text>
            </View>
          )}
        />
        <View style={styles.legend}>
          <LegendItem color={BRAND.ink} label="Cash" value={kpi.cashSales} total={total} />
          <LegendItem color={BRAND.gold} label="Crédit" value={kpi.creditSales} total={total} />
        </View>
      </View>
    </Card>
  );
}

export function DonutCashMobile({ kpi }: { kpi: TeamKPI }) {
  const total = kpi.cashSales + kpi.mobileAmount;
  const data = total > 0
    ? [
        { value: kpi.cashSales, color: BRAND.ink },
        { value: kpi.mobileAmount, color: BRAND.gold },
      ]
    : [{ value: 1, color: BRAND.goldBg }];
  return (
    <Card>
      <CardHeader title="Cash vs Mobile" subtitle="Ventes encaissées vs paiement mobile" />
      <View style={styles.chartRow}>
        <PieChart
          donut
          data={data}
          radius={70}
          innerRadius={45}
          innerCircleColor="white"
          centerLabelComponent={() => (
            <View style={styles.pieCenter}>
              <Text style={styles.pieCenterValue}>{fmt(total)}</Text>
              <Text style={styles.pieCenterLabel}>HTG</Text>
            </View>
          )}
          strokeWidth={0}
        />
        <View style={styles.legend}>
          <LegendItem color={BRAND.ink} label="Cash" value={kpi.cashSales} total={total} />
          <LegendItem color={BRAND.gold} label="Mobile" value={kpi.mobileAmount} total={total} />
        </View>
      </View>
    </Card>
  );
}

export function GaugeCreditCollection({ kpi }: { kpi: TeamKPI }) {
  const goal = kpi.totalCreditIssued;
  const collected = Math.min(kpi.creditCollected, goal || kpi.creditCollected);
  const pct = goal > 0 ? Math.round((collected / goal) * 100) : 0;
  const outstanding = Math.max(0, goal - collected);
  const hasCredit = goal > 0;
  return (
    <Card>
      <CardHeader title="Recouvrement du Crédit" subtitle={`Objectif : ${fmt(goal)} HTG émis`} />
      <View style={styles.gaugeWrap}>
        <PieChart
          semiCircle
          data={hasCredit
            ? [
                { value: collected, color: BRAND.gold },
                { value: outstanding, color: BRAND.goldBg },
              ]
            : [{ value: 1, color: BRAND.goldBg }]}
          radius={90}
          innerRadius={64}
          centerLabelComponent={() => (
            <View style={styles.gaugeCenter}>
              <Text style={styles.gaugeValue}>{hasCredit ? pct + "%" : "—"}</Text>
              <Text style={styles.gaugeLabel}>{hasCredit ? "collecté" : "aucun crédit"}</Text>
            </View>
          )}
        />
      </View>
      <View style={styles.legend}>
        <LegendItem color={BRAND.gold} label="Collecté" value={collected} unit="HTG" />
        <LegendItem color={BRAND.goldDeep} label="Restant" value={outstanding} unit="HTG" />
      </View>
      <View style={styles.gaugeBar}>
        <Text style={styles.gaugeBarLabel}>Total émis : {fmt(goal)} HTG</Text>
      </View>
    </Card>
  );
}

export function ProfitStackedBar({ kpi }: { kpi: TeamKPI }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN;
  const seg = kpi.profitSegments[0];
  const cashSales = seg?.cashSales ?? 0;
  const collectedCredit = seg?.collectedCredit ?? 0;
  const outstandingCredit = seg?.outstandingCredit ?? 0;
  const barTotal = cashSales + collectedCredit + outstandingCredit;
  const stackData = [
    {
      stacks: [
        { value: cashSales, color: BRAND.ink },
        { value: collectedCredit, color: BRAND.gold },
        { value: outstandingCredit, color: BRAND.red },
      ],
      label: RANGES.find(r => r.key === kpi.profitLabels[0] as any)?.label ?? "",
    },
  ];
  return (
    <Card>
      <CardHeader title="Valeur brute (Profit)" subtitle="Cash sales + crédit (collecté + restant)" right={`${fmt(barTotal)} HTG`} />
      <View style={styles.barChartWrap}>
        <BarChart
          stackData={stackData}
          width={isTablet ? Math.min(420, width - 160) : 220}
          height={180}
          barWidth={isTablet ? 90 : 70}
          frontColor={BRAND.ink}
          hideRules
          noOfSections={4}
          yAxisThickness={0}
          xAxisThickness={0}
          isAnimated
        />
      </View>
      <View style={styles.legend}>
        <LegendItem color={BRAND.ink} label="Ventes Cash" value={cashSales} unit="HTG" />
        <LegendItem color={BRAND.gold} label="Crédit collecté" value={collectedCredit} unit="HTG" />
        <LegendItem color={BRAND.red} label="Crédit restant" value={outstandingCredit} unit="HTG" />
      </View>
    </Card>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: palette.hairline,
    ...shadow.card,
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: palette.ink,
  },
  cardSubtitle: {
    fontSize: 12,
    color: palette.muted2,
    marginTop: 2,
  },
  cardRight: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.ink,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  pieCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  pieCenterValue: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.ink,
  },
  pieCenterLabel: {
    fontSize: 10,
    color: palette.muted2,
  },
  legend: {
    flex: 1,
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    color: palette.muted,
    flex: 1,
  },
  legendValue: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.ink2,
  },
  gaugeWrap: {
    alignItems: "center",
  },
  gaugeCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeValue: {
    fontSize: 26,
    fontWeight: "800",
    color: palette.ink,
    letterSpacing: -0.5,
  },
  gaugeLabel: {
    fontSize: 11,
    color: palette.muted2,
  },
  gaugeBar: {
    backgroundColor: palette.surfaceGrouped,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  gaugeBarLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: palette.muted,
  },
  barChartWrap: {
    alignItems: "center",
  },
});
