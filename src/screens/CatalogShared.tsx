import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../theme";
import { fmtG, fmt, monoStyle } from "../format";
import type { ProductUnit } from "../pricing";
import { breakdownStock, countInUnit, itemFactor, minItemFactor, type Item, type Variant } from "../catalogModel";

export type Category = { id: string; name: string; icon: string; color: string; created_at?: string };
export type Product = { id: string; name: string; sku?: string; barcode?: string; category?: string; category_id?: string; category_ids?: string[]; item_type?: "goods" | "service"; is_available?: number | boolean; stock_quantity: number; low_stock_threshold: number; cost_price?: number; selling_price?: number; unit?: string };
export type StockBatch = { id: string; store_id: string; reference: string; supplier?: string; transport_cost: number; notes?: string; total_items_cost: number; total_cost: number; received_at?: string; status?: string; delivered_at?: string; created_by?: string; created_at: string };
export type StockMovement = { id: string; batch_id?: string; store_id: string; product_id: string; type: string; quantity: number; initial_qty?: number; remaining_qty?: number; unit_cost: number; total_cost: number; allocated_transport: number; reason?: string; status?: string; delivered_at?: string; created_by?: string; created_at: string };

export type NewPriceRow = { key: string; unitKey: string; variant: string; price: string };
export type NewBundleRow = { key: string; unitKey: string; variant: string; minQty: string; price: string };
export type NewUnitRow = { key: string; name: string; factor: string };

export type StockTab = "store" | "incoming";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "all", name: "Tout", icon: "⊞", color: palette.ink2 },
  { id: "food", name: "Manje", icon: "🍚", color: palette.ink2 },
  { id: "drinks", name: "Bwason", icon: "🥤", color: palette.ink2 },
  { id: "household", name: "Kay", icon: "🧴", color: palette.ink2 },
  { id: "dairy", name: "Letye", icon: "🥛", color: palette.ink2 },
  { id: "bakery", name: "Boulanjri", icon: "🥐", color: palette.ink2 },
  { id: "produce", name: "Lejume", icon: "🥬", color: palette.ink2 },
];

// Dark surfaces for the black-background Products / Category views — same
// language as the More hub (black + #2b2b2b tiles + white/gray text).
export const catalogDark = {
  bg: "#000",
  card: "#1C1C1E",
  tile: "#2b2b2b",
  border: "#2b2b2b",
  borderStrong: "#3a3a3c",
  hairline: "#262626",
  text: "#fff",
  sub: "#8e8e93",
  faint: "#636366",
} as const;

// Modern premium vector icons for the built-in categories. Custom categories
// (unknown ids) fall back to their stored character so user picks keep working.
const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  all: "layers-outline",
  food: "restaurant-outline",
  drinks: "wine-outline",
  household: "home-outline",
  dairy: "egg-outline",
  bakery: "pizza-outline",
  produce: "leaf-outline",
};
export function categoryIonicon(c: Category): keyof typeof Ionicons.glyphMap | null {
  const builtin = CATEGORY_ICONS[c.id];
  if (builtin) return builtin;
  // New categories store the Ionicon glyph name itself (CategoryFormModal).
  if (typeof c.icon === "string" && (Ionicons.glyphMap as Record<string, unknown>)[c.icon] !== undefined) {
    return c.icon as keyof typeof Ionicons.glyphMap;
  }
  return null;
}

