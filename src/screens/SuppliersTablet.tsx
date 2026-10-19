import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { blackPalette as palette, radius, shadow } from "../theme";
import { CustomerProfileHeader, ProfileMenu } from "../components/CustomerProfile";
import { SupplierProfileBody, SupplierBatchesList, SupplierBatchDetailBody, batchStatusLabel, type SupplierStats } from "../components/SupplierProfile";
import { EditSupplierContent, supplierToFormValues, type EditSupplierState } from "../components/SupplierSheets";
import { fmtG } from "../format";
import { SkeletonListRow } from "../components/Skeleton";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

export interface SuppliersTabletProps {
  suppliers: any[];
  displaySuppliers: any[];
  /** First DB load — show skeleton rows instead of the "Pa gen founisè" flash. */
  loading?: boolean;
  batchCounts: Record<string, { count: number; total: number }>;
  search: string;
  setSearch: (v: string) => void;
  showBatchOnly: boolean;
  setShowBatchOnly: (v: boolean) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedSupplier: any | null;
  canManageSuppliers: boolean;
  isOwner: boolean;
  onOpenMenu: () => void;
  showProfileMenu: boolean;
  onCloseMenu: () => void;
  onOpenEdit: () => void;
  onDelete?: () => void;
  onOpenBatch: (b: any) => void;
  showEdit: boolean;
  onCloseEdit: () => void;
  showAllBatches: boolean;
  setShowAllBatches: (v: boolean) => void;
  editState: EditSupplierState;
  setEditState: (s: EditSupplierState) => void;
  bankAccounts: any[];
  onSaveEdit: () => void;
  saving: boolean;
  batchDetail: { batch: any; itemLabel: string | null; productName: string | null } | null;
  setBatchDetail: (v: { batch: any; itemLabel: string | null; productName: string | null } | null) => void;
  profileStats: SupplierStats;
  profileBatches: any[];
  onAdd?: () => void;
  padH: number;
  width: number;
  isTablet: boolean;
}

// ── Web-mirror atoms (tablet-local; copy matches CustomersTablet) ──

