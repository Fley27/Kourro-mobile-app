// CouponWizard — issue a single-use coupon, from two entry points:
//  • proformat mode: customer + proformat given; the proformat's profit scope
//    is shown live here as an issuance-time estimate.
//  • direct mode: phone resolution first (no proformat).
// In BOTH modes the amount is calculated when the customer pays (% of the
// cart's profit), and the outreach message never carries a goud figure —
// only the condition (the configured minimum), the code and the expiry.
// Roles: any seller can issue FROM a proformat; only owner/admin/manager may
// create a NEW rabais (opened from the proformat screen).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, TextInput, Alert, Share, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { fmtG } from "../../format";
import { uploadError } from "../../components/UploadTransition";
import { resolveCustomerByPhone } from "../../sales/customers";
import { useSaleCatalog } from "../../picker/useSaleCatalog";
import { useSaleRows, groupSaleRows, usePendingLine } from "../../picker/hooks";
import { SearchHeader, PendingCard } from "../../picker/phone";
import { VariantGroupCard } from "../../picker/group";
import { ScanSheet } from "../../components/ScanSheet";
import { ProductsEmpty, type SearchMode } from "../../screens/POSShared";
import {
  EXPIRY_PRESETS, type Coupon, type CouponMin, type CouponType,
  type Discount, type PromoActor, type Proformat,
} from "../../promos/types";
import {
  createDiscount, issueCoupon, listDiscounts, proformatScopeProfit, sleepyProducts, type SleepyProduct,
} from "../../promos/promosModel";
import { amountFromProfit } from "../../promos/promoMath";
import { Chip, LabeledInput, PrimaryButton, PromoCard, PromoHeader, SectionLabel, fmtWhen } from "./promoUi";
import { SafeScreen } from "../../components/SafeScreen";
import { KeyboardSafeView } from "../../components/KeyboardSafe";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

type ResolvedCustomer = { id: string; name: string; phone?: string | null; prospect?: boolean };

