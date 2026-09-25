import React from "react";
import { View, Text, FlatList, Pressable, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow, topIconBtn } from "../theme";
import { fmtG, monoStyle } from "../format";
import { useResponsive } from "../responsive";
import type { Role } from "../users";
import type { ProductUnit } from "../pricing";
import {
  type Category, type Product,
  SearchHeader, CategoryStrip, StockStatusPill, statusForProduct, isService, isAvailable, categoryDisplayIcon, ProductCard,
} from "./CatalogShared";
import { currentVariantPrice, type CatalogModel } from "../catalogModel";
import type { StepKey } from "./catalogFlow/CatalogFlowModal";

export interface CatalogTabletProps {
  role: Role;
  products: Product[];
  categories: Category[];
  q: string; setQ: React.Dispatch<React.SetStateAction<string>>;
  barcode: string; setBarcode: React.Dispatch<React.SetStateAction<string>>;
  cat: string; setCat: React.Dispatch<React.SetStateAction<string>>;
  filtered: Product[];
  canEdit: boolean;
  canAddMore: boolean; canReduce: boolean; canDelete: boolean;
  canViewCost: boolean; canToggleAvail: boolean; onToggleAvail: (p: Product) => void;
  displayPriceOf: (p: Product) => number;
  defaultUnitOf: (productId: string) => ProductUnit | null;
  getProductCats: (productId: string) => string[];
  getProductCategoriesDisplay: (productId: string) => Category[];
  infoProduct: Product | null; setInfoProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  tabletDetail: Product | null;
  showNameEdit: boolean; setShowNameEdit: React.Dispatch<React.SetStateAction<boolean>>;
  nameInput: string; setNameInput: React.Dispatch<React.SetStateAction<string>>;
  handleChangeName: () => void;
  v2: CatalogModel;
  supplierList: { id: string; name: string }[];
  getBaseCost: (productId: string) => number;
  onManageProduct: (productId: string, section?: StepKey) => void;
  onOpenProduct: (productId: string) => void;
}

/** Web Inventory KPI mini-card: white, hairline border, 2.5px left accent bar, dot-label + big value + muted sub. */
function KpiMini({ accent, label, value, sub, valueColor }: {
  accent: string; label: string; value: string; sub: string; valueColor?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 12, overflow: "hidden", ...shadow.soft }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2.5, backgroundColor: accent }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
        <Text style={{ fontSize: 9.5, fontWeight: "800", letterSpacing: 0.9, color: "#8e8e93" }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, fontWeight: "800", letterSpacing: -0.8, color: valueColor ?? "#fff", marginTop: 7, ...monoStyle }} numberOfLines={1}>{value}</Text>
      <Text style={{ fontSize: 10.5, color: "#8e8e93", marginTop: 3 }} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

/** Inspector metric tile on grouped bg (PRI VANT / KOUT / MAJ / STÒK). */
function MetricTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#2b2b2b", borderRadius: radius.sm, padding: 10 }}>
      <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.8 }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: "800", color: valueColor ?? "#fff", marginTop: 2, ...monoStyle }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Tablet master-detail: ledger master list + inspector detail card + placeholder. */