// Keyword → glyph matching on the category NAME, so seeded/demo categories
// with emoji icons still render premium vectors. Shared with the icon
// suggester in CategoryFormModal.
const ICON_KEYWORDS: [string[], keyof typeof Ionicons.glyphMap][] = [
  [["beer", "biere", "bye", "prestige", "corona", "heineken", "guinness"], "beer-outline"],
  [["vin", "wine", "diven", "champagne", "alkol", "alcohol", "rhum", "whisky", "kleren"], "wine-outline"],
  [["kafe", "cafe", "coffee", "tea", "bwason"], "cafe-outline"],
  [["dlo", "water", "ji", "jus", "juice", "kola", "cola", "soda", "dous"], "water-outline"],
  [["diri", "rice", "mayi", "mais", "corn", "farin", "flour", "sik", "sugar", "manje", "food", "baz"], "restaurant-outline"],
  [["pen", "bread", "boulanj", "pizza", "bakery", "gato"], "pizza-outline"],
  [["let", "lait", "milk", "ze", "egg", "fromaj", "cheese", "dairy"], "egg-outline"],
  [["bebe", "baby", "timoun"], "happy-outline"],
  [["tabak", "sigaret", "smoke", "cigarette"], "cloud-outline"],
  [["fwi", "fruit", "legim", "vegetable", "tomat", "tomato", "produce", "pwa"], "leaf-outline"],
  [["vyann", "meat", "poul", "chicken", "poulet"], "nutrition-outline"],
  [["pwason", "fish", "poisson"], "fish-outline"],
  [["glace", "ice", "cream", "krem", "goute"], "ice-cream-outline"],
  [["savon", "soap", "kay", "home", "netwaye", "menaj", "konsev"], "home-outline"],
  [["swen", "care", "clean", "sanite"], "sparkles-outline"],
  [["panye", "basket", "panier"], "basket-outline"],
  [["mache", "market", "magazen", "shop", "store"], "cart-outline"],
  [["eneji", "enerji", "energy"], "flash-outline"],
];

function normName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Glyphs relevant to a name, best match first. Empty when nothing matches. */
export function matchCategoryIconNames(name: string): (keyof typeof Ionicons.glyphMap)[] {
  const words = normName(name).split(/[^a-z]+/).filter(w => w.length >= 3);
  if (!words.length) return [];
  const out: (keyof typeof Ionicons.glyphMap)[] = [];
  for (const [keys, glyph] of ICON_KEYWORDS) {
    if (keys.some(k => words.some(w => w.startsWith(k) || k.startsWith(w)))) {
      if (!out.includes(glyph)) out.push(glyph);
    }
    if (out.length >= 6) break;
  }
  return out;
}

/** Display icon: stored glyph or builtin first, then name match, else null
 *  (caller falls back to the raw emoji character). */
export function categoryDisplayIcon(c: Category): keyof typeof Ionicons.glyphMap | null {
  return categoryIonicon(c) ?? matchCategoryIconNames(c.name)[0] ?? null;
}

export const ROLE_KR: Record<string, string> = {
  owner: "Patwon",
  admin: "Admin",
  manager: "Manadjè",
  cashier: "Kesye",
  associate: "Asosye",
  cook: "Kwizinye",
  seller: "Vandè",
};

// Catalog item types: goods are quantity-tracked, services are not (no stock
// number at all — availability toggle only, same as the kitchen 86 flow).
export function isService(p: Product | null | undefined): boolean {
  return (p?.item_type ?? "goods") === "service";
}
export function isGoods(p: Product | null | undefined): boolean {
  return !isService(p);
}
export function isAvailable(p: Product | null | undefined): boolean {
  if (!p) return false;
  if (isService(p)) return p.is_available !== 0 && (p.is_available as any) !== false;
  return true;
}

export function getCategoryForProduct(p: Product): string {
  const name = p.name.toLowerCase();
  if (name.includes("rice") || name.includes("flour") || name.includes("sugar") || name.includes("pasta") || name.includes("corn") || name.includes("salt") || name.includes("mayi") || name.includes("sèl") || name.includes("sik") || name.includes("farin")) return "food";
  if (name.includes("beer") || name.includes("cola") || name.includes("water") || name.includes("dlo") || name.includes("kola") || name.includes("prestige")) return "drinks";
  if (name.includes("soap") || name.includes("savon") || name.includes("detergent") || name.includes("colgate") || name.includes("pat")) return "household";
  if (name.includes("milk") || name.includes("lèt") || name.includes("coffee") || name.includes("kafe")) return "dairy";
  if (name.includes("biscuit") || name.includes("bisk")) return "bakery";
  if (name.includes("tomato") || name.includes("tomat") || name.includes("sardine")) return "produce";
  return "food";
}

