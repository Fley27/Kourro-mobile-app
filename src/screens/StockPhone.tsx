import React from "react";
import { View, Text, FlatList, Pressable, TextInput, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../theme";
import { fmt, monoStyle } from "../format";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import type { Role } from "../users";
import type { ProductUnit, ProductPrice, ProductBundle } from "../pricing";
import {
  type Category, type Product, type StockBatch, type StockMovement, type StockTab,
  SearchHeader, CategoryStrip, ProductCard, UnitRowEditor, getStockStatus,
} from "./StockShared";

export interface StockPhoneProps {
  role: Role;
  products: Product[];
  categories: Category[];
  batches: StockBatch[];
  movements: StockMovement[];
  q: string; setQ: React.Dispatch<React.SetStateAction<string>>;
  barcode: string; setBarcode: React.Dispatch<React.SetStateAction<string>>;
  cat: string; setCat: React.Dispatch<React.SetStateAction<string>>;
  stockTab: StockTab; setStockTab: React.Dispatch<React.SetStateAction<StockTab>>;
  avgTransportShare: number;
  filtered: Product[];
  pendingBatches: StockBatch[];
  deliveredBatches: StockBatch[];
  canEdit: boolean; canAddMore: boolean; canReduce: boolean; canDelete: boolean;
  displayPriceOf: (p: Product) => number;
  defaultUnitOf: (productId: string) => ProductUnit | null;
  getProductCats: (productId: string) => string[];
  getProductCategoriesDisplay: (productId: string) => Category[];
  selected: Product | null; setSelected: React.Dispatch<React.SetStateAction<Product | null>>;
  infoProduct: Product | null; setInfoProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandedBatch: React.Dispatch<React.SetStateAction<string | null>>;
  setDeliverBatch: React.Dispatch<React.SetStateAction<StockBatch | null>>;
  setDeliverFee: React.Dispatch<React.SetStateAction<string>>;
  delivering: boolean;
  editCatalog: { name: string; sku: string; categoryIds: string[]; selling_price: string; low: string; unit: string } | null;
  setEditCatalog: React.Dispatch<React.SetStateAction<{ name: string; sku: string; categoryIds: string[]; selling_price: string; low: string; unit: string } | null>>;
  toggleEditCategory: (id: string) => void;
  handleCatalogSave: () => void;
  handleAddStock: () => void;
  editQty: string; setEditQty: React.Dispatch<React.SetStateAction<string>>;
  editPrice: string; setEditPrice: React.Dispatch<React.SetStateAction<string>>;
  reduceQty: string; setReduceQty: React.Dispatch<React.SetStateAction<string>>;
  reduceReason: string; setReduceReason: React.Dispatch<React.SetStateAction<string>>;
  showDeleteConfirm: boolean; setShowDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  infoUnits: ProductUnit[]; infoPrices: ProductPrice[]; infoBundles: ProductBundle[];
  saveInfoUnit: (u: ProductUnit, name: string, factorStr: string) => void;
  deleteInfoUnit: (u: ProductUnit) => void;
  newInfoUnitName: string; setNewInfoUnitName: React.Dispatch<React.SetStateAction<string>>;
  newInfoUnitFactor: string; setNewInfoUnitFactor: React.Dispatch<React.SetStateAction<string>>;
  addInfoUnit: () => void;
  deleteInfoPrice: (r: ProductPrice) => void;
  showAddInfoPrice: boolean; setShowAddInfoPrice: React.Dispatch<React.SetStateAction<boolean>>;
  infoPriceUnit: string; setInfoPriceUnit: React.Dispatch<React.SetStateAction<string>>;
  infoPriceVariant: string; setInfoPriceVariant: React.Dispatch<React.SetStateAction<string>>;
  infoPriceValue: string; setInfoPriceValue: React.Dispatch<React.SetStateAction<string>>;
  addInfoPrice: () => void;
  showAddInfoBundle: boolean; setShowAddInfoBundle: React.Dispatch<React.SetStateAction<boolean>>;
  infoBundleUnit: string; setInfoBundleUnit: React.Dispatch<React.SetStateAction<string>>;
  infoBundleVariant: string; setInfoBundleVariant: React.Dispatch<React.SetStateAction<string>>;
  infoBundleMin: string; setInfoBundleMin: React.Dispatch<React.SetStateAction<string>>;
  infoBundlePrice: string; setInfoBundlePrice: React.Dispatch<React.SetStateAction<string>>;
  addInfoBundle: () => void;
  deleteInfoBundle: (r: ProductBundle) => void;
  showNameEdit: boolean; setShowNameEdit: React.Dispatch<React.SetStateAction<boolean>>;
  nameInput: string; setNameInput: React.Dispatch<React.SetStateAction<string>>;
  handleChangeName: () => void;
  showUnitEdit: boolean; setShowUnitEdit: React.Dispatch<React.SetStateAction<boolean>>;
  unitInput: string; setUnitInput: React.Dispatch<React.SetStateAction<string>>;
  handleChangeUnit: () => void;
}

/** Phone layout: search + category strip + 1-col list / incoming + phone-only sheets. */
export function StockPhone(props: StockPhoneProps) {
  const { width, padH } = useResponsive();
  const {
    role, products, categories, batches, movements,
    q, setQ, barcode, setBarcode, cat, setCat, stockTab, setStockTab,
    avgTransportShare, filtered, pendingBatches, deliveredBatches,
    canEdit, canAddMore, canReduce, canDelete,
    displayPriceOf, defaultUnitOf, getProductCats, getProductCategoriesDisplay,
    selected, setSelected, infoProduct, setInfoProduct,
    setShowHistory, setExpandedBatch, setDeliverBatch, setDeliverFee, delivering,
    editCatalog, setEditCatalog, toggleEditCategory, handleCatalogSave, handleAddStock,
    editQty, setEditQty, editPrice, setEditPrice, reduceQty, setReduceQty, reduceReason, setReduceReason,
    showDeleteConfirm, setShowDeleteConfirm,
    infoUnits, infoPrices, infoBundles, saveInfoUnit, deleteInfoUnit,
    newInfoUnitName, setNewInfoUnitName, newInfoUnitFactor, setNewInfoUnitFactor, addInfoUnit,
    deleteInfoPrice, showAddInfoPrice, setShowAddInfoPrice,
    infoPriceUnit, setInfoPriceUnit, infoPriceVariant, setInfoPriceVariant,
    infoPriceValue, setInfoPriceValue, addInfoPrice,
    showAddInfoBundle, setShowAddInfoBundle,
    infoBundleUnit, setInfoBundleUnit, infoBundleVariant, setInfoBundleVariant,
    infoBundleMin, setInfoBundleMin, infoBundlePrice, setInfoBundlePrice,
    addInfoBundle, deleteInfoBundle,
    showNameEdit, setShowNameEdit, nameInput, setNameInput, handleChangeName,
    showUnitEdit, setShowUnitEdit, unitInput, setUnitInput, handleChangeUnit,
  } = props;

  return (
    <View style={{ ...centerBox(false, width, 880) }}>
      <SearchHeader q={q} setQ={setQ} barcode={barcode} setBarcode={setBarcode} stockTab={stockTab} setStockTab={setStockTab} pendingCount={pendingBatches.length} avgTransportShare={avgTransportShare} padH={padH} />

      {/* ── Categories — elegant pill row ── */}
      {stockTab === "store" && (<>
        <CategoryStrip categories={categories} cat={cat} setCat={setCat} products={products} getProductCats={getProductCats} padH={padH} />

        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          key="phone-1"
          numColumns={1}
          contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 10 }}
          renderItem={({ item }) => {
            const status = getStockStatus(item.stock_quantity, item.low_stock_threshold);
            const prodCats = getProductCategoriesDisplay(item.id);
            const recentMoves = movements.filter(m => m.product_id === item.id && (m.status ?? "delivered") !== "pending").slice(0, 2);
            return (
              <ProductCard
                item={item}
                role={role}
                prodCats={prodCats}
                status={status}
                recentMoves={recentMoves}
                displayPrice={displayPriceOf(item)}
                unitName={defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"}
                isTablet={false}
                canEdit={canEdit}
                onPress={() => { setInfoProduct(item); setShowNameEdit(false); setNameInput(item.name); setShowUnitEdit(false); setUnitInput(defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"); }}
              />
            );
          }}
          ListEmptyComponent={<View style={{ backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.separatorSoft, borderRadius: radius.md, padding: 24, alignItems: "center", marginTop: 8 }}><Text style={{ color: palette.muted3, fontWeight: "500", fontSize: 13 }}>Pa gen pwodwi nan kategori sa</Text><Text style={{ color: palette.muted3, fontSize: 11, marginTop: 4 }}>Eseye yon lòt chèche oswa kategori</Text></View>}
        />
      </>)}

      {/* ── Incoming (Loading Dock) — pending batches awaiting delivery ── */}
      {stockTab === "incoming" && (
        <ScrollView contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 10 }} showsVerticalScrollIndicator={false}>
          {(pendingBatches.length + deliveredBatches.length) === 0 ? (
            <View style={{ backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.separatorSoft, borderRadius: radius.md, padding: 28, alignItems: "center", gap: 8, ...shadow.card }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="boat-outline" size={26} color={palette.accentGold} /></View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 4 }}>Poko gen livrezon ap vini</Text>
              <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center", lineHeight: 17 }}>Kreye yon livrezon via Ajoute → Nouvo Livrezon.{"\n"}Stòk la ap parèt nan "Nan magazen" sèlman lè li rive.</Text>
            </View>
          ) : [...pendingBatches, ...deliveredBatches].map(b => {
            const isPending = (b.status ?? "pending") === "pending";
            const movs = movements.filter(m => m.batch_id === b.id);
            const totalQty = movs.reduce((s, m) => s + (m.quantity || 0), 0);
            return (
              <View key={b.id} style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: isPending ? palette.accentGold : palette.successBd, padding: 14, ...shadow.card, overflow: "hidden" }}>
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
                  <Pressable onPress={() => { setDeliverBatch(b); setDeliverFee(""); }} disabled={delivering} style={{ marginTop: 10, backgroundColor: palette.success, paddingVertical: 12, borderRadius: radius.sm, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 }}>
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
          })}
        </ScrollView>
      )}

      {/* Edit existing - with catalog + stock history surprise (phone only) */}
      <Modal visible={!!selected} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(false, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "92%", overflow: "hidden" }}>
              <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>{selected?.name?.[0]?.toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>{selected?.name}</Text>
                    <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>{selected?.sku} · {selected && displayPriceOf(selected) ? `${fmt(displayPriceOf(selected))} HTG` : "—"} · {getProductCategoriesDisplay(selected?.id ?? "").map(c => c.name).join(" • ")}</Text>
                  </View>
                  <Pressable onPress={() => setSelected(null)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color={palette.muted} /></Pressable>
                </View>
                {editCatalog && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 10 }}>
                    {editCatalog.categoryIds.map(cid => {
                      const c = categories.find(x => x.id === cid);
                      return <View key={cid} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.ink2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill }}><Text style={{ color: "#fff", fontSize: 11 }}>{c?.icon}</Text><Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{c?.name}</Text></View>;
                    })}
                    <View style={{ backgroundColor: palette.successBg, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill }}><Text style={{ fontSize: 11, fontWeight: "700", color: palette.success }}>{selected?.stock_quantity} pcs</Text></View>
                  </ScrollView>
                )}
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 24 }}>
                {/* Catalog edit */}
                {editCatalog && (
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="pricetag-outline" size={15} color={palette.ink} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Katalòg — milti-kategori</Text></View>
                    <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>Chanje deskripsyon pwodwi a (pa stòk) — istwa pri konsève</Text>
                    <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 10 }}>Non*</Text>
                    <TextInput value={editCatalog.name} onChangeText={v => setEditCatalog({ ...editCatalog, name: v })} placeholder="Non" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} />
                    <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 10 }}>SKU</Text>
                    <TextInput value={editCatalog.sku} onChangeText={v => setEditCatalog({ ...editCatalog, sku: v })} placeholder="SKU" autoCapitalize="characters" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} />
                    <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 10 }}>Kategori ({editCatalog.categoryIds.length})</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
                      {categories.filter(c => c.id !== "all").map(c => {
                        const active = editCatalog.categoryIds.includes(c.id);
                        return <Pressable key={c.id} onPress={() => toggleEditCategory(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}><Text style={{ fontSize: 12 }}>{c.icon}</Text><Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#fff" : palette.ink }}>{c.name}</Text>{active && <Ionicons name="checkmark" size={12} color="#fff" />}</Pressable>;
                      })}
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Pri vant <Text style={{ fontWeight: "400", color: palette.muted3 }}>(opsyonèl)</Text></Text><TextInput value={editCatalog.selling_price} onChangeText={v => setEditCatalog({ ...editCatalog, selling_price: v })} placeholder="—" keyboardType="numeric" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} /></View>
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Seuil</Text><TextInput value={editCatalog.low} onChangeText={v => setEditCatalog({ ...editCatalog, low: v })} keyboardType="numeric" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} /></View>
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Inite</Text><TextInput value={editCatalog.unit} onChangeText={v => setEditCatalog({ ...editCatalog, unit: v })} placeholder="pcs" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, padding: 11, marginTop: 6, color: palette.ink }} /></View>
                    </View>
                    <Pressable onPress={handleCatalogSave} style={{ marginTop: 12, backgroundColor: palette.ink2, padding: 13, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>Sove katalòg</Text></Pressable>
                  </View>
                )}

                {/* Stock movements timeline — surprise */}
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="git-branch-outline" size={15} color={palette.accentGold} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Istwa mouvman — batch & frè transpò</Text></View>
                  <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>{movements.filter(m => m.product_id === selected?.id && (m.status ?? "delivered") !== "pending").length} mouvman • pri mwayèn {(() => { const ms = movements.filter(m => m.product_id === selected?.id && m.type === "in" && (m.status ?? "delivered") !== "pending"); if (!ms.length) return "—"; const avg = ms.reduce((s, m) => s + m.unit_cost, 0) / ms.length; return fmt(Math.round(avg)) + " HTG"; })()}</Text>
                  {movements.filter(m => m.product_id === selected?.id && (m.status ?? "delivered") !== "pending").length === 0 ? (
                    <View style={{ marginTop: 10, backgroundColor: palette.surfaceGrouped, padding: 14, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ fontSize: 12, color: palette.muted }}>Poko gen livrezon pou pwodwi sa</Text><Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>Ajoute via Inventaire (transpò ap kalkile) </Text></View>
                  ) : (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      {movements.filter(m => m.product_id === selected?.id && (m.status ?? "delivered") !== "pending").slice(0, 8).map(m => {
                        const batch = batches.find(b => b.id === m.batch_id);
                        return (
                          <View key={m.id} style={{ flexDirection: "row", gap: 10, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: m.type === "in" ? palette.successBg : palette.dangerBg, alignItems: "center", justifyContent: "center" }}><Ionicons name={m.type === "in" ? "arrow-down" : "arrow-up"} size={14} color={m.type === "in" ? palette.success : palette.danger} /></View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                <Text style={{ fontWeight: "700", fontSize: 12, color: palette.ink }}>{m.type === "in" ? "+" : "-"}{m.quantity} pcs · {fmt(m.unit_cost)} HTG</Text>
                                <Text style={{ fontSize: 11, color: palette.muted3 }}>{new Date(m.created_at).toLocaleDateString()}</Text>
                              </View>
                              <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>{batch?.reference ?? m.batch_id ?? "—"} {batch?.supplier ? `· ${batch.supplier}` : ""} {m.allocated_transport > 0 ? `· transpò ${fmt(Math.round(m.allocated_transport))} HTG` : ""}</Text>
                              <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 1 }}>Revient: {fmt(Math.round(m.total_cost / (m.quantity || 1)))} HTG/pcs • {m.reason ?? batch?.notes ?? ""}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Pressable onPress={() => { setShowHistory(true); setExpandedBatch(null); }} style={{ marginTop: 10, padding: 8, alignItems: "center" }}><Text style={{ fontSize: 12, color: palette.accentGold, fontWeight: "600" }}>Wè tout livrezon →</Text></Pressable>
                </View>

                {canAddMore && (
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                    <Text style={{ fontWeight: "600", fontSize: 13, color: palette.ink, letterSpacing: -0.1 }}>Ajuste stòk rapid (ak istwa)</Text>
                    <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>Kreye mouvman + batch otomatik — pa dirèk</Text>
                    <TextInput placeholder={selected ? `${selected.stock_quantity} pcs kounye a — kantite pou ajoute` : ""} placeholderTextColor={palette.muted3} value={editQty} onChangeText={setEditQty} keyboardType="numeric" style={{ borderWidth: 1, borderColor: editQty ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 10, fontWeight: "600", fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                  </View>
                )}

                {canReduce && (
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.dangerBd, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="warning-outline" size={15} color={palette.danger} />
                      <Text style={{ fontWeight: "600", fontSize: 13, color: palette.danger }}>Diminye stòk — Admin/Owner</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: palette.danger, marginTop: 2 }}>Rezon obligatwa (odit) — ap kreye mouvman out</Text>
                    <TextInput placeholder={selected ? `${selected.stock_quantity} pcs — kantite pou retire` : ""} placeholderTextColor={palette.muted3} value={reduceQty} onChangeText={setReduceQty} keyboardType="numeric" style={{ borderWidth: 1, borderColor: reduceQty ? palette.dangerBd : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 10, fontWeight: "600", fontSize: 14, color: palette.ink, backgroundColor: palette.warningBg }} />
                    <TextInput placeholder="Rezon — eg. erè antre, pwodwi gate" placeholderTextColor={palette.muted3} value={reduceReason} onChangeText={setReduceReason} style={{ borderWidth: 1, borderColor: reduceReason ? palette.dangerBd : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 13, color: palette.ink, backgroundColor: palette.surface }} />
                  </View>
                )}

                {canDelete ? (
                  <Pressable onPress={() => setShowDeleteConfirm(!showDeleteConfirm)} style={{ backgroundColor: showDeleteConfirm ? palette.danger : palette.surface, borderWidth: 1, borderColor: showDeleteConfirm ? palette.danger : palette.dangerBd, paddingVertical: 13, borderRadius: radius.sm, alignItems: "center" }}>
                    <Text style={{ color: showDeleteConfirm ? "#fff" : palette.danger, fontWeight: "600", fontSize: 13 }}>{showDeleteConfirm ? "✓ Konfime efase — tape Anrejistre" : "Efase pwodwi — Owner sèlman"}</Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                <Pressable onPress={() => { setSelected(null); setEditQty(""); setEditPrice(""); setReduceQty(""); setReduceReason(""); setShowDeleteConfirm(false); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Anile</Text></Pressable>
                <Pressable onPress={handleAddStock} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Anrejistre mouvman</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Product info — read-only, priority (mandatory → optional), phone only */}
      {infoProduct && (() => {
        const p = infoProduct;
        const isOut = p.stock_quantity <= 0;
        const isAlmost = !isOut && p.stock_quantity <= p.low_stock_threshold;
        const status = isOut
          ? { label: "EPUIZE", border: palette.dangerBd, bg: palette.dangerBg, text: palette.danger, dot: palette.dangerDot, accent: palette.danger, sub: "#FCA5A5" }
          : isAlmost
            ? { label: "FÈB", border: palette.warningBd, bg: palette.warningBg, text: palette.warning, dot: palette.warningDot, accent: palette.warning, sub: "#FDBA74" }
            : { label: "DISPONIB", border: palette.successBd, bg: palette.successBg, text: palette.success, dot: palette.successDot, accent: palette.success, sub: "#86EFAC" };
        const cats = getProductCategoriesDisplay(p.id);
        const deliveredMoves = movements.filter(m => m.product_id === p.id && (m.status ?? "delivered") !== "pending" && m.type === "in");
        const last = deliveredMoves[0];
        const batch = last ? batches.find(x => x.id === last.batch_id) : null;
        const revient = last && last.quantity ? Math.round(last.total_cost / last.quantity) : 0;
        const margin = displayPriceOf(p) > 0 && p.cost_price > 0 ? Math.round((1 - p.cost_price / displayPriceOf(p)) * 100) : 0;
        return (
          <Modal visible transparent animationType="slide" onRequestClose={() => setInfoProduct(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
              <View style={{ ...sheetBox(false, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "90%", overflow: "hidden" }}>
                <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
                  <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{p.name?.[0]?.toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>{p.name}</Text>
                      <Text style={{ color: palette.muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{p.sku ?? "—"}</Text>
                    </View>
                    <Pressable onPress={() => setInfoProduct(null)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color={palette.muted} /></Pressable>
                  </View>
                </View>
                <ScrollView style={{ padding: 14 }} contentContainerStyle={{ gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                  {/* 1 — Stòk disponib */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: status.border, padding: 14, ...shadow.card }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, color: status.sub, fontWeight: "700", letterSpacing: 0.6 }}>NAN STÒK</Text>
                        <Text style={{ fontWeight: "800", fontSize: 28, color: status.accent, letterSpacing: -1, lineHeight: 32 }}>{p.stock_quantity} <Text style={{ fontSize: 13, fontWeight: "600" }}>{defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs"}</Text></Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: status.bg, borderWidth: 1, borderColor: status.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status.dot }} />
                        <Text style={{ fontSize: 11, fontWeight: "800", color: status.text, letterSpacing: 0.3 }}>{status.label}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted, marginTop: 8 }}>Seuil fèb: {p.low_stock_threshold} {defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs"}{p.stock_quantity <= p.low_stock_threshold ? " — alèt ba" : ""}</Text>
                  </View>

                  {/* 2 — Pri */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="pricetag-outline" size={14} color={palette.ink} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Pri</Text></View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10 }}>
                        <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>PRI VANT</Text>
                        <Text style={{ fontSize: 18, fontWeight: "800", color: palette.ink, marginTop: 2, textAlign: "right", ...monoStyle }}>{displayPriceOf(p) ? `${fmt(displayPriceOf(p))} HTG` : "—"}</Text>
                      </View>
                      {role !== "cashier" && (
                        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10 }}>
                          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>PRI ACHA</Text>
                          <Text style={{ fontSize: 18, fontWeight: "800", color: palette.muted, marginTop: 2 }}>{p.cost_price ? `${fmt(p.cost_price)} HTG` : "—"}</Text>
                        </View>
                      )}
                    </View>
                    {(role !== "cashier" && margin > 0) && <Text style={{ fontSize: 11, color: margin >= 25 ? palette.success : palette.warning, fontWeight: "600", marginTop: 8 }}>Marge {margin}%{p.cost_price === 0 ? " (pri acha pa defini)" : ""}</Text>}
                  </View>

                  {/* 2b — Inite, Pri & Bundle (tout manyèl: faktè Box, Cold/Hot, bundle) */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cube-outline" size={14} color={palette.accentGold} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Inite, Pri & Bundle</Text></View>
                    <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>Tout chif se manyèl — Box Corona ×6, Box Prestige ×24, pri Cold/Hot, bundle pa pwodwi.</Text>

                    <Text style={{ fontWeight: "700", fontSize: 11, color: palette.ink, marginTop: 12 }}>INITE VANT</Text>
                    {infoUnits.map(u => (
                      <UnitRowEditor key={u.id} u={u} isBase={Number(u.conversion_factor) === 1} canEdit={canEdit} onSave={saveInfoUnit} onDelete={deleteInfoUnit} canDelete={infoUnits.length > 1} />
                    ))}
                    {canEdit && (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <TextInput placeholder="Box" placeholderTextColor={palette.muted3} value={newInfoUnitName} onChangeText={setNewInfoUnitName} style={{ flex: 2, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                        <TextInput placeholder="×6" placeholderTextColor={palette.muted3} value={newInfoUnitFactor} onChangeText={v => setNewInfoUnitFactor(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                        <Pressable onPress={addInfoUnit} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Ionicons name="add" size={18} color="#fff" /></Pressable>
                      </View>
                    )}

                    <Text style={{ fontWeight: "700", fontSize: 11, color: palette.ink, marginTop: 14 }}>PRI PA VARIANT</Text>
                    {infoPrices.length === 0 && <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 6 }}>Poko gen pri — ajoute Cold / Hot / Regular.</Text>}
                    {infoPrices.map(r => (
                      <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: palette.inkSoft }}>{infoUnits.find(x => x.id === r.unit_id)?.unit_name ?? "?"}</Text>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink, flex: 1 }}>{r.variant}</Text>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink }}>{fmt(Number(r.price))} HTG</Text>
                        {canEdit && <Pressable onPress={() => deleteInfoPrice(r)} hitSlop={8}><Ionicons name="trash-outline" size={15} color={palette.danger} /></Pressable>}
                      </View>
                    ))}
                    {canEdit && !showAddInfoPrice && (
                      <Pressable onPress={() => setShowAddInfoPrice(true)} style={{ marginTop: 8, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 12, color: palette.inkSoft }}>+ Ajoute pri</Text></Pressable>
                    )}
                    {canEdit && showAddInfoPrice && (
                      <View style={{ marginTop: 8, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, borderWidth: 0.5, borderColor: palette.hairline }}>
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                          {infoUnits.map(u => {
                            const active = (infoPriceUnit || infoUnits[0]?.id) === u.id;
                            return <Pressable key={u.id} onPress={() => setInfoPriceUnit(u.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}><Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : palette.ink }}>{u.unit_name}</Text></Pressable>;
                          })}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <TextInput placeholder="Cold" placeholderTextColor={palette.muted3} value={infoPriceVariant} onChangeText={setInfoPriceVariant} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                          <TextInput placeholder="Pri HTG" placeholderTextColor={palette.muted3} value={infoPriceValue} onChangeText={v => setInfoPriceValue(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <Pressable onPress={() => setShowAddInfoPrice(false)} style={{ flex: 1, paddingVertical: 11, backgroundColor: palette.surface, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 13 }}>Anile</Text></Pressable>
                          <Pressable onPress={addInfoPrice} style={{ flex: 1, paddingVertical: 11, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>✓ Ajoute</Text></Pressable>
                        </View>
                      </View>
                    )}

                    <Text style={{ fontWeight: "700", fontSize: 11, color: palette.ink, marginTop: 14 }}>BUNDLE</Text>
                    {infoBundles.length === 0 && <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 6 }}>Poko gen bundle — ex. 6 Cold Corona pou 900.</Text>}
                    {infoBundles.map(r => (
                      <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, backgroundColor: palette.accentGoldSoft, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 0.5, borderColor: palette.accentGold }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: palette.inkSoft }}>{infoUnits.find(x => x.id === r.unit_id)?.unit_name ?? "?"}</Text>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink, flex: 1 }}>{r.variant} · min {r.min_quantity}</Text>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: palette.accentGold }}>{fmt(Number(r.bundle_price))} HTG</Text>
                        {canEdit && <Pressable onPress={() => deleteInfoBundle(r)} hitSlop={8}><Ionicons name="trash-outline" size={15} color={palette.danger} /></Pressable>}
                      </View>
                    ))}
                    {canEdit && !showAddInfoBundle && (
                      <Pressable onPress={() => setShowAddInfoBundle(true)} style={{ marginTop: 8, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 12, color: palette.inkSoft }}>+ Ajoute bundle</Text></Pressable>
                    )}
                    {canEdit && showAddInfoBundle && (
                      <View style={{ marginTop: 8, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8, borderWidth: 0.5, borderColor: palette.hairline }}>
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                          {infoUnits.map(u => {
                            const active = (infoBundleUnit || infoUnits[0]?.id) === u.id;
                            return <Pressable key={u.id} onPress={() => setInfoBundleUnit(u.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}><Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : palette.ink }}>{u.unit_name}</Text></Pressable>;
                          })}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <TextInput placeholder="Cold" placeholderTextColor={palette.muted3} value={infoBundleVariant} onChangeText={setInfoBundleVariant} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                          <TextInput placeholder="Min qt" placeholderTextColor={palette.muted3} value={infoBundleMin} onChangeText={v => setInfoBundleMin(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                          <TextInput placeholder="Pri" placeholderTextColor={palette.muted3} value={infoBundlePrice} onChangeText={v => setInfoBundlePrice(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <Pressable onPress={() => setShowAddInfoBundle(false)} style={{ flex: 1, paddingVertical: 11, backgroundColor: palette.surface, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 13 }}>Anile</Text></Pressable>
                          <Pressable onPress={addInfoBundle} style={{ flex: 1, paddingVertical: 11, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>✓ Ajoute</Text></Pressable>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* 3 — Kategori */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="layers-outline" size={14} color={palette.ink} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Kategori ({cats.length})</Text></View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                      {cats.map(c => (
                        <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.surfaceGrouped, borderWidth: 1, borderColor: palette.separatorSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                          <Text style={{ fontSize: 12 }}>{c.icon}</Text>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink }}>{c.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* 4 — Dènye livrezon */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cube-outline" size={14} color={palette.accentGold} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Dènye livrezon</Text></View>
                    {!last ? (
                      <Text style={{ fontSize: 12, color: palette.muted, marginTop: 8 }}>Poko gen livrezon pou pwodwi sa.</Text>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8 }}>
                          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Referans</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, marginTop: 2 }} numberOfLines={1}>{batch?.reference ?? last.batch_id ?? "—"}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8 }}>
                          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Founisè</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, marginTop: 2 }} numberOfLines={1}>{batch?.supplier ?? "—"}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 8 }}>
                          <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "600" }}>Dat</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, marginTop: 2 }} numberOfLines={1}>{batch?.delivered_at ? new Date(batch.delivered_at).toLocaleDateString() : batch?.received_at ? new Date(batch.received_at).toLocaleDateString() : "—"}</Text>
                        </View>
                      </View>
                    )}
                    {revient > 0 && <Text style={{ fontSize: 11, color: palette.muted, marginTop: 8 }}>Pri acha (revient): {fmt(revient)} HTG/pcs{last && last.allocated_transport > 0 ? ` · transpò ${fmt(Math.round(last.allocated_transport))} HTG` : ""}</Text>}
                  </View>

                  {/* 5 — Aksyon */}
                  <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, overflow: "hidden" }}>
                    <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="flash-outline" size={14} color={palette.accentGold} />
                      <Text style={{ fontSize: 11, fontWeight: "800", color: palette.accentGold, letterSpacing: 0.8, textTransform: "uppercase" }}>Aksyon</Text>
                    </View>

                    <Pressable onPress={() => setShowNameEdit(!showNameEdit)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: 0.5, borderTopColor: palette.separatorSoft }}>
                      <Ionicons name="create-outline" size={18} color={palette.danger} style={{ marginRight: 12 }} />
                      <Text style={{ flex: 1, fontSize: 14, color: palette.danger, fontWeight: "500" }}>Chanje non</Text>
                      <Text style={{ fontSize: 13, color: palette.muted, fontWeight: "600" }} numberOfLines={1}>{p.name}</Text>
                      <Ionicons name={showNameEdit ? "chevron-up" : "chevron-forward"} size={18} color={palette.muted3} style={{ marginLeft: 8 }} />
                    </Pressable>
                    {showNameEdit && (
                      <View style={{ borderTopWidth: 0.5, borderTopColor: palette.separatorSoft, padding: 12, backgroundColor: palette.surface2 }}>
                        <Text style={{ fontSize: 11, color: palette.muted, marginBottom: 6 }}>Nouvo non</Text>
                        <TextInput
                          value={nameInput}
                          onChangeText={setNameInput}
                          placeholder={p.name}
                          style={{ borderWidth: 1, borderColor: nameInput ? palette.ink2 : palette.hairline, borderRadius: radius.sm, padding: 12, fontSize: 15, fontWeight: "600", color: palette.ink, backgroundColor: palette.surface }}
                        />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                          <Pressable onPress={() => { setShowNameEdit(false); setNameInput(p.name); }} style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 13 }}>Anile</Text></Pressable>
                          <Pressable onPress={handleChangeName} style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.danger, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.dangerBd, ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Sove non</Text></Pressable>
                        </View>
                      </View>
                    )}

                    <Pressable onPress={() => setShowUnitEdit(!showUnitEdit)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: 0.5, borderTopColor: palette.separatorSoft }}>
                      <Ionicons name="swap-horizontal-outline" size={18} color={palette.danger} style={{ marginRight: 12 }} />
                      <Text style={{ flex: 1, fontSize: 14, color: palette.danger, fontWeight: "500" }}>Chanje inite</Text>
                      <Text style={{ fontSize: 13, color: palette.muted, fontWeight: "600" }} numberOfLines={1}>{defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs"}</Text>
                      <Ionicons name={showUnitEdit ? "chevron-up" : "chevron-forward"} size={18} color={palette.muted3} style={{ marginLeft: 8 }} />
                    </Pressable>
                    {showUnitEdit && (
                      <View style={{ borderTopWidth: 0.5, borderTopColor: palette.separatorSoft, padding: 12, backgroundColor: palette.surface2 }}>
                        <Text style={{ fontSize: 11, color: palette.muted, marginBottom: 6 }}>Nouvo inite</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                          {["pcs", "sack", "kg", "L", "box"].map(u => {
                            const active = unitInput === u;
                            return <Pressable key={u} onPress={() => setUnitInput(u)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}><Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : palette.ink }}>{u}</Text></Pressable>;
                          })}
                        </View>
                        <TextInput
                          value={unitInput}
                          onChangeText={setUnitInput}
                          placeholder={defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs"}
                          style={{ borderWidth: 1, borderColor: unitInput ? palette.ink2 : palette.hairline, borderRadius: radius.sm, padding: 12, fontSize: 15, fontWeight: "600", color: palette.ink, backgroundColor: palette.surface, marginTop: 10 }}
                        />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                          <Pressable onPress={() => { setShowUnitEdit(false); setUnitInput(defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs"); }} style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 13 }}>Anile</Text></Pressable>
                          <Pressable onPress={handleChangeUnit} style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.danger, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.dangerBd, ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Sove inite</Text></Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                </ScrollView>
                <View style={{ padding: 14, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                  <Pressable onPress={() => setInfoProduct(null)} style={{ paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Fèmen</Text></Pressable>
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}
    </View>
  );
}
