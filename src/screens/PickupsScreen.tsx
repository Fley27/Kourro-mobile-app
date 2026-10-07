// Pickups — goods owed, deliberately separate from Transactions.
// A sale can be fully paid and still only partly collected: money is settled,
// goods are not. Transactions keeps handling money; this screen only handles
// what a customer still has left to physically collect from the store.
//
// List = every sale where at least one line still has
// `quantity − quantity_delivered > 0` (no separate flag — the balance IS the
// filter, so a settled sale drops out on its own). Detail logs one pickup per
// visit, validated so it can never exceed what is still owed, and appends to
// `sale_pickups` (one row per visit, multi-visit supported).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmt, monoStyle } from "../format";
import { useResponsive } from "../responsive";
import { useSalesEvents } from "../salesEvents";
import { listOpenPickups, findSaleForPickup, recordPickup, remainingOf, toNum } from "../pickup-staging/store";
import { uploadError } from "../components/UploadTransition";
import { saleLineLabel } from "../labels";
import { SkeletonCardRow } from "../components/Skeleton";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";
import { FALLBACK_STORE_ID } from "../db/ids";

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "juin", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];

function fmtDateHt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const mi = Math.min(12, Math.max(1, parseInt(m[2], 10)));
  return `${parseInt(m[3], 10)} ${HT_MONTHS[mi - 1]} ${m[1]}`;
}

