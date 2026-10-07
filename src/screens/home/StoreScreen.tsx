import React, { useState, useEffect } from "react";
import { View, Text, Pressable, Modal, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { monoStyle } from "../../format";
import { getUserById } from "../../users";
import { notifyLocal } from "../../notifications";
import { blackPalette as palette, radius, shadow } from "../../theme";
import { findSaleDetail, changeSalePaymentMethod, describeChange, salePaymentLabel, formatMoney, type SaleDetail } from "../../salesCorrection";
import { saleLineLabel } from "../../labels";
import { useResponsive, centerBox, sheetBox } from "../../responsive";
// STAGING-PICKUP: single gated import — delete this + the STAGING block below to remove.
import PickupToggleCard from "../../pickup-staging/PickupToggleCard";
import PickupRedeemEntry from "../../pickup-staging/PickupRedeemEntry";
import { uploadSuccess, uploadError } from "../../components/UploadTransition";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";
import { FALLBACK_STORE_ID, STORE_IDS } from "../../db/ids";

export type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean }; 

type Props = {
  role: string;
  activeStore?: StoreItem;
  // Operational store id used for ALL shift / cash DB writes + reads.
  // Must match the storeId passed to ShiftReportScreen / POSScreen (FALLBACK_STORE_ID).
  // activeStore.id (STORE_IDS.petionVille, ...) is display-only — never use it for writes,
  // otherwise the shift becomes invisible to the shift report (opening = 0).
  storeId?: string;
  storeCount?: number;
  appDisabled?: boolean;
  setAppDisabled?: (v: boolean | ((prev: boolean) => boolean)) => void;
  canManageStore?: boolean;
  onOpenAccountCenter?: () => void;
  onOpenShiftReport?: () => void;
  onGoSales?: () => void;
  currentUser?: any;
};

