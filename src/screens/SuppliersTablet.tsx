import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput } from "react-native";
import { palette, radius, shadow } from "../theme";
import { CustomerProfileHeader, ProfileMenu } from "../components/CustomerProfile";
import { SupplierProfileBody, SupplierBatchesList, SupplierBatchDetailBody, batchStatusLabel, type SupplierStats } from "../components/SupplierProfile";
import { EditSupplierContent, type EditSupplierState } from "../components/SupplierSheets";
import { fmtG, monoStyle } from "../format";

export interface SuppliersTabletProps {
  suppliers: any[];
  displaySuppliers: any[];
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
  return (
    <View style={{ padding: 12, borderBottomWidth: 0.5, borderColor: palette.hairline, backgroundColor: palette.surface, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 }}>
        <Text style={{ fontSize: 13, color: palette.muted3 }}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Chèche pa non, telefòn oswa kondisyon peman"
          placeholderTextColor={palette.muted3}
          style={{ flex: 1, fontSize: 13.5, color: palette.ink, paddingVertical: 0 }}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "600" }}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Small segmented — web .segmented, compact */}
      <View style={{ alignSelf: "flex-start", flexDirection: "row", backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, padding: 2, gap: 2 }}>
        <Pressable
          onPress={() => setShowBatchOnly(false)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: !showBatchOnly ? palette.surface : "transparent",
            borderWidth: !showBatchOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: !showBatchOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: !showBatchOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Tout • {suppliers.length}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowBatchOnly(true)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: showBatchOnly ? palette.surface : "transparent",
            borderWidth: showBatchOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: showBatchOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: showBatchOnly ? palette.warningDot : "#CBD5E1" }} />
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: showBatchOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Ki gen livrezon • {withBatches}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TabletSupplierRow(props: { item: any; batchCounts: Record<string, { count: number; total: number }>; isSelected: boolean; onPress: () => void }) {
  const { item, batchCounts, isSelected, onPress } = props;
  const stats = batchCounts[item.id] ?? { count: 0, total: 0 };
  const hasBatches = stats.count > 0;
  const active = isSelected;
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? palette.ink : palette.surface,
        borderWidth: 0.5,
        borderColor: active ? palette.ink : hasBatches ? palette.successBd : palette.hairline,
        borderRadius: radius.md,
        padding: 12,
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: active ? 0.12 : 0.04,
        shadowRadius: active ? 16 : 4,
        shadowOffset: { width: active ? 0 : 0, height: active ? 4 : 1 },
        elevation: active ? 4 : 1,
      }}
    >
      {hasBatches && !active && (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: palette.successDot }} />
      )}
      <View
        style={{
          width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
          backgroundColor: active ? palette.surface : hasBatches ? palette.successBg : palette.surfaceGrouped,
        }}
      >
        <Text style={{ fontWeight: "800", fontSize: 13, color: active ? palette.ink : hasBatches ? "#065F46" : palette.muted2 }}>
          {(item.name?.[0] ?? "•").toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", fontSize: 13, color: active ? "#FFFFFF" : palette.ink }} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.64)" : palette.muted2, marginTop: 1 }} numberOfLines={1}>
          {item.phone || "—"}{item.address ? ` • ${item.address}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", minWidth: 76 }}>
        <Text style={{ fontWeight: "800", fontSize: 12, color: active ? "#FFFFFF" : hasBatches ? palette.success : palette.muted2, textAlign: "right", ...monoStyle }}>
          {fmtG(stats.total)}
        </Text>
        <Text style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.54)" : palette.muted2, marginTop: 1 }}>
          {hasBatches ? `${stats.count} livrezon` : "A okenn"}
        </Text>
      </View>
    </Pressable>
  );
}

export function SuppliersTablet(props: SuppliersTabletProps) {
  const {
    suppliers, displaySuppliers, batchCounts, search, setSearch, showBatchOnly, setShowBatchOnly,
    selectedId, setSelectedId, selectedSupplier,
    canManageSuppliers, isOwner, onOpenMenu, showProfileMenu, onCloseMenu, onOpenEdit, onDelete, onOpenBatch,
    showEdit, onCloseEdit, showAllBatches, setShowAllBatches, editState, setEditState, onSaveEdit, saving,
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
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#3A3A3C" }}>
              {suppliers.length} founisè • {Object.values(batchCounts).reduce((s, c) => s + c.count, 0)} livrezon
            </Text>
          </View>
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              style={{ backgroundColor: palette.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>＋ Nouvo Founisè</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: padH, paddingBottom: 16, minHeight: 0 }}>
        {/* Master list card — web left column */}
        <View style={{ flex: 5, minWidth: 280, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card, flexDirection: "column" }}>
          <TabletSearchBlock
            search={search}
            setSearch={setSearch}
            showBatchOnly={showBatchOnly}
            setShowBatchOnly={setShowBatchOnly}
            suppliers={suppliers}
            batchCounts={batchCounts}
          />
          <View style={{ flex: 1, backgroundColor: palette.surface2, padding: 10 }}>
            <FlatList
              data={displaySuppliers}
              keyExtractor={(item, index) => `${item.id}__${index}`}
              key="tablet-1"
              numColumns={1}
              contentContainerStyle={{ paddingBottom: 24, gap: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedId;
                return (
                  <TabletSupplierRow item={item} batchCounts={batchCounts} isSelected={isSelected} onPress={() => setSelectedId(isSelected ? null : item.id)} />
                );
              }}
              ListEmptyComponent={
                <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 16, padding: 28, alignItems: "center", marginTop: 8 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <Text style={{ fontSize: 18, color: "#94A3B8" }}>◯</Text>
                  </View>
                  <Text style={{ fontWeight: "600", fontSize: 13, color: "#334155" }}>Pa gen founisè</Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, textAlign: "center" }}>Eseye yon lòt rechèch oswa ajoute yon nouvo founisè</Text>
                </View>
              }
            />
          </View>
        </View>

        {/* Inspector — web right column */}
        <View style={{ flex: 7, minWidth: 0, flexDirection: "column", minHeight: 0 }}>
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
              <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16, paddingBottom: 0 }}>
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
              <ScrollView ref={inspectorScroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16 }}>
                  {showEdit && selectedSupplier ? (
                    <EditSupplierContent
                      resetKey={selectedSupplier.id}
                      visible={showEdit}
                      initial={{
                        name: selectedSupplier.name ?? "",
                        phone: selectedSupplier.phone ?? "",
                        address: selectedSupplier.address ?? "",
                        payment_terms: selectedSupplier.payment_terms ?? "",
                        bank_info: selectedSupplier.bank_info ?? "",
                        notes: selectedSupplier.notes ?? "",
                      }}
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
                      onOpenBatch={onOpenBatch}
                      onViewAll={() => setShowAllBatches(true)}
                      isOwner={isOwner}
                    />
                  )}
                </View>
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.lg, ...shadow.soft }}>
                <Pressable
                  onPress={() => setSelectedId(null)}
                  style={{ flex: 1, paddingVertical: 12, backgroundColor: palette.ink, borderRadius: radius.pill, alignItems: "center" }}
                >
                  <Text style={{ fontWeight: "600", color: "#FFFFFF", fontSize: 14 }}>Fèmen</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
