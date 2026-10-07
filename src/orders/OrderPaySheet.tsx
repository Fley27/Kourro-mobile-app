// Assisted ordering — the tender-type screen, step-for-step checkout parity
// (POSScreen's showTenderType modal): back → total + "Chwazi ki tranzaksyon
// ou vle" → Cash / MonCash / NatCash rows pinned to the bottom → Cash opens
// the keypad (TenderView), mobile pays on a single tap. After the tender is
// chosen the screen closes and the shared upload overlay runs the same next
// steps as checkout: tender-specific copy (change / Out of / provider), ≥2s
// loading, success "total • vant anrejistre", then the receipt 150ms after
// the overlay hides (same-tick modal swaps get dropped on iOS).
// The customer picked on the order rides into the sale automatically
// (settlement resolves order.customer_id). Credit stays out: the order flow
// collects no due date/ID (validateCheckout still guards it).
import React, { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, monoStyle } from "../format";
import { topIconBtn } from "../theme";
import { PROD_DARK } from "../screens/POSShared";
import { TenderView } from "../screens/cartViews";
import { minDelay, uploadError, uploadLoading, uploadSuccess } from "../components/UploadTransition";
import type { CheckoutPayment } from "../sales/checkout";
import type { BillingLine } from "./rules";
import { collapseForBilling } from "./rules";
import { checkSettlement } from "./store";
import { settleOrder, type SettleSuccess } from "./settlement";
import type { Actor, Order, OrderLine } from "./types";

const ROW = "#262626";
type TenderId = "cash" | "moncash" | "natcash";

export function OrderPaySheet({
  visible,
  order,
  lines,
  actor,
  storeId,
  deviceId,
  storeName,
  onClose,
  onPaid,
}: {
  visible: boolean;
  order: Order;
  lines: OrderLine[];
  actor: Actor;
  storeId: string;
  deviceId: string;
  storeName: string;
  onClose: () => void;
  onPaid: (res: SettleSuccess) => void;
}) {
  const [view, setView] = useState<"main" | "tender">("main");
  const [tenderInput, setTenderInput] = useState("");
  const [busy, setBusy] = useState(false);

  const bill: BillingLine[] = useMemo(() => collapseForBilling(lines), [lines]);
  const total = useMemo(() => bill.reduce((s, b) => s + Number(b.line_total || 0), 0), [bill]);

  async function pay(payment: CheckoutPayment) {
    if (busy) return;
    // Checkout validates before closing the screen — same behavior: a stuck
    // order keeps the tender view open behind an alert. "settling" is NOT a
    // failure here: it's a previous attempt that locked the order then died
    // mid-way — settleOrder retries straight through it.
    const gate = await checkSettlement(order.id);
    if (!gate.ok && gate.order?.status !== "settling") {
      Alert.alert("Pa posib", gate.error ?? "Kòmand lan pa pare.");
      return;
    }
    // Upload copy, based on tender type (checkout's exact copy).
    let upTitle = "";
    let upDetail = "";
    if (payment.method === "cash") {
      const given = payment.amountGiven ?? total;
      const ch = Math.max(0, Math.round((given - total) * 100) / 100);
      upTitle = ch > 0 ? `${fmtG(ch)} change` : "No change";
      upDetail = `Out of ${fmtG(given)}`;
    } else {
      upTitle = payment.mobileProvider === "moncash" ? "MonCash" : "NatCash";
      upDetail = fmtG(total);
    }
    setBusy(true);
    uploadLoading(upTitle, upDetail);
    onClose();
    try {
      const res = await minDelay(settleOrder({
        orderId: order.id, storeId, deviceId, storeName, cashier: actor, payment,
      }), 2000);
      if (!res.ok) {
        uploadError(upTitle, res.error ?? "Vant lan echwe — okenn chanjman pa anrejistre nèt. Verifye epi re-eseye.", undefined, 3500);
        return;
      }
      setTenderInput("");
      setView("main");
      uploadSuccess(upTitle, `${fmtG(total)} • vant anrejistre`, () => {
        // Open the receipt after the overlay hides — same-tick modal swaps get dropped on iOS.
        setTimeout(() => onPaid(res), 150);
      }, 1500);
    } catch (e: any) {
      // Loading never auto-hides — a rejection must resolve it or the overlay sticks.
      uploadError(upTitle, e?.message ?? "Vant lan echwe — okenn chanjman pa anrejistre nèt. Verifye epi re-eseye.", undefined, 3500);
    } finally {
      setBusy(false);
    }
  }

  // Same keypad handling as the POS tender screen.
  function pressKey(k: string) {
    if (k === "back") {
      setTenderInput(prev => prev.slice(0, -1));
      return;
    }
    setTenderInput(prev => {
      const add = k === "00" ? "00" : k;
      if (prev.length + add.length > 9) return prev;
      if (prev === "") return k === "0" || k === "00" ? "" : add;
      return prev + add;
    });
  }

  function submitCash() {
    const entered = tenderInput === "" ? 0 : Number(tenderInput);
    void pay({ method: "cash", ...(tenderInput === "" ? {} : { amountGiven: entered }) });
  }

  function choose(id: TenderId) {
    if (busy) return;
    if (id === "cash") {
      setTenderInput("");
      setView("tender");
      return;
    }
    // Single tap pays immediately with this provider (POS parity).
    void pay({ method: "mobile", mobileProvider: id });
  }

  const rows: { id: TenderId; label: string }[] = [
    { id: "cash", label: "Cash" },
    { id: "moncash", label: "MonCash" },
    { id: "natcash", label: "NatCash" },
  ];

  const insets = useSafeAreaInsets();

  const backBtn = (onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Back"
      style={({ pressed }) => [{
        width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius,
        backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center",
      }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ flexGrow: 1, padding: 18, paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }}
          >
            {view === "main" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {backBtn(onClose)}
                <View style={{ flex: 1 }} />
                <View style={{ width: topIconBtn.size }} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {backBtn(() => setView("main"))}
                <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>
                  {fmtG(total)} Cash
                </Text>
                <View style={{ width: 34 }} />
              </View>
            )}

            {view === "main" ? (
              <View style={{ flex: 1 }}>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
                  <View style={{ alignItems: "center", paddingVertical: 20 }}>
                    <Text style={{ fontWeight: "900", fontSize: 32, color: "#fff", letterSpacing: -0.5, ...monoStyle }}>{fmtG(total)}</Text>
                    <Text style={{ color: "#9ca3af", fontSize: 13, marginTop: 6 }}>Chwazi ki tranzaksyon ou vle</Text>
                    {order.customer_name ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, backgroundColor: "#17171a", borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Ionicons name="person-outline" size={13} color="#C8A24A" />
                        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }} numberOfLines={1}>
                          Kliyan • <Text style={{ fontFamily: "Inter_700Bold" }}>{order.customer_name}</Text>
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </ScrollView>
                <View>
                  <View style={{ height: 1, backgroundColor: ROW }} />
                  {rows.map(opt => (
                    <Pressable
                      key={opt.id}
                      onPress={() => choose(opt.id)}
                      disabled={busy}
                      style={({ pressed }) => [{
                        flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10,
                        paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: ROW,
                      }, (pressed || busy) && { opacity: 0.6 }]}
                    >
                      <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>{opt.label}</Text>
                      <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <TenderView
                mode="cash"
                subtotal={total}
                tenderInput={tenderInput}
                onKey={pressKey}
                onTender={submitCash}
              />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