/** "2025-07-14T18:03:11.000Z" → "14 juil 2025 · 18:03". */
function fmtWhen(iso: string): string {
  const d = new Date(String(iso ?? ""));
  if (!isFinite(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDateHt(d.toISOString().slice(0, 10))} · ${hh}:${mm}`;
}

/**
 * Quantity display: whole numbers read clean — "3", not "3,00". A comma only
 * appears when the quantity really is fractional ("1,5").
 */
function fmtQty(v: number | string | null | undefined): string {
  const n = Math.round(toNum(v) * 100) / 100;
  if (Number.isInteger(n)) return fmt(n, 0);
  const dec = n.toFixed(2).slice(-2).replace(/0$/, "");
  return `${fmt(Math.trunc(n), 0)},${dec}`;
}

type OpenRow = { sale: any; openItems: any[]; customer: any | null };
type Detail = { sale: any; items: any[]; history: any[]; customer: any | null };

export default function PickupsScreen({
  role = "cashier",
  currentUser,
  storeId,
  onBack,
  showBack = true,
}: {
  role?: string;
  currentUser?: any;
  storeId: string;
  onBack?: () => void;
  /** false when this screen IS the home (tab root) — no back chevron. */
  showBack?: boolean;
}) {
  const { padH, width, isTablet } = useResponsive();
  const [rows, setRows] = useState<OpenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  // Exact-ID hit that is fully settled: shown separately so anyone holding an
  // old receipt can still look it up after the balance hit zero.
  const [settledHit, setSettledHit] = useState<Detail | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [taken, setTaken] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    // Skeleton on first load only — after that the list stays put while a
    // reload (e.g. post-pickup refresh) resolves in the background.
    if (!loadedOnce.current) setLoading(true);
    try {
      // listOpenPickups is store-agnostic by design; scope it here with the
      // same rule findSaleForPickup uses (demo store id is a wildcard).
      const all = await listOpenPickups(storeId);
      const sid = String(storeId ?? "");
      setRows(all.filter(r => {
        const s = String(r.sale.store_id ?? "");
        return s === sid || s === FALLBACK_STORE_ID || sid === FALLBACK_STORE_ID;
      }));
    } catch {} finally { loadedOnce.current = true; setLoading(false); }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  // Live: a pickup recorded on another register must show up here.
  useSalesEvents(() => { load().catch(() => {}); });

  // Pinned search: filters the open list, and an exact id / sale_number also
  // resolves settled sales (that is the "look one up after the fact" path).
  const term = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return rows;
    return rows.filter(r =>
      String(r.sale.sale_number ?? "").toLowerCase().includes(term) ||
      String(r.sale.id ?? "").toLowerCase().includes(term) ||
      String(r.customer?.name ?? "").toLowerCase().includes(term) ||
      r.openItems.some((it: any) => saleLineLabel(it).toLowerCase().includes(term))
    );
  }, [rows, term]);

  useEffect(() => {
    let alive = true;
    if (!term) { setSettledHit(null); return; }
    (async () => {
      try {
        const found = await findSaleForPickup(storeId, q.trim());
        const open = !!found && found.items.some((it: any) => remainingOf(it) > 0);
        if (alive) setSettledHit(found && !open ? found : null);
      } catch { if (alive) setSettledHit(null); }
    })();
    return () => { alive = false; };
  }, [term, q, storeId]);

  async function openSale(idOrNumber: string) {
    try {
      const found = await findSaleForPickup(storeId, idOrNumber);
      if (!found) { Alert.alert("Pa jwenn", "Nimewo resi sa a pa egziste."); return; }
      setDetail(found);
      setTaken({});
    } catch (e: any) { Alert.alert("Erè", e?.message ?? String(e)); }
  }

  const remainingTotal = (items: any[]) => Math.round(items.reduce((s, it) => s + remainingOf(it), 0) * 100) / 100;
  const detailOpen = detail ? detail.items.filter(it => remainingOf(it) > 0) : [];
  const overAny = detailOpen.some(it => {
    const v = parseFloat(taken[it.id] ?? "");
    return !isNaN(v) && v > remainingOf(it);
  });
  const anyQty = detailOpen.some(it => (parseFloat(taken[it.id] ?? "") || 0) > 0);

  async function savePickup() {
    if (!detail) return;
    const map: Record<string, number> = {};
    for (const it of detailOpen) {
      const v = parseFloat(taken[it.id] ?? "");
      if (!isNaN(v) && v > 0) map[it.id] = v;
    }
    if (!Object.keys(map).length) { Alert.alert("Antre kantite", "Mete kantite k ap pran pou omwen yon atik."); return; }
    setSaving(true);
    try {
      await recordPickup({ storeId, saleId: detail.sale.id, taken: map, cashierId: currentUser?.id ?? null });
      const again = await findSaleForPickup(storeId, detail.sale.id);
      setDetail(again);
      setTaken({});
      await load();
    } catch (e: any) {
      uploadError("Pa anrejistre", e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  // --- detail ---------------------------------------------------------------
  if (detail) {
    const settled = remainingTotal(detail.items) <= 0;
    return (
      <KeyboardSafeScrollView style={{ flex: 1, backgroundColor: "#000" }} contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 4 }}>
          <Pressable onPress={() => { setDetail(null); setTaken({}); }} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>Pickup</Text>
            <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }}>{String(detail.sale.sale_number ?? detail.sale.id)}</Text>
          </View>
        </View>

        {/* Fraud SOFT check: a prompt, never a lock. Nothing is typed by the
            customer, and a walk-in sale (no customer on file) simply skips it. */}
        <View style={{ backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 16, marginTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#5e5ce6" />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>Verifye kiyès ki devan ou</Text>
          </View>
          {detail.customer ? (
            <>
              <Text style={{ color: "#fff", fontSize: 19, fontWeight: "700", marginTop: 10 }}>{String(detail.customer.name ?? "—")}</Text>
              {!!detail.customer.phone && <Text style={{ color: "#8e8e93", fontSize: 15, marginTop: 3 }}>{String(detail.customer.phone)}</Text>}
              <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 10, lineHeight: 19 }}>
                Èske non ak nimewo sa yo matche ak moun lan? Sa se yon ti rapèl sèlman — pa gen anyen pou kliyan an antre.
              </Text>
            </>
          ) : (
            <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 10 }}>
              Pa gen kliyan anrejistre sou vant sa a — kontinye nòmal.
            </Text>
          )}
        </View>

        <View style={{ backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 16, marginTop: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: "#8e8e93", fontSize: 14 }}>Dat vant</Text>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{fmtWhen(detail.sale.created_at ?? "")}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={{ color: "#8e8e93", fontSize: 14 }}>Total</Text>
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", ...monoStyle }}>{fmt(toNum(detail.sale.total), 2)} G</Text>
          </View>
        </View>

        {settled && (
          <View style={{ backgroundColor: "#10240f", borderWidth: 1, borderColor: "#2f80ed33", borderRadius: 14, padding: 14, marginTop: 12 }}>
            <Text style={{ color: "#7bd88f", fontSize: 15, fontWeight: "800" }}>Tout rete alkole — pa gen plis kolye sou vant sa a.</Text>
          </View>
        )}

        <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "800", letterSpacing: 0.6, marginTop: 20, marginBottom: 10 }}>ATIK</Text>
        {detail.items.map((it: any) => {
          const paid = toNum(it.quantity);
          const delivered = toNum(it.quantity_delivered ?? paid);
          const rem = Math.round(remainingOf(it) * 100) / 100;
          const raw = taken[it.id] ?? "";
          const v = parseFloat(raw);
          const bad = !isNaN(v) && v > rem;
          return (
            <View key={it.id} style={{ backgroundColor: "#141414", borderWidth: 1, borderColor: bad ? "#ff453a" : "#2b2b2b", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>{saleLineLabel(it)}</Text>
              <View style={{ flexDirection: "row", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                <Text style={{ color: "#8e8e93", fontSize: 14 }}>Achte <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{fmtQty(paid)}</Text></Text>
                <Text style={{ color: "#8e8e93", fontSize: 14 }}>Deja pran <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{fmtQty(delivered)}</Text></Text>
                <Text style={{ color: "#8e8e93", fontSize: 14 }}>Rete <Text style={{ color: rem > 0 ? "#7bd88f" : "#8e8e93", fontSize: 15, fontWeight: "800" }}>{fmtQty(rem)}</Text></Text>
              </View>
              {rem > 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kantite jodi a</Text>
                  <TextInput
                    value={raw}
                    onChangeText={t => setTaken(prev => ({ ...prev, [it.id]: t }))}
                    placeholder="0"
                    placeholderTextColor="#5a5a5e"
                    keyboardType="decimal-pad"
                    style={{ minWidth: 104, height: 50, borderWidth: 1, borderColor: bad ? "#ff453a" : "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center" }}
                  />
                  <Text style={{ color: "#8e8e93", fontSize: 13 }}>maks {fmtQty(rem)}</Text>
                </View>
              ) : (
                <View style={{ alignSelf: "flex-start", backgroundColor: "#1c1c1e", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginTop: 12 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "700" }}>Retire an antye</Text>
                </View>
              )}
              {bad && <Text style={{ color: "#ff453a", fontSize: 13, marginTop: 8 }}>Pa plis pase {fmtQty(rem)} — li rete {fmtQty(rem)}.</Text>}
            </View>
          );
        })}

        {!settled && (
          <Pressable
            onPress={savePickup}
            disabled={saving || overAny || !anyQty}
            style={{ marginTop: 6, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: saving || overAny || !anyQty ? "#1c1c1e" : "#fff" }}
          >
            <Text style={{ color: saving || overAny || !anyQty ? "#8e8e93" : "#000", fontSize: 17, fontWeight: "800" }}>
              {saving ? "Ap anrejistre…" : "✓ Anrejistre pickup"}
            </Text>
          </Pressable>
        )}

        {detail.history.length > 0 && (
          <>
            <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "800", letterSpacing: 0.6, marginTop: 24, marginBottom: 10 }}>ISTWA PICKUP</Text>
            {detail.history.map((h: any) => {
              const it = detail.items.find((x: any) => x.id === h.sale_item_id);
              // Delta row: a correction can push the stored quantity negative.
              const qty = toNum(h.quantity);
              const sign = qty < 0 ? "−" : "+";
              return (
                <View key={h.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#101010", borderWidth: 1, borderColor: "#1f1f1f", borderRadius: 12, padding: 14, marginBottom: 10 }}>
                  <Ionicons name="cube-outline" size={18} color="#8e8e93" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{saleLineLabel(it)}</Text>
                    <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 2 }}>{fmtWhen(h.created_at ?? "")}</Text>
                  </View>
                  <Text style={{ color: "#7bd88f", fontSize: 16, fontWeight: "800", ...monoStyle }}>{sign}{fmtQty(Math.abs(qty))}</Text>
                </View>
              );
            })}
          </>
        )}
      </KeyboardSafeScrollView>
    );
  }

  // --- list -----------------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ paddingHorizontal: padH, paddingTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {showBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.4 }}>Pickups</Text>
            <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }}>Byen kliyan pou pran — peye, poko rete</Text>
          </View>
        </View>

        {/* Pinned search — a customer walking in cold with just a receipt. */}
        <View style={{ height: 54, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 27, paddingHorizontal: 16, marginTop: 14 }}>
          <Ionicons name="search" size={20} color="#8e8e93" style={{ marginRight: 10 }} />
          <TextInput
            placeholder="Chèche nimewo resi…"
            placeholderTextColor="#8e8e93"
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            style={{ flex: 1, color: "#fff", fontSize: 16 }}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: "#8e8e93", fontSize: 14, fontWeight: "600" }}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: padH, paddingTop: 14, paddingBottom: 28 }}>
        {settledHit && (
          <Pressable onPress={() => openSale(String(settledHit.sale.id))} style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#2f80ed55", backgroundColor: "#0e1626", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <Ionicons name="receipt-outline" size={22} color="#2f80ed" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", ...monoStyle }}>{String(settledHit.sale.sale_number ?? settledHit.sale.id)}</Text>
              <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 3 }}>{String(settledHit.customer?.name ?? "Kliyan anekenn")} · paye/retire an antye</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
          </Pressable>
        )}

        {loading ? (
          <View style={{ paddingTop: 16 }}>
            <SkeletonCardRow />
            <SkeletonCardRow />
            <SkeletonCardRow />
            <SkeletonCardRow />
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ paddingTop: 48, alignItems: "center", paddingHorizontal: 20 }}>
            <Ionicons name="bag-check-outline" size={46} color="#3a3a3c" />
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", marginTop: 14 }}>
              {term ? "Pa gen rezilta." : "Pa gen kolye rete."}
            </Text>
            <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
              {term
                ? "Chèche yon lòt nimewo resi."
                : "Tout kliyan yo fin pran tout byen yo te peye a."}
            </Text>
          </View>
        ) : (
          filtered.map(r => {
            const rem = remainingTotal(r.openItems);
            return (
              <Pressable
                key={String(r.sale.id)}
                onPress={() => openSale(String(r.sale.id))}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 16, marginBottom: 12 }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1c1c1e", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="bag-handle-outline" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", ...monoStyle }}>{String(r.sale.sale_number ?? r.sale.id)}</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 3 }} numberOfLines={1}>
                    {String(r.customer?.name ?? "Kliyan anekenn")} · {fmtDateHt(String(r.sale.created_at ?? "").slice(0, 10))}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#7bd88f", fontSize: 17, fontWeight: "800", ...monoStyle }}>{fmtQty(rem)}</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 1 }}>rete</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
              </Pressable>
            );
          })
        )}
      </KeyboardSafeScrollView>
    </View>
  );
}
