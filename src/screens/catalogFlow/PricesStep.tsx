// Step 5 — Variant prices: effective-dated rows (price + date, default
// today). Current = latest date ≤ now, same-date tie → latest created.
// Prices are never overwritten: a change is a new row (history preserved).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import { fmtG } from "../../format";
import type { Item, Variant, VariantPrice } from "../../catalogModel";
import { currentVariantPrice } from "../../catalogModel";
import type { FlowCtx } from "./types";
import { canManageCatalog, uniqueId } from "./types";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PricesStep({
  ctx, productId, productName, onDone, onBack, registerNext,
  active: stepActive = true,
}: {
  ctx: FlowCtx;
  productId: string;
  productName?: string;
  onDone?: () => void;
  onBack?: () => void;
  registerNext?: (fn: (() => void) | null) => void;
  /** Create flow: steps stay mounted; only the visible one owns Kontinye. */
  active?: boolean;
}) {
  useEffect(() => { if (stepActive) registerNext?.(() => onDone?.()); });
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [prices, setPrices] = useState<VariantPrice[]>([]);
  const [variantId, setVariantId] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, vs, ps] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT * FROM variants").catch(() => []),
        db.getAllAsync("SELECT * FROM variant_prices").catch(() => []),
      ]);
      const list = (((its ?? []) as any[]).filter((i: any) => !i.is_deleted) as Item[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setItems(list);
      const ids = new Set(list.map(i => i.id));
      const vl = (((vs ?? []) as any[]).filter((v: any) => !v.is_deleted && ids.has(String(v.item_id))) as Variant[]);
      // Auto-ensure: items without variants get a silent Standard so the
      // picker is never empty (lone generic collapses in display).
      const missing = list.filter(it => !vl.some(v => v.item_id === it.id));
      if (missing.length && canManageCatalog(ctx.role)) {
        const now = new Date().toISOString();
        const taken = new Set(vl.map(v => v.id));
        for (const it of missing) {
          const id = uniqueId("var", taken, `${it.id}-standard`);
          const rec = { id, item_id: it.id, name: "Standard", sort_order: 0, created_at: now, updated_at: now, is_deleted: 0 };
          await db.runAsync(
            "INSERT OR REPLACE INTO variants (id, item_id, name, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
            [rec.id, rec.item_id, rec.name, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
          );
          try { await insertOutbox("variants", "create", { ...rec, is_deleted: false }); } catch {}
          vl.push(rec as Variant);
        }
      }
      setVariants(vl);
      const vids = new Set(vl.map(v => v.id));
      setPrices((((ps ?? []) as any[]).filter((p: any) => !p.is_deleted && vids.has(String(p.variant_id))) as VariantPrice[])
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))));
      if (!variantId && vl.length) setVariantId(vl[0].id);
    } catch {}
  }
  // Steps stay mounted: refresh on every visit so rows saved by earlier
  // steps (same productId) are always visible.
  useEffect(() => { if (stepActive) load(); }, [productId, stepActive]);

  const selVariant = variants.find(v => v.id === variantId);
  const live = selVariant ? currentVariantPrice(prices, selVariant.id) : null;
  // A variant already priced for the entered date is done — no duplicates.
  // Different dates stay pickable (scheduled updates / corrections).
  const pricedForDate = new Set(
    prices.filter(p => p.date === date).map(p => String(p.variant_id))
  );

  const error = (() => {
    if (!variants.length) return "Kreye omwen yon variant anvan (etap 4).";
    if (!selVariant) return "Chwazi variant lan.";
    if (pricedForDate.has(selVariant.id)) return "Variant sa gen pri pou dat sa a deja — chwazi yon lòt dat.";
    if (!(parseFloat(price) > 0)) return "Bay pri a (> 0).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Dat la dwe AAAA-MM-JJ.";
    return "";
  })();
  const valid = !error;

  async function add() {
    if (!valid || busy || !selVariant) { setTouched(true); if (error) Alert.alert("Enkonplè", error); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(prices.map(p => p.id));
      const id = uniqueId("vpr", taken, `${variantId}-${date}`);
      const rec = { id, variant_id: variantId, price: parseFloat(price), date, created_at: now, updated_at: now, is_deleted: 0 };
      await db.runAsync(
        "INSERT OR REPLACE INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
        [rec.id, rec.variant_id, rec.price, rec.date, rec.created_at, rec.updated_at, 0, 1]
      );
      try { await insertOutbox("variant_prices", "create", { ...rec, is_deleted: false }); } catch {}
      setPrice(""); setDate(todayStr()); setTouched(false);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Anrejistre pri echwe");
    } finally {
      setBusy(false);
    }
  }

  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? "?";

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontSize: 12, color: "#8e8e93" }}>{productName} · pri vann aktyèl pa dat</Text> : null}
      {variants.map(v => {
        const cur = currentVariantPrice(prices, v.id);
        const hist = prices.filter(p => p.variant_id === v.id);
        return (
          <View key={v.id} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{itemName(v.item_id)} · {v.name}</Text>
              <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>{cur ? fmtG(Number(cur.price)) : "—"}</Text>
            </View>
            {hist.slice(0, 4).map(h => (
              <View key={h.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 12, color: "#8e8e93" }}>{h.date}</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: h.id === cur?.id ? "#fff" : "#8e8e93" }}>{fmtG(Number(h.price))}</Text>
              </View>
            ))}
            {hist.length > 4 && <Text style={{ fontSize: 11, color: "#636366" }}>+{hist.length - 4} ansyen pri</Text>}
          </View>
        );
      })}
      {variants.length === 0 && (
        <Text style={{ fontSize: 12, color: "#8e8e93", textAlign: "center" }}>Poko gen variant — tounen etap 4.</Text>
      )}
      <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
        <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Nouvo pri</Text>
        <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>VARIANT</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {variants.map(v => {
            const active = variantId === v.id;
            const done = pricedForDate.has(v.id);
            return (
              <Pressable key={v.id} disabled={done} onPress={() => { setTouched(true); setVariantId(v.id); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", opacity: done && !active ? 0.4 : 1 }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{itemName(v.item_id)} · {v.name}</Text>
                {done && <Ionicons name="checkmark" size={12} color={active ? "#000" : "#8e8e93"} />}
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>PRI (G)</Text>
            <TextInput value={price} onChangeText={v => { setTouched(true); setPrice(v.replace(/[^0-9.]/g, "")); }} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
              style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>DAT EFÈ</Text>
            <TextInput value={date} onChangeText={v => { setTouched(true); setDate(v); }} placeholder="AAAA-MM-JJ" placeholderTextColor="#636366"
              style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          </View>
        </View>
        {touched && error ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{error}</Text> : null}
        <Pressable onPress={add} disabled={!valid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: valid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: valid && !busy ? "#000" : "#636366" }}>Anrejistre pri</Text>
        </Pressable>
      </View>
      {!registerNext && (
      <View style={{ flexDirection: "row", gap: 10 }}>
        {onBack ? (
          <Pressable onPress={onBack} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Retounen</Text>
          </Pressable>
        ) : null}
        {onDone ? (
          <Pressable onPress={onDone} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Fini</Text>
          </Pressable>
        ) : null}
      </View>
      )}
    </ScrollView>
  );
}
