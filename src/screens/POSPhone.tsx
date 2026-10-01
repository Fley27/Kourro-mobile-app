import React from "react";
import { View, Text, FlatList, Animated } from "react-native";
import { useResponsive } from "../responsive";
import { SearchHeader, PendingCard, VariantCard } from "../picker/phone";
import { ProductsEmpty, CartPill, type SaleRow, type CartItem, type SearchMode, type PendingState, type PriceLine } from "./POSShared";

export interface POSPhoneProps {
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  rows: SaleRow[];
  cart: CartItem[];
  subtotal: number;
  onSearchChange: (v: string) => void;
  onSearchModeChange: (m: SearchMode) => void;
  onBarcodeSubmit: () => void;
  onOpenScanner: () => void;
  onAdjustPending: (delta: number) => void;
  onPendingCustom: (val: string) => void;
  onPendingBlurClear: () => void;
  onCommitPending: () => void;
  onCancelPending: () => void;
  onProductPress: (row: SaleRow) => void;
  onOpenCart: () => void;
}

export function POSPhone(props: POSPhoneProps) {
  const { width, isTablet, isLandscape } = useResponsive();
  void width;
  // Phone layout shows in landscape on tablets; portrait tablets
  // use the tablet layout instead.
  const sideBySide = isTablet && !isLandscape;
  const {
    search, searchMode, entrance, pending, pendingInput, pendingLine, pendingMaxQ,
    rows, cart, subtotal,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress, onOpenCart,
  } = props;

  return (
    <>
      <SearchHeader
        variant="phone"
        search={search}
        searchMode={searchMode}
        entrance={entrance}
        onSearchChange={onSearchChange}
        onSearchModeChange={onSearchModeChange}
        onBarcodeSubmit={onBarcodeSubmit}
        onOpenScanner={onOpenScanner}
      />

      {pending && (
        <PendingCard
          variant="phone"
          pending={pending}
          pendingInput={pendingInput}
          pendingLine={pendingLine}
          pendingMaxQ={pendingMaxQ}
          onAdjust={onAdjustPending}
          onCustom={onPendingCustom}
          onBlurClear={onPendingBlurClear}
          onCommit={onCommitPending}
          onCancel={onCancelPending}
        />
      )}

      <FlatList
        data={rows}
        keyExtractor={i => i.key}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: 8 } : undefined}
        contentContainerStyle={{ padding: isTablet ? 20 : 12, paddingBottom: 110, gap: 8 }}
        ListHeaderComponent={
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Varyant disponib</Text>
            <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>{rows.length} rezilta</Text>
          </View>
        }
        renderItem={({ item }) => {
          const inCartQty = cart.filter(c => c.key === item.key).reduce((s, c) => s + c.qty, 0);
          return (
            <VariantCard
              row={item}
              inCartQty={inCartQty}
              pendingActive={!!pending && pending.product.id === item.product.id && pending.unitId === item.unitId && pending.variant === item.variant}
              flex={isTablet ? 1 : undefined}
              onPress={() => onProductPress(item)}
            />
          );
        }}
        ListEmptyComponent={<ProductsEmpty />}
      />

      {!sideBySide && cart.length > 0 && (
        <View style={{ position: "absolute", bottom: 16, left: 16, right: 16, alignItems: "center", pointerEvents: "box-none" }}>
          <CartPill qty={cart.reduce((s, it) => s + it.qty, 0)} subtotal={subtotal} onPress={onOpenCart} />
        </View>
      )}
    </>
  );
}
