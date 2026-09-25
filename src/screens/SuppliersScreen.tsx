// Suppliers (Founisè) — dark reference design, structurally identical to
// CustomersScreen: same pill list, same full-screen profile, same menu —
// with Batches in place of Transactions.
// Owner: everything (incl. bank_info, delete, all stores).
// Admin: view/create/edit basic fields only; bank_info stays masked and is
// never overwritten by admin edits. Other roles never reach this screen.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, Modal, Alert } from "react-native";
import { useResponsive } from "../responsive";
import type { Role } from "../users";
import { getDb, insertOutbox } from "../db";
import { fmtG } from "../format";
import { SuppliersPhone } from "./SuppliersPhone";
import { SuppliersTablet } from "./SuppliersTablet";
import { CustomerProfileHeader, ProfileMenu } from "../components/CustomerProfile";
import {
  SupplierProfileBody,
  SupplierBatchesList,
  SupplierBatchDetailBody,
  batchStatusLabel,
  type SupplierStats,
} from "../components/SupplierProfile";
import {
  NewSupplierSheet,
  EditSupplierContent,
  supplierToFormValues,
  type EditSupplierState,
  type SupplierFormValues,
} from "../components/SupplierSheets";

export type Supplier = {
  id: string;
  store_id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  bank_info?: string | null;
  notes?: string | null;
  created_at?: string;
};

type BatchDetail = { batch: any; itemLabel: string | null; productName: string | null };

type Props = {
  role?: Role;
  currentUser?: any;
  storeId: string;
  storeName?: string;
  userStoreIds?: string[];
  stores?: { id: string; name: string }[];
};

