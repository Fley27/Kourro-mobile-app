// Step 5 — Variant prices: effective-dated rows (price + date, default
// today). Current = latest date ≤ now, same-date tie → latest created.
// Prices are never overwritten: a change is a new row (history preserved).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { getDb, insertOutbox } from "../../db";
import { fmtG } from "../../format";
import type { Item, Variant, VariantPrice } from "../../catalogModel";
import { currentVariantPrice, itemFactor, minItemFactor, toCanonicalQty } from "../../catalogModel";
import { formatCheckoutRow } from "../../labels";
import type { FlowCtx } from "./types";
import { canManageCatalog, uniqueId } from "./types";
import { uploadError } from "../../components/UploadTransition";
import { MoneyInput } from "../../components/maskedInput";

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
  useEffect(() => { if (stepActive) registerNext?.(finish); });

  // Transport is cost basis: spread across this product's pending batches
  // (by weight) before finishing. Blank/0 = skip.
  async function finish() {
    const t = parseFloat(transport) || 0;
    if (t < 0) { Alert.alert("Enkonplè", "Transpò pa ka negatif."); return; }
    if (t > 0) {
      if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
      try {
        const db = await getDb();
        const ids = new Set(items.filter(i => !i.is_deleted).map(i => i.id));
        const pend = (((await db.getAllAsync("SELECT * FROM batches").catch(() => [])) ?? []) as any[])
          .filter((b: any) => !b.is_deleted && String(b.status) === "pending" && ids.has(String(b.item_id)));
        if (!pend.length) {
          Alert.alert("Pa gen batch", "Transpò a pa gen okenn batch pending pou resevwa l — mete l 0 oswa tounen etap Batch.");
          return;
        }
        const now = new Date().toISOString();
        const total = pend.reduce((s: number, b: any) => s + (Number(b.total_paid) || 0), 0);
        for (const b of pend) {
          const shr = Math.round((total > 0 ? t * ((Number(b.total_paid) || 0) / total) : t / pend.length) * 100) / 100;
          await db.runAsync("UPDATE batches SET total_paid = total_paid + ?, transport_share = transport_share + ?, updated_at = ?, dirty = 1 WHERE id = ?",
            [shr, shr, now, String(b.id)]);
          try { await insertOutbox("batches", "update", { id: String(b.id), transport_share_added: shr, updated_at: now, is_deleted: false }); } catch {}
        }
        await load();
        ctx.reload();
      } catch (e: any) {
        uploadError("Erè", e?.message ?? "Aplike transpò echwe");
        return;
      }
    }
    onDone?.();
  }
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [prices, setPrices] = useState<VariantPrice[]>([]);
  const [transport, setTransport] = useState("");
  const [busy, setBusy] = useState(false);
  const [prodBatches, setProdBatches] = useState<any[]>([]);
  // Bulk edit: typed values per variant. Untouched rows display the live
  // price as a required placeholder — focus blanks it, blur restores it.
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function load() {
    try {
      if (!productId) return;
      const db = await getDb();
      const [its, vs, ps, bs] = await Promise.all([
        db.getAllAsync("SELECT * FROM items WHERE product_id = ?", [productId]).catch(() => []),
        db.getAllAsync("SELECT * FROM variants").catch(() => []),
        db.getAllAsync("SELECT * FROM variant_prices").catch(() => []),
        db.getAllAsync("SELECT * FROM batches").catch(() => []),
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
      setProdBatches((((bs ?? []) as any[]).filter((b: any) => !b.is_deleted && ids.has(String(b.item_id)))) as any[]);

    } catch {}
  }
  // Steps stay mounted: refresh on every visit so rows saved by earlier
  // steps (same productId) are always visible.
  useEffect(() => { if (stepActive) load(); }, [productId, stepActive]);

  const curPriceOf = (vid: string): number => {
    const cur = currentVariantPrice(prices, vid);
    return cur ? Number(cur.price) || 0 : 0;
  };
  const shownOf = (vid: string): string => {
    if (vid in edits) return edits[vid];
    const c = curPriceOf(vid);
    return c > 0 ? String(c) : "";
  };
  // Changed rows only: valid new price, different from live.
  const changed = variants.filter(v => {
    if (!(v.id in edits)) return false;
    const t = parseFloat(edits[v.id]);
    return t > 0 && t !== curPriceOf(v.id);
  });

  // Reference unit cost per variant (ember, display only): one known batch
  // prices the whole chain — canonical smallest-unit cost × each item's
  // ratio (10 boxes → G 1000 ⇒ G 100/box, bottle = 100/24). Pending pool
  // first (transport folded by weight), else latest received. No data → 0.
  const transportVal = parseFloat(transport) || 0;
  function unitRefOf(v: Variant): number {
    const live = items.filter(i => !i.is_deleted);
    const per = (id: string) => {
      const f = itemFactor(live, id);
      const m = minItemFactor(live, productId);
      return f > 0 && m > 0 ? f / m : 0;
    };
    const perUnit = per(String(v.item_id));
    if (!(perUnit > 0)) return 0;
    const byRecency = (a: any, b: any) =>
      String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    const canonOf = (b: any, share: number): number => {
      const c = toCanonicalQty(live, productId, String(b.item_id), Number(b.quantity));
      if (!(c > 0)) return 0;
      return ((Number(b.total_paid) || 0) + share) / c;
    };
    const pend = prodBatches
      .filter((b: any) => String(b.status) === "pending" && Number(b.quantity) > 0)
      .sort(byRecency);
    if (pend.length) {
      const totalAll = pend.reduce((s: number, b: any) => s + (Number(b.total_paid) || 0), 0);
      const latest = pend[0];
      const share = totalAll > 0
        ? transportVal * ((Number(latest.total_paid) || 0) / totalAll)
        : (transportVal > 0 && pend.length > 0 ? transportVal / pend.length : 0);
      const canon = canonOf(latest, share);
      return canon > 0 ? canon * perUnit : 0;
    }
    const recv = prodBatches
      .filter((b: any) => String(b.status) === "received" && Number(b.quantity) > 0)
      .sort(byRecency)[0];
    if (recv) {
      const canon = canonOf(recv, 0);
      return canon > 0 ? canon * perUnit : 0;
    }
    return 0;
  }

  async function savePrices() {
    if (!changed.length || busy) return;
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const dateStr = todayStr();
      const taken = new Set(prices.map(p => p.id));
      for (const v of changed) {
        const val = parseFloat(edits[v.id]);
        const id = uniqueId("vpr", taken, `${v.id}-${dateStr}`);
        const rec = { id, variant_id: v.id, price: val, date: dateStr, created_at: now, updated_at: now, is_deleted: 0 };
        await db.runAsync(
          "INSERT OR REPLACE INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
          [rec.id, rec.variant_id, rec.price, rec.date, rec.created_at, rec.updated_at, 0, 1]
        );
        try { await insertOutbox("variant_prices", "create", { ...rec, is_deleted: false }); } catch {}
      }
      setEdits({});
      await load();
      ctx.reload();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Anrejistre pri echwe");
    } finally {
      setBusy(false);
    }
  }

  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? "?";

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {productName ? <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }} numberOfLines={1}>{productName}</Text> : null}
      {registerNext && (
        <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 6 }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: "#fff" }}>Transpò (opsyonèl)</Text>
          <MoneyInput value={transport} onChangeText={v => setTransport(v)} placeholder="0" placeholderTextColor="#636366" keyboardType="numeric"
            style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
          <Text style={{ fontSize: 11, color: "#8e8e93" }}>Reparti sou batch pending yo (pri revand) anvan Anrejistre.</Text>
        </View>
      )}
      <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 10 }}>
        {variants.map(v => (
          <View key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: "#fff" }} numberOfLines={1}>{formatCheckoutRow(itemName(v.item_id), productName, v.name)}</Text>
              {(() => {
                const ref = unitRefOf(v);
                return (
                  <Text style={{ fontSize: 11, color: "#ff4d00", marginTop: 2 }} numberOfLines={1}>
                    ≈ {ref > 0 ? fmtG(Math.round(ref * 100) / 100) : "—"} / {itemName(v.item_id)} · pri acha
                  </Text>
                );
              })()}
            </View>
            <MoneyInput
              value={shownOf(v.id)}
              onFocus={() => { if (!(v.id in edits)) setEdits(prev => ({ ...prev, [v.id]: "" })); }}
              onBlur={() => { if ((edits[v.id] ?? "") === "") setEdits(prev => { const n = { ...prev }; delete n[v.id]; return n; }); }}
              onChangeText={val => setEdits(prev => ({ ...prev, [v.id]: val }))}
              keyboardType="numeric"
              placeholder="—"
              placeholderTextColor="#636366"
              style={{ width: 110, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10, textAlign: "center", fontWeight: "800", fontSize: 14, color: "#fff", backgroundColor: "transparent" }}
            />
          </View>
        ))}
        {variants.length === 0 && (
          <Text style={{ fontSize: 12, color: "#8e8e93", textAlign: "center" }}>Poko gen variant — tounen etap 4.</Text>
        )}
      </View>
      {canManageCatalog(ctx.role) ? (
        <Pressable onPress={savePrices} disabled={!changed.length || busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: changed.length && !busy ? "#fff" : "#2b2b2b", alignItems: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: changed.length && !busy ? "#000" : "#636366" }}>
            Anrejistre pri{changed.length > 0 ? ` (${changed.length})` : ""}
          </Text>
        </Pressable>
      ) : null}

    </ScrollView>
  );
}