export function nid(p: string) { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
export function slugify(s: string) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

export type StockStatus = { label: string; border: string; bg: string; text: string; dot: string; accent: string; sub: string; bar: string };

export function getStockStatus(qty: number, threshold: number): StockStatus {  if (qty <= 0) return { label: "EPUIZE", border: palette.dangerBd, bg: palette.dangerBg, text: palette.danger, dot: palette.dangerDot, accent: palette.danger, sub: "#FCA5A5", bar: palette.danger };
  if (qty <= threshold) return { label: "FÈB", border: palette.warningBd, bg: palette.warningBg, text: palette.warning, dot: palette.warningDot, accent: palette.warning, sub: "#FDBA74", bar: palette.warningDot };
  return { label: "DISPONIB", border: palette.successBd, bg: palette.successBg, text: palette.success, dot: palette.successDot, accent: palette.success, sub: "#86EFAC", bar: palette.success };
}

// Status for catalog rows: services resolve through availability (86 flow),
// goods through stock levels.
export function statusForProduct(p: Product): StockStatus {
  if (isService(p)) {
    return isAvailable(p)
      ? { label: "DISPONIB", border: palette.successBd, bg: palette.successBg, text: palette.success, dot: palette.successDot, accent: palette.success, sub: "#86EFAC", bar: palette.success }
      : { label: "KOUPE", border: palette.warningBd, bg: palette.warningBg, text: palette.warning, dot: palette.warningDot, accent: palette.warning, sub: "#FDBA74", bar: palette.warningDot };
  }
  return getStockStatus(p.stock_quantity, p.low_stock_threshold);
}

/** One sell-unit row: rename + conversion factor, saved with ✓. Base unit factor stays 1. */
export function UnitRowEditor({ u, isBase, canEdit, onSave, onDelete, canDelete }: {
  u: ProductUnit; isBase: boolean; canEdit: boolean;
  onSave: (u: ProductUnit, name: string, factorStr: string) => void;
  onDelete: (u: ProductUnit) => void; canDelete: boolean;
}) {
  const [name, setName] = useState(u.unit_name);
  const [factor, setFactor] = useState(String(u.conversion_factor));
  useEffect(() => { setName(u.unit_name); setFactor(String(u.conversion_factor)); }, [u.id, u.unit_name, u.conversion_factor]);
  const dirty = name.trim() !== (u.unit_name ?? "") || (!isBase && (parseFloat(factor) || 0) !== Number(u.conversion_factor));
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
      <TextInput value={name} onChangeText={setName} editable={canEdit} placeholder="Unit" placeholderTextColor={palette.muted3} style={{ flex: 2, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, fontWeight: "600", color: palette.ink, backgroundColor: palette.surface }} />
      <TextInput value={isBase ? "1" : factor} onChangeText={v => setFactor(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" editable={canEdit && !isBase} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: isBase ? palette.surfaceGrouped : palette.surface, textAlign: "center" }} />
      {canEdit && dirty && (
        <Pressable onPress={() => onSave(u, name, factor)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.successBd }}><Ionicons name="checkmark" size={16} color={palette.success} /></Pressable>
      )}
      {canEdit && canDelete && (
        <Pressable onPress={() => onDelete(u)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.dangerBg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.dangerBd }}><Ionicons name="trash-outline" size={15} color={palette.danger} /></Pressable>
      )}
    </View>
  );
}

