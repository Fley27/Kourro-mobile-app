import React from "react";
import { View, Text, FlatList, Pressable, Animated } from "react-native";
import { useResponsive } from "../responsive";
import { ht } from "../i18n";
import { fmtG, fmt, monoStyle } from "../format";
import { SearchHeader, PendingCard, VariantCard, ProductsEmpty, type SaleRow, type CartItem, type SearchMode, type PendingState, type PriceLine } from "./POSShared";

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
          <Pressable onPress={onOpenCart} accessibilityLabel="Open cart" style={{ width: "100%", maxWidth: isTablet ? 520 : 390, minHeight: 58, flexDirection: "row", alignItems: "center", backgroundColor: "#22C55E", borderRadius: 18, paddingVertical: 9, paddingHorizontal: 10, gap: 11, shadowColor: "#22C55E", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: "#052e16", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: "900", color: "#4ade80", fontSize: 13 }}>{cart.reduce((s, it) => s + it.qty, 0)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: "#052e16", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>{ht.cart}</Text>
                <Text style={{ color: "rgba(5,46,22,0.7)", fontSize: 11, fontWeight: "600" }}>{cart.length} atik</Text>
              </View>
              <Text style={{ color: "rgba(5,46,22,0.7)", fontSize: 11, fontWeight: "500" }} numberOfLines={1}>Tape pou wè detay</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 1, paddingRight: 4 }}>
              <Text style={{ color: "#052e16", fontWeight: "900", fontSize: 14, textAlign: "right", ...monoStyle }}>{fmtG(subtotal)}</Text>
              <Text style={{ color: "rgba(5,46,22,0.7)", fontSize: 10, fontWeight: "600" }}>Gade panyen</Text>
            </View>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: "rgba(5,46,22,0.25)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#052e16", fontSize: 16, fontWeight: "700" }}>⌃</Text>
            </View>
          </Pressable>
        </View>
      )}
    </>
  );
}
