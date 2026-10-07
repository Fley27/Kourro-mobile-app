import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, Animated } from "react-native";
import { ht } from "../i18n";
import { fmtG, fmt, monoStyle } from "../format";
import { formatCheckoutRow } from "../catalogModel";
import { useResponsive } from "../responsive";
import { PROD_DARK, type PendingState, type PriceLine, type SearchMode } from "../screens/POSShared";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

// ---- Phone-set picker components: shared by checkout-phone (POSPhone) and
// the Orders in-screen item picker. One edit here updates both screens. ----

// ---- Search mode segmented tabs (identical on phone + tablet) ----
export function SearchModeBar(props: { searchMode: SearchMode; onChange: (m: SearchMode) => void }) {
  const { searchMode, onChange } = props;
  return (
    <KeyboardSafeScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ backgroundColor: "#efe7d2", borderRadius: 14, padding: 3, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)" }}>
      {([["name", "Nom"], ["barcode", "Bakod"], ["category", "Kategori"]] as [SearchMode, string][]).map(([mode, label]) => (
        <Pressable key={mode} onPress={() => { onChange(mode); }} style={{ minWidth: 78, backgroundColor: searchMode === mode ? "white" : "transparent", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center", shadowColor: "#000", shadowOpacity: searchMode === mode ? 0.08 : 0, shadowRadius: 4, elevation: searchMode === mode ? 2 : 0 }}>
          <Text style={{ color: searchMode === mode ? "#16130c" : "#6b7280", fontSize: 12, fontWeight: searchMode === mode ? "700" : "600" }}>{label}</Text>
        </Pressable>
      ))}
    </KeyboardSafeScrollView>
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
  void width;
  const outerStyle =
    variant === "phone"
      ? { width: "100%" as const, paddingHorizontal: padH, paddingTop: 14, paddingBottom: 12, backgroundColor: "transparent", opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }
      : { paddingHorizontal: padH, paddingTop: 14, paddingBottom: 12, backgroundColor: "transparent", opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] };
  return (
    <Animated.View style={outerStyle as any}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1, height: 52, flexDirection: "row", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, backgroundColor: "transparent", alignItems: "center", paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 16, color: "#fff", fontWeight: "600" }}>⌕</Text>
          <TextInput placeholder={ht.search} placeholderTextColor="#8e8e93" value={search} onChangeText={onSearchChange} onSubmitEditing={onBarcodeSubmit} returnKeyType="search" style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 9, fontSize: 15, color: "#fff" }} />
          {search.length > 0 && <Pressable onPress={() => onSearchChange("")} hitSlop={8} style={{ padding: 5 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "700" }}>✕</Text></Pressable>}
        </View>
        <Pressable accessibilityLabel="Scan QR" accessibilityHint="Eskane yon pwodwi" onPress={onOpenScanner} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#000", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.15)" }}>
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
  void width;
  void isTablet;
  const outerStyle =
    variant === "phone"
      ? { width: "100%" as const, marginTop: 12, backgroundColor: PROD_DARK.card, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: PROD_DARK.hair }
      : { marginHorizontal: 12, marginTop: 12, backgroundColor: PROD_DARK.card, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: PROD_DARK.hair };
  return (
    <View style={outerStyle as any}>
      <View style={{ height: 4, backgroundColor: PROD_DARK.green }} />
      <View style={{ height: 2, backgroundColor: "#1c1c1e" }}>
        <View style={{ height: 2, width: `${(pending.remaining / 10) * 100}%` as any, backgroundColor: PROD_DARK.green }} />
      </View>
      <View style={{ paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: PROD_DARK.avatar, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: PROD_DARK.avatarInk, fontWeight: "800", fontSize: 16 }}>{(pending.product.name?.[0] ?? "•").toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 16, color: PROD_DARK.ink, letterSpacing: -0.4, lineHeight: 20 }} numberOfLines={1}>{formatCheckoutRow(pending.unitName, pending.product.name, pending.variant)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
              <Text style={{ fontSize: 11, color: PROD_DARK.muted, fontWeight: "600" }}>{pending.product.sku}</Text>
              <Text style={{ fontSize: 12, color: PROD_DARK.muted, fontWeight: "500" }}>{pendingMaxQ} {pending.unitName} disponib · {pendingLine ? fmtG(pendingLine.unitPrice) : "G 0"}</Text>
            </View>
          </View>
          <View style={{ backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", minWidth: 96 }}>
            <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 13, letterSpacing: -0.2, textAlign: "right", ...monoStyle }}>{fmtG((pendingLine ? pendingLine.lineTotal : 0))}</Text>
            <Text style={{ color: "#52525b", fontWeight: "600", fontSize: 11, marginTop: 1, textAlign: "right", ...monoStyle }}>{pending.qty} {pending.unitName} × {pendingLine ? fmt(pendingLine.unitPrice) : 0}{pendingLine?.bundleApplied ? " · Bundle ✓" : ""}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#0a0a0a", borderRadius: 16, borderWidth: 1, borderColor: PROD_DARK.hair, padding: 3 }}>
            <Pressable onPress={() => onAdjust(-1)} hitSlop={10} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: PROD_DARK.tile, alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "500", fontSize: 20, color: "#fff", lineHeight: 20 }}>−</Text></Pressable>
            <View style={{ width: 62, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
              <TextInput
                placeholder={String(pending.qty)}
                placeholderTextColor="#fff"
                value={pendingInput}
                onChangeText={onCustom}
                onBlur={onBlurClear}
                keyboardType="numeric"
                selectTextOnFocus
                style={{ fontWeight: "800", fontSize: 18, textAlign: "center", color: "#fff", minWidth: 48, paddingVertical: 0, letterSpacing: -0.3 }}
              />
              <Text style={{ fontSize: 9, color: PROD_DARK.muted, fontWeight: "700", marginTop: -1, letterSpacing: 0.6 }}>QTÉ</Text>
            </View>
            <Pressable onPress={() => onAdjust(1)} hitSlop={10} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#16130c", fontWeight: "700", fontSize: 18, lineHeight: 20 }}>+</Text></Pressable>
          </View>
          <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: "rgba(251,191,36,0.07)", borderWidth: 1, borderColor: "rgba(251,191,36,0.55)", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#FBBF24", fontWeight: "800", fontSize: 14, letterSpacing: -0.2 }}>Ajoute • {pending.qty} {pending.unitName}</Text>
            <Text style={{ color: "rgba(251,191,36,0.65)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <Pressable onPress={onCancel} hitSlop={10} style={{ paddingVertical: 6, paddingRight: 14 }}><Text style={{ color: PROD_DARK.muted, fontWeight: "600", fontSize: 13, letterSpacing: -0.1 }}>Anile</Text></Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PROD_DARK.green, opacity: pending.remaining <= 3 ? 0.45 : 0.95 }} />
            <Text style={{ color: PROD_DARK.muted, fontSize: 11, fontWeight: "600", letterSpacing: -0.1 }}>Oto nan {pending.remaining}s</Text>
            <View style={{ width: 1, height: 10, backgroundColor: PROD_DARK.hair, marginHorizontal: 1 }} />
            <Text style={{ color: PROD_DARK.green, fontSize: 11, fontWeight: "500" }}>Tape ankò +1</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