/** Unit picker: starts unselected ("Chwazi inite…"), lists the units defined above. */
export function UnitDropdown({ units, value, onPick }: {
  units: { key: string; name: string }[];
  value: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sel = units.find(u => u.key === value && u.name.trim());
  const named = units.filter(u => u.name.trim());
  return (
    <View style={{ marginTop: 6 }}>
      <Pressable onPress={() => setOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: !sel ? palette.warningBd : palette.hairline, backgroundColor: !sel ? palette.warningBg : palette.surface, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: sel ? palette.ink : palette.muted3 }}>{sel ? sel.name : "Chwazi inite…"}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={15} color={palette.muted} />
      </Pressable>
      {open && (
        <View style={{ marginTop: 6, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, overflow: "hidden", backgroundColor: palette.surface }}>
          {named.map(u => (
            <Pressable key={u.key} onPress={() => { onPick(u.key); setOpen(false); }} style={{ paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft, backgroundColor: value === u.key ? palette.surfaceGrouped : palette.surface }}>
              <Text style={{ fontSize: 14, fontWeight: value === u.key ? "700" : "500", color: palette.ink }}>{u.name}{value === u.key ? " ✓" : ""}</Text>
            </Pressable>
          ))}
          {named.length === 0 && (
            <View style={{ padding: 12 }}><Text style={{ fontSize: 12, color: palette.muted3 }}>Bay inite yo non anvan (pi wo a).</Text></View>
          )}
        </View>
      )}
    </View>
  );
}

/** Status pill shared by cards (default) and detail headers (large). */
export function StockStatusPill({ status, large }: { status: StockStatus; large?: boolean }) {
  if (large) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status.dot }} />
        <Text style={{ fontSize: 11, fontWeight: "800", color: status.text, letterSpacing: 0.3 }}>{status.label}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.dot }} />
      <Text style={{ fontSize: 10, fontWeight: "700", color: status.text, letterSpacing: 0.3 }}>{status.label}</Text>
    </View>
  );
}

