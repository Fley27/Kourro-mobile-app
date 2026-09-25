// CategoryFormModal — reusable full-screen black modal to create categories.
// Chain up to 10 at once: collapsing a valid form freezes it as a temp row;
// tapping a temp opens its own edit screen (update below). Kreye saves the
// whole chain (parents first, then links); X discards all. A blank open form
// is ignored when temps exist; a touched form must be fully valid.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, Alert, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, shadow, topIconBtn } from "../theme";
import { getDb, insertOutbox } from "../db";
import { type Category, categoryDisplayIcon, categoryIonicon, matchCategoryIconNames, slugify } from "../screens/CatalogShared";

type Glyph = keyof typeof Ionicons.glyphMap;

const MAX_CHAIN = 10;

const ALL_ICONS: Glyph[] = [
  "restaurant-outline", "beer-outline", "wine-outline", "cafe-outline",
  "water-outline", "pizza-outline", "egg-outline", "fish-outline",
  "nutrition-outline", "ice-cream-outline", "home-outline", "basket-outline",
  "leaf-outline", "cart-outline", "pricetag-outline", "shapes-outline",
];

type Draft = {
  key: string;
  name: string;
  icon: Glyph | null;
  parentIds: string[];
  collapsed: boolean;
  provisionalId: string | null;
};

function freshDraft(): Draft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "", icon: null, parentIds: [],
    collapsed: false, provisionalId: null,
  };
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base;
  let n = 2;
  while (!slug || slug === "all" || taken.has(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** "" = valid, otherwise the reason. Icon is required, name unique, slug free. */
function draftError(d: Draft, others: Draft[], dbCats: Category[]): string {
  const nm = d.name.trim();
  if (nm.length < 2) return "Bay non kategori a (min 2 lèt).";
  const low = nm.toLowerCase();
  if (dbCats.some(c => c.name.toLowerCase() === low)) return "Kategori sa egziste deja.";
  if (others.some(o => o.key !== d.key && o.name.trim().toLowerCase() === low)) return "Non sa deja nan lis la.";
  const slug = slugify(nm);
  const taken = new Set(dbCats.map(c => c.id));
  others.forEach(o => { if (o.provisionalId) taken.add(o.provisionalId); });
  if (!slug || slug === "all" || taken.has(slug)) return "Non sa pa ka itilize (id konfli).";
  if (!d.icon) return "Chwazi yon ikon.";
  return "";
}

/** Temp ids reachable below the given temp (its children, recursively). */
function descendantsOf(id: string, drafts: Draft[]): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const d of drafts) {
      if (d.provisionalId && d.parentIds.includes(pid) && !out.has(d.provisionalId)) {
        out.add(d.provisionalId);
        walk(d.provisionalId);
      }
    }
  };
  walk(id);
  return out;
}

/** DB ids reachable below the given category (its children, recursively). */
function dbDescendantsOf(id: string, links: { child_id: string; parent_id: string }[]): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const l of links) {
      if (l.parent_id === pid && !out.has(l.child_id)) {
        out.add(l.child_id);
        walk(l.child_id);
      }
    }
  };
  walk(id);
  return out;
}

/** Generic edge-list cycle check: can `start` reach itself? */
function edgesReachSelf(edges: { child_id: string; parent_id: string }[], start: string): boolean {
  const visit = (id: string, stack: Set<string>): boolean => {
    if (stack.has(id)) return true;
    stack.add(id);
    for (const e of edges) {
      if (e.child_id === id && (e.parent_id === id || visit(e.parent_id, stack))) return true;
    }
    stack.delete(id);
    return false;
  };
  return visit(start, new Set());
}

/** Defensive DAG check — temp→temp edges only point backwards, so a cycle
 *  is impossible via the UI, but never trust the UI alone. */
