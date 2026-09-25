import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, shadow } from "../theme";
import { fmtG, fmt, monoStyle } from "../format";
import { formatSaleLine } from "../catalogModel";
import { ht } from "../i18n";
import { useResponsive, centerBox } from "../responsive";

// ---- Shared types (moved verbatim from POSScreen) ----
export type Product = { id: string; name: string; name_ht?: string; barcode?: string; sku?: string; category_id?: string; item_type?: "goods" | "service"; is_available?: number | boolean; stock_quantity: number; cost_price: number; sales_count?: number; selling_price?: number; unit?: string };
export type CartItem = Product & { key: string; qty: number; unitId: string; unitName: string; factor: number; variant: string; unitPrice: number; lineTotal: number; bundleApplied: boolean; frozenBase?: number };
export type PendingSel = { unitId: string; unitName: string; factor: number; variant: string };
export type SuspendedTab = { id: string; store_id?: string; label: string; customer_id?: string | null; cashier_id?: string | null; cashier_name?: string | null; seller_role?: string | null; status?: string; total?: number; completed_sale_id?: string | null; device_id?: string | null; created_at?: string; updated_at?: string };
export type SearchMode = "name" | "barcode" | "category";
export type CartView = "cart" | "menu" | "customers" | "newCustomer" | "custDetail" | "custProfile" | "custEdit" | "txnDetail";
export type CustomerFlow = {
  view: CartView;
  setView: (v: CartView) => void;
  search: string;
  setSearch: (v: string) => void;
  results: any[];
  showDebtOnly?: boolean;
  onToggleDebtOnly?: () => void;  selectedName: string | null;
  onPickCustomer: (c: any) => void;
  onClearCustomer: () => void;
  onOpenNewCustomer: () => void;
  formKey: number;
  formValid: boolean;
  onFormState: (data: any, valid: boolean) => void;
  onSaveCustomer: () => void;
  onOpenDetail: () => void;
  onOpenEdit: () => void;
  onSaveEdit: () => void;
  editFormKey: number;
  editInitial: any;
  editFormValid: boolean;
  onEditFormState: (data: any, valid: boolean) => void;
  selectedCustomer: any | null;
  stats: { visits: number; spent: number; lastVisit: string | null; firstVisit: string | null };
  notes: any[];
  transactions: any[];
  onOpenTransaction: (sale: any) => void;
  txnDetail: { sale: any; items: any[]; credit?: any | null; payments?: any[] } | null;
  txnDue: number;
  txnPaid: number;
  onTxnPayPress?: () => void;
  onNewReceipt: () => void;
  lastVisitItems: any[];
  onAddItem: (item: any) => void;
  noteInput: string;
  setNoteInput: (v: string) => void;
  savingNote: boolean;
  onAddNote: () => void;
  onRemoveCustomer: () => void;
};
export type PaymentMethod = "cash" | "mobile" | "credit";
export type PendingState = { product: Product; qty: number; remaining: number } & PendingSel;
export type PriceLine = { unitPrice: number; lineTotal: number; bundleApplied: boolean };

