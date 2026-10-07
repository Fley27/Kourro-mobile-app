// STAGING-PICKUP: redemption across multiple future visits. Lookup by sale ID
// (typed/scanned, id or VTE-...), plus lost-receipt search (customer/date/item).
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive, sheetBox } from "../responsive";
import { findSaleForPickup, recordPickup, listOpenPickups, toNum, remainingOf } from "./store";
import { printPickupReceipt, type PickupReceiptLine } from "./receipt";
import { PAYMENT_LABELS, receiptLineLabels, attachLineLabels } from "../receipts";
import { saleLineLabel } from "../labels";
import { getDb } from "../db";
import { uploadSuccess, uploadError } from "../components/UploadTransition";
import { KeyboardSafeView } from "../components/KeyboardSafe";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

export function PickupReceiptExtra({ items, saleId }: { items: any[]; saleId: string }) {
  const open = (items ?? []).filter(it => remainingOf(it) > 0);
  if (!open.length) return null;
  return (
    <View style={{ marginTop: 8, backgroundColor: "rgba(255,214,10,0.14)", borderWidth: 1, borderColor: "rgba(255,214,10,0.4)", borderRadius: 10, padding: 10 }}>
      <Text style={{ fontWeight: "800", fontSize: 11, color: "#FFD60A" }}>RETE POU PRAN</Text>
      {open.map(it => (
        <Text key={it.id} style={{ fontSize: 11, color: "#FFD60A", marginTop: 2 }}>
          {saleLineLabel(it)}: rete {remainingOf(it)}
        </Text>
      ))}
      <Text style={{ fontSize: 10, color: "#8e8e93", marginTop: 4 }}>ID pou rekipere: {saleId}</Text>
    </View>
  );
}

