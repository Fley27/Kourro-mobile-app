import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { blackPalette as palette, radius, shadow } from "../theme";
import { CustomerProfileBody, CustomerProfileHeader, CustomerTxnsList, ProfileMenu, tenderLabel } from "../components/CustomerProfile";
import { CreditPayFlow } from "../components/CreditPayFlow";
import { EditCustomerContent, type EditCustomerState } from "../components/CustomerSheets";
import { customerToFormData } from "../sales/customers";
import { TxnDetailBody } from "./cartViews";
import { fmtG } from "../format";
import { CreditLimitViewCard } from "./CustomersShared";
import { SkeletonListRow } from "../components/Skeleton";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

export interface CustomersTabletProps {
  customers: any[];
  debts: any[];
  displayCustomers: any[];
  /** First DB load — show skeleton rows instead of the "Pa gen kliyan" flash. */
  loading?: boolean;
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  selectedCustomer: any | null;
  canManageCustomers: boolean;
  isManagerPlus: boolean;
  onOpenMenu: () => void;
  showProfileMenu: boolean;
  onCloseMenu: () => void;
  onAddSale?: (c: any) => void;
  onOpenEdit: () => void;
  onOpenTxn: (t: any) => void;
  onShareReceipt: () => void;
  txnDetail: { sale: any; items: any[] } | null;
  setTxnDetail: (v: { sale: any; items: any[] } | null) => void;
  showAllTxns: boolean;
  setShowAllTxns: (v: boolean) => void;
  showEditSheet: boolean;
  onCloseEditSheet: () => void;
  showPay: boolean;
  onClosePay: () => void;
  payDue: number;
  onPayDue: (amount: number) => Promise<{ receipt: string; finalBalance: number }>;
  onPaySuccess: (info: { amount: number; receipt: string; finalBalance: number }) => void;
  txnDue: number;
  txnPaid: number;
  txnPayments: any[];
  onPayPress?: () => void;
  editNotesProps: {
    notes: any[];
    noteInput: string;
    onNoteInput: (v: string) => void;
    savingNote: boolean;
    onAddNote: () => void;
    notesLimit: number;
  };
  editFormState: EditCustomerState;
  setEditFormState: (s: EditCustomerState) => void;
  onSaveEdit: () => void;
  savingCustomer: boolean;
  profileStats: { visits: number; spent: number; lastVisit: string | null; firstVisit: string | null };
  profileNotes: any[];
  profileTxns: any[];
  padH: number;
  width: number;
  isTablet: boolean;
  /** Wired to the shell's existing add-customer handler (setShowAddCustomer(true)). Optional so older callers keep compiling. */
  onAdd?: () => void;
}

// ── Web-mirror atoms (tablet-local; math + copy match CustomersShared) ──

