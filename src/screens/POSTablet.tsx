import React, { useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, Animated, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow, typography, topIconBtn } from "../theme";
import { ht } from "../i18n";
import { PROD_DARK } from "./POSShared";
import { fmtG, fmt, monoStyle } from "../format";
import { useResponsive, centerBox } from "../responsive";
import { ProductsEmpty, CartLineRow, SuspendRow, PayCTA, CartSummary, type Product, type SaleRow, type CartItem, type SearchMode, type PendingState, type PriceLine, type CartView, type CustomerFlow } from "./POSShared";
import { formatSaleLine } from "../catalogModel";
import { ProfileMenu, tenderLabel } from "../components/CustomerProfile";
import { CartMenuView, CartCustomersView, NewCustomerView, EditCustomerView, CustomerDetailBody, CustomerProfileBody, TxnDetailBody } from "./cartViews";

export interface POSTabletProps {
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  payPulse: Animated.Value;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  rows: SaleRow[];
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
  onProductPress: (row: SaleRow) => void;
  getBaseCost?: (productId: string) => number;
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
  onOpenCartMenu?: () => void;
  customerFlow: CustomerFlow;
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
    <View style={{ backgroundColor: PROD_DARK.card, borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 18, overflow: "hidden" }}>
      <View style={{ height: 3, backgroundColor: PROD_DARK.green, width: `${(pending.remaining / 10) * 100}%` as any }} />
      <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: PROD_DARK.avatar, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: PROD_DARK.avatarInk, fontWeight: "800", fontSize: 16 }}>{(pending.product.name?.[0] ?? "•").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, color: PROD_DARK.ink, letterSpacing: -0.2 }} numberOfLines={1}>{pending.product.name}</Text>
          <Text style={{ fontSize: 12, color: PROD_DARK.muted, marginTop: 2 }} numberOfLines={1}>
            {pending.product.sku ?? ""} • {pendingMaxQ} disponib • {fmtG(unitPrice)}{pending.variant !== "Regular" ? ` · ${pending.variant}` : ""}
          </Text>
        </View>
        <View style={{ backgroundColor: "#fff", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center", minWidth: 104 }}>
          <Text style={{ fontWeight: "800", fontSize: 13, color: "#16130c", textAlign: "right", ...monoStyle }}>{fmtG(lineTotal)}</Text>
          <Text style={{ fontSize: 11, color: "#52525b", marginTop: 1, ...monoStyle }}>
            {pending.qty} × {fmt(unitPrice)}{pendingLine?.bundleApplied ? " · Bundle ✓" : ""}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#0a0a0a", borderRadius: 999, padding: 3, gap: 0, borderWidth: 1, borderColor: PROD_DARK.hair }}>
          <Pressable onPress={() => onAdjust(-1)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 999, borderWidth: 0.5, borderColor: PROD_DARK.hair, backgroundColor: PROD_DARK.tile, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "700", fontSize: 16, color: "#fff" }}>−</Text>
          </Pressable>
          <View style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
            <TextInput
              placeholder={String(pending.qty)}
              placeholderTextColor="#fff"
              value={pendingInput}
              onChangeText={onCustom}
              onBlur={onBlurClear}
              keyboardType="numeric"
              selectTextOnFocus
              style={{ fontWeight: "800", fontSize: 15, textAlign: "center", color: "#fff", minWidth: 40, paddingVertical: 0 }}
            />
          </View>
          <Pressable onPress={() => onAdjust(1)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#16130c", fontWeight: "700", fontSize: 16 }}>+</Text>
          </Pressable>
        </View>
        <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: PROD_DARK.green, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#052e16", fontWeight: "800", fontSize: 13 }}>Ajoute • {pending.qty} {pending.unitName} • {pending.remaining}s</Text>
          <Text style={{ color: "rgba(5,46,22,0.7)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={10} style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
          <Text style={{ color: PROD_DARK.muted, fontWeight: "600", fontSize: 13 }}>Anile</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PROD_DARK.green, opacity: pending.remaining <= 3 ? 0.45 : 0.95 }} />
          <Text style={{ color: PROD_DARK.muted, fontSize: 11, fontWeight: "600" }}>Oto nan {pending.remaining}s</Text>
          <View style={{ width: 1, height: 10, backgroundColor: PROD_DARK.hair, marginHorizontal: 1 }} />
          <Text style={{ color: PROD_DARK.green, fontSize: 11, fontWeight: "500" }}>Tape ankò +1</Text>
        </View>
      </View>
    </View>
  );
}