function hasCycle(ds: { provisionalId: string; parentIds: string[] }[]): boolean {
  const ids = new Set(ds.map(d => d.provisionalId));
  const visit = (id: string, stack: Set<string>): boolean => {
    if (stack.has(id)) return true;
    const node = ds.find(d => d.provisionalId === id);
    if (!node) return false;
    stack.add(id);
    for (const p of node.parentIds) {
      if (p === id) return true;
      if (ids.has(p) && visit(p, stack)) return true;
    }
    stack.delete(id);
    return false;
  };
  return ds.some(d => visit(d.provisionalId, new Set()));
}

/** Compact field set shared by the open form and the edit screen. Icon and
 *  parents live in collapsed accordions to keep the form short. */
function CategoryFields({
  name, icon, parentIds,
  onName, onIcon, onToggleParent,
  dbCats, tempOptions, nameError, touched,
}: {
  name: string; icon: Glyph | null; parentIds: string[];
  onName: (v: string) => void; onIcon: (g: Glyph) => void; onToggleParent: (id: string) => void;
  dbCats: Category[];
  tempOptions: { id: string; name: string; icon: Glyph | null }[];
  nameError: string; touched: boolean;
}) {
  const [iconOpen, setIconOpen] = useState(false);
  const [parentsOpen, setParentsOpen] = useState(false);
  const suggestions = useMemo(
    () => matchCategoryIconNames(name).filter(g => g !== icon),
    [name, icon]
  );
  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Non kategori *</Text>
        <TextInput
          value={name}
          onChangeText={onName}
          placeholder="Eg. Fwi, Bwason, Sanitè"
          placeholderTextColor="#636366"
          style={{ borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, height: 60, fontSize: 14, color: "#fff", backgroundColor: "transparent" }}
        />
        {touched && nameError ? (
          <Text style={{ fontSize: 12, color: "#e06c5b", marginTop: 6 }}>{nameError}</Text>
        ) : null}
      </View>

      <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, overflow: "hidden" }}>
        <Pressable onPress={() => setIconOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
          <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: "#fff" }}>Ikon *</Text>
          {icon ? (
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={icon} size={17} color="#000" />
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: "#636366" }}>Chwazi</Text>
          )}
          <Ionicons name={iconOpen ? "chevron-up" : "chevron-down"} size={16} color="#8e8e93" />
        </Pressable>
        {iconOpen && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
            {suggestions.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>SIJERE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 12 }}>
                  {suggestions.map(g => (
                    <Pressable key={g} onPress={() => onIcon(g)} style={{ width: 52, height: 52, borderRadius: 14, borderWidth: icon === g ? 0 : 1, borderColor: "#2b2b2b", backgroundColor: icon === g ? "#fff" : "#1C1C1E", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={g} size={24} color={icon === g ? "#000" : "#fff"} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            <View>
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>TOUT IKON</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 12 }}>
                {ALL_ICONS.filter(g => !suggestions.includes(g)).map(g => (
                  <Pressable key={g} onPress={() => onIcon(g)} style={{ width: 52, height: 52, borderRadius: 14, borderWidth: icon === g ? 0 : 1, borderColor: "#2b2b2b", backgroundColor: icon === g ? "#fff" : "#1C1C1E", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={g} size={24} color={icon === g ? "#000" : "#fff"} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </View>

      <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, overflow: "hidden" }}>
        <Pressable onPress={() => setParentsOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
          <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: "#fff" }}>
            Belongs Under <Text style={{ fontWeight: "400", color: "#8e8e93" }}>(opsyonèl{parentIds.length ? ` • ${parentIds.length}` : ""})</Text>
          </Text>
          <Ionicons name={parentsOpen ? "chevron-up" : "chevron-down"} size={16} color="#8e8e93" />
        </Pressable>
        {parentsOpen && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 12 }}>
            {tempOptions.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>NOUVO NAN LIS SA A</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {tempOptions.map(t => {
                    const active = parentIds.includes(t.id);
                    return (
                      <Pressable key={t.id} onPress={() => onToggleParent(t.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                        {t.icon ? <Ionicons name={t.icon} size={14} color={active ? "#000" : "#fff"} /> : null}
                        <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{t.name}</Text>
                        {active && <Ionicons name="checkmark" size={12} color="#000" />}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            <View>
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>KATEGORI KI EGZISTE</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {dbCats.map(c => {
                  const active = parentIds.includes(c.id);
                  const gi = categoryDisplayIcon(c);
                  return (
                    <Pressable key={c.id} onPress={() => onToggleParent(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
                      {gi ? <Ionicons name={gi} size={14} color={active ? "#000" : "#fff"} /> : <Text style={{ fontSize: 13 }}>{c.icon}</Text>}
                      <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{c.name}</Text>
                      {active && <Ionicons name="checkmark" size={12} color="#000" />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export default function CategoryFormModal({
  visible, onClose, onSaved, categories, storeId = "demo-store-id",
  editCategory, editParentIds, allLinks,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (createdIds: string[]) => void;
  categories: Category[];
  storeId?: string;
  /** Edit-existing mode: prefilled single form, no chaining. */
  editCategory?: Category | null;
  editParentIds?: string[];
  allLinks?: { child_id: string; parent_id: string }[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>([freshDraft()]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // Separate edit screen for a collapsed temp.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState<Glyph | null>(null);
  const [editParents, setEditParents] = useState<string[]>([]);
  const [editTouched, setEditTouched] = useState(false);
  // Edit-existing mode fields.
  const [exName, setExName] = useState("");
  const [exIcon, setExIcon] = useState<Glyph | null>(null);
  const [exParents, setExParents] = useState<string[]>([]);
  const [exTouched, setExTouched] = useState(false);

  useEffect(() => {
    if (visible) {
      setDrafts([freshDraft()]);
      setBusy(false);
      setTouched(false);
      setEditingKey(null);
      if (editCategory) {
        setExName(editCategory.name);
        setExIcon(categoryIonicon(editCategory));
        setExParents(editParentIds ?? []);
        setExTouched(false);
      }
    }
  }, [visible, editCategory]);

  const dbCats = useMemo(() => categories.filter(c => c.id !== "all"), [categories]);
  const open = drafts[drafts.length - 1];
  const temps = useMemo(() => drafts.filter(d => d.collapsed && d.provisionalId), [drafts]);
  const openError = draftError(open, drafts, dbCats);
  const openValid = !openError;
  const openBlank = !open.name.trim() && !open.icon && open.parentIds.length === 0;
  // Blank open form is ignored when temps exist; a touched form must be valid.
  const kreyeEnabled = !busy && (temps.length > 0 ? openBlank || openValid : openValid);

  function patchOpen(patch: Partial<Draft>) {
    setTouched(true);
    setDrafts(prev => prev.map((d, i) => (i === prev.length - 1 ? { ...d, ...patch } : d)));
  }

  function toggleOpenParent(id: string) {
    setTouched(true);
    setDrafts(prev => prev.map((d, i) =>
      i === prev.length - 1
        ? { ...d, parentIds: d.parentIds.includes(id) ? d.parentIds.filter(x => x !== id) : [...d.parentIds, id] }
        : d
    ));
  }

  function parentName(id: string): string {
    const t = temps.find(d => d.provisionalId === id);
    if (t) return `${t.name} (nouvo)`;
    return dbCats.find(c => c.id === id)?.name ?? id;
  }

  function collapseOpen() {
    const err = draftError(open, drafts, dbCats);
    if (err) {
      setTouched(true);
      Alert.alert("Enkonplè", err);
      return;
    }
    const taken = new Set(dbCats.map(c => c.id));
    drafts.forEach(d => { if (d.provisionalId) taken.add(d.provisionalId); });
    const pid = uniqueSlug(slugify(open.name.trim()), taken);
    setDrafts(prev => [
      ...prev.slice(0, -1),
      { ...open, collapsed: true, provisionalId: pid },
      freshDraft(),
    ]);
    setTouched(false);
  }

  function removeDraft(key: string) {
    const target = drafts.find(d => d.key === key);
    if (!target?.provisionalId) return;
    const kids = drafts.filter(d => d.key !== key && d.parentIds.includes(target.provisionalId!));
    const doRemove = () => {
      setDrafts(prev => {
        const next = prev
          .filter(d => d.key !== key)
          .map(d => ({ ...d, parentIds: d.parentIds.filter(p => p !== target.provisionalId) }));
        return next.length ? next : [freshDraft()];
      });
      if (key === editingKey) setEditingKey(null);
    };
    if (kids.length) {
      Alert.alert(
        "Efase kategori?",
        `"${target.name}" gen ${kids.length} kategori ki depann de li (${kids.map(k => k.collapsed ? k.name : "fòm aktyèl").join(", ")}). Lyen yo ap kase.`,
        [{ text: "Anile", style: "cancel" }, { text: "Efase", style: "destructive", onPress: doRemove }]
      );
    } else {
      doRemove();
    }
  }

  function openEdit(t: Draft) {
    setEditingKey(t.key);
    setEditName(t.name);
    setEditIcon(t.icon);
    setEditParents([...t.parentIds]);
    setEditTouched(false);
  }

  const editDraft = editingKey ? drafts.find(d => d.key === editingKey && d.collapsed) ?? null : null;
  const editExcluded = useMemo(() => {
    if (!editDraft?.provisionalId) return new Set<string>();
    const s = new Set<string>([editDraft.provisionalId]);
    descendantsOf(editDraft.provisionalId, drafts).forEach(x => s.add(x));
    return s;
  }, [editDraft, drafts]);
  const editTempOptions = useMemo(
    () => temps.filter(t => t.key !== editingKey && !editExcluded.has(t.provisionalId!)).map(t => ({ id: t.provisionalId!, name: t.name, icon: t.icon })),
    [temps, editingKey, editExcluded]
  );
  const editError = editDraft
    ? draftError(
        { ...editDraft, name: editName, icon: editIcon, parentIds: editParents },
        drafts.filter(d => d.key !== editDraft.key),
        dbCats
      )
    : "";
  const editValid = !editError;

  function commitEdit() {
    const d = editDraft;
    if (!d?.provisionalId) return;
    if (!editValid) {
      setEditTouched(true);
      Alert.alert("Enkonplè", editError);
      return;
    }
    const taken = new Set(dbCats.map(c => c.id));
    drafts.forEach(x => { if (x.key !== d.key && x.provisionalId) taken.add(x.provisionalId); });
    const newSlug = uniqueSlug(slugify(editName.trim()), taken);
    const oldPid = d.provisionalId;
    const remap = (ids: string[]) => ids.map(p => (p === oldPid ? newSlug : p));
    setDrafts(prev => prev.map(x =>
      x.key === d.key
        ? { ...x, name: editName.trim(), icon: editIcon, parentIds: remap(editParents), provisionalId: newSlug }
        : { ...x, parentIds: remap(x.parentIds) }
    ));
    setEditingKey(null);
  }

  // ---- edit-existing mode (single form, no chaining) ----
  const exOrigIcon = editCategory ? categoryIonicon(editCategory) : null;
  const exExcluded = useMemo(() => {
    if (!editCategory) return new Set<string>();
    const s = new Set<string>([editCategory.id]);
    dbDescendantsOf(editCategory.id, allLinks ?? []).forEach(x => s.add(x));
    return s;
  }, [editCategory, allLinks]);
  const exDbCats = useMemo(() => dbCats.filter(c => !exExcluded.has(c.id)), [dbCats, exExcluded]);
  const exError = editCategory
    ? (() => {
        const nm = exName.trim();
        if (nm.length < 2) return "Bay non kategori a (min 2 lèt).";
        const low = nm.toLowerCase();
        if (dbCats.some(c => c.id !== editCategory.id && c.name.toLowerCase() === low)) return "Kategori sa egziste deja.";
        const slug = slugify(nm);
        if (!slug || slug === "all") return "Non sa pa ka itilize (id konfli).";
        if (!exIcon) return "Chwazi yon ikon.";
        return "";
      })()
    : "";
  const exChanged = editCategory
    ? exName.trim() !== editCategory.name ||
      exIcon !== exOrigIcon ||
      [...exParents].sort().join("|") !== [...(editParentIds ?? [])].sort().join("|")
    : false;
  const exCanSave = !!editCategory && !exError && exChanged && !busy;

  async function handleSaveExisting() {
    if (!editCategory) return;
    if (!exCanSave) {
      setExTouched(true);
      if (exError) Alert.alert("Enkonplè", exError);
      return;
    }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const oldId = editCategory.id;
      const taken = new Set(dbCats.map(c => c.id));
      taken.delete(oldId);
      const newId = uniqueSlug(slugify(exName.trim()), taken);
      const finalParents = [...exParents];
      // Cycle check on the rewritten graph (old edges out, new edges in).
      const edges = (allLinks ?? [])
        .filter(l => l.child_id !== oldId)
        .map(l => ({ child_id: l.child_id, parent_id: l.parent_id }));
      for (const p of finalParents) edges.push({ child_id: newId, parent_id: p });
      if (edgesReachSelf(edges, newId)) {
        Alert.alert("Erè", "Lyen sikilè pa pèmèt.");
        setBusy(false);
        return;
      }
      await db.execAsync("BEGIN");
      try {
        await db.runAsync("UPDATE categories SET name = ?, icon = ?, updated_at = ?, dirty = 1 WHERE id = ?",
          [exName.trim(), exIcon, now, oldId]);
        try {
          await insertOutbox("categories", "update", { id: oldId, store_id: storeId, name: exName.trim(), icon: exIcon, updated_at: now, is_deleted: 0 });
        } catch {}
        if (newId !== oldId) {
          // ID remap: the rename changes the slug, so every reference moves.
          await db.runAsync("UPDATE categories SET id = ? WHERE id = ?", [newId, oldId]);
          await db.runAsync("UPDATE products SET category_id = ? WHERE category_id = ?", [newId, oldId]);
          await db.runAsync("UPDATE product_categories SET category_id = ? WHERE category_id = ?", [newId, oldId]);
          await db.runAsync("UPDATE category_links SET child_id = ? WHERE child_id = ?", [newId, oldId]);
          await db.runAsync("UPDATE category_links SET parent_id = ? WHERE parent_id = ?", [newId, oldId]);
          try {
            await insertOutbox("categories", "update", { id: newId, store_id: storeId, name: exName.trim(), icon: exIcon, updated_at: now, is_deleted: 0 });
          } catch {}
        }
        const oldSet = new Set(editParentIds ?? []);
        const newSet = new Set(finalParents);
        for (const pid of finalParents) {
          if (oldSet.has(pid)) continue;
          await db.runAsync(
            "INSERT OR REPLACE INTO category_links (id, child_id, parent_id, device_id, lamport_clock, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
            [`${newId}__${pid}`, newId, pid, null, 0, now, 0, 1]
          );
          try { await insertOutbox("category_links", "create", { id: `${newId}__${pid}`, child_id: newId, parent_id: pid, updated_at: now, is_deleted: 0 }); } catch {}
        }
        for (const pid of editParentIds ?? []) {
          if (newSet.has(pid)) continue;
          await db.runAsync("UPDATE category_links SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE child_id = ? AND parent_id = ?",
            [now, newId, pid]);
          try { await insertOutbox("category_links", "update", { id: `${newId}__${pid}`, child_id: newId, parent_id: pid, updated_at: now, is_deleted: 1 }); } catch {}
        }
        await db.execAsync("COMMIT");
      } catch (txErr) {
        try { await db.execAsync("ROLLBACK"); } catch {}
        throw txErr;
      }
      onSaved([newId]);
      onClose();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete kategori ajou echwe");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const list = openBlank ? drafts.filter(d => d.collapsed) : drafts;
    if (!list.length) return;
    if (!openBlank) {
      const err = draftError(open, drafts, dbCats);
      if (err) {
        setTouched(true);
        Alert.alert("Enkonplè", err);
        return;
      }
    }
    if (busy) return;
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const taken = new Set(dbCats.map(c => c.id));
      const finalized = list.map(d => {
        if (d.provisionalId) return { ...d, provisionalId: d.provisionalId };
        const pid = uniqueSlug(slugify(d.name.trim()), taken);
        taken.add(pid);
        return { ...d, provisionalId: pid };
      });
      if (hasCycle(finalized)) {
        Alert.alert("Erè", "Lyen sikilè pa pèmèt.");
        setBusy(false);
        return;
      }
      const srows = ((await db.getAllAsync("SELECT MAX(sort_order) AS m FROM categories").catch(() => [])) as any[]) ?? [];
      const baseSort = Number(srows[0]?.m ?? dbCats.length) || 0;
      // All-or-nothing chain: parents first (client-generated ids — no
      // server round-trip needed), then DAG edges, then outbox rows in the
      // same dependency order so the server replays parents before links.
      const catRecs = finalized.map((d, i) => ({
        id: d.provisionalId, store_id: storeId, name: d.name.trim(), icon: d.icon,
        color: "#0f172a", sort_order: baseSort + 1 + i, created_at: now, updated_at: now, is_deleted: 0,
      }));
      const linkRecs = finalized.flatMap(d =>
        d.parentIds.map(pid => ({
          id: `${d.provisionalId}__${pid}`, child_id: d.provisionalId, parent_id: pid,
          device_id: null, lamport_clock: 0, updated_at: now, is_deleted: 0,
        }))
      );
      await db.execAsync("BEGIN");
      try {
        for (const r of catRecs) {
          await db.runAsync(
            "INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [r.id, r.store_id, r.name, r.icon, r.color, r.sort_order, r.created_at, r.updated_at, r.is_deleted, 1]
          );
        }
        for (const r of linkRecs) {
          await db.runAsync(
            "INSERT OR REPLACE INTO category_links (id, child_id, parent_id, device_id, lamport_clock, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
            [r.id, r.child_id, r.parent_id, r.device_id, r.lamport_clock, r.updated_at, r.is_deleted, 1]
          );
        }
        for (const r of catRecs) {
          try { await insertOutbox("categories", "create", r); } catch {}
        }
        for (const r of linkRecs) {
          try { await insertOutbox("category_links", "create", r); } catch {}
        }
        await db.execAsync("COMMIT");
      } catch (txErr) {
        try { await db.execAsync("ROLLBACK"); } catch {}
        throw txErr;
      }
      const ids = finalized.map(d => d.provisionalId);
      onSaved(ids);
      onClose();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye kategori echwe");
    } finally {
      setBusy(false);
    }
  }

  const openTempOptions = useMemo(
    () => temps.map(t => ({ id: t.provisionalId!, name: t.name, icon: t.icon })),
    [temps]
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        {editCategory ? (
          <>
            {/* Edit-existing: like the add-one, minus the add-more chain */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
              <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Modifye Kategori</Text>
              <Pressable onPress={handleSaveExisting} disabled={!exCanSave} accessibilityLabel="Mete ajou" style={{ minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: exCanSave ? 1 : 0.4 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: exCanSave ? "#fff" : "#636366" }}>Mete ajou</Text>
              </Pressable>
            </View>
            <View style={{ height: 1, backgroundColor: "#262626" }} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <CategoryFields
                name={exName}
                icon={exIcon}
                parentIds={exParents}
                onName={v => { setExTouched(true); setExName(v); }}
                onIcon={g => { setExTouched(true); setExIcon(g); }}
                onToggleParent={id => { setExTouched(true); setExParents(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])); }}
                dbCats={exDbCats}
                tempOptions={[]}
                nameError={exError}
                touched={exTouched}
              />
            </ScrollView>
          </>
        ) : editDraft ? (
          <>
            {/* Edit screen for one collapsed temp */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
              <Pressable onPress={() => setEditingKey(null)} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>Modifye Kategori</Text>
              <View style={{ width: topIconBtn.size }} />
            </View>
            <View style={{ height: 1, backgroundColor: "#262626" }} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <CategoryFields
                name={editName}
                icon={editIcon}
                parentIds={editParents}
                onName={v => { setEditTouched(true); setEditName(v); }}
                onIcon={g => { setEditTouched(true); setEditIcon(g); }}
                onToggleParent={id => { setEditTouched(true); setEditParents(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])); }}
                dbCats={dbCats}
                tempOptions={editTempOptions}
                nameError={editError}
                touched={editTouched}
              />
            </ScrollView>
            <View style={{ padding: 16, borderTopWidth: 0.5, borderColor: "#262626", gap: 10 }}>
              <Pressable onPress={commitEdit} disabled={!editValid || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: editValid && !busy ? "#fff" : "#2b2b2b", alignItems: "center", ...shadow.card }}>
                <Text style={{ fontWeight: "800", fontSize: 14, color: editValid && !busy ? "#000" : "#636366" }}>Mete ajou</Text>
              </Pressable>
              <Pressable onPress={() => editDraft && removeDraft(editDraft.key)} style={{ paddingVertical: 12, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(192,57,43,0.5)" }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#e06c5b" }}>Retire kategori</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* Header: X (no bg) | title | Kreye (disabled until valid) */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
              <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Nouvo Kategori</Text>
              <Pressable onPress={handleSave} disabled={!kreyeEnabled} accessibilityLabel="Kreye" style={{ minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: kreyeEnabled ? 1 : 0.4 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: kreyeEnabled ? "#fff" : "#636366" }}>
                  Kreye{drafts.length > 1 ? ` (${drafts.length})` : ""}
                </Text>
              </Pressable>
            </View>
            <View style={{ height: 1, backgroundColor: "#262626" }} />

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Collapsed temps — tap opens the edit screen */}
              {temps.map(t => (
                <Pressable key={t.key} onPress={() => openEdit(t)} style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                    {t.icon ? <Ionicons name={t.icon} size={22} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{t.name}</Text>
                    <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>
                      {t.parentIds.length ? `Anba: ${t.parentIds.map(parentName).join(" • ")}` : "Rasin (pa gen paran)"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                </Pressable>
              ))}

              {/* Open form */}
              <CategoryFields
                name={open.name}
                icon={open.icon}
                parentIds={open.parentIds}
                onName={v => patchOpen({ name: v })}
                onIcon={g => patchOpen({ icon: g })}
                onToggleParent={toggleOpenParent}
                dbCats={dbCats}
                tempOptions={openTempOptions}
                nameError={openError}
                touched={touched}
              />
              {drafts.length > 1 && !openBlank ? (
                <Text style={{ fontSize: 12, color: "#8e8e93", textAlign: "center" }}>Fòm {drafts.length}/{MAX_CHAIN} — Kreye ap sove tout lis la.</Text>
              ) : null}
            </ScrollView>

            {/* Footer — outside the form: chain one more (hidden at cap) */}
            {drafts.length < MAX_CHAIN ? (
              <Pressable onPress={collapseOpen} disabled={!openValid || busy} style={{ alignItems: "center", paddingVertical: 16, borderTopWidth: 0.5, borderColor: "#262626", opacity: openValid && !busy ? 1 : 0.4 }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ ajoute yon lòt kategori ({drafts.length}/{MAX_CHAIN})</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}