const uid = () => `sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const byName = (a: any, b: any) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""));

export default function SuppliersScreen({ role = "cashier", storeId }: Props) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [batchCounts, setBatchCounts] = useState<Record<string, { count: number; total: number }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [supplierBatches, setSupplierBatches] = useState<any[]>([]);
  const [profileStats, setProfileStats] = useState<SupplierStats>({ batches: 0, lastBatch: null, firstBatch: null });
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [showEdit, setShowEdit] = useState(false);
  const [editState, setEditState] = useState<EditSupplierState>({ data: null, valid: false });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showBatchOnly, setShowBatchOnly] = useState(false);
  const [showAllBatches, setShowAllBatches] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  // Detail views share one ScrollView — reset offset on every view change
  // so a new view never opens pre-scrolled.
  const detailScroll = useRef<any>(null);
  useEffect(() => {
    detailScroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedId, batchDetail, showAllBatches, showEdit]);

  const isOwner = role === "owner";
  const canWrite = isOwner || role === "admin";
  const { width, isTablet, isLandscape, padH } = useResponsive();
  // Master-detail shows in portrait; landscape tablets use phone layout.
  const showTablet = isTablet && !isLandscape;

  async function load() {
    try {
      const db = await getDb();
      const raw = (await db.getAllAsync("SELECT * FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => [])) as any[];
      const all = Array.from(new Map(raw.map((s: any) => [s.id, s] as const)).values()).sort(byName);
      setSuppliers(all);
      const bs = ((await db.getAllAsync("SELECT * FROM batches").catch(() => [])) ?? []) as any[];
      const counts: Record<string, { count: number; total: number }> = {};
      for (const b of bs) {
        const k = String(b?.supplier_id ?? "");
        if (!k) continue;
        const c = counts[k] ?? { count: 0, total: 0 };
        c.count += 1;
        c.total += Number(b?.total_paid ?? 0);
        counts[k] = c;
      }
      setBatchCounts(counts);
    } catch (e) {
      console.log("[Suppliers load] failed:", e);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedId) {
      setSupplierBatches([]);
      setProfileStats({ batches: 0, lastBatch: null, firstBatch: null });
      setBatchDetail(null);
      setShowAllBatches(false);
      setShowEdit(false);
      setShowProfileMenu(false);
      return;
    }
    setBatchDetail(null);
    setShowAllBatches(false);
    setShowEdit(false);
    setShowProfileMenu(false);
    (async () => {
      try {
        const db = await getDb();
        const rows = (((await db.getAllAsync("SELECT * FROM batches WHERE supplier_id = ?", [selectedId]).catch(() => [])) ?? []) as any[])
          .slice()
          .sort((a: any, b: any) =>
            String(b?.date ?? b?.updated_at ?? b?.created_at ?? "").localeCompare(String(a?.date ?? a?.updated_at ?? a?.created_at ?? ""))
          );
        setSupplierBatches(rows);
        const dates = rows.map(r => r?.date ?? r?.created_at).filter(Boolean);
        setProfileStats({
          batches: rows.length,
          lastBatch: dates[0] ?? null,
          firstBatch: dates[dates.length - 1] ?? null,
        });
      } catch (e) {
        console.log("[Suppliers batches] failed:", e);
      }
    })();
  }, [selectedId]);

  const selectedSupplier = suppliers.find(s => s.id === selectedId) ?? null;

  const displaySuppliers = useMemo(() => {
    let list = [...suppliers];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(s =>
        (s.name ?? "").toLowerCase().includes(q)
        || (s.phone ?? "").toLowerCase().includes(q)
        || (s.address ?? "").toLowerCase().includes(q)
        || (s.payment_terms ?? "").toLowerCase().includes(q)
      );
    }
    if (showBatchOnly) {
      list = list.filter(s => (batchCounts[s.id]?.count ?? 0) > 0);
    }
    return list;
  }, [suppliers, batchCounts, showBatchOnly, search]);

  function openBatch(b: any) {
    // Open instantly with what we have; item + product name fill in.
    setBatchDetail({ batch: b, itemLabel: null, productName: null });
    (async () => {
      try {
        const db = await getDb();
        const items = ((await db.getAllAsync("SELECT * FROM items WHERE id = ?", [b?.item_id]).catch(() => [])) ?? []) as any[];
        const item = items[0] ?? null;
        let productName: string | null = null;
        if (item?.product_id) {
          const prods = ((await db.getAllAsync("SELECT * FROM products WHERE id = ?", [item.product_id]).catch(() => [])) ?? []) as any[];
          productName = prods[0]?.name ?? null;
        }
        setBatchDetail({ batch: b, itemLabel: item?.name ?? null, productName });
      } catch {}
    })();
  }

  async function handleAdd(vals: SupplierFormValues) {
    if (!canWrite) return Alert.alert("Pa gen dwa", "Ou pa ka kreye nouvo founisè.");
    if (!vals.name.trim()) return Alert.alert("Non obligatwa", "Bay founisè a yon non.");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const db = await getDb();
      const id = uid();
      const rec = {
        id,
        store_id: storeId,
        name: vals.name.trim(),
        phone: vals.phone.trim() || null,
        address: vals.address.trim() || null,
        payment_terms: vals.payment_terms.trim() || null,
        bank_info: isOwner ? (vals.bank_info.trim() || null) : null,
        notes: vals.notes.trim() || null,
        created_at: now,
        updated_at: now,
        is_deleted: 0,
      };
      await db.runAsync(
        "INSERT INTO suppliers (id, store_id, name, phone, address, payment_terms, bank_info, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [rec.id, rec.store_id, rec.name, rec.phone, rec.address, rec.payment_terms, rec.bank_info, rec.notes, now]
      );
      try { await insertOutbox("suppliers", "create", { ...rec, is_deleted: false, lamport_clock: Date.now() }); } catch {}
      setSuppliers(prev => (prev.some(s => s.id === rec.id) ? prev : [rec, ...prev].sort(byName)));
      setShowAdd(false);
      setSelectedId(rec.id);
      Alert.alert("Founisè ajoute", `${rec.name} anrejistre.${rec.phone ? ` Telefòn: ${rec.phone}` : " Pa gen nimewo telefòn"}${rec.address ? ` · Adrès: ${rec.address}` : ""}`);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Ajoute founisè echwe");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const vals = editState.data;
    if (!selectedSupplier || !vals) return;
    if (!canWrite) return Alert.alert("Pa gen dwa", "Ou pa ka modifye dosye founisè.");
    if (!vals.name.trim()) return Alert.alert("Non obligatwa", "Bay founisè a yon non.");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const db = await getDb();
      const id = selectedSupplier.id;
      const patch = {
        name: vals.name.trim(),
        phone: vals.phone.trim() || null,
        address: vals.address.trim() || null,
        payment_terms: vals.payment_terms.trim() || null,
        notes: vals.notes.trim() || null,
      };
      const bank = isOwner ? (vals.bank_info.trim() || null) : undefined;
      if (isOwner) {
        await db.runAsync(
          "UPDATE suppliers SET name = ?, phone = ?, address = ?, payment_terms = ?, bank_info = ?, notes = ?, updated_at = ?, dirty = 1 WHERE id = ?",
          [patch.name, patch.phone, patch.address, patch.payment_terms, bank, patch.notes, now, id]
        );
      } else {
        // Admin: basic fields only — bank_info untouched.
        await db.runAsync(
          "UPDATE suppliers SET name = ?, phone = ?, address = ?, payment_terms = ?, notes = ?, updated_at = ?, dirty = 1 WHERE id = ?",
          [patch.name, patch.phone, patch.address, patch.payment_terms, patch.notes, now, id]
        );
      }
      const nextBank = isOwner ? bank : (selectedSupplier.bank_info ?? null);
      try {
        await insertOutbox("suppliers", "update", { id, ...patch, bank_info: nextBank, updated_at: now, is_deleted: false, lamport_clock: Date.now() });
      } catch {}
      setSuppliers(prev => prev.map(s => (s.id === id ? { ...s, ...patch, bank_info: nextBank, updated_at: now } : s)));
      setShowEdit(false);
      Alert.alert("Founisè mete ajou", "Chanjman yo anrejistre nan dosye founisè a.");
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete founisè ajou echwe");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(rec: any) {
    if (!isOwner) return Alert.alert("Pa gen dwa", "Se sèlman Owner ka efase yon founisè.");
    Alert.alert("Efase founisè?", rec.name, [
      { text: "Anile", style: "cancel" },
      {
        text: "Efase",
        style: "destructive",
        onPress: async () => {
          const now = new Date().toISOString();
          setSelectedId(null);
          try {
            const db = await getDb();
            await db.runAsync("UPDATE suppliers SET is_deleted = 1, dirty = 1, updated_at = ? WHERE id = ?", [now, rec.id]);
          } catch {
            try { const db = await getDb(); await db.runAsync("DELETE FROM suppliers WHERE id = ?", [rec.id]); } catch {}
          }
          try { await insertOutbox("suppliers", "update", { ...rec, is_deleted: true, updated_at: now, lamport_clock: Date.now() }); } catch {}
          load();
        },
      },
    ]);
  }

  const menuOptions = [
    ...(canWrite ? [{ label: "Modifye", onPress: () => setShowEdit(true) }] : []),
    ...(isOwner && selectedSupplier ? [{ label: "Efase", onPress: () => confirmDelete(selectedSupplier) }] : []),
  ];
  const canOpenMenu = !showEdit && !batchDetail && !showAllBatches && menuOptions.length > 0;

  const headerTitle = showEdit
    ? "Modifye founisè"
    : batchDetail
      ? `${fmtG(Number(batchDetail.batch?.total_paid ?? 0))} | ${batchStatusLabel(batchDetail.batch?.status)}`
      : showAllBatches ? "Batches" : undefined;

  const body = showEdit && selectedSupplier ? (
    <EditSupplierContent
      resetKey={selectedSupplier.id}
      visible={showEdit}
      initial={supplierToFormValues(selectedSupplier)}
      isOwner={isOwner}
      onState={setEditState}
    />
  ) : batchDetail ? (
    <SupplierBatchDetailBody
      batch={batchDetail.batch}
      itemLabel={batchDetail.itemLabel}
      productName={batchDetail.productName}
    />
  ) : showAllBatches ? (
    <SupplierBatchesList batches={supplierBatches} onOpenBatch={openBatch} />
  ) : selectedSupplier ? (
    <SupplierProfileBody
      supplier={selectedSupplier}
      stats={profileStats}
      batches={supplierBatches}
      onOpenBatch={openBatch}
      onViewAll={() => setShowAllBatches(true)}
      isOwner={isOwner}
    />
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: showTablet ? "#F8F9FA" : "#000", alignItems: showTablet ? "center" : undefined }}>
      {showTablet ? (
        <SuppliersTablet
          suppliers={suppliers}
          displaySuppliers={displaySuppliers}
          batchCounts={batchCounts}
          search={search}
          setSearch={setSearch}
          showBatchOnly={showBatchOnly}
          setShowBatchOnly={setShowBatchOnly}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          selectedSupplier={selectedSupplier}
          canManageSuppliers={canWrite}
          isOwner={isOwner}
          onOpenMenu={() => setShowProfileMenu(true)}
          showProfileMenu={showProfileMenu}
          onCloseMenu={() => setShowProfileMenu(false)}
          onOpenEdit={() => setShowEdit(true)}
          onDelete={selectedSupplier ? () => confirmDelete(selectedSupplier) : undefined}
          onOpenBatch={openBatch}
          showEdit={showEdit}
          onCloseEdit={() => setShowEdit(false)}
          showAllBatches={showAllBatches}
          setShowAllBatches={setShowAllBatches}
          editState={editState}
          setEditState={setEditState}
          onSaveEdit={handleSave}
          saving={saving}
          batchDetail={batchDetail}
          setBatchDetail={setBatchDetail}
          profileStats={profileStats}
          profileBatches={supplierBatches}
          onAdd={canWrite ? () => { setAddKey(k => k + 1); setShowAdd(true); } : undefined}
          padH={padH}
          width={width}
          isTablet={isTablet}
        />
      ) : (
        <SuppliersPhone
          suppliers={suppliers}
          displaySuppliers={displaySuppliers}
          search={search}
          setSearch={setSearch}
          showBatchOnly={showBatchOnly}
          setShowBatchOnly={setShowBatchOnly}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onAdd={canWrite ? () => { setAddKey(k => k + 1); setShowAdd(true); } : undefined}
          padH={padH}
          width={width}
          isTablet={isTablet}
        />
      )}

      {selectedSupplier && (
        <Modal visible={!!selectedSupplier && !showTablet} transparent={false} animationType="slide" onRequestClose={() => setSelectedId(null)}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: 60 }}>
            <CustomerProfileHeader
              onBack={() => {
                if (showEdit) setShowEdit(false);
                else if (batchDetail) setBatchDetail(null);
                else if (showAllBatches) setShowAllBatches(false);
                else setSelectedId(null);
              }}
              backIcon={showEdit || batchDetail ? "close" : "back"}
              title={headerTitle}
              onMenu={canOpenMenu ? () => setShowProfileMenu(true) : undefined}
              headerAction={showEdit ? (
                <Pressable
                  onPress={handleSave}
                  disabled={!editState.valid || saving}
                  style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: editState.valid && !saving ? "#fff" : "#2b2b2b", opacity: saving ? 0.7 : 1 }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 15, color: editState.valid && !saving ? "#000" : "#6e6e73" }}>{saving ? "…" : "Save"}</Text>
                </Pressable>
              ) : undefined}
            />
            <ScrollView ref={detailScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
              {body}
            </ScrollView>
            {showProfileMenu && selectedSupplier ? (
              <ProfileMenu
                onClose={() => setShowProfileMenu(false)}
                top={122}
                right={18}
                options={menuOptions}
              />
            ) : null}
          </View>
        </Modal>
      )}

      <NewSupplierSheet
        visible={showAdd}
        resetKey={addKey}
        onClose={() => setShowAdd(false)}
        onSave={handleAdd}
        saving={saving}
        isOwner={isOwner}
      />
    </View>
  );
}
