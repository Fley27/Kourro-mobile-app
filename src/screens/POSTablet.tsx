import React, { useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, Animated, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow, typography } from "../theme";
import { ht } from "../i18n";
import { fmt, monoStyle } from "../format";
import { useResponsive, centerBox } from "../responsive";
import { ProductsEmpty, CartLineRow, CartTotalsBar, SuspendRow, PayCTA, type Product, type CartItem, type SearchMode, type PendingState, type PriceLine } from "./POSShared";

export interface POSTabletProps {
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  payPulse: Animated.Value;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  products: Product[];
  cart: CartItem[];
  subtotal: number;
  resumedTabId: string | null;
  resumedTabLabel: string;
  visibleTabsCount: number;
  editingQtyId: string | null;
  editingQtyVal: string;
  onSearchChange: (v: string) => void;
  onSearchModeChange: (m: SearchMode) => void;
  onBarcodeSubmit: () => void;
  onOpenScanner: () => void;
  onAdjustPending: (delta: number) => void;
  onPendingCustom: (val: string) => void;
  onPendingBlurClear: () => void;
  onCommitPending: () => void;
  onCancelPending: () => void;
  onProductPress: (p: Product) => void;
  displayPriceFor: (p: Product) => string;
  onClearCart: () => void;
  onSuspend: () => void;
  onUpdateResumedTab: () => void;
  onOpenTabs: () => void;
  onDecQty: (key: string) => void;
  onIncQty: (key: string) => void;
  onRemoveLine: (key: string) => void;
  onEditQtyStart: (key: string) => void;
  onEditQtyChange: (key: string, v: string) => void;
  onEditQtyBlur: () => void;
  onPay: () => void;
}

// ---- Tablet-only category model (mirrors web CATEGORIES + catFor; filtered locally so the shell is untouched) ----
const TABLET_CATS = [
  { id: "all", label: "Tout" },
  { id: "food", label: "Manje" },
  { id: "drinks", label: "Bwason" },
  { id: "household", label: "Kay" },
  { id: "dairy", label: "Letye" },
];

function tabletCatFor(p: Product): string {
  const n = (p.name ?? "").toLowerCase();
  if (n.includes("beer") || n.includes("cola") || n.includes("water") || n.includes("dlo") || n.includes("kola") || n.includes("prestige")) return "drinks";
  if (n.includes("soap") || n.includes("savon") || n.includes("detergent") || n.includes("colgate")) return "household";
  if (n.includes("milk") || n.includes("lèt") || n.includes("coffee") || n.includes("kafe")) return "dairy";
  return "food";
}

