// Step 4 — Batch: cost enters ONLY here (item + supplier + date + qty +
// total paid). Created pending; Manager/Admin/Owner receives (stock +=,
// canonical counts) or denies (reason required, terminal, locked).
// Create flow (stageMode): tapping Anrejistre COLLAPSES the entry unsaved —
// nothing is stored. A "+ ajoute yon lòt batch" button reveals the next
// blank form only on demand. Everything saves at once on Kontinye.
// Manage mode keeps immediate per-row saving.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import { fmtG } from "../../format";
import type { Batch, Item } from "../../catalogModel";
import { itemFactor, previewBatchUnitCost, mergeV2Batch, receiveV2Batch } from "../../catalogModel";
import type { FlowCtx } from "./types";
import { canHandleBatches } from "./types";
import PickerGrid from "../../components/PickerGrid";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Staged = {
  key: string;
  itemId: string;
  supplierId: string;
  qty: string;
  total: string;
  date: string;
};

export default function BatchStep({
  ctx, productId, productName, restrictSuppliers, stageMode, registerNext, onNext, onBack,
  active: stepActive = true,
}: {
  ctx: FlowCtx;
  productId: string;
  productName?: string;
  /** Create flow only: picker shows just the preselected suppliers. */
  restrictSuppliers?: boolean;
  /** Create flow: collapse stages unsaved, everything saves on Kontinye. */
  stageMode?: boolean;
  registerNext?: (fn: (() => void) | null) => void;
  onNext?: () => void;
  onBack?: () => void;
  /** Create flow: steps stay mounted; only the visible one owns Kontinye. */
  active?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [linkedSupplierIds, setLinkedSupplierIds] = useState<string[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [denyId, setDenyId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  // Staged (collapsed, UNSAVED) rows — stageMode only.
  const [staged, setStaged] = useState<Staged[]>([]);
  const [formOpen, setFormOpen] = useState(true);
  const [editingStagedKey, setEditingStagedKey] = useState<string | null>(null);
  const [seItemId, setSeItemId] = useState("");
  const [seSupplierId, setSeSupplierId] = useState("");
  const [seQty, setSeQty] = useState("");
  const [seTotal, setSeTotal] = useState("");
  const [seDate, setSeDate] = useState(todayStr());
  const [seTouched, setSeTouched] = useState(false);


  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, ss, bs] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT id, name FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => []),
        db.getAllAsync("SELECT * FROM batches").catch(() => []),
      ]);
      const list = (((its ?? []) as any[]).filter((i: any) => !i.is_deleted) as Item[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setItems(list);
      setSuppliers(((ss ?? []) as any[]).map((s: any) => ({ id: String(s.id), name: String(s.name ?? "—") })));
      // Suppliers preselected at product creation narrow this picker.
      try {
        const db2 = await getDb();
        const links = (((await db2.getAllAsync("SELECT supplier_id FROM product_suppliers WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[])
          .map((r: any) => String(r.supplier_id));
        setLinkedSupplierIds(links);
        if (links.length === 1) setSupplierId(prev => prev || links[0]);
      } catch { setLinkedSupplierIds([]); }
      const ids = new Set(list.map(i => i.id));
      const blist = (((bs ?? []) as any[]).filter((b: any) => !b.is_deleted && ids.has(String(b.item_id))) as Batch[])
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
      setBatches(blist);
      // On-demand form: rows exist → form stays hidden until "+ ajoute".
      if (stageMode && blist.length > 0) setFormOpen(false);
      if (!itemId && list.length) setItemId(list[0].id);
    } catch {}
  }
  // Steps stay mounted: refresh on every visit so rows saved by earlier
  // steps (same productId) are always visible.
  useEffect(() => { if (stepActive) load(); }, [productId, stepActive]);


  const visibleSuppliers = restrictSuppliers && linkedSupplierIds && linkedSupplierIds.length > 0
    ? suppliers.filter(s => linkedSupplierIds.includes(s.id))
    : suppliers;

  const supName = (id: string) => suppliers.find(s => s.id === id)?.name ?? "?";
  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? "?";

  function validateCandidate(c: { itemId: string; supplierId: string; qty: string; total: string; date: string }): string {
    if (!items.length) return "Kreye omwen yon inite anvan.";
    if (!items.some(i => i.id === c.itemId)) return "Chwazi inite a.";
    if (!visibleSuppliers.some(s => s.id === c.supplierId)) return "Chwazi founisè a.";
    if (!(parseFloat(c.qty) > 0)) return "Bay kantite a (> 0).";
    if (!(parseFloat(c.total) >= 0)) return "Bay total peye a.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return "Dat la dwe AAAA-MM-JJ.";
    return "";
  }

  const openError = validateCandidate({ itemId, supplierId, qty, total, date });
  const openValid = !openError;
  const openDirty = itemId !== "" || supplierId !== "" || qty.trim() !== "" || total.trim() !== "";



  // Same item + same supplier folds into one row: quantities and totals add
  // (qte sou qte, kob sou kob). Different suppliers stay separate rows.
  // Only pending batches merge — received/denied are locked history.
  function foldStaged(rows: Staged[]): Staged[] {
    const map = new Map<string, Staged>();
    for (const s of rows) {
      const k = `${s.itemId}|${s.supplierId}`;
      const e = map.get(k);
      if (e) {
        e.qty = String((parseFloat(e.qty) || 0) + (parseFloat(s.qty) || 0));
        e.total = String((parseFloat(e.total) || 0) + (parseFloat(s.total) || 0));
      } else map.set(k, { ...s });
    }
    return [...map.values()];
  }

  // ---- stageMode: Anrejistre collapses UNSAVED ----
  function stageAdd() {
    if (!openValid || busy) { setTouched(true); if (openError) Alert.alert("Enkonplè", openError); return; }
    setStaged(prev => [...prev, {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      itemId, supplierId, qty: qty.trim(), total: total.trim(), date,
    }]);
    setQty("");
    setTotal("");
    setDate(todayStr());
    setTouched(false);
    setFormOpen(false);
  }

  function removeStaged(key: string) {
    setStaged(prev => prev.filter(s => s.key !== key));
    if (editingStagedKey === key) setEditingStagedKey(null);
  }

  function openStagedEdit(s: Staged) {
    setEditingStagedKey(s.key);
    setSeItemId(s.itemId);
    setSeSupplierId(s.supplierId);
    setSeQty(s.qty);
    setSeTotal(s.total);
    setSeDate(s.date);
    setSeTouched(false);
  }

  const seTarget = staged.find(s => s.key === editingStagedKey) ?? null;
  const seError = seTarget
    ? validateCandidate({ itemId: seItemId, supplierId: seSupplierId, qty: seQty, total: seTotal, date: seDate })
    : "";
  const seValid = !seError;

  function commitStagedEdit() {
    const t = staged.find(s => s.key === editingStagedKey);
    if (!t) return;
    if (!seValid) { setSeTouched(true); Alert.alert("Enkonplè", seError); return; }
    setStaged(prev => prev.map(s => (s.key === t.key
      ? { ...s, itemId: seItemId, supplierId: seSupplierId, qty: seQty.trim(), total: seTotal.trim(), date: seDate }
      : s)));
    setEditingStagedKey(null);
  }

  useEffect(() => { if (stepActive) registerNext?.(saveStagedAndContinue); });

  async function saveStagedAndContinue() {
    if (formOpen && openDirty && !openValid) {
      setTouched(true);
      Alert.alert("Enkonplè", openError);
      return;
    }
    const pending: Staged[] = foldStaged([...staged,
      ...(formOpen && openDirty
        ? [{ key: "__open__", itemId, supplierId, qty: qty.trim(), total: total.trim(), date }]
        : []),
    ]);
    if (busy) return;
    if (!canHandleBatches(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Manager/Admin/Owner ka anrejistre batch."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(batches.map(b => b.id));
      for (const s of pending) {
        taken.add(await mergeV2Batch(db, now, taken, s));
      }
      setStaged([]);
      setFormOpen(true);
      setQty("");
      setTotal("");
      setDate(todayStr());
      setTouched(false);
      await load();
      ctx.reload();
      onNext?.();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Anrejistre batch echwe");
    } finally {
      setBusy(false);
    }
  }

  // ---- manage mode: immediate per-row save ----
  async function create() {
    if (!openValid || busy) { setTouched(true); if (openError) Alert.alert("Enkonplè", openError); return; }
    if (!canHandleBatches(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Manager/Admin/Owner ka anrejistre batch."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(batches.map(b => b.id));
      taken.add(await mergeV2Batch(db, now, taken, { itemId, supplierId, qty: qty.trim(), total: total.trim(), date }));
      setQty(""); setTotal(""); setDate(todayStr()); setTouched(false);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye batch echwe");
    } finally {
      setBusy(false);
    }
  }


  async function receive(b: Batch) {
    if (!canHandleBatches(ctx.role)) return Alert.alert("Pa gen dwa", "Sèlman Manager/Admin/Owner ka resevwa.");
    setBusy(true);
    try {
      const db = await getDb();
      await receiveV2Batch(db, {
        batchId: b.id, productId, itemId: String(b.item_id),
        quantity: Number(b.quantity), receivedBy: ctx.currentUser?.id ?? "system",
      });
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Resevwa echwe");
    } finally {
      setBusy(false);
    }
  }

  async function deny(b: Batch) {
    if (!denyReason.trim()) return Alert.alert("Rezon obligatwa", "Bay rezon refi a.");
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.runAsync("UPDATE batches SET status = ?, denied_by = ?, denied_at = ?, reason = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        ["denied", ctx.currentUser?.id ?? "system", now, denyReason.trim(), now, b.id]);
      try { await insertOutbox("batches", "update", { id: b.id, status: "denied", denied_by: ctx.currentUser?.id ?? "system", denied_at: now, reason: denyReason.trim(), updated_at: now, is_deleted: 0 }); } catch {}
      setDenyId(null);
      setDenyReason("");
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Refi echwe");
    } finally {
      setBusy(false);
    }
  }

  const statusStyle = (s: string) =>
    s === "received"
      ? { bg: "rgba(47,125,91,0.12)", bd: "rgba(47,125,91,0.3)", tx: "#4cae7f", label: "RISEVWA" }
      : s === "denied"
        ? { bg: "rgba(192,57,43,0.12)", bd: "rgba(192,57,43,0.3)", tx: "#e06c5b", label: "REFIZE" }
        : { bg: "rgba(255,255,255,0.08)", bd: "#3a3a3c", tx: "#fff", label: "AP TANN" };

  function batchFormFields(
    vItemId: string, setVItemId: (v: string) => void,
    vSupplierId: string, setVSupplierId: (v: string) => void,
    vQty: string, setVQty: (v: string) => void,
    vTotal: string, setVTotal: (v: string) => void,
    vDate: string, setVDate: (v: string) => void,
    markTouched: () => void
  ) {
    const vSelItem = items.find(i => i.id === vItemId);
    const vUnitCost = previewBatchUnitCost(parseFloat(vQty) || 0, parseFloat(vTotal) || 0);
    const vSuppliers = restrictSuppliers && linkedSupplierIds && linkedSupplierIds.length > 0
      ? suppliers.filter(s => linkedSupplierIds.includes(s.id))
      : suppliers;
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>INITE</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map(it => {
            const active = vItemId === it.id;
            return (
              <Pressable key={it.id} onPress={() => { markTouched(); setVItemId(it.id); }}
                style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{it.name}</Text>
              </Pressable>
            );
          })}
        </View>
          <PickerGrid
            title="FOUNISÈ"
            searchPlaceholder="Chèche founisè…"
            tiles={visibleSuppliers.map(s => ({ id: s.id, label: s.name }))}
            selectedIds={vSupplierId ? [vSupplierId] : []}
            onToggle={id => { markTouched(); setVSupplierId(id === vSupplierId ? "" : id); }}
          />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>KANTITE</Text>
            <TextInput value={vQty} onChangeText={v => { markTouched(); setVQty(v.replace(/[^0-9.]/g, "")); }} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
              style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>TOTAL PEYE (G)</Text>
            <TextInput value={vTotal} onChangeText={v => { markTouched(); setVTotal(v.replace(/[^0-9.]/g, "")); }} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
              style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>DAT</Text>
            <TextInput value={vDate} onChangeText={v => { markTouched(); setVDate(v); }} placeholder="AAAA-MM-JJ" placeholderTextColor="#636366"
              style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontSize: 13, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          </View>
        </View>
        {vUnitCost > 0 ? (
          <Text style={{ fontSize: 11, color: "#4cae7f", fontWeight: "700" }}>≈ {fmtG(Math.round(vUnitCost * 100) / 100)} / {vSelItem?.name ?? "inite"} (pri acha pa ekri otomatik)</Text>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontSize: 12, color: "#8e8e93" }}>{productName} · pri acha antre isit la sèlman</Text> : null}
      {batches.map(b => {
        const st = statusStyle(String(b.status));
        const it = items.find(i => i.id === b.item_id);
        const sup = suppliers.find(s => s.id === b.supplier_id);
        const f = itemFactor(items, b.item_id);
        return (
          <View key={b.id} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{it?.name ?? "?"} · {fmtG(Number(b.quantity))}</Text>
                <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{sup?.name ?? "?"} · {b.date} · {fmtG(Number(b.total_paid))}</Text>
              </View>
              <View style={{ backgroundColor: st.bg, borderWidth: 0.5, borderColor: st.bd, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: st.tx }}>{st.label}</Text>
              </View>
            </View>
            {f > 0 && Number(b.quantity) > 0 ? (
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "600" }}>≈ {fmtG(Math.round((Number(b.total_paid) / Number(b.quantity)) * 100) / 100)} / {it?.name} · {fmtG(Math.round((Number(b.total_paid) / Number(b.quantity) / f) * 100) / 100)} / baz</Text>
            ) : null}
            {b.status === "pending" && canHandleBatches(ctx.role) ? (
              denyId === b.id ? (
                <View style={{ gap: 8 }}>
                  <TextInput value={denyReason} onChangeText={setDenyReason} placeholder="Rezon refi a (obligatwa)" placeholderTextColor="#636366"
                    style={{ height: 48, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => { setDenyId(null); setDenyReason(""); }} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
                      <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Anile</Text>
                    </Pressable>
                    <Pressable onPress={() => deny(b)} disabled={busy} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#c0392b", alignItems: "center" }}>
                      <Text style={{ fontWeight: "800", fontSize: 13, color: "#fff" }}>Konfime refi</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => receive(b)} disabled={busy} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 13, color: "#000" }}>Resevwa (+stòk)</Text>
                  </Pressable>
                  <Pressable onPress={() => setDenyId(b.id)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "rgba(192,57,43,0.5)", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#e06c5b" }}>Refize</Text>
                  </Pressable>
                </View>
              )
            ) : null}
            {b.status === "denied" && b.reason ? (
              <Text style={{ fontSize: 11, color: "#8e8e93" }}>Rezon: {b.reason}</Text>
            ) : null}
          </View>
        );
      })}
      {/* Staged rows (collapsed, UNSAVED) — stageMode only */}
      {stageMode && staged.map(s => {
        const isEditing = editingStagedKey === s.key;
        return (
          <View key={s.key} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
            {!isEditing ? (
              <Pressable onPress={() => openStagedEdit(s)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{itemName(s.itemId)} · {fmtG(Number(s.qty) || 0)}</Text>
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{supName(s.supplierId)} · {s.date} · poko sove</Text>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pencil" size={17} color="#fff" />
                </View>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Modifye batch (poko sove)</Text>
                {batchFormFields(seItemId, v => setSeItemId(v), seSupplierId, v => setSeSupplierId(v), seQty, v => setSeQty(v), seTotal, v => setSeTotal(v), seDate, v => setSeDate(v), () => setSeTouched(true))}
                {seTouched && seError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{seError}</Text> : null}
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
      {/* Open form — stageMode hides it until "+ ajoute yon lòt batch" */}
      {canHandleBatches(ctx.role) && (!stageMode || formOpen) && (
        <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Nouvo batch (pending)</Text>
          {batchFormFields(itemId, v => { setTouched(true); setItemId(v); }, supplierId, v => { setTouched(true); setSupplierId(v); }, qty, v => { setTouched(true); setQty(v); }, total, v => { setTouched(true); setTotal(v); }, date, v => { setTouched(true); setDate(v); }, () => setTouched(true))}
          {touched && openError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{openError}</Text> : null}
          <Pressable onPress={stageMode ? stageAdd : create} disabled={!openValid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: openValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: openValid && !busy ? "#000" : "#636366" }}>Anrejistre batch</Text>
          </Pressable>
        </View>
      )}
      {stageMode && !formOpen && (
        <Pressable onPress={() => setFormOpen(true)} style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", borderStyle: "dashed", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>+ ajoute yon lòt batch</Text>
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