export default function CouponWizard({
  visible,
  onClose,
  storeId,
  deviceId,
  actor,
  mode,
  proformat = null,
  customer = null,
  onIssued,
}: {
  visible: boolean;
  onClose: () => void;
  storeId: string;
  deviceId?: string;
  actor: PromoActor;
  mode: "proformat" | "direct";
  proformat?: Proformat | null;
  customer?: ResolvedCustomer | null;
  onIssued?: (coupon: Coupon) => void;
}) {
  const canManage = ["owner", "admin", "manager"].includes(actor.role);
  const [step, setStep] = useState<"customer" | "form" | "done">("form");
  // Customer (direct mode only — proformat mode inherits the record's customer)
  const [phone, setPhone] = useState("");
  const [custName, setCustName] = useState("");
  const [resolved, setResolved] = useState<ResolvedCustomer | null>(null);
  const [resolving, setResolving] = useState(false);
  // Discount
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPct, setNewPct] = useState("");
  const [creatingDiscount, setCreatingDiscount] = useState(false);
  // Coupon shape
  const [type, setType] = useState<CouponType>("unconditional");
  const [sleepy, setSleepy] = useState<SleepyProduct[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [minAmount, setMinAmount] = useState("");
  const [minItems, setMinItems] = useState("");
  const [cap, setCap] = useState("");
  const [expiryDays, setExpiryDays] = useState(7);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<Coupon | null>(null);
  const formScroll = useRef<ScrollView>(null);

  // ── Conditional-requirement picker — the checkout stack, same wiring as
  // POS and the proformat build screen (search + hero stepper + card rows). ──
  const [searchState, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [showScan, setShowScan] = useState(false);
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({});
  const entrance = useRef(new Animated.Value(1)).current;
  const { products, catNames, pricing, minFactorMap, variantSales, loaded: catalogLoaded } = useSaleCatalog(visible);
  const rows = useSaleRows({ products, pricing, minFactorMap, catNames, search: searchState, variantSales });
  const { pending, setPending, pendingInput, setPendingInput, pendingLine, pendingMaxQ,
    handleProductPress, adjustPending, setPendingCustom, commitPendingWithInput, clearPending } = usePendingLine({
      pricing,
      minFactorMap,
      // A committed hero merges into the requirement map (product-level qty).
      onCommit: (p, q) => {
        setPicked(prev => ({ ...prev, [p.id]: Math.min(99, (prev[p.id] ?? 0) + Math.max(1, q)) }));
        setPickedNames(prev => ({ ...prev, [p.id]: String(p.name ?? "") }));
      },
      onRowPress: () => setSearch(""),
    });

  const finalCustomer: ResolvedCustomer | null = customer ?? resolved;

  // Fresh state on every open — a wizard never carries the last coupon over.
  useEffect(() => {
    if (!visible) return;
    setStep(customer || mode === "proformat" ? "form" : "customer");
    setPhone(""); setCustName(""); setResolved(customer ?? null);
    setSelectedId(null); setNewPct(""); setType("unconditional"); setPicked({}); setPickedNames({});
    setMinAmount(""); setMinItems(""); setCap(""); setExpiryDays(7);
    setSearch(""); setSearchMode("name"); setShowScan(false); setPending(null);
    setIssued(null); setIssuing(false); setCreatingDiscount(false); setResolving(false);
    (async () => {
      try {
        const db = await getDb();
        const list = await listDiscounts(db, storeId);
        setDiscounts(list);
        if (list.length) setSelectedId(list[0].id);
      } catch {}
      try {
        const db = await getDb();
        setSleepy(await sleepyProducts(db));
      } catch {}
    })();
  }, [visible]);

  const selectedDiscount = discounts.find(d => String(d.id) === String(selectedId)) ?? null;

  const min: CouponMin = useMemo(() => {
    const reqs = type === "conditional"
      ? Object.entries(picked)
          .filter(([, q]) => Number(q) > 0)
          .map(([pid, q]) => ({
            product_id: pid,
            name: pickedNames[pid] ?? sleepy.find(x => x.product_id === pid)?.name ?? "",
            qty: Number(q),
          }))
      : [];
    const amount = Number(minAmount) || 0;
    const items = Number(minItems) || 0;
    return {
      ...(reqs.length ? { products: reqs } : {}),
      // The product list with quantities IS the full condition — a typed
      // minimum must never ride along once specific products are attached.
      ...(!reqs.length && amount > 0 ? { min_amount: amount } : {}),
      ...(!reqs.length && items > 0 ? { min_items: items } : {}),
    };
  }, [type, picked, pickedNames, minAmount, minItems, sleepy]);

  const capNum = Number(cap) || 0;

  // Percentage in effect right now: the "Nouvo %" being typed wins the moment
  // it's a valid number, otherwise the selected discount.
  const pendingPct = Number(newPct);
  const effectivePct =
    Number.isFinite(pendingPct) && pendingPct > 0 && pendingPct < 100
      ? pendingPct
      : selectedDiscount
        ? Number(selectedDiscount.percentage)
        : null;

  // Issuance-time estimate of what issueCoupon will make possible — same
  // scope, same cap, same rounding. The real figure is calculated at payment.
  function goudForPct(pct: number): number | null {
    if (mode !== "proformat" || !proformat || !Number.isFinite(pct)) return null;
    const profit = proformatScopeProfit(proformat, { type, min });
    return amountFromProfit(pct, profit, capNum > 0 ? capNum : null);
  }

  const scopeProfit = mode === "proformat" && proformat ? proformatScopeProfit(proformat, { type, min }) : 0;

  // ── Requirement picker lists: empty search = the sleepy top-5 (stock
  // desc, order fixed by sleepyProducts); typing searches the full catalog
  // exactly like checkout. ─────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    if (searchState.trim()) return rows;
    const order = new Map(sleepy.map((s, i) => [s.product_id, i]));
    const ids = new Set(order.keys());
    return rows
      .filter(r => ids.has(r.product.id))
      .sort((a, b) => (order.get(a.product.id) ?? 99) - (order.get(b.product.id) ?? 99));
  }, [rows, sleepy, searchState]);
  const groups = useMemo(() => groupSaleRows(visibleRows, catNames), [visibleRows, catNames]);

  function decReq(key: string) {
    const row = rows.find(r => r.key === key) ?? visibleRows.find(r => r.key === key);
    const pid = row?.product.id ?? key.split("|")[0];
    setPicked(prev => {
      const next: Record<string, number> = { ...prev };
      const q = (Number(next[pid]) || 0) - 1;
      if (q > 0) next[pid] = q; else delete next[pid];
      return next;
    });
  }
  function removeReq(pid: string) {
    setPicked(prev => { const next = { ...prev }; delete next[pid]; return next; });
  }
  function firstRowFor(productId: string) {
    return rows.find(r => r.product.id === productId) ?? null;
  }
  function onBarcodeSubmit() {
    const t = searchState.trim();
    if (!t) return;
    const found = products.find(p => String(p.barcode ?? "").toLowerCase() === t.toLowerCase() || String(p.sku ?? "").toLowerCase() === t.toLowerCase());
    const row = found ? firstRowFor(found.id) : null;
    if (found && row) handleProductPress(row);
    else Alert.alert("Pa jwenn", `Pa gen pwodwi ak kòd ${t}`);
  }
  function simulateScan() {
    const top = sleepy.length ? products.find(p => p.id === sleepy[0].product_id) : products[0];
    const row = top ? firstRowFor(top.id) : null;
    if (top && row) { handleProductPress(row); setShowScan(false); }
  }

  const flatPreview = useMemo(() => {
    if (effectivePct == null) return null;
    return goudForPct(effectivePct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, proformat, effectivePct, type, min, capNum]);

  async function resolveCustomer() {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 7) { Alert.alert("Telefòn obligatwa", "Antre yon nimewo telefòn valab."); return; }
    setResolving(true);
    try {
      const db = await getDb();
      const r = await resolveCustomerByPhone(db, storeId, { phone: digits, name: custName.trim() });
      setResolved({ id: String(r.customer.id), name: String(r.customer.name ?? ""), phone: r.customer.phone ?? null, prospect: !!r.customer.is_prospect });
      setStep("form");
    } catch (e: any) {
      uploadError(e?.title ?? "Pa jwenn kliyan", e?.message ?? String(e));
    } finally { setResolving(false); }
  }

  async function createNewDiscount() {
    const pct = Number(newPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      Alert.alert("Pri valab", "Antre yon pousantrap ant 1 ak 99.");
      return;
    }
    setCreatingDiscount(true);
    try {
      const db = await getDb();
      const d = await createDiscount(db, { storeId, deviceId, actor, percentage: pct });
      setDiscounts(prev => [d, ...prev]);
      setSelectedId(String(d.id));
      setNewPct("");
    } catch (e: any) {
      uploadError(e?.title ?? "Erè", e?.message ?? String(e));
    } finally { setCreatingDiscount(false); }
  }

  async function issue() {
    if (!finalCustomer) { setStep("customer"); return; }
    if (!selectedDiscount) { Alert.alert("Rabais obligatwa", "Chwazi oswa kreye yon rabais."); return; }
    if (type === "conditional" && !Object.values(picked).some(q => Number(q) > 0)) {
      Alert.alert("Kondisyon obligatwa", "Chwazi omwen yon pwodwi ak kantite pou koupon kondisyone.");
      return;
    }
    setIssuing(true);
    try {
      const db = await getDb();
      const coupon = await issueCoupon(db, {
        storeId, deviceId, actor,
        customerId: finalCustomer.id,
        customerName: finalCustomer.name,
        discount: selectedDiscount,
        type,
        min: Object.keys(min).length ? min : null,
        cap: capNum > 0 ? capNum : null,
        expiryDays,
        proformat: mode === "proformat" ? proformat : null,
      });
      setIssued(coupon);
      setStep("done");
      onIssued?.(coupon);
    } catch (e: any) {
      uploadError(e?.title ?? "Erè", e?.message ?? String(e));
    } finally { setIssuing(false); }
  }

  // ── Customer step (direct mode) ──────────────────────────────────────────
  if (step === "customer") {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardSafeView>
        <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
          <KeyboardSafeScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <PromoHeader title="Nouvo koupon" subtitle="Chèche kliyan an pa telefòn" onBack={onClose} />
            <PromoCard>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 4 }}>Telefòn kliyan an</Text>
              <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 10 }}>
                Si nimewo a deja egziste, kont ki gen dènye dat la genyen. Sinon yon nouvo kont pwospèk kreye.
              </Text>
              <TextInput
                value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                placeholder="3712 3456" placeholderTextColor="#5a5a5e"
                style={{ minHeight: 54, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 14, color: "#fff", fontSize: 18, backgroundColor: "#0a0a0a", marginBottom: 12 }}
              />
              <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "700", marginBottom: 6 }}>Non kliyan an (si li pa egziste)</Text>
              <TextInput
                value={custName} onChangeText={setCustName} placeholder="Premè non · Dènye non"
                placeholderTextColor="#5a5a5e"
                style={{ minHeight: 54, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 14, color: "#fff", fontSize: 16, backgroundColor: "#0a0a0a" }}
              />
            </PromoCard>
            <PrimaryButton label={resolving ? "Ap chèche…" : "Kontinye"} busy={resolving} onPress={resolveCustomer} />
          </KeyboardSafeScrollView>
        </SafeScreen>
      
      </KeyboardSafeView>
    </Modal>
    );
  }

  // ── Done step ────────────────────────────────────────────────────────────
  if (step === "done" && issued) {
    const msg = String(issued.message ?? "");
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
          <KeyboardSafeScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
            <PromoHeader title="Koupon kreye ✓" subtitle={finalCustomer?.name ?? ""} onBack={onClose} />
            <PromoCard tone="good" style={{ alignItems: "center", paddingVertical: 26 }}>
              <Ionicons name="ticket-outline" size={30} color="#4da3e0" />
              <Text style={{ color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: 1.5, marginTop: 12 }}>{issued.code}</Text>
              <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 6 }}>
                esanplè • ekspire {fmtWhen(issued.expires_at)}
              </Text>
            </PromoCard>
            <SectionLabel>MESSAJ PATAJE</SectionLabel>
            <PromoCard>
              <Text style={{ color: "#fff", fontSize: 15, lineHeight: 22 }}>{msg}</Text>
            </PromoCard>
            <PrimaryButton
              label="Pataje mesaj la"
              onPress={async () => {
                try { await Share.share({ message: msg }); } catch {}
              }}
            />
            <PrimaryButton
              label="Kreye yon lòt"
              tone="ghost"
              onPress={() => {
                setIssued(null); setType("unconditional"); setPicked({}); setPickedNames({});
                setSearch(""); setPending(null);
                setMinAmount(""); setMinItems(""); setCap(""); setExpiryDays(7);
                setStep(customer || mode === "proformat" ? "form" : "customer");
                if (mode === "direct") { setResolved(null); setPhone(""); setCustName(""); }
              }}
            />
            <PrimaryButton label="Fèmen" tone="ghost" onPress={onClose} />
          </KeyboardSafeScrollView>
        </SafeScreen>
      </Modal>
    );
  }

  // ── Form step ────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardSafeView>
      <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
        <KeyboardSafeScrollView ref={formScroll} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <PromoHeader
            title={mode === "proformat" ? "Koupon pou proformat" : "Nouvo koupon"}
            subtitle={mode === "proformat" && proformat ? `Resi ${proformat.receipt_number}` : "Koupon dirèk"}
            onBack={onClose}
          />

          {finalCustomer ? (
            <PromoCard>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", flex: 1 }} numberOfLines={1}>{finalCustomer.name}</Text>
                {finalCustomer.prospect ? (
                  <View style={{ backgroundColor: "#7a5c00", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: "#ffd60a", fontSize: 10, fontWeight: "700" }}>PWOSPÈK</Text>
                  </View>
                ) : null}
              </View>
              {!!finalCustomer.phone ? <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>{String(finalCustomer.phone)}</Text> : null}
            </PromoCard>
          ) : null}

          {/* ── Rabais ── */}
          <SectionLabel style={{ marginTop: 6 }}>RABAIS</SectionLabel>
          <PromoCard>
            {discounts.map(d => (
              <Pressable
                key={String(d.id)}
                onPress={() => setSelectedId(String(d.id))}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderColor: "#262626" }}
              >
                <Ionicons name={String(selectedId) === String(d.id) ? "radio-button-on" : "radio-button-off"} size={20} color={String(selectedId) === String(d.id) ? "#4da3e0" : "#8e8e93"} />
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginLeft: 10 }}>{Number(d.percentage)}%</Text>
                <Text style={{ color: "#5a5a5e", fontSize: 12, marginLeft: 8 }}>{d.created_at ? fmtWhen(d.created_at) : ""}</Text>
              </Pressable>
            ))}
            {!discounts.length ? (
              <Text style={{ color: "#8e8e93", fontSize: 14, paddingVertical: 6 }}>Pa gen rabais ankò.</Text>
            ) : null}
            {canManage ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <TextInput
                    value={newPct} onChangeText={t => setNewPct(t.replace(/[^0-9.]/g, "").slice(0, 5))}
                    placeholder="Nouvo %" placeholderTextColor="#5a5a5e" keyboardType="decimal-pad"
                    style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, paddingHorizontal: 12, color: "#fff", fontSize: 16, backgroundColor: "#0a0a0a" }}
                  />
                  <Pressable
                    onPress={creatingDiscount ? undefined : createNewDiscount}
                    style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 10, backgroundColor: newPct.trim() ? "#fff" : "#1c1c1e", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: newPct.trim() ? "#000" : "#8e8e93", fontWeight: "800", fontSize: 14 }}>{creatingDiscount ? "…" : "Kreye"}</Text>
                  </Pressable>
                </View>
                {mode === "proformat" && Number.isFinite(pendingPct) && pendingPct > 0 && pendingPct < 100 ? (
                  <Text style={{ color: "#7bd88f", fontSize: 13, fontWeight: "800", marginTop: 8 }}>
                    → {fmtG(goudForPct(pendingPct) ?? 0)} kounye a
                  </Text>
                ) : null}
              </>
            ) : !discounts.length ? (
              <Text style={{ color: "#5a5a5e", fontSize: 12, marginTop: 8 }}>Mandye yon manadjè pou kreye premye rabais la.</Text>
            ) : null}
          </PromoCard>

          {/* ── Type — conditional creation is parked for now, so only the
              unconditional chip renders (redemption still honors any
              already-issued conditional coupon). ── */}
          <SectionLabel>TIPE KOUPON</SectionLabel>
          <View style={{ flexDirection: "row", marginBottom: 4 }}>
            <Chip label="San kondisyon" active={type === "unconditional"} onPress={() => setType("unconditional")} />
          </View>
          <Text style={{ color: "#5a5a5e", fontSize: 12, marginTop: 2, marginBottom: 4 }}>
            Rabais la aplike sou tout panyen an.
          </Text>

          {/* ── Conditional requirements — checkout-style picker ── */}
          {type === "conditional" ? (
            <>
              <SectionLabel>PWODWI REKIZ (KI PA VANN BYEN)</SectionLabel>

              {/* Staged requirements — removable chips (the condition's cart) */}
              {Object.entries(picked).filter(([, q]) => Number(q) > 0).length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {Object.entries(picked).filter(([, q]) => Number(q) > 0).map(([pid, q]) => (
                    <Pressable
                      key={pid}
                      onPress={() => removeReq(pid)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(74,222,128,0.10)", borderWidth: 1, borderColor: "rgba(74,222,128,0.45)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Text style={{ color: "#7bd88f", fontSize: 12.5, fontWeight: "700" }}>
                        {pickedNames[pid] ?? sleepy.find(s => s.product_id === pid)?.name ?? pid} ×{q}
                      </Text>
                      <Text style={{ color: "#7bd88f", fontSize: 12, fontWeight: "900" }}>✕</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Search header — negative margin cancels the ScrollView's
                  16px gutter (SearchHeader brings its own padding). */}
              <View style={{ marginHorizontal: -16 }}>
                <SearchHeader
                  variant="phone"
                  search={searchState}
                  searchMode={searchMode}
                  entrance={entrance}
                  onSearchChange={setSearch}
                  onSearchModeChange={setSearchMode}
                  onBarcodeSubmit={onBarcodeSubmit}
                  onOpenScanner={() => setShowScan(true)}
                />
              </View>

              {pending ? (
                <PendingCard
                  variant="phone"
                  pending={pending}
                  pendingInput={pendingInput}
                  pendingLine={pendingLine}
                  pendingMaxQ={pendingMaxQ}
                  onAdjust={adjustPending}
                  onCustom={setPendingCustom}
                  onBlurClear={() => setPendingInput("")}
                  onCommit={commitPendingWithInput}
                  onCancel={() => clearPending()}
                />
              ) : null}

              {searchState.trim() ? (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 }}>
                  <Text style={{ color: "#71717a", fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>REZILTA RECHÈRCHE</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 11.5, fontWeight: "700", letterSpacing: 0.4 }}>{groups.length} PWODWI</Text>
                </View>
              ) : null}

              {groups.length ? (
                <View style={{ gap: 8, marginBottom: 8 }}>
                  {groups.map(g => (
                    <VariantGroupCard
                      key={g.product.id}
                      group={g}
                      inCartQtyFor={row => picked[row.product.id] ?? 0}
                      pendingActiveFor={row => !!pending && pending.product.id === row.product.id && pending.unitId === row.unitId && pending.variant === row.variant}
                      onRowPress={handleProductPress}
                      onDecQty={decReq}
                      inCartLabel="lis rekiz"
                    />
                  ))}
                </View>
              ) : !catalogLoaded ? null
                : !sleepy.length && !searchState.trim() ? (
                  <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 8 }}>Pa gen pwodwi an stòk pou chwazi.</Text>
                ) : (
                  <ProductsEmpty />
                )}
              <ScanSheet visible={showScan} onClose={() => setShowScan(false)} onSimulate={simulateScan} productLabel={sleepy[0]?.name ?? products[0]?.name ?? ""} />
            </>
          ) : null}

          {/* ── Purchase gate ── */}
          {/* ── Purchase gate — only without a product list: the selected
              products + quantities ARE the full condition otherwise. ── */}
          {type === "unconditional" ? (
            <>
              <SectionLabel>KONDISYON ACHAT (FÈKULTATIF)</SectionLabel>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <LabeledInput label="Kantite lajan minimòm (G)" value={minAmount} onChangeText={t => setMinAmount(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="0" />
                </View>
                <View style={{ flex: 1 }}>
                  <LabeledInput label="Atik minimòm" value={minItems} onChangeText={t => setMinItems(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="0" hint="Kantite total" />
                </View>
              </View>
            </>
          ) : null}
          <LabeledInput
            label="Kòf — maksimòm rabais (G)"
            value={cap} onChangeText={t => setCap(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="San limit"
          />

          {/* ── Expiry ── */}
          <SectionLabel>EKSPIRASYON</SectionLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {EXPIRY_PRESETS.map(p => (
              <Chip key={p.key} label={p.label} active={expiryDays === p.days} onPress={() => setExpiryDays(p.days)} />
            ))}
          </View>

          {/* ── Preview ── */}
          <SectionLabel>APRE RABAIS LA</SectionLabel>
          <PromoCard tone={mode === "proformat" ? "good" : "base"}>
            {mode === "proformat" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 14 }}>Pwofi proformat</Text>
                  <Text style={{ color: scopeProfit < 0 ? "#ff453a" : "#c7c7cc", fontSize: 15, fontWeight: "700" }}>
                    {fmtG(scopeProfit)}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kliyan an ap sove</Text>
                  <Text style={{ color: "#7bd88f", fontSize: 24, fontWeight: "900" }}>
                    {flatPreview != null ? `${fmtG(flatPreview)}` : "—"}
                  </Text>
                </View>
                {flatPreview === 0 ? (
                  <Text style={{ color: "#ff9f0a", fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                    {scopeProfit > 0
                      ? "Pwofi a twa ti — kantite lajan an arondi a 0 goud."
                      : scopeProfit < 0
                        ? "Pwofi negatif — pri acha pi wo pase pri vant, koupon sa a pa ka bay rabais."
                        : "Pwofi a = 0 goud — koupon sa a pa ka bay rabais."}
                  </Text>
                ) : null}
                <Text style={{ color: "#8e8e93", fontSize: 13, lineHeight: 19, marginTop: 8 }}>
                  Kantite a ap kalkile lè kliyan an peye (pousantrap sou pwofi panyen an). Mesaj la pa gen kantite lajan.
                </Text>
              </>
            ) : (
              <Text style={{ color: "#8e8e93", fontSize: 13, lineHeight: 19 }}>
                Kantite a ap kalkile lè kliyan an peye (pousantrap sou pwofi panyen an). Mesaj la pa gen kantite lajan.
              </Text>
            )}
          </PromoCard>

          <PrimaryButton
            label={issuing ? "Ap kreye…" : "✓ Kreye koupon"}
            busy={issuing}
            disabled={!finalCustomer || !selectedDiscount}
            onPress={issue}
          />
        </KeyboardSafeScrollView>
      </SafeScreen>
    
      </KeyboardSafeView>
    </Modal>
  );
}
