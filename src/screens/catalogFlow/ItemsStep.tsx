// Step 2 — Items: purchasable containers chained by ref_item + ratio.
// Any item can be the factor-1 base (owners usually pick what they buy).
// New ratios are entered as whole numbers against a reference unit with a
// Pi gwo / Pi piti relation — the software does the math, nobody types
// fractions. Tapping a row opens the FULL unit form (name + reference +
// ratio), not just rename. Ratio locks once the item has any batch or
// variant attached (owner/admin override with confirm); names stay editable.
//
// Create flow (stageMode): tapping Ajoute COLLAPSES the entry unsaved —
// nothing is stored. A "+ ajoute yon lòt inite" button reveals the next
// blank form only on demand, so nobody feels forced to add. Everything
// saves at once on Kontinye (staged first, dependency order). Manage mode
// keeps immediate per-row saving.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import type { Item } from "../../catalogModel";
import { baseItem, isItemLocked, itemDescendants as descendantsOf } from "../../catalogModel";
import type { FlowCtx } from "./types";
import { canManageCatalog, slugifyName, uniqueId } from "./types";

type Relation = "bigger" | "smaller";

const RELATIONS: { key: Relation; label: string }[] = [
  { key: "bigger", label: "Pi gwo" },
  { key: "smaller", label: "Pi piti" },
];

function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

/** "1 Sack = 9 × Mamit" style line for a row (base → "Baz"). */
export function itemRelationLine(items: Item[], it: Item): string {
  if (!it.ref_item_id) return "Baz (endisib)";
  const ref = items.find(x => x.id === it.ref_item_id);
  const refName = ref?.name ?? "?";
  const r = Number(it.ratio) || 0;
  if (!(r > 0)) return `↔ ${refName}`;
  const disp = r >= 1 ? r : 1 / r;
  return `1 ${it.name} = ${fmtNum(disp)} × ${refName}`;
}

type Staged = {
  key: string;
  name: string;
  refId: string | null; // saved item id
  refKey: string | null; // staged row key
  relation: Relation;
  qty: string;
};

function ratioFor(rel: Relation, q: number): number {
  if (rel === "bigger") return q;
  return 1 / q;
}

