// MissingPricesSheet — reusable backfill for variants checkout hides.
// Rows grouped by product; empty input = skip. Items without variants get
// an auto Standard on save. Prices are new effective-dated rows (today,
// history preserved — never overwritten).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../db";
import { currentVariantPrice, type UnpricedVariantRow } from "../catalogModel";
import { useResponsive, sheetBox } from "../responsive";
import { fmtG } from "../format";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MissingPricesSheet({ visible, onClose, rows, onSaved }: {
  visible: boolean;
  onClose: () => void;
  rows: UnpricedVariantRow[];
  onSaved: () => void;
}) {
  const { width, isTablet } = useResponsive();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setVals({}); setBusy(false); } }, [visible]);

  const keyOf = (r: UnpricedVariantRow) => r.variantId ?? `new:${r.itemId}`;
  const groups = new Map<string, { name: string; rows: UnpricedVariantRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.productId) ?? { name: r.productName, rows: [] };
    g.rows.push(r);
    groups.set(r.productId, g);
  }
  const filled = rows.filter(r => parseFloat(vals[keyOf(r)] ?? "") > 0);

  async function save() {
    if (!filled.length) { Alert.alert("Pa gen pri", "Antre omwen yon pri."); return; }
    if (busy) return;
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const dateStr = todayStr();
      const [allV, allP] = await Promise.all([
        db.getAllAsync("SELECT id, item_id FROM variants").catch(() => []),
        db.getAllAsync("SELECT id, variant_id, price, date, created_at FROM variant_prices").catch(() => []),
      ]);
      const liveV = (((allV ?? []) as any[]).filter((v: any) => !v.is_deleted) as any[]);
      const liveP = (((allP ?? []) as any[]).filter((p: any) => !p.is_deleted) as any[]);
      const takenV = new Set(liveV.map((v: any) => String(v.id)));
      const takenP = new Set(liveP.map((p: any) => String(p.id)));
      let saved = 0;
      for (const r of filled) {
        try {
          const v = parseFloat(vals[keyOf(r)] ?? "");
          if (!(v > 0)) continue;
          let vid = r.variantId;
          if (!vid) {
            // Bare item: someone may have added a variant since — use it.
            const sibs = liveV.filter((x: any) => String(x.item_id) === String(r.itemId));
            if (sibs.length) continue;
            let cand = `var-${r.itemId}-standard`;
            let n = 2;
            while (takenV.has(cand)) cand = `var-${r.itemId}-standard-${n++}`;
            takenV.add(cand);
            vid = cand;
            await db.runAsync(
              "INSERT OR REPLACE INTO variants (id, item_id, name, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
              [vid, r.itemId, "Standard", 0, now, now, 0, 1]
            );
            try { await insertOutbox("variants", "create", { id: vid, item_id: r.itemId, name: "Standard", sort_order: 0, created_at: now, updated_at: now, is_deleted: false }); } catch {}
            liveV.push({ id: vid, item_id: r.itemId });
          }
          const cur = currentVariantPrice(liveP as any, vid, now);
          if (cur && Number(cur.price) > 0) continue; // priced meanwhile — skip
          let pid = `vpr-${vid}-${dateStr}`;
          let n = 2;
          while (takenP.has(pid)) pid = `vpr-${vid}-${dateStr}-${n++}`;
          takenP.add(pid);
          await db.runAsync(
            "INSERT INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
            [pid, vid, v, dateStr, now, now, 0, 1]
          );
          try { await insertOutbox("variant_prices", "create", { id: pid, variant_id: vid, price: v, date: dateStr, created_at: now, updated_at: now, is_deleted: false }); } catch {}
          liveP.push({ id: pid, variant_id: vid, price: v, date: dateStr, created_at: now });
          saved++;
        } catch {}
      }
      Alert.alert("Pri anrejistre ✓", `${saved} pri ekri (dat jodi a) — variant yo parèt nan kes kounye a.`);
      onSaved();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Sove pri echwe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: "#1C1C1E", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 16, paddingBottom: 28, maxHeight: "88%" }}>
              <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pricetag-outline" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Pri mankan</Text>
                  <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 1 }} numberOfLines={2}>
                    {rows.length} variant san pri — yo pa parèt nan kes. Vid = sote.
                  </Text>
                </View>
                <Pressable onPress={onClose} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="close" size={16} color="#fff" />
                </Pressable>
              </View>
              {[...groups.entries()].map(([pid, g]) => (
                <View key={pid} style={{ marginTop: 10, backgroundColor: "#2b2b2b", borderRadius: 12, padding: 10, borderWidth: 0.5, borderColor: "#3a3a3c" }}>
                  <Text style={{ fontWeight: "800", fontSize: 13, color: "#fff" }} numberOfLines={1}>{g.name}</Text>
                  {g.rows.map(r => {
                    const k = keyOf(r);
                    return (
                      <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "600", fontSize: 12, color: "#fff" }} numberOfLines={1}>{r.itemName} · {r.variantName}</Text>
                          {!r.variantId && <Text style={{ fontSize: 10, color: "#8e8e93", marginTop: 1 }}>Ap kreye Standard otomatik</Text>}
                        </View>
                        <TextInput
                          value={vals[k] ?? ""}
                          onChangeText={v => setVals(prev => ({ ...prev, [k]: v.replace(/[^0-9.]/g, "") }))}
                          keyboardType="numeric"
                          placeholder="—"
                          placeholderTextColor="#636366"
                          selectTextOnFocus
                          style={{ width: 110, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10, textAlign: "center", fontWeight: "800", fontSize: 14, color: "#fff", backgroundColor: "transparent" }}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
              {rows.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <Text style={{ fontSize: 13, color: "#8e8e93" }}>Tout variant gen pri ✓</Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#3a3a3c" }}>
                  <Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Kite</Text>
                </Pressable>
                <Pressable onPress={save} disabled={!filled.length || busy} style={{ flex: 2, paddingVertical: 14, backgroundColor: filled.length && !busy ? "#fff" : "#2b2b2b", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: filled.length && !busy ? "#000" : "#636366", fontWeight: "800", fontSize: 14 }}>
                    ✓ Sove pri yo{filled.length > 0 ? ` (${filled.length})` : ""}
                  </Text>
                </Pressable>
              </View>
              {filled.length > 0 && (
                <Text style={{ fontSize: 11, color: "#8e8e93", textAlign: "center", marginTop: 8 }}>
                  Total: {fmtG(filled.reduce((s, r) => s + (parseFloat(vals[keyOf(r)] ?? "") || 0), 0))} (pri vann, pa acha)
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
