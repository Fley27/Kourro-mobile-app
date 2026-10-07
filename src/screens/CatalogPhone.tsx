import React from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { radius } from "../theme";
import { useResponsive, centerBox } from "../responsive";
import type { Role } from "../users";
import type { ProductUnit } from "../pricing";
import {
  type Category, type Product,
  SearchHeader, CategoryStrip, ProductCard, statusForProduct,
} from "./CatalogShared";
import type { CatalogModel } from "../catalogModel";
import { SkeletonProductCard } from "../components/Skeleton";

export interface CatalogPhoneProps {
  role: Role;
  products: Product[];
  categories: Category[];
  /** First DB load — skeleton cards instead of the "Pa gen pwodwi" flash. */
  loading?: boolean;
  q: string; setQ: React.Dispatch<React.SetStateAction<string>>;
  onOpenFilter: () => void; filterOn: boolean; draftCount: number;
  cat: string; setCat: React.Dispatch<React.SetStateAction<string>>;
  filtered: Product[];
  canEdit: boolean;
  canViewCost: boolean; canToggleAvail: boolean;
  displayPriceOf: (p: Product) => number;
  defaultUnitOf: (productId: string) => ProductUnit | null;
  getProductCats: (productId: string) => string[];
  getProductCategoriesDisplay: (productId: string) => Category[];
  v2: CatalogModel;
  getBaseCost: (productId: string) => number;
  onOpenProduct: (productId: string) => void;
  onActivateProduct: (productId: string) => void;
}

/** Phone layout: search + category strip + 1-col product cards. */
export function CatalogPhone(props: CatalogPhoneProps) {
  const { width, padH } = useResponsive();
  const {
    role, products, categories, loading,
    q, setQ, onOpenFilter, filterOn, draftCount, cat, setCat,
    filtered,
    canEdit,
    canViewCost, canToggleAvail,
    displayPriceOf, defaultUnitOf, getProductCats, getProductCategoriesDisplay,
    v2, getBaseCost, onOpenProduct, onActivateProduct,
  } = props;

  return (
    <View style={{ flex: 1, ...centerBox(false, width, 880) }}>
      <SearchHeader q={q} setQ={setQ} onOpenFilter={onOpenFilter} filterOn={filterOn} draftCount={draftCount} padH={padH} />

      <>
        <CategoryStrip categories={categories} cat={cat} setCat={setCat} products={products} getProductCats={getProductCats} padH={padH} />

        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          key="phone-1"
          numColumns={1}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: padH, paddingBottom: 96, gap: 12 }}
          renderItem={({ item, index }) => {
            const status = statusForProduct(item);
            const prodCats = getProductCategoriesDisplay(item.id);
            return (
              <ProductCard
                item={item}
                role={role}
                prodCats={prodCats}
                status={status}
                recentMoves={[]}
                displayPrice={displayPriceOf(item)}
                unitName={defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"}
                isTablet={false}
                canEdit={canEdit}
                canViewCost={canViewCost}
                canToggleAvail={canToggleAvail}
                isFirst={index === 0}
                isLast={index === filtered.length - 1}
                stockItems={v2.items}
                variants={v2.variants}
                baseCost={getBaseCost(item.id)}
                onPress={() => onOpenProduct(item.id)}
              />
            );
          }}
          ListEmptyComponent={
            loading ? (
              <View style={{ gap: 12 }}>
                <SkeletonProductCard />
                <SkeletonProductCard />
                <SkeletonProductCard />
                <SkeletonProductCard />
              </View>
            ) : (
              <View style={{ backgroundColor: "#1C1C1E", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 24, alignItems: "center", marginTop: 8 }}><Text style={{ color: "#8e8e93", fontWeight: "500", fontSize: 13 }}>Pa gen pwodwi nan kategori sa</Text><Text style={{ color: "#8e8e93", fontSize: 11, marginTop: 4 }}>Eseye yon lòt chèche oswa kategori</Text></View>
            )
          }
        />
      </>
    </View>
  );
}
