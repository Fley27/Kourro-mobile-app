import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { PieChart, BarChart } from "react-native-gifted-charts";
import { palette, radius, shadow } from "../../theme";
import { useResponsive } from "../../responsive";
import { BRAND, RangeSelector, type SalesTabProps } from "./SalesShared";
import type { TeamKPI } from "./types";
import { RANGES } from "./types";
import { fmt, monoStyle } from "../../format";

// ---------------------------------------------------------------------------
// Tablet-only presentational variants (web card design language).
// Nothing here is exported to / shared with the phone layout: the shared
// Card / CardHeader / LegendItem appearance contract is left untouched.
// ---------------------------------------------------------------------------

function TPill({ children, accent }: { children: string; accent?: boolean }) {
  return (
    <View style={[tStyles.pill, accent ? tStyles.pillAccent : tStyles.pillMuted]}>
      <Text style={[tStyles.pillText, accent ? tStyles.pillTextAccent : tStyles.pillTextMuted]}>{children}</Text>
    </View>
  );
}

function TCardHeader({ title, subtitle, pill, accentPill }: { title: string; subtitle?: string; pill?: string; accentPill?: boolean }) {
  return (
    <View style={tStyles.header}>
      <View style={{ flex: 1 }}>
        <Text style={tStyles.title}>{title}</Text>
        {subtitle ? <Text style={tStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      {pill ? <TPill accent={accentPill}>{pill}</TPill> : null}
    </View>
  );
}

function TCard({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[tStyles.card, style]}>{children}</View>;
}

function TDivider() {
  return <View style={tStyles.divider} />;
}

function TLegendRow({
  color,
  label,
  value,
  total,
  unit,
  isLast,
}: {
  color: string;
  label: string;
  value: number;
  total?: number;
  unit?: string;
  isLast?: boolean;
}) {
  return (
    <View style={[tStyles.legendRow, isLast && tStyles.legendRowLast]}>
      <View style={[tStyles.legendDot, { backgroundColor: color }]} />
      <Text style={tStyles.legendLabel}>{label}</Text>
      <Text style={[tStyles.legendValue, monoStyle]}>
        {fmt(value)}
        {unit ? ` ${unit}` : ""}
        {total !== undefined ? ` • ${total ? Math.round((value / total) * 100) : 0}%` : ""}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tablet chart cards — same charts, data mappings, range-agnostic copy as the
// shared cards; only the card chrome (header pill, divider, inset legend
// rows, grouped footer) is elevated to the web card language.
// ---------------------------------------------------------------------------

function TabletPieCashCredit({ kpi }: { kpi: TeamKPI }) {
  const total = kpi.cashSales + kpi.creditSales;
  const data =
    total > 0
      ? [
          { value: kpi.cashSales, color: BRAND.ink, text: fmt(kpi.cashSales), textColor: "#FFFFFF" },
          { value: kpi.creditSales, color: BRAND.gold, text: fmt(kpi.creditSales), textColor: "#16130c" },
        ]
      : [{ value: 1, color: BRAND.goldBg }];
  return (
    <TCard>
      <TCardHeader title="Cash / Crédit" subtitle="Répartition des ventes" pill={`${fmt(total)} HTG`} />
      <TDivider />
      <View style={tStyles.chartRow}>
        <PieChart
          data={data}
          radius={70}
          innerRadius={0}
          showText={total > 0}
          textColor="#16130c"
          textSize={11}
          centerLabelComponent={() => (
            <View style={tStyles.pieCenter}>
              <Text style={tStyles.pieCenterValue}>{fmt(total)}</Text>
              <Text style={tStyles.pieCenterLabel}>HTG</Text>
            </View>
          )}
        />
        <View style={tStyles.legendList}>
          <TLegendRow color={BRAND.ink} label="Cash" value={kpi.cashSales} total={total} />
          <TLegendRow color={BRAND.gold} label="Crédit" value={kpi.creditSales} total={total} isLast />
        </View>
      </View>
    </TCard>
  );
}

function TabletDonutCashMobile({ kpi }: { kpi: TeamKPI }) {
  const total = kpi.cashSales + kpi.mobileAmount;
  const data =
    total > 0
      ? [
          { value: kpi.cashSales, color: BRAND.ink },
          { value: kpi.mobileAmount, color: BRAND.gold },
        ]
      : [{ value: 1, color: BRAND.goldBg }];
  return (
    <TCard>
      <TCardHeader title="Cash vs Mobile" subtitle="Ventes encaissées vs paiement mobile" pill={`${fmt(total)} HTG`} />
      <TDivider />
      <View style={tStyles.chartRow}>
        <PieChart
          donut
          data={data}
          radius={70}
          innerRadius={45}
          innerCircleColor="white"
          centerLabelComponent={() => (
            <View style={tStyles.pieCenter}>
              <Text style={tStyles.pieCenterValue}>{fmt(total)}</Text>
              <Text style={tStyles.pieCenterLabel}>HTG</Text>
            </View>
          )}
          strokeWidth={0}
        />
        <View style={tStyles.legendList}>
          <TLegendRow color={BRAND.ink} label="Cash" value={kpi.cashSales} total={total} />
          <TLegendRow color={BRAND.gold} label="Mobile" value={kpi.mobileAmount} total={total} isLast />
        </View>
      </View>
    </TCard>
  );
}

function TabletGaugeCreditCollection({ kpi }: { kpi: TeamKPI }) {
  const goal = kpi.totalCreditIssued;
  const collected = Math.min(kpi.creditCollected, goal || kpi.creditCollected);
  const pct = goal > 0 ? Math.round((collected / goal) * 100) : 0;
  const outstanding = Math.max(0, goal - collected);
  const hasCredit = goal > 0;
  return (
    <TCard>
      <TCardHeader
        title="Recouvrement du Crédit"
        subtitle={`Objectif : ${fmt(goal)} HTG émis`}
        pill={hasCredit ? `${pct}%` : "—"}
        accentPill={hasCredit}
      />
      <TDivider />
      <View style={tStyles.gaugeWrap}>
        <PieChart
          semiCircle
          data={
            hasCredit
              ? [
                  { value: collected, color: BRAND.gold },
                  { value: outstanding, color: BRAND.goldBg },
                ]
              : [{ value: 1, color: BRAND.goldBg }]
          }
          radius={90}
          innerRadius={64}
          centerLabelComponent={() => (
            <View style={tStyles.gaugeCenter}>
              <Text style={tStyles.gaugeValue}>{hasCredit ? pct + "%" : "—"}</Text>
              <Text style={tStyles.gaugeLabel}>{hasCredit ? "collecté" : "aucun crédit"}</Text>
            </View>
          )}
        />
      </View>
      <View style={tStyles.legendList}>
        <TLegendRow color={BRAND.gold} label="Collecté" value={collected} unit="HTG" />
        <TLegendRow color={BRAND.goldDeep} label="Restant" value={outstanding} unit="HTG" isLast />
      </View>
      <View style={tStyles.footerBar}>
        <Text style={tStyles.footerBarLabel}>Total émis : {fmt(goal)} HTG</Text>
      </View>
    </TCard>
  );
}

function TabletProfitStackedBar({ kpi, width }: { kpi: TeamKPI; width: number }) {
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
      label: RANGES.find(r => r.key === (kpi.profitLabels[0] as any))?.label ?? "",
    },
  ];
  return (
    <TCard>
      <TCardHeader
        title="Valeur brute (Profit)"
        subtitle="Cash sales + crédit (collecté + restant)"
        pill={`${fmt(barTotal)} HTG`}
      />
      <TDivider />
      <View style={tStyles.barChartWrap}>
        <BarChart
          stackData={stackData}
          width={Math.min(420, width - 160)}
          height={180}
          barWidth={90}
          frontColor={BRAND.ink}
          hideRules
          noOfSections={4}
          yAxisThickness={0}
          xAxisThickness={0}
          isAnimated
        />
      </View>
      <View style={tStyles.legendList}>
        <TLegendRow color={BRAND.ink} label="Ventes Cash" value={cashSales} unit="HTG" />
        <TLegendRow color={BRAND.gold} label="Crédit collecté" value={collectedCredit} unit="HTG" />
        <TLegendRow color={BRAND.red} label="Crédit restant" value={outstandingCredit} unit="HTG" isLast />
      </View>
      <View style={tStyles.footerBar}>
        <Text style={tStyles.footerBarLabel}>Total brut : {fmt(barTotal)} HTG</Text>
      </View>
    </TCard>
  );
}

export default function SalesTablet({ teamKPI, range, setRange }: SalesTabProps) {
  const { width } = useResponsive();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <RangeSelector range={range} setRange={setRange} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <TabletPieCashCredit kpi={teamKPI} />
        </View>
        <View style={{ flex: 1 }}>
          <TabletDonutCashMobile kpi={teamKPI} />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <TabletGaugeCreditCollection kpi={teamKPI} />
        </View>
        <View style={{ flex: 1 }}>
          <TabletProfitStackedBar kpi={teamKPI} width={width} />
        </View>
      </View>
    </ScrollView>
  );
}

const tStyles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: palette.hairline,
    ...shadow.card,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: palette.ink,
  },
  subtitle: {
    fontSize: 12,
    color: palette.muted2,
    marginTop: 2,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  pillMuted: {
    backgroundColor: palette.surfaceGrouped,
  },
  pillAccent: {
    backgroundColor: BRAND.goldBg,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextMuted: {
    color: palette.ink,
  },
  pillTextAccent: {
    color: BRAND.goldDeep,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.hairline,
    marginBottom: 12,
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
  legendList: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
    marginTop: 4,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.hairline,
  },
  legendRowLast: {
    borderBottomWidth: 0,
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
    fontSize: 13,
    fontWeight: "700",
    color: palette.ink2,
    textAlign: "right",
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
  barChartWrap: {
    alignItems: "center",
  },
  footerBar: {
    backgroundColor: palette.surfaceGrouped,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  footerBarLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: palette.muted,
  },
});
