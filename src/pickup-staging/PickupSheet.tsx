// Partial pickup sheet: user states how much is TAKEN WITH THEM per product.
// Bought amount sits on top of each input; balance is computed live per
// product; input above the bought amount is blocked per product.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from "react-native";
import { palette } from "../theme";
import { findSaleForPickup, setTakenTotal, toNum } from "./store";
import { printPickupReceipt, type PickupReceiptLine } from "./receipt";
import { PAYMENT_LABELS } from "../receipts";

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
      setLines(found.items);
      const init: Record<string, string> = {};
      for (const it of found.items) init[it.id] = String(toNum(it.quantity_delivered ?? it.quantity));
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
      const receiptLines: PickupReceiptLine[] = allItems.map((it: any) => {
        const bought = toNum(it.quantity);
        const takenNow = toNum(it.quantity_delivered ?? bought);
        return {
          name: it.product_name ?? "—",
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
      Alert.alert(
        "Sove ✓ • Resi enprime",
        still.length
          ? `${still.map(t => `${t.product_name}: achte ${toNum(t.quantity)}, pran ${t.takenNow}, rete ${t.remainingAfter}`).join("\n")}\nID: ${saleId}`
          : "Tout pran. Balans 0.",
        [{ text: "OK", onPress: () => { onSaved?.(); onClose(); } }]
      );
    } catch (e: any) {
      Alert.alert("Bloke", e?.message ?? "Anrejistre echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: "90%" }}>
          <Text style={{ fontWeight: "800", fontSize: 17 }}>Partial pickup</Text>
          <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
            Vant {saleNumber} • Konbyen y ap pran avèk yo? (vid = tout)
          </Text>
          <ScrollView style={{ marginTop: 12, maxHeight: 420 }}>
            {lines.map(it => {
              const bought = toNum(it.quantity);
              const v = parsed(it);
              const over = v != null && v - bought > 0.000001;
              const invalid = v != null && !(v >= 0);
              const bal = v == null ? bought - toNum(it.quantity_delivered ?? bought) : bought - v;
              return (
                <View key={it.id} style={{ borderWidth: 1, borderColor: over || invalid ? palette.dangerBd : "#e5e5ea", borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: over || invalid ? palette.dangerBg : "white" }}>
                  <Text style={{ fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{it.product_name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6 }}>
                    <Text style={{ fontSize: 10, color: "#64748B", fontWeight: "800", letterSpacing: 0.5 }}>ACHTE</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#0F172A" }}>{bought}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700" }}>Pran avèk yo:</Text>
                    <TextInput
                      value={inputs[it.id] ?? ""}
                      onChangeText={val => setInputs(p => ({ ...p, [it.id]: val.replace(/[^0-9.,]/g, "") }))}
                      keyboardType="decimal-pad"
                      placeholder={String(bought)}
                      style={{ flex: 1, borderWidth: 1.5, borderColor: over || invalid ? palette.danger : "#e5e5ea", borderRadius: 10, padding: 10, fontWeight: "700" }}
                    />
                  </View>
                  {over ? (
                    <Text style={{ fontSize: 11, color: palette.danger, fontWeight: "700", marginTop: 6 }}>
                      Pa ka depase {bought} achte.
                    </Text>
                  ) : invalid ? (
                    <Text style={{ fontSize: 11, color: palette.danger, fontWeight: "700", marginTop: 6 }}>
                      Kantite pa valab.
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 12, fontWeight: "700", marginTop: 6, color: bal > 0.000001 ? palette.warning : palette.success }}>
                      Balans: {Math.round(bal * 100) / 100}{bal > 0.000001 ? ` (rete pou rekipere)` : " (tout pran)"}
                    </Text>
                  )}
                </View>
              );
            })}
            {lines.length === 0 ? <Text style={{ color: "#94a3b8", textAlign: "center", padding: 16 }}>Pa gen liy.</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, padding: 13, backgroundColor: "#f1f5f9", borderRadius: 12, alignItems: "center" }}>
              <Text style={{ fontWeight: "700" }}>Anile</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving || hasError} style={{ flex: 2, padding: 13, backgroundColor: "#16130c", borderRadius: 12, alignItems: "center", opacity: saving || hasError ? 0.5 : 1 }}>
              <Text style={{ color: "white", fontWeight: "800" }}>{saving ? "Ap anrejistre…" : "Anrejistre balans"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