function TabletSearchBlock(props: {
  search: string;
  setSearch: (v: string) => void;
  showBatchOnly: boolean;
  setShowBatchOnly: (v: boolean) => void;
  suppliers: any[];
  batchCounts: Record<string, { count: number; total: number }>;
}) {
  const { search, setSearch, showBatchOnly, setShowBatchOnly, suppliers, batchCounts } = props;
  const withBatches = suppliers.filter(s => (batchCounts[s.id]?.count ?? 0) > 0).length;
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilter, setDraftFilter] = useState(showBatchOnly);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <View style={{ flex: 1, height: 56, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 28, paddingHorizontal: 16 }}>
        <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Chèche pa non, telefòn oswa kondisyon peman"
          placeholderTextColor="#8e8e93"
          returnKeyType="search"
          style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: "#fff" }}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="close-circle" size={18} color="#8e8e93" />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => { setDraftFilter(showBatchOnly); setShowFilters(true); }}
        style={{
          width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
          backgroundColor: showBatchOnly ? "#fff" : "#000",
          borderWidth: 1, borderColor: showBatchOnly ? "#fff" : "#3a3a3c",
        }}
      >
        <Ionicons name="filter" size={20} color={showBatchOnly ? "#000" : "#fff"} />
      </Pressable>

      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFilters(false)} />
          <View style={{ backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32 }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>Filters</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setDraftFilter(false)}
                  style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: draftFilter ? "#fff" : "#6e6e73" }}>Clear All</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setShowBatchOnly(draftFilter); setShowFilters(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {([false, true] as const).map(key => {
              const checked = draftFilter === key;
              const label = key ? `Ki gen livrezon • ${withBatches}` : `Tout • ${suppliers.length}`;
              return (
                <Pressable
                  key={key ? "with" : "all"}
                  onPress={() => setDraftFilter(key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TabletSupplierRow(props: { item: any; batchCounts: Record<string, { count: number; total: number }>; isSelected: boolean; onPress: () => void }) {
  const { item, batchCounts, isSelected, onPress } = props;
  const stats = batchCounts[item.id] ?? { count: 0, total: 0 };
  const hasBatches = stats.count > 0;
  const initials = String(item.name ?? "•").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Pressable onPress={onPress}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, backgroundColor: isSelected ? "#1c1c1e" : "transparent" }}>
        <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text style={{ fontWeight: "600", fontSize: 17, color: "#fff" }} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={{ fontSize: 14, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>
            {item.phone || "—"}{item.address ? ` · ${item.address}` : ""}
          </Text>
          <Text style={{ fontSize: 13, color: hasBatches ? "#34C759" : "#8e8e93", marginTop: 1 }} numberOfLines={1}>
            {hasBatches ? `${fmtG(stats.total)} • ${stats.count} livrezon` : "Pa gen livrezon"}
          </Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: "#262626", marginLeft: 64 }} />
    </Pressable>
  );
}

export function SuppliersTablet(props: SuppliersTabletProps) {
  const {
    suppliers, displaySuppliers, loading, batchCounts, search, setSearch, showBatchOnly, setShowBatchOnly,
    selectedId, setSelectedId, selectedSupplier,
    canManageSuppliers, isOwner, onOpenMenu, showProfileMenu, onCloseMenu, onOpenEdit, onDelete, onOpenBatch,
    showEdit, onCloseEdit, showAllBatches, setShowAllBatches, editState, setEditState, bankAccounts, onSaveEdit, saving,
    batchDetail, setBatchDetail, profileStats, profileBatches, padH, width, isTablet, onAdd,
  } = props;
  const inspectorScroll = useRef<any>(null);
  useEffect(() => {
    inspectorScroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedId, batchDetail, showAllBatches, showEdit]);

  const menuOptions = [
    ...(canManageSuppliers ? [{ label: "Modifye", onPress: onOpenEdit }] : []),
    ...(isOwner && onDelete ? [{ label: "Efase", onPress: onDelete }] : []),
  ];

  return (
    <View style={{ width: "100%", flex: 1 }}>
      {/* Page header — web .page-header */}
      <View style={{ paddingHorizontal: padH, paddingTop: 16, paddingBottom: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={{ fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", color: palette.muted2 }}>FOUNISÈ • ISTWA • LIVREZON</Text>
          <Text style={{ fontSize: 28, fontWeight: "700", letterSpacing: -1, lineHeight: 30, color: palette.ink }}>Founisè</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.muted, maxWidth: 620 }}>
            Dosye founisè sou desktop — chèche pa non oswa telefòn, wè total peye, kondisyon peman, ak tout batch livrezon yo.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: palette.muted2 }}>
              {suppliers.length} founisè • {Object.values(batchCounts).reduce((s, c) => s + c.count, 0)} livrezon
            </Text>
          </View>
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              style={{ backgroundColor: palette.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#000" }}>＋ Nouvo Founisè</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: padH, paddingBottom: 16, minHeight: 0 }}>
        {/* Master list — flat on black, team-list style. Slim on purpose: the inspector is the star. */}
        <View style={{ flex: 1, minWidth: 240, flexDirection: "column", minHeight: 0 }}>
          <TabletSearchBlock
            search={search}
            setSearch={setSearch}
            showBatchOnly={showBatchOnly}
            setShowBatchOnly={setShowBatchOnly}
            suppliers={suppliers}
            batchCounts={batchCounts}
          />
          <FlatList
            data={displaySuppliers}
            keyExtractor={(item, index) => `${item.id}__${index}`}
            key="tablet-1"
            numColumns={1}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedId;
              return (
                <TabletSupplierRow item={item} batchCounts={batchCounts} isSelected={isSelected} onPress={() => setSelectedId(isSelected ? null : item.id)} />
              );
            }}
            ListEmptyComponent={
              loading ? (
                <View>
                  {[0, 1, 2, 3, 4].map(i => <SkeletonListRow key={i} tone="dark" padH={0} divider={false} />)}
                </View>
              ) : (
                <View style={{ padding: 32, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>{search || showBatchOnly ? "Pa gen rezilta" : "Pa gen founisè"}</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>Eseye chanje rechèch oswa filtè.</Text>
                </View>
              )
            }
          />
        </View>

        {/* Inspector — web right column */}
        <View style={{ flex: 2, minWidth: 0, flexDirection: "column", minHeight: 0 }}>
          {!selectedSupplier ? (
            <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, padding: 28, alignItems: "center", justifyContent: "center", ...shadow.card }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 18, color: palette.muted2 }}>◯</Text>
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, textAlign: "center" }}>Chwazi yon founisè</Text>
              <Text style={{ color: palette.muted2, fontSize: 13, marginTop: 4, textAlign: "center" }}>Klike sou lis la pou wè dosye konplè — total peye, kondisyon peman ak tout livrezon yo.</Text>
            </View>
          ) : (
            <View style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: 12 }}>
              {/* zIndex while the menu is open: the menu is anchored inside this
                  card, and RNW gives every View `position: relative; z-index: 0`
                  (its own stacking context) — without lifting the card the
                  dropdown renders below the sibling scroll view (same on native:
                  later siblings paint on top). */}
              <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16, paddingBottom: 0, ...(showProfileMenu ? { zIndex: 60 } : null) }}>
                <CustomerProfileHeader
                  onBack={() => {
                    if (showEdit) onCloseEdit();
                    else if (batchDetail) setBatchDetail(null);
                    else if (showAllBatches) setShowAllBatches(false);
                    else setSelectedId(null);
                  }}
                  backIcon={showEdit || batchDetail ? "close" : "back"}
                  title={
                    showEdit ? "Modifye founisè"
                    : batchDetail ? `${fmtG(Number(batchDetail.batch?.total_paid ?? 0))} | ${batchStatusLabel(batchDetail.batch?.status)}`
                    : showAllBatches ? "Batches" : undefined
                  }
                  onMenu={!showEdit && !batchDetail && !showAllBatches && menuOptions.length ? onOpenMenu : undefined}
                  headerAction={showEdit ? (
                    <Pressable
                      onPress={onSaveEdit}
                      disabled={!editState.valid || saving}
                      style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: editState.valid && !saving ? "#fff" : "#2b2b2b", opacity: saving ? 0.7 : 1 }}
                    >
                      <Text style={{ fontWeight: "800", fontSize: 15, color: editState.valid && !saving ? "#000" : "#6e6e73" }}>{saving ? "…" : "Save"}</Text>
                    </Pressable>
                  ) : undefined}
                />
                {showProfileMenu && selectedSupplier ? (
                  <ProfileMenu
                    onClose={onCloseMenu}
                    top={76}
                    right={16}
                    options={menuOptions}
                  />
                ) : null}
              </View>
              <KeyboardSafeScrollView ref={inspectorScroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16 }}>
                  {showEdit && selectedSupplier ? (
                    <EditSupplierContent
                      resetKey={`${selectedSupplier.id}:${bankAccounts.map((a: any) => a.id).join(",")}`}
                      visible={showEdit}
                      initial={supplierToFormValues(selectedSupplier, bankAccounts)}
                      isOwner={isOwner}
                      onState={setEditState}
                    />
                  ) : batchDetail ? (
                    <SupplierBatchDetailBody
                      batch={batchDetail.batch}
                      itemLabel={batchDetail.itemLabel}
                      productName={batchDetail.productName}
                    />
                  ) : showAllBatches ? (
                    <SupplierBatchesList batches={profileBatches} onOpenBatch={onOpenBatch} />
                  ) : (
                    <SupplierProfileBody
                      supplier={selectedSupplier}
                      stats={profileStats}
                      batches={profileBatches}
                      bankAccounts={bankAccounts}
                      onOpenBatch={onOpenBatch}
                      onViewAll={() => setShowAllBatches(true)}
                      isOwner={isOwner}
                    />
                  )}
                </View>
              </KeyboardSafeScrollView>

              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.lg, ...shadow.soft }}>
                <Pressable
                  onPress={() => setSelectedId(null)}
                  style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.ink, borderRadius: radius.pill, alignItems: "center" }}
                >
                  <Text style={{ fontWeight: "600", color: "#000", fontSize: 14 }}>Fèmen</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
