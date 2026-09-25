// Reports (Rapò) — sales-focused analytics: KPIs, daily target, 7-day trend,
// payment mix, top products. Money figures (revenue, profit) are owner/admin
// only; managers see counts, trends by volume, and targets.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert, RefreshControl, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BarChart } from "react-native-gifted-charts";
import { palette, radius, shadow, topIconBtn } from "../theme";
import { fmtG, fmt, monoStyle } from "../format";
import { getDb } from "../db";
import { SyncManager } from "../sync/syncManager";
import SalesTab from "./home/SalesTab";
import type { RangeKey as HomeRangeKey, TeamKPI } from "./home/types";
import { RANGES as HOME_RANGES } from "./home/types";
import { PAYMENT_LABELS } from "../receipts";

type RangeKey = "today" | "7d" | "30d";

const TARGET_KEY = "report_target_daily";

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ReportsScreen({
  role = "cashier",
  storeId = "demo-store-id",
  storeName,
  currentUser,
  userStoreIds = [],
  deviceId = "device-unknown",
  onBack,
}: {
  role?: string;
  storeId?: string;
  storeName?: string;
  currentUser?: any;
  userStoreIds?: string[];
  deviceId?: string;
  onBack?: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [view, setView] = useState<"hub" | "sales" | "kpi">("hub");
  const [sales, setSales] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [editingTarget, setEditingTarget] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [kpiRange, setKpiRange] = useState<HomeRangeKey>("7d");
  const [credits, setCredits] = useState<any[]>([]);
  const [creditPayments, setCreditPayments] = useState<any[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const canSeeMoney = role === "owner" || role === "admin";
  // Owner sees everything. Others see their assigned stores PLUS this device's
  // selling store — POS still records under the device store id, and without
  // the union those sales vanish here while (unscoped) Analytics shows them.
  const scopedStores = useMemo(() => {
    if (role === "owner") return null;
    const ids = userStoreIds.length ? [...userStoreIds] : [];
    if (!ids.includes(storeId)) ids.push(storeId);
    return ids;
  }, [role, userStoreIds, storeId]);

  const saleDate = (s: any) => new Date(s.created_at ?? s.updated_at ?? "").getTime();
  const saleAmount = (s: any) => Number(s.total ?? s.amount ?? s.subtotal ?? 0);

  async function load() {
    try {
      const db = await getDb();
      const all = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
      const live = all.filter((s: any) => String(s.status ?? "") !== "cancelled");
      const scoped = scopedStores ? live.filter((s: any) => scopedStores.includes(String(s.store_id ?? storeId))) : live;
      setSales(scoped);
      const lines = ((await db.getAllAsync("SELECT * FROM sale_items")) as any[]) ?? [];
      const saleIds = new Set(scoped.map((s: any) => s.id));
      setItems(lines.filter((l: any) => saleIds.has(l.sale_id)));
      const prods = ((await db.getAllAsync("SELECT * FROM products")) as any[]) ?? [];
      setProducts(prods);
      try { setCredits(((await db.getAllAsync("SELECT * FROM credits")) as any[]) ?? []); } catch {}
      try { setCreditPayments(((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]) ?? []); } catch {}
      const trows = ((await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [TARGET_KEY]).catch(() => [])) as any[]) ?? [];
      const t = trows.length ? Number(trows[0].value) : NaN;
      setTarget(!isNaN(t) && t > 0 ? t : null);
    } catch {}
  }
  useEffect(() => { refresh(true); }, []);
  // Live: instant reload on new sales (same event Analytics uses) + 15s poll +
  // refresh whenever the app returns to foreground.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { salesEvents } = await import("../salesEvents");
        unsub = salesEvents.subscribe(() => { load().catch(() => {}); });
      } catch {}
    })();
    const t = setInterval(() => { load().catch(() => {}); }, 15000);
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") refresh(false);
    });
    return () => { clearInterval(t); sub.remove(); if (unsub) unsub(); };
  }, []);

  async function refresh(withCloud: boolean) {
    if (!mounted.current) return;
    setRefreshing(true);
    try {
      if (withCloud) {
        // Best-effort: pull other devices' sales before rendering. Silent offline.
        try { await new SyncManager(storeId, deviceId).fullSync({ quiet: true }); } catch {}
        if (!mounted.current) return;
      }
      await load();
      if (mounted.current) {
        setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  async function saveTarget() {
    const v = parseFloat((targetInput || "").replace(/[^0-9.]/g, ""));
    if (!(v > 0)) return Alert.alert("Objektif pa valab", "Antre yon montan G > 0.");
    try {
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [TARGET_KEY, String(Math.round(v))]);
      setTarget(Math.round(v));
      setTargetInput("");
      setEditingTarget(false);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Sove objektif echwe");
    }
  }

  const now = new Date();
  const rangeStart = range === "today" ? startOfDay(now).getTime() : now.getTime() - (range === "7d" ? 7 : 30) * 24 * 3600 * 1000;
  const inRange = sales.filter(s => {
    const t = saleDate(s);
    return !isNaN(t) && t >= rangeStart;
  });
  const rangeIds = new Set(inRange.map(s => s.id));
  const rangeItems = items.filter(l => rangeIds.has(l.sale_id));

  const revenue = inRange.reduce((s, x) => s + saleAmount(x), 0);
  // cost_price on sale_items is the LINE total cost (same convention as Analytics).
  let cost = rangeItems.reduce((s, l) => s + Number(l.cost_price ?? 0), 0);
  if (cost === 0 && revenue > 0) cost = revenue * 0.65; // no cost history → 65% heuristic, like Analytics
  const profit = revenue - cost;
  const count = inRange.length;
  const avgTicket = count ? revenue / count : 0;
  const activeDays = new Set(
    inRange
      .map(s => saleDate(s))
      .filter(t => !isNaN(t))
      .map(t => startOfDay(new Date(t)).getTime())
  ).size;

  const todayTotal = sales
    .filter(s => saleDate(s) >= startOfDay(now).getTime())
    .reduce((s, x) => s + saleAmount(x), 0);
  const targetPct = target && target > 0 ? Math.min(100, (todayTotal / target) * 100) : 0;

  const trend = useMemo(() => {
    const days: { label: string; revenue: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      const start = startOfDay(d).getTime();
      const end = start + 24 * 3600 * 1000;
      const daySales = sales.filter(s => {
        const t = saleDate(s);
        return !isNaN(t) && t >= start && t < end;
      });
      days.push({
        label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        revenue: daySales.reduce((s, x) => s + saleAmount(x), 0),
        count: daySales.length,
      });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales]);

  const methods = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const s of inRange) {
      const m = String(s.payment_method ?? "cash");
      const e = map.get(m) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += saleAmount(s);
      map.set(m, e);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [inRange]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { qty: number; total: number; name: string }>();
    for (const l of rangeItems) {
      const e = map.get(l.product_id) ?? {
        qty: 0,
        total: 0,
        name: products.find(p => p.id === l.product_id)?.name ?? l.product_name ?? l.product_id,
      };
      e.qty += Number(l.quantity ?? 0);
      e.total += Number(l.line_total ?? (Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)));
      map.set(l.product_id, e);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [rangeItems, products]);

  const maxTrend = Math.max(1, ...trend.map(d => (canSeeMoney ? d.revenue : d.count)));

  // Team KPI (moved here from the old home KPI tab): same computation, fed by
  // this screen's own sales/credits state.
  const teamKPI = useMemo<TeamKPI>(() => {
    const getPay = (s: any) => String(s.payment_method ?? "cash").toLowerCase();
    const inKpiRange = (dateStr: string) => {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const diff = (now.getTime() - d.getTime()) / 86400000;
      if (kpiRange === "today") return diff < 1;
      if (kpiRange === "7d") return diff < 7;
      if (kpiRange === "28d") return diff < 28;
      if (kpiRange === "6m") return diff < 180;
      if (kpiRange === "1y") return diff < 365;
      return true;
    };
    const rangeSales = sales.filter((s: any) => {
      const st = String(s?.status ?? "").toLowerCase();
      const ok = st === "completed" || st === "paid" || st === "pending" || st === "credit";
      return ok && inKpiRange(s.created_at ?? s.updated_at ?? "");
    });
    const totalSales = rangeSales.reduce((a: number, b: any) => a + saleAmount(b), 0);
    const transactionCount = rangeSales.length;
    const cashSales = rangeSales.filter(s => getPay(s) === "cash").reduce((a: number, b: any) => a + saleAmount(b), 0);
    const creditSales = rangeSales.filter(s => getPay(s) === "credit").reduce((a: number, b: any) => a + saleAmount(b), 0);
    const monCash = rangeSales.filter(s => getPay(s) === "moncash").reduce((a: number, b: any) => a + saleAmount(b), 0);
    const natCash = rangeSales.filter(s => getPay(s) === "natcash").reduce((a: number, b: any) => a + saleAmount(b), 0);
    const mobileAmount = monCash + natCash;
    const rangeCredits = (credits ?? []).filter((c: any) => inKpiRange(c.created_at ?? c.updated_at ?? ""));
    const totalCreditIssued = rangeCredits.reduce((a: number, c: any) => a + Number(c.amount || 0), 0);
    const creditIds = new Set(rangeCredits.map((c: any) => c.id));
    const creditCollected = (creditPayments ?? [])
      .filter((p: any) => creditIds.has(p.credit_id) || creditIds.has(p.debt_id))
      .reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
    const creditOutstanding = Math.max(0, totalCreditIssued - creditCollected);
    const saleIds = new Set(rangeSales.map((s: any) => s.id));
    const costSum = items.filter((l: any) => saleIds.has(l.sale_id)).reduce((s: number, l: any) => s + Number(l.cost_price ?? 0), 0);
    const grossProfit = totalSales - (costSum || Math.round(totalSales * 0.65));
    return {
      cashSales, creditSales, mobileAmount, totalSales, transactionCount,
      totalCreditIssued, creditCollected, creditOutstanding, grossProfit,
      profitLabels: [HOME_RANGES.find(r => r.key === kpiRange)?.label ?? kpiRange],
      profitSegments: [{ label: "Cash Sales", cashSales, collectedCredit: creditCollected, outstandingCredit: creditOutstanding }],
    };
  }, [sales, items, credits, creditPayments, kpiRange, now]);

  const showKPI = role !== "cashier";

  if (view === "hub") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 }}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
            </Pressable>
          ) : (
            <View style={{ width: topIconBtn.size }} />
          )}
          <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Reports</Text>
          <View style={{ width: topIconBtn.size }} />
        </View>
        <View style={{ height: 1, backgroundColor: "#262626", marginTop: 14 }} />
        <Pressable onPress={() => setView("sales")} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
          <Text style={{ flex: 1, fontWeight: "800", fontSize: 17, color: "#fff" }}>Sales</Text>
          <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
        </Pressable>
        {showKPI ? (
          <Pressable onPress={() => setView("kpi")} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
            <Text style={{ flex: 1, fontWeight: "800", fontSize: 17, color: "#fff" }}>KPI</Text>
            <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} />}
    >
      {view === "sales" ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={() => setView("hub")} accessibilityLabel="Back" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={22} color={palette.ink} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: palette.ink }}>Sales</Text>
            <Pressable
              onPress={() => refresh(true)}
              disabled={refreshing}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center", opacity: refreshing ? 0.5 : 1 }}
            >
              <Ionicons name="refresh" size={20} color={palette.ink} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
        {(["today", "7d", "30d"] as RangeKey[]).map(r => {
          const active = range === r;
          return (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              style={{ flex: 1, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 0.5, borderColor: active ? palette.ink2 : palette.hairline, alignItems: "center" }}
            >
              <Text style={{ fontSize: 12, fontWeight: "800", color: active ? "#fff" : palette.muted }}>
                {r === "today" ? "Jodi a" : r === "7d" ? "7 jou" : "30 jou"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12 }}>
          <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "800", letterSpacing: 0.6 }}>VANT</Text>
          <Text style={{ fontWeight: "900", fontSize: 20, color: palette.ink, marginTop: 4, ...monoStyle }}>{count}</Text>
          <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>tranzaksyon</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12 }}>
          <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "800", letterSpacing: 0.6 }}>{canSeeMoney ? "TIKÈ MWAYEN" : "JOU AKTIF"}</Text>
          <Text style={{ fontWeight: "900", fontSize: 20, color: palette.ink, marginTop: 4, ...monoStyle }}>{canSeeMoney ? fmt(Math.round(avgTicket)) : String(activeDays)}</Text>
          <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>{canSeeMoney ? "G" : "jou ak vant"}</Text>
        </View>
      </View>
      {canSeeMoney ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12 }}>
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "800", letterSpacing: 0.6 }}>TOTAL</Text>
            <Text style={{ fontWeight: "900", fontSize: 20, color: palette.ink, marginTop: 4, ...monoStyle }}>{fmtG(Math.round(revenue))}</Text>
            <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>{range === "today" ? "jodi a" : range === "7d" ? "7 dènye jou" : "30 dènye jou"}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12 }}>
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "800", letterSpacing: 0.6 }}>PWOFI</Text>
            <Text style={{ fontWeight: "900", fontSize: 20, color: profit >= 0 ? palette.success : palette.danger, marginTop: 4, ...monoStyle }}>{fmtG(Math.round(profit))}</Text>
            <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>revni − pri acha</Text>
          </View>
        </View>
      ) : null}

      <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 14, ...shadow.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }}>Objektif jodi a</Text>
          {canSeeMoney && !editingTarget ? (
            <Pressable onPress={() => { setTargetInput(target ? String(target) : ""); setEditingTarget(true); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: palette.ink }}>{target ? "Modifye" : "Mete"}</Text>
            </Pressable>
          ) : null}
        </View>
        {editingTarget && canSeeMoney ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TextInput value={targetInput} onChangeText={v => setTargetInput(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" placeholder="Ex. 50000" placeholderTextColor={palette.muted2} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, fontWeight: "700", color: palette.ink, backgroundColor: "white" }} />
            <Pressable onPress={saveTarget} style={{ paddingHorizontal: 18, borderRadius: 10, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>OK</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 10 }}>
              <Text style={{ fontWeight: "900", fontSize: 18, color: palette.ink, ...monoStyle }}>
                {canSeeMoney ? `${fmtG(Math.round(todayTotal))} / ${target ? fmtG(target) : "—"}` : `${Math.round(targetPct)}%`}
              </Text>
              <Text style={{ fontSize: 12, fontWeight: "800", color: targetPct >= 100 ? palette.success : palette.accentGold }}>{Math.round(targetPct)}%</Text>
            </View>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: palette.surfaceGrouped, marginTop: 8, overflow: "hidden" }}>
              <View style={{ height: 10, borderRadius: 5, width: `${targetPct}%` as any, backgroundColor: targetPct >= 100 ? palette.success : palette.accentGold }} />
            </View>
            {!target ? (
              <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 6 }}>{canSeeMoney ? "Mete yon objektif chak jou pou swiv pwogrè." : "Pa gen objektif defini."}</Text>
            ) : null}
          </>
        )}
      </View>

      <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 14, ...shadow.card }}>
        <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }}>7 dènye jou {canSeeMoney ? "" : "(kantite)"}</Text>
        <View style={{ marginTop: 8, alignItems: "center" }}>
          <BarChart
            data={trend.map(d => ({
              value: canSeeMoney ? Math.round(d.revenue) : d.count,
              label: d.label,
              frontColor: palette.ink2,
            }))}
            width={280}
            height={150}
            barWidth={22}
            spacing={14}
            noOfSections={3}
            yAxisTextStyle={{ fontSize: 9, color: palette.muted2 }}
            xAxisLabelTextStyle={{ fontSize: 9, color: palette.muted2 }}
            hideRules={false}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={palette.hairline}
          />
        </View>
      </View>

      <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 14, ...shadow.card }}>
        <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }}>Mwayen peman</Text>
        <View style={{ marginTop: 6 }}>
          {methods.length === 0 ? (
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 6 }}>Pa gen vant sou peryòd la.</Text>
          ) : (
            methods.map(([m, v]) => (
              <View key={m} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: palette.hairline }}>
                <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: palette.ink }}>{PAYMENT_LABELS[m] ?? m}</Text>
                <Text style={{ fontSize: 12, color: palette.muted, fontWeight: "600" }}>{v.count} vant</Text>
                {canSeeMoney ? (
                  <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle, minWidth: 90, textAlign: "right" }}>{fmtG(Math.round(v.total))}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>

      <View style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 14, ...shadow.card }}>
        <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }}>Top pwodwi</Text>
        <View style={{ marginTop: 6 }}>
          {topProducts.length === 0 ? (
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 6 }}>Pa gen vant sou peryòd la.</Text>
          ) : (
            topProducts.map((p, i) => (
              <View key={`${p.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: palette.hairline }}>
                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: palette.muted }}>{i + 1}</Text>
                </View>
                <Text style={{ flex: 1, fontWeight: "700", fontSize: 13, color: palette.ink, marginLeft: 8 }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontSize: 12, color: palette.muted, fontWeight: "600" }}>×{p.qty}</Text>
                {canSeeMoney ? (
                  <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle, minWidth: 90, textAlign: "right" }}>{fmtG(Math.round(p.total))}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>

      <Text style={{ fontSize: 10, color: palette.muted3, textAlign: "center", marginTop: 2 }} numberOfLines={1}>
        {storeName ?? storeId}{role === "owner" ? " • tout magazen" : ""} • {currentUser?.name ?? role}{lastUpdated ? ` • mizajou ${lastUpdated}` : ""}
      </Text>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable onPress={() => setView("hub")} accessibilityLabel="Back" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={22} color={palette.ink} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: palette.ink }}>KPI</Text>
            <View style={{ width: 44 }} />
          </View>
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 }}>KPI • EKIP</Text>
            <SalesTab teamKPI={teamKPI} range={kpiRange} setRange={setKpiRange} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
