import React from "react";
import { Modal, View, Text, Pressable, ScrollView, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { fmt, monoStyle } from "../format";
import { palette, radius, shadow } from "../theme";
import { buildReceiptHtml, copyLabel, PAYMENT_LABELS, receiptToText, fmtDateTime, type ReceiptData } from "../receipts";
import { useResponsive, sheetBox } from "../responsive";

function Row({ label, value, mono, tint }: { label: string; value: string; mono?: boolean; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ fontSize: 11, color: palette.muted, fontWeight: "500" }}>{label}</Text>
      <Text numberOfLines={1} style={[mono ? monoStyle : undefined, { flexShrink: 1, fontSize: 11, color: tint ?? palette.ink, fontWeight: "600", textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

function ReceiptPaper({ r }: { r: ReceiptData }) {
  const isCustomer = r.copyType === "customer";
  const isPayment = r.kind === "credit_payment";
  const payLabel = PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod;
  return (
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 8, paddingVertical: 18, paddingHorizontal: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
      <View style={{ alignItems: "center", gap: 1 }}>
        <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 16, color: palette.ink, letterSpacing: 1 }}>JESYON MAGAZEN</Text>
        <Text style={{ fontSize: 10, color: palette.muted2, letterSpacing: 0.3 }}>{r.storeName}</Text>
        <Text style={{ fontSize: isPayment ? 14 : 20, color: palette.ink, letterSpacing: isPayment ? 2.5 : 5, marginTop: 4, fontFamily: "Quicksand_700Bold", fontWeight: "700", textAlign: "center" }}>{isPayment ? "RESI PEMAN DÈT" : "RESI"}</Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: palette.separator }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, backgroundColor: isCustomer ? palette.blueBg : palette.accentGoldSoft, borderWidth: 0.5, borderColor: isCustomer ? palette.blueBd : palette.accentGold }}>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 9, letterSpacing: 0.8, color: isCustomer ? palette.blue : palette.accentGold }}>{copyLabel(r.copyType)}</Text>
        </View>
        <Text style={[monoStyle, { fontSize: 10, color: palette.muted2, fontWeight: "600" }]}>N° {r.receiptNumber}</Text>
      </View>

      <View style={{ marginTop: 10, gap: 4 }}>
        <Row label={isPayment ? "Dèt" : "Vant"} value={r.saleNumber} mono />
        <Row label="Dat" value={fmtDateTime(r.createdAt)} />
        <Row label="Kesye" value={`${r.cashier.name} · ${r.cashier.role}`} />
        {r.customer ? (
          <>
            <Row label="Kliyan" value={r.customer.name} />
            {r.customer.idCard ? <Row label="ID" value={r.customer.idCard} mono /> : null}
            {r.customer.phone ? <Row label="Tel" value={r.customer.phone} /> : null}
          </>
        ) : null}
      </View>

      {isPayment ? (
        <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: palette.separator, paddingTop: 10, gap: 4 }}>
          {r.debtTotal !== undefined && r.debtTotal !== null ? <Row label="Dèt total" value={`${fmt(r.debtTotal)} HTG`} mono /> : null}
          {r.previousBalance !== undefined && r.previousBalance !== null ? <Row label="Balans anvan" value={`${fmt(r.previousBalance)} HTG`} mono /> : null}
          <Row label="Peman sa a" value={`${fmt(r.amountPaid)} HTG`} mono />
          <Row label="Nouvo balans" value={`${fmt(r.amountDue)} HTG`} mono tint={r.amountDue > 0 ? "#B00020" : "#0A7C3E"} />
        </View>
      ) : (
        <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: palette.separator, paddingTop: 10 }}>
          {r.items.map((it, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Text style={[monoStyle, { fontSize: 11, color: palette.muted, fontWeight: "800", width: 56 }]}>{it.qty} ×</Text>
                <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: palette.ink, fontWeight: "600", lineHeight: 16 }}>
                  {it.name}{it.variant ? ` · ${it.variant}` : ""}
                </Text>
                <Text style={[monoStyle, { fontSize: 12, color: palette.ink, fontWeight: "800", textAlign: "right" }]}>{fmt(it.lineTotal)} HTG</Text>
              </View>
              <Text style={{ fontSize: 10, color: palette.muted3, marginLeft: 64 }}>{fmt(it.unitPrice)} HTG / {it.unitName ?? "inite"}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: palette.separator, paddingTop: 10, gap: 5 }}>
        {!isPayment ? <Row label="Sou-total" value={`${fmt(r.subtotal)} HTG`} mono /> : null}
        {!isPayment && r.discount > 0 ? <Row label="Escompte" value={`−${fmt(r.discount)} HTG`} mono tint="#B00020" /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: palette.ink2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 2 }}>
          <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 12, color: "#fff", letterSpacing: 0.5 }}>{isPayment ? "TOTAL PEMAN" : "TOTAL"}</Text>
          <Text style={[monoStyle, { fontSize: 14, color: "#fff", fontWeight: "800" }]}>{fmt(r.total)} HTG</Text>
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 4 }}>
        <Row label="Peman" value={payLabel} />
        {isPayment ? (
          r.change > 0 ? <Row label="Monnen" value={`${fmt(r.change)} HTG`} mono tint="#0A7C3E" /> : null
        ) : r.paymentMethod === "credit" ? (
          <>
            <Row label="Akompte / Peze" value={`${fmt(r.amountPaid)} HTG`} mono />
            <Row label="Rès dèt" value={`${fmt(r.amountDue)} HTG`} mono tint="#B00020" />
            {r.dueDate ? <Row label="Echèans" value={new Date(r.dueDate + "T00:00:00").toLocaleDateString()} /> : null}
          </>
        ) : (
          <>
            <Row label="Montan peye" value={`${fmt(r.amountPaid)} HTG`} mono />
            {r.change > 0 ? <Row label="Monnen" value={`${fmt(r.change)} HTG`} mono tint="#0A7C3E" /> : null}
          </>
        )}
      </View>

      <View style={{ alignItems: "center", marginTop: 14, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: palette.separator }}>
        <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 12, color: palette.ink, letterSpacing: 0.3 }}>{isPayment ? "Mèsi pou peyi dèt la!" : "Mèsi pou acha w!"}</Text>
        <Text style={{ fontSize: 9, color: palette.muted3, marginTop: 3 }}>Jesyon Magazen · Resi ofisyèl</Text>
      </View>
    </View>
  );
}