/** Apple search bar (catalog only — batch tabs live in Inventory now). Identical on phone/tablet. */
export function SearchHeader({ q, setQ, barcode, setBarcode, padH }: {
  q: string; setQ: (v: string) => void;
  barcode: string; setBarcode: (v: string) => void;
  padH: number;
}) {
  return (
    <View style={{ backgroundColor: catalogDark.bg, paddingHorizontal: padH, paddingTop: 12, paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
          <TextInput placeholder="Chèche pwodwi, SKU" placeholderTextColor="#8e8e93" value={q} onChangeText={setQ} style={{ flex: 1, fontSize: 16, color: "#fff" }} returnKeyType="search" />
          {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
        </View>
        <View style={{ width: 124, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
          <Ionicons name="barcode-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <TextInput placeholder="Kòd bar" placeholderTextColor="#8e8e93" value={barcode} onChangeText={setBarcode} style={{ flex: 1, fontSize: 15, color: "#fff" }} autoCapitalize="characters" />
          {barcode.length > 0 && <Pressable onPress={() => setBarcode("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
        </View>
      </View>
    </View>
  );
}

/** Elegant pill category row. Identical on phone/tablet. */
export function CategoryStrip({ categories, cat, setCat, products, getProductCats, padH }: {
  categories: Category[]; cat: string; setCat: (v: string) => void;
  products: Product[]; getProductCats: (productId: string) => string[]; padH: number;
}) {
  return (
    <View style={{ backgroundColor: catalogDark.bg, borderBottomWidth: 0.5, borderColor: catalogDark.hairline, paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: padH, gap: 8 }}>
        {categories.map(c => {
          const active = cat === c.id;
          const count = c.id === "all" ? products.length : products.filter(p => getProductCats(p.id).includes(c.id)).length;
          const isAll = c.id === "all";
          return (
            <Pressable key={c.id} onPress={() => setCat(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 18, paddingVertical: 13, borderRadius: radius.pill, backgroundColor: active ? "#F4F1EA" : "#000", borderWidth: 1, borderColor: active ? "#F4F1EA" : catalogDark.border, ...(active ? shadow.soft : {}) }}>
              <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: isAll && active ? "rgba(0,0,0,0.08)" : isAll ? "rgba(255,255,255,0.08)" : "transparent", borderWidth: isAll ? 1 : 0, borderColor: isAll ? (active ? "#3a3a3c" : "#fff") : "transparent", alignItems: "center", justifyContent: "center" }}>
                {(() => { const gi = categoryDisplayIcon(c); return gi ? <Ionicons name={gi} size={16} color={active ? "#16130c" : "#fff"} /> : <Text style={{ fontSize: 15, lineHeight: 16 }}>{c.icon}</Text>; })()}
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: active ? "#16130c" : catalogDark.sub, letterSpacing: -0.1 }}>{c.name}</Text>
              <View style={{ backgroundColor: active ? "rgba(0,0,0,0.08)" : catalogDark.tile, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: active ? "rgba(0,0,0,0.08)" : catalogDark.tile }}>
                <Text style={{ fontSize: 13, fontWeight: "800", color: active ? "#16130c" : catalogDark.sub }}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Store product card — the single reusable product row (phone list, tablet
 *  list, category details, inventory picker). Warm card: cube tile, name +
 *  status pill, SKU · categories, qty + unit, gold price, chevron.
 *  Quantities stay white unless stock warns (FÈB/EPUIZE bright tint);
 *  `selected` highlights the pick. */
export function ProductCard({ item, role, prodCats, status, recentMoves, displayPrice, unitName, isTablet, canEdit, canViewCost, canToggleAvail, selected, isFirst, isLast, stockItems, variants, baseCost, onPress }: {
  item: Product; role: string; prodCats: Category[]; status: StockStatus;
  recentMoves: StockMovement[]; displayPrice: number; unitName: string;
  isTablet: boolean; canEdit: boolean; canViewCost: boolean; canToggleAvail?: boolean; selected?: boolean; isFirst?: boolean; isLast?: boolean; stockItems?: Item[]; variants?: Variant[]; baseCost?: number; onPress: () => void;
}) {
  void role; void recentMoves; void canToggleAvail; void isFirst; void isLast;
  void displayPrice; void canViewCost; void baseCost;
  const service = isService(item);
  const available = isAvailable(item);
  // Biggest container ("48 boutèy") when the item chain is known.
  const chain = (stockItems ?? []).filter(i => i.product_id === item.id && !i.is_deleted);
  const biggest = chain.length
    ? chain.map(it => ({ it, per: itemFactor(chain, it.id) / minItemFactor(chain, item.id) })).filter(x => x.per > 0).sort((a, b) => b.per - a.per)[0] ?? null
    : null;
  const bigCount = biggest ? countInUnit(chain, item.id, biggest.it.id, item.stock_quantity) : item.stock_quantity;
  const warns = !service && status.label !== "DISPONIB";
  // Low stock (≤ Seuil Fèb) → 1px ember border; empty stock → 1px red.
  const warnBorder = !service && status.label !== "DISPONIB"
    ? (status.label === "EPUIZE" ? palette.danger : palette.accent)
    : null;
  // status.sub is the bright-on-dark tint (mint/peach/red).
  const qtyColor = warns ? status.sub : "#fff";
  const catLine = prodCats.slice(0, 1).map(c => c.name).join(" • ");
  const qtyUnit = biggest ? biggest.it.name : unitName;
  // One price can't represent a multi-variant product — show the count.
  const chainIds = new Set(chain.map(i => i.id));
  const variantCount = (variants ?? []).filter(v => !v.is_deleted && chainIds.has(String(v.item_id))).length;
  const paper = "#f6f1e4";
  const paperSub = "#a89f88";
  const cardStyle = {
    flex: isTablet ? 1 : undefined,
    flexDirection: "row" as const, alignItems: "center" as const, gap: 12,
    backgroundColor: selected ? "#2b2b2b" : "#232327",
    borderWidth: 1,
    borderColor: warnBorder ?? (selected ? "#3a3a3c" : "rgba(246,241,228,0.12)"),
    borderRadius: 20,
    overflow: "hidden" as const,
    padding: 14,
    opacity: service && !available ? 0.55 : 1,
  };
  const inner = (
    <>
      <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "rgba(221,138,62,0.12)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="cube-outline" size={24} color="#dd8a3e" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontWeight: "800", fontSize: 17, color: paper, letterSpacing: -0.3, flex: 1 }} numberOfLines={1}>{item.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 10, fontWeight: "800", color: status.sub, letterSpacing: 0.3 }}>{status.label}</Text>
          </View>
        </View>
        <Text style={{ color: paperSub, fontSize: 13, marginTop: 4, fontWeight: "400" }} numberOfLines={1}>
          {item.sku ?? "—"}{catLine ? ` · ${catLine}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
        {!service && (
          <Text style={{ fontWeight: "800", fontSize: 17, color: qtyColor, ...monoStyle }} numberOfLines={1}>
            {bigCount} <Text style={{ fontSize: 14, fontWeight: "400", color: paperSub }}>{qtyUnit}</Text>
          </Text>
        )}
        <Text style={{ fontWeight: "600", fontSize: 14, color: paperSub, marginTop: 2 }} numberOfLines={1}>
          {variantCount} variant
        </Text>
      </View>
    </>
  );
  const pressable = canEdit || (!!canToggleAvail && service);
  const chevron = pressable
    ? <Ionicons name="chevron-forward" size={18} color="#636366" style={{ marginRight: -4 }} />
    : null;
  return pressable ? (
    <Pressable onPress={onPress} style={cardStyle}>{inner}{chevron}</Pressable>
  ) : (
    <View style={cardStyle}>{inner}</View>
  );
}

/** One incoming/delivered batch card (parent ScrollView stays version-specific). */
export function IncomingBatchCard({ batch: b, movs, products, delivering, onDeliver }: {
  batch: StockBatch; movs: StockMovement[]; products: Product[]; delivering: boolean; onDeliver: () => void;
}) {
  const isPending = (b.status ?? "pending") === "pending";
  const totalQty = movs.reduce((s, m) => s + (m.quantity || 0), 0);
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: isPending ? "#fff" : palette.successBd, padding: 14, ...shadow.card, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: isPending ? "#fff" : palette.success }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{b.reference}</Text>
            {isPending ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "#fff", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />
                <Text style={{ fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.3 }}>AP VINI</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderWidth: 1, borderColor: palette.successBd, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Ionicons name="checkmark" size={9} color={palette.success} />
                <Text style={{ fontSize: 10, fontWeight: "800", color: palette.success, letterSpacing: 0.3 }}>RIVE</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, color: palette.muted, marginTop: 3 }}>{b.supplier ? `${b.supplier} · ` : ""}{movs.length} atik · {fmt(totalQty)} pcs{!isPending && b.delivered_at ? ` · Rive ${new Date(b.delivered_at).toLocaleDateString()}` : ""}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Stòk</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: palette.ink }}>{fmt(totalQty)} pcs</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Transpò</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: palette.ink }}>{fmtG(Math.round(b.transport_cost ?? 0))}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Pri total</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: isPending ? "#fff" : palette.success }}>{fmtG(Math.round(b.total_cost ?? 0))}</Text>
        </View>
      </View>
      <View style={{ marginTop: 8, gap: 5 }}>
        {movs.slice(0, 3).map(m => {
          const prod = products.find(p => p.id === m.product_id);
          return (
            <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink }} numberOfLines={1}>{prod?.name ?? m.product_id} <Text style={{ color: palette.muted3, fontWeight: "500" }}>× {m.quantity}</Text></Text>
              <Text style={{ fontSize: 11, color: palette.muted }}>{fmtG(Math.round(m.total_cost))}</Text>
            </View>
          );
        })}
        {movs.length > 3 && <Text style={{ fontSize: 11, color: palette.muted3, textAlign: "center" }}>+{movs.length - 3} lòt atik</Text>}
      </View>
      {isPending ? (
        <Pressable onPress={onDeliver} disabled={delivering} style={{ marginTop: 10, backgroundColor: palette.success, paddingVertical: 12, borderRadius: radius.sm, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 }}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Livrezon rive ✓</Text>
        </Pressable>
      ) : (
        <View style={{ marginTop: 10, backgroundColor: palette.successBg, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: palette.successBd }}>
          <Ionicons name="checkmark-circle" size={15} color={palette.success} />
          <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>Nan stòk depi {b.delivered_at ? new Date(b.delivered_at).toLocaleDateString() : "kounye a"}</Text>
        </View>
      )}
    </View>
  );
}
