// ProductDetail — reusable black product details screen (same language as
// the category details). Sections: identity, stock (+inline seuil edit),
// prices, items, categories, batches, danger zone. All management jumps
// into the catalog flow; threshold + availability + delete act inline.
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../db";
import { fmtG } from "../format";
import { palette, radius } from "../theme";
import {
  type Category, type Product, statusForProduct, isService, isAvailable,
  categoryDisplayIcon,
} from "./CatalogShared";
import {
  type CatalogModel, breakdownStock, currentVariantPrice,
} from "../catalogModel";
import type { StepKey } from "./catalogFlow/CatalogFlowModal";

export default function ProductDetail({
  product, categories, catIds, v2, supplierList,
  displayPriceOf, getBaseCost,
  canEdit, canViewCost, canToggleAvail, onToggleAvail, canDelete,
  onManage, onOpenCategory, onDeleteProduct, onDeleted, onChanged, onScrollY,
}: {
  product: Product;
  categories: Category[];
  catIds: string[];
  v2: CatalogModel;
  supplierList: { id: string; name: string }[];
  displayPriceOf: (p: Product) => number;
  getBaseCost: (productId: string) => number;
  canEdit: boolean;
  canViewCost: boolean;
  canToggleAvail: boolean;
  onToggleAvail: (p: Product) => void;
  canDelete: boolean;
  onManage: (productId: string, section?: StepKey) => void;
  onOpenCategory: (categoryId: string) => void;
  onDeleteProduct: (productId: string) => Promise<void>;
  onDeleted: () => void;
  onChanged: () => void;
  onScrollY: (y: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lowInput, setLowInput] = useState<string | null>(null);
  const [savingLow, setSavingLow] = useState(false);

  const status = statusForProduct(product);
  const items = useMemo(
    () => v2.items.filter(i => i.product_id === product.id && !i.is_deleted)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [v2.items, product.id]
  );
  const itemIds = useMemo(() => new Set(items.map(i => i.id)), [items]);
  const prodVariants = useMemo(
    () => v2.variants.filter(v => itemIds.has(String(v.item_id)) && !v.is_deleted),
    [v2.variants, itemIds]
  );
  const batches = useMemo(
    () => v2.batches.filter(b => itemIds.has(String(b.item_id)) && !b.is_deleted)
      .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))),
    [v2.batches, itemIds]
  );
  const prodCats = useMemo(() => {
    const ids = new Set(catIds);
    return categories.filter(c => ids.has(c.id));
  }, [categories, catIds]);
  const supName = (id: string) => supplierList.find(s => s.id === id)?.name ?? "—";
  const itemName = (id: string) => v2.items.find(i => i.id === id)?.name ?? "?";
  const baseCost = getBaseCost(product.id);
  const price = displayPriceOf(product);
  const margin = price > 0 && baseCost > 0 ? Math.round((1 - baseCost / price) * 100) : null;

  async function saveLow() {
    const v = parseInt(lowInput ?? "", 10);
    if (isNaN(v) || v < 0) return Alert.alert("Kantite pa valab", "Antre yon chif ≥ 0.");
    setSavingLow(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.runAsync("UPDATE products SET low_stock_threshold = ?, updated_at = ?, dirty = 1 WHERE id = ?", [v, now, product.id]);
      try { await insertOutbox("products", "update", { id: product.id, low_stock_threshold: v, updated_at: now, is_deleted: 0 }); } catch {}
      setLowInput(null);
      onChanged();
      Alert.alert("Seuil mete ajou ✓", `${v}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Sove seuil echwe");
    } finally {
      setSavingLow(false);
    }
  }

  async function doDelete(onDelete: (pid: string) => Promise<void>) {
    try {
      await onDelete(product.id);
      setConfirmDelete(false);
      onDeleted();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Efase pwodwi echwe");
    }
  }

  return (
    <View style={{ flex: 1, width: "100%" }}>
      <ScrollView
        style={{ flex: 1, width: "100%" }}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 12 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => onScrollY(e.nativeEvent.contentOffset.y)}
      >
        {/* Identity */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 22 }}>{product.name?.[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", letterSpacing: -0.4 }} numberOfLines={2}>{product.name}</Text>
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{product.sku ?? "—"}</Text>
          </View>
          <View style={{ backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: status.text }}>{status.label}</Text>
          </View>
        </View>

        {/* Stock */}
        {isService(product) ? (
          canToggleAvail ? (
            <Pressable onPress={() => onToggleAvail(product)} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
              <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: isAvailable(product) ? "#2f7d5b" : "#8e8e93", justifyContent: "center", paddingHorizontal: 2, alignItems: isAvailable(product) ? "flex-end" : "flex-start" }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: isAvailable(product) ? "#4cae7f" : "#d99a2b" }}>{isAvailable(product) ? "Disponib" : "Koupe"}</Text>
                <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{isAvailable(product) ? "Parèt nan vant kounye a" : "Kache nan vant (86)"}</Text>
              </View>
            </Pressable>
          ) : null
        ) : (
          <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
            <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.6 }}>NAN STÒK</Text>
            <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff", marginTop: 4 }} numberOfLines={2}>{breakdownStock(v2.items, product.id, product.stock_quantity)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <Text style={{ fontSize: 12, color: "#8e8e93" }}>Seuil fèb: {product.low_stock_threshold}</Text>
              {canEdit && lowInput === null ? (
                <Pressable onPress={() => setLowInput(String(product.low_stock_threshold))} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "#3a3a3c" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff" }}>Modifye</Text>
                </Pressable>
              ) : null}
            </View>
            {canEdit && lowInput !== null ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TextInput value={lowInput} onChangeText={v => setLowInput(v.replace(/[^0-9]/g, ""))} keyboardType="numeric"
                  style={{ flex: 1, height: 48, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
                <Pressable onPress={() => setLowInput(null)} style={{ paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Anile</Text>
                </Pressable>
                <Pressable onPress={saveLow} disabled={savingLow} style={{ paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", opacity: savingLow ? 0.5 : 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 13, color: "#000" }}>OK</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}

        {/* Prices */}
        <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Pri</Text>
            <Text style={{ fontWeight: "900", fontSize: 18, color: "#fff" }}>{price > 0 ? fmtG(price) : "—"}</Text>
          </View>
          {canViewCost ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: "#8e8e93" }}>Pri acha (baz): {baseCost > 0 ? fmtG(baseCost) : "—"}</Text>
              {margin !== null ? <Text style={{ fontSize: 12, fontWeight: "700", color: margin >= 20 ? "#4cae7f" : "#d99a2b" }}>Marge {margin}%</Text> : null}
            </View>
          ) : null}
          {prodVariants.length > 0 && (
            <View style={{ marginTop: 10, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {prodVariants.map(v => {
                const cur = currentVariantPrice(v2.variantPrices, v.id);
                const it = v2.items.find(i => i.id === v.item_id);
                return (
                  <View key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#8e8e93" }}>{it?.name ?? "?"}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff", flex: 1 }}>{v.name}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff" }}>{cur ? fmtG(Number(cur.price)) : "—"}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {canEdit ? (
            <Pressable onPress={() => onManage(product.id, "prices")} style={{ marginTop: 10, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Jere pri →</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Items */}
        <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Inite ({items.length})</Text>
          {items.length ? (
            <View style={{ marginTop: 4, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {items.map(u => {
                const ref = u.ref_item_id ? v2.items.find(i => i.id === u.ref_item_id) : null;
                return (
                  <View key={u.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>{u.name}</Text>
                    <Text style={{ fontSize: 11, color: "#8e8e93" }}>{ref ? `1 ${u.name} = ${u.ratio && Number(u.ratio) < 1 ? `${Math.round((1 / Number(u.ratio)) * 1000) / 1000}` : `${Number(u.ratio)}`} × ${ref.name}` : "baz"}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 8 }}>Poko gen inite.</Text>
          )}
          {canEdit ? (
            <Pressable onPress={() => onManage(product.id, "items")} style={{ marginTop: 10, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Jere inite →</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Categories */}
        <View>
          <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "800", letterSpacing: 1.2 }}>KATEGORI</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {prodCats.map(c => {
              const gi = categoryDisplayIcon(c);
              return (
                <Pressable key={c.id} onPress={() => onOpenCategory(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b" }}>
                  {gi ? <Ionicons name={gi} size={14} color={"#fff"} /> : <Text style={{ fontSize: 13 }}>{c.icon}</Text>}
                  <Text style={{ fontWeight: "600", fontSize: 12, color: "#fff" }}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Batches */}
        <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
          <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Batch</Text>
          {batches.length ? (
            <View style={{ marginTop: 4, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {batches.slice(0, 5).map(b => (
                <View key={b.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }} numberOfLines={1}>{itemName(String(b.item_id))} · {fmtG(Number(b.quantity))}</Text>
                    <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{supName(String(b.supplier_id))} · {b.date} · {b.status}</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff" }}>{fmtG(Number(b.total_paid))}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 8 }}>Poko gen batch.</Text>
          )}
          {canEdit ? (
            <Pressable onPress={() => onManage(product.id, "batch")} style={{ marginTop: 10, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Jere batch →</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Danger */}
        {canDelete ? (
          <Pressable
            onPress={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              try {
                await onDeleteProduct(product.id);
                setConfirmDelete(false);
                onDeleted();
              } catch (e: any) {
                Alert.alert("Erè", e?.message ?? "Efase pwodwi echwe");
              }
            }}
            style={{ backgroundColor: confirmDelete ? "#c0392b" : "transparent", borderWidth: 1, borderColor: confirmDelete ? "#c0392b" : "rgba(192,57,43,0.5)", paddingVertical: 13, borderRadius: 12, alignItems: "center" }}
          >
            <Text style={{ color: confirmDelete ? "#fff" : "#e06c5b", fontWeight: "600", fontSize: 13 }}>{confirmDelete ? "✓ Konfime efase kounye a" : "Efase pwodwi"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
