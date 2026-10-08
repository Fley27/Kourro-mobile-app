// BulkProductFlowModal — bulk product creation (initial setup companion to
// the single-product chain). Each bulk product is a real DRAFT row from step
// 1 on: steps embed the shared ProductStep (SKU field + supplier
// quick-create on), ItemsStep and VariantsStep — one UI definition for both
// flows. Session = draft ids: collapsed list (edit/delete on demand, cap 10),
// review screen with per-item badges, one submit flips drafts → ACTIVE.
// Closing keeps drafts (recoverable via the Brouyon filter). Batches/prices
// come later via Inventory + Pri. The type toggle covers goods (units +
// variants steps) and services (supplier hidden, variants in serviceMode).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Modal, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb, insertOutbox } from "../../db";
import { loadCatalogModel, softDeleteProduct } from "../../catalogModel";
import type { FlowCtx } from "./types";
import { canManageCatalog } from "./types";
import { UploadTransition, minDelay, type UploadPhase } from "../../components/UploadTransition";
import ProductStep from "./ProductStep";
import ItemsStep from "./ItemsStep";
import VariantsStep from "./VariantsStep";
import { SafeScreen } from "../../components/SafeScreen";
import { IS_TABLET_DEVICE } from "../../responsive";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

const MAX_PRODUCTS = 10;
const norm = (s: string) => String(s ?? "").trim().toLowerCase();

type SessionRow = { id: string; name: string; sku: string };

