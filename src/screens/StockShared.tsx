import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../theme";
import { fmt, monoStyle } from "../format";
import type { ProductUnit } from "../pricing";

export type Category = { id: string; name: string; icon: string; color: string };
export type Product = { id: string; name: string; sku?: string; barcode?: string; category?: string; category_id?: string; category_ids?: string[]; stock_quantity: number; low_stock_threshold: number; cost_price: number; selling_price?: number; unit?: string };
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

export const ROLE_KR: Record<string, string> = {
  owner: "Patwon",
  admin: "Admin",
  manager: "Manadjè",
  cashier: "Kesye",
  seller: "Vandè",
};

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

export function getStockStatus(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return { label: "EPUIZE", border: palette.dangerBd, bg: palette.dangerBg, text: palette.danger, dot: palette.dangerDot, accent: palette.danger, sub: "#FCA5A5", bar: palette.danger };
  if (qty <= threshold) return { label: "FÈB", border: palette.warningBd, bg: palette.warningBg, text: palette.warning, dot: palette.warningDot, accent: palette.warning, sub: "#FDBA74", bar: palette.warningDot };
  return { label: "DISPONIB", border: palette.successBd, bg: palette.successBg, text: palette.success, dot: palette.successDot, accent: palette.success, sub: "#86EFAC", bar: palette.success };
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

/** Apple search bar + loading-dock segmented control + transport banner. Identical on phone/tablet. */
export function SearchHeader({ q, setQ, barcode, setBarcode, stockTab, setStockTab, pendingCount, avgTransportShare, padH }: {
  q: string; setQ: (v: string) => void;
  barcode: string; setBarcode: (v: string) => void;
  stockTab: StockTab; setStockTab: (v: StockTab) => void;
  pendingCount: number; avgTransportShare: number; padH: number;
}) {
  return (
    <View style={{ backgroundColor: "#fff", borderBottomWidth: 0.5, borderColor: palette.hairline, paddingHorizontal: padH, paddingTop: 10, paddingBottom: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View style={{ flex: 1, height: 42, flexDirection: "row", alignItems: "center", backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, paddingHorizontal: 10, borderWidth: 1, borderColor: palette.separatorSoft }}>
          <Ionicons name="search" size={15} color={palette.muted3} style={{ marginRight: 6 }} />
          <TextInput placeholder="Chèche pwodwi, SKU" placeholderTextColor={palette.muted3} value={q} onChangeText={setQ} style={{ flex: 1, fontSize: 14, color: palette.ink, paddingVertical: 8, fontWeight: "400" }} returnKeyType="search" />
          {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}><Ionicons name="close-circle" size={15} color={palette.muted3} /></Pressable>}
        </View>
        <View style={{ width: 112, height: 42, flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, paddingHorizontal: 10 }}>
          <Ionicons name="barcode-outline" size={15} color={palette.muted3} style={{ marginRight: 6 }} />
          <TextInput placeholder="Kòd bar" placeholderTextColor={palette.muted3} value={barcode} onChangeText={setBarcode} style={{ flex: 1, fontSize: 13, color: palette.ink, fontWeight: "500" }} autoCapitalize="characters" />
          {barcode.length > 0 && <Pressable onPress={() => setBarcode("")} hitSlop={8}><Ionicons name="close-circle" size={13} color={palette.muted3} /></Pressable>}
        </View>
      </View>

      {/* Loading-dock segmented control — same look as Home */}
      <View style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 3, flexDirection: "row", borderWidth: 0.5, borderColor: palette.hairline, marginTop: 10 }}>
        {([
          { k: "store", label: "Nan magazen", icon: "storefront-outline" as const },
          { k: "incoming", label: "Ap vini", icon: "boat-outline" as const },
        ] as const).map(t => {
          const active = stockTab === t.k;
          const badge = t.k === "incoming" ? pendingCount : 0;
          return (
            <Pressable
              key={t.k}
              onPress={() => setStockTab(t.k)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: active ? "white" : "transparent",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 5,
                shadowColor: active ? "#000" : "transparent",
                shadowOpacity: active ? 0.08 : 0,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
                elevation: active ? 2 : 0,
              }}
            >
              <Ionicons name={t.icon} size={13} color={active ? palette.ink : palette.muted2} />
              <Text style={{ fontSize: 13, fontWeight: active ? "600" : "400", color: active ? palette.ink : palette.muted2, letterSpacing: -0.2 }}>{t.label}</Text>
              {badge > 0 && <View style={{ backgroundColor: active ? palette.accentGold : palette.accentGoldSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 9 }}><Text style={{ fontSize: 10, fontWeight: "800", color: active ? "#fff" : palette.accentGold }}>{badge}</Text></View>}
            </Pressable>
          );
        })}
      </View>
      {stockTab === "store" && avgTransportShare > 0.5 && (
        <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.sm, padding: 8 }}>
          <Ionicons name="analytics-outline" size={13} color={palette.accentGold} />
          <Text style={{ fontSize: 11, color: palette.accentGold, fontWeight: "600", flex: 1 }}>Transpò mwayèn {avgTransportShare.toFixed(1)}% nan pri acha — gade Inventaire pou detay</Text>
        </View>
      )}
    </View>
  );
}