export default function ReceiptModal({ visible, receipts, onClose }: {
  visible: boolean;
  receipts: { customer: ReceiptData; store: ReceiptData } | null;
  onClose: () => void;
}) {
  const { width, isTablet } = useResponsive();
  if (!visible || !receipts) return null;
  const pair = receipts;

  async function shareClientReceiptPdf() {
    const client = pair.customer;
    const title = `Resi ${client.receiptNumber} - ${client.storeName}`;
    try {
      const file = await Print.printToFileAsync({ html: buildReceiptHtml(client), base64: false });
      if (!file.uri) throw new Error("no-file");
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: "Pataje resi kliyan an (PDF)",
          UTI: "com.adobe.pdf",
        });
        return;
      }
      throw new Error("share-unavailable");
    } catch (e) {
      // Fallback: share the receipt as plain text (web / no PDF support)
      try {
        await Share.share({
          title,
          message: receiptToText(client),
        });
      } catch {}
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.55)", justifyContent: "flex-end" }}>
        <View style={{ ...sheetBox(isTablet, width, 620), backgroundColor: palette.bgWarm, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "94%", paddingTop: 10 }}>
          <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }}>
            <View>
              <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 19, color: palette.ink, letterSpacing: -0.4 }}>RESI ✓</Text>
              <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>De kopi — youn pou kliyan, youn pou magazen</Text>
            </View>
            <Pressable onPress={onClose} style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={16} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
            <ReceiptPaper r={receipts.customer} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6 }}>
              <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: palette.muted3, borderStyle: "dashed", opacity: 0.5 }} />
              <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "600", letterSpacing: 0.5 }}>✂️ KOUPE ISIT</Text>
              <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: palette.muted3, borderStyle: "dashed", opacity: 0.5 }} />
            </View>
            <ReceiptPaper r={receipts.store} />
          </ScrollView>

          <View style={{ padding: 16, gap: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, backgroundColor: palette.surface }}>
            <Pressable onPress={shareClientReceiptPdf} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.surface2, borderRadius: radius.md, padding: 13, borderWidth: 0.5, borderColor: palette.hairline }}>
              <Ionicons name="share-outline" size={16} color={palette.ink} />
              <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 13, color: palette.ink }}>Pataje resi kliyan an (PDF)</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.ink2, borderRadius: radius.md, padding: 14, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.5)" }}>
              <Ionicons name="checkmark-circle" size={17} color="#fff" />
              <Text style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 14, color: "#fff" }}>Fèmen • Nouvo Vant</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}