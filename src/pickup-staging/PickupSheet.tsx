// Partial pickup sheet: user states how much is TAKEN WITH THEM per product.
// Bought amount sits on top of each input; balance is computed live per
// product; input above the bought amount is blocked per product.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from "react-native";
import { findSaleForPickup, setTakenTotal, toNum } from "./store";
import { printPickupReceipt, type PickupReceiptLine } from "./receipt";
import { PAYMENT_LABELS, receiptLineLabels, attachLineLabels } from "../receipts";
import { saleLineLabel } from "../labels";
import { getDb } from "../db";
import { uploadSuccess, uploadError } from "../components/UploadTransition";

export default function PickupSheet({ visible, saleId, storeId, cashierId, storeName, cashierName, onClose, onSaved }: {
  visible: boolean;
  saleId: string | null;
  storeId: string;
  cashierId?: string | null;
  storeName?: string | null;
  cashierName?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [lines, setLines] = useState<any[]>([]);
  const [saleNumber, setSaleNumber] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !saleId) return;
    (async () => {
      const found = await findSaleForPickup(storeId, saleId).catch(() => null);
      if (!found) { setLines([]); return; }
      setSaleNumber(found.sale.sale_number ?? found.sale.id);
      await attachLineLabels(await getDb(), found.items).catch(() => {});
      setLines(found.items);
      // Empty on purpose: the quantity is only a placeholder hint (vid = tout),
      // same convention as the POS qty input — nothing is committed until typed.
      const init: Record<string, string> = {};
      for (const it of found.items) init[it.id] = "";
      setInputs(init);
    })();
  }, [visible, saleId, storeId]);

  function parsed(it: any): number | null {
    const raw = String(inputs[it.id] ?? "").trim();
    if (!raw) return toNum(it.quantity); // empty = taken all of this product
    return toNum(raw);
  }

  const hasError = lines.some(it => {
    const v = parsed(it);
    return v != null && (!(v >= 0) || v - toNum(it.quantity) > 0.000001);
  });

  async function save() {
    if (!saleId) return;
    setSaving(true);
    try {
      const taken: Record<string, number> = {};
      for (const it of lines) {
        const raw = String(inputs[it.id] ?? "").trim();
        taken[it.id] = raw ? toNum(raw) : toNum(it.quantity); // empty = taken all
      }
      const touched = await setTakenTotal({ storeId, saleId, taken, cashierId });
      // Success: reload ALL products (even fully taken) + sale totals,
      // print the receipt, then go back to sales for the next sale.
      const fresh = await findSaleForPickup(storeId, saleId).catch(() => null);
      const allItems = fresh?.items ?? lines;
      const sale = fresh?.sale ?? null;
      const labels = await receiptLineLabels(await getDb(), allItems);
      const receiptLines: PickupReceiptLine[] = allItems.map((it: any, i: number) => {
        const bought = toNum(it.quantity);
        const takenNow = toNum(it.quantity_delivered ?? bought);
        return {
          name: labels[i] ?? it.product_name ?? "—",
          bought,
          taken: Math.round(takenNow * 100) / 100,
          remaining: Math.max(0, Math.round((bought - takenNow) * 100) / 100),
          unitPrice: Number(it.unit_price ?? 0) || undefined,
          lineTotal: Number(it.line_total ?? 0) || undefined,
        };
      });
      const total = Number(sale?.total ?? 0);
      const paid = Number(sale?.amount_paid ?? total);
      const due = Number(sale?.amount_due ?? 0);
      const pm = String(sale?.payment_method ?? "");
      try {
        await printPickupReceipt({
          kind: "partial",
          storeName: storeName ?? "Jesyon Magazen",
          saleNumber,
          saleId,
          createdAt: new Date().toISOString(),
          cashierName: cashierName ?? "Kesye",
          customerName: fresh?.customer?.name ?? null,
          lines: receiptLines,
          total,
          change: Math.max(0, Math.round((paid - total) * 100) / 100),
          balance: due,
          saleType: PAYMENT_LABELS[pm] ?? pm ?? "—",
          isCredit: pm === "credit",
        });
      } catch {}
      const still = touched.filter(t => t.remainingAfter > 0.000001);
      uploadSuccess(
        "Sove ✓ • Resi enprime",
        still.length
          ? `${still.map(t => `${saleLineLabel(t)}: achte ${toNum(t.quantity)}, pran ${t.takenNow}, rete ${t.remainingAfter}`).join("\n")}\nID: ${saleId}`
          : "Tout pran. Balans 0.",
        () => { onSaved?.(); onClose(); }
      );
    } catch (e: any) {
      uploadError("Bloke", e?.message ?? "Anrejistre echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#1C1C1E", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 16, paddingBottom: 28, maxHeight: "90%" }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
          <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }}>Partial pickup</Text>
          <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 4 }}>
            Vant {saleNumber} • Konbyen y ap pran avèk yo? (vid = tout)
          </Text>
          <ScrollView style={{ marginTop: 12, maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {lines.map(it => {
              const bought = toNum(it.quantity);
              const v = parsed(it);
              const over = v != null && v - bought > 0.000001;
              const invalid = v != null && !(v >= 0);
              const bal = v == null ? bought - toNum(it.quantity_delivered ?? bought) : bought - v;
              return (
                <View key={it.id} style={{ borderWidth: 0.5, borderColor: over || invalid ? "#ff453a" : "#3a3a3c", borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: "#2b2b2b" }}>
                  <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }} numberOfLines={1}>{saleLineLabel(it)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1c1c1e", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6 }}>
                    <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.5 }}>ACHTE</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#fff" }}>{bought}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>Pran avèk yo:</Text>
                    <TextInput
                      value={inputs[it.id] ?? ""}
                      onChangeText={val => setInputs(p => ({ ...p, [it.id]: val.replace(/[^0-9.,]/g, "") }))}
                      keyboardType="decimal-pad"
                      placeholder={String(bought)}
                      placeholderTextColor="#8e8e93"
                      style={{ flex: 1, borderWidth: 1, borderColor: over || invalid ? "#ff453a" : "#3a3a3c", borderRadius: 10, padding: 10, fontWeight: "700", color: "#fff", backgroundColor: "#000" }}
                    />
                  </View>
                  {over ? (
                    <Text style={{ fontSize: 11, color: "#ff453a", fontWeight: "700", marginTop: 6 }}>
                      Pa ka depase {bought} achte.
                    </Text>
                  ) : invalid ? (
                    <Text style={{ fontSize: 11, color: "#ff453a", fontWeight: "700", marginTop: 6 }}>
                      Kantite pa valab.
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 12, fontWeight: "700", marginTop: 6, color: bal > 0.000001 ? "#FFD60A" : "#7bd88f" }}>
                      Balans: {Math.round(bal * 100) / 100}{bal > 0.000001 ? ` (rete pou rekipere)` : " (tout pran)"}
                    </Text>
                  )}
                </View>
              );
            })}
            {lines.length === 0 ? <Text style={{ color: "#8e8e93", textAlign: "center", padding: 16 }}>Pa gen liy.</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Anile</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving || hasError} style={{ flex: 2, paddingVertical: 14, backgroundColor: saving || hasError ? "#2b2b2b" : "#fff", borderRadius: 12, alignItems: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: saving || hasError ? "#8e8e93" : "#16130c" }}>{saving ? "Ap anrejistre…" : "Anrejistre balans"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
