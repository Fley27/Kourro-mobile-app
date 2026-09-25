// Step 1 — Product: abstract entity (name + categories + supplier links).
// No cost, no price on this table. Create mode → onNext(productId);
// manage mode (productId set) → edits in place.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import { categoryDisplayIcon } from "../CatalogShared";
import PickerGrid from "../../components/PickerGrid";
import type { FlowCtx } from "./types";
import { canManageCatalog } from "./types";

export default function ProductStep({
  ctx, productId, onNext, onBack, onDirtyChange, registerNext,
  active: stepActive = true,
}: {
  ctx: FlowCtx;
  productId?: string | null;
  onNext?: (productId: string, itemType: "goods" | "service") => void;
  onBack?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  registerNext?: (fn: (() => void) | null) => void;
  /** Create flow: steps stay mounted; only the visible one owns Kontinye. */
  active?: boolean;
}) {
  const [itemType, setItemType] = useState<"goods" | "service">("goods");
  const [available, setAvailable] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const editing = !!productId;

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        const ss = (((await db.getAllAsync("SELECT id, name FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => [])) ?? []) as any[])
          .map((s: any) => ({ id: String(s.id), name: String(s.name ?? "—") }));
        setSuppliers(ss);
        if (productId) {
          const db2 = await getDb();
          const p = (((await db2.getAllAsync("SELECT * FROM products WHERE id = ?", [productId]).catch(() => [])) ?? []) as any[])[0];
          if (p) {
            setName(String(p.name ?? ""));
            setItemType(p.item_type === "service" ? "service" : "goods");
            setAvailable(p.is_available !== 0 && (p.is_available as any) !== false);
          }
          const pc = (((await db2.getAllAsync("SELECT category_id FROM product_categories WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[])
            .map((r: any) => String(r.category_id));
          setCategoryIds(pc);
          const ps = (((await db2.getAllAsync("SELECT supplier_id FROM product_suppliers WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[])
            .map((r: any) => String(r.supplier_id));
          setSupplierIds(ps);
        }
      } catch {}
    })();
  }, [productId]);

  const dbCats = ctx.categories.filter(c => c.id !== "all");
  useEffect(() => { if (stepActive) registerNext?.(save); });
  // Report dirtiness so the shell can warn before discarding typed progress.
  useEffect(() => {
    onDirtyChange?.(!editing && (name.trim() !== "" || categoryIds.length > 0 || supplierIds.length > 0 || itemType !== "goods"));
  }, [name, categoryIds, supplierIds, itemType, editing]);
  const error = (() => {
    const nm = name.trim();
    if (nm.length < 2) return "Bay non pwodwi a (min 2 lèt).";
    if (!categoryIds.length) return "Chwazi omwen yon kategori.";
    return "";
  })();
  const valid = !error;

  async function save() {
    if (!valid || busy) { setTouched(true); if (error) Alert.alert("Enkonplè", error); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè ka kreye pwodwi."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      // Services carry no suppliers (no stock, no buy price).
      const supIds = itemType === "goods" ? supplierIds : [];
      if (editing && productId) {
        await db.runAsync("UPDATE products SET name = ?, item_type = ?, is_available = ?, updated_at = ?, dirty = 1 WHERE id = ?", [name.trim(), itemType, available ? 1 : 0, now, productId]);
        try { await insertOutbox("products", "update", { id: productId, name: name.trim(), item_type: itemType, is_available: available ? 1 : 0, updated_at: now, is_deleted: 0 }); } catch {}
        const prevCats = (((await db.getAllAsync("SELECT category_id FROM product_categories WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[]).map((r: any) => String(r.category_id));
        for (const cid of categoryIds) {
          if (prevCats.includes(cid)) continue;
          await db.runAsync("INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)", [productId, cid]);
          try { await insertOutbox("product_categories", "create", { product_id: productId, category_id: cid }); } catch {}
        }
        for (const cid of prevCats) {
          if (categoryIds.includes(cid)) continue;
          await db.runAsync("DELETE FROM product_categories WHERE product_id = ? AND category_id = ?", [productId, cid]);
        }
        const prevSup = (((await db.getAllAsync("SELECT supplier_id FROM product_suppliers WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[]).map((r: any) => String(r.supplier_id));
        for (const sid of supIds) {
          if (prevSup.includes(sid)) continue;
          await db.runAsync("INSERT OR REPLACE INTO product_suppliers (id, product_id, supplier_id, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?)",
            [`${productId}__${sid}`, productId, sid, now, now, 0, 1]);
          try { await insertOutbox("product_suppliers", "create", { id: `${productId}__${sid}`, product_id: productId, supplier_id: sid, updated_at: now, is_deleted: 0 }); } catch {}
        }
        for (const sid of prevSup) {
          if (supIds.includes(sid)) continue;
          await db.runAsync("UPDATE product_suppliers SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE product_id = ? AND supplier_id = ?", [now, productId, sid]);
          try { await insertOutbox("product_suppliers", "update", { id: `${productId}__${sid}`, product_id: productId, supplier_id: sid, updated_at: now, is_deleted: 1 }); } catch {}
        }
        ctx.reload();
        onNext?.(productId, itemType);
      } else {
        const id = `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        // Every product mints a unique SKU at creation (SKU-0042 style).
        const takenSkus = new Set((((await db.getAllAsync("SELECT sku FROM products").catch(() => [])) ?? []) as any[])
          .map((r: any) => String(r.sku ?? "")));
        let sku = "";
        for (let i = 0; i < 50 && !sku; i++) {
          const cand = `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
          if (!takenSkus.has(cand)) sku = cand;
        }
        if (!sku) sku = `SKU-${Date.now().toString(36).toUpperCase()}`;
        await db.runAsync(
          "INSERT INTO products (id, store_id, sku, name, category_id, stock_quantity, current_amount_available, low_stock_threshold, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [id, "demo-store-id", sku, name.trim(), categoryIds[0] ?? null, 0, 0, 5, "draft", now]
        );
        await db.runAsync("UPDATE products SET item_type = ?, is_available = ? WHERE id = ?", [itemType, available ? 1 : 0, id]);
        try { await insertOutbox("products", "create", { id, store_id: "demo-store-id", sku, name: name.trim(), item_type: itemType, is_available: available ? 1 : 0, stock_quantity: 0, status: "draft", updated_at: now, is_deleted: 0 }); } catch {}
        for (const cid of categoryIds) {
          await db.runAsync("INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)", [id, cid]);
          try { await insertOutbox("product_categories", "create", { product_id: id, category_id: cid }); } catch {}
        }
        for (const sid of supIds) {
          await db.runAsync("INSERT OR REPLACE INTO product_suppliers (id, product_id, supplier_id, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?)",
            [`${id}__${sid}`, id, sid, now, now, 0, 1]);
          try { await insertOutbox("product_suppliers", "create", { id: `${id}__${sid}`, product_id: id, supplier_id: sid, updated_at: now, is_deleted: 0 }); } catch {}
        }
        ctx.reload();
        onNext?.(id, itemType);
      }
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Sove pwodwi echwe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, overflow: "hidden" }}>
        <Pressable onPress={() => setTypeOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 60, paddingHorizontal: 12 }}>
          <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: "#fff" }}>Kalite pwodwi *</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>{itemType === "goods" ? "Machandiz" : "Sèvis"}</Text>
          <Ionicons name={typeOpen ? "chevron-up" : "chevron-down"} size={16} color="#8e8e93" />
        </Pressable>
        {typeOpen && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
            {(["goods", "service"] as const).map(t => {
              const active = itemType === t;
              return (
                <Pressable key={t} onPress={() => { setTouched(true); setItemType(t); if (t === "service") setSupplierIds([]); setTypeOpen(false); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", backgroundColor: active ? "#fff" : "transparent" }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: active ? "#000" : "#fff" }}>{t === "goods" ? "Machandiz" : "Sèvis"}</Text>
                  <Text style={{ fontSize: 11, color: active ? "#000" : "#8e8e93" }}>{t === "goods" ? "Kantite swivi" : "Pa gen stòk"}</Text>
                  {active && <Ionicons name="checkmark" size={16} color="#000" style={{ marginLeft: "auto" }} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {itemType === "service" && (
        <Pressable onPress={() => { setTouched(true); setAvailable(v => !v); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: available ? "rgba(47,125,91,0.12)" : "rgba(255,159,10,0.16)", borderWidth: 1, borderColor: available ? "rgba(47,125,91,0.3)" : "#3a3a3c", borderRadius: 12, padding: 12 }}>
          <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: available ? "#2f7d5b" : "#8e8e93", justifyContent: "center", paddingHorizontal: 2, alignItems: available ? "flex-end" : "flex-start" }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 13, color: available ? "#4cae7f" : "#d99a2b" }}>{available ? "Disponib" : "Koupe"}</Text>
            <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 1 }}>{available ? "Parèt nan vant kounye a" : "Kache nan vant (86)"}</Text>
          </View>
        </Pressable>
      )}
      <View>
        <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Non pwodwi *</Text>
        <TextInput value={name} onChangeText={v => { setTouched(true); setName(v); }} placeholder="Eg. Corona, Diri Madan Gougous" placeholderTextColor="#636366"
          style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
        {touched && error && !name.trim() ? <Text style={{ fontSize: 12, color: "#e06c5b", marginTop: 6 }}>{error}</Text> : null}
      </View>
      <PickerGrid
        title={`KATEGORI * (${categoryIds.length})`}
        searchPlaceholder="Chèche kategori…"
        tiles={dbCats.map(c => ({ id: c.id, label: c.name, glyph: categoryDisplayIcon(c), char: c.icon }))}
        selectedIds={categoryIds}
        onToggle={id => { setTouched(true); setCategoryIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])); }}
      />
      {itemType === "goods" && (
        suppliers.length ? (
          <PickerGrid
            title={`FOUNISÈ (opsyonèl${supplierIds.length ? ` • ${supplierIds.length}` : ""})`}
            searchPlaceholder="Chèche founisè…"
            tiles={suppliers.map(s => ({ id: s.id, label: s.name }))}
            selectedIds={supplierIds}
            onToggle={id => setSupplierIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))}
          />
        ) : (
          <Text style={{ fontSize: 12, color: "#8e8e93" }}>Pa gen founisè — kreye youn nan Founisè.</Text>
        )
      )}
      {!registerNext && (
      <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
        {onBack ? (
          <Pressable onPress={onBack} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center" }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Retounen</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={save} disabled={!valid || busy} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: valid && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: valid && !busy ? "#000" : "#636366" }}>{editing ? "Mete ajou" : "Kontinye"}</Text>
        </Pressable>
      </View>
      )}
    </ScrollView>
  );
}
