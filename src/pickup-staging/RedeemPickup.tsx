// STAGING-PICKUP: redemption across multiple future visits. Lookup by sale ID
// (typed/scanned, id or VTE-...), plus lost-receipt search (customer/date/item).
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, Alert } from "react-native";
import { palette } from "../theme";
import { findSaleForPickup, recordPickup, listOpenPickups, toNum, remainingOf } from "./store";
import { printPickupReceipt, type PickupReceiptLine } from "./receipt";
import { PAYMENT_LABELS } from "../receipts";

export function PickupReceiptExtra({ items, saleId }: { items: any[]; saleId: string }) {
  const open = (items ?? []).filter(it => remainingOf(it) > 0);
  if (!open.length) return null;
  return (
    <View style={{ marginTop: 8, backgroundColor: palette.warningBg, borderWidth: 1, borderColor: palette.warningBd, borderRadius: 10, padding: 10 }}>
      <Text style={{ fontWeight: "800", fontSize: 11, color: palette.warning }}>RETE POU PRAN</Text>
      {open.map(it => (
        <Text key={it.id} style={{ fontSize: 11, color: palette.warning, marginTop: 2 }}>
          {it.product_name}: rete {remainingOf(it)}
        </Text>
      ))}
      <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 4 }}>ID pou rekipere: {saleId}</Text>
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
    setLines(found.items);
    const init: Record<string, string> = {};
    for (const it of open) init[it.id] = String(remainingOf(it));
    setInputs(init);
  }

  async function searchOpen() {
    const rows = await listOpenPickups(storeId, { q: query }).catch(() => []);
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
      Alert.alert(
        "Rekipere ✓ • Resi enprime",
        still.length
          ? `${touched.map(t => `${t.product_name}: achte ${toNum(t.quantity)}, pran ${t.takenNow}, rete ${t.remainingAfter}`).join("\n")}\nID: ${saleId}`
          : `Tout pran. Balans 0.`,
        [{ text: "OK", onPress: () => { setLines([]); setSaleId(null); setInputs({}); setQuery(""); onClose(); } }]
      );
    } catch (e: any) {
      Alert.alert("Bloke", e?.message ?? "Rekipere echwe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "white", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: "90%" }}>
          <Text style={{ fontWeight: "800", fontSize: 17 }}>Rekipere machandiz</Text>
          <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>Chèche pa ID vant / VTE-… (eskane oswa tape). Ka repete jiskaske 0.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TextInput value={query} onChangeText={setQuery} placeholder="ID oswa VTE-…, non kliyan, pwodwi" autoCapitalize="none"
              style={{ flex: 1, borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 10, padding: 11 }} />
            <Pressable onPress={search} style={{ paddingHorizontal: 16, backgroundColor: "#16130c", borderRadius: 10, justifyContent: "center" }}>
              <Text style={{ color: "white", fontWeight: "800" }}>Chèche</Text>
            </Pressable>
          </View>
          <Pressable onPress={searchOpen} style={{ marginTop: 8, padding: 8, alignItems: "center" }}>
            <Text style={{ color: "#6b7280", fontSize: 12, fontWeight: "600" }}>Pèdi resi? Lis vant ki gen balans (pa kliyan/dat/atik)</Text>
          </Pressable>
          {openList.length > 0 ? (
            <ScrollView style={{ maxHeight: 140, marginTop: 6 }}>
              {openList.map(r => (
                <Pressable key={r.sale.id} onPress={() => { setQuery(r.sale.sale_number ?? r.sale.id); setOpenList([]); }}
                  style={{ padding: 10, borderWidth: 1, borderColor: "#f1f5f9", borderRadius: 10, marginBottom: 6 }}>
                  <Text style={{ fontWeight: "700", fontSize: 12 }}>{r.sale.sale_number} • {r.customer?.name ?? "—"}</Text>
                  <Text style={{ fontSize: 11, color: "#6b7280" }}>{r.openItems.map((it: any) => `${it.product_name} (rete ${remainingOf(it)})`).join(", ")}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {saleId ? (
            <ScrollView style={{ marginTop: 10, maxHeight: 320 }}>
              <Text style={{ fontWeight: "700", fontSize: 13, marginBottom: 8 }}>Vant {saleNumber}</Text>
              {lines.filter(it => remainingOf(it) > 0.000001).map(it => (
                <View key={it.id} style={{ borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 12, padding: 10, marginBottom: 8 }}>
                  <Text style={{ fontWeight: "700", fontSize: 13 }}>{it.product_name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6 }}>
                    <Text style={{ fontSize: 10, color: "#64748B", fontWeight: "800", letterSpacing: 0.5 }}>ACHTE</Text>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#0F172A" }}>{toNum(it.quantity)}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: palette.warning, fontWeight: "700", marginTop: 4 }}>Rete pou pran: {remainingOf(it)}</Text>
                  <TextInput value={inputs[it.id] ?? ""} onChangeText={v => setInputs(p => ({ ...p, [it.id]: v.replace(/[^0-9.,]/g, "") }))}
                    keyboardType="decimal-pad" placeholder="kantite k ap pran kounye a"
                    style={{ marginTop: 8, borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 10, padding: 10, fontWeight: "700" }} />
                </View>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, padding: 13, backgroundColor: "#f1f5f9", borderRadius: 12, alignItems: "center" }}>
              <Text style={{ fontWeight: "700" }}>Fèmen</Text>
            </Pressable>
            {saleId ? (
              <Pressable onPress={save} disabled={saving} style={{ flex: 2, padding: 13, backgroundColor: palette.success, borderRadius: 12, alignItems: "center", opacity: saving ? 0.6 : 1 }}>
                <Text style={{ color: "white", fontWeight: "800" }}>{saving ? "Ap anrejistre…" : "Konfime rekipere"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
