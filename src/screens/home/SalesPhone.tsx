import React from "react";
import { ScrollView } from "react-native";
import type { SalesTabProps } from "./SalesShared";
import {
  RangeSelector,
  PieCashCredit,
  DonutCashMobile,
  GaugeCreditCollection,
  ProfitStackedBar,
} from "./SalesShared";

export default function SalesPhone({ teamKPI, range, setRange }: SalesTabProps) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <RangeSelector range={range} setRange={setRange} />
      <PieCashCredit kpi={teamKPI} />
      <DonutCashMobile kpi={teamKPI} />
      <GaugeCreditCollection kpi={teamKPI} />
      <ProfitStackedBar kpi={teamKPI} />
    </ScrollView>
  );
}