/** Elegant pill category row. Identical on phone/tablet. */
export function CategoryStrip({ categories, cat, setCat, products, getProductCats, padH }: {
  categories: Category[]; cat: string; setCat: (v: string) => void;
  products: Product[]; getProductCats: (productId: string) => string[]; padH: number;
}) {
  return (
    <View style={{ backgroundColor: "#fff", borderBottomWidth: 0.5, borderColor: palette.separatorSoft, paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: padH, gap: 8 }}>
        {categories.map(c => {
          const active = cat === c.id;
          const count = c.id === "all" ? products.length : products.filter(p => getProductCats(p.id).includes(c.id)).length;
          const isAll = c.id === "all";
          return (
            <Pressable key={c.id} onPress={() => setCat(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline, ...(active ? shadow.soft : {}) }}>
              <View style={{ width: 22, height: 22, borderRadius: 8, backgroundColor: isAll && active ? "rgba(255,255,255,0.14)" : isAll ? palette.accentGoldSoft : "transparent", borderWidth: isAll ? 1 : 0, borderColor: isAll ? (active ? "rgba(200,162,74,0.4)" : palette.accentGold) : "transparent", alignItems: "center", justifyContent: "center" }}>
                {isAll ? <Ionicons name="layers-outline" size={13} color={active ? "#fff" : palette.accentGold} /> : <Text style={{ fontSize: 13, lineHeight: 14 }}>{c.icon}</Text>}
              </View>
              <Text style={{ fontWeight: "600", fontSize: 12.5, color: active ? "#fff" : palette.inkSoft, letterSpacing: -0.1 }}>{c.name}</Text>
              <View style={{ backgroundColor: active ? "rgba(255,255,255,0.14)" : palette.surfaceGrouped, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: active ? "rgba(255,255,255,0.12)" : palette.separatorSoft }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : palette.muted }}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Store product card. Same inner JSX on both form factors; `isTablet` only flips flex for the grid. */
export function ProductCard({ item, role, prodCats, status, recentMoves, displayPrice, unitName, isTablet, canEdit, onPress }: {
  item: Product; role: string; prodCats: Category[]; status: StockStatus;
  recentMoves: StockMovement[]; displayPrice: number; unitName: string;
  isTablet: boolean; canEdit: boolean; onPress: () => void;
}) {
  const cardStyle = { flex: isTablet ? 1 : undefined, backgroundColor: palette.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: status.border, ...shadow.card, overflow: "hidden" as const };
  const inner = (
    <>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: status.bar }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {prodCats.slice(0, 3).map(catInfo => (
              <View key={catInfo.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.surfaceGrouped, borderWidth: 1, borderColor: palette.separatorSoft, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11 }}>{catInfo.icon}</Text>
                <Text style={{ fontSize: 10, fontWeight: "600", color: palette.inkSoft }}>{catInfo.name}</Text>
              </View>
            ))}
            {prodCats.length > 3 && <Text style={{ fontSize: 11, color: palette.muted }}>+{prodCats.length - 3}</Text>}
            <StockStatusPill status={status} />
          </View>
          <Text style={{ fontWeight: "600", fontSize: 14.5, color: palette.ink, marginTop: 8, letterSpacing: -0.2 }} numberOfLines={1}>{item.name}</Text>
          {role !== "cashier" ? (
            <Text style={{ color: palette.muted, fontSize: 12, marginTop: 3, fontWeight: "400" }} numberOfLines={1}>{item.sku ?? "—"} · <Text style={{ color: palette.muted3 }}>{item.cost_price ? `${fmt(item.cost_price)} HTG →` : "— →"}</Text> <Text style={{ color: palette.ink, fontWeight: "600", ...monoStyle }}>{displayPrice ? `${fmt(displayPrice)} HTG` : "—"}</Text></Text>
          ) : (
            <Text style={{ color: palette.muted, fontSize: 12, marginTop: 3, fontWeight: "400" }} numberOfLines={1}>{item.sku ?? "—"} · <Text style={{ color: palette.ink, fontWeight: "600" }}>{displayPrice ? `${fmt(displayPrice)} HTG` : "—"}</Text></Text>
          )}
          <Text style={{ color: palette.muted3, fontSize: 11, marginTop: 2, fontWeight: "500" }}>Seuil fèb {item.low_stock_threshold} · {item.stock_quantity} pcs · {unitName}</Text>
          {role !== "cashier" && recentMoves.length > 0 && (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {recentMoves.map(m => (
                <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: m.type === "in" ? palette.successBg : palette.dangerBg, borderWidth: 0.5, borderColor: m.type === "in" ? palette.successBd : palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Ionicons name={m.type === "in" ? "arrow-down" : "arrow-up"} size={10} color={m.type === "in" ? palette.success : palette.danger} />
                  <Text style={{ fontSize: 10, fontWeight: "600", color: m.type === "in" ? palette.success : palette.danger }}>{m.type === "in" ? "+" : "-"}{m.quantity} @ {fmt(m.unit_cost)} HTG</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ alignItems: "center", justifyContent: "center", minWidth: 84 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 22, color: status.accent, letterSpacing: -0.6, lineHeight: 22 }}>{item.stock_quantity}</Text>
            <Text style={{ fontSize: 10, color: status.sub, fontWeight: "700", letterSpacing: 0.6, marginTop: 1 }}>NAN STÒK</Text>
          </View>
        </View>
      </View>
    </>
  );
  return canEdit ? (
    <Pressable onPress={onPress} style={cardStyle}>{inner}</Pressable>
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
    <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: isPending ? palette.accentGold : palette.successBd, padding: 14, ...shadow.card, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: isPending ? palette.accentGold : palette.success }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{b.reference}</Text>
            {isPending ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.accentGoldSoft, borderWidth: 1, borderColor: palette.accentGold, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accentGold }} />
                <Text style={{ fontSize: 10, fontWeight: "800", color: palette.accentGold, letterSpacing: 0.3 }}>AP VINI</Text>
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
          <Text style={{ fontSize: 13, fontWeight: "700", color: palette.ink }}>{fmt(Math.round(b.transport_cost ?? 0))} HTG</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Pri total</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: isPending ? palette.accentGold : palette.success }}>{fmt(Math.round(b.total_cost ?? 0))} HTG</Text>
        </View>
      </View>
      <View style={{ marginTop: 8, gap: 5 }}>
        {movs.slice(0, 3).map(m => {
          const prod = products.find(p => p.id === m.product_id);
          return (
            <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink }} numberOfLines={1}>{prod?.name ?? m.product_id} <Text style={{ color: palette.muted3, fontWeight: "500" }}>× {m.quantity}</Text></Text>
              <Text style={{ fontSize: 11, color: palette.muted }}>{fmt(Math.round(m.total_cost))} HTG</Text>
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
