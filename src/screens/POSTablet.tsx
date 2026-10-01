import React, { useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow, typography, topIconBtn } from "../theme";
import { ht } from "../i18n";
import { fmtG } from "../format";
import { useResponsive } from "../responsive";
import { ProductsEmpty, CartLinesList, CartEmptyCard, SuspendRow, CartTotalBar, type SaleRow, type CartItem, type SearchMode, type PendingState, type PriceLine, type CartView, type CustomerFlow } from "./POSShared";
import { TabletSearchCard, TabletPendingHero, TabletProductCard, tabletCatFor } from "../picker/tablet";
import { ProfileMenu, tenderLabel } from "../components/CustomerProfile";
import { CartMenuView, CartCustomersView, NewCustomerView, EditCustomerView, CustomerDetailBody, CustomerProfileBody, TxnDetailBody } from "./cartViews";

export interface POSTabletProps {
  search: string;
  searchMode: SearchMode;
  entrance: Animated.Value;
  payPulse: Animated.Value;
  pending: PendingState | null;
  pendingInput: string;
  pendingLine: PriceLine | null;
  pendingMaxQ: number;
  rows: SaleRow[];
  cart: CartItem[];
  subtotal: number;
  resumedTabId: string | null;
  resumedTabLabel: string;
  visibleTabsCount: number;
  editingQtyId: string | null;
  editingQtyVal: string;
  onSearchChange: (v: string) => void;
  onSearchModeChange: (m: SearchMode) => void;
  onBarcodeSubmit: () => void;
  onOpenScanner: () => void;
  onAdjustPending: (delta: number) => void;
  onPendingCustom: (val: string) => void;
  onPendingBlurClear: () => void;
  onCommitPending: () => void;
  onCancelPending: () => void;
  onProductPress: (row: SaleRow) => void;
  getBaseCost?: (productId: string) => number;
  onClearCart: () => void;
  onSuspend: () => void;
  onUpdateResumedTab: () => void;
  onOpenTabs: () => void;
  onDecQty: (key: string) => void;
  onIncQty: (key: string) => void;
  onRemoveLine: (key: string) => void;
  onEditQtyStart: (key: string) => void;
  onEditQtyChange: (key: string, v: string) => void;
  onEditQtyBlur: () => void;
  onPay: () => void;
  onOpenCartMenu?: () => void;
  customerFlow: CustomerFlow;
}

