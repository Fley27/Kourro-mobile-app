import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, shadow } from "../theme";
import { fmt, monoStyle } from "../format";
import { ht } from "../i18n";
import { useResponsive, centerBox } from "../responsive";

// ---- Shared types (moved verbatim from POSScreen) ----
export type Product = { id: string; name: string; name_ht?: string; barcode?: string; sku?: string; category_id?: string; stock_quantity: number; cost_price: number; sales_count?: number; selling_price?: number; unit?: string };
export type CartItem = Product & { key: string; qty: number; unitId: string; unitName: string; factor: number; variant: string; unitPrice: number; lineTotal: number; bundleApplied: boolean; frozenBase?: number };
export type PendingSel = { unitId: string; unitName: string; factor: number; variant: string };
export type SuspendedTab = { id: string; store_id?: string; label: string; customer_id?: string | null; cashier_id?: string | null; cashier_name?: string | null; seller_role?: string | null; status?: string; total?: number; completed_sale_id?: string | null; device_id?: string | null; created_at?: string; updated_at?: string };
export type SearchMode = "name" | "barcode" | "category";
export type PaymentMethod = "cash" | "mobile" | "credit";
export type PendingState = { product: Product; qty: number; remaining: number } & PendingSel;
export type PriceLine = { unitPrice: number; lineTotal: number; bundleApplied: boolean };