export default function ItemsStep({
  ctx, productId, productName, stageMode, registerNext, onNext, onBack,
  active: stepActive = true,
}: {
  ctx: FlowCtx;
  productId: string;
  productName?: string;
  /** Create flow: collapse stages unsaved, everything saves on Kontinye. */
  stageMode?: boolean;
  registerNext?: (fn: (() => void) | null) => void;
  onNext?: () => void;
  onBack?: () => void;
  /** Create flow: steps stay mounted; only the visible one owns Kontinye. */
  active?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  // Open form fields.
  const [name, setName] = useState("");
  const [refId, setRefId] = useState<string | null>(null);
  const [refKey, setRefKey] = useState<string | null>(null);
  const [relation, setRelation] = useState<Relation>("smaller");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // Staged (collapsed, UNSAVED) rows — stageMode only.
  const [staged, setStaged] = useState<Staged[]>([]);
  const [formOpen, setFormOpen] = useState(true);
  const [editingStagedKey, setEditingStagedKey] = useState<string | null>(null);
  // Full edit of a saved row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRefId, setEditRefId] = useState<string | null>(null);
  const [editRelation, setEditRelation] = useState<Relation>("smaller");
  const [editQty, setEditQty] = useState("");
  const [editOverride, setEditOverride] = useState(false);
  const [editTouched, setEditTouched] = useState(false);

  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, bs, vs] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT id, item_id FROM batches").catch(() => []),
        db.getAllAsync("SELECT id, item_id FROM variants").catch(() => []),
      ]);
      const list = (((its ?? []) as any[]).filter((i: any) => !i.is_deleted) as Item[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setItems(list);
      setBatches((bs ?? []) as any[]);
      setVariants((vs ?? []) as any[]);
      // On-demand form: rows exist → form stays hidden until "+ ajoute".
      if (stageMode && list.length > 0) setFormOpen(false);
      const base = baseItem(list);
      if (!refId && base) setRefId(base.id);
    } catch {}
  }
  // Steps stay mounted: refresh on every visit so rows saved by earlier
  // steps (same productId) are always visible.
  useEffect(() => { if (stepActive) load(); }, [productId, stepActive]);

  const locked = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (isItemLocked(it.id, batches as any, variants as any)) s.add(it.id);
    }
    return s;
  }, [items, batches, variants]);

  const isPrivileged = ctx.role === "owner" || ctx.role === "admin";

  function stagedDescendantsOf(key: string): Set<string> {
    const out = new Set<string>();
    const walk = (k: string) => {
      for (const s of staged) {
        if (s.refKey === k && !out.has(s.key)) {
          out.add(s.key);
          walk(s.key);
        }
      }
    };
    walk(key);
    return out;
  }

  function refName(refIdVal: string | null, refKeyVal: string | null): string {
    if (refKeyVal) return staged.find(s => s.key === refKeyVal)?.name ?? "?";
    return items.find(i => i.id === refIdVal)?.name ?? "?";
  }

  /** Validate one candidate (open form or staged edit). */
  function validateCandidate(
    c: { key: string | null; name: string; refId: string | null; refKey: string | null; relation: Relation; qty: string },
    stagedOthers: Staged[]
  ): string {
    const nm = c.name.trim();
    if (nm.length < 2) return "Bay non inite a (min 2 lèt).";
    const low = nm.toLowerCase();
    if (items.some(i => i.name.toLowerCase() === low)) return "Inite sa egziste deja.";
    if (stagedOthers.some(s => s.key !== c.key && s.name.trim().toLowerCase() === low)) return "Non sa deja nan lis la.";
    const hasAny = items.length > 0 || stagedOthers.length > 0;
    if (hasAny) {
      const okRef =
        (!!c.refId && items.some(i => i.id === c.refId)) ||
        (!!c.refKey && stagedOthers.some(s => s.key === c.refKey));
      if (!okRef) return "Chwazi inite referans lan.";
      if (!(parseFloat(c.qty) > 0)) return "Bay kantite a — konbyen (ex. 9).";
      if (c.refKey) {
        // No cycles through staged rows.
        const downs = stagedDescendantsOf(c.key ?? "");
        if (downs.has(c.refKey)) return "Referans sikilè pa pèmèt.";
      }
    }
    return "";
  }

  const openError = validateCandidate(
    { key: null, name, refId, refKey, relation, qty },
    staged
  );
  const openValid = !openError;
  const openDirty = name.trim() !== "" || qty.trim() !== "";

  const preview = (() => {
    const q = parseFloat(qty) || 0;
    if (!name.trim() || !(q > 0)) return null;
    const rn = refName(refId, refKey);
    if (!items.length && !staged.length) return `1 ${name.trim()} = 1 (baz)`;
    if (relation === "bigger") return `1 ${name.trim()} = ${fmtNum(q)} × ${rn}`;
    return `1 ${rn} = ${fmtNum(q)} × ${name.trim()}`;
  })();

  async function insertStagedRow(
    db: any, now: string, taken: Set<string>, order: number,
    s: { name: string; refId: string | null; refKey: string | null; relation: Relation; qty: string },
    keyToId: Map<string, string>
  ): Promise<string> {
    const id = uniqueId("item", taken, `${productId}-${slugifyName(s.name.trim()) || "u"}`);
    const refItemId = s.refKey ? keyToId.get(s.refKey) ?? null : s.refId;
    if (!refItemId && order > 0) throw new Error(`Referans "${s.name}" pa rezoud.`);
    const q = parseFloat(s.qty) || 0;
    const rec = {
      id, product_id: productId, name: s.name.trim(),
      ref_item_id: order === 0 && !s.refId && !s.refKey ? null : refItemId,
      ratio: order === 0 && !s.refId && !s.refKey ? null : ratioFor(s.relation, q),
      sort_order: order, created_at: now, updated_at: now, is_deleted: 0,
    };
    await db.runAsync(
      "INSERT OR REPLACE INTO items (id, product_id, name, ref_item_id, ratio, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [rec.id, rec.product_id, rec.name, rec.ref_item_id, rec.ratio, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
    );
    try { await insertOutbox("items", "create", { ...rec, is_deleted: false }); } catch {}
    return id;
  }

  /** Dependency order (refs first), stable for independent rows. */
  function orderStaged(list: Staged[]): Staged[] {
    const byKey = new Map(list.map(s => [s.key, s]));
    const out: Staged[] = [];
    const perm = new Set<string>();
    const temp = new Set<string>();
    const visit = (s: Staged) => {
      if (perm.has(s.key)) return;
      if (temp.has(s.key)) throw new Error("Referans sikilè.");
      temp.add(s.key);
      const dep = s.refKey ? byKey.get(s.refKey) : null;
      if (dep) visit(dep);
      temp.delete(s.key);
      perm.add(s.key);
      out.push(s);
    };
    list.forEach(visit);
    return out;
  }

  function resetForm() {
    setName(""); setQty("");
    setRelation("smaller");
    setTouched(false);
  }

  // ---- stageMode: Ajoute collapses UNSAVED ----
  function stageAdd() {
    const err = validateCandidate({ key: null, name, refId, refKey, relation, qty }, staged);
    if (err) { setTouched(true); Alert.alert("Enkonplè", err); return; }
    setStaged(prev => [...prev, {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(), refId, refKey, relation, qty: qty.trim(),
    }]);
    resetForm();
    setFormOpen(false);
  }

  function removeStaged(key: string) {
    const kids = staged.filter(s => s.refKey === key);
    if (kids.length) {
      Alert.alert("Pa ka retire", `"${kids.map(k => k.name).join(", ")}" depann de inite sa a — retire yo anvan.`);
      return;
    }
    setStaged(prev => prev.filter(s => s.key !== key));
    if (editingStagedKey === key) setEditingStagedKey(null);
  }

  function commitStagedEdit() {
    const t = staged.find(s => s.key === editingStagedKey);
    if (!t) return;
    const err = validateCandidate(
      { key: t.key, name: seName, refId: seRefId, refKey: seRefKey, relation: seRelation, qty: seQty },
      staged
    );
    if (err) { setSeTouched(true); Alert.alert("Enkonplè", err); return; }
    setStaged(prev => prev.map(s => (s.key === t.key
      ? { ...s, name: seName.trim(), refId: seRefId, refKey: seRefKey, relation: seRelation, qty: seQty.trim() }
      : s)));
    setEditingStagedKey(null);
  }

  async function saveStagedAndContinue() {
    // Blank open form is ignored; dirty one must be valid.
    if (formOpen && openDirty && !openValid) {
      setTouched(true);
      Alert.alert("Enkonplè", openError);
      return;
    }
    const pending: Staged[] = [...staged];
    if (formOpen && openDirty) {
      pending.push({ key: "__open__", name: name.trim(), refId, refKey, relation, qty: qty.trim() });
    }
    const total = items.length + pending.length;
    if (total === 0) {
      Alert.alert("Enkonplè", "Ajoute omwen yon inite.");
      return;
    }
    if (busy) return;
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(items.map(i => i.id));
      const ordered = orderStaged(pending);
      const keyToId = new Map<string, string>();
      let order = items.length;
      for (const s of ordered) {
        // First-ever item (no saved, first staged, no ref) becomes base.
        const isFirstEver = items.length === 0 && order === 0 && !s.refId && !s.refKey;
        const id = await insertStagedRow(db, now, taken, isFirstEver ? 0 : order,
          isFirstEver ? { ...s, refId: null, refKey: null } : s, keyToId);
        keyToId.set(s.key, id);
        order++;
      }
      setStaged([]);
      setFormOpen(true);
      resetForm();
      await load();
      ctx.reload();
      onNext?.();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Anrejistre inite echwe");
    } finally {
      setBusy(false);
    }
  }

  // ---- manage mode: immediate per-row save (unchanged behavior) ----
  async function addImmediate() {
    const err = validateCandidate({ key: null, name, refId: null, refKey: null, relation, qty }, []);
    void err;
    if (!openValid || busy) { setTouched(true); if (openError) Alert.alert("Enkonplè", openError); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(items.map(i => i.id));
      const id = uniqueId("item", taken, `${productId}-${slugifyName(name.trim()) || "u"}`);
      const first = items.length === 0;
      const q = parseFloat(qty) || 0;
      const rec = {
        id, product_id: productId, name: name.trim(),
        ref_item_id: first ? null : refId,
        ratio: first ? null : ratioFor(relation, q),
        sort_order: items.length, created_at: now, updated_at: now, is_deleted: 0,
      };
      await db.runAsync(
        "INSERT OR REPLACE INTO items (id, product_id, name, ref_item_id, ratio, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [rec.id, rec.product_id, rec.name, rec.ref_item_id, rec.ratio, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
      );
      try { await insertOutbox("items", "create", { ...rec, is_deleted: false }); } catch {}
      setName(""); setQty(""); setTouched(false);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye inite echwe");
    } finally {
      setBusy(false);
    }
  }

  // ---- staged-row inline edit state ----
  const [seName, setSeName] = useState("");
  const [seRefId, setSeRefId] = useState<string | null>(null);
  const [seRefKey, setSeRefKey] = useState<string | null>(null);
  const [seRelation, setSeRelation] = useState<Relation>("smaller");
  const [seQty, setSeQty] = useState("");
  const [seTouched, setSeTouched] = useState(false);

  const seTarget = staged.find(s => s.key === editingStagedKey) ?? null;
  const seError = seTarget
    ? validateCandidate(
        { key: seTarget.key, name: seName, refId: seRefId, refKey: seRefKey, relation: seRelation, qty: seQty },
        staged
      )
    : "";
  const seValid = !seError;

  function openStagedEdit(s: Staged) {
    setEditingStagedKey(s.key);
    setSeName(s.name);
    setSeRefId(s.refId);
    setSeRefKey(s.refKey);
    setSeRelation(s.relation);
    setSeQty(s.qty);
    setSeTouched(false);
  }

  function openEdit(it: Item) {
    setEditingId(it.id);
    setEditName(it.name);
    setEditRefId(it.ref_item_id);
    const r = Number(it.ratio) || 0;
    if (!it.ref_item_id) {
      setEditRelation("smaller");
      setEditQty("1");
    } else if (r >= 1) {
      setEditRelation("bigger");
      setEditQty(fmtNum(r));
    } else {
      setEditRelation("smaller");
      setEditQty(fmtNum(1 / r));
    }
    setEditOverride(false);
    setEditTouched(false);
  }

  const editingItem = editingId ? items.find(i => i.id === editingId) ?? null : null;
  const editLocked = editingItem ? locked.has(editingItem.id) : false;
  const editDescendants = useMemo(
    () => (editingItem ? descendantsOf(items, editingItem.id) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingItem?.id, items]
  );
  const editRefOptions = useMemo(
    () => items.filter(i => i.id !== editingId && !editDescendants.has(i.id)),
    [items, editingId, editDescendants]
  );
  const editError = (() => {
    if (!editingItem) return "";
    const nm = editName.trim();
    if (nm.length < 2) return "Bay non inite a (min 2 lèt).";
    if (items.some(i => i.id !== editingItem.id && i.name.toLowerCase() === nm.toLowerCase())) return "Inite sa egziste deja.";
    if (editingItem.ref_item_id || items.length > 1) {
      if (!editRefOptions.some(i => i.id === editRefId)) return "Chwazi inite referans lan.";
      if (!(parseFloat(editQty) > 0)) return "Bay kantite a — konbyen (ex. 9).";
    }
    return "";
  })();
  const editValid = !editError;
  const ratioEditable = !editLocked || editOverride;

  async function commitEdit() {
    if (!editingItem) return;
    if (!editValid) { setEditTouched(true); if (editError) Alert.alert("Enkonplè", editError); return; }
    if (editLocked && !editOverride) { setEditTouched(true); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const q = parseFloat(editQty) || 0;
      const keepRef = !editingItem.ref_item_id && items.length <= 1;
      const newRef = keepRef ? null : editRefId;
      const newRatio = keepRef ? null : ratioFor(editRelation, q);
      await db.runAsync("UPDATE items SET name = ?, ref_item_id = ?, ratio = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        [editName.trim(), newRef, newRatio, now, editingItem.id]);
      try { await insertOutbox("items", "update", { id: editingItem.id, product_id: productId, name: editName.trim(), ref_item_id: newRef, ratio: newRatio, updated_at: now, is_deleted: 0 }); } catch {}
      setEditingId(null);
      await load();
      ctx.reload();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete inite ajou echwe");
    } finally {
      setBusy(false);
    }
  }

  function askOverride() {
    Alert.alert(
      "Modifye rapò a?",
      "Inite sa a gen batch oswa variant — chanje rapò a ap afekte pri ak stòk ki deja kalkile.",
      [
        { text: "Anile", style: "cancel" },
        { text: "Modifye kanmenm", style: "destructive", onPress: () => setEditOverride(true) },
      ]
    );
  }

  const hasAnyTarget = items.length > 0 || staged.length > 0;
  useEffect(() => { if (stepActive) registerNext?.(saveStagedAndContinue); });

  function refPicker(
    valueId: string | null, valueKey: string | null,
    onPickId: (id: string | null) => void, onPickKey: (key: string | null) => void,
    excludeStagedKey: string | null, enabled: boolean,
    stagedPool: Staged[]
  ) {
    const downs = excludeStagedKey ? stagedDescendantsOf(excludeStagedKey) : new Set<string>();
    return (
      <View style={{ gap: 8, opacity: enabled ? 1 : 0.5 }}>
        <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>REFERANS</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map(it => {
            const active = valueId === it.id && !valueKey;
            return (
              <Pressable key={it.id} disabled={!enabled} onPress={() => { setTouched(true); setEditTouched(true); onPickId(active ? null : it.id); onPickKey(null); }}
                style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{it.name}</Text>
              </Pressable>
            );
          })}
          {stagedPool.filter(s => s.key !== excludeStagedKey && !downs.has(s.key)).map(s => {
            const active = valueKey === s.key;
            return (
              <Pressable key={s.key} disabled={!enabled} onPress={() => { setTouched(true); setEditTouched(true); onPickKey(active ? null : s.key); onPickId(null); }}
                style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", borderStyle: "dashed" }}>
                <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{s.name} (nouvo)</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function relationRow(
    rel: Relation, setRel: (r: Relation) => void,
    qv: string, setQv: (v: string) => void,
    enabled: boolean
  ) {
    return (
      <View style={{ gap: 8, opacity: enabled ? 1 : 0.5 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {RELATIONS.map(r => {
            const active = rel === r.key;
            return (
              <Pressable key={r.key} disabled={!enabled} onPress={() => { setTouched(true); setEditTouched(true); setRel(r.key); }}
                style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", backgroundColor: active ? "#fff" : "transparent", alignItems: "center" }}>
                <Text style={{ fontWeight: "700", fontSize: 12, color: active ? "#000" : "#fff" }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput value={qv} onChangeText={v => { setTouched(true); setEditTouched(true); setQv(v.replace(/[^0-9.]/g, "")); }} placeholder="Konbyen (ex. 9)" placeholderTextColor="#636366" keyboardType="numeric" editable={enabled}
          style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
      </View>
    );
  }

  const formPreview = (() => {
    const q = parseFloat(qty) || 0;
    if (!name.trim() || !(q > 0)) return null;
    const rn = refId ? refName(refId, refKey) : refName(null, refKey);
    if (!items.length && !staged.length) return `1 ${name.trim()} = 1 (baz)`;
    if (relation === "bigger") return `1 ${name.trim()} = ${fmtNum(q)} × ${rn}`;
    return `1 ${rn} = ${fmtNum(q)} × ${name.trim()}`;
  })();

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontSize: 12, color: "#8e8e93" }}>{productName} · {items.length + staged.length} inite</Text> : null}

      {/* Saved rows — tap pencil for the FULL unit form */}
      {items.map(it => {
        const isEditing = editingId === it.id;
        const isLocked = locked.has(it.id);
        return (
          <View key={it.id} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
            {!isEditing ? (
              <Pressable onPress={() => openEdit(it)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{it.name}</Text>
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{itemRelationLine(items, it)}{isLocked ? " • 🔒" : ""}</Text>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pencil" size={17} color="#fff" />
                </View>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Modifye inite {isLocked && !editOverride ? <Text style={{ color: "#8e8e93" }}>• 🔒 rapò fèmen</Text> : null}</Text>
                <TextInput value={editName} onChangeText={v => { setEditTouched(true); setEditName(v); }} placeholderTextColor="#636366"
                  style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                {(editingItem?.ref_item_id || items.length > 1) && (
                  <>
                    {refPicker(editRefId, null, v => setEditRefId(v), () => {}, null, ratioEditable, [])}
                    {relationRow(editRelation, setEditRelation, editQty, setEditQty, ratioEditable)}
                  </>
                )}
                {isLocked && !editOverride && isPrivileged ? (
                  <Pressable onPress={askOverride} style={{ paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Modifye rapò a kanmenm (Owner/Admin)</Text>
                  </Pressable>
                ) : null}
                {editTouched && editError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{editError}</Text> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => setEditingId(null)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Anile</Text>
                  </Pressable>
                  <Pressable onPress={commitEdit} disabled={!editValid || busy} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: editValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 13, color: editValid && !busy ? "#000" : "#636366" }}>Mete ajou</Text>
                  </Pressable>
                </View>
              </View>
            )}
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
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{s.name}</Text>
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>
                    {s.relation === "bigger"
                      ? `1 ${s.name} = ${fmtNum(parseFloat(s.qty) || 0)} × ${refName(s.refId, s.refKey)}`
                      : items.length + staged.length > 1 || s.refId || s.refKey
                        ? `1 ${refName(s.refId, s.refKey)} = ${fmtNum(parseFloat(s.qty) || 0)} × ${s.name}`
                        : "Baz (endisib)"} · poko sove
                  </Text>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pencil" size={17} color="#fff" />
                </View>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Modifye inite (poko sove)</Text>
                <TextInput value={seName} onChangeText={v => { setSeTouched(true); setSeName(v); }} placeholderTextColor="#636366"
                  style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
                {refPicker(seRefId, seRefKey, v => setSeRefId(v), k => setSeRefKey(k), s.key, true, staged)}
                {relationRow(seRelation, setSeRelation, seQty, setSeQty, true)}
                {seTouched && seError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{seError}</Text> : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => removeStaged(s.key)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(192,57,43,0.5)", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", fontSize: 13, color: "#e06c5b" }}>Retire</Text>
                  </Pressable>
                  <Pressable onPress={commitStagedEdit} disabled={!seValid || busy} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: seValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 13, color: seValid && !busy ? "#000" : "#636366" }}>Mete ajou</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {/* Open form — stageMode hides it until "+ ajoute yon lòt inite" */}
      {(!stageMode || formOpen) && (
        <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Nouvo inite</Text>
          <TextInput value={name} onChangeText={v => { setTouched(true); setName(v); }} placeholder="Sack, Mamit, Vè" placeholderTextColor="#636366"
            style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
          {hasAnyTarget && (
            <>
              {refPicker(refId, refKey, v => setRefId(v), k => setRefKey(k), null, true, staged)}
              {relationRow(relation, setRelation, qty, setQty, true)}
              {preview ? <Text style={{ fontSize: 12, color: "#8e8e93", fontWeight: "600", textAlign: "center" }}>{preview}</Text> : null}
            </>
          )}
          {touched && openError ? <Text style={{ fontSize: 12, color: "#e06c5b" }}>{openError}</Text> : null}
          <Pressable onPress={stageMode ? stageAdd : addImmediate} disabled={!openValid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: openValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 14, color: openValid && !busy ? "#000" : "#636366" }}>Ajoute inite</Text>
          </Pressable>
        </View>
      )}
      {stageMode && !formOpen && (
        <Pressable onPress={() => setFormOpen(true)} style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", borderStyle: "dashed", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>+ ajoute yon lòt inite</Text>
        </Pressable>
      )}

      {items.length === 0 && staged.length === 0 && (
        <Text style={{ fontSize: 12, color: "#8e8e93", textAlign: "center" }}>Premye inite a ap baz la (= 1) — mete sa ou achte a (ex. Sack).</Text>
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
            <Pressable onPress={onNext} disabled={!items.length} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: items.length ? "#fff" : "#2b2b2b", alignItems: "center", opacity: items.length ? 1 : 0.5 }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: items.length ? "#000" : "#636366" }}>Kontinye</Text>
            </Pressable>
          )
        ) : null}
      </View>
      )}
    </ScrollView>
  );
}
