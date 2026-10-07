import React, { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, Animated } from "react-native";
import { useResponsive } from "../responsive";
import { SearchHeader, PendingCard } from "../picker/phone";
import { VariantGroupCard } from "../picker/group";
import { PendingVeil } from "../picker/PendingVeil";
import { groupSaleRows } from "../picker/hooks";
import { TABLET_CATS, tabletCatFor } from "../picker/tablet";
import { ProductsEmpty, CartPill, type SaleRow, type CartItem, type SearchMode, type PendingState, type PriceLine } from "./POSShared";
import { SkeletonGroupStack } from "../components/Skeleton";

export interface POSPhoneProps {
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  rows: SaleRow[];
  catNames: Record<string, string>;
  /** useSaleCatalog first-load flag — skeleton until the catalog lands. */
  catalogLoaded: boolean;
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
  onDecQty?: (key: string) => void;
  onOpenCart: () => void;
  /** Portrait tablets hide the pill because the tablet layout shows a side
   *  panel — callers without one (e.g. proformat build) pass true. */
  alwaysShowCartPill?: boolean;
}

export function POSPhone(props: POSPhoneProps) {
  const { width, isTablet, isLandscape, padH } = useResponsive();
  void width;
  // Phone layout shows in landscape on tablets; portrait tablets
  // use the tablet layout instead.
  const sideBySide = isTablet && !isLandscape;
  const {
    search, searchMode, entrance, pending, pendingInput, pendingLine, pendingMaxQ,
    rows, catNames, catalogLoaded, cart, subtotal,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress, onDecQty, onOpenCart, alwaysShowCartPill,
  } = props;

  // Category filter — same TABLET_CATS model the tablet POS and Orders
  // picker use, so phone/tablet offer the identical filtering capability.
  const [cat, setCat] = useState("all");
  const visibleRows = useMemo(() => (cat === "all" ? rows : rows.filter(r => tabletCatFor(r.product) === cat)), [rows, cat]);
  const groups = useMemo(() => groupSaleRows(visibleRows, catNames), [visibleRows, catNames]);
  const inCartQtyFor = (row: SaleRow) => cart.filter(c => c.key === row.key).reduce((s, c) => s + c.qty, 0);
  const pendingActiveFor = (row: SaleRow) => !!pending && pending.product.id === row.product.id && pending.unitId === row.unitId && pending.variant === row.variant;

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

      {/* Category chips — parity with the tablet picker's chip row. */}
      <View style={{ paddingHorizontal: padH, paddingBottom: 6 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row", gap: 6 }}>
          {TABLET_CATS.map(c => {
            const active = cat === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCat(c.id)}
                style={{ backgroundColor: active ? "#fff" : "#1c1c1e", borderWidth: 0.5, borderColor: active ? "#fff" : "rgba(255,255,255,0.14)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }}
              >
                <Text style={{ color: active ? "#000" : "#fff", fontSize: 12.5, fontWeight: active ? "700" : "500" }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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

      {/* List + focus veil: while an item is pending in the hero, the list
          blurs/dims (WhatsApp long-press style) and swallows touches. */}
      <View style={{ flex: 1 }}>
        <FlatList
          data={groups}
          keyExtractor={g => g.product.id}
          numColumns={isTablet ? 2 : 1}
          columnWrapperStyle={isTablet ? { gap: 8 } : undefined}
          contentContainerStyle={{ padding: isTablet ? 20 : 12, paddingBottom: 110, gap: 8 }}
          ListHeaderComponent={
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 }}>
              <Text style={{ color: "#71717a", fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>PWODWI DISPONIB</Text>
              <Text style={{ color: "#8e8e93", fontSize: 11.5, fontWeight: "700", letterSpacing: 0.4 }}>{groups.length} PWODWI</Text>
            </View>
          }
          renderItem={({ item }) => (
            <VariantGroupCard
              group={item}
              inCartQtyFor={inCartQtyFor}
              pendingActiveFor={pendingActiveFor}
              flex={isTablet ? 1 : undefined}
              onRowPress={onProductPress}
              onDecQty={onDecQty}
            />
          )}
          ListEmptyComponent={catalogLoaded ? <ProductsEmpty /> : <SkeletonGroupStack />}
        />
        {pending ? <PendingVeil /> : null}
      </View>

      {(!sideBySide || alwaysShowCartPill) && cart.length > 0 && (
        <View style={{ position: "absolute", bottom: 16, left: 16, right: 16, alignItems: "center", pointerEvents: "box-none" }}>
          <CartPill qty={cart.reduce((s, it) => s + it.qty, 0)} subtotal={subtotal} onPress={onOpenCart} />
        </View>
      )}
    </>
  );
}
