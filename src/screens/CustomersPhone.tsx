import React from "react";
import { View, FlatList } from "react-native";
import { centerBox } from "../responsive";
import { SearchHeader, CustomerRowCard, CustomerListEmpty } from "./CustomersShared";

export interface CustomersPhoneProps {
  customers: any[];
  debts: any[];
  displayCustomers: any[];
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  padH: number;
  width: number;
  isTablet: boolean;
}

export function CustomersPhone(props: CustomersPhoneProps) {
  const { customers, debts, displayCustomers, search, setSearch, showDebtOnly, setShowDebtOnly, selectedCustomerId, setSelectedCustomerId, padH, width, isTablet } = props;
  return (
    <View style={{ width: "100%" }}>
      {/* ── Apple header: search + segmented ── */}
      <SearchHeader search={search} setSearch={setSearch} showDebtOnly={showDebtOnly} setShowDebtOnly={setShowDebtOnly} customers={customers} debts={debts} padH={padH} />

      <FlatList
        data={displayCustomers}
        keyExtractor={(item, index) => `${item.id}__${index}`}
        key={isTablet ? "tablet-2" : "phone-1"}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: 10 } : undefined}
        contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 10 }}
        renderItem={({ item }) => {
          const isSelected = item.id === selectedCustomerId;
          return (
            <CustomerRowCard item={item} debts={debts} isSelected={isSelected} fill={isTablet} onPress={() => setSelectedCustomerId(isSelected ? null : item.id)} />
          );
        }}
        ListEmptyComponent={<CustomerListEmpty />}
      />
    </View>
  );
}
