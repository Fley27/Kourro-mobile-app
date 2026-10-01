import React, { useEffect, useState } from "react";
import { radius } from "../theme";
import { View, Text, Pressable, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../db";
import type { Role } from "../users";
import { fmtG, fmt } from "../format";
import { useResponsive, sheetBox } from "../responsive";
import { loadPricing, type PricingMaps } from "../pricing";
import {
  loadCatalogModel, currentBaseCost, receiveV2Batch,
  type Batch, type Item, type Variant,
} from "../catalogModel";
import BatchWizard, { type WizardSaved } from "./inventory/BatchWizard";
import { normName } from "./CatalogShared";
import { inv, fs } from "./inventory/inventoryTheme";
import {
  listBatchDrafts, deleteBatchDraft, purgeExpiredBatchDrafts,
  type BatchDraftSummary,
} from "../inventory/batchDraft";
import { uploadError } from "../components/UploadTransition";
import { MoneyInput } from "../components/maskedInput";

type Category = { id: string; name: string; icon: string; color: string };
type Product = { id: string; name: string; sku?: string; barcode?: string; category_id?: string; stock_quantity: number; low_stock_threshold: number; cost_price: number; selling_price?: number; unit?: string };

// One system: Inventory deliveries ARE catalog v2 batches (item + supplier +
// date + qty + total). Nouvo livrezon opens the 4-step BatchWizard (supplier →
// items → prices → bundles), Ap vini receives them, Istwa shows received/
// denied. Brouyon lists device-local wizard drafts. Legacy stock_batches/
// movements are migrated once at startup (migrateInventoryBatches) and never
// read here.

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];
/** "2025-07-14" → "14 jiyè 2025". */
function fmtDateHt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const mi = Math.min(12, Math.max(1, parseInt(m[2], 10)));
  return `${parseInt(m[3], 10)} ${HT_MONTHS[mi - 1]} ${m[1]}`;
}

/** Draft age in warm words: kounye a / jodi a / yer / N jou de sa. */
function relTime(iso: string): string {
  const t = Date.parse(String(iso ?? ""));
  if (!isFinite(t)) return "";
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "kounye a";
  if (diff < day) return "jodi a";
  if (diff < 2 * day) return "yer";
  if (diff < 7 * day) return `${Math.floor(diff / day)} jou de sa`;
  return fmtDateHt(String(iso).slice(0, 10));
}

type DeliverLine = { batch: Batch; productId: string; productName: string; itemName: string };
type DeliverGroup = {
  key: string; ref: string; supplierId: string; supplierName: string;
  date: string; status: string; lines: DeliverLine[]; latest: number;
  transport: number;
  hasPending: boolean; hasReceived: boolean; hasDenied: boolean;
};

