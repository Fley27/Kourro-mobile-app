// BundlesStep — manage-only section for bundle deals (of espesyal,
// ex. 3 pou 500). Create + edit via the v3 record + dated price rows;
// one-tap AKTIF/ETEIN toggle straight on the row (no edit panel needed).
// Prices live at the price step — never here.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import { useSalesEvents } from "../../salesEvents";
import { fmt, fmtG } from "../../format";
import type { Item, Variant } from "../../catalogModel";
import { currentBundlePrice, upsertBundleRow } from "../../catalogModel";
import { formatCheckoutRow } from "../../labels";
import type { FlowCtx } from "./types";
import { canManageCatalog } from "./types";
import { uploadError } from "../../components/UploadTransition";
import { MoneyInput } from "../../components/maskedInput";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

export default function BundlesStep({
  ctx, productId, productName, onBack,
}: {
  ctx: FlowCtx;
  productId: string;
  productName?: string;
  onBack?: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [bundles, setBundles] = useState<any[]>([]);
  const [bundlePrices, setBundlePrices] = useState<any[]>([]);
  const [bVariantId, setBVariantId] = useState("");
  const [bMin, setBMin] = useState("");
  const [bPrice, setBPrice] = useState("");
  const [bTouched, setBTouched] = useState(false);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [eMin, setEMin] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eTouched, setETouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // On-demand form: rows exist → only "+ ajoute bundle" shows.
  const [formOpen, setFormOpen] = useState(true);

  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, vs, bs, bps] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT * FROM variants").catch(() => []),
        db.getAllAsync("SELECT * FROM bundles").catch(() => []),
        db.getAllAsync("SELECT * FROM bundle_prices").catch(() => []),
      ]);
      const list = (((its ?? []) as any[]).filter((i: any) => !i.is_deleted) as Item[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setItems(list);
      const ids = new Set(list.map(i => i.id));
      const vl = (((vs ?? []) as any[]).filter((v: any) => !v.is_deleted && ids.has(String(v.item_id))) as Variant[]);
      setVariants(vl);
      const blist = (((bs ?? []) as any[]).filter((b: any) => !b.is_deleted && vl.some(v => String(v.id) === String(b.variant_id))));
      setBundles(blist
        .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))));
      if (blist.length > 0) setFormOpen(false);
      setBundlePrices((((bps ?? []) as any[]).filter((p: any) => !p.is_deleted)) as any[]);
      if (!bVariantId && vl.length) setBVariantId(vl[0].id);
    } catch {}
  }
  useEffect(() => { load(); }, [productId]);
  // Live: a bundle edited on another register arrives through autoSync's pull
  // (load() is a no-op until a product is selected).
  useSalesEvents(() => { load().catch(() => {}); });

  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? "?";
  const bundleVariant = (bid: string) => variants.find(v => v.id === bid);
  const bundleLabel = (b: any) => {
    const v = bundleVariant(String(b.variant_id));
    return v ? formatCheckoutRow(itemName(v.item_id), productName, v.name) : "?";
  };
  const bundleLivePrice = (b: any) => currentBundlePrice(bundlePrices, String(b.id));

  function validateBundle(variant: string, min: string, price: string): string {
    if (!variants.some(v => v.id === variant)) return "Chwazi variant lan.";
    if (!(parseFloat(min) >= 2)) return "Kantite minimòm lan dwe ≥ 2.";
    if (!(parseFloat(price) > 0)) return "Bay pri bundle lan (> 0).";
    return "";
  }
  const bSelVariant = variants.find(v => v.id === bVariantId);
  const bError = validateBundle(bVariantId, bMin, bPrice);
  const bValid = !bError;

  async function addBundle() {
    if (!bValid || busy || !bSelVariant) { setBTouched(true); if (bError) Alert.alert("Enkonplè", bError); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      await upsertBundleRow(db, {
        variantId: bSelVariant.id,
        minQuantity: Math.floor(parseFloat(bMin)),
        price: parseFloat(bPrice),
        date: new Date().toISOString().slice(0, 10),
      });
      setBMin(""); setBPrice(""); setBTouched(false);
      await load();
      ctx.reload();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Anrejistre bundle echwe");
    } finally {
      setBusy(false);
    }
  }

  function openBundleEdit(b: any) {
    setEditingBundleId(String(b.id));
    setEMin(String(b.min_quantity ?? ""));
    const live = bundleLivePrice(b);
    setEPrice(live ? String(live.price) : "");
    setETouched(false);
  }

  async function commitBundleEdit() {
    const b = bundles.find(x => String(x.id) === editingBundleId);
    if (!b) return;
    const err = validateBundle(String(b.variant_id), eMin, ePrice);
    if (err) { setETouched(true); Alert.alert("Enkonplè", err); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      await upsertBundleRow(db, {
        bundleId: String(b.id),
        variantId: String(b.variant_id),
        minQuantity: Math.floor(parseFloat(eMin)),
        price: parseFloat(ePrice),
        date: new Date().toISOString().slice(0, 10),
      });
      setEditingBundleId(null);
      await load();
      ctx.reload();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Modifye bundle echwe");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBundleActive(b: any) {
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const next = !(b.active === 0 || b.active === false) ? 0 : 1;
      await db.runAsync("UPDATE bundles SET active = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        [next, now, String(b.id)]);
      try { await insertOutbox("bundles", "update", { id: String(b.id), active: next, updated_at: now, is_deleted: false }); } catch {}
      if (editingBundleId === String(b.id)) setEditingBundleId(null);
      await load();
      ctx.reload();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Chanje bundle echwe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontSize: 12, color: "#8e8e93" }}>{productName} · of espesyal (ex. 3 pou 500)</Text> : null}
      {variants.length === 0 && (
        <Text style={{ fontSize: 12, color: "#8e8e93", textAlign: "center" }}>Poko gen variant — kreye variant anvan.</Text>
      )}
      {bundles.map(b => {
        const live = bundleLivePrice(b);
        const isActive = !(b.active === 0 || b.active === false);
        const isEditing = editingBundleId === String(b.id);
        const canEdit = canManageCatalog(ctx.role);
        return (
          <View key={String(b.id)} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 8, opacity: isActive ? 1 : 0.55 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{bundleLabel(b)}</Text>
                <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                  min {fmt(Number(b.min_quantity) || 0)} → {live ? fmtG(Number(live.price)) : "—"}
                </Text>
              </View>
              {canEdit ? (
                <Pressable onPress={() => toggleBundleActive(b)} disabled={busy} style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: isActive ? "#2f7d5b" : "#3a3a3c", justifyContent: "center", paddingHorizontal: 3, alignItems: isActive ? "flex-end" : "flex-start" }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" }} />
                </Pressable>
              ) : (
                <View style={{ backgroundColor: isActive ? "rgba(76,174,127,0.12)" : "transparent", borderWidth: 1, borderColor: isActive ? "rgba(76,174,127,0.35)" : "#3a3a3c", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: isActive ? "#4cae7f" : "#8e8e93" }}>{isActive ? "AKTIF" : "ETEIN"}</Text>
                </View>
              )}
              {canEdit && !isEditing ? (
                <Pressable onPress={() => openBundleEdit(b)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pencil" size={15} color="#fff" />
                </Pressable>
              ) : null}
            </View>
            {isEditing ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>MIN QTE (≥ 2)</Text>
                    <TextInput value={eMin} onChangeText={v => { setETouched(true); setEMin(v.replace(/[^0-9]/g, "")); }} placeholder="3" placeholderTextColor="#636366" keyboardType="numeric"
                      style={{ height: 52, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>PRI BUNDLE (G)</Text>
                    <MoneyInput value={ePrice} onChangeText={v => { setETouched(true); setEPrice(v); }} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
                      style={{ height: 52, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
                  </View>
                </View>
                {(() => {
                  const err = validateBundle(String(b.variant_id), eMin, ePrice);
                  return eTouched && err ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{err}</Text> : null;
                })()}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setEditingBundleId(null)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Anile</Text>
                  </Pressable>
                  <Pressable onPress={commitBundleEdit} disabled={busy} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 13, color: "#000" }}>Mete ajou</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      {canManageCatalog(ctx.role) && formOpen ? (
        <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Nouvo bundle</Text>
          <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>VARIANT</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {variants.map(v => {
              const active = bVariantId === v.id;
              return (
                <Pressable key={v.id} onPress={() => { setBTouched(true); setBVariantId(v.id); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{formatCheckoutRow(itemName(v.item_id), productName, v.name)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>MIN QTE (≥ 2)</Text>
              <TextInput value={bMin} onChangeText={v => { setBTouched(true); setBMin(v.replace(/[^0-9]/g, "")); }} placeholder="3" placeholderTextColor="#636366" keyboardType="numeric"
                style={{ height: 52, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>PRI BUNDLE (G)</Text>
              <MoneyInput value={bPrice} onChangeText={v => { setBTouched(true); setBPrice(v); }} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
                style={{ height: 52, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
            </View>
          </View>
          {bTouched && bError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{bError}</Text> : null}
          <Pressable onPress={addBundle} disabled={!bValid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: bValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: bValid && !busy ? "#000" : "#636366" }}>Ajoute bundle</Text>
          </Pressable>
        </View>
      ) : null}
      {canManageCatalog(ctx.role) && !formOpen && (
        <Pressable onPress={() => setFormOpen(true)} style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", borderStyle: "dashed", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>+ ajoute bundle</Text>
        </Pressable>
      )}
    </KeyboardSafeScrollView>
  );
}