export default function BulkProductFlowModal({ visible, onClose, onDone, ctx }: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
  ctx: FlowCtx;
}) {
  const [session, setSession] = useState<string[]>([]);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [view, setView] = useState<"edit" | "list" | "review">("edit");
  const [stepIdx, setStepIdx] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [flowType, setFlowType] = useState<"goods" | "service">("goods");
  const [busy, setBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [upPhase, setUpPhase] = useState<UploadPhase>("loading");
  const [upMsg, setUpMsg] = useState("");
  const nextRef = React.useRef<(() => void) | null>(null);
  const registerNext = (fn: (() => void) | null) => { nextRef.current = fn; };

  // Goods: product → items → variants → summary. Services: no units step.
  const steps = flowType === "service" ? ["product", "variants", "summary"] : ["product", "items", "variants", "summary"];
  const stepKey = steps[Math.min(stepIdx, steps.length - 1)];
  const stepTitles: Record<string, string> = { product: "Pwodwi", items: "Inite", variants: "Variant", summary: "Revizyon" };
  // Steps stay mounted per draft (remount on draft switch via key).
  const draftKey = draftId ?? "new";

  useEffect(() => {
    if (visible) {
      setSession([]);
      setRows([]);
      setDraftId(null);
      setDraftName("");
      setFlowType("goods");
      setStepIdx(0);
      setView("edit");
    }
  }, [visible]);

  async function reloadRows(ids: string[]) {
    try {
      const db = await getDb();
      const out: SessionRow[] = [];
      for (const id of ids) {
        const r = (((await db.getAllAsync("SELECT id, name, sku FROM products WHERE id = ?", [id]).catch(() => [])) ?? []) as any[])[0];
        if (r && !r.is_deleted) out.push({ id: String(r.id), name: String(r.name ?? "?"), sku: String(r.sku ?? "") });
      }
      setRows(out);
      return out;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    if (visible && view === "list") reloadRows(session);
  }, [visible, view, session]);

  function startNew() {
    if (session.length >= MAX_PRODUCTS) { Alert.alert("Limite", `Plis pase ${MAX_PRODUCTS} pwodwi pa sesyon.`); return; }
    setDraftId(null);
    setDraftName("");
    setFlowType("goods");
    setStepIdx(0);
    setView("edit");
  }

  function openEdit(id: string, step = 0) {
    setDraftId(id);
    setDraftName(rows.find(r => r.id === id)?.name ?? "");
    setStepIdx(step);
    setView("edit");
    (async () => {
      try {
        const db = await getDb();
        const r = (((await db.getAllAsync("SELECT item_type FROM products WHERE id = ?", [id]).catch(() => [])) ?? []) as any[])[0];
        setFlowType(r?.item_type === "service" ? "service" : "goods");
      } catch {}
    })();
  }

  const goNext = () => setStepIdx(i => Math.min(i + 1, steps.length - 1));

  function onProductNext(id: string, type: "goods" | "service") {
    setDraftId(prev => {
      if (!prev) setSession(s => (s.includes(id) ? s : [...s, id]));
      return id;
    });
    setFlowType(type);
    (async () => {
      try {
        const db = await getDb();
        const r = (((await db.getAllAsync("SELECT name FROM products WHERE id = ?", [id]).catch(() => [])) ?? []) as any[])[0];
        setDraftName(String(r?.name ?? ""));
      } catch {}
    })();
    if (type === "service") setStepIdx(1);
    else goNext();
  }

  async function removeDraft(id: string) {
    try {
      const db = await getDb();
      await softDeleteProduct(db, id);
    } catch {}
    setSession(prev => prev.filter(x => x !== id));
    ctx.reload();
  }

  // ---- summary (per-product review before collapse) ----
  const [summary, setSummary] = useState<{ units: number; variants: number; supplier: string } | null>(null);
  useEffect(() => {
    if (!visible || view !== "edit" || stepKey !== "summary" || !draftId) { setSummary(null); return; }
    (async () => {
      try {
        const db = await getDb();
        const [its, vs, ps] = await Promise.all([
          db.getAllAsync("SELECT id FROM items WHERE product_id = ?", [draftId]).catch(() => []),
          db.getAllAsync("SELECT id, item_id FROM variants").catch(() => []),
          db.getAllAsync("SELECT supplier_id FROM product_suppliers WHERE product_id = ?", [draftId]).catch(() => []),
        ]);
        const itemIds = new Set((((its ?? []) as any[]).filter((i: any) => !i.is_deleted)).map((i: any) => String(i.id)));
        const vCount = (((vs ?? []) as any[]).filter((v: any) => !v.is_deleted && itemIds.has(String(v.item_id)))).length;
        let sup = "—";
        try {
          const sid = String((((ps ?? []) as any[])[0] as any)?.supplier_id ?? "");
          if (sid) {
            const sr = (((await db.getAllAsync("SELECT name FROM suppliers WHERE id = ?", [sid]).catch(() => [])) ?? []) as any[])[0];
            sup = String(sr?.name ?? "—");
          }
        } catch {}
        setSummary({ units: itemIds.size, variants: vCount, supplier: sup });
      } catch { setSummary(null); }
    })();
  }, [visible, view, stepKey, draftId]);

  function collapseProduct() {
    setView("list");
  }

  // ---- final review: validate every session draft ----
  const [issues, setIssues] = useState<Record<string, { msgs: string[]; step: number }>>({});
  useEffect(() => {
    if (!visible || view !== "review") return;
    (async () => {
      try {
        const db = await getDb();
        const model = await loadCatalogModel(db);
        const all = (((await db.getAllAsync("SELECT * FROM products WHERE is_deleted = 0 OR is_deleted IS NULL").catch(() => [])) ?? []) as any[]);
        const out: Record<string, { msgs: string[]; step: number }> = {};
        for (const id of session) {
          const p = all.find((r: any) => String(r.id) === id);
          if (!p) { out[id] = { msgs: ["Pwodwi efase"], step: 0 }; continue; }
          const msgs: string[] = [];
          let step = 0;
          let seenBad = false;
          const bad = (s: number, m: string) => { msgs.push(m); if (!seenBad) { step = s; seenBad = true; } };
          const nm = norm(p.name);
          if (String(p.name ?? "").trim().length < 2) bad(0, "Non (min 2 lèt)");
          else if (all.some((r: any) => String(r.id) !== id && norm(r.name) === nm)) bad(0, "Non deja egziste");
          const sk = String(p.sku ?? "").trim().toUpperCase();
          if (!sk) bad(0, "SKU vid");
          else if (all.some((r: any) => String(r.id) !== id && String(r.sku ?? "").trim().toUpperCase() === sk)) bad(0, "SKU deja egziste");
          if (!model.productSuppliers.some(ps => String(ps.product_id) === id)) bad(0, "Founisè");
          const pItems = model.items.filter(i => String(i.product_id) === id && !i.is_deleted);
          if (!pItems.length) bad(1, "Omwen yon inite");
          const svc = (p.item_type ?? "goods") === "service";
          const pVars = model.variants.filter(v => !v.is_deleted && pItems.some(i => String(i.id) === String(v.item_id)));
          for (const it of pItems) {
            if (!pVars.some(v => String(v.item_id) === String(it.id))) bad(svc ? 1 : 2, `Variant pou ${it.name}`);
          }
          out[id] = { msgs, step };
        }
        setIssues(out);
      } catch {}
    })();
  }, [visible, view, session]);
  const badCount = Object.values(issues).filter(i => i.msgs.length > 0).length;

  async function submit() {
    if (!session.length) { Alert.alert("Vid", "Ajoute omwen yon pwodwi."); return; }
    if (badCount) { Alert.alert("Enkonplè", `${badCount} pwodwi gen pwoblèm — korije yo anvan.`); return; }
    if (!canManageCatalog(ctx.role)) { Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè."); return; }
    if (busy || upBusy) return;
    setBusy(true);
    setUpBusy(true);
    setUpPhase("loading");
    setUpMsg(`${session.length} pwodwi • ap anrejistre…`);
    try {
      const count = await minDelay((async () => {
        const db = await getDb();
        const now = new Date().toISOString();
        for (const id of session) {
          await db.runAsync("UPDATE products SET status = ?, updated_at = ?, dirty = 1 WHERE id = ?", ["active", now, id]);
          try {
            const { insertOutbox } = await import("../../db");
            await insertOutbox("products", "update", { id, status: "active", updated_at: now, is_deleted: 0 });
          } catch {}
        }
        return session.length;
      })(), 1500);
      setUpPhase("success");
      setUpMsg(`${count} pwodwi anrejistre`);
      await new Promise(r => setTimeout(r, 1500));
      setUpBusy(false);
      setSession([]);
      ctx.reload();
      onDone();
      onClose();
    } catch (e: any) {
      setUpPhase("error");
      setUpMsg(e?.message ?? "Soumèt echwe");
      await new Promise(r => setTimeout(r, 3000));
      setUpBusy(false);
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { ctx, productId: draftId ?? "", productName: draftName };
  // Reset the header action every render — only the visible step registers.
  nextRef.current = null;

  // TABLET-SCREEN: shell runs inline as a content-area screen (the sidebar
  // stays visible); phone keeps the full-window Modal slide-up below.
  const inner = (
    <>
      <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable
            onPress={() => {
              if (view === "edit" && stepIdx > 0) setStepIdx(i => i - 1);
              else if (view === "edit") setView(session.length ? "list" : "list");
              else if (view === "review") setView("list");
              else onClose();
            }}
            accessibilityLabel="Back"
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name={view !== "edit" || stepIdx > 0 ? "chevron-back" : "close"} size={26} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>
              {view === "list" ? `Pwodwi yo (${session.length})` : view === "review" ? "Revizyon" : stepTitles[stepKey]}
            </Text>
            {view === "edit" && (
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }}>Etap {stepIdx + 1} / {steps.length} · plizyè pwodwi</Text>
            )}
          </View>
          {view === "edit" && stepKey !== "summary" ? (
            <Pressable onPress={() => nextRef.current?.()} style={{ paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Kontinye</Text>
            </Pressable>
          ) : view === "edit" ? (
            <Pressable onPress={collapseProduct} style={{ paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Anrejistre</Text>
            </Pressable>
          ) : view === "review" ? (
            <Pressable onPress={submit} style={{ paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Soumèt</Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        <View style={{ height: 1, backgroundColor: "#262626" }} />
        {view === "edit" && (
          <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12 }}>
            {steps.map((s, i) => (
              <View key={s} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= stepIdx ? "#fff" : "#2b2b2b" }} />
            ))}
          </View>
        )}

        {view === "list" ? (
          <View style={{ flex: 1 }}>
          <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {rows.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <Text style={{ fontSize: 13, color: "#8e8e93" }}>Poko gen pwodwi — tape + pou ajoute premye a.</Text>
              </View>
            ) : (
              rows.map(r => {
                const bad = (issues[r.id]?.msgs.length ?? 0) > 0;
                return (
                  <View key={r.id} style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff", flex: 1 }} numberOfLines={1}>{r.name}</Text>
                          {bad && (
                            <View style={{ backgroundColor: "rgba(224,108,91,0.16)", borderWidth: 1, borderColor: "rgba(224,108,91,0.45)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: "#e06c5b" }}>{issues[r.id].msgs.length}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{r.sku} · brouyon</Text>
                      </View>
                      <Pressable onPress={() => openEdit(r.id)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="pencil" size={15} color="#fff" />
                      </Pressable>
                      <Pressable onPress={() => removeDraft(r.id)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(224,108,91,0.12)", borderWidth: 1, borderColor: "rgba(224,108,91,0.4)", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="trash-outline" size={15} color="#e06c5b" />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
            {session.length < MAX_PRODUCTS && (
              <Pressable onPress={startNew} style={{ paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a3a3c", borderStyle: "dashed", alignItems: "center" }}>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>+ ajoute yon lòt pwodwi</Text>
              </Pressable>
            )}
          </KeyboardSafeScrollView>
          {session.length > 0 && (
            <View style={{ padding: 16, paddingTop: 10, backgroundColor: "#000", borderTopWidth: 0.5, borderColor: "#262626" }}>
              <Pressable onPress={() => setView("review")} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
                <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Kontinye pou revize</Text>
              </Pressable>
            </View>
          )}
          </View>
        ) : view === "review" ? (
          <View style={{ flex: 1 }}>
          <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {rows.map(r => {
              const iss = issues[r.id]?.msgs ?? [];
              const stp = issues[r.id]?.step ?? 0;
              return (
                <Pressable key={r.id} onPress={() => (iss.length ? openEdit(r.id, stp) : undefined)} style={{ backgroundColor: "#1C1C1E", borderWidth: iss.length ? 1 : 0.5, borderColor: iss.length ? "#c0392b" : "#2b2b2b", borderRadius: 16, padding: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }} numberOfLines={1}>{r.name}</Text>
                      <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }} numberOfLines={2}>{r.sku}</Text>
                      {iss.length > 0 && (
                        <Text style={{ fontSize: 12, color: "#e06c5b", marginTop: 4 }}>{iss.join("\n")}</Text>
                      )}
                    </View>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: iss.length ? "#c0392b" : "#2f7d5b" }} />
                  </View>
                </Pressable>
              );
            })}
          </KeyboardSafeScrollView>
          <View style={{ padding: 16, paddingTop: 10, backgroundColor: "#000", borderTopWidth: 0.5, borderColor: "#262626" }}>
            <Pressable onPress={submit} disabled={busy} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", opacity: busy ? 0.6 : 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>{busy ? "Ap soumèt…" : `Soumèt ${session.length} pwodwi`}</Text>
            </Pressable>
          </View>
          </View>
        ) : (
          <View key={draftKey} style={{ flex: 1 }}>
            <View style={{ flex: 1, display: stepKey === "product" ? "flex" : "none" }}>
              <ProductStep
                ctx={ctx}
                productId={draftId}
                onDirtyChange={() => {}}
                registerNext={registerNext}
                active={stepKey === "product"}
                showSkuField
                onNext={onProductNext}
              />
            </View>
            {draftId ? (
              <>
                <View style={{ flex: 1, display: stepKey === "items" ? "flex" : "none" }}>
                  <ItemsStep ctx={ctx} productId={draftId} productName={draftName} stageMode registerNext={registerNext} active={stepKey === "items"} onNext={goNext} />
                </View>
                <View style={{ flex: 1, display: stepKey === "variants" ? "flex" : "none" }}>
                  <VariantsStep ctx={ctx} productId={draftId} productName={draftName} serviceMode={flowType === "service"} stageMode registerNext={registerNext} active={stepKey === "variants"} onNext={goNext} />
                </View>
                {stepKey === "summary" ? (
                  <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                    <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: 16, padding: 14, gap: 6 }}>
                      <Text style={{ fontWeight: "800", fontSize: 17, color: "#fff" }} numberOfLines={1}>{draftName || "—"}</Text>
                      <Text style={{ fontSize: 12, color: "#8e8e93" }}>
                        {summary ? `${summary.units} inite · ${summary.variants} variant · ${summary.supplier}` : "…"}
                      </Text>
                    </View>
                    <Pressable onPress={collapseProduct} style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: "#fff", alignItems: "center" }}>
                      <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Anrejistre pwodwi a</Text>
                    </Pressable>
                  </KeyboardSafeScrollView>
                ) : null}
              </>
            ) : null}
          </View>
        )}
        </View>
      </SafeScreen>
      <UploadTransition visible={upBusy} phase={upPhase} title="Soumèt pwodwi" detail={upMsg} />
    </>
  );

  if (IS_TABLET_DEVICE) {
    return visible ? <View style={{ flex: 1, backgroundColor: "#000" }}>{inner}</View> : null;
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {inner}
    </Modal>
  );
}