export default function StoreScreen({
  role,
  activeStore,
  storeId: storeIdProp,
  storeCount = 0,
  appDisabled = false,
  setAppDisabled,
  canManageStore = false,
  onOpenAccountCenter,
  onOpenShiftReport,
  onGoSales,
  currentUser,
}: Props) {
  const insets = useSafeAreaInsets();
  const responsive = useResponsive();
  const { width, isTablet, padH } = responsive;
  const name = activeStore?.name ?? "Magazen";
  const location = activeStore?.location ?? "—";
  const created = activeStore?.createdAt ? new Date(activeStore.createdAt).toLocaleDateString() : "—";
  const isOwner = role === "owner";
  const blocked = !!activeStore?.disabled;
  const isSupervisor = role === "owner" || role === "admin" || role === "manager";

  // Operational store id — MUST match ShiftScreen/POSScreen (FALLBACK_STORE_ID).
  // activeStore.id is display-only (st-petyonvil/st-delma); using it for writes
  // orphans shifts + cash_movements so the report finds opening = 0.
  const storeId = storeIdProp ?? FALLBACK_STORE_ID;

  // Sales Options — sale lookup & payment method correction
  const [showSalesOptions, setShowSalesOptions] = useState(false);
  const [saleQuery, setSaleQuery] = useState("");
  const [searchingSale, setSearchingSale] = useState(false);
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null);
  const [saleError, setSaleError] = useState("");
  const [pendingChange, setPendingChange] = useState<"cash" | "credit" | null>(null);
  const [applyingChange, setApplyingChange] = useState(false);


  async function handleSaleSearch() {
    setSaleError("");
    setSaleDetail(null);
    setPendingChange(null);
    const q = saleQuery.trim();
    if (!q) return setSaleError("Antre id oswa nimewo vant la");
    setSearchingSale(true);
    try {
      const db = await getDb();
      const detail = await findSaleDetail(db, storeId, q);
      if (!detail) {
        setSaleError("Vant pa jwenn — verifye id la");
      } else {
        setSaleDetail(detail);
      }
    } catch (e: any) {
      setSaleError(e?.message ?? "Erè pandan rechèch");
    } finally {
      setSearchingSale(false);
    }
  }

  async function handleApplyChange() {
    if (!saleDetail || !pendingChange) return;
    setApplyingChange(true);
    try {
      const db = await getDb();
      const res = await changeSalePaymentMethod(saleDetail, pendingChange, { db, storeId, storeName: name, currentUser });
      try { const { salesEvents } = await import("../../salesEvents"); salesEvents.emit(); } catch {}
      const changedSaleId = String(res.sale?.id ?? saleDetail.sale?.id ?? "");
      notifyLocal("Koreksyon Vant ✓", `Vant ${res.sale.sale_number} chanje soti ${salePaymentLabel(res.previous)} → ${salePaymentLabel(res.target)} — analytics ak rapò mete ajou.`,
        changedSaleId ? { screen: "sale", id: changedSaleId } : undefined);
      uploadSuccess(
        "Koreksyon anrejistre ✓",
        `Vant ${res.sale.sale_number}\nSoti ${salePaymentLabel(res.previous)} → ${salePaymentLabel(res.target)}\nTOTAL: ${formatMoney(Number(res.sale.total ?? 0))}\nResi: ${res.receiptNumber}\n\nAnalytics ak rapò jounen an mete ajou otomatikman.`
      );
      setSaleDetail(null);
      setSaleQuery("");
      setPendingChange(null);
      setShowSalesOptions(false);
    } catch (e: any) {
      uploadError("Koreksyon echwe", e?.message ?? "Imposib fè koreksyon an");
    } finally {
      setApplyingChange(false);
    }
  }

  return (
    <KeyboardSafeScrollView style={{ flex: 1, backgroundColor: palette.bg, flexGrow: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24, alignItems: "center" }} showsVerticalScrollIndicator={false}>
      <View style={{ width: "100%", gap: 12 }}>
      {blocked && (
        <View style={{ backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, borderRadius: radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed" size={18} color={palette.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 13, color: palette.danger }}>Magazen bloke</Text>
            <Text style={{ fontSize: 11, color: palette.danger, marginTop: 2, lineHeight: 15 }}>Sispann apre yon bès sekirite. Tout aktivite enfim. Kontakte Konsole Sipò.</Text>
          </View>
        </View>
      )}

      {/* Active store summary card */}
      <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="storefront-outline" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontWeight: "700", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>{name}</Text>
              <View style={{ backgroundColor: palette.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: palette.success, letterSpacing: 0.3 }}>AKTIF</Text>
              </View>
            </View>
            <Text style={{ fontSize: 13, color: palette.muted2, marginTop: 2 }}>{location} • Depi {created}</Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={palette.ink} />
        </View>

        {/* Store details */}
        <View style={{ marginTop: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="location-outline" size={13} color={palette.muted2} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Lokal/site</Text>
            </View>
            <Text style={{ fontSize: 13, color: palette.ink, fontWeight: "600" }}>{location}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="lock-closed-outline" size={13} color={palette.muted2} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Kòd sekrè</Text>
            </View>
            <Text style={{ fontSize: 11, color: palette.muted3, fontStyle: "italic" }}>pa vizib • sere deyò app la</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name={appDisabled ? "lock-closed-outline" : "lock-open-outline"} size={13} color={appDisabled ? palette.danger : palette.success} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Stat</Text>
            </View>
            <Text style={{ fontSize: 13, color: appDisabled ? palette.danger : palette.success, fontWeight: "700" }}>{appDisabled ? "Li sèlman" : "Aktif"}</Text>
          </View>
        </View>
      </View>

      {/* Shift — the unified lifecycle: open, daily report, cash register */}
      {onOpenShiftReport && (
        <Pressable
          onPress={onOpenShiftReport}
          style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
        >
          <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="key-outline" size={20} color={palette.accentGold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Shift</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Ouverture • Rapò jounen • Kès — tout chanjman an</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
        </Pressable>
      )}

      {/* Sales Options — sale lookup & payment method correction */}
      <Pressable
        onPress={() => { setShowSalesOptions(true); setSaleQuery(""); setSaleError(""); setSaleDetail(null); setPendingChange(null); }}
        style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
      >
        <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.blueBg, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="receipt-outline" size={20} color={palette.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Opsyon Vant</Text>
          <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Chèche yon vant pa id • View detay yo • Korekte Kach/Kredi</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
      </Pressable>

      {/* Account Center — priority 3 (Owner only) */}
      {isOwner && onOpenAccountCenter && (
        <Pressable
          onPress={onOpenAccountCenter}
          style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
        >
          <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="business-outline" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Kourro</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Jere magazen ou yo • Chwazi aktif • Kòd sekrè ({storeCount})</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
        </Pressable>
      )}

      {/* App access toggle — priority 4 (Owner/Admin) */}
      {canManageStore && (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={appDisabled ? "lock-closed-outline" : "lock-open-outline"} size={18} color={appDisabled ? palette.danger : palette.muted2} />
              </View>
              <View>
                <Text style={{ fontWeight: "600", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Aksè app</Text>
                <Text style={{ fontSize: 12, color: appDisabled ? palette.danger : palette.muted2, marginTop: 2 }}>{appDisabled ? "Li sèlman" : "Tout moun ka ekri"}</Text>
              </View>
            </View>
            {setAppDisabled && (
              <Pressable onPress={() => setAppDisabled(v => !v)} style={{ backgroundColor: appDisabled ? palette.danger : palette.ink2, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, ...shadow.soft }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: appDisabled ? "#fff" : "#000", letterSpacing: 0.2 }}>{appDisabled ? "Aktive" : "Dezaktive"}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* STAGING-PICKUP: manager toggle (device-local). Delete block to remove. */}
      <PickupToggleCard storeId={storeId} role={role} />
      {/* STAGING-PICKUP: cashier redemption entry (flag-gated). Delete block to remove. */}
      <PickupRedeemEntry storeId={storeId} cashierId={currentUser?.id ?? null} storeName={activeStore?.name ?? null} cashierName={currentUser?.name ?? null} />

      {/* Non-owner note */}
      {!isOwner && (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, borderWidth: 0.5, borderColor: palette.hairline }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="information-circle-outline" size={16} color={palette.muted2} />
            <Text style={{ fontSize: 13, color: palette.muted2, flex: 1 }}>Ou ap itilize magazen <Text style={{ fontWeight: "700", color: palette.ink }}>{name}</Text>. Kontak sipò pou jere l.</Text>
          </View>
        </View>
      )}

      {/* Sales Options — search, view & correct a sale */}
      <Modal visible={showSalesOptions} transparent animationType="slide" onRequestClose={() => setShowSalesOptions(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <KeyboardSafeScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, paddingBottom: 18 + insets.bottom, maxHeight: "94%", borderTopWidth: 0.5, borderColor: palette.hairline, ...shadow.elevated }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.blueBg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="receipt-outline" size={19} color={palette.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }}>Opsyon Vant</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>Chèche yon vant pa id oswa nimewo • View tout detay yo epi korije si sa nesesè</Text>
              </View>
              <Pressable onPress={() => setShowSalesOptions(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={palette.muted2} />
              </Pressable>
            </View>

            <View style={{ marginTop: 16, flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, paddingHorizontal: 12, backgroundColor: palette.bg, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="search" size={16} color={palette.muted3} />
                <TextInput
                  value={saleQuery}
                  onChangeText={(t) => { setSaleQuery(t); setSaleError(""); }}
                  onSubmitEditing={handleSaleSearch}
                  placeholder="ID oswa nimewo vant (eg. sale-1725…)"
                  placeholderTextColor={palette.muted3}
                  autoCapitalize="none"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 13, color: palette.ink, fontFamily: "Inter_400Regular", minHeight: 46 }}
                />
              </View>
              <Pressable onPress={handleSaleSearch} disabled={searchingSale} style={{ backgroundColor: palette.ink2, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 13, ...shadow.soft }}>
                <Text style={{ color: "#000", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 }}>{searchingSale ? "…" : "Chèche"}</Text>
              </Pressable>
            </View>

            {!!saleError && (
              <View style={{ marginTop: 12, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="alert-circle" size={16} color={palette.danger} />
                <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "600", flex: 1 }}>{saleError}</Text>
              </View>
            )}

            {saleDetail && !pendingChange && (
              <View style={{ marginTop: 14 }}>
                <View style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View>
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 15, color: palette.ink }}>Vant {saleDetail.sale.sale_number ?? saleDetail.sale.id}</Text>
                      <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{new Date(saleDetail.sale.created_at ?? new Date()).toLocaleDateString()} • {new Date(saleDetail.sale.created_at ?? new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                    </View>
                    <View style={{ backgroundColor: saleDetail.sale.payment_method === "credit" ? palette.warningBg : palette.successBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: saleDetail.sale.payment_method === "credit" ? palette.accentGoldSoft : palette.successBd }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: saleDetail.sale.payment_method === "credit" ? palette.accentGold : palette.success }}>{salePaymentLabel(saleDetail.sale.payment_method)}</Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, paddingTop: 10, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Kesye</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600" }}>{getUserById(saleDetail.sale.seller_id)?.name ?? saleDetail.sale.seller_id ?? "—"}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Kliyan</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600", flexShrink: 1, marginLeft: 12, textAlign: "right" }}>{saleDetail.customer ? `${saleDetail.customer.name}${saleDetail.customer.id_card_number ? ` (${saleDetail.customer.id_card_number})` : ""}` : "Pa gen kliyan"}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Atik</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600" }}>{saleDetail.items.length} atik</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>TOTAL</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle }}>{formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Pe</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600", ...monoStyle }}>{formatMoney(Number(saleDetail.sale.amount_paid ?? 0))}</Text>
                    </View>
                    {Number(saleDetail.sale.amount_due ?? 0) > 0 && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 11, color: palette.muted2 }}>Reste dwe</Text>
                        <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", ...monoStyle }}>{formatMoney(Number(saleDetail.sale.amount_due ?? 0))}</Text>
                      </View>
                    )}
                  </View>

                  {saleDetail.items.length > 0 && (
                    <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, paddingTop: 10, gap: 6 }}>
                      {saleDetail.items.map((it, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                          <Text style={{ fontSize: 11, color: palette.muted3, ...monoStyle, width: 40 }}>{it.quantity} ×</Text>
                          <Text numberOfLines={2} style={{ flex: 1, fontSize: 11, color: palette.ink, fontWeight: "500", lineHeight: 15 }}>{saleLineLabel(it)}</Text>
                          <Text style={{ fontSize: 11, color: palette.ink, fontWeight: "700", ...monoStyle }}>{formatMoney(Number(it.line_total ?? 0))}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Correction actions (role-based) */}
                <View style={{ marginTop: 12, gap: 10 }}>
                  {saleDetail.sale.payment_method === "credit" && (
                    <Pressable onPress={() => setPendingChange("cash")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.successBg, borderRadius: radius.md, padding: 14, borderWidth: 0.5, borderColor: palette.successBd }}>
                      <Ionicons name="cash-outline" size={17} color={palette.success} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 13, color: palette.success }}>Rektifye an Kach (vant te Kach)</Text>
                    </Pressable>
                  )}
                  {saleDetail.sale.payment_method === "cash" && isSupervisor && (
                    <Pressable onPress={() => setPendingChange("credit")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 14, borderWidth: 0.5, borderColor: palette.accentGold }}>
                      <Ionicons name="pricetag-outline" size={17} color={palette.accentGold} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 13, color: palette.accentGold }}>Chanje an Kredi (sipèvizè)</Text>
                    </Pressable>
                  )}
                  {saleDetail.sale.payment_method === "cash" && !isSupervisor && (
                    <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="lock-closed-outline" size={15} color={palette.muted2} />
                      <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "500", flex: 1 }}>Yon vant Kach pa ka vin Kredi pa yon kesye — sèl yon sipèvizè ka fè koreksyon sa.</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Confirmation panel */}
            {saleDetail && pendingChange && (
              <View style={{ marginTop: 14, backgroundColor: saleDetail.sale.payment_method === "credit" ? palette.successBg : palette.accentGoldSoft, borderWidth: 0.5, borderColor: saleDetail.sale.payment_method === "credit" ? palette.successBd : palette.accentGold, borderRadius: radius.lg, padding: 14 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 14, color: palette.ink }}>Konfime koreksyon</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 3, lineHeight: 16 }}>Koreksyon sa pral mete ajou analytics, rapò jounen an ak resi yo otomatikman.</Text>
                <View style={{ marginTop: 10, gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>Rejim aktyèl</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink }}>{salePaymentLabel(saleDetail.sale.payment_method)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>Aprè koreksyon</Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: pendingChange === "credit" ? palette.accentGold : palette.success }}>{pendingChange === "credit" ? "Kredi" : "Kach"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>TOTAL</Text>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle }}>{formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                  </View>
                  {pendingChange === "cash" && saleDetail.credit && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Dèt retire nan kliyan</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: palette.danger, ...monoStyle }}>− {formatMoney(Math.max(0, Number(saleDetail.credit.balance ?? 0)))}</Text>
                    </View>
                  )}
                  {pendingChange === "credit" && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Nouvo dèt kliyan</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: palette.danger, ...monoStyle }}>+ {formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable onPress={() => setPendingChange(null)} style={{ flex: 1, padding: 13, backgroundColor: palette.surface, borderRadius: radius.md, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", color: palette.ink }}>Anile</Text>
                  </Pressable>
                  <Pressable onPress={handleApplyChange} disabled={applyingChange} style={{ flex: 1, padding: 13, backgroundColor: palette.ink2, borderRadius: radius.md, alignItems: "center", ...shadow.soft }}>
                    <Text style={{ color: "#000", fontFamily: "Inter_700Bold", fontWeight: "700" }}>{applyingChange ? "Aplike…" : "Konfime ✓"}</Text>
                  </Pressable>
                </View>
              </View>
            )}
              </View>
            </KeyboardSafeScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </KeyboardSafeScrollView>
  );
}