export default function RedeemPickup({ visible, storeId, cashierId, storeName, cashierName, onClose }: {
  visible: boolean;
  storeId: string;
  cashierId?: string | null;
  storeName?: string | null;
  cashierName?: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<any[]>([]);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [saleNumber, setSaleNumber] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [openList, setOpenList] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  async function search() {
    const found = await findSaleForPickup(storeId, query).catch(() => null);
    if (!found) return Alert.alert("Pa jwenn", `Pa gen vant pou "${query}".`);
    const open = found.items.filter((it: any) => remainingOf(it) > 0);
    if (!open.length) return Alert.alert("Pa gen balans", "Tout machandiz vant sa a deja pran.");
    setSaleId(found.sale.id);
    setSaleNumber(found.sale.sale_number ?? found.sale.id);
    await attachLineLabels(await getDb(), found.items).catch(() => {});
    setLines(found.items);
    // Empty on purpose: the remaining quantity is only a placeholder hint
    // (empty = take all that remains) — nothing is committed until typed.
    const init: Record<string, string> = {};
    for (const it of open) init[it.id] = "";
    setInputs(init);
  }

  async function searchOpen() {
    const rows = await listOpenPickups(storeId, { q: query }).catch(() => []);
    const db = await getDb();
    for (const r of rows) await attachLineLabels(db, r.openItems ?? []).catch(() => {});
    setOpenList(rows.slice(0, 20));
  }

  async function save() {
    if (!saleId) return;
    setSaving(true);
    try {
      const taken: Record<string, number> = {};
      for (const it of lines) {
        if (remainingOf(it) <= 0.000001) continue;
        const raw = String(inputs[it.id] ?? "").trim();
        // empty = taken all that remains of this product
        taken[it.id] = raw ? toNum(raw) : remainingOf(it);
      }
      const touched = await recordPickup({ storeId, saleId, taken, cashierId });
      // Success: reload ALL products (even fully taken) + sale totals,
      // print the receipt, then back to sales.
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
          kind: "redeem",
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
        "Rekipere ✓ • Resi enprime",
        still.length
          ? `${touched.map(t => `${saleLineLabel(t)}: achte ${toNum(t.quantity)}, pran ${t.takenNow}, rete ${t.remainingAfter}`).join("\n")}\nID: ${saleId}`
          : `Tout pran. Balans 0.`,
        () => { setLines([]); setSaleId(null); setInputs({}); setQuery(""); onClose(); }
      );
    } catch (e: any) {
      uploadError("Bloke", e?.message ?? "Rekipere echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardSafeView>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#1C1C1E", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 16, paddingBottom: 28 + insets.bottom, maxHeight: "90%" }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
          <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }}>Rekipere machandiz</Text>
          <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 4 }}>Chèche pa ID vant / VTE-… (eskane oswa tape). Ka repete jiskaske 0.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TextInput value={query} onChangeText={setQuery} placeholder="ID oswa VTE-…, non kliyan, pwodwi" autoCapitalize="none"
              placeholderTextColor="#8e8e93"
              style={{ flex: 1, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, padding: 11, color: "#fff", backgroundColor: "#000" }} />
            <Pressable onPress={search} style={{ paddingHorizontal: 16, backgroundColor: "#fff", borderRadius: 10, justifyContent: "center" }}>
              <Text style={{ color: "#16130c", fontWeight: "800" }}>Chèche</Text>
            </Pressable>
          </View>
          <Pressable onPress={searchOpen} style={{ marginTop: 8, padding: 8, alignItems: "center" }}>
            <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>Pèdi resi? Lis vant ki gen balans (pa kliyan/dat/atik)</Text>
          </Pressable>
          {openList.length > 0 ? (
            <KeyboardSafeScrollView style={{ maxHeight: 140, marginTop: 6 }}>
              {openList.map(r => (
                <Pressable key={r.sale.id} onPress={() => { setQuery(r.sale.sale_number ?? r.sale.id); setOpenList([]); }}
                  style={{ padding: 10, borderWidth: 0.5, borderColor: "#3a3a3c", backgroundColor: "#2b2b2b", borderRadius: 10, marginBottom: 6 }}>
                  <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>{r.sale.sale_number} • {r.customer?.name ?? "—"}</Text>
                  <Text style={{ fontSize: 11, color: "#8e8e93" }}>{r.openItems.map((it: any) => `${saleLineLabel(it)} (rete ${remainingOf(it)})`).join(", ")}</Text>
                </Pressable>
              ))}
            </KeyboardSafeScrollView>
          ) : null}
          {saleId ? (
            <KeyboardSafeScrollView style={{ marginTop: 10, maxHeight: 320 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ fontWeight: "700", fontSize: 13, marginBottom: 8, color: "#fff" }}>Vant {saleNumber}</Text>
              {lines.filter(it => remainingOf(it) > 0.000001).map(it => (
                <View key={it.id} style={{ borderWidth: 0.5, borderColor: "#3a3a3c", backgroundColor: "#2b2b2b", borderRadius: 12, padding: 10, marginBottom: 8 }}>
                  <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>{saleLineLabel(it)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1c1c1e", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6 }}>
                    <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.5 }}>ACHTE</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#fff" }}>{toNum(it.quantity)}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: "#FFD60A", fontWeight: "700", marginTop: 4 }}>Rete pou pran: {remainingOf(it)}</Text>
                  <TextInput value={inputs[it.id] ?? ""} onChangeText={v => setInputs(p => ({ ...p, [it.id]: v.replace(/[^0-9.,]/g, "") }))}
                    keyboardType="decimal-pad" placeholder={String(Math.round(remainingOf(it) * 100) / 100)} placeholderTextColor="#8e8e93"
                    style={{ marginTop: 8, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, padding: 10, fontWeight: "700", color: "#fff", backgroundColor: "#000" }} />
                </View>
              ))}
            </KeyboardSafeScrollView>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Fèmen</Text>
            </Pressable>
            {saleId ? (
              <Pressable onPress={save} disabled={saving} style={{ flex: 2, paddingVertical: 14, backgroundColor: saving ? "#2b2b2b" : "#fff", borderRadius: 12, alignItems: "center" }}>
                <Text style={{ color: saving ? "#8e8e93" : "#16130c", fontWeight: "800", fontSize: 14 }}>{saving ? "Ap anrejistre…" : "Konfime rekipere"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    
      </KeyboardSafeView>
    </Modal>
  );
}
