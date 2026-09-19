import React from "react";
import { FlatList } from "react-native";
import { useResponsive } from "../responsive";
import {
  CreditsListHeader,
  CreditsEmptyState,
  DebtCard,
  type AnalyticsState,
  type CreditsView,
  type RangeKey,
} from "./CreditsShared";

export interface CreditsPhoneProps {
  filteredDebts: any[];
  openDebts: any[];
  customers: any[];
  allPayments: any[];
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  rangeLabel: string;
  analytics: AnalyticsState;
  ringTrace: { paidPercent: number; unpaidPercent: number };
  search: string;
  setSearch: (v: string) => void;
  query: string;
  customerSuggestions: any[];
  setSelectedCust: (c: any) => void;
  canManageCustomer: boolean;
  setShowAddCustomer: (b: boolean) => void;
  view: CreditsView;
  setView: (v: CreditsView) => void;
  openDebtModal: (c: any, debtId?: string) => void;
}

export function CreditsPhone(props: CreditsPhoneProps) {
  const { padH } = useResponsive();
  const {
    filteredDebts,
    openDebts,
    customers,
    allPayments,
    range,
    setRange,
    rangeLabel,
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
  } = props;

  return (
    <FlatList
      data={filteredDebts}
      keyExtractor={i => i.id}
      key="phone-1"
      numColumns={1}
      columnWrapperStyle={undefined}
      showsVerticalScrollIndicator={true}
      bounces={true}
      contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 0 }}
      ListHeaderComponent={
        <CreditsListHeader
          range={range}
          setRange={setRange}
          rangeLabel={rangeLabel}
          analytics={analytics}
          ringTrace={ringTrace}
          search={search}
          setSearch={setSearch}
          query={query}
          customerSuggestions={customerSuggestions}
          onSelectCustomer={(c) => { setSearch(c.name); setSelectedCust(c); }}
          canManageCustomer={canManageCustomer}
          onAddCustomer={() => setShowAddCustomer(true)}
          view={view}
          setView={setView}
          filteredCount={filteredDebts.length}
          openCount={openDebts.length}
        />
      }
      ListEmptyComponent={<CreditsEmptyState view={view} />}
      renderItem={({ item: d }) => {
        const cust = customers.find(c => c.id === d.customer_id);
        return (
          <DebtCard
            debt={d}
            customer={cust}
            allPayments={allPayments}
            isTablet={false}
            onPress={() => {
              if (cust) openDebtModal(cust, d.id);
              else {
                const paidForFallback = allPayments.filter(p => p.debt_id === d.id || p.credit_id === d.id).reduce((s, p) => s + Number(p.amount || 0), 0);
                const fallbackBalance = Math.max(0, Number(d.amount || 0) - paidForFallback);
                openDebtModal({ id: d.customer_id, name: "Enkoni", id_card_number: "—", phone: "—", total_debt: fallbackBalance, credit_limit: null }, d.id);
              }
            }}
          />
        );
      }}
    />
  );
}
