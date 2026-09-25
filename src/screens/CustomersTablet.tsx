import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput } from "react-native";
import { centerBox } from "../responsive";
import { palette, radius, shadow } from "../theme";
import { CustomerProfileBody, CustomerProfileHeader, CustomerTxnsList, ProfileMenu, tenderLabel } from "../components/CustomerProfile";
import { CreditPayFlow } from "../components/CreditPayFlow";
import { EditCustomerContent, type EditCustomerState } from "../components/CustomerSheets";
import { customerToFormData } from "../sales/customers";
import { TxnDetailBody } from "./cartViews";
import { fmtG, fmt, monoStyle } from "../format";
import { CustomerListEmpty, CreditLimitViewCard } from "./CustomersShared";

export interface CustomersTabletProps {
  customers: any[];
  debts: any[];
  displayCustomers: any[];
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
  return (
    <View style={{ padding: 12, borderBottomWidth: 0.5, borderColor: palette.hairline, backgroundColor: palette.surface, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 }}>
        <Text style={{ fontSize: 13, color: palette.muted3 }}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Chèche pa non, NIF/CIN, telefòn oswa adrès"
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
          onPress={() => setShowDebtOnly(false)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: !showDebtOnly ? palette.surface : "transparent",
            borderWidth: !showDebtOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: !showDebtOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: !showDebtOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Tout • {customers.length}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowDebtOnly(true)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
            backgroundColor: showDebtOnly ? palette.surface : "transparent",
            borderWidth: showDebtOnly ? 0.5 : 0, borderColor: palette.hairline,
            shadowColor: "#000", shadowOpacity: showDebtOnly ? 0.06 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: showDebtOnly ? palette.warningDot : "#CBD5E1" }} />
          <Text style={{ fontWeight: "600", fontSize: 12.5, color: showDebtOnly ? palette.ink : palette.muted, letterSpacing: -0.1 }}>Ki gen dèt • {debts.length}</Text>
        </Pressable>
      </View>
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
  const active = isSelected;
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? palette.ink : palette.surface,
        borderWidth: 0.5,
        borderColor: active ? palette.ink : hasDebt ? palette.dangerBd : palette.hairline,
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
        shadowOffset: { width: 0, height: active ? 4 : 1 },
        elevation: active ? 4 : 1,
      }}
    >
      {hasDebt && !active && (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: palette.dangerDot }} />
      )}
      <View
        style={{
          width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
          backgroundColor: active ? palette.surface : hasDebt ? palette.dangerBg : palette.successBg,
        }}
      >
        <Text style={{ fontWeight: "800", fontSize: 13, color: active ? palette.ink : hasDebt ? "#7F1D1D" : "#065F46" }}>
          {(item.name?.[0] ?? "•").toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", fontSize: 13, color: active ? "#FFFFFF" : palette.ink }} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.64)" : palette.muted2, marginTop: 1 }} numberOfLines={1}>
          ID {item.id_card_number || "—"}{item.phone ? ` • ${item.phone}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", minWidth: 76 }}>
        <Text style={{ fontWeight: "800", fontSize: 12, color: active ? "#FFFFFF" : hasDebt ? palette.danger : palette.success, textAlign: "right", ...monoStyle }}>
          {fmtG(totalDebt)}
        </Text>
        <Text style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.54)" : palette.muted2, marginTop: 1 }}>
          {hasDebt ? `${debtRows.length} dèt` : "A jou"}
        </Text>
      </View>
    </Pressable>
  );
}

export function CustomersTablet(props: CustomersTabletProps) {
  const {
    customers, debts, displayCustomers, search, setSearch, showDebtOnly, setShowDebtOnly,
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
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#3A3A3C" }}>{customers.length} kliyan • {debts.length} dèt aktif</Text>
          </View>
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              style={{ backgroundColor: palette.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, ...shadow.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>＋ Nouvo Kliyan</Text>
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
            showDebtOnly={showDebtOnly}
            setShowDebtOnly={setShowDebtOnly}
            customers={customers}
            debts={debts}
          />
          <View style={{ flex: 1, backgroundColor: palette.surface2, padding: 10 }}>
            <FlatList
              data={displayCustomers}
              keyExtractor={(item, index) => `${item.id}__${index}`}
              key="tablet-1"
              numColumns={1}
              contentContainerStyle={{ paddingBottom: 24, gap: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCustomerId;
                return (
                  <TabletCustomerRow item={item} debts={debts} isSelected={isSelected} onPress={() => setSelectedCustomerId(isSelected ? null : item.id)} />
                );
              }}
              ListEmptyComponent={<CustomerListEmpty />}
            />
          </View>
        </View>

        {/* Inspector — web right column */}
        <View style={{ flex: 7, minWidth: 0, flexDirection: "column", minHeight: 0 }}>
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
              <View style={{ backgroundColor: "#000", borderWidth: 0.5, borderColor: "#262626", borderRadius: radius.lg, padding: 16, paddingBottom: 0 }}>
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
              <ScrollView ref={inspectorScroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
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
              </ScrollView>
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