function TabletSearchBlock(props: {
  search: string;
  setSearch: (v: string) => void;
  showDebtOnly: boolean;
  setShowDebtOnly: (v: boolean) => void;
  customers: any[];
  debts: any[];
}) {
  const { search, setSearch, showDebtOnly, setShowDebtOnly, customers, debts } = props;
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilter, setDraftFilter] = useState(showDebtOnly);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <View style={{ flex: 1, height: 56, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 28, paddingHorizontal: 16 }}>
        <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Chèche pa non, NIF/CIN, telefòn oswa adrès"
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
        onPress={() => { setDraftFilter(showDebtOnly); setShowFilters(true); }}
        style={{
          width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
          backgroundColor: showDebtOnly ? "#fff" : "#000",
          borderWidth: 1, borderColor: showDebtOnly ? "#fff" : "#3a3a3c",
        }}
      >
        <Ionicons name="filter" size={20} color={showDebtOnly ? "#000" : "#fff"} />
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
                  onPress={() => { setShowDebtOnly(draftFilter); setShowFilters(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {([false, true] as const).map(key => {
              const checked = draftFilter === key;
              const label = key ? `Ki gen dèt • ${debts.length}` : `Tout • ${customers.length}`;
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

function TabletCustomerRow(props: { item: any; debts: any[]; isSelected: boolean; onPress: () => void }) {
  const { item, debts, isSelected, onPress } = props;
  // Same math as CustomersShared.CustomerRowCard
  const debtRows = debts.filter((d: any) => d.customer_id === item.id && Number(d.balance) > 0);
  const computedDebt = debtRows.reduce((s: number, d: any) => s + Number(d.balance ?? 0), 0);
  const totalDebt = Number(item.total_debt ?? 0) > 0 ? Number(item.total_debt) : computedDebt;
  const hasDebt = debtRows.length > 0;
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
            ID {item.id_card_number || "—"}{item.phone ? ` · ${item.phone}` : ""}
          </Text>
          <Text style={{ fontSize: 13, color: hasDebt ? "#FF3B30" : "#8e8e93", marginTop: 1 }} numberOfLines={1}>
            {hasDebt ? `${fmtG(totalDebt)} • ${debtRows.length} dèt` : "A jou"}
          </Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: "#262626", marginLeft: 64 }} />
    </Pressable>
  );
}

export function CustomersTablet(props: CustomersTabletProps) {
  const {
    customers, debts, displayCustomers, loading, search, setSearch, showDebtOnly, setShowDebtOnly,
    selectedCustomerId, setSelectedCustomerId, selectedCustomer,
    canManageCustomers, isManagerPlus, onOpenMenu, showProfileMenu, onCloseMenu, onAddSale, onOpenEdit, onOpenTxn, onShareReceipt, txnDetail, setTxnDetail, showAllTxns, setShowAllTxns, showEditSheet, onCloseEditSheet, showPay, onClosePay, payDue, onPayDue, onPaySuccess, txnDue, txnPaid, txnPayments, onPayPress, editNotesProps, editFormState, setEditFormState, onSaveEdit, savingCustomer, profileStats, profileNotes, profileTxns, padH, width, isTablet, onAdd,
  } = props;
  const inspectorScroll = useRef<any>(null);
  useEffect(() => {
    inspectorScroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedCustomerId, txnDetail, showAllTxns, showEditSheet, showPay]);
  return (
    <View style={{ width: "100%", flex: 1 }}>
      {/* Page header — web .page-header */}
      <View style={{ paddingHorizontal: padH, paddingTop: 16, paddingBottom: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={{ fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", color: palette.muted2 }}>CRM • ISTWA • LIMIT</Text>
          <Text style={{ fontSize: 28, fontWeight: "700", letterSpacing: -1, lineHeight: 30, color: palette.ink }}>Kliyan</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: palette.muted, maxWidth: 620 }}>
            Dosye kliyan sou desktop — chèche pa NIF/CIN, wè dèt, limit, istwa acha Kredi vs Kach, ak odit modifikasyon.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: palette.muted2 }}>{customers.length} kliyan • {debts.length} dèt aktif</Text>
          </View>
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              style={{ backgroundColor: palette.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#000" }}>＋ Nouvo Kliyan</Text>
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
            showDebtOnly={showDebtOnly}
            setShowDebtOnly={setShowDebtOnly}
            customers={customers}
            debts={debts}
          />
          <FlatList
            data={displayCustomers}
            keyExtractor={(item, index) => `${item.id}__${index}`}
            key="tablet-1"
            numColumns={1}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedCustomerId;
              return (
                <TabletCustomerRow item={item} debts={debts} isSelected={isSelected} onPress={() => setSelectedCustomerId(isSelected ? null : item.id)} />
              );
            }}
            ListEmptyComponent={
              loading ? (
                <View>
                  {[0, 1, 2, 3, 4].map(i => <SkeletonListRow key={i} tone="dark" padH={0} divider={false} />)}
                </View>
              ) : (
                <View style={{ padding: 32, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>{search || showDebtOnly ? "Pa gen rezilta" : "Pa gen kliyan"}</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>Eseye chanje rechèch oswa filtè.</Text>
                </View>
              )
            }
          />
        </View>

        {/* Inspector — web right column */}
        <View style={{ flex: 2, minWidth: 0, flexDirection: "column", minHeight: 0 }}>
          {!selectedCustomer ? (
            <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, padding: 28, alignItems: "center", justifyContent: "center", ...shadow.card }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 18, color: palette.muted2 }}>◯</Text>
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink, textAlign: "center" }}>Chwazi yon kliyan</Text>
              <Text style={{ color: palette.muted2, fontSize: 13, marginTop: 4, textAlign: "center" }}>Klike sou lis la pou wè dosye konplè — dèt, limit, istwa Kredi ak Kach separe.</Text>
            </View>
          ) : (
            <View style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: 12 }}>
              {!showPay ? (
              // zIndex while the menu is open: the menu is anchored inside this
              // card, and RNW gives every View `position: relative; z-index: 0`
              // (its own stacking context) — without lifting the card the
              // dropdown renders below the sibling scroll view (same on native:
              // later siblings paint on top).
              <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16, paddingBottom: 0, ...(showProfileMenu ? { zIndex: 60 } : null) }}>
                <CustomerProfileHeader
                  onBack={() => {
                    if (showPay) onClosePay();
                    else if (showEditSheet) onCloseEditSheet();
                    else if (txnDetail) setTxnDetail(null);
                    else if (showAllTxns) setShowAllTxns(false);
                    else setSelectedCustomerId(null);
                  }}
                  backIcon={showPay || showEditSheet || txnDetail ? "close" : "back"}
                  title={
                    showPay ? "Touche"
                    : showEditSheet ? "Modifye kliyan"
                    : txnDetail ? `${fmtG(Number(txnDetail.sale?.total ?? 0))} | ${tenderLabel(txnDetail.sale?.payment_method)}`
                    : showAllTxns ? "Transactions" : undefined
                  }
                  onMenu={!showPay && !showEditSheet && !txnDetail && !showAllTxns ? onOpenMenu : undefined}
                  headerAction={showEditSheet ? (
                    <Pressable
                      onPress={onSaveEdit}
                      disabled={!editFormState.valid || savingCustomer}
                      style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: editFormState.valid && !savingCustomer ? "#fff" : "#2b2b2b", opacity: savingCustomer ? 0.7 : 1 }}
                    >
                      <Text style={{ fontWeight: "800", fontSize: 15, color: editFormState.valid && !savingCustomer ? "#000" : "#6e6e73" }}>{savingCustomer ? "…" : "Save"}</Text>
                    </Pressable>
                  ) : undefined}
                />
                {showProfileMenu && selectedCustomer ? (
                  <ProfileMenu
                    onClose={onCloseMenu}
                    top={76}
                    right={16}
                    options={[
                      { label: "Add Sale", onPress: () => onAddSale?.(selectedCustomer) },
                      ...(canManageCustomers ? [{ label: "Edit", onPress: () => onOpenEdit() }] : []),
                    ]}
                  />
                ) : null}
              </View>
              ) : null}
              {!showPay ? (
              <KeyboardSafeScrollView ref={inspectorScroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                {/* Shared full profile — identical to checkout */}
                <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16 }}>
                  {showEditSheet && selectedCustomer ? (                    <EditCustomerContent
                        resetKey={selectedCustomer.id}
                        visible={showEditSheet}
                        initial={customerToFormData(selectedCustomer)}
                        initialCreditLimit={selectedCustomer.credit_limit ?? null}
                        showCreditLimit
                        canEditCreditLimit={isManagerPlus}
                        notesProps={editNotesProps}
                        onState={setEditFormState}
                      />
                  ) : txnDetail ? (
                    <TxnDetailBody
                      sale={txnDetail.sale}
                      items={txnDetail.items}
                      customer={selectedCustomer}
                      onNewReceipt={onShareReceipt}
                      dueBalance={txnDue}
                      totalPaid={txnPaid}
                      payments={txnPayments}
                      onPayPress={onPayPress}
                    />
                  ) : showAllTxns ? (
                    <CustomerTxnsList transactions={profileTxns} onOpenTransaction={onOpenTxn} />
                  ) : (
                    <CustomerProfileBody
                      customer={selectedCustomer}
                      stats={profileStats}
                      notes={profileNotes}
                      transactions={profileTxns}
                      onOpenTransaction={onOpenTxn}
                      onViewAll={() => setShowAllTxns(true)}
                      limitSection={
                        <CreditLimitViewCard customer={selectedCustomer} isManagerPlus={isManagerPlus} canManageCustomers={canManageCustomers} />
                      }
                    />
                  )}
                </View>
              </KeyboardSafeScrollView>
              ) : (
              <View style={{ flex: 1 }}>
                <CreditPayFlow
                  inline
                  visible={showPay}
                  due={payDue}
                  onClose={onClosePay}
                  onPay={onPayDue}
                  onSuccess={onPaySuccess}
                />
              </View>
              )}

              <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.lg, ...shadow.soft }}>
                <Pressable
                  onPress={() => setSelectedCustomerId(null)}
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