export function POSTablet(props: POSTabletProps) {
  const responsive = useResponsive();
  const { width, isTablet, isLargeTablet, padH } = responsive;
  const {
    search, searchMode, entrance, payPulse, pending, pendingInput, pendingLine, pendingMaxQ,
    rows, cart, subtotal, resumedTabId, resumedTabLabel, visibleTabsCount,
    editingQtyId, editingQtyVal,
    onSearchChange, onSearchModeChange, onBarcodeSubmit, onOpenScanner,
    onAdjustPending, onPendingCustom, onPendingBlurClear, onCommitPending, onCancelPending,
    onProductPress,
    onClearCart, onSuspend, onUpdateResumedTab, onOpenTabs,
    onDecQty, onIncQty, onRemoveLine, onEditQtyStart, onEditQtyChange, onEditQtyBlur,
    onPay,
    onOpenCartMenu, customerFlow,
  } = props;
  const flowView: CartView = customerFlow.view;

  const qtyTotal = cart.reduce((s, it) => s + it.qty, 0);
  const [cat, setCat] = useState("all");
  const [showCartMenu, setShowCartMenu] = useState(false);
  const visibleRows = cat === "all" ? rows : rows.filter(r => tabletCatFor(r.product) === cat);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Page header — mirrors web .page-header: eyebrow + title w/ italic gold accent + actions */}
      <View style={{ width: "100%", paddingHorizontal: padH, paddingTop: 16, paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...typography.eyebrow, fontSize: 11 }}>VANT • POS TABLET</Text>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: "#fff", marginTop: 4 }}>
              Kès <Text style={{ fontStyle: "italic", fontWeight: "300", color: palette.accentGold }}>vit & presi</Text>
            </Text>
            <Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>Vann vit sou tablèt — chèche pwodwi, ajoute nan panyen, peze Peye.</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: palette.muted }}>{visibleTabsCount} tab</Text>
            </View>
            <Pressable onPress={onOpenTabs} accessibilityLabel="Ouvri Tabs" style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.ink, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
              <View style={{ minWidth: 20, height: 20, borderRadius: 999, backgroundColor: palette.accentGold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: "white" }}>{visibleTabsCount}</Text>
              </View>
              <Text style={{ color: "white", fontWeight: "800", fontSize: 12 }}>ATANN</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Two-pane: products left, cart right */}
      <View style={{ width: "100%", flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: padH, paddingBottom: 12, paddingTop: 8 }}>
        <View style={{ flex: 3, minWidth: 0, gap: 12 }}>
          {/* Search card — mirrors web search card: white radius-20 card, field + mode + category tinted rows */}
          <TabletSearchCard
            entrance={entrance}
            search={search}
            searchMode={searchMode}
            cat={cat}
            onSearchChange={onSearchChange}
            onSearchModeChange={onSearchModeChange}
            onBarcodeSubmit={onBarcodeSubmit}
            onOpenScanner={onOpenScanner}
            onCatChange={setCat}
            visibleCount={visibleRows.length}
            totalCount={rows.length}
          />

          {pending && (
            <TabletPendingHero
              pending={pending}
              pendingInput={pendingInput}
              pendingLine={pendingLine}
              pendingMaxQ={pendingMaxQ}
              onAdjust={onAdjustPending}
              onCustom={onPendingCustom}
              onBlurClear={onPendingBlurClear}
              onCommit={onCommitPending}
              onCancel={onCancelPending}
            />
          )}
          <FlatList
            style={{ flex: 1 }}
            data={visibleRows}
            keyExtractor={i => i.key}
            numColumns={isLargeTablet ? 3 : 2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}
            ListHeaderComponent={
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Varyant disponib</Text>
                <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>{visibleRows.length} rezilta</Text>
              </View>
            }
            renderItem={({ item }) => {
              const inCartQty = cart.filter(c => c.key === item.key).reduce((s, c) => s + c.qty, 0);
              return (
                <TabletProductCard
                  row={item}
                  inCartQty={inCartQty}
                  pendingActive={!!pending && pending.product.id === item.product.id && pending.unitId === item.unitId && pending.variant === item.variant}
                  onPress={() => onProductPress(item)}
                  getBaseCost={props.getBaseCost}
                />
              );
            }}
            ListEmptyComponent={<ProductsEmpty />}
          />
        </View>

        {/* Right sticky cart card — mirrors web .pos-cart: head + body + grouped foot */}
        <View style={{ flex: 2, minWidth: 300, backgroundColor: "#000", borderRadius: radius.lg, borderWidth: 0.5, borderColor: "#262626", ...shadow.card, padding: 14 }}>
          {flowView === "cart" ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ fontWeight: "700", fontSize: 15, color: "#fff", letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
                {ht.cart} • {cart.length} atik • {qtyTotal} pcs
              </Text>
              {onOpenCartMenu ? (
                <Pressable onPress={() => setShowCartMenu(true)} accessibilityLabel="More options" style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 14, color: palette.ink, fontWeight: "800", letterSpacing: 1 }}>···</Text>
                </Pressable>
              ) : null}
              {resumedTabId ? null : (
                <Pressable onPress={onClearCart} accessibilityLabel="Vide panyen" style={{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable onPress={() => customerFlow.setView(flowView === "newCustomer" ? "customers" : flowView === "txnDetail" ? "custProfile" : flowView === "custEdit" || flowView === "custProfile" ? "custDetail" : "cart")} style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>
                {flowView === "customers" ? "Kliyan" : flowView === "newCustomer" ? "New Customer" : flowView === "custDetail" ? "Kliyan" : flowView === "custProfile" ? "Profil" : flowView === "custEdit" ? "Edit Customer" : flowView === "txnDetail" ? `${fmtG(Number(customerFlow.txnDetail?.sale?.total ?? 0))} ${tenderLabel(customerFlow.txnDetail?.sale?.payment_method)}` : ""}
              </Text>
              {flowView === "customers" ? (
                <Pressable onPress={customerFlow.onOpenNewCustomer} accessibilityLabel="New customer" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                </Pressable>
              ) : flowView === "newCustomer" ? (
                <Pressable onPress={customerFlow.onSaveCustomer} disabled={!customerFlow.formValid} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: customerFlow.formValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: customerFlow.formValid ? 1 : 0.6 }}>
                  <Text style={{ color: customerFlow.formValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 12 }}>Save</Text>
                </Pressable>
              ) : flowView === "custDetail" ? (
                <Pressable onPress={customerFlow.onOpenEdit} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 12 }}>Edit</Text>
                </Pressable>
              ) : flowView === "custEdit" ? (
                <Pressable onPress={customerFlow.onSaveEdit} disabled={!customerFlow.editFormValid} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: customerFlow.editFormValid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: customerFlow.editFormValid ? 1 : 0.6 }}>
                  <Text style={{ color: customerFlow.editFormValid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 12 }}>Save</Text>
                </Pressable>
              ) : flowView === "custProfile" ? (
                <Pressable onPress={customerFlow.onOpenEdit} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 12 }}>Edit</Text>
                </Pressable>
              ) : (
                <View style={{ width: topIconBtn.size }} />
              )}
            </View>
          )}
          {flowView === "cart" && showCartMenu ? (
            <ProfileMenu
              onClose={() => setShowCartMenu(false)}
              top={64}
              right={14}
              options={[
                { label: "Ouvèti-Kont", onPress: () => { customerFlow.setView("cart"); if (resumedTabId) onUpdateResumedTab(); else onSuspend(); } },
                { label: "Anile", onPress: () => {} },
              ]}
            />
          ) : null}
          {flowView === "cart" && customerFlow.selectedName ? (
            <Pressable onPress={customerFlow.onOpenDetail} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
              <Ionicons name="person-outline" size={16} color="#fff" />
              <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 12 }} numberOfLines={1}>{customerFlow.selectedName}</Text>
              <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
            </Pressable>
          ) : null}
          {flowView === "cart" && !customerFlow.selectedName ? (
            <Pressable onPress={() => customerFlow.setView("customers")} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, height: 60, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23" }}>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 12 }}>Add Customer</Text>
              <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
            </Pressable>
          ) : null}
          {flowView === "cart" ? (
            <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4 }}>
              {cart.length ? "Glise kantite • tape ✕ pou retire" : "Tape yon pwodwi pou ajoute"}
            </Text>
          ) : null}
          {flowView === "cart" && resumedTabId ? (
            <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 20 }}>
              <Ionicons name="bookmark" size={13} color="#B45309" />
              <Text numberOfLines={1} style={{ flex: 1, color: "#92400E", fontWeight: "800", fontSize: 12 }}>{resumedTabLabel}</Text>
            </View>
          ) : null}

          {flowView === "menu" ? (
            <View style={{ marginTop: 12, flex: 1, justifyContent: "flex-end", paddingBottom: 4 }}>
              <CartMenuView
                onLouvriFakti={() => { customerFlow.setView("cart"); if (resumedTabId) onUpdateResumedTab(); else onSuspend(); }}
                onClearCart={() => { customerFlow.setView("cart"); onClearCart(); }}
                onDismiss={() => customerFlow.setView("cart")}
              />
            </View>
          ) : flowView === "customers" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <CartCustomersView
                dark
                search={customerFlow.search}
                onSearch={customerFlow.setSearch}
                results={customerFlow.results}
                onPick={customerFlow.onPickCustomer}
                onOpenNew={customerFlow.onOpenNewCustomer}
                showDebtOnly={customerFlow.showDebtOnly}
                onToggleDebtOnly={customerFlow.onToggleDebtOnly}
              />
            </View>
          ) : flowView === "newCustomer" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <NewCustomerView formKey={customerFlow.formKey} onFormState={customerFlow.onFormState} />
            </View>
          ) : flowView === "custDetail" ? (
            <View style={{ flex: 1, marginTop: 12 }}>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                <CustomerDetailBody
                  customer={customerFlow.selectedCustomer}
                  stats={customerFlow.stats}
                  notes={customerFlow.notes}
                  onViewProfile={() => customerFlow.setView("custProfile")}
                  onRemove={customerFlow.onRemoveCustomer}
                  hideActions
                  lastVisitItems={customerFlow.lastVisitItems}
                  lastVisitDate={customerFlow.stats.lastVisit}
                  onAddItem={customerFlow.onAddItem}
                  addedProductIds={cart.map(c => c.id)}
                />
              </ScrollView>
              <View style={{ gap: 10, paddingTop: 10, paddingBottom: 4 }}>
                <Pressable onPress={() => customerFlow.setView("custProfile")} style={{ height: 60, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>View Full Profile</Text>
                </Pressable>
                <Pressable onPress={customerFlow.onRemoveCustomer} style={{ height: 60, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: palette.danger, fontWeight: "800", fontSize: 14 }}>Remove From Sale</Text>
                </Pressable>
              </View>
            </View>
          ) : flowView === "custProfile" ? (
            <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              <CustomerProfileBody customer={customerFlow.selectedCustomer} stats={customerFlow.stats} notes={customerFlow.notes} transactions={customerFlow.transactions} onOpenTransaction={customerFlow.onOpenTransaction} />
            </ScrollView>
          ) : flowView === "custEdit" ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <EditCustomerView
                formKey={customerFlow.editFormKey}
                initial={customerFlow.editInitial}
                onFormState={customerFlow.onEditFormState}
                notes={customerFlow.notes}
                noteInput={customerFlow.noteInput}
                onNoteInput={customerFlow.setNoteInput}
                savingNote={customerFlow.savingNote}
                onAddNote={customerFlow.onAddNote}
                notesLimit={2}
              />
            </View>
          ) : flowView === "txnDetail" && customerFlow.txnDetail ? (
            <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
              <TxnDetailBody
                sale={customerFlow.txnDetail.sale}
                items={customerFlow.txnDetail.items}
                customer={customerFlow.selectedCustomer}
                onNewReceipt={customerFlow.onNewReceipt}
                dueBalance={customerFlow.txnDue}
                totalPaid={customerFlow.txnPaid}
                payments={customerFlow.txnDetail.payments ?? []}
                onPayPress={customerFlow.onTxnPayPress}
              />
            </ScrollView>
          ) : cart.length === 0 ? (
            <CartEmptyCard />
          ) : (
            <CartLinesList
              cart={cart}
              editingQtyId={editingQtyId}
              editingQtyVal={editingQtyVal}
              onDec={onDecQty}
              onInc={onIncQty}
              onRemove={onRemoveLine}
              onEditStart={onEditQtyStart}
              onEditChange={onEditQtyChange}
              onEditBlur={onEditQtyBlur}
              style={{ marginTop: 12 }}
            />
          )}

          {/* Foot — cart view only */}
          {flowView === "cart" ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              {resumedTabId ? (
                <SuspendRow resumedTabId={resumedTabId} resumedTabLabel={resumedTabLabel} onClear={onClearCart} onSuspendOrUpdate={onUpdateResumedTab} />
              ) : null}
              <CartTotalBar
                payPulse={payPulse}
                subtotal={subtotal}
                onPay={onPay}
              />
              <Text style={{ fontSize: 10, color: "#8e8e93", textAlign: "center" }}>
                Tape Peye pou ouvri fich peman
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