// ---- Search mode segmented tabs (identical on phone + tablet) ----
export function SearchModeBar(props: { searchMode: SearchMode; onChange: (m: SearchMode) => void }) {
  const { searchMode, onChange } = props;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ backgroundColor: palette.surfaceGrouped, borderRadius: 11, padding: 3, borderWidth: 0.5, borderColor: palette.hairline }}>
      {([["name", "Nom"], ["barcode", "Bakod"], ["category", "Kategori"]] as [SearchMode, string][]).map(([mode, label]) => (
        <Pressable key={mode} onPress={() => { onChange(mode); }} style={{ minWidth: 78, backgroundColor: searchMode === mode ? "white" : "transparent", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center", shadowColor: "#000", shadowOpacity: searchMode === mode ? 0.08 : 0, shadowRadius: 4, elevation: searchMode === mode ? 2 : 0 }}>
          <Text style={{ color: searchMode === mode ? "#16130c" : "#6b7280", fontSize: 12, fontWeight: searchMode === mode ? "700" : "600" }}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---- Unified product search header (phone adds centerBox, tablet does not) ----
export function SearchHeader(props: {
  variant: "phone" | "tablet";
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  onSearchChange: (v: string) => void;
  onSearchModeChange: (m: SearchMode) => void;
  onBarcodeSubmit: () => void;
  onOpenScanner: () => void;
}) {
  const { variant, search, searchMode, entrance, onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner } = props;
  const { width, isTablet, padH } = useResponsive();
  const outerStyle =
    variant === "phone"
      ? { width: "100%" as const, paddingHorizontal: padH, paddingTop: 14, paddingBottom: 12, backgroundColor: palette.surface, borderBottomWidth: 0.5, borderColor: palette.hairline, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }
      : { paddingHorizontal: padH, paddingTop: 14, paddingBottom: 12, backgroundColor: palette.surface, borderBottomWidth: 0.5, borderColor: palette.hairline, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] };
  return (
    <Animated.View style={outerStyle as any}>
      <SearchModeBar searchMode={searchMode} onChange={(m) => { onSearchModeChange(m); onSearchChange(""); }} />
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 12 }}>
        <View style={{ flex: 1, height: 48, flexDirection: "row", borderWidth: 1, borderColor: "#d1d1d6", borderRadius: 14, backgroundColor: "#f9f9fb", alignItems: "center", paddingHorizontal: 13 }}>
          <Text style={{ fontSize: 16, color: "#6b7280", fontWeight: "600" }}>{searchMode === "barcode" ? "▥" : searchMode === "category" ? "◫" : "⌕"}</Text>
          <TextInput placeholder={searchMode === "barcode" ? ht.barcode : searchMode === "category" ? "Chèche kategori" : ht.search} placeholderTextColor="#8e8e93" value={search} onChangeText={onSearchChange} onSubmitEditing={searchMode === "barcode" ? onBarcodeSubmit : undefined} returnKeyType="search" style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 9, fontSize: 14, color: "#16130c" }} />
          {search.length > 0 && <Pressable onPress={() => onSearchChange("")} hitSlop={8} style={{ padding: 5 }}><Text style={{ color: "#6b7280", fontSize: 12, fontWeight: "700" }}>✕</Text></Pressable>}
        </View>
        <Pressable accessibilityLabel="Scan QR" accessibilityHint="Eskane yon pwodwi" onPress={onOpenScanner} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", ...shadow.soft }}>
          <Text style={{ fontSize: 19, color: "white" }}>▣</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ---- Pending "hero" card (phone adds centerBox, tablet uses plain margins) ----
export function PendingCard(props: {
  variant: "phone" | "tablet";
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
  const { variant, pending, pendingInput, pendingLine, pendingMaxQ, onAdjust, onCustom, onBlurClear, onCommit, onCancel } = props;
  const { width, isTablet } = useResponsive();
  const outerStyle =
    variant === "phone"
      ? { width: "100%" as const, marginTop: 12, backgroundColor: "white", borderRadius: 24, overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(16,185,129,0.32)", shadowColor: "#065F46", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12 }
      : { marginHorizontal: 12, marginTop: 12, backgroundColor: "white", borderRadius: 24, overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(16,185,129,0.32)", shadowColor: "#065F46", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12 };
  return (
    <View style={outerStyle as any}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24, shadowColor: "#10B981", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } }} pointerEvents="none" />
      <View style={{ height: 4, backgroundColor: "#10B981" }} />
      <View style={{ height: 2, backgroundColor: "#ECFDF5" }}>
        <View style={{ height: 2, width: `${(pending.remaining / 10) * 100}%` as any, backgroundColor: "#10B981" }} />
      </View>
      <View style={{ paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            <Text style={{ color: "white", fontWeight: "700", fontSize: 15, letterSpacing: -0.3 }}>{(pending.product.name?.[0] ?? "•").toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 16, color: "#0F172A", letterSpacing: -0.4, lineHeight: 20 }} numberOfLines={1}>{pending.product.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
              <View style={{ backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 10, fontWeight: "700", color: "#065F46", letterSpacing: 0.2 }}>{pending.product.sku}</Text></View>
              <Text style={{ fontSize: 12, color: "#6B7280", fontWeight: "500" }}>{pendingMaxQ} {pending.unitName} disponib · {pendingLine ? fmt(pendingLine.unitPrice) : 0} HTG{pending.variant !== "Regular" ? ` · ${pending.variant}` : ""}</Text>
            </View>
          </View>
          <View style={{ backgroundColor: "#16130c", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", minWidth: 96 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" }} />
              <Text style={{ color: "white", fontWeight: "800", fontSize: 13, letterSpacing: -0.2, textAlign: "right", ...monoStyle }}>{fmt((pendingLine ? pendingLine.lineTotal : 0))} HTG</Text>
            </View>
            <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "600", fontSize: 11, marginTop: 1, textAlign: "right", ...monoStyle }}>{pending.qty} {pending.unitName} × {pendingLine ? fmt(pendingLine.unitPrice) : 0}{pendingLine?.bundleApplied ? " · Bundle ✓" : ""}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 3 }}>
            <Pressable onPress={() => onAdjust(-1)} hitSlop={10} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "500", fontSize: 20, color: "#0F172A", lineHeight: 20 }}>−</Text></Pressable>
            <View style={{ width: 62, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
              <TextInput
                placeholder={String(pending.qty)}
                placeholderTextColor="#0F172A"
                value={pendingInput}
                onChangeText={onCustom}
                onBlur={onBlurClear}
                keyboardType="numeric"
                selectTextOnFocus
                style={{ fontWeight: "800", fontSize: 18, textAlign: "center", color: "#0F172A", minWidth: 48, paddingVertical: 0, letterSpacing: -0.3 }}
              />
              <Text style={{ fontSize: 9, color: "#94A3B8", fontWeight: "700", marginTop: -1, letterSpacing: 0.6 }}>QTÉ</Text>
            </View>
            <Pressable onPress={() => onAdjust(1)} hitSlop={10} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", shadowColor: "#0F172A", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}><Text style={{ color: "white", fontWeight: "700", fontSize: 18, lineHeight: 20 }}>+</Text></Pressable>
          </View>
          <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: "#10B981", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#10B981", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}>
            <Text style={{ color: "white", fontWeight: "800", fontSize: 14, letterSpacing: -0.2 }}>Ajoute • {pending.qty} {pending.unitName}</Text>
            <Text style={{ color: "rgba(255,255,255,0.86)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <Pressable onPress={onCancel} hitSlop={10} style={{ paddingVertical: 6, paddingRight: 14 }}><Text style={{ color: "#64748B", fontWeight: "600", fontSize: 13, letterSpacing: -0.1 }}>Anile</Text></Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981", opacity: pending.remaining <= 3 ? 0.45 : 0.95 }} />
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600", letterSpacing: -0.1 }}>Oto nan {pending.remaining}s</Text>
            <View style={{ width: 1, height: 10, backgroundColor: "#E2E8F0", marginHorizontal: 1 }} />
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "500" }}>Tape ankò +1</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ---- Single product row (same visuals phone + tablet; flex differs) ----
export function ProductCard(props: {
  item: Product;
  inCartQty: number;
  displayPrice: string;
  pendingActive: boolean;
  flex?: number;
  onPress: () => void;
}) {
  const { item, inCartQty, displayPrice, pendingActive, flex, onPress } = props;
  const isTop = (item.sales_count ?? 0) >= 90;
  const isOut = item.stock_quantity <= 0;
  const isAlmost = !isOut && item.stock_quantity <= 5;
  const stockStatus = isOut
    ? { dot: "#EF4444", text: "#991B1B", badgeBg: "#FEF2F2", badgeBd: "#FECACA", label: "Ruptur" }
    : isAlmost
    ? { dot: "#F59E0B", text: "#92400E", badgeBg: "#FFFBEB", badgeBd: "#FDE68A", label: "Preske fini" }
    : { dot: "#22C55E", text: "#065F46", badgeBg: "#F0FDF4", badgeBd: "#BBF7D0", label: "Disponib" };
  const borderColor = isTop ? "#BBF7D0" : isOut ? "#FECACA" : isAlmost ? "#FDE68A" : "#E2E8F0";
  return (
    <Pressable onPress={onPress} style={{ flex: flex as any, padding: 14, backgroundColor: "white", borderRadius: 24, marginBottom: 2, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor, shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, opacity: isOut ? 0.62 : pendingActive ? 0.92 : 1 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isTop && <View style={{ backgroundColor: "#dcfce7", borderWidth: 1, borderColor: "#86efac", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 10, color: "#166534", fontWeight: "800", letterSpacing: 0.3 }}>★ TOP</Text></View>}
          <Text style={{ fontWeight: "800", fontSize: 14, color: "#0f172a" }} numberOfLines={1}>{item.name}</Text>
          {inCartQty > 0 && <View style={{ backgroundColor: "#0f172a", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "white", fontWeight: "800" }}>×{inCartQty} nan panyen</Text></View>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
          <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600" }}>{item.sku}</Text>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: stockStatus.dot }} />
          <Text style={{ color: stockStatus.text, fontSize: 11, fontWeight: "600" }}>{item.stock_quantity} nan stòk · {stockStatus.label}</Text>
          {isOut ? (
            <View style={{ backgroundColor: stockStatus.badgeBg, borderWidth: 1, borderColor: stockStatus.badgeBd, borderRadius: 24, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 10, color: stockStatus.text, fontWeight: "700" }}>EPUIZE</Text></View>
          ) : isAlmost ? (
            <View style={{ backgroundColor: stockStatus.badgeBg, borderWidth: 1, borderColor: stockStatus.badgeBd, borderRadius: 24, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 10, color: stockStatus.text, fontWeight: "700" }}>FÈB</Text></View>
          ) : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={{ fontWeight: "900", color: "#0f172a", fontSize: 14, textAlign: "right", ...monoStyle }}>{displayPrice}</Text>
        <View style={{ backgroundColor: isOut ? "#FEF2F2" : isAlmost ? "#FFFBEB" : "#f0fdf4", borderWidth: 1, borderColor: isOut ? "#FECACA" : isAlmost ? "#FDE68A" : "#bbf7d0", borderRadius: 24, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 11, color: isOut ? "#991B1B" : isAlmost ? "#92400E" : "#15803d", fontWeight: "700" }}>{isOut ? "Epuize" : "+ Tape"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ProductsEmpty() {
  return (
    <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 24, padding: 20, alignItems: "center", marginTop: 16 }}><Text style={{ color: "#94a3b8", fontWeight: "600", fontSize: 12 }}>Pa gen pwodwi</Text><Text style={{ color: "#cbd5e1", fontSize: 11, marginTop: 4 }}>Eseye yon lòt rechèch</Text></View>
  );
}

// ---- One cart line (tablet panel + phone cart sheet share this markup) ----
export function CartLineRow(props: {
  item: CartItem;
  editingQtyId: string | null;
  editingQtyVal: string;
  onDec: () => void;
  onInc: () => void;
  onRemove: () => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditBlur: () => void;
}) {
  const { item: c, editingQtyId, editingQtyVal, onDec, onInc, onRemove, onEditStart, onEditChange, onEditBlur } = props;
  return (
    <View style={{ backgroundColor: "#fafafa", borderRadius: 18, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#f0f0f3" }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Text style={{ flex: 1, fontWeight: "700", fontSize: 14, color: "#0f172a" }} numberOfLines={1}>
          {c.name}{c.variant !== "Regular" ? ` · ${c.variant}` : ""}{c.bundleApplied ? " · Bundle ✓" : ""}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#fee2e2", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#dc2626", fontWeight: "900", fontSize: 11 }}>✕</Text></Pressable>
      </View>
      <View style={{ flexDirection: "row", marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", letterSpacing: 1.1, color: "#9ca3af" }}>PRI</Text>
          <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "800", fontSize: 13, color: "#0f172a" }}>{fmt(c.unitPrice)}</Text>
          <Text style={{ fontSize: 9, color: "#9ca3af", fontWeight: "600" }}>HTG / {c.unitName}</Text>
        </View>
        <View style={{ alignItems: "center", marginHorizontal: 6 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", letterSpacing: 1.1, color: "#9ca3af" }}>QTÉ</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
            <Pressable onPress={onDec} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "900", fontSize: 15, color: "#334155" }}>−</Text></Pressable>
            {editingQtyId === c.key ? (
              <TextInput placeholder={String(c.qty)} placeholderTextColor="#334155" value={editingQtyVal} onChangeText={onEditChange} onBlur={onEditBlur} onSubmitEditing={onEditBlur} keyboardType="numeric" autoFocus style={{ width: 52, textAlign: "center", borderWidth: 1, borderColor: "#22c55e", borderRadius: 8, padding: 6, fontWeight: "800", backgroundColor: "white", color: "#0f172a" }} />
            ) : (
              <Pressable onPress={onEditStart} style={{ width: 52, height: 32, borderRadius: 8, backgroundColor: "white", borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "900", ...monoStyle, fontSize: 13 }}>{c.qty}</Text>
              </Pressable>
            )}
            <Pressable onPress={onInc} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "900", fontSize: 15 }}>+</Text></Pressable>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 9, fontWeight: "800", letterSpacing: 1.1, color: "#9ca3af" }}>SOU-TOTAL</Text>
          <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "900", fontSize: 14, color: "#16130c" }}>{fmt(c.lineTotal)} HTG</Text>
        </View>
      </View>
    </View>
  );
}

// ---- Sou-total row (same on tablet panel + phone sheet) ----
export function CartTotalsBar(props: { subtotal: number }) {
  return (
    <View style={{ marginTop: 12, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", backgroundColor: "#efe7d2", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text style={{ color: "#64748b", fontWeight: "700", fontSize: 13 }}>Sou-total</Text>
      <Text style={{ color: "#16130c", fontWeight: "900", fontSize: 16, ...monoStyle }}>{fmt(props.subtotal)} HTG</Text>
    </View>
  );
}

// ---- Vide-tout / resumed-tab + Kite l Ouvè row (identical phone sheet + tablet panel) ----
export function SuspendRow(props: {
  resumedTabId: string | null;
  resumedTabLabel: string;
  onClear: () => void;
  onSuspendOrUpdate: () => void;
}) {
  const { resumedTabId, resumedTabLabel, onClear, onSuspendOrUpdate } = props;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      {resumedTabId ? (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 20 }}>
          <Ionicons name="bookmark" size={13} color="#B45309" />
          <Text numberOfLines={1} style={{ flex: 1, color: "#92400E", fontWeight: "800", fontSize: 12 }}>{resumedTabLabel}</Text>
        </View>
      ) : (
        <Pressable onPress={onClear} accessibilityLabel="Vide panyen" style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#FFF1F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 20 }}>
          <Ionicons name="trash-outline" size={13} color="#dc2626" />
          <Text style={{ color: "#dc2626", fontWeight: "700", fontSize: 12 }}>Vide tout</Text>
        </Pressable>
      )}
      <Pressable onPress={onSuspendOrUpdate} accessibilityLabel={resumedTabId ? "Mete ajou nan tab la" : "Kite l ouvè"} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#1E293B" }}>
        {resumedTabId ? <Ionicons name="add-circle-outline" size={14} color="#C8A24A" /> : <Ionicons name="pause-circle-outline" size={13} color="#C8A24A" />}
        <Text style={{ color: "white", fontWeight: "800", fontSize: 12 }}>{resumedTabId ? "Mete Ajou" : "Kite l Ouvè"}</Text>
      </Pressable>
    </View>
  );
}

// ---- Green Peye CTA (identical phone sheet + tablet panel) ----
export function PayCTA(props: { payPulse: Animated.Value; subtotal: number; onPay: () => void }) {
  const { payPulse, subtotal, onPay } = props;
  return (
    <Animated.View style={{ marginTop: 8, transform: [{ scale: payPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
      <Pressable onPress={onPay} style={{ backgroundColor: "#10B981", borderRadius: 26, paddingVertical: 17, paddingHorizontal: 18, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10, shadowColor: "#10B981", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14, borderWidth: 1, borderColor: "#34d399" }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="checkmark" size={18} color="#fff" />
        </View>
        <Text style={{ color: "white", fontWeight: "900", fontSize: 17, letterSpacing: 0.4 }}>{ht.pay}</Text>
        <View style={{ flex: 1 }} />
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "#059669", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </View>
      </Pressable>
    </Animated.View>
  );
}
