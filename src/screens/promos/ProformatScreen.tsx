// Proformat — the immutable price-check record (list → build → detail →
// coupon issuance → load into the POS cart to actually sell → once paid, the
// linked sale with a receipt reprint).
// List mirrors TransactionsScreen (date sections + search), header mirrors
// the Customers big-title + circular add button; the build step is a full
// POS checkout replica (ProformatCreateView) ending in upload transition +
// receipt with no tender screen and no partial pickup.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert, Share, SectionList, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { useSalesEvents } from "../../salesEvents";
import { fmtG } from "../../format";
import { uploadError } from "../../components/UploadTransition";
import { useResponsive } from "../../responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SkeletonCardRow } from "../../components/Skeleton";
import { PAYMENT_LABELS, buildReceipts, receiptItemsFrom, type ReceiptData } from "../../receipts";
import ReceiptModal from "../../components/ReceiptModal";
import { getUserById } from "../../users";
import { getProformat, listCoupons, listProformats, paidSaleForProformat, type ProformatPaidInfo } from "../../promos/promosModel";
import type { Coupon, PromoActor, Proformat } from "../../promos/types";
import CouponWizard from "./CouponWizard";
import { ProfileMenu } from "../../components/CustomerProfile";
import { PrimaryButton, PromoCard, PromoHeader, SectionLabel, fmtWhen } from "./promoUi";
import ProformatCreateView from "./ProformatCreateView";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

type ListRow = Proformat & { customer_name: string; customer_phone: string | null; paid: ProformatPaidInfo | null };

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];

