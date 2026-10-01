import React from "react";
import { View, Text, Pressable, TextInput, Animated } from "react-native";
import { palette, radius, shadow } from "../theme";
import { ht } from "../i18n";
import { fmtG, fmt, monoStyle } from "../format";
import { formatCheckoutRow } from "../catalogModel";
import { PROD_DARK, type Product, type SaleRow, type PendingState, type PriceLine, type SearchMode } from "../screens/POSShared";

// ---- Tablet-set picker components: shared by checkout-tablet (POSTablet) and
// the Orders in-screen item picker. One edit here updates both screens. ----

// ---- Tablet-only category model (mirrors web CATEGORIES + catFor; filtered locally so the shell is untouched) ----
export const TABLET_CATS = [
  { id: "all", label: "Tout" },
  { id: "food", label: "Manje" },
  { id: "drinks", label: "Bwason" },
  { id: "household", label: "Kay" },
  { id: "dairy", label: "Letye" },
];

export function tabletCatFor(p: Product): string {
  const n = (p.name ?? "").toLowerCase();
  if (n.includes("beer") || n.includes("cola") || n.includes("water") || n.includes("dlo") || n.includes("kola") || n.includes("prestige")) return "drinks";
  if (n.includes("soap") || n.includes("savon") || n.includes("detergent") || n.includes("colgate")) return "household";
  if (n.includes("milk") || n.includes("lèt") || n.includes("coffee") || n.includes("kafe")) return "dairy";
  return "food";
}

// ---- Tablet search card: white radius-20 card with field + mode pills + category chips ----
export function TabletSearchCard(props: {
  entrance: Animated.Value;
  search: string;
  searchMode: SearchMode;
  cat: string;
  onSearchChange: (v: string) => void;
  onSearchModeChange: (m: SearchMode) => void;
  onBarcodeSubmit: () => void;
  onOpenScanner: () => void;
  onCatChange: (id: string) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const { entrance, search, searchMode, cat, onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner, onCatChange, visibleCount, totalCount } = props;
  return (
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
              onPress={() => onCatChange(c.id)}
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
        <Text style={{ marginLeft: "auto", fontSize: 11, color: palette.muted2 }}>{visibleCount} varyant • {totalCount} total</Text>
      </View>
    </Animated.View>
  );
}

// ---- Tablet pending hero (local variant: shared PendingCard is phone-row styled;
// this mirrors the web hero — 3px green bar, dark tile, dark qty box, pill stepper, green CTA) ----
export function TabletPendingHero(props: {
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
          <Text style={{ fontWeight: "800", fontSize: 15, color: PROD_DARK.ink, letterSpacing: -0.2 }} numberOfLines={1}>{formatCheckoutRow(pending.unitName, pending.product.name, pending.variant)}</Text>
          <Text style={{ fontSize: 12, color: PROD_DARK.muted, marginTop: 2 }} numberOfLines={1}>
            {pending.product.sku ?? ""} • {pendingMaxQ} disponib • {fmtG(unitPrice)}
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
export function TabletProductCard(props: {
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
  const title = formatCheckoutRow(row.unitName, item.name, row.variant);
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
