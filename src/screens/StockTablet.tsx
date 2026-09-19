import React from "react";
import { View, Text, FlatList, Pressable, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../theme";
import { fmt, monoStyle } from "../format";
import { useResponsive, centerBox } from "../responsive";
import type { Role } from "../users";
import type { ProductUnit, ProductPrice } from "../pricing";
import {
  type Category, type Product, type StockBatch, type StockMovement, type StockTab,
  SearchHeader, CategoryStrip, StockStatusPill, getStockStatus,
} from "./StockShared";

export interface StockTabletProps {
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
  canEdit: boolean;
  displayPriceOf: (p: Product) => number;
  defaultUnitOf: (productId: string) => ProductUnit | null;
  getProductCats: (productId: string) => string[];
  getProductCategoriesDisplay: (productId: string) => Category[];
  selected: Product | null; setSelected: React.Dispatch<React.SetStateAction<Product | null>>;
  infoProduct: Product | null; setInfoProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  tabletDetail: Product | null;
  infoUnits: ProductUnit[]; infoPrices: ProductPrice[];
  showNameEdit: boolean; setShowNameEdit: React.Dispatch<React.SetStateAction<boolean>>;
  nameInput: string; setNameInput: React.Dispatch<React.SetStateAction<string>>;
  handleChangeName: () => void;
  showUnitEdit: boolean; setShowUnitEdit: React.Dispatch<React.SetStateAction<boolean>>;
  unitInput: string; setUnitInput: React.Dispatch<React.SetStateAction<string>>;
  handleChangeUnit: () => void;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandedBatch: React.Dispatch<React.SetStateAction<string | null>>;
  setDeliverBatch: React.Dispatch<React.SetStateAction<StockBatch | null>>;
  setDeliverFee: React.Dispatch<React.SetStateAction<string>>;
  delivering: boolean;
}

/** Web Inventory KPI mini-card: white, hairline border, 2.5px left accent bar, dot-label + big value + muted sub. */
function KpiMini({ accent, label, value, sub, valueColor }: {
  accent: string; label: string; value: string; sub: string; valueColor?: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12, overflow: "hidden", ...shadow.soft }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2.5, backgroundColor: accent }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
        <Text style={{ fontSize: 9.5, fontWeight: "800", letterSpacing: 0.9, color: palette.muted2 }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 18, fontWeight: "800", letterSpacing: -0.8, color: valueColor ?? palette.ink, marginTop: 7, ...monoStyle }} numberOfLines={1}>{value}</Text>
      <Text style={{ fontSize: 10.5, color: palette.muted, marginTop: 3 }} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

/** Inspector metric tile on grouped bg (PRI VANT / KOUT / MAJ / STÒK). */
function MetricTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10 }}>
      <Text style={{ fontSize: 10, color: palette.muted3, fontWeight: "800", letterSpacing: 0.8 }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: "800", color: valueColor ?? palette.ink, marginTop: 2, ...monoStyle }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Tablet master-detail: ledger master list + inspector detail card + placeholder. */