function sectionTitleFor(t: number, now: Date): { key: string; title: string; sort: number } {
  const d = new Date(t);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day === today) return { key, title: "Jodi a", sort: day };
  if (day === today - 86400000) return { key, title: "Yè", sort: day };
  return { key, title: `${d.getDate()} ${HT_MONTHS[d.getMonth()]} ${d.getFullYear()}`, sort: day };
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ProformatScreen({
  role = "cashier",
  currentUser,
  storeId,
  storeName,
  deviceId = "device-unknown",
  onBack,
  onLoadIntoCart,
}: {
  role?: string;
  currentUser?: any;
  storeId: string;
  storeName?: string;
  deviceId?: string;
  /** Optional — the phone's Plis body passes it to bounce back to the hub;
   *  the tablet sidebar body omits it (no back from a permanently-mounted menu). */
  onBack?: () => void;
  /** Hand the record's lines to the POS tab (frozen prices, customer attached). */
  onLoadIntoCart?: (proformat: Proformat, customerId: string | null) => void;
}) {
  const { padH } = useResponsive();
  const insets = useSafeAreaInsets();
  const actor: PromoActor = { id: currentUser?.id ?? null, name: String(currentUser?.name ?? role), role: String(currentUser?.role ?? role) };
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<ListRow | null>(null);
  const [detailCust, setDetailCust] = useState<any | null>(null);
  const [detailCoupons, setDetailCoupons] = useState<Coupon[]>([]);
  const [justCreated, setJustCreated] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saleView, setSaleView] = useState<{ sale: any; credit: any | null; itemCount: number } | null>(null);
  const [saleReceipts, setSaleReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showSaleReceipt, setShowSaleReceipt] = useState(false);
  const [couponView, setCouponView] = useState<Coupon | null>(null);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      setRows(await listProformats(db, storeId, ""));
    } catch {} finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  // Live: a proformat issued on another register appears after the pull.
  useSalesEvents(() => { load().catch(() => {}); });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    const digits = t.replace(/\D/g, "");
    return rows.filter(p =>
      p.receipt_number.toLowerCase().includes(t) ||
      String(p.customer_name ?? "").toLowerCase().includes(t) ||
      (digits.length >= 3 && String(p.customer_phone ?? "").replace(/\D/g, "").includes(digits))
    );
  }, [rows, q]);

  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { key: string; title: string; sort: number; data: ListRow[] }>();
    for (const p of filtered) {
      const t = new Date(p.created_at ?? "").getTime();
      if (isNaN(t)) {
        const g = map.get("nodate") ?? { key: "nodate", title: "San dat", sort: -1, data: [] };
        g.data.push(p);
        map.set("nodate", g);
        continue;
      }
      const meta = sectionTitleFor(t, now);
      const g = map.get(meta.key) ?? { ...meta, data: [] };
      g.data.push(p);
      map.set(meta.key, g);
    }
    return [...map.values()].sort((a, b) => b.sort - a.sort);
  }, [filtered]);

  async function openDetail(p: ListRow, fresh = false) {
    try {
      const db = await getDb();
      const full = fresh ? (p as ListRow) : (await getProformat(db, String(p.id))) as ListRow | null;
      if (!full) { Alert.alert("Pa jwenn", "Proformat sa a pa egziste."); return; }
      let cust: any = null;
      try {
        cust = ((await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [String(full.customer_id)])) as any[])[0] ?? null;
      } catch {}
      let coupons: Coupon[] = [];
      try {
        const all = await listCoupons(db, storeId, "");
        coupons = all.filter(c => String(c.proformat_id ?? "") === String(full.id));
      } catch {}
      const paid = fresh ? (p.paid ?? null) : await paidSaleForProformat(db, String(full.id));
      setDetail({
        ...full,
        paid,
        customer_name: p.customer_name ?? String(cust?.name ?? ""),
        customer_phone: p.customer_phone ?? cust?.phone ?? null,
      });
      setDetailCust(cust);
      setDetailCoupons(coupons);
      setJustCreated(fresh);
      setView("detail");
    } catch (e: any) {
      uploadError("Erè", e?.message ?? String(e));
    }
  }

  /** Further action once paid — inspect the linked sale (summary, balance). */
  async function openLinkedSale(saleId: string) {
    try {
      const db = await getDb();
      const sale = (((await db.getAllAsync("SELECT * FROM sales WHERE id = ?", [saleId])) as any[]) ?? [])[0] ?? null;
      if (!sale) { Alert.alert("Pa jwenn", "Vant lan pa egziste sou aparèy sa a."); return; }
      let credit: any = null;
      try { credit = (((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [saleId])) as any[]) ?? [])[0] ?? null; } catch {}
      let itemCount = 0;
      try { itemCount = (((await db.getAllAsync("SELECT id FROM sale_items WHERE sale_id = ?", [saleId])) as any[]) ?? []).length; } catch {}
      setSaleView({ sale, credit, itemCount });
    } catch (e: any) {
      uploadError("Erè", e?.message ?? String(e));
    }
  }

  /** Reprint the paid sale's receipt — same rebuild TransactionsScreen uses.
   *  The linked-sale modal closes first: iOS drops same-tick modal swaps. */
  async function openLinkedSaleReceipt() {
    if (!saleView) return;
    try {
      const db = await getDb();
      const sale = saleView.sale;
      const total = Number(sale.total ?? 0);
      const amountPaid = Number(sale.amount_paid ?? total);
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const items = ((await db.getAllAsync(
        "SELECT * FROM sale_items WHERE sale_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)", [sale.id]
      ).catch(() => [])) as any[]) ?? [];
      let cust: any = null;
      if (sale.customer_id) {
        try { cust = (((await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [sale.customer_id])) as any[]) ?? [])[0] ?? null; } catch {}
      }
      const seller = getUserById(sale.seller_id) as any;
      let sellerName = String(seller?.name ?? "");
      if (!sellerName && sale.seller_id) {
        try {
          const emp = (((await db.getAllAsync("SELECT full_name FROM employees WHERE id = ?", [sale.seller_id])) as any[]) ?? [])[0];
          sellerName = String(emp?.full_name ?? "");
        } catch {}
      }
      setSaleReceipts(buildReceipts({
        saleId: sale.id,
        saleNumber: sale.sale_number ?? String(sale.id),
        storeName: storeName ?? "Jesyon Magazen",
        createdAt: sale.created_at ?? new Date().toISOString(),
        cashier: { id: sale.seller_id ?? null, name: sellerName, role: sale.seller_role ?? "" },
        customer: cust ? { name: cust.name ?? "", idCard: cust.id_card_number ?? null, phone: cust.phone ?? null, email: cust.email ?? null } : null,
        customerId: cust?.id ?? sale.customer_id ?? null,
        items: await receiptItemsFrom(db, items),
        subtotal: Number(sale.subtotal ?? total),
        discount: Number(sale.discount ?? 0),
        total,
        paymentMethod: String(sale.payment_method ?? "cash"),
        amountPaid,
        amountDue: Number(sale.amount_due ?? 0),
        change: String(sale.payment_method ?? "cash") === "cash" ? Math.max(0, amountPaid - total) : 0,
        dueDate: credits.length ? (credits[0].due_date ?? null) : null,
      }));
      setSaleView(null);
      setTimeout(() => setShowSaleReceipt(true), 350);
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Resi echwe");
    }
  }

  // ── Detail ───────────────────────────────────────────────────────────────
  if (view === "detail" && detail) {
    const cust = detailCust;
    const wizardCustomer = {
      id: String(detail.customer_id),
      name: String(detail.customer_name || cust?.name || ""),
      phone: detail.customer_phone ?? cust?.phone ?? null,
      prospect: !!cust?.is_prospect,
    };
    const shareText = () => {
      const lines = (detail.items ?? []).map(i => `${i.name} × ${i.qty} = ${fmtG(i.line_total)}`).join("\n");
      return `Proformat ${detail.receipt_number}\n${wizardCustomer.name}\n\n${lines}\n\nTotal: ${fmtG(detail.total)}`;
    };
    let cvMin: { products?: Array<{ name: string; qty: number }>; min_amount?: number | null; min_items?: number | null } | null = null;
    try { cvMin = typeof couponView?.min === "string" ? JSON.parse(String(couponView.min)) : (couponView?.min ?? null); } catch { cvMin = null; }
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <KeyboardSafeScrollView contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 48 }}>
          <PromoHeader
            title={detail.receipt_number}
            subtitle={fmtWhen(detail.created_at)}
            onBack={() => setView("list")}
            right={detail.paid ? null : (
              <Pressable
                onPress={() => setMenuOpen(true)}
                accessibilityLabel="Plis opsyon"
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
              </Pressable>
            )}
          />
          {justCreated ? (
            <PromoCard tone="good">
              <Text style={{ color: "#7bd88f", fontSize: 16, fontWeight: "800" }}>Proformat kreye ✓</Text>
              <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>
                Kounye a ou ka kreye yon koupon oswa chaje l nan panyen pou kliyan an peye.
              </Text>
            </PromoCard>
          ) : null}
          {detail.paid ? (
            <Pressable onPress={() => { void openLinkedSale(String(detail.paid!.sale_id)); }}>
              <PromoCard tone={detail.paid.amount_due > 0 ? "warn" : "good"}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: detail.paid.amount_due > 0 ? "#ffd60a" : "#7bd88f", fontSize: 16, fontWeight: "800" }}>
                    {detail.paid.amount_due > 0 ? "KREDI" : "PEYE ✓"}
                  </Text>
                  <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "700" }}>{detail.paid.sale_number}</Text>
                </View>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>{fmtWhen(detail.paid.paid_at)}</Text>
                <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 12 }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#8e8e93", fontSize: 14 }}>Total vant</Text>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>{fmtG(detail.paid.total)}</Text>
                </View>
                {detail.paid.amount_due > 0 ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Balance</Text>
                    <Text style={{ color: "#ff453a", fontSize: 16, fontWeight: "900" }}>{fmtG(detail.paid.amount_due)}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 10 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "700" }}>Gade vant lan</Text>
                  <Ionicons name="chevron-forward" size={14} color="#8e8e93" />
                </View>
              </PromoCard>
            </Pressable>
          ) : null}
          <PromoCard>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>{wizardCustomer.name || "—"}</Text>
              {wizardCustomer.prospect ? (
                <View style={{ backgroundColor: "#7a5c00", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: "#ffd60a", fontSize: 10, fontWeight: "700" }}>PWOSPÈK</Text>
                </View>
              ) : null}
            </View>
            {!!wizardCustomer.phone ? <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>{String(wizardCustomer.phone)}</Text> : null}
            <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 12 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "#8e8e93", fontSize: 14 }}>Total</Text>
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900" }}>{fmtG(detail.total)}</Text>
            </View>
            <Text style={{ color: "#5a5a5e", fontSize: 12, marginTop: 4 }}>Pri jele kounye a — pa chanje.</Text>
          </PromoCard>

          <SectionLabel>ATIK</SectionLabel>
          {(detail.items ?? []).map((it, idx) => (
            <View key={`${it.product_id}_${idx}`} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, padding: 14, marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }} numberOfLines={2}>{it.name}</Text>
                <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2 }}>
                  {it.qty} × {fmtG(it.unit_price)}{it.unit_name ? ` · ${it.unit_name}` : ""}
                </Text>
              </View>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>{fmtG(it.line_total)}</Text>
            </View>
          ))}

          <SectionLabel>KOUPON ATACHE</SectionLabel>
          {detailCoupons.length ? detailCoupons.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setCouponView(c)}
              style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, padding: 14, marginBottom: 8 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>{c.code}</Text>
                <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2 }}>
                  {Number(c.discount_percentage)}% · kalkile lè peye · {fmtWhen(c.expires_at)}
                </Text>
              </View>
              <View style={{ backgroundColor: c.status === "redeemed" ? "#10240f" : c.status === "expired" ? "#241010" : "#1c1c1e", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: c.status === "redeemed" ? "#7bd88f" : c.status === "expired" ? "#ff453a" : "#8e8e93", fontSize: 11, fontWeight: "800" }}>
                  {c.status === "redeemed" ? "ITILIZE" : c.status === "expired" ? "EKSPIRE" : "KIYÈ"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#8e8e93" style={{ marginLeft: 8 }} />
            </Pressable>
          )) : (
            <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 8 }}>Pa gen koupon sou proformat sa a.</Text>
          )}

        </KeyboardSafeScrollView>

        {!detail.paid && menuOpen ? (
          <ProfileMenu
            onClose={() => setMenuOpen(false)}
            top={64}
            right={padH}
            options={[
              ...(detailCoupons.length ? [] : [
                { label: "Kreye kupon pou li", onPress: () => setWizardOpen(true) },
              ]),
              ...(onLoadIntoCart
                ? [{
                    label: "Chaje nan panyen",
                    onPress: () => {
                      Alert.alert("Chaje nan panyen?", `${detail.receipt_number} • ${fmtG(detail.total)}. Atik yo pral ranplase panyen an ak pri jele.`, [
                        { text: "Anile", style: "cancel" },
                        { text: "Chaje", onPress: () => { onLoadIntoCart(detail, String(detail.customer_id || "")); } },
                      ]);
                    },
                  }]
                : []),
              { label: "Pataje resi", onPress: async () => { try { await Share.share({ message: shareText() }); } catch {} } },
            ]}
          />
        ) : null}

        <CouponWizard
          visible={wizardOpen}
          onClose={() => setWizardOpen(false)}
          storeId={storeId}
          deviceId={deviceId}
          actor={actor}
          mode="proformat"
          proformat={detail}
          customer={wizardCustomer}
          onIssued={() => { openDetail(detail, true); }}
        />

        {/* Linked sale — the "further action" once a proformat is paid. */}
        <Modal visible={!!saleView} animationType="slide" onRequestClose={() => setSaleView(null)}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: insets.top + 12, paddingBottom: 18 + insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 8 }}>
              <Pressable onPress={() => setSaleView(null)} accessibilityLabel="Fèmen" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 19, color: "#fff" }}>Vant</Text>
              <View style={{ width: 44 }} />
            </View>
            {saleView ? (
              <KeyboardSafeScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
                <PromoCard>
                  <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>{String(saleView.sale.sale_number ?? saleView.sale.id)}</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>{fmtWhen(saleView.sale.created_at)}</Text>
                  <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 12 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Total</Text>
                    <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900" }}>{fmtG(Number(saleView.sale.total ?? 0))}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kòd peman</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
                      {PAYMENT_LABELS[String(saleView.sale.payment_method ?? "cash")] ?? String(saleView.sale.payment_method ?? "")}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Atik</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{saleView.itemCount}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Balance</Text>
                    <Text style={{ color: Number(saleView.sale.amount_due ?? 0) > 0 ? "#ff453a" : "#7bd88f", fontSize: 16, fontWeight: "900" }}>
                      {fmtG(Number(saleView.sale.amount_due ?? 0))}
                    </Text>
                  </View>
                </PromoCard>
                {saleView.credit ? (
                  <PromoCard tone="warn">
                    <Text style={{ color: "#ffd60a", fontSize: 14, fontWeight: "800" }}>Kredi kliyan</Text>
                    <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>
                      {saleView.credit.due_date ? `Retire: ${fmtWhen(saleView.credit.due_date)}` : "Pa gen dat retou"}
                    </Text>
                    <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>
                      {fmtG(Number(saleView.credit.amount ?? 0))}{" — "}
                      {fmtG(Math.max(0, Number(saleView.sale.amount_due ?? 0)))} restan
                    </Text>
                  </PromoCard>
                ) : null}
                <PrimaryButton label="Resi" onPress={openLinkedSaleReceipt} />
                <PrimaryButton label="Fèmen" tone="ghost" onPress={() => setSaleView(null)} />
              </KeyboardSafeScrollView>
            ) : null}
          </View>
        </Modal>

        <ReceiptModal visible={showSaleReceipt} receipts={saleReceipts} onClose={() => { setShowSaleReceipt(false); setSaleReceipts(null); }} />

        {/* Attached coupon details */}
        <Modal visible={!!couponView} animationType="slide" onRequestClose={() => setCouponView(null)}>
          <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: insets.top + 12, paddingBottom: 18 + insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 8 }}>
              <Pressable onPress={() => setCouponView(null)} accessibilityLabel="Fèmen" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 19, color: "#fff" }}>Koupon</Text>
              <View style={{ width: 44 }} />
            </View>
            {couponView ? (
              <KeyboardSafeScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
                <PromoCard tone={couponView.status === "redeemed" ? "good" : couponView.status === "expired" ? "warn" : "base"}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: 1.5 }}>{couponView.code}</Text>
                    <View style={{ backgroundColor: couponView.status === "redeemed" ? "#10240f" : couponView.status === "expired" ? "#241010" : "#1c1c1e", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: couponView.status === "redeemed" ? "#7bd88f" : couponView.status === "expired" ? "#ff453a" : "#ffd60a", fontSize: 11, fontWeight: "800" }}>
                        {couponView.status === "redeemed" ? "ITILIZE" : couponView.status === "expired" ? "EKSPIRE" : "KIYÈ"}
                      </Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 12 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Rabais</Text>
                    <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900" }}>{Number(couponView.discount_percentage)}%</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Montant</Text>
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>
                    Kalkile lè peye
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Ekspire</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{fmtWhen(couponView.expires_at)}</Text>
                  </View>
                </PromoCard>

                <PromoCard>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Tip</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>
                      {couponView.type === "conditional" ? "Kondisyone" : "San kondisyon"}
                    </Text>
                  </View>
                  {cvMin?.min_amount ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kantite lajan minimòm</Text>
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{fmtG(Number(cvMin.min_amount))}</Text>
                    </View>
                  ) : null}
                  {cvMin?.min_items ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ color: "#8e8e93", fontSize: 14 }}>Atik minimòm</Text>
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{Number(cvMin.min_items)}</Text>
                    </View>
                  ) : null}
                  {(cvMin?.products ?? []).length ? (
                    <>
                      <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 10, marginBottom: 4 }}>Kondisyon achta</Text>
                      {(cvMin!.products ?? []).map((p, i) => (
                        <Text key={`${p.name}_${i}`} style={{ color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 2 }}>
                          {p.name} × {p.qty}
                        </Text>
                      ))}
                    </>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 12 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kòf</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
                      {Number(couponView.cap ?? 0) > 0 ? `${fmtG(Number(couponView.cap))}` : "San limit"}
                    </Text>
                  </View>
                </PromoCard>

                <PromoCard>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kliyan</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{wizardCustomer.name || "—"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Resi</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{detail.receipt_number}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Kreye pa</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
                      {couponView.created_by_name || "—"}
                      {couponView.created_by_role ? ` · ${String(couponView.created_by_role).toUpperCase()}` : ""}
                      {couponView.created_at ? ` · ${fmtWhen(couponView.created_at)}` : ""}
                    </Text>
                  </View>
                </PromoCard>

                {couponView.message ? (
                  <PromoCard>
                    <Text style={{ color: "#fff", fontSize: 14, lineHeight: 21 }}>{String(couponView.message)}</Text>
                    <Pressable
                      onPress={async () => { try { await Share.share({ message: String(couponView.message ?? couponView.code) }); } catch {} }}
                      style={{ marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#ffffff14" }}
                    >
                      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>Pataje mesaj la</Text>
                    </Pressable>
                  </PromoCard>
                ) : null}

                <PrimaryButton label="Fèmen" tone="ghost" onPress={() => setCouponView(null)} />
              </KeyboardSafeScrollView>
            ) : null}
          </View>
        </Modal>
      </View>
    );
  }

  // ── Create (POS checkout replica) ────────────────────────────────────────
  if (view === "create") return (
    <ProformatCreateView
      storeId={storeId}
      storeName={storeName}
      deviceId={deviceId}
      actor={actor}
      onBack={() => setView("list")}
      onCreated={async (pfo) => { await load(); await openDetail(pfo as ListRow, true); }}
    />
  );

  // ── List: Transactions sections + Customers header ───────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
        ) : null}
        <Text style={{ flex: 1, color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Proformat</Text>
        <Pressable
          onPress={() => setView("create")}
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      </View>

      <SectionList
        sections={grouped}
        keyExtractor={p => String(p.id)}
        stickySectionHeadersEnabled
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: "#000" }}
        contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
                <Ionicons name="search" size={20} color="#fff" />
                <TextInput value={q} onChangeText={setQ} placeholder="Chèche resi, kliyan…" placeholderTextColor="#8e8e93" style={{ flex: 1, fontSize: 16, color: "#fff" }} returnKeyType="search" />
                {q.length > 0 ? <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable> : null}
              </View>
            </View>
            <View style={{ height: 20 }} />
          </>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: "#000", paddingVertical: 8 }}>
            <Text style={{ fontSize: 12, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => openDetail(p)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 14, padding: 12, marginBottom: 10 }}
          >
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="document-text-outline" size={20} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }} numberOfLines={1}>{fmtG(Number(p.total ?? 0))} · {p.receipt_number}</Text>
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>
                {p.customer_name || "—"} · {shortDate(p.created_at)}
              </Text>
            </View>
            {p.paid ? (
              <View style={{ backgroundColor: p.paid.amount_due > 0 ? "#4a3a10" : "#10240f", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: p.paid.amount_due > 0 ? "#ffd60a" : "#7bd88f", fontSize: 11, fontWeight: "800" }}>
                  {p.paid.amount_due > 0 ? "KREDI" : "PEYE"}
                </Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color="#8e8e93" />
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: 8 }}>
              {[0, 1, 2, 3].map(i => <SkeletonCardRow key={i} tone="dark" />)}
            </View>
          ) : (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: "#8e8e93", fontSize: 13 }}>{q.trim() ? "Pa gen rezilta." : "Pa gen proformat ankò."}</Text>
            </View>
          )
        }
      />
    </View>
  );
}