// ---- Tablet pending hero (local variant: shared PendingCard is phone-row styled;
// this mirrors the web hero — 3px green bar, dark tile, dark qty box, pill stepper, green CTA) ----
function TabletPendingHero(props: {
  pending: PendingState;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  onAdjust: (delta: number) => void;
  onCustom: (val: string) => void;
  onBlurClear: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { pending, pendingInput, pendingLine, pendingMaxQ, onAdjust, onCustom, onBlurClear, onCommit, onCancel } = props;
  const unitPrice = pendingLine ? pendingLine.unitPrice : 0;
  const lineTotal = pendingLine ? pendingLine.lineTotal : 0;
  return (
    <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: "rgba(16,185,129,0.24)", borderRadius: radius.lg, overflow: "hidden", ...shadow.card, shadowColor: "#10B981" }}>
      <View style={{ height: 3, backgroundColor: palette.successDot, width: `${(pending.remaining / 10) * 100}%` as any }} />
      <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "white", fontWeight: "800", fontSize: 16 }}>{(pending.product.name?.[0] ?? "•").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{pending.product.name}</Text>
          <Text style={{ fontSize: 12, color: palette.muted, marginTop: 2 }} numberOfLines={1}>
            {pending.product.sku ?? ""} • {pendingMaxQ} disponib • {fmt(unitPrice)} HTG{pending.variant !== "Regular" ? ` · ${pending.variant}` : ""}
          </Text>
        </View>
        <View style={{ backgroundColor: palette.ink, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center", minWidth: 104 }}>
          <Text style={{ fontWeight: "800", fontSize: 13, color: "white", textAlign: "right", ...monoStyle }}>{fmt(lineTotal)} HTG</Text>
          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.64)", marginTop: 1, ...monoStyle }}>
            {pending.qty} × {fmt(unitPrice)}{pendingLine?.bundleApplied ? " · Bundle ✓" : ""}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: palette.surfaceGrouped, borderRadius: radius.pill, padding: 3, gap: 0, borderWidth: 0.5, borderColor: palette.hairline }}>
          <Pressable onPress={() => onAdjust(-1)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 999, borderWidth: 0.5, borderColor: palette.hairline, backgroundColor: "white", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink }}>−</Text>
          </Pressable>
          <View style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
            <TextInput
              placeholder={String(pending.qty)}
              placeholderTextColor={palette.ink}
              value={pendingInput}
              onChangeText={onCustom}
              onBlur={onBlurClear}
              keyboardType="numeric"
              selectTextOnFocus
              style={{ fontWeight: "800", fontSize: 15, textAlign: "center", color: palette.ink, minWidth: 40, paddingVertical: 0 }}
            />
          </View>
          <Pressable onPress={() => onAdjust(1)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>+</Text>
          </Pressable>
        </View>
        <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: palette.successDot, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>Ajoute • {pending.qty} {pending.unitName} • {pending.remaining}s</Text>
          <Text style={{ color: "rgba(255,255,255,0.86)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={10} style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
          <Text style={{ color: palette.muted, fontWeight: "600", fontSize: 13 }}>Anile</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.successDot, opacity: pending.remaining <= 3 ? 0.45 : 0.95 }} />
          <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600" }}>Oto nan {pending.remaining}s</Text>
          <View style={{ width: 1, height: 10, backgroundColor: palette.separator }} />
          <Text style={{ color: palette.muted2, fontSize: 11, fontWeight: "500" }}>Tape ankò +1</Text>
        </View>
      </View>
    </View>
  );
}

// ---- Tablet product grid card (local variant: shared ProductCard is a horizontal row;
// this mirrors the web grid button — status pill row, name, sku • cost, right mono price) ----
function TabletProductCard(props: {
  item: Product;
  inCartQty: number;
  displayPrice: string;
  pendingActive: boolean;
  onPress: () => void;
}) {
  const { item, inCartQty, displayPrice, pendingActive, onPress } = props;
  const isOut = item.stock_quantity <= 0;
  const isLow = !isOut && item.stock_quantity <= 5;
  const status = isOut
    ? { label: "Epuize", bg: palette.dangerBg, text: palette.danger, bd: palette.dangerBd }
    : isLow
    ? { label: "Fèb", bg: palette.warningBg, text: palette.warning, bd: palette.warningBd }
    : { label: "Dispo", bg: palette.successBg, text: "#065F46", bd: palette.successBd };
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: palette.surface,
        borderWidth: 0.5,
        borderColor: isOut ? palette.dangerBd : isLow ? "#FDE68A" : palette.hairline,
        borderRadius: radius.md,
        padding: 12,
        opacity: isOut ? 0.62 : pendingActive ? 0.92 : 1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ backgroundColor: status.bg, borderWidth: 0.5, borderColor: status.bd, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill }}>
          <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.4, color: status.text }}>{status.label} • {item.stock_quantity}</Text>
        </View>
        {inCartQty > 0 && (
          <View style={{ backgroundColor: palette.ink, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "white" }}>×{inCartQty}</Text>
          </View>
        )}
      </View>
      <Text style={{ fontWeight: "700", fontSize: 13.5, color: palette.ink, marginTop: 8, letterSpacing: -0.1 }} numberOfLines={2}>{item.name}</Text>
      <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }} numberOfLines={1}>
        {item.sku ? `${item.sku} • ` : ""}Kout {fmt(item.cost_price)} HTG
      </Text>
      <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink, marginTop: 8, textAlign: "right", ...monoStyle }}>{displayPrice}</Text>
    </Pressable>
  );
}