// ---- Tablet variant grid card (one sellable variant per tile: status pill
// row, sale line, sku • cost, right mono price) ----
function TabletProductCard(props: {
  row: SaleRow;
  inCartQty: number;
  pendingActive: boolean;
  onPress: () => void;
  getBaseCost?: (productId: string) => number;
}) {
  const { row, inCartQty, pendingActive, onPress, getBaseCost } = props;
  const item = row.product;
  const baseCost = getBaseCost ? getBaseCost(item.id) : Number((item as any).cost_price ?? 0);
  const isSvc = item.item_type === "service";
  const svcAvail = !isSvc || (item.is_available !== 0 && (item.is_available as any) !== false);
  const isOut = !isSvc && row.maxQ <= 0;
  const isLow = !isSvc && !isOut && row.maxQ <= 5;
  const status = isSvc
    ? (svcAvail ? { label: "Dispo", text: "#4ade80" } : { label: "Koupe", text: "#FBBF24" })
    : isOut
    ? { label: "Epuize", text: "#F87171" }
    : isLow
    ? { label: "Fèb", text: "#FBBF24" }
    : { label: "Dispo", text: "#4ade80" };
  const title = formatSaleLine(item.name, row.variant, row.unitName, row.variantCountForItem);
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: PROD_DARK.card,
        borderWidth: pendingActive ? 2 : 1,
        borderColor: pendingActive ? PROD_DARK.select : PROD_DARK.hair,
        borderRadius: 18,
        padding: 12,
        opacity: isOut || (isSvc && !svcAvail) ? 0.62 : 1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ backgroundColor: "rgba(74,222,128,0.12)", borderWidth: 0.5, borderColor: "rgba(74,222,128,0.4)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill }}>
          <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.4, color: status.text }}>{status.label} • {isSvc ? row.unitName : `${row.maxQ} ${row.unitName}`}</Text>
        </View>
        {inCartQty > 0 && (
          <View style={{ backgroundColor: "#fff", paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#16130c" }}>×{inCartQty}</Text>
          </View>
        )}
      </View>
      <Text style={{ fontWeight: "700", fontSize: 13.5, color: PROD_DARK.ink, marginTop: 8, letterSpacing: -0.1 }} numberOfLines={2}>{title}</Text>
      <Text style={{ fontSize: 11, color: PROD_DARK.muted, marginTop: 2 }} numberOfLines={1}>
        {item.sku ? `${item.sku} • ` : ""}Kout {baseCost > 0 ? fmtG(baseCost) : "—"}
      </Text>
      <Text style={{ fontWeight: "800", fontSize: 14, color: PROD_DARK.ink, marginTop: 8, textAlign: "right", ...monoStyle }}>{fmtG(row.price)}</Text>
    </Pressable>
  );
}