// ---- Search mode segmented tabs (identical on phone + tablet) ----
export function SearchModeBar(props: { searchMode: SearchMode; onChange: (m: SearchMode) => void }) {
  const { searchMode, onChange } = props;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ backgroundColor: "#efe7d2", borderRadius: 14, padding: 3, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)" }}>
      {([["name", "Nom"], ["barcode", "Bakod"], ["category", "Kategori"]] as [SearchMode, string][]).map(([mode, label]) => (
        <Pressable key={mode} onPress={() => { onChange(mode); }} style={{ minWidth: 78, backgroundColor: searchMode === mode ? "white" : "transparent", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center", shadowColor: "#000", shadowOpacity: searchMode === mode ? 0.08 : 0, shadowRadius: 4, elevation: searchMode === mode ? 2 : 0 }}>
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
            <Text style={{ fontWeight: "800", fontSize: 16, color: PROD_DARK.ink, letterSpacing: -0.4, lineHeight: 20 }} numberOfLines={1}>{pending.product.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
              <Text style={{ fontSize: 11, color: PROD_DARK.muted, fontWeight: "600" }}>{pending.product.sku}</Text>
              <Text style={{ fontSize: 12, color: PROD_DARK.muted, fontWeight: "500" }}>{pendingMaxQ} {pending.unitName} disponib · {pendingLine ? fmtG(pendingLine.unitPrice) : "G 0"}{pending.variant !== "Regular" ? ` · ${pending.variant}` : ""}</Text>
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
          <Pressable onPress={onCommit} style={{ flex: 1, backgroundColor: PROD_DARK.green, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#052e16", fontWeight: "800", fontSize: 14, letterSpacing: -0.2 }}>Ajoute • {pending.qty} {pending.unitName}</Text>
            <Text style={{ color: "rgba(5,46,22,0.7)", fontWeight: "600", fontSize: 11, marginTop: 1 }}>Tape pou konfime</Text>
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

// ---- Shared dark product theme (single edit point for phone + tablet) ----
export const PROD_DARK = {
  card: "#141414",
  hair: "#2b2b2b",
  ink: "#fff",
  muted: "#8e8e93",
  green: "#4ade80",
  greenBd: "rgba(74,222,128,0.45)",
  avatar: "#C8A24A",
  avatarInk: "#16130c",
  select: "#3b82f6",
  tile: "#2b2b2b",
  amber: "#F59E0B",
  amberBg: "rgba(245,158,11,0.16)",
};
// ---- One sellable variant row: the sales list shows variants (product ×
// unit × variant + its price), never bare products. Key matches cartKey so
// in-cart quantities light up per row. ----
export type SaleRow = {
  key: string;
  product: Product;
  unitId: string;
  unitName: string;
  factor: number;
  variant: string;
  price: number;
  maxQ: number;
  variantCountForItem: number;
  isTop: boolean;
};

export function VariantCard(props: {
  row: SaleRow;
  inCartQty: number;
  pendingActive: boolean;
  flex?: number;
  onPress: () => void;
}) {
  const { row, inCartQty, pendingActive, flex, onPress } = props;
  const item = row.product;
  // Services carry no stock: availability toggle is the only signal — never
  // flag them red for stock 0, and always let them sell when available.
  const isSvc = item.item_type === "service";
  const svcAvail = !isSvc || (item.is_available !== 0 && (item.is_available as any) !== false);
  const isOut = !isSvc && row.maxQ <= 0;
  const isAlmost = !isSvc && !isOut && row.maxQ <= 5;
  const stockText = isSvc ? "#4ade80" : isOut ? "#F87171" : isAlmost ? "#FBBF24" : "#4ade80";
  const stockLabel = isSvc ? (svcAvail ? "Disponib" : "Koupe") : isOut ? "Ruptur" : isAlmost ? "Preske fini" : "Disponib";
  const borderColor = pendingActive ? PROD_DARK.select : isOut ? "#7f1d1d" : isAlmost ? "rgba(245,158,11,0.5)" : PROD_DARK.hair;
  const dimmed = isSvc ? !svcAvail : isOut;
  const title = formatSaleLine(item.name, row.variant, row.unitName, row.variantCountForItem);
  return (
    <Pressable onPress={onPress} style={{ flex: flex as any, padding: 14, backgroundColor: PROD_DARK.card, borderRadius: 18, marginBottom: 2, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: pendingActive ? 2 : 1, borderColor, opacity: dimmed ? 0.62 : 1 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {row.isTop && <View style={{ borderWidth: 1, borderColor: PROD_DARK.avatar, borderRadius: 24, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 10, color: PROD_DARK.avatar, fontWeight: "800", letterSpacing: 0.3 }}>★ TOP</Text></View>}
          <Text style={{ fontWeight: "800", fontSize: 15, color: PROD_DARK.ink }} numberOfLines={1}>{title}</Text>
          {inCartQty > 0 && <View style={{ backgroundColor: "#fff", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ fontSize: 11, color: "#16130c", fontWeight: "800" }}>×{inCartQty} nan panyen</Text></View>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 }}>
          <Text style={{ color: PROD_DARK.muted, fontSize: 11, fontWeight: "600" }}>{item.sku}</Text>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: stockText }} />
          <Text style={{ color: PROD_DARK.muted, fontSize: 11, fontWeight: "600" }}>{isSvc ? stockLabel : `${row.maxQ} ${row.unitName} nan stòk · ${stockLabel}`}</Text>
          {isAlmost ? (
            <View style={{ backgroundColor: PROD_DARK.amberBg, borderWidth: 1, borderColor: "rgba(245,158,11,0.5)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ fontSize: 10, color: PROD_DARK.amber, fontWeight: "800" }}>FÈB</Text></View>
          ) : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Text style={{ fontWeight: "900", color: PROD_DARK.ink, fontSize: 15, textAlign: "right", ...monoStyle }}>{fmtG(row.price)}</Text>
        <View style={{ borderWidth: 1, borderColor: isOut ? "#7f1d1d" : PROD_DARK.greenBd, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 5, opacity: dimmed ? 0.6 : 1 }}>
          <Text style={{ fontSize: 12, color: isOut ? "#F87171" : PROD_DARK.green, fontWeight: "800" }}>{isOut ? "Epuize" : "+ Tape"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ProductsEmpty() {
  return (
    <View style={{ backgroundColor: PROD_DARK.card, borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 18, padding: 20, alignItems: "center", marginTop: 16 }}><Text style={{ color: PROD_DARK.muted, fontWeight: "600", fontSize: 12 }}>Pa gen pwodwi</Text><Text style={{ color: "#52525b", fontSize: 11, marginTop: 4 }}>Eseye yon lòt rechèch</Text></View>
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
    <View style={{ backgroundColor: "#141414", borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#2b2b2b" }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontWeight: "700", fontSize: 15, color: "#fff" }} numberOfLines={1}>
          {c.name}{c.variant !== "Regular" ? ` · ${c.variant}` : ""}{c.bundleApplied ? " · Bundle ✓" : ""}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#f87171", fontWeight: "900", fontSize: 13 }}>✕</Text></Pressable>
      </View>
      <View style={{ flexDirection: "row", marginTop: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>PRI</Text>
          <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "800", fontSize: 16, color: "#fff" }}>{fmt(c.unitPrice)}</Text>
          <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "600" }}>G / {c.unitName}</Text>
        </View>
        <View style={{ alignItems: "center", marginHorizontal: 6 }}>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>QTÉ</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
            <Pressable onPress={onDec} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "900", fontSize: 16, color: "#fff" }}>−</Text></Pressable>
            {editingQtyId === c.key ? (
              <TextInput placeholder={String(c.qty)} placeholderTextColor="#fff" value={editingQtyVal} onChangeText={onEditChange} onBlur={onEditBlur} onSubmitEditing={onEditBlur} keyboardType="numeric" autoFocus style={{ width: 52, textAlign: "center", borderWidth: 1, borderColor: PROD_DARK.green, borderRadius: 8, padding: 6, fontWeight: "800", backgroundColor: "#0a0a0a", color: "#fff", fontSize: 15 }} />
            ) : (
              <Pressable onPress={onEditStart} style={{ width: 52, height: 34, borderRadius: 8, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "900", ...monoStyle, fontSize: 15, color: "#fff" }}>{c.qty}</Text>
              </Pressable>
            )}
            <Pressable onPress={onInc} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2f80ed", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>+</Text></Pressable>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1, color: "#8e8e93" }}>SOU-TOTAL</Text>
          <Text style={{ marginTop: 3, ...monoStyle, fontWeight: "900", fontSize: 15, color: "#fff" }}>{fmtG(c.lineTotal)}</Text>
        </View>
      </View>
    </View>
  );
}

// ---- SuspendRow: Vide-tout / resumed-tab + Kite l Ouvè row (identical phone sheet + tablet panel) ----

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

// ---- Green Touche CTA (identical phone sheet + tablet panel) ----
export function PayCTA(props: { payPulse: Animated.Value; subtotal: number; onPay: () => void }) {
  const { payPulse, subtotal, onPay } = props;
  return (
    <Animated.View style={{ marginTop: 8, transform: [{ scale: payPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
      <Pressable onPress={onPay} style={{ backgroundColor: "#2f80ed", borderRadius: 16, paddingVertical: 18, alignItems: "center", shadowColor: "#2f80ed", shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14 }}>
        <Text style={{ color: "white", fontWeight: "900", fontSize: 17, letterSpacing: 0.2 }}>Touche</Text>
      </Pressable>
    </Animated.View>
  );
}

// ---- Cart totals summary (Subtotal / Discount / Total) ----
export function CartSummary({ subtotal, discount = 0 }: { subtotal: number; discount?: number }) {
  const total = Math.max(0, subtotal - discount);
  return (
    <View style={{ backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 18, padding: 16, marginTop: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 14, color: "#8e8e93", fontWeight: "600" }}>Subtotal</Text>
        <Text style={{ fontSize: 14, fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(subtotal)}</Text>
      </View>
      {discount > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <Text style={{ fontSize: 14, color: "#8e8e93", fontWeight: "600" }}>Discount</Text>
          <Text style={{ fontSize: 14, fontWeight: "800", color: "#f87171", ...monoStyle }}>− {fmtG(discount)}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>Total</Text>
        <Text style={{ fontSize: 17, fontWeight: "900", color: "#2f80ed", ...monoStyle }}>{fmtG(total)}</Text>
      </View>
    </View>
  );
}