export function StockTablet(props: StockTabletProps) {
  const { width, padH } = useResponsive();
  const {
    role, products, categories, batches, movements,
    q, setQ, barcode, setBarcode, cat, setCat, stockTab, setStockTab,
    avgTransportShare, filtered, pendingBatches, deliveredBatches,
    canEdit, displayPriceOf, defaultUnitOf, getProductCats, getProductCategoriesDisplay,
    setSelected, setInfoProduct, tabletDetail,
    infoProduct, infoUnits, infoPrices,
    showNameEdit, setShowNameEdit, nameInput, setNameInput, handleChangeName,
    showUnitEdit, setShowUnitEdit, unitInput, setUnitInput, handleChangeUnit,
    setShowHistory, setExpandedBatch, setDeliverBatch, setDeliverFee, delivering,
  } = props;

  // Web Inventory KPIs — all derived from props already passed by the shell.
  const lowList = products.filter(p => p.stock_quantity <= p.low_stock_threshold);
  const lowCount = lowList.length;
  const totalValue = products.reduce((s, p) => s + p.stock_quantity * displayPriceOf(p), 0);
  const totalCost = products.reduce((s, p) => s + p.stock_quantity * (Number(p.cost_price) || 0), 0);
  const marginPct = totalValue > 0 ? ((totalValue - totalCost) / totalValue) * 100 : 0;

  const renderDetail = () => {
    if (!tabletDetail) {
      return (
        <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 24, alignItems: "center", justifyContent: "center", ...shadow.soft }}>
          <Ionicons name="cube-outline" size={28} color={palette.muted3} />
          <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 10, textAlign: "center" }}>Chwazi yon pwodwi pou wè detay</Text>
          <Text style={{ fontSize: 12, color: palette.muted, marginTop: 4, textAlign: "center" }}>Tape yon pwodwi nan lis la</Text>
        </View>
      );
    }
    const p = tabletDetail;
    const tStatus = getStockStatus(p.stock_quantity, p.low_stock_threshold);
    const tCats = getProductCategoriesDisplay(p.id);
    const tDelivered = movements.filter(m => m.product_id === p.id && (m.status ?? "delivered") !== "pending" && m.type === "in");
    const tLast = tDelivered[0];
    const tBatch = tLast ? batches.find(x => x.id === tLast.batch_id) : null;
    const tUnitName = defaultUnitOf(p.id)?.unit_name ?? p.unit ?? "pcs";
    const tPrice = displayPriceOf(p);
    const tCost = Number(p.cost_price) || 0;
    const tMargin = tPrice > 0 ? ((tPrice - tCost) / tPrice) * 100 : null;
    const tRecent = movements.filter(m => m.product_id === p.id && (m.status ?? "delivered") !== "pending").slice(0, 5);
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        {/* Inspector header: initial tile, name + status pill, sku line */}
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 14, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{p.name?.[0]?.toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={2}>{p.name}</Text>
              <Text style={{ color: palette.muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{p.sku ?? "—"}</Text>
            </View>
            <Pressable onPress={() => { setInfoProduct(null); setSelected(null); }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={15} color={palette.muted} /></Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
            <Text style={{ fontWeight: "800", fontSize: 24, color: tStatus.accent, ...monoStyle }}>{p.stock_quantity} <Text style={{ fontSize: 12, fontWeight: "600" }}>{tUnitName}</Text></Text>
            <StockStatusPill status={tStatus} large />
          </View>
          <Text style={{ fontSize: 11, color: palette.muted, marginTop: 6 }}>Seuil fèb: {p.low_stock_threshold} {tUnitName}</Text>
        </View>
        {/* 2-col metric tiles: PRI VANT / KOUT / MAJ / STÒK */}
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Pri</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <MetricTile label="PRI VANT" value={tPrice ? `${fmt(tPrice)} HTG` : "—"} />
            {role !== "cashier" && (
              <MetricTile label="KOUT" value={p.cost_price ? `${fmt(p.cost_price)} HTG` : "—"} valueColor={palette.muted} />
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {role !== "cashier" && (
              <MetricTile
                label="MAJ"
                value={tMargin !== null ? `${tMargin.toFixed(1)}%` : "—"}
                valueColor={tMargin !== null ? (tMargin >= 20 ? palette.success : palette.warning) : palette.ink}
              />
            )}
            <MetricTile label="STÒK" value={`${p.stock_quantity} ${tUnitName}`} valueColor={tStatus.accent} />
          </View>
          {infoProduct && infoPrices.length > 0 && (
            <View style={{ marginTop: 10, borderTopWidth: 0.5, borderColor: palette.hairline }}>
              {infoPrices.map(r => (
                <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: palette.inkSoft }}>{infoUnits.find(x => x.id === r.unit_id)?.unit_name ?? "?"}</Text>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink, flex: 1 }}>{r.variant}</Text>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: palette.ink, ...monoStyle }}>{fmt(Number(r.price))} HTG</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {/* Units & prices — hairline ledger rows */}
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Inite ({infoProduct ? infoUnits.length : 1})</Text>
          {infoProduct ? (
            <View style={{ marginTop: 4, borderTopWidth: 0.5, borderColor: palette.hairline }}>
              {infoUnits.map(u => (
                <View key={u.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: palette.ink }}>{u.unit_name}</Text>
                  <Text style={{ fontSize: 11, color: palette.muted, ...monoStyle }}>×{u.conversion_factor}</Text>
                </View>
              ))}
              {infoUnits.length === 0 && <Text style={{ fontSize: 12, color: palette.muted, paddingVertical: 9 }}>{tUnitName} ×1</Text>}
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: palette.ink, marginTop: 8 }}>{tUnitName} ×1</Text>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {tCats.map(c => (
              <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.separatorSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 }}>
                <Text style={{ fontSize: 11 }}>{c.icon}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>{c.name}</Text>
              </View>
            ))}
          </View>
        </View>
        {/* Recent movements ledger */}
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 14, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Dènye livrezon</Text>
          {!tLast ? (
            <Text style={{ fontSize: 12, color: palette.muted, marginTop: 8 }}>Poko gen livrezon pou pwodwi sa.</Text>
          ) : (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink }} numberOfLines={1}>{tBatch?.reference ?? tLast.batch_id ?? "—"}</Text>
              <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>{tBatch?.supplier ?? "—"} · {tLast.quantity} pcs · {fmt(Math.round(tLast.total_cost))} HTG</Text>
            </View>
          )}
          {tRecent.length > 0 && (
            <View style={{ marginTop: 6, borderTopWidth: 0.5, borderColor: palette.hairline }}>
              {tRecent.map(m => {
                const isIn = m.type === "in";
                return (
                  <View key={m.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ backgroundColor: isIn ? palette.successBg : palette.dangerBg, borderWidth: 0.5, borderColor: isIn ? palette.successBd : palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: isIn ? palette.success : palette.danger }}>{m.type === "in" ? "+" : "-"}{m.quantity}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: palette.muted }}>pcs</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted, ...monoStyle }}>{fmt(Math.round(m.total_cost))} HTG</Text>
                  </View>
                );
              })}
            </View>
          )}
          <Pressable onPress={() => { setShowHistory(true); setExpandedBatch(null); }} style={{ marginTop: 10, padding: 8, alignItems: "center" }}><Text style={{ fontSize: 12, color: palette.accentGold, fontWeight: "600" }}>Wè tout livrezon →</Text></Pressable>
        </View>
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 12, ...shadow.soft }}>
          <Text style={{ fontWeight: "700", fontSize: 12, color: palette.ink }}>Aksyon</Text>
          {infoProduct && (
            <>
              <Pressable onPress={() => setShowNameEdit(v => !v)} style={{ marginTop: 8, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.inkSoft }}>Chanje non</Text></Pressable>
              {showNameEdit && (
                <View style={{ marginTop: 8, gap: 8 }}>
                  <TextInput value={nameInput} onChangeText={setNameInput} placeholder={p.name} placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                  <Pressable onPress={handleChangeName} style={{ paddingVertical: 11, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Sove non</Text></Pressable>
                </View>
              )}
              <Pressable onPress={() => setShowUnitEdit(v => !v)} style={{ marginTop: 8, paddingVertical: 11, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 12, color: palette.inkSoft }}>Chanje inite ({tUnitName})</Text></Pressable>
              {showUnitEdit && (
                <View style={{ marginTop: 8, gap: 8 }}>
                  <TextInput value={unitInput} onChangeText={setUnitInput} placeholder={tUnitName} placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                  <Pressable onPress={handleChangeUnit} style={{ paddingVertical: 11, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Sove inite</Text></Pressable>
                </View>
              )}
            </>
          )}
          <Pressable onPress={() => { setInfoProduct(null); setSelected(null); }} style={{ marginTop: 8, paddingVertical: 12, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Fèmen</Text></Pressable>
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, width: "100%" }}>
      {/* Web Inventory page header */}
      <View style={{ paddingHorizontal: padH, paddingTop: 14, paddingBottom: 2 }}>
        <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 1.2, color: palette.muted2 }}>ESTÒK • ENVANTÈ</Text>
        <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: palette.ink, marginTop: 4 }}>Stòk & Envantè</Text>
        <Text style={{ fontSize: 13, color: palette.muted, marginTop: 4, lineHeight: 18 }}>Filtre kategori, bakod, valè total, maj, ak mouvman.</Text>
        <View style={{ flexDirection: "row", marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: lowCount > 0 ? palette.dangerDot : palette.successDot }} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink }}>{products.length} pwodwi • {lowCount} fèb</Text>
          </View>
        </View>
      </View>

      {/* Web Inventory KPI strip */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: padH, marginTop: 12 }}>
        <KpiMini accent={palette.successDot} label="ATIK TOTAL" value={String(products.length)} sub={`${filtered.length} vizib • ${categories.length - 1} kategori`} />
        <KpiMini accent={palette.blue} label="VALÈ TOTAL" value={`${fmt(Math.round(totalValue))} HTG`} sub="Pri vant × kantite" />
        <KpiMini
          accent={palette.warningDot}
          label="MAJ %"
          value={`${marginPct.toFixed(1)}%`}
          valueColor={marginPct >= 20 ? palette.success : palette.warning}
          sub={`Pwofi ${fmt(Math.round(totalValue - totalCost))} HTG`}
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
          <SearchHeader q={q} setQ={setQ} barcode={barcode} setBarcode={setBarcode} stockTab={stockTab} setStockTab={setStockTab} pendingCount={pendingBatches.length} avgTransportShare={avgTransportShare} padH={padH} />

          {stockTab === "store" && (<>
            <CategoryStrip categories={categories} cat={cat} setCat={setCat} products={products} getProductCats={getProductCats} padH={padH} />
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 8 }}
              renderItem={({ item }) => {
                const status = getStockStatus(item.stock_quantity, item.low_stock_threshold);
                const isSel = tabletDetail?.id === item.id;
                const price = displayPriceOf(item);
                const unitName = defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs";
                const onPress = () => { setInfoProduct(item); setShowNameEdit(false); setNameInput(item.name); setShowUnitEdit(false); setUnitInput(defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"); };
                const rowStyle = isSel
                  ? { backgroundColor: palette.ink2, borderColor: palette.ink2 }
                  : { backgroundColor: palette.surface, borderColor: palette.hairline };
                const subColor = isSel ? "rgba(255,255,255,0.65)" : palette.muted;
                const faintColor = isSel ? "rgba(255,255,255,0.55)" : palette.muted3;
                const inner = (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <StockStatusPill status={status} />
                        <Text style={{ fontSize: 11, fontWeight: "600", color: subColor }}>{item.stock_quantity} {unitName} an stòk</Text>
                      </View>
                      <Text style={{ fontWeight: "700", fontSize: 14.5, color: isSel ? "#fff" : palette.ink, marginTop: 6, letterSpacing: -0.2 }} numberOfLines={1}>{item.name}</Text>
                      {role !== "cashier" ? (
                        <Text style={{ color: subColor, fontSize: 12, marginTop: 3, fontWeight: "400" }} numberOfLines={1}>{item.sku ?? "—"} · <Text style={{ color: faintColor }}>{item.cost_price ? `${fmt(item.cost_price)} HTG →` : "— →"}</Text> <Text style={{ color: isSel ? palette.accentGold : palette.ink, fontWeight: "600", ...monoStyle }}>{price ? `${fmt(price)} HTG` : "—"}</Text></Text>
                      ) : (
                        <Text style={{ color: subColor, fontSize: 12, marginTop: 3, fontWeight: "400" }} numberOfLines={1}>{item.sku ?? "—"} · <Text style={{ color: isSel ? palette.accentGold : palette.ink, fontWeight: "600" }}>{price ? `${fmt(price)} HTG` : "—"}</Text></Text>
                      )}
                      <Text style={{ color: faintColor, fontSize: 11, marginTop: 2, fontWeight: "500" }}>Seuil fèb {item.low_stock_threshold} · {item.stock_quantity} pcs · {unitName}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", justifyContent: "center", minWidth: 64 }}>
                      <Text style={{ fontWeight: "800", fontSize: 22, color: isSel ? palette.accentGold : status.accent, letterSpacing: -0.6, lineHeight: 22, ...monoStyle }}>{item.stock_quantity}</Text>
                      <Text style={{ fontSize: 10, color: isSel ? "rgba(255,255,255,0.55)" : status.sub, fontWeight: "700", letterSpacing: 0.6, marginTop: 2 }}>NAN STÒK</Text>
                    </View>
                  </View>
                );
                return canEdit ? (
                  <Pressable onPress={onPress} style={[{ borderWidth: 0.5, borderRadius: radius.md, padding: 13 }, rowStyle]}>{inner}</Pressable>
                ) : (
                  <View style={[{ borderWidth: 0.5, borderRadius: radius.md, padding: 13 }, rowStyle]}>{inner}</View>
                );
              }}
              ListEmptyComponent={<View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.separatorSoft, borderRadius: radius.md, padding: 24, alignItems: "center", marginTop: 8 }}><Text style={{ color: palette.muted3, fontWeight: "500", fontSize: 13 }}>Pa gen pwodwi nan kategori sa</Text><Text style={{ color: palette.muted3, fontSize: 11, marginTop: 4 }}>Eseye yon lòt chèche oswa kategori</Text></View>}
            />
          </>)}

          {stockTab === "incoming" && (
            <ScrollView contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 10, width: "100%" }} showsVerticalScrollIndicator={false}>
              {(pendingBatches.length + deliveredBatches.length) === 0 ? (
                <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.separatorSoft, borderRadius: radius.md, padding: 28, alignItems: "center", gap: 8, ...shadow.soft }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="boat-outline" size={26} color={palette.accentGold} /></View>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, marginTop: 4 }}>Poko gen livrezon ap vini</Text>
                  <Text style={{ fontSize: 12, color: palette.muted, textAlign: "center", lineHeight: 17 }}>Kreye yon livrezon via Ajoute → Nouvo Livrezon.{"\n"}Stòk la ap parèt nan "Nan magazen" sèlman lè li rive.</Text>
                </View>
              ) : [...pendingBatches, ...deliveredBatches].map(b => {
                const isPending = (b.status ?? "pending") === "pending";
                const movs = movements.filter(m => m.batch_id === b.id);
                const totalQty = movs.reduce((s, m) => s + (m.quantity || 0), 0);
                return (
                  <View key={b.id} style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 0.5, borderColor: isPending ? palette.accentGold : palette.successBd, padding: 14, ...shadow.soft, overflow: "hidden" }}>
                    <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: isPending ? palette.accentGold : palette.success }} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{b.reference}</Text>
                          {isPending ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accentGold }} />
                              <Text style={{ fontSize: 10, fontWeight: "800", color: palette.accentGold, letterSpacing: 0.3 }}>AP VINI</Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderWidth: 0.5, borderColor: palette.successBd, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
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
                      <View style={{ marginTop: 10, backgroundColor: palette.successBg, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, borderWidth: 0.5, borderColor: palette.successBd }}>
                        <Ionicons name="checkmark-circle" size={15} color={palette.success} />
                        <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>Nan stòk depi {b.delivered_at ? new Date(b.delivered_at).toLocaleDateString() : "kounye a"}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
        <View style={{ flex: 2, minWidth: 300 }}>
          {renderDetail()}
        </View>
      </View>
    </View>
  );
}