export function POSTablet(props: POSTabletProps) {
  const responsive = useResponsive();
  const { width, isTablet, isLargeTablet, padH } = responsive;
  const {
    search, searchMode, entrance, payPulse, pending, pendingInput, pendingLine, pendingMaxQ,
    products, cart, subtotal, resumedTabId, resumedTabLabel, visibleTabsCount,
    editingQtyId, editingQtyVal,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress, displayPriceFor,
    onClearCart, onSuspend, onUpdateResumedTab, onOpenTabs,
    onDecQty, onIncQty, onRemoveLine, onEditQtyStart, onEditQtyChange, onEditQtyBlur,
    onPay,
  } = props;

  const qtyTotal = cart.reduce((s, it) => s + it.qty, 0);
  const [cat, setCat] = useState("all");
  const visibleProducts = cat === "all" ? products : products.filter(p => tabletCatFor(p) === cat);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {/* Page header — mirrors web .page-header: eyebrow + title w/ italic gold accent + actions */}
      <View style={{ width: "100%", paddingHorizontal: padH, paddingTop: 16, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...typography.eyebrow, fontSize: 11 }}>VANT • POS TABLET</Text>
            <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: palette.ink, marginTop: 4 }}>
              Kès <Text style={{ fontStyle: "italic", fontWeight: "300", color: palette.accentGold }}>vit & presi</Text>
            </Text>
            <Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>Vann vit sou tablèt — chèche pwodwi, ajoute nan panyen, peze Peye.</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: palette.muted }}>{visibleTabsCount} tab</Text>
            </View>
            <Pressable onPress={onOpenTabs} accessibilityLabel="Ouvri Tabs" style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.ink, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
              <View style={{ minWidth: 20, height: 20, borderRadius: 999, backgroundColor: palette.accentGold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: "white" }}>{visibleTabsCount}</Text>
              </View>
              <Text style={{ color: "white", fontWeight: "800", fontSize: 12 }}>ATANN</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Two-pane: products left, cart right */}
      <View style={{ width: "100%", flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: padH, paddingBottom: 12, paddingTop: 8 }}>
        <View style={{ flex: 3, minWidth: 0, gap: 12 }}>
          {/* Search card — mirrors web search card: white radius-20 card, field + mode + category tinted rows */}
          <Animated.View
            style={
              {
                backgroundColor: palette.surface,
                borderRadius: radius.lg,
                borderWidth: 0.5,
                borderColor: palette.hairline,
                ...shadow.soft,
                padding: 12,
                gap: 10,
                opacity: entrance,
                transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
              } as any
            }
          >
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1, height: 48, flexDirection: "row", borderWidth: 1, borderColor: palette.separator, borderRadius: 14, backgroundColor: "#f9f9fb", alignItems: "center", paddingHorizontal: 13 }}>
                <Text style={{ fontSize: 16, color: palette.muted, fontWeight: "600" }}>{searchMode === "barcode" ? "▥" : searchMode === "category" ? "◫" : "⌕"}</Text>
                <TextInput
                  placeholder={searchMode === "barcode" ? ht.barcode : searchMode === "category" ? "Chèche kategori" : ht.search}
                  placeholderTextColor="#8e8e93"
                  value={search}
                  onChangeText={onSearchChange}
                  onSubmitEditing={searchMode === "barcode" ? onBarcodeSubmit : undefined}
                  returnKeyType="search"
                  style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 9, fontSize: 14, color: palette.ink2 }}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => onSearchChange("")} hitSlop={8} style={{ padding: 5 }}>
                    <Text style={{ color: palette.muted, fontSize: 12, fontWeight: "700" }}>✕</Text>
                  </Pressable>
                )}
              </View>
              <Pressable accessibilityLabel="Scan QR" accessibilityHint="Eskane yon pwodwi" onPress={onOpenScanner} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", ...shadow.soft }}>
                <Text style={{ fontSize: 19, color: "white" }}>▣</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {(["name", "barcode", "category"] as SearchMode[]).map(m => {
                const active = searchMode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => { onSearchModeChange(m); onSearchChange(""); }}
                    style={{
                      backgroundColor: active ? palette.ink : palette.surfaceGrouped,
                      borderWidth: 0.5,
                      borderColor: active ? palette.ink : palette.hairline,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text style={{ color: active ? "white" : palette.ink, fontWeight: "700", fontSize: 11.5 }}>{m === "name" ? "Nom" : m === "barcode" ? "Bakod" : "Kategori"}</Text>
                  </Pressable>
                );
              })}
              <Text style={{ marginLeft: "auto", fontSize: 11, color: palette.muted2 }}>Mòd: {searchMode}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {TABLET_CATS.map(c => {
                const active = cat === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCat(c.id)}
                    style={{
                      backgroundColor: active ? palette.ink : palette.surface,
                      borderWidth: 0.5,
                      borderColor: active ? palette.ink : palette.hairline,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: radius.pill,
                    }}
                  >
                    <Text style={{ color: active ? "white" : palette.ink, fontSize: 12.5, fontWeight: active ? "700" : "500" }}>{c.label}</Text>
                  </Pressable>
                );
              })}
              <Text style={{ marginLeft: "auto", fontSize: 11, color: palette.muted2 }}>{visibleProducts.length} pwodwi • {products.length} total</Text>
            </View>
          </Animated.View>

          {pending && (
            <TabletPendingHero
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
            style={{ flex: 1 }}
            data={visibleProducts}
            keyExtractor={i => i.id}
            numColumns={isLargeTablet ? 3 : 2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}
            renderItem={({ item }) => {
              const inCartQty = cart.filter(c => c.id === item.id).reduce((s, c) => s + c.qty, 0);
              return (
                <TabletProductCard
                  item={item}
                  inCartQty={inCartQty}
                  displayPrice={displayPriceFor(item)}
                  pendingActive={pending?.product.id === item.id}
                  onPress={() => onProductPress(item)}
                />
              );
            }}
            ListEmptyComponent={<ProductsEmpty />}
          />
        </View>

        {/* Right sticky cart card — mirrors web .pos-cart: head + body + grouped foot */}
        <View style={{ flex: 2, minWidth: 300, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card, padding: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
              {ht.cart} • {cart.length} atik • {qtyTotal} pcs
            </Text>
            {resumedTabId ? null : (
              <Pressable onPress={onClearCart} accessibilityLabel="Vide panyen" style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
              </Pressable>
            )}
          </View>
          <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4 }}>
            {cart.length ? "Glise kantite • tape ✕ pou retire" : "Tape yon pwodwi pou ajoute"}
          </Text>
          {resumedTabId ? (
            <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 20 }}>
              <Ionicons name="bookmark" size={13} color="#B45309" />
              <Text numberOfLines={1} style={{ flex: 1, color: "#92400E", fontWeight: "800", fontSize: 12 }}>{resumedTabLabel}</Text>
            </View>
          ) : null}

          {cart.length === 0 ? (
            <View style={{ backgroundColor: "#F9F9FB", borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 18, alignItems: "center", marginTop: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                <Ionicons name="cart-outline" size={20} color={palette.muted2} />
              </View>
              <Text style={{ fontWeight: "600", color: palette.ink, fontSize: 13 }}>Panyen vid</Text>
              <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4, textAlign: "center" }}>Chwazi pwodwi sou bò gòch la pou ranpli panyen an.</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              {cart.map(c => (
                <CartLineRow
                  key={c.key}
                  item={c}
                  editingQtyId={editingQtyId}
                  editingQtyVal={editingQtyVal}
                  onDec={() => onDecQty(c.key)}
                  onInc={() => onIncQty(c.key)}
                  onRemove={() => onRemoveLine(c.key)}
                  onEditStart={() => onEditQtyStart(c.key)}
                  onEditChange={(v) => onEditQtyChange(c.key, v)}
                  onEditBlur={onEditQtyBlur}
                />
              ))}
            </ScrollView>
          )}

          {/* Foot — same components as the phone cart sheet */}
          <View style={{ marginTop: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, gap: 10 }}>
            <SuspendRow resumedTabId={resumedTabId} resumedTabLabel={resumedTabLabel} onClear={onClearCart} onSuspendOrUpdate={resumedTabId ? onUpdateResumedTab : onSuspend} />
            <CartTotalsBar subtotal={subtotal} />
            <PayCTA payPulse={payPulse} subtotal={subtotal} onPay={onPay} />
            <Text style={{ fontSize: 10, color: palette.muted3, textAlign: "center" }}>Tape Peye pou ouvri fich peman</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
