// Orders (Kòmand) — Phase 8. Stock/catalog need requests with a gated flow:
// requested -> approved -> ordered -> received (cancelled from any open state).
// Staff (cashier/associate/cook/server): create + view + cancel own pending.
// Manager/admin: approve, mark ordered/received, edit, cancel any.
// Owner: everything incl. delete.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal, ActivityIndicator, Alert } from "react-native";
import { palette, radius, shadow, topIconBtn } from "../theme";
import { useResponsive } from "../responsive";
import type { Role } from "../users";
import { getDb, insertOutbox } from "../db";

export type OrderStatus = "requested" | "approved" | "ordered" | "received" | "cancelled";
export type Order = {
  id: string;
  store_id: string;
  item_name: string;
  qty?: number | null;
  unit?: string | null;
  supplier_name?: string | null;
  note?: string | null;
  status: OrderStatus;
  requested_by?: string | null;
  requested_by_name?: string | null;
  approved_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  role?: Role;
  currentUser?: any;
  storeId: string;
  storeName?: string;
  userStoreIds?: string[];
  stores?: { id: string; name: string }[];
};

const uid = () => `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const STATUS_META: Record<OrderStatus, { label: string; fg: string; bg: string }> = {
  requested: { label: "Mande", fg: "#8A5A00", bg: "#FDF3E3" },
  approved: { label: "Apwouve", fg: "#1D4ED8", bg: "#EAF1FE" },
  ordered: { label: "Kòmande", fg: "#6D28D9", bg: "#F1EAFE" },
  received: { label: "Resevwa", fg: "#1E7B34", bg: "#E8F6EC" },
  cancelled: { label: "Anile", fg: "#6B7280", bg: "#F1F1F1" },
};

const FILTERS: ("all" | OrderStatus)[] = ["all", "requested", "approved", "ordered", "received", "cancelled"];

function StatusPill({ status }: { status: OrderStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.requested;
  return (
    <View style={{ backgroundColor: m.bg, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: "900", color: m.fg }}>{m.label}</Text>
    </View>
  );
}

export default function OrdersScreen({ role = "cashier", currentUser, storeId, userStoreIds = [], stores = [] }: Props) {
  const { padH, isTablet } = useResponsive();
  const isOwner = role === "owner";
  const canManage = isOwner || role === "admin" || role === "manager";
  const myId = String(currentUser?.id ?? currentUser?.username ?? "me");
  const myName = String(currentUser?.display_name ?? currentUser?.full_name ?? currentUser?.name ?? currentUser?.username ?? role);
  const scopeIds = useMemo(
    () => (isOwner || canManage ? (userStoreIds.length ? userStoreIds : [storeId]) : [storeId]),
    [isOwner, canManage, userStoreIds, storeId]
  );
  // Non-managers see their own scope only (active store); managers+ see scope stores.
  const visibleScope = canManage || isOwner ? scopeIds : [scopeIds.includes(storeId) ? storeId : scopeIds[0] ?? storeId];

  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [detail, setDetail] = useState<Order | null>(null);
  const [form, setForm] = useState<{ order: Order | null; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const storeNameOf = useCallback((id: string) => stores.find(s => s.id === id)?.name ?? id, [stores]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      let rows: Order[];
      if (isOwner) {
        rows = await db.getAllAsync("SELECT * FROM orders WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY created_at DESC");
      } else {
        if (!visibleScope.length) { setItems([]); setLoading(false); return; }
        const ph = visibleScope.map(() => "?").join(",");
        rows = await db.getAllAsync(
          `SELECT * FROM orders WHERE (is_deleted = 0 OR is_deleted IS NULL) AND store_id IN (${ph}) ORDER BY created_at DESC`,
          visibleScope
        );
      }
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isOwner, visibleScope]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(o => {
      if (filter !== "all" && o.status !== filter) return false;
      if (!needle) return true;
      return (o.item_name ?? "").toLowerCase().includes(needle)
        || (o.requested_by_name ?? "").toLowerCase().includes(needle)
        || (o.supplier_name ?? "").toLowerCase().includes(needle);
    });
  }, [items, q, filter]);

  const openCount = items.filter(o => o.status === "requested" || o.status === "approved").length;

  const queueOrder = async (op: "create" | "update", rec: Order) => {
    try {
      await insertOutbox("orders", op, {
        ...rec,
        updated_at: new Date().toISOString(),
        lamport_clock: Date.now(),
        is_deleted: false,
      });
    } catch {}
  };

  const setStatus = async (order: Order, status: OrderStatus) => {
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const approvedBy = status === "approved" ? myName : order.approved_by;
      if (status === "approved") {
        await db.runAsync("UPDATE orders SET status = ?, approved_by = ?, updated_at = ?, dirty = 1 WHERE id = ?", [status, myName, now, order.id]);
      } else {
        await db.runAsync("UPDATE orders SET status = ?, updated_at = ?, dirty = 1 WHERE id = ?", [status, now, order.id]);
      }
      await queueOrder("update", { ...order, status, approved_by: approvedBy ?? null, updated_at: now });
      let stockMsg = "";
      if (status === "received") {
        // Receiving posts stock when the item exactly matches a catalog product
        // (name / Creole name / SKU), preferring the order's store.
        try {
          const prods = ((await db.getAllAsync("SELECT * FROM products")) as any[]) ?? [];
          const needle = order.item_name.trim().toLowerCase();
          const exact = prods.filter(p =>
            [p.name, p.name_ht, p.sku].some(v => String(v ?? "").trim().toLowerCase() === needle)
          );
          const match = exact.find(p => p.store_id === order.store_id) ?? exact[0];
          if (match) {
            const qty = Math.max(1, Number(order.qty) || 1);
            const batchId = `batch-${Date.now()}`;
            const batchRec = { id: batchId, store_id: order.store_id, reference: `KMD-${order.id.slice(-6)}`, supplier: order.supplier_name ?? "Kòmand", transport_cost: 0, notes: `Resepsyon kòmand ${order.id}`, total_items_cost: 0, total_cost: 0, received_at: now, status: "delivered", delivered_at: now, created_by: myId, created_at: now, updated_at: now, lamport_clock: Date.now(), is_deleted: false };
            const movId = `mov-${Date.now()}`;
            const movRec = { id: movId, batch_id: batchId, store_id: order.store_id, product_id: match.id, type: "in", quantity: qty, initial_qty: qty, remaining_qty: qty, unit_cost: 0, total_cost: 0, allocated_transport: 0, reason: `Kòmand resevwa (${order.id})`, status: "delivered", delivered_at: now, created_by: myId, created_at: now, updated_at: now, lamport_clock: Date.now(), is_deleted: false };
            await db.runAsync("INSERT INTO stock_batches (id, store_id, reference, supplier, transport_cost, notes, total_items_cost, total_cost, received_at, created_by, created_at, updated_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [batchId, order.store_id, batchRec.reference, batchRec.supplier, 0, batchRec.notes, 0, 0, now, myId, now, now, "delivered", now]);
            await db.runAsync("INSERT INTO stock_movements (id, batch_id, store_id, product_id, type, quantity, initial_qty, remaining_qty, unit_cost, total_cost, allocated_transport, reason, created_by, created_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [movId, batchId, order.store_id, match.id, "in", qty, qty, qty, 0, 0, 0, movRec.reason, myId, now, "delivered", now]);
            await db.runAsync("UPDATE products SET stock_quantity = stock_quantity + ?, current_amount_available = current_amount_available + ? WHERE id = ?", [qty, qty, match.id]);
            try { await insertOutbox("stock_batches", "create", batchRec); } catch {}
            try { await insertOutbox("stock_movements", "create", movRec); } catch {}
            stockMsg = ` — +${qty} ${match.name} nan stòk`;
          } else {
            stockMsg = " — okenn pwodwi katalòg pa matche egzakteman; mete stòk ajou manyèlman";
          }
        } catch {
          stockMsg = "";
        }
        Alert.alert("Kòmand resevwa", `${order.item_name}${stockMsg}`);
      }
      setDetail(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const mine = (o: Order) => String(o.requested_by ?? "") === myId;
  const isOpen = (o: Order) => o.status !== "received" && o.status !== "cancelled";
  const canEdit = (o: Order) => (o.status === "requested" && mine(o)) || (canManage && isOpen(o));
  const canCancel = (o: Order) => (o.status === "requested" && mine(o)) || (canManage && isOpen(o));

  return (
    <View style={{ flex: 1, paddingHorizontal: padH }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={{ fontSize: isTablet ? 20 : 17, fontWeight: "900", color: palette.ink }}>
          Kòmand <Text style={{ color: palette.muted2, fontWeight: "700" }}>({filtered.length}{openCount ? ` · ${openCount} ouvè` : ""})</Text>
        </Text>
        <Pressable
          onPress={() => setForm({ order: null, isNew: true })}
          style={{ backgroundColor: topIconBtn.bg, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 44, justifyContent: "center", ...shadow.soft }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>+ Nouvo demann</Text>
        </Pressable>
      </View>

      {!canManage ? (
        <View style={{ backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 10, marginBottom: 10 }}>
          <Text style={{ fontSize: 12, color: palette.muted }}>
            Ou ka voye demann stock; manadjè a ap apwouve epi swiv li.
          </Text>
        </View>
      ) : null}

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Chèche atik, moun, founisè…"
        placeholderTextColor={palette.muted2}
        style={{ minHeight: 56, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.surface, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 15, color: palette.ink, marginBottom: 8 }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.map(f => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={{
              paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 18,
              backgroundColor: filter === f ? palette.ink : palette.surface,
              borderWidth: 0.5, borderColor: palette.hairline,
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 12, color: filter === f ? "#fff" : palette.ink }}>
              {f === "all" ? "Tout" : STATUS_META[f].label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Text style={{ fontSize: 40 }}>📦</Text>
          <Text style={{ fontWeight: "800", color: palette.ink }}>Okenn kòmand</Text>
          <Text style={{ color: palette.muted2, fontSize: 13 }}>Voye premye demann lan.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 90 }}>
          {filtered.map(o => (
            <Pressable
              key={o.id}
              onPress={() => setDetail(o)}
              style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12, ...shadow.soft }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontWeight: "900", fontSize: 15, color: palette.ink, flex: 1 }} numberOfLines={1}>
                  {o.item_name} <Text style={{ color: palette.muted, fontWeight: "700" }}>× {o.qty ?? 1}{o.unit ? ` ${o.unit}` : ""}</Text>
                </Text>
                <StatusPill status={o.status} />
              </View>
              <Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                Mande pa {o.requested_by_name ?? "—"}{isOwner ? ` · ${storeNameOf(o.store_id)}` : ""}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Detail + actions */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setDetail(null)} />
          <View style={{ maxHeight: "86%", backgroundColor: palette.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 }}>
            {detail ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ fontSize: 19, fontWeight: "900", color: palette.ink, flex: 1 }}>{detail.item_name}</Text>
                  <StatusPill status={detail.status} />
                </View>
                <ScrollView style={{ marginTop: 12, maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 4 }}>
                  <DRow label="Kantite" value={`${detail.qty ?? 1}${detail.unit ? ` ${detail.unit}` : ""}`} />
                  <DRow label="Founisè" value={detail.supplier_name} />
                  <DRow label="Mande pa" value={detail.requested_by_name ?? undefined} />
                  {detail.approved_by ? <DRow label="Apwouve pa" value={detail.approved_by} /> : null}
                  {isOwner ? <DRow label="Magazen" value={storeNameOf(detail.store_id)} /> : null}
                  <DRow label="Nòt" value={detail.note} />
                </ScrollView>
                <View style={{ gap: 8, marginTop: 10 }}>
                  {canManage && detail.status === "requested" ? (
                    <BigBtn label={busy ? "…" : "Apwouve demann"} bg={palette.accent} onPress={() => setStatus(detail, "approved")} disabled={busy} />
                  ) : null}
                  {canManage && detail.status === "approved" ? (
                    <BigBtn label={busy ? "…" : "Make kòmand lan"} bg={palette.ink} onPress={() => setStatus(detail, "ordered")} disabled={busy} />
                  ) : null}
                  {canManage && detail.status === "ordered" ? (
                    <BigBtn label={busy ? "…" : "Make resevwa"} bg="#1E7B34" onPress={() => setStatus(detail, "received")} disabled={busy} />
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => setDetail(null)}
                      style={{ flex: 1, minHeight: 60, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontWeight: "900", color: palette.ink }}>Fèmen</Text>
                    </Pressable>
                    {detail && canEdit(detail) ? (
                      <Pressable
                        onPress={() => { setForm({ order: detail, isNew: false }); setDetail(null); }}
                        style={{ flex: 1, minHeight: 60, borderRadius: radius.md, backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ fontWeight: "900", color: palette.ink }}>Modifye</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {detail && canCancel(detail) ? (
                      <Pressable
                        onPress={() => setStatus(detail, "cancelled")}
                        disabled={busy}
                        style={{ flex: 1, minHeight: 52, borderRadius: radius.md, backgroundColor: "#FDECEC", alignItems: "center", justifyContent: "center" }}
                      >
                        <Text style={{ fontWeight: "900", color: palette.danger }}>Anile kòmand</Text>
                      </Pressable>
                    ) : null}
                    {isOwner && detail ? (
                      <Pressable
                        onPress={() => {
                          Alert.alert("Efase kòmand?", detail.item_name, [
                            { text: "Kenbe", style: "cancel" },
                            {
                              text: "Efase", style: "destructive",                             onPress: async () => {
                                const rec = detail; setDetail(null);
                                try {
                                  const db = await getDb();
                                  await db.runAsync("UPDATE orders SET is_deleted = 1, dirty = 1, updated_at = ? WHERE id = ?", [new Date().toISOString(), rec.id]);
                                } catch { const db = await getDb(); await db.runAsync("DELETE FROM orders WHERE id = ?", [rec.id]); }
                                try { await insertOutbox("orders", "update", { ...rec, is_deleted: true, updated_at: new Date().toISOString(), lamport_clock: Date.now() }); } catch {}
                                load();
                              },
                            },
                          ]);
                        }}
                        style={{ minHeight: 52, borderRadius: radius.md, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.danger }}
                      >
                        <Text style={{ fontWeight: "900", color: palette.danger }}>Efase</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Create/Edit form */}
      <OrderFormModal
        visible={!!form}
        order={form?.order ?? null}
        canManage={canManage}
        saving={busy}
        onClose={() => setForm(null)}
        onSave={async vals => {
          if (!vals.item_name.trim()) { Alert.alert("Atik obligatwa", "Di ki atik ou bezwen."); return; }
          setBusy(true);
          try {
            const db = await getDb();
            const now = new Date().toISOString();
            const targetStore = scopeIds.includes(storeId) ? storeId : scopeIds[0] ?? storeId;
            if (form?.order?.id) {
              const o = form.order;
              const itemName = vals.item_name.trim();
              const qty = vals.qty;
              const unit = vals.unit?.trim() || null;
              const note = vals.note?.trim() || null;
              const supplierName = canManage ? (vals.supplier_name?.trim() || null) : (o.supplier_name ?? null);
              if (canManage) {
                await db.runAsync(
                  "UPDATE orders SET item_name = ?, qty = ?, unit = ?, supplier_name = ?, note = ?, updated_at = ?, dirty = 1 WHERE id = ?",
                  [itemName, qty, unit, supplierName, note, now, o.id]
                );
              } else {
                await db.runAsync(
                  "UPDATE orders SET item_name = ?, qty = ?, unit = ?, note = ?, updated_at = ?, dirty = 1 WHERE id = ?",
                  [itemName, qty, unit, note, now, o.id]
                );
              }
              await queueOrder("update", { ...o, item_name: itemName, qty, unit, supplier_name: supplierName, note, updated_at: now });
            } else {
              const id = uid();
              const rec: Order = {
                id, store_id: targetStore, item_name: vals.item_name.trim(), qty: vals.qty,
                unit: vals.unit?.trim() || null, supplier_name: canManage ? (vals.supplier_name?.trim() || null) : null,
                note: vals.note?.trim() || null, status: "requested",
                requested_by: myId, requested_by_name: myName, approved_by: null, created_at: now,
              };
              await db.runAsync(
                "INSERT INTO orders (id, store_id, item_name, qty, unit, supplier_name, note, requested_by, requested_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [id, targetStore, rec.item_name, rec.qty, rec.unit, rec.supplier_name, rec.note, myId, myName, now]
              );
              await queueOrder("create", { ...rec, created_at: now });
            }
            setForm(null);
            load();
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

function DRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 4 }}>{label}</Text>
      <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12 }}>
        <Text style={{ color: palette.ink, fontSize: 14 }}>{value}</Text>
      </View>
    </View>
  );
}

function BigBtn({ label, bg, onPress, disabled }: { label: string; bg: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ minHeight: 60, borderRadius: radius.md, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.6 : 1 }}
    >
      <Text style={{ fontWeight: "900", color: "#fff", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function OrderFormModal({ visible, order, canManage, saving, onClose, onSave }: {
  visible: boolean;
  order: Order | null;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (vals: { item_name: string; qty: number; unit: string; supplier_name: string; note: string }) => void;
}) {
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) {
      setItem(order?.item_name ?? "");
      setQty(String(order?.qty ?? 1));
      setUnit(order?.unit ?? "");
      setSupplier(order?.supplier_name ?? "");
      setNote(order?.note ?? "");
    }
  }, [visible, order]);

  const input = { minHeight: 56, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.surface, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 15, color: palette.ink } as any;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ maxHeight: "86%", backgroundColor: palette.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 }}>
          <Text style={{ fontSize: 18, fontWeight: "900", color: palette.ink, marginBottom: 12 }}>
            {order ? "Modifye demann" : "Nouvo demann stock"}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 6 }}>Atik *</Text>
            <TextInput value={item} onChangeText={setItem} placeholder="Ex: Diri 50kg, boutèy dlo…" placeholderTextColor={palette.muted2} style={[input, { marginBottom: 12 }]} />
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 6 }}>Kantite</Text>
                <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="1" placeholderTextColor={palette.muted2} style={input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 6 }}>Inite</Text>
                <TextInput value={unit} onChangeText={setUnit} placeholder="sak, bwat, kg…" placeholderTextColor={palette.muted2} style={input} />
              </View>
            </View>
            {canManage ? (
              <>
                <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 6 }}>Founisè sijere</Text>
                <TextInput value={supplier} onChangeText={setSupplier} placeholder="Non founisè…" placeholderTextColor={palette.muted2} style={[input, { marginBottom: 12 }]} />
              </>
            ) : null}
            <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink, marginBottom: 6 }}>Nòt</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Detay, ijans…" placeholderTextColor={palette.muted2} multiline style={[input, { minHeight: 84, paddingTop: 12, textAlignVertical: "top" }]} />
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={onClose}
              style={{ flex: 1, minHeight: 60, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontWeight: "900", color: palette.ink }}>Anile</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave({ item_name: item, qty: Math.max(1, Number(qty) || 1), unit, supplier_name: supplier, note })}
              disabled={saving}
              style={{ flex: 1, minHeight: 60, borderRadius: radius.md, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", opacity: saving ? 0.6 : 1 }}
            >
              <Text style={{ fontWeight: "900", color: "#fff" }}>{saving ? "Ap voye…" : order ? "Anrejistre" : "Voye demann"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
