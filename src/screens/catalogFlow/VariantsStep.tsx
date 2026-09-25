// Step 3 — Variants: sellable presentations of an item (Cold, Regular…).
// Variant carries no price; prices live in variant_prices (later step).
// Create flow (stageMode): tapping Ajoute COLLAPSES the entry unsaved —
// nothing is stored. A "+ ajoute yon lòt variant" button reveals the next
// blank form only on demand. Everything saves at once on Kontinye.
// Manage mode keeps immediate per-row saving.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import type { Item, Variant } from "../../catalogModel";
import type { FlowCtx } from "./types";
import { canManageCatalog, slugifyName, uniqueId } from "./types";

type Staged = { key: string; itemId: string; name: string };

export default function VariantsStep({
  ctx, productId, productName, serviceMode, stageMode, registerNext, onNext, onBack,
  active: stepActive = true,
}: {
  ctx: FlowCtx;
  productId: string;
  productName?: string;
  /** Services skip the items step: anchor variants to one auto base item. */
  serviceMode?: boolean;
  /** Create flow: collapse stages unsaved, everything saves on Kontinye. */
  stageMode?: boolean;
  registerNext?: (fn: (() => void) | null) => void;
  onNext?: () => void;
  onBack?: () => void;
  /** Create flow: steps stay mounted; only the visible one owns Kontinye. */
  active?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  // Staged (collapsed, UNSAVED) rows — stageMode only.
  const [staged, setStaged] = useState<Staged[]>([]);
  const [formOpen, setFormOpen] = useState(true);
  const [editingStagedKey, setEditingStagedKey] = useState<string | null>(null);
  const [seName, setSeName] = useState("");
  const [seTouched, setSeTouched] = useState(false);

  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, vs] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT * FROM variants").catch(() => []),
      ]);
      let list = (((its ?? []) as any[]).filter((i: any) => !i.is_deleted) as Item[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      if (!list.length && serviceMode) {
        // Services skip ItemsStep: anchor variants to one silent base item.
        // Goods never auto-create — units come from the Inite step only.
        const now = new Date().toISOString();
        const base = {
          id: `item-${productId}-base`, product_id: productId,
          name: "Sèvis",
          ref_item_id: null, ratio: null, sort_order: 0,
          created_at: now, updated_at: now, is_deleted: 0,
        };
        await db.runAsync(
          "INSERT OR REPLACE INTO items (id, product_id, name, ref_item_id, ratio, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [base.id, base.product_id, base.name, base.ref_item_id, base.ratio, base.sort_order, base.created_at, base.updated_at, 0, 1]
        );
        try { await insertOutbox("items", "create", { ...base, is_deleted: false }); } catch {}
        list = [base as Item];
      }
      setItems(list);
      const ids = new Set(list.map(i => i.id));
      const vl = (((vs ?? []) as any[]).filter((v: any) => !v.is_deleted && ids.has(String(v.item_id))) as Variant[]);
      setVariants(vl);
      // On-demand form: rows exist → form stays hidden until "+ ajoute".
      if (stageMode && vl.length > 0) setFormOpen(false);
      if (!itemId && list.length) setItemId(list[0].id);
    } catch {}
  }
  // Steps stay mounted: refresh on every visit so rows saved by earlier
  // steps (same productId) are always visible.
  useEffect(() => { if (stepActive) load(); }, [productId, stepActive]);

  const itemVariants = (id: string) => variants.filter(v => v.item_id === id);
  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? "?";

  function validateName(nm: string, item: string, excludeStagedKey: string | null): string {
    const v = nm.trim();
    if (v.length < 2) return "Bay non variant lan (min 2 lèt).";
    if (!items.some(i => i.id === item)) return "Chwazi inite a.";
    if (itemVariants(item).some(x => x.name.toLowerCase() === v.toLowerCase())) return "Variant sa egziste deja pou inite sa a.";
    if (staged.some(s => s.key !== excludeStagedKey && s.itemId === item && s.name.trim().toLowerCase() === v.toLowerCase()))
      return "Non sa deja nan lis la.";
    return "";
  }

  const openError = validateName(name, itemId, null);
  const openValid = !openError;
  const openDirty = name.trim() !== "";

  async function insertVariant(db: any, now: string, taken: Set<string>, item: string, nm: string, order: number): Promise<string> {
    const id = uniqueId("var", taken, `${item}-${slugifyName(nm) || "v"}`);
    const rec = { id, item_id: item, name: nm, sort_order: order, created_at: now, updated_at: now, is_deleted: 0 };
    await db.runAsync(
      "INSERT OR REPLACE INTO variants (id, item_id, name, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
      [rec.id, rec.item_id, rec.name, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
    );
    try { await insertOutbox("variants", "create", { ...rec, is_deleted: false }); } catch {}
    return id;
  }

  // ---- stageMode: Ajoute collapses UNSAVED ----
  function stageAdd() {
    if (!openValid || busy) { setTouched(true); if (openError) Alert.alert("Enkonplè", openError); return; }
    setStaged(prev => [...prev, {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      itemId, name: name.trim(),
    }]);
    setName("");
    setTouched(false);
    setFormOpen(false);
  }

  function removeStaged(key: string) {
    setStaged(prev => prev.filter(s => s.key !== key));
    if (editingStagedKey === key) setEditingStagedKey(null);
  }

  function commitStagedEdit() {
    const t = staged.find(s => s.key === editingStagedKey);
    if (!t) return;
    const err = validateName(seName, t.itemId, t.key);
    if (err) { setSeTouched(true); Alert.alert("Enkonplè", err); return; }
    setStaged(prev => prev.map(s => (s.key === t.key ? { ...s, name: seName.trim() } : s)));
    setEditingStagedKey(null);
  }

  useEffect(() => { if (stepActive) registerNext?.(saveStagedAndContinue); });

  async function saveStagedAndContinue() {
    if (formOpen && openDirty && !openValid) {
      setTouched(true);
      Alert.alert("Enkonplè", openError);
      return;
    }
    const pending: Staged[] = [...staged];
    if (formOpen && openDirty) {
      pending.push({ key: "__open__", itemId, name: name.trim() });
    }
    // No variant requirement here: items without variants get an
    // automatic Standard at the Prices step (single generic collapses).
    if (busy) return;
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(variants.map(v => v.id));
      const counts = new Map<string, number>();
      for (const v of variants) counts.set(v.item_id, (counts.get(v.item_id) ?? 0) + 1);
      const baseOrder = new Map<string, number>();
      for (const v of variants) {
        const c = counts.get(v.item_id) ?? 0;
        baseOrder.set(v.item_id, Math.max(baseOrder.get(v.item_id) ?? 0, c));
      }
      for (const s of pending) {
        const order = (baseOrder.get(s.itemId) ?? 0) + 1;
        baseOrder.set(s.itemId, order);
        await insertVariant(db, now, taken, s.itemId, s.name, order);
      }
      setStaged([]);
      setFormOpen(true);
      setName("");
      setTouched(false);
      await load();
      ctx.reload();
      onNext?.();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Anrejistre variant echwe");
    } finally {
      setBusy(false);
    }
  }

  // ---- manage mode: immediate per-row save ----
  async function addImmediate() {
    if (!openValid || busy) { setTouched(true); if (openError) Alert.alert("Enkonplè", openError); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(variants.map(v => v.id));
      await insertVariant(db, now, taken, itemId, name.trim(), itemVariants(itemId).length);
      setName("");
      setTouched(false);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye variant echwe");
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(v: Variant) {
    const nm = rename.trim();
    if (nm.length < 2) return Alert.alert("Non obligatwa", "Min 2 lèt.");
    if (itemVariants(v.item_id).some(x => x.id !== v.id && x.name.toLowerCase() === nm.toLowerCase()))
      return Alert.alert("Non deja egziste", "Yon lòt variant gen non sa.");
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.runAsync("UPDATE variants SET name = ?, updated_at = ?, dirty = 1 WHERE id = ?", [nm, now, v.id]);
      try { await insertOutbox("variants", "update", { id: v.id, item_id: v.item_id, name: nm, updated_at: now, is_deleted: 0 }); } catch {}
      setRenamingId(null);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Chanje non echwe");
    }
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontSize: 12, color: "#8e8e93" }}>{productName} · variant = fason yo vann</Text> : null}
      {items.map(it => {
        const vs = itemVariants(it.id);
        return (
          <View key={it.id} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 8 }}>
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>{it.name} <Text style={{ color: "#8e8e93", fontWeight: "400" }}>({vs.length})</Text></Text>
            {vs.map(v => (
              <View key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {renamingId === v.id ? (
                  <>
                    <TextInput value={rename} onChangeText={setRename} placeholderTextColor="#636366"
                      style={{ flex: 1, height: 48, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                    <Pressable onPress={() => saveRename(v)} style={{ paddingHorizontal: 16, height: 44, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontWeight: "800", fontSize: 13, color: "#000" }}>OK</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={{ flex: 1, fontSize: 14, color: "#fff" }}>{v.name}</Text>
                    <Pressable onPress={() => { setRenamingId(v.id); setRename(v.name); }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="pencil" size={15} color="#fff" />
                    </Pressable>
                  </>
                )}
              </View>
            ))}
            {vs.length === 0 && <Text style={{ fontSize: 12, color: "#636366" }}>Poko gen variant — ajoute youn anba a.</Text>}
          </View>
        );
      })}
      {/* Staged rows (collapsed, UNSAVED) — stageMode only */}
      {stageMode && staged.map(s => {
        const isEditing = editingStagedKey === s.key;
        return (
          <View key={s.key} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
            {!isEditing ? (
              <Pressable onPress={() => { setEditingStagedKey(s.key); setSeName(s.name); setSeTouched(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{s.name}</Text>
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{itemName(s.itemId)} · poko sove</Text>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pencil" size={17} color="#fff" />
                </View>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Modifye variant (poko sove)</Text>
                <TextInput value={seName} onChangeText={v => { setSeTouched(true); setSeName(v); }} placeholderTextColor="#636366"
                  style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                {seTouched && (() => {
                  const err = validateName(seName, s.itemId, s.key);
                  return err ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{err}</Text> : null;
                })()}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => removeStaged(s.key)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(192,57,43,0.5)", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#e06c5b" }}>Retire</Text>
                  </Pressable>
                  <Pressable onPress={commitStagedEdit} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 13, color: "#000" }}>Mete ajou</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}
      {/* Open form — stageMode hides it until "+ ajoute yon lòt variant" */}
      {(!stageMode || formOpen) && (
        <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Nouvo variant</Text>
          <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>INITE</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {items.map(it => {
              const active = itemId === it.id;
              return (
                <Pressable key={it.id} onPress={() => { setTouched(true); setItemId(it.id); }}
                  style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{it.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {items.length === 0 && (
            <Text style={{ fontSize: 12, color: "#e06c5b" }}>Pa gen inite — tounen nan etap Inite a.</Text>
          )}
          <TextInput value={name} onChangeText={v => { setTouched(true); setName(v); }} placeholder="Cold, Regular, Boxed" placeholderTextColor="#636366"
            style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
          {touched && openError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{openError}</Text> : null}
          <Pressable onPress={stageMode ? stageAdd : addImmediate} disabled={!openValid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: openValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: openValid && !busy ? "#000" : "#636366" }}>Ajoute variant</Text>
          </Pressable>
        </View>
      )}
      {stageMode && !formOpen && (
        <Pressable onPress={() => setFormOpen(true)} style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", borderStyle: "dashed", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>+ ajoute yon lòt variant</Text>
        </Pressable>
      )}
      {!registerNext && (
      <View style={{ flexDirection: "row", gap: 10 }}>
        {onBack ? (
          <Pressable onPress={onBack} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Retounen</Text>
          </Pressable>
        ) : null}
        {onNext ? (
          stageMode ? (
            <Pressable onPress={saveStagedAndContinue} disabled={busy} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Kontinye</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onNext} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Kontinye</Text>
            </Pressable>
          )
        ) : null}
      </View>
      )}
    </ScrollView>
  );
}
