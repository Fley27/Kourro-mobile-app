import React, { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, Animated, FlatList } from "react-native";
import { blackPalette as palette, radius, shadow } from "../theme";
import { ht } from "../i18n";
import { fmtG, fmt, monoStyle } from "../format";
import { formatCheckoutRow } from "../catalogModel";
import { PROD_DARK, ProductsEmpty, type Product, type SaleRow, type PendingState, type PriceLine, type SearchMode } from "../screens/POSShared";
import { useResponsive } from "../responsive";
import { VariantGroupCard, groupCardColumns, GROUP_CARD_MIN_W, GROUP_CARD_GAP } from "./group";
import { PendingVeil } from "./PendingVeil";
import { groupSaleRows } from "./hooks";
import { SkeletonGroupStack } from "../components/Skeleton";

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

// ---- Tablet search card: dark radius-20 card with field + mode pills + category chips ----
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
        <Pressable accessibilityLabel="Scan QR" accessibilityHint="Eskane yon pwodwi" onPress={onOpenScanner} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", ...shadow.soft }}>
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
              <Text style={{ color: active ? "#000" : palette.ink, fontWeight: "700", fontSize: 11.5 }}>{m === "name" ? "Nom" : m === "barcode" ? "Bakod" : "Kategori"}</Text>
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
              <Text style={{ color: active ? "#000" : palette.ink, fontSize: 12.5, fontWeight: active ? "700" : "500" }}>{c.label}</Text>
            </Pressable>
          );
        })}
        <Text style={{ marginLeft: "auto", fontSize: 11, color: palette.muted2 }}>{visibleCount} pwodwi • {totalCount} varyant</Text>
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
        <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: "rgba(251,191,36,0.07)", borderWidth: 1, borderColor: "rgba(251,191,36,0.55)", borderRadius: 999, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#FBBF24", fontWeight: "800", fontSize: 13 }}>Ajoute • {pending.qty} {pending.unitName} • {pending.remaining}s</Text>
          <Text style={{ color: "rgba(251,191,36,0.65)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
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

// ---- Shared two-pane LEFT column: search card + pending hero + group grid.
// Extracted from POSTablet so checkout and the proforma builder render the
// exact same browse pane — one edit here updates both screens, and neither
// can drift. The caller owns the right pane (their flows differ). ----
export function TabletProductPane(props: {
  entrance: Animated.Value;
  search: string;
  searchMode: SearchMode;
  rows: SaleRow[];
  catNames: Record<string, string>;
  catalogLoaded: boolean;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
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
  onDecQty: (key: string) => void;
  inCartQtyFor: (row: SaleRow) => number;
}) {
  const { width, padH } = useResponsive();
  const {
    entrance, search, searchMode, rows, catNames, catalogLoaded, pending, pendingInput, pendingLine, pendingMaxQ,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress, onDecQty, inCartQtyFor,
  } = props;
  const [cat, setCat] = useState("all");
  const visibleRows = useMemo(() => (cat === "all" ? rows : rows.filter(r => tabletCatFor(r.product) === cat)), [rows, cat]);
  const groups = useMemo(() => groupSaleRows(visibleRows, catNames), [visibleRows, catNames]);
  const pendingActiveFor = (row: SaleRow) => !!pending && pending.product.id === row.product.id && pending.unitId === row.unitId && pending.variant === row.variant;

  // Product-grid column count follows the pane's real width, not the device
  // class: cards never drop below GROUP_CARD_MIN_W, so the article name in the
  // header always has room. onLayout is the source of truth; until it lands we
  // estimate the left pane (products flex 3, cart flex 2 with a 300pt floor).
  const [measuredListW, setMeasuredListW] = useState(0);
  const paneAvail = width - padH * 2 - 12;
  const listW = measuredListW || paneAvail - Math.max(300, paneAvail * (2 / 5));
  const cardCols = groupCardColumns(listW);
  const cardMinW = listW >= GROUP_CARD_MIN_W ? GROUP_CARD_MIN_W : undefined;

  return (
    <View style={{ flex: 3, minWidth: 0, gap: 12 }}>
      {/* Search card — mirrors web search card: dark radius-20 card, field + mode + category tinted rows */}
      <TabletSearchCard
        entrance={entrance}
        search={search}
        searchMode={searchMode}
        cat={cat}
        onSearchChange={onSearchChange}
        onSearchModeChange={onSearchModeChange}
        onBarcodeSubmit={onBarcodeSubmit}
        onOpenScanner={onOpenScanner}
        onCatChange={setCat}
        visibleCount={groups.length}
        totalCount={visibleRows.length}
      />

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
      {/* List + focus veil: pending item blurs/dims the list (WhatsApp
          long-press style) and blocks other selections. */}
      <View style={{ flex: 1 }} onLayout={e => setMeasuredListW(e.nativeEvent.layout.width)}>
        <FlatList
          style={{ flex: 1 }}
          data={groups}
          keyExtractor={g => g.product.id}
          key={`group-grid-${cardCols}`}
          numColumns={cardCols}
          // RN hard-throws when a single-column list gets a wrapper
          // style — a pane below GROUP_CARD_MIN_W legitimately renders
          // one column (portrait / split-view), so the gap wrapper only
          // exists when there's actually a row to space.
          columnWrapperStyle={cardCols > 1 ? { gap: GROUP_CARD_GAP } : undefined}
          contentContainerStyle={{ gap: GROUP_CARD_GAP, paddingTop: 2, paddingBottom: 12 }}
          ListHeaderComponent={
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <Text style={{ color: "#71717a", fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>PWODWI DISPONIB</Text>
              <Text style={{ color: "#8e8e93", fontSize: 11.5, fontWeight: "700", letterSpacing: 0.4 }}>{groups.length} PWODWI</Text>
            </View>
          }
          renderItem={({ item }) => (
            <VariantGroupCard
              group={item}
              inCartQtyFor={inCartQtyFor}
              pendingActiveFor={pendingActiveFor}
              flex={1}
              minWidth={cardMinW}
              onRowPress={onProductPress}
              onDecQty={onDecQty}
            />
          )}
          ListEmptyComponent={catalogLoaded ? <ProductsEmpty /> : <SkeletonGroupStack gap={10} />}
        />
        {pending ? <PendingVeil /> : null}
      </View>
    </View>
  );
}