export function POSTablet(props: POSTabletProps) {
  const responsive = useResponsive();
  const { width, isTablet, isLargeTablet, padH } = responsive;
  const {
    search, searchMode, entrance, payPulse, pending, pendingInput, pendingLine, pendingMaxQ,
    rows, cart, subtotal, resumedTabId, resumedTabLabel, visibleTabsCount,
    editingQtyId, editingQtyVal,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress,
    onClearCart, onSuspend, onUpdateResumedTab, onOpenTabs,
    onDecQty, onIncQty, onRemoveLine, onEditQtyStart, onEditQtyChange, onEditQtyBlur,
    onPay,
    onOpenCartMenu, customerFlow,
  } = props;
  const flowView: CartView = customerFlow.view;

  const qtyTotal = cart.reduce((s, it) => s + it.qty, 0);
  const [cat, setCat] = useState("all");
  const [showCartMenu, setShowCartMenu] = useState(false);
  const visibleRows = cat === "all" ? rows : rows.filter(r => tabletCatFor(r.product) === cat);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Page header — mirrors web .page-header: eyebrow + title w/ italic gold accent + actions */}
      <View style={{ width: "100%", paddingHorizontal: padH, paddingTop: 16, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...typography.eyebrow, fontSize: 11 }}>VANT • POS TABLET</Text>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: "#fff", marginTop: 4 }}>
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
              <View style={{ flex: 1, height: 52, flexDirection: "row", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, backgroundColor: "transparent", alignItems: "center", paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 16, color: "#fff", fontWeight: "600" }}>⌕</Text>
                <TextInput
                  placeholder={ht.search}
                  placeholderTextColor="#8e8e93"
                  value={search}
                  onChangeText={onSearchChange}
                  onSubmitEditing={onBarcodeSubmit}
                  returnKeyType="search"
                  style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 9, fontSize: 15, color: "#fff" }}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => onSearchChange("")} hitSlop={8} style={{ padding: 5 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "700" }}>✕</Text>
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
              <Text style={{ marginLeft: "auto", fontSize: 11, color: palette.muted2 }}>{visibleRows.length} varyant • {rows.length} total</Text>
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
            data={visibleRows}
            keyExtractor={i => i.key}
            numColumns={isLargeTablet ? 3 : 2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}
            ListHeaderComponent={
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Varyant disponib</Text>
                <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>{visibleRows.length} rezilta</Text>
              </View>
            }
            renderItem={({ item }) => {
              const inCartQty = cart.filter(c => c.key === item.key).reduce((s, c) => s + c.qty, 0);
              return (
                <TabletProductCard
                  row={item}
                  inCartQty={inCartQty}
                  pendingActive={!!pending && pending.product.id === item.product.id && pending.unitId === item.unitId && pending.variant === item.variant}
                  onPress={() => onProductPress(item)}
                  getBaseCost={props.getBaseCost}
                />
              );
            }}
            ListEmptyComponent={<ProductsEmpty />}
          />
        </View>

        {/* Right sticky cart card — mirrors web .pos-cart: head + body + grouped foot */}
        <View style={{ flex: 2, minWidth: 300, backgroundColor: "#000", borderRadius: radius.lg, borderWidth: 0.5, borderColor: "#262626", ...shadow.card, padding: 14 }}>
          {flowView === "cart" ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ fontWeight: "700", fontSize: 15, color: "#fff", letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
                {ht.cart} • {cart.length} atik • {qtyTotal} pcs
              </Text>
              {onOpenCartMenu ? (
                <Pressable onPress={() => setShowCartMenu(true)} accessibilityLabel="More options" style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 14, color: palette.ink, fontWeight: "800", letterSpacing: 1 }}>···</Text>
                </Pressable>
              ) : null}
              {resumedTabId ? null : (
                <Pressable onPress={onClearCart} accessibilityLabel="Vide panyen" style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable onPress={() => customerFlow.setView(flowView === "newCustomer" ? "customers" : flowView === "txnDetail" ? "custProfile" : flowView === "custEdit" || flowView === "custProfile" ? "custDetail" : "cart")} style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>
                {flowView === "customers" ? "Kliyan" : flowView === "newCustomer" ? "New Customer" : flowView === "custDetail" ? "Kliyan" : flowView === "custProfile" ? "Profil" : flowView === "custEdit" ? "Edit Customer" : flowView === "txnDetail" ? `${fmtG(Number(customerFlow.txnDetail?.sale?.total ?? 0))} ${tenderLabel(customerFlow.txnDetail?.sale?.payment_method)}` : ""}
              </Text>
              {flowView === "customers" ? (
                <Pressable onPress={customerFlow.onOpenNewCustomer} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
              ) : flowView === "newCustomer" ? (
                <Pressable onPress={customerFlow.onSaveCustomer} disabled={!customerFlow.formValid} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: customerFlow.formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: customerFlow.formValid ? 1 : 0.6 }}>
                  <Text style={{ color: customerFlow.formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 12 }}>Save</Text>
                </Pressable>
              ) : flowView === "custDetail" ? (
                <Pressable onPress={customerFlow.onOpenEdit} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 12 }}>Edit</Text>
                </Pressable>
              ) : flowView === "custEdit" ? (
                <Pressable onPress={customerFlow.onSaveEdit} disabled={!customerFlow.editFormValid} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: customerFlow.editFormValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: customerFlow.editFormValid ? 1 : 0.6 }}>
                  <Text style={{ color: customerFlow.editFormValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 12 }}>Save</Text>
                </Pressable>
              ) : flowView === "custProfile" ? (
                <Pressable onPress={customerFlow.onOpenEdit} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 12 }}>Edit</Text>
                </Pressable>
              ) : (
                <View style={{ width: topIconBtn.size }} />
              )}
            </View>
          )}
          {flowView === "cart" && showCartMenu ? (
            <ProfileMenu
              onClose={() => setShowCartMenu(false)}
              top={64}
              right={14}
              options={[
                { label: "Ouvèti-Kont", onPress: () => { customerFlow.setView("cart"); if (resumedTabId) onUpdateResumedTab(); else onSuspend(); } },
                { label: "Anile", onPress: () => {} },
              ]}
            />
          ) : null}
          {flowView === "cart" && customerFlow.selectedName ? (
            <Pressable onPress={customerFlow.onOpenDetail} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
              <Ionicons name="person-outline" size={16} color="#fff" />
              <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 12 }} numberOfLines={1}>{customerFlow.selectedName}</Text>
              <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
            </Pressable>
          ) : null}
          {flowView === "cart" && !customerFlow.selectedName ? (
            <Pressable onPress={() => customerFlow.setView("customers")} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 12 }}>Add Customer</Text>
              <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
            </Pressable>
          ) : null}
          {flowView === "cart" ? (
            <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4 }}>
              {cart.length ? "Glise kantite • tape ✕ pou retire" : "Tape yon pwodwi pou ajoute"}
            </Text>
          ) : null}
          {flowView === "cart" && resumedTabId ? (
            <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 20 }}>
              <Ionicons name="bookmark" size={13} color="#B45309" />
              <Text numberOfLines={1} style={{ flex: 1, color: "#92400E", fontWeight: "800", fontSize: 12 }}>{resumedTabLabel}</Text>
            </View>
          ) : null}

          {flowView === "menu" ? (
            <View style={{ marginTop: 12, flex: 1, justifyContent: "flex-end", paddingBottom: 4 }}>
              <CartMenuView
                onLouvriFakti={() => { customerFlow.setView("cart"); if (resumedTabId) onUpdateResumedTab(); else onSuspend(); }}
                onClearCart={() => { customerFlow.setView("cart"); onClearCart(); }}
                onDismiss={() => customerFlow.setView("cart")}
              />
            </View>
          ) : flowView === "customers" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <CartCustomersView
                dark
                search={customerFlow.search}
                onSearch={customerFlow.setSearch}
                results={customerFlow.results}
                onPick={customerFlow.onPickCustomer}
                onOpenNew={customerFlow.onOpenNewCustomer}
                showDebtOnly={customerFlow.showDebtOnly}
                onToggleDebtOnly={customerFlow.onToggleDebtOnly}
              />
            </View>
          ) : flowView === "newCustomer" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <NewCustomerView formKey={customerFlow.formKey} onFormState={customerFlow.onFormState} />
            </View>
          ) : flowView === "custDetail" ? (
            <View style={{ flex: 1, marginTop: 12 }}>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                <CustomerDetailBody
                  customer={customerFlow.selectedCustomer}
                  stats={customerFlow.stats}
                  notes={customerFlow.notes}
                  onViewProfile={() => customerFlow.setView("custProfile")}
                  onRemove={customerFlow.onRemoveCustomer}
                  hideActions
                  lastVisitItems={customerFlow.lastVisitItems}
                  lastVisitDate={customerFlow.stats.lastVisit}
                  onAddItem={customerFlow.onAddItem}
                  addedProductIds={cart.map(c => c.id)}
                />
              </ScrollView>
              <View style={{ gap: 10, paddingTop: 10, paddingBottom: 4 }}>
                <Pressable onPress={() => customerFlow.setView("custProfile")} style={{ height: 60, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>View Full Profile</Text>
                </Pressable>
                <Pressable onPress={customerFlow.onRemoveCustomer} style={{ height: 60, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: palette.danger, fontWeight: "800", fontSize: 14 }}>Remove From Sale</Text>
                </Pressable>
              </View>
            </View>
          ) : flowView === "custProfile" ? (
            <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              <CustomerProfileBody customer={customerFlow.selectedCustomer} stats={customerFlow.stats} notes={customerFlow.notes} transactions={customerFlow.transactions} onOpenTransaction={customerFlow.onOpenTransaction} />
            </ScrollView>
          ) : flowView === "custEdit" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <EditCustomerView
                formKey={customerFlow.editFormKey}
                initial={customerFlow.editInitial}
                onFormState={customerFlow.onEditFormState}
                notes={customerFlow.notes}
                noteInput={customerFlow.noteInput}
                onNoteInput={customerFlow.setNoteInput}
                savingNote={customerFlow.savingNote}
                onAddNote={customerFlow.onAddNote}
                notesLimit={2}
              />
            </View>
          ) : flowView === "txnDetail" && customerFlow.txnDetail ? (
            <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              <TxnDetailBody
                sale={customerFlow.txnDetail.sale}
                items={customerFlow.txnDetail.items}
                customer={customerFlow.selectedCustomer}
                onNewReceipt={customerFlow.onNewReceipt}
                dueBalance={customerFlow.txnDue}
                totalPaid={customerFlow.txnPaid}
                payments={customerFlow.txnDetail.payments ?? []}
                onPayPress={customerFlow.onTxnPayPress}
              />
            </ScrollView>
          ) : cart.length === 0 ? (
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

          {/* Foot — cart view only */}
          {flowView === "cart" ? (
            <View style={{ marginTop: 12, backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 18, padding: 12, gap: 10 }}>
              {resumedTabId ? (
                <SuspendRow resumedTabId={resumedTabId} resumedTabLabel={resumedTabLabel} onClear={onClearCart} onSuspendOrUpdate={onUpdateResumedTab} />
              ) : null}
              <CartSummary subtotal={subtotal} />
              <PayCTA payPulse={payPulse} subtotal={subtotal} onPay={onPay} />
              <Text style={{ fontSize: 10, color: "#8e8e93", textAlign: "center" }}>Tape Peye pou ouvri fich peman</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
