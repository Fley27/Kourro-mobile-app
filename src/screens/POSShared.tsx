import React from "react";
import { View, Text, TextInput, Pressable, Animated, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, fmt, monoStyle } from "../format";
import { formatCheckoutRow } from "../catalogModel";
import { useResponsive } from "../responsive";
import { blackPalette as palette, radius } from "../theme";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

// ---- Cross-device primitives + types (device sets live in ../picker/phone
// and ../picker/tablet; cart/total/empty markup is identical on both) ----
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
  /** Units sold in the last 30 days for this exact (unit, variant). */
  salesQty: number;
};

// ---- One product group for the checkout list: the product identity stated
// once in the header, its sellable variants as sub-rows underneath. ----
export type SaleGroup = {
  product: Product;
  categoryName: string;
  rows: SaleRow[];
  variantCount: number;
  /** Row key of the best-selling variant in the group (30-day trend), null if none. */
  bestKey: string | null;
};

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
          {formatCheckoutRow(c.unitName, c.name, c.variant)}{c.bundleApplied ? " · Bundle ✓" : ""}
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

// ---- Cart total bar (Total + gold CTA) — matches the order board's bottom bar ----
export function CartTotalBar(props: {
  payPulse: Animated.Value;
  subtotal: number;
  discount?: number;
  onPay: () => void;
  label?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const { payPulse, subtotal, discount = 0, onPay, label, icon } = props;
  const total = Math.max(0, subtotal - discount);
  return (
    <View style={{ marginTop: 10, backgroundColor: "#131316", borderWidth: 1, borderColor: "#232326", borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontSize: 13, color: "#8e8e93", fontWeight: "600" }}>Total</Text>
        <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 24, marginTop: 2, ...monoStyle }}>{fmtG(total)}</Text>
        {discount > 0 ? (
          <Text style={{ fontSize: 12, color: "#f87171", fontWeight: "700", marginTop: 2, ...monoStyle }}>− {fmtG(discount)}</Text>
        ) : null}
      </View>
      <Animated.View style={{ transform: [{ scale: payPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}>
        <Pressable onPress={onPay} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0B429", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 16 }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#1a1200", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={icon ?? "card-outline"} size={16} color="#F0B429" />
          </View>
          <Text style={{ color: "#1a1200", fontWeight: "900", fontSize: 16 }}>{label ?? "Touche"}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ---- Floating cart pill (identical phone checkout + Orders picker) ----
export function CartPill(props: { qty: number; subtotal: number; onPress: () => void }) {
  const { qty, subtotal, onPress } = props;
  const { isTablet } = useResponsive();
  return (
    <Pressable onPress={onPress} accessibilityLabel="Open cart" style={{ width: "100%", maxWidth: isTablet ? 520 : 390, minHeight: 58, flexDirection: "row", alignItems: "center", backgroundColor: "#F4F1EA", borderRadius: 22, paddingVertical: 9, paddingHorizontal: 12, gap: 11, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 10 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#E5E1D5", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontWeight: "900", color: "#16130c", fontSize: 14 }}>{qty}</Text>
      </View>
      <View style={{ flex: 1, alignItems: "center", gap: 1 }}>
        <Text style={{ color: "#2f7d5b", fontWeight: "700", fontSize: 13 }} numberOfLines={1}>Tape pou ouvè</Text>
        <Text style={{ color: "#16130c", fontWeight: "900", fontSize: 17, ...monoStyle }} numberOfLines={1}>{fmtG(subtotal)}</Text>
      </View>
      <Text style={{ color: "#16130c", fontSize: 20, fontWeight: "700" }}>⌃</Text>
    </Pressable>
  );
}

// ---- Cart lines (identical phone sheet + tablet cart panel + Orders picker) ----
export function CartLinesList(props: {
  cart: CartItem[];
  editingQtyId: string | null;
  editingQtyVal: string;
  onDec: (key: string) => void;
  onInc: (key: string) => void;
  onRemove: (key: string) => void;
  onEditStart: (key: string) => void;
  onEditChange: (key: string, v: string) => void;
  onEditBlur: () => void;
  style?: import("react-native").StyleProp<import("react-native").ViewStyle>;
}) {
  const { cart, editingQtyId, editingQtyVal, onDec, onInc, onRemove, onEditStart, onEditChange, onEditBlur, style } = props;
  return (
    <KeyboardSafeScrollView style={[{ flex: 1 }, style]} showsVerticalScrollIndicator={false}>
      {cart.map(c => (
        <CartLineRow
          key={c.key}
          item={c}
          editingQtyId={editingQtyId}
          editingQtyVal={editingQtyVal}
          onDec={() => onDec(c.key)}
          onInc={() => onInc(c.key)}
          onRemove={() => onRemove(c.key)}
          onEditStart={() => onEditStart(c.key)}
          onEditChange={(v) => onEditChange(c.key, v)}
          onEditBlur={onEditBlur}
        />
      ))}
    </KeyboardSafeScrollView>
  );
}

// ---- Empty cart card (identical tablet cart panel + Orders picker) ----
export function CartEmptyCard() {
  return (
    <View style={{ backgroundColor: "#F9F9FB", borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 18, alignItems: "center", marginTop: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
        <Ionicons name="cart-outline" size={20} color={palette.muted2} />
      </View>
      <Text style={{ fontWeight: "600", color: palette.ink, fontSize: 13 }}>Panyen vid</Text>
      <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4, textAlign: "center" }}>Chwazi pwodwi sou bò gòch la pou ranpli panyen an.</Text>
    </View>
  );
}