export default function InventoryScreen({ role = "cashier", currentUser, onClose, onSaved }: { role?: Role; currentUser?: any; onClose: () => void; onSaved?: () => void }) {
  const { width, isTablet, padH } = useResponsive();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCategories, setProductCategories] = useState<{ product_id: string; category_id: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [batchItems, setBatchItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });
  const [costByProduct, setCostByProduct] = useState<Map<string, number>>(new Map());

  const canInventory = role === "owner" || role === "admin" || role === "manager";
  // Receiving + cost visibility (Inventory matrix): managers see batch totals
  // and transport but never per-item cost; cashiers see items + quantities +
  // total cost only; associate/cook/server have no access.
  const canReceive = role === "owner" || role === "admin" || role === "manager" || role === "cashier";
  const canViewItemCost = role === "owner" || role === "admin";
  const canViewBatchMeta = role === "owner" || role === "admin" || role === "manager";
  // Main screen is the delivery list: one status tag at a time. The Nouvo
  // livrezon creation flow opens behind the + button (creating).
  const [statusTag, setStatusTag] = useState<"pending" | "received" | "denied" | "draft">("pending");
  const [creating, setCreating] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<BatchDraftSummary[]>([]);
  const [invProductSearch, setInvProductSearch] = useState("");
  // Batch detail (Verifye): key into allGroups so actions refresh live.
  const [deliverKey, setDeliverKey] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  // Per-line edit/refuse sheet. Note is stored on the line (reason column).
  const [lineModal, setLineModal] = useState<{ line: DeliverLine; mode: "edit" | "deny" } | null>(null);
  const [eQty, setEQty] = useState("");
  const [eTotal, setETotal] = useState("");
  const [eNote, setENote] = useState("");
  const [eReason, setEReason] = useState("");
  const wizardCloseRef = React.useRef<(() => void) | null>(null);
  // Line actions (receive / edit / refuse) are admin + owner only.
  const canAdminOwner = role === "owner" || role === "admin";

  async function load() {
    const db = await getDb();
    try {
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE (is_deleted=0 OR is_deleted IS NULL) AND (status IS NULL OR status = 'active')")) as Product[];
      setProducts(rows);
      const pc = (await db.getAllAsync("SELECT * FROM product_categories")) as any[];
      setProductCategories(pc);
      const cats = (await db.getAllAsync("SELECT * FROM categories")) as any[];
      setCategories(cats);
      try {
        setPricing(await loadPricing(db));
      } catch (e) { console.log("[Inventory pricing] failed:", e); }
      try {
        const ss = (((await db.getAllAsync("SELECT id, name FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => [])) ?? []) as any[])
          .map((s: any) => ({ id: String(s.id), name: String(s.name ?? "—") }));
        setSuppliers(ss);
      } catch { setSuppliers([]); }
      try {
        const model = await loadCatalogModel(db);
        setBatchItems((model.items ?? []).filter((i: any) => !i.is_deleted));
        setVariants(((model.variants ?? []) as Variant[]).filter(v => !v.is_deleted));
        setBatches(((model.batches ?? []) as Batch[]).filter(b => !b.is_deleted));
        const map = new Map<string, number>();
        for (const p of rows) map.set(p.id, currentBaseCost(model.items, model.batches, p.id));
        setCostByProduct(map);
      } catch {
        setBatchItems([]);
        setVariants([]);
        setBatches([]);
        setCostByProduct(new Map());
      }
      try {
        await purgeExpiredBatchDrafts(db);
        setDrafts(await listBatchDrafts(db));
      } catch { setDrafts([]); }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  const supName = (id: string) => suppliers.find(s => s.id === id)?.name ?? "?";

  function getProductCats(productId: string): string[] {
    const linked = productCategories.filter(pc => pc.product_id === productId).map(pc => pc.category_id);
    if (linked.length) return linked;
    const prod = products.find(p => p.id === productId);
    if (prod?.category_id) return [prod.category_id];
    return [];
  }
  function getProductCategoriesDisplay(productId: string): Category[] {
    const ids = getProductCats(productId);
    return ids.map(id => categories.find(c => c.id === id)).filter(Boolean) as Category[];
  }

  // Group v2 batches into deliveries (delivery_ref, else supplier × date).
  // Lines keep their own status: a delivery stays Ap vini while ANY line is
  // pending; Rive = no pending + ≥1 received; Refize = all refused.
  function groupBatches(rule: "all" | "pending" | "received" | "denied", qq: string): DeliverGroup[] {
    const map = new Map<string, DeliverGroup>();
    for (const b of batches) {
      const st = String(b.status ?? "pending");
      const it = batchItems.find(i => i.id === String(b.item_id));
      if (!it) continue;
      const prod = products.find(p => p.id === String(it.product_id));
      // Only batches of live (active) products ever list — drafts, deleted,
      // and orphans are excluded so they can never be received as real stock.
      if (!prod) continue;
      const ref = String((b as any).delivery_ref ?? "");
      // Ref-less rows never merge: each stands alone under its own id, so a
      // detail can only ever show lines of its own delivery — no past lines,
      // no other batches. A ref never mixes suppliers either: one wizard run
      // can split lines across suppliers, and each supplier gets its own card
      // (own total, own Verifye) instead of hiding under the first supplier.
      const sup = String(b.supplier_id ?? "");
      const key = ref ? `${ref}|${sup}` : `solo:${String(b.id)}`;
      let g = map.get(key);
      if (!g) {
        g = { key, ref, supplierId: String(b.supplier_id), supplierName: supName(String(b.supplier_id)), date: String(b.date ?? ""), status: "pending", lines: [], latest: 0, transport: 0, hasPending: false, hasReceived: false, hasDenied: false };
        map.set(key, g);
      }
      if (st === "pending") g.hasPending = true;
      else if (st === "received") g.hasReceived = true;
      else if (st === "denied") g.hasDenied = true;
      const ts = Date.parse(String((b as any).created_at ?? "")) || 0;
      if (ts > g.latest) g.latest = ts;
      g.transport += Number((b as any).transport_share) || 0;
      g.lines.push({
        batch: b, productId: String(it.product_id),
        productName: prod.name, itemName: it.name,
      });
    }
    // Header search filters deliveries by ref, supplier, date, product/unit.
    let out = [...map.values()].map(g => ({
      ...g,
      status: g.hasPending ? "pending" : g.hasReceived ? "received" : "denied",
    }));
    if (rule === "pending") out = out.filter(g => g.hasPending);
    else if (rule === "received") out = out.filter(g => !g.hasPending && g.hasReceived);
    else if (rule === "denied") out = out.filter(g => !g.hasPending && !g.hasReceived);
    const nq = normName(qq);
    if (nq) {
      out = out.filter(g =>
        normName(g.ref).includes(nq) ||
        normName(g.supplierName).includes(nq) ||
        g.date.includes(nq) ||
        g.lines.some(l => normName(l.productName).includes(nq) || normName(l.itemName).includes(nq))
      );
    }
    // Most recent first (creation time, then batch date as tiebreak).
    out.sort((a, b) => (b.latest - a.latest) || String(b.date ?? "").localeCompare(String(a.date ?? "")));
    for (const g of out) g.lines.sort((a, b) => a.productName.localeCompare(b.productName));
    return out;
  }
  const deliveryQuery = invProductSearch.trim().toLowerCase();
  const shownGroups = React.useMemo(
    () => (statusTag === "draft" ? [] : groupBatches(statusTag, deliveryQuery)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, batchItems, products, suppliers, statusTag, deliveryQuery]
  );
  const statusCounts = React.useMemo(() => ({
    pending: groupBatches("pending", "").length,
    received: groupBatches("received", "").length,
    denied: groupBatches("denied", "").length,
    draft: drafts.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [batches, batchItems, products, suppliers, drafts]);
  const allGroups = React.useMemo(
    () => groupBatches("all", ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, batchItems, products, suppliers]
  );
  const activeGroup = deliverKey ? allGroups.find(g => g.key === deliverKey) ?? null : null;

  // --- wizard lifecycle ----------------------------------------------------
  function openWizard(draftId: string | null = null) {
    if (!canInventory) return Alert.alert("Pa gen dwa", "Se sèlman Owner/Admin/Manager ka fè antre stòk");
    setResumeDraftId(draftId);
    setCreating(true);
  }
  function closeWizard() {
    setCreating(false);
    setResumeDraftId(null);
    load();
  }
  async function handleWizardSaved(info: WizardSaved) {
    // Stay on Inventory: land on the deliveries list (pending) with a cleared
    // search so the run just saved is visible right away.
    setCreating(false);
    setResumeDraftId(null);
    setStatusTag("pending");
    setInvProductSearch("");
    await load();
    onSaved?.();
    if (!info.batchIds.length) onClose?.();
  }

  async function confirmDeleteDraft(d: BatchDraftSummary) {
    Alert.alert("Efface brouyon?", `${d.itemCount} atik · etap ${d.step}/4`, [
      { text: "Anile", style: "cancel" },
      {
        text: "Efface", style: "destructive",
        onPress: async () => {
          try {
            const db = await getDb();
            await deleteBatchDraft(db, d.id);
            setDrafts(await listBatchDrafts(db));
          } catch {}
        },
      },
    ]);
  }

  // Per-line receive: stock lands immediately for that product only.
  // The delivery stays Ap vini until its last line is received or refused.
  async function handleReceiveLine(l: DeliverLine) {
    if (!canAdminOwner) return Alert.alert("Pa gen dwa", "Sèlman Owner/Admin ka resevwa.");
    if (detailBusy) return Alert.alert("Ap travay", "Yon aksyon ap trete — tann li fini anvan ou peze ankò.");
    setDetailBusy(true);
    try {
      const db = await getDb();
      await receiveV2Batch(db, {
        batchId: l.batch.id, productId: l.productId, itemId: String(l.batch.item_id),
        quantity: Number(l.batch.quantity), receivedBy: currentUser?.id ?? "system",
      });
      await load();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Resevwa echwe");
    } finally {
      setDetailBusy(false);
    }
  }

  function openLineEdit(l: DeliverLine) {
    if (!canAdminOwner) return Alert.alert("Pa gen dwa", "Sèlman Owner/Admin ka modifye.");
    setEQty(String(Number(l.batch.quantity) || ""));
    setETotal(String(Number(l.batch.total_paid) || ""));
    setENote(String((l.batch as any).reason ?? ""));
    setLineModal({ line: l, mode: "edit" });
  }

  function openLineDeny(l: DeliverLine) {
    if (!canAdminOwner) return Alert.alert("Pa gen dwa", "Sèlman Owner/Admin ka refize.");
    setEReason("");
    setLineModal({ line: l, mode: "deny" });
  }

  async function saveLineEdit() {
    const m = lineModal;
    if (!m) return;
    if (detailBusy) return Alert.alert("Ap travay", "Yon aksyon ap trete — tann li fini anvan ou peze ankò.");
    const qty = parseFloat(eQty) || 0;
    const total = parseFloat(eTotal);
    if (!(qty > 0)) { Alert.alert("Enkonplè", "Kantite a dwe > 0."); return; }
    if (isNaN(total) || total < 0) { Alert.alert("Enkonplè", "Total la pa valab."); return; }
    setDetailBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const note = eNote.trim();
      await db.runAsync("UPDATE batches SET quantity = ?, total_paid = ?, reason = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        [qty, total, note || null, now, String(m.line.batch.id)]);
      try {
        const { insertOutbox } = await import("../db");
        await insertOutbox("batches", "update", { id: String(m.line.batch.id), quantity: qty, total_paid: total, reason: note || null, updated_at: now, is_deleted: false });
      } catch {}
      setLineModal(null);
      await load();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Modifye echwe");
    } finally {
      setDetailBusy(false);
    }
  }

  async function confirmLineDeny() {
    const m = lineModal;
    if (!m) return;
    if (detailBusy) return Alert.alert("Ap travay", "Yon aksyon ap trete — tann li fini anvan ou peze ankò.");
    if (!eReason.trim()) { Alert.alert("Rezon obligatwa", "Bay rezon refi a."); return; }
    setDetailBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const by = currentUser?.id ?? "system";
      await db.runAsync("UPDATE batches SET status = ?, denied_by = ?, denied_at = ?, reason = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        ["denied", by, now, eReason.trim(), now, String(m.line.batch.id)]);
      try {
        const { insertOutbox } = await import("../db");
        await insertOutbox("batches", "update", { id: String(m.line.batch.id), status: "denied", denied_by: by, denied_at: now, reason: eReason.trim(), updated_at: now, is_deleted: false });
      } catch {}
      setLineModal(null);
      await load();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Refi echwe");
    } finally {
      setDetailBusy(false);
    }
  }

  function emptyState(icon: keyof typeof Ionicons.glyphMap, title: string, sub: string) {
    return (
      <View style={{ backgroundColor: inv.card, borderWidth: 0.5, borderColor: inv.border, borderRadius: 20, padding: 28, alignItems: "center", gap: 8 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={26} color={inv.sub} />
        </View>
        <Text style={{ fontWeight: "800", fontSize: fs(14), color: inv.text, marginTop: 4 }}>{title}</Text>
        <Text style={{ fontSize: fs(12), color: inv.sub, textAlign: "center", lineHeight: 17 }}>{sub}</Text>
      </View>
    );
  }

  // Warm delivery-card language: paper text on warm charcoal, blue AP VINI
  // pill, gold total, orange Rive button.
  const paper = "#f6f1e4";
  const paperSub = "#a89f88";
  const cardBg = "#211d14";
  const cardBd = "rgba(246,241,228,0.12)";
  const cardDiv = "rgba(246,241,228,0.08)";
  const pillBlue = "#4da3e0";
  const pillBlueBg = "rgba(77,163,224,0.16)";
  const pillBlueBd = "rgba(77,163,224,0.35)";
  const gold = "#e0a83c";
  const orange = "#dd8a3e";

  function statusPill(status: string) {
    if (status === "received") {
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: inv.greenBg, borderWidth: 1, borderColor: inv.greenBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="checkmark" size={9} color={inv.green} />
          <Text style={{ fontSize: fs(10), fontWeight: "800", color: inv.green, letterSpacing: 0.3 }}>RIVE</Text>
        </View>
      );
    }
    if (status === "denied") {
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="close" size={9} color={inv.red} />
          <Text style={{ fontSize: fs(10), fontWeight: "800", color: inv.red, letterSpacing: 0.3 }}>REFIZE</Text>
        </View>
      );
    }
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: pillBlueBg, borderWidth: 1, borderColor: pillBlueBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
        <Text style={{ fontSize: fs(10), fontWeight: "800", color: pillBlue, letterSpacing: 0.3 }}>AP VINI</Text>
      </View>
    );
  }

  function renderGroupCard(g: DeliverGroup, opts: { receive: boolean }) {
    const groupTotal = g.lines.reduce((s, l) => s + (Number(l.batch.total_paid) || 0), 0);
    const isPending = g.status === "pending";
    const shown = g.lines.slice(0, 3);
    const rest = g.lines.length - shown.length;
    // Ref-less groups (pre-ref batches): title falls back to supplier so
    // the date never prints twice.
    const title = g.ref || g.supplierName;
    return (
      <View key={g.key} style={{ backgroundColor: cardBg, borderRadius: 20, borderWidth: 1, borderColor: cardBd, overflow: "hidden" }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "800", fontSize: fs(17), color: paper, letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>{title}</Text>
            {statusPill(g.status)}
            <View style={{ alignItems: "flex-end", marginLeft: 4 }}>
              <Text style={{ fontSize: fs(12), color: paperSub }}>{fmtDateHt(g.date)}</Text>
              <Text style={{ fontSize: fs(12), color: paperSub, marginTop: 1 }}>{g.lines.length} pwodui</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Ionicons name="storefront-outline" size={14} color={paperSub} />
            <Text style={{ fontSize: fs(14), color: paper, flex: 1 }} numberOfLines={1}>{g.ref ? g.supplierName : fmtDateHt(g.date)}</Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: cardDiv }} />
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 9 }}>
          {shown.map(l => (
            <View key={l.batch.id}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ fontSize: fs(15), color: paper, flex: 1 }} numberOfLines={1}>{l.productName}</Text>
                <Text style={{ fontSize: fs(16), fontWeight: "800", color: paper }}>{fmt(Number(l.batch.quantity) || 0)} <Text style={{ fontSize: fs(14), fontWeight: "400", color: paperSub }}>{l.itemName}</Text></Text>
              </View>
              {l.batch.reason ? <Text style={{ fontSize: fs(11), color: paperSub, marginTop: 2 }}>Rezon: {l.batch.reason}</Text> : null}
            </View>
          ))}
          {rest > 0 && <Text style={{ fontSize: fs(13), color: paperSub }}>+ {rest} lòt...</Text>}
        </View>
        <View style={{ height: 1, backgroundColor: cardDiv }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
          {canViewBatchMeta && (
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs(11), color: paperSub }}>Transpò</Text>
                <Text style={{ fontSize: fs(17), fontWeight: "800", color: paper, marginTop: 2 }}>{fmt(Math.round(g.transport))} <Text style={{ fontSize: fs(12), fontWeight: "400", color: paperSub }}>HTG</Text></Text>
              </View>
              <View style={{ width: 1, alignSelf: "stretch", backgroundColor: cardDiv }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fs(11), color: paperSub }}>Total</Text>
                <Text style={{ fontSize: fs(17), fontWeight: "800", color: gold, marginTop: 2 }}>{fmt(Math.round(groupTotal))} <Text style={{ fontSize: fs(12), fontWeight: "400", color: paperSub }}>HTG</Text></Text>
              </View>
            </>
          )}
          {opts.receive && canReceive ? (
            <Pressable onPress={() => setDeliverKey(g.key)} style={{ flex: canViewBatchMeta ? 1.2 : 1, backgroundColor: orange, paddingVertical: 13, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 }}>
              <Ionicons name="eye-outline" size={17} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Verifye</Text>
            </Pressable>
          ) : null}
          {g.status === "received" && !canViewBatchMeta ? (
            <View style={{ flex: 1, backgroundColor: inv.greenBg, borderRadius: 14, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: inv.greenBd }}>
              <Ionicons name="checkmark-circle" size={15} color={inv.green} />
              <Text style={{ color: inv.green, fontWeight: "700", fontSize: fs(13) }}>Nan stòk</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  function renderDraftCard(d: BatchDraftSummary) {
    return (
      <View key={d.id} style={{ backgroundColor: cardBg, borderRadius: 20, borderWidth: 1, borderColor: "rgba(224,168,60,0.35)", overflow: "hidden" }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontWeight: "800", fontSize: fs(16), color: paper, letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
              {d.supplierId ? supName(d.supplierId) : "Founisè pa chwazi"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: inv.amberBg, borderWidth: 1, borderColor: inv.amberBd, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
              <Ionicons name="document-text-outline" size={9} color={inv.amber} />
              <Text style={{ fontSize: fs(10), fontWeight: "800", color: inv.amber, letterSpacing: 0.3 }}>BROUYON</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Ionicons name="layers-outline" size={14} color={paperSub} />
            <Text style={{ fontSize: fs(13), color: paper, flex: 1 }}>{d.itemCount} atik · etap {d.step}/4</Text>
            <Text style={{ fontSize: fs(12), color: paperSub }}>{relTime(d.updatedAt)}</Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: cardDiv }} />
        <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
          <Pressable
            onPress={() => { if (canInventory) openWizard(d.id); }}
            style={{ flex: 1, backgroundColor: orange, paddingVertical: 13, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7 }}
          >
            <Ionicons name="play-outline" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: fs(14) }}>Kontinye</Text>
          </Pressable>
          <Pressable
            onPress={() => confirmDeleteDraft(d)}
            style={{ width: 50, backgroundColor: inv.redBg, borderWidth: 1, borderColor: inv.redBd, borderRadius: 14, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="trash-outline" size={17} color={inv.red} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (!canReceive) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: inv.tile, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed-outline" size={24} color={inv.sub} />
        </View>
        <Text style={{ fontWeight: "800", fontSize: fs(15), color: inv.text, marginTop: 12 }}>Pa gen aksè</Text>
        <Text style={{ fontSize: fs(12), color: inv.sub, marginTop: 4, textAlign: "center" }}>Envantè rezève pou jesyon magazen.</Text>
      </View>
    );
  }

  const tags = [
    { k: "pending" as const, label: "Ap vini", count: statusCounts.pending },
    { k: "received" as const, label: "Rive", count: statusCounts.received },
    { k: "denied" as const, label: "Refize", count: statusCounts.denied },
    { k: "draft" as const, label: "Brouyon", count: statusCounts.draft },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", flex: 1 }}>
      {/* Title + add (Customers header language). Hidden while the wizard runs
          so the add-inventory flow owns the full screen height — its own
          header carries the close button, on the left. */}
      {!creating && (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: padH, paddingTop: 18, paddingBottom: 14 }}>
        <Text style={{ color: "#fff", fontSize: fs(28), fontWeight: "800", letterSpacing: -0.5 }}>Envantè</Text>
        <Pressable
          onPress={() => { if (canInventory) openWizard(); }}
          disabled={!canInventory}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center", opacity: canInventory ? 1 : 0.4 }}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      </View>
      )}

      {/* Search pill (filters deliveries on the main list) */}
      {!creating && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: padH, marginBottom: 8 }}>
          <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
            <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
            <TextInput
              value={invProductSearch}
              onChangeText={setInvProductSearch}
              placeholder="Chèche"
              placeholderTextColor="#8e8e93"
              style={{ flex: 1, fontSize: fs(16), color: "#fff", paddingVertical: 10 }}
              returnKeyType="search"
            />
            {invProductSearch.length > 0 ? (
              <Pressable onPress={() => setInvProductSearch("")} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={18} color="#8e8e93" />
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
      {/* Status tags: 3 delivery states + device-local drafts */}
      {!creating && (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: padH, paddingTop: 4 }}>
          {tags.map(t => {
            const active = statusTag === t.k;
            return (
              <Pressable
                key={t.k}
                onPress={() => setStatusTag(t.k)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 13, borderRadius: radius.pill, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : inv.border }}
              >
                <Text style={{ fontSize: fs(12), fontWeight: "800", color: active ? "#000" : inv.sub }}>{t.label}</Text>
                <View style={{ backgroundColor: active ? "rgba(0,0,0,0.08)" : inv.tile, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 }}>
                  <Text style={{ fontSize: fs(11), fontWeight: "800", color: active ? "#000" : inv.sub }}>{t.count}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {creating && canInventory ? (
        <BatchWizard
          role={role}
          canInventory={canInventory}
          canViewItemCost={canViewItemCost}
          products={products}
          categories={categories}
          productCategories={productCategories}
          pricing={pricing}
          costByProduct={costByProduct}
          batchItems={batchItems}
          variants={variants}
          suppliers={suppliers}
          isTablet={isTablet}
          width={width}
          padH={padH}
          resumeDraftId={resumeDraftId}
          closeRef={wizardCloseRef}
          onSaved={handleWizardSaved}
          onClose={closeWizard}
        />
      ) : statusTag === "draft" ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 40, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
          {drafts.length === 0
            ? emptyState("document-text-outline", "Pa gen brouyon", "Livrezon ki pa fini konsève isit la 14 jou pou ou ka kontinye l pi ta.")
            : drafts.map(d => renderDraftCard(d))}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 40, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
          {shownGroups.length === 0
            ? deliveryQuery
              ? emptyState("search-outline", "Pa gen rezilta", "Chanje rechèch la.")
              : statusTag === "pending"
                ? emptyState("boat-outline", "Poko gen livrezon ap vini", "Stòk la parèt isit la sèlman lè li rive.")
                : statusTag === "received"
                  ? emptyState("checkmark-circle-outline", "Poko gen livrezon rive", "Livrezon ki rive ap parèt isit la.")
                  : emptyState("close-circle-outline", "Poko gen refi", "Batch ki refize ap parèt isit la.")
            : shownGroups.map(g => renderGroupCard(g, { receive: true }))}
        </ScrollView>
      )}

      {/* Batch detail (Verifye) — full height. Per-line verify + receive,
          Admin/Owner only; received lines land in stock immediately. */}
      <Modal visible={!!activeGroup} transparent animationType="slide" onRequestClose={() => !detailBusy && setDeliverKey(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontWeight: "800", fontSize: fs(18), color: paper, flex: 1 }} numberOfLines={1}>
                  {activeGroup?.ref || activeGroup?.supplierName}
                </Text>
                {activeGroup ? statusPill(activeGroup.status) : null}
              </View>
              <Text style={{ fontSize: fs(12), color: paperSub, marginTop: 2 }} numberOfLines={1}>
                {activeGroup?.ref ? `${activeGroup.supplierName} · ` : ""}{activeGroup ? fmtDateHt(activeGroup.date) : ""} · {activeGroup?.lines.length ?? 0} pwodui
              </Text>
            </View>
            <Pressable onPress={() => detailBusy ? Alert.alert("Ap travay", "Yon aksyon ap trete — tann li fini anvan ou fèmen.") : setDeliverKey(null)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={30} color="#fff" />
            </Pressable>
          </View>
          <View style={{ height: 1, backgroundColor: cardDiv }} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {(activeGroup?.lines ?? []).map(l => {
              const st = String(l.batch.status ?? "pending");
              const isPend = st === "pending";
              return (
                <View key={String(l.batch.id)} style={{ backgroundColor: cardBg, borderRadius: 16, borderWidth: 1, borderColor: cardBd, padding: 12, gap: 8, opacity: isPend ? 1 : 0.75 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "800", fontSize: fs(15), color: paper }} numberOfLines={1}>{l.productName}</Text>
                      <Text style={{ fontSize: fs(12), color: paperSub, marginTop: 2 }} numberOfLines={1}>
                        {fmt(Number(l.batch.quantity) || 0)} {l.itemName} · {fmtG(Math.round(Number(l.batch.total_paid) || 0))}
                      </Text>
                      {(l.batch as any).reason ? <Text style={{ fontSize: fs(11), color: paperSub, marginTop: 2 }} numberOfLines={2}>Nòt: {(l.batch as any).reason}</Text> : null}
                    </View>
                    {statusPill(st)}
                  </View>
                  {isPend && canAdminOwner ? (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable onPress={() => handleReceiveLine(l)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", opacity: detailBusy ? 0.6 : 1 }}>
                        <Text style={{ fontWeight: "800", fontSize: fs(13), color: "#000" }}>{detailBusy ? "Ap trete…" : "Rive ✓"}</Text>
                      </Pressable>
                      <Pressable onPress={() => openLineEdit(l)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: inv.borderStrong, alignItems: "center" }}>
                        <Text style={{ fontWeight: "700", fontSize: fs(13), color: "#fff" }}>Modifye</Text>
                      </Pressable>
                      <Pressable onPress={() => openLineDeny(l)} style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: inv.redBd, alignItems: "center" }}>
                        <Text style={{ fontWeight: "700", fontSize: fs(13), color: inv.red }}>Refize</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          {/* Per-line edit/refuse sheet — inline overlay, NOT a second Modal:
              a Modal stacked over the detail Modal doesn't present reliably,
              so the sheet lives inside the detail window and always appears. */}
          {lineModal ? (
          <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <Pressable onPress={() => setLineModal(null)} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0} style={{ width: "100%" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: inv.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: inv.border, padding: 16, paddingBottom: 28 }}>
              <View style={{ width: 36, height: 4, backgroundColor: inv.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
              <Text style={{ fontWeight: "800", fontSize: fs(15), color: inv.text }} numberOfLines={1}>{lineModal?.line.productName}</Text>
              <Text style={{ fontSize: fs(11), color: inv.sub, marginTop: 2 }} numberOfLines={1}>
                {lineModal ? `${fmt(Number(lineModal.line.batch.quantity) || 0)} ${lineModal.line.itemName} · ${fmtG(Math.round(Number(lineModal.line.batch.total_paid) || 0))}` : ""}
              </Text>
              {lineModal?.mode === "edit" ? (
                <View style={{ gap: 10, marginTop: 12 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Kantite *</Text>
                      <TextInput value={eQty} onChangeText={v => setEQty(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="0" placeholderTextColor={inv.faint}
                        style={{ height: 56, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontWeight: "800", fontSize: fs(15), color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Total peye (G) *</Text>
                      <MoneyInput value={eTotal} onChangeText={v => setETotal(v)} keyboardType="numeric" placeholder="0" placeholderTextColor={inv.faint}
                        style={{ height: 56, borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, marginTop: 6, fontWeight: "800", fontSize: fs(15), color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
                    </View>
                  </View>
                  <View>
                    <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Nòt (opsyonèl)</Text>
                    <TextInput value={eNote} onChangeText={setENote} placeholder="Eg. 2 katon domaje" placeholderTextColor={inv.faint}
                      style={{ borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginTop: 6, fontSize: fs(14), color: "#fff", backgroundColor: "transparent", minHeight: 48 }} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => setLineModal(null)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}>
                      <Text style={{ fontWeight: "700", color: "#fff", fontSize: fs(14) }}>Anile</Text>
                    </Pressable>
                    <Pressable onPress={saveLineEdit} disabled={detailBusy} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center", opacity: detailBusy ? 0.6 : 1 }}>
                      <Text style={{ color: "#000", fontWeight: "800", fontSize: fs(14) }}>Mete ajou</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 10, marginTop: 12 }}>
                  <View>
                    <Text style={{ fontWeight: "700", fontSize: fs(12), color: inv.text }}>Rezon refi a *</Text>
                    <TextInput value={eReason} onChangeText={setEReason} placeholder="Eg. machandiz gate" placeholderTextColor={inv.faint}
                      style={{ borderWidth: 1, borderColor: inv.borderStrong, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginTop: 6, fontSize: fs(14), color: "#fff", backgroundColor: "transparent", minHeight: 48 }} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => setLineModal(null)} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: inv.borderStrong }}>
                      <Text style={{ fontWeight: "700", color: "#fff", fontSize: fs(14) }}>Anile</Text>
                    </Pressable>
                    <Pressable onPress={confirmLineDeny} disabled={detailBusy} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#c0392b", borderRadius: 12, alignItems: "center", opacity: detailBusy ? 0.6 : 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: fs(14) }}>Konfime refi</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
            </KeyboardAvoidingView>
          </View>
          ) : null}
        </View>
      </Modal>
      </View>
    </View>
  );
}