export function CatalogTablet(props: CatalogTabletProps) {
  const { width, padH } = useResponsive();
  const {
    role, products, categories,
    q, setQ, barcode, setBarcode, cat, setCat,
    filtered,
    canEdit, canAddMore, canReduce, canDelete, canViewCost, canToggleAvail, onToggleAvail, displayPriceOf, defaultUnitOf, getProductCats, getProductCategoriesDisplay,
    setInfoProduct, tabletDetail,
    infoProduct,
    showNameEdit, setShowNameEdit, nameInput, setNameInput, handleChangeName,
    v2, supplierList, getBaseCost, onManageProduct, onOpenProduct,
  } = props;

  // Web Inventory KPIs — all derived from props already passed by the shell.
  const lowList = products.filter(p => isService(p) ? false : p.stock_quantity <= p.low_stock_threshold);
  const lowCount = lowList.length;
  const totalValue = products.reduce((s, p) => s + p.stock_quantity * displayPriceOf(p), 0);
  const totalCost = products.reduce((s, p) => s + p.stock_quantity * getBaseCost(p.id), 0);
  const marginPct = totalValue > 0 ? ((totalValue - totalCost) / totalValue) * 100 : 0;

  const renderDetail = () => {
    if (!tabletDetail) {
      return (
        <View style={{ flex: 1, backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 24, alignItems: "center", justifyContent: "center", ...shadow.soft }}>
          <Ionicons name="cube-outline" size={28} color="#636366" />
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff", marginTop: 10, textAlign: "center" }}>Chwazi yon pwodwi pou wè detay</Text>
          <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 4, textAlign: "center" }}>Tape yon pwodwi nan lis la</Text>
        </View>
      );
    }
    const p = tabletDetail;
    const tStatus = statusForProduct(p);
    const tCats = getProductCategoriesDisplay(p.id);
    const tItems = v2.items.filter(i => i.product_id === p.id && !i.is_deleted)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const tItemIds = new Set(tItems.map(i => i.id));
    const tBatches = v2.batches
      .filter(b => tItemIds.has(String(b.item_id)) && !b.is_deleted)
      .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    const tLast = tBatches.find(b => b.status === "received") ?? tBatches[0] ?? null;
    const tUnitName = defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs";
    const tPrice = displayPriceOf(p);
    const tCost = getBaseCost(p.id);
    const tMargin = tPrice > 0 && tCost > 0 ? ((tPrice - tCost) / tPrice) * 100 : null;
    const tRecent = tBatches.slice(0, 5);
    const tVariants = v2.variants.filter(v => tItemIds.has(String(v.item_id)) && !v.is_deleted);
    const supName = (id: string) => supplierList.find(s => s.id === id)?.name ?? "—";
    const itemName = (id: string) => v2.items.find(i => i.id === id)?.name ?? "?";
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        {/* Inspector header: initial tile, name + status pill, sku line */}
        <View style={{ backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 14, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{p.name?.[0]?.toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16, color: "#fff", letterSpacing: -0.2 }} numberOfLines={2}>{p.name}</Text>
              <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 1 }} numberOfLines={1}>{p.sku ?? "—"}</Text>
            </View>
            <Pressable onPress={() => setInfoProduct(null)} style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={topIconBtn.iconSize} color={topIconBtn.icon} /></Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
            {isService(p) ? (
              <Text style={{ fontWeight: "800", fontSize: 20, color: isAvailable(p) ? palette.success : palette.warning }}>
                {isAvailable(p) ? "Disponib" : "Koupe"}
              </Text>
            ) : (
              <Text style={{ fontWeight: "800", fontSize: 24, color: tStatus.accent, ...monoStyle }}>{p.stock_quantity} <Text style={{ fontSize: 12, fontWeight: "600" }}>{tUnitName}</Text></Text>
            )}
            <StockStatusPill status={tStatus} large />
          </View>
          {isService(p) ? (
            <Text style={{ fontSize: 11, color: isAvailable(p) ? palette.success : palette.warning, marginTop: 6, fontWeight: "700" }}>
              {isAvailable(p) ? "Sèvis — parèt nan vant" : "Sèvis koupe (86) — kache nan vant"}
            </Text>
          ) : (
            <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 6 }}>Seuil fèb: {p.low_stock_threshold} {tUnitName}</Text>
          )}
        </View>
        {/* 2-col metric tiles: PRI VANT / KOUT / MAJ / STÒK */}
        <View style={{ backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Pri</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <MetricTile label="PRI VANT" value={tPrice ? `${fmtG(tPrice)}` : "—"} />
            {canViewCost && (
              <MetricTile label="KOUT" value={p.cost_price ? `${fmtG(p.cost_price)}` : "—"} valueColor="#8e8e93" />
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {canViewCost && (
              <MetricTile
                label="MAJ"
                value={tMargin !== null ? `${tMargin.toFixed(1)}%` : "—"}
                valueColor={tMargin !== null ? (tMargin >= 20 ? palette.success : palette.warning) : "#fff"}
              />
            )}
            <MetricTile label="STÒK" value={isService(p) ? (isAvailable(p) ? "Disponib" : "Koupe") : `${p.stock_quantity} ${tUnitName}`} valueColor={isService(p) ? (isAvailable(p) ? palette.success : palette.warning) : tStatus.accent} />
          </View>
          {tVariants.length > 0 && (
            <View style={{ marginTop: 10, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {tVariants.map(v => {
                const cur = currentVariantPrice(v2.variantPrices, v.id);
                return (
                  <View key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#8e8e93" }}>{itemName(String(v.item_id))}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff", flex: 1 }}>{v.name}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff", ...monoStyle }}>{cur ? fmtG(Number(cur.price)) : "—"}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        {/* Units & prices — hairline ledger rows */}
        <View style={{ backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Inite ({tItems.length})</Text>
          {tItems.length ? (
            <View style={{ marginTop: 4, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {tItems.map(u => {
                const smaller = u.ref_item_id ? v2.items.find(i => i.id === u.ref_item_id) : null;
                return (
                  <View key={u.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>{u.name}</Text>
                    <Text style={{ fontSize: 11, color: "#8e8e93", ...monoStyle }}>{smaller ? `×${Number(u.ratio)} ${smaller.name}` : "baz"}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 8 }}>Poko gen inite — jere via Inite.</Text>
          )}
          {canEdit && (
            <Pressable onPress={() => onManageProduct(p.id, "items")} style={{ marginTop: 10, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Jere inite, variant & pri →</Text>
            </Pressable>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {tCats.map(c => {
              const gi = categoryDisplayIcon(c);
              return (
                <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 }}>
                  {gi ? <Ionicons name={gi} size={12} color={"#fff"} /> : <Text style={{ fontSize: 11 }}>{c.icon}</Text>}
                  <Text style={{ fontSize: 11, fontWeight: "600", color: "#fff" }}>{c.name}</Text>
                </View>
              );
            })}
          </View>
        </View>
        {/* Recent batches ledger (v2 — pri acha antre isit la sèlman) */}
        <View style={{ backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Dènye batch</Text>
          {!tLast ? (
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 8 }}>Poko gen batch pou pwodwi sa.</Text>
          ) : (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }} numberOfLines={1}>{itemName(String(tLast.item_id))} · {fmtG(Number(tLast.quantity))}</Text>
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{supName(String(tLast.supplier_id))} · {tLast.date} · {fmtG(Math.round(Number(tLast.total_paid)))}</Text>
            </View>
          )}
          {tRecent.length > 0 && (
            <View style={{ marginTop: 6, borderTopWidth: 0.5, borderColor: "#262626" }}>
              {tRecent.map(m => (
                <View key={m.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: "#262626" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ backgroundColor: m.status === "received" ? palette.successBg : m.status === "denied" ? palette.dangerBg : palette.warningBg, borderWidth: 0.5, borderColor: m.status === "received" ? palette.successBd : m.status === "denied" ? palette.dangerBd : palette.warningBd, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: m.status === "received" ? palette.success : m.status === "denied" ? palette.danger : palette.warning }}>+{m.quantity}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: "#8e8e93" }}>{itemName(String(m.item_id))}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: "#8e8e93", ...monoStyle }}>{fmtG(Math.round(Number(m.total_paid)))}</Text>
                </View>
              ))}
            </View>
          )}
          {canEdit ? (<Pressable onPress={() => onManageProduct(p.id, "batch")} style={{ marginTop: 10, padding: 8, alignItems: "center" }}><Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Jere batch →</Text></Pressable>) : null}
        </View>
        <View style={{ backgroundColor: "#1C1C1E", borderRadius: radius.md, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 12, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Aksyon</Text>
          {isService(p) && canToggleAvail && (
            <Pressable onPress={() => onToggleAvail(p)} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, backgroundColor: isAvailable(p) ? palette.successBg : palette.warningBg, borderWidth: 1, borderColor: isAvailable(p) ? palette.successBd : palette.warningBd, borderRadius: radius.sm, padding: 12 }}>
              <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: isAvailable(p) ? palette.success : palette.muted3, justifyContent: "center", paddingHorizontal: 2, alignItems: isAvailable(p) ? "flex-end" : "flex-start" }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
              </View>
              <Text style={{ fontWeight: "800", fontSize: 13, color: isAvailable(p) ? palette.success : palette.warning }}>{isAvailable(p) ? "Disponib" : "Koupe"}</Text>
            </Pressable>
          )}
          {infoProduct && canAddMore && (
            <>
              <Pressable onPress={() => infoProduct && onOpenProduct(infoProduct.id)} style={{ marginTop: 8, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}><Ionicons name="create-outline" size={15} color="#fff" /><Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Modifye pwodwi</Text></Pressable>
              <Pressable onPress={() => setShowNameEdit(v => !v)} style={{ marginTop: 8, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 12, color: "#8e8e93" }}>Chanje non</Text></Pressable>
              {showNameEdit && (
                <View style={{ marginTop: 8, gap: 8 }}>
                  <TextInput value={nameInput} onChangeText={setNameInput} placeholder={p.name} placeholderTextColor="#636366" style={{ borderWidth: 0.5, borderColor: "#3a3a3c", borderRadius: radius.sm, padding: 10, fontSize: 14, color: "#fff", backgroundColor: "#000" }} />
                  <Pressable onPress={handleChangeName} style={{ paddingVertical: 11, backgroundColor: "#2b2b2b", borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Sove non</Text></Pressable>
                </View>
              )}
              {canEdit && (
                <Pressable onPress={() => onManageProduct(p.id)} style={{ marginTop: 8, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}><Ionicons name="settings-outline" size={15} color="#fff" /><Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Jere inite, variant, pri & batch</Text></Pressable>
              )}
            </>
          )}
          <Pressable onPress={() => onOpenProduct(p.id)} style={{ marginTop: 8, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Wè detay konplè</Text><Ionicons name="chevron-forward" size={14} color="#8e8e93" /></Pressable>
          <Pressable onPress={() => setInfoProduct(null)} style={{ marginTop: 8, paddingVertical: 12, backgroundColor: "#fff", borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>Fèmen</Text></Pressable>
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, width: "100%" }}>
      {/* Web Inventory page header */}
      <View style={{ paddingHorizontal: padH, paddingTop: 14, paddingBottom: 2 }}>
        <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 1.2, color: "#8e8e93" }}>ESTÒK • ENVANTÈ</Text>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: "#fff", marginTop: 4 }}>Katalòg</Text>
        <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4, lineHeight: 18 }}>Pwodwi ak sèvis — pri, kategori, disponiblite.</Text>
        <View style={{ flexDirection: "row", marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#3a3a3c", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: lowCount > 0 ? palette.dangerDot : palette.successDot }} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>{products.length} pwodwi • {lowCount} fèb</Text>
          </View>
        </View>
      </View>

      {/* Web Inventory KPI strip */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: padH, marginTop: 12 }}>
        <KpiMini accent={palette.successDot} label="ATIK TOTAL" value={String(products.length)} sub={`${filtered.length} vizib • ${categories.length - 1} kategori`} />
        <KpiMini accent={palette.blue} label="VALÈ TOTAL" value={`${fmtG(Math.round(totalValue))}`} sub="Pri vant × kantite" />
        <KpiMini
          accent={palette.warningDot}
          label="MAJ %"
          value={`${marginPct.toFixed(1)}%`}
          valueColor={marginPct >= 20 ? palette.success : palette.warning}
          sub={`Pwofi ${fmtG(Math.round(totalValue - totalCost))}`}
        />
        <KpiMini
          accent={lowCount > 0 ? palette.danger : palette.violet}
          label="STÒK FÈB"
          value={String(lowCount)}
          valueColor={lowCount > 0 ? palette.danger : palette.ink}
          sub={lowCount > 0 ? lowList.slice(0, 2).map(x => x.name).join(", ") + (lowCount > 2 ? ` +${lowCount - 2}` : "") : "Tout atik stab"}
        />
      </View>

      <View style={{ flex: 1, flexDirection: "row", gap: 12, padding: padH }}>
        <View style={{ flex: 3 }}>
          <SearchHeader q={q} setQ={setQ} barcode={barcode} setBarcode={setBarcode} padH={padH} />

          <>
            <CategoryStrip categories={categories} cat={cat} setCat={setCat} products={products} getProductCats={getProductCats} padH={padH} />
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 12 }}
              renderItem={({ item, index }) => (
                <ProductCard
                  item={item}
                  role={role}
                  prodCats={getProductCategoriesDisplay(item.id)}
                  status={statusForProduct(item)}
                  recentMoves={[]}
                  displayPrice={displayPriceOf(item)}
                  unitName={defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"}
                  isTablet={false}
                  canEdit={canEdit}
                  canViewCost={canViewCost}
                  canToggleAvail={canToggleAvail}
                  selected={tabletDetail?.id === item.id}
                  isFirst={index === 0}
                  isLast={index === filtered.length - 1}
                  stockItems={v2.items}
                  variants={v2.variants}
                  baseCost={getBaseCost(item.id)}
                  onPress={() => { setInfoProduct(item); setShowNameEdit(false); setNameInput(item.name); }}
                />
              )}
              ListEmptyComponent={<View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 24, alignItems: "center", marginTop: 8 }}><Text style={{ color: "#8e8e93", fontWeight: "500", fontSize: 13 }}>Pa gen pwodwi nan kategori sa</Text><Text style={{ color: "#8e8e93", fontSize: 11, marginTop: 4 }}>Eseye yon lòt chèche oswa kategori</Text></View>}
            />
          </>

        </View>
        <View style={{ flex: 2, minWidth: 300 }}>
          {renderDetail()}
        </View>
      </View>
    </View>
  );
}
