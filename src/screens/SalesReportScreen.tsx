// SalesReportScreen — Rapò → Sales: an AGGREGATE numbers dashboard. Exactly
// four blocks of figures, each a block number + chart, never a row list:
// total sales revenue (headline + sparkline), then revenue by category, by
// product, and by transaction type — all ranked. There are NO per-sale rows
// here: Tranzaksyon owns the transaction list, and this screen does not
// duplicate it. Mounted twice: as the manager's Home (no onBack) and inside
// Rapò (onBack → hub).
//
// Rules inherited from the spec + General Analytics:
//  • ONE calendar time filter at the top (this week / month / quarter, last
//    quarter, this year) drives every number and chart. These are calendar
//    windows — new vocabulary; the rolling today/7d/28d ranges belong to
//    the other screens.
//  • Revenue by product is aggregated at the VARIANT level (variants are
//    what actually get sold) and rolled up to product, then category. Items
//    (case, 4-pack, single) are cost containers, never a reporting
//    dimension — same chain as AnalyticsScreen.
//  • Transaction type: cash and credit are prominent; mobile (moncash /
//    natcash / mobile) is deliberately smaller — it's rarely used. There is
//    no "multi-cash" method in the data, so no block for it. Credit
//    REPAYMENTS are never read here (they live in credit_payments and are
//    tracked separately): a credit sale's full total already lands in
//    `sales` at sale time, so counting repayments too would double count.
//  • Display style: every breakdown pairs its figures with a chart — no
//    bare lists, no orphan numbers. UI copy is English (money formats stay
//    the app's).
//  • The title block COLLAPSES on scroll down (returns on scroll up), but the
//    time filter stays pinned at the top — the range control is always
//    reachable without scrolling back up.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, AppState, ActivityIndicator, Animated, Easing } from "react-native";
import { Text } from "../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Path, Polyline, Stop } from "react-native-svg";
import { PieChart } from "react-native-gifted-charts";
import { fmtG, monoStyle } from "../format";
import { topIconBtn } from "../theme";
import { useResponsive } from "../responsive";
import { getDb } from "../db";
import { SyncManager } from "../sync/syncManager";
import { loadAnalyticsData, type AnalyticsData } from "../analytics/load";
import {
  saleAmount,
  saleTime,
  variantIndex,
  metricsByVariant,
  metricsByProduct,
  metricsByCategory,
  primaryCategoryByProduct,
} from "../analytics/metrics";

// ── Reference-mock palette (same dark canvas as AnalyticsScreen) ───────
const BG = "rgba(0,0,0,0.96)";
const CARD = "rgba(255,255,255,0.05)";
const CARD_BD = "rgba(255,255,255,0.09)";
const LINE = "rgba(255,255,255,0.09)";
const TRACK = "#2a2a2a";
const GREEN = "#5ce68a";
const GOLD = "#c8a24a";
const BLUE = "#4da3e0";
const TXT = "#ffffff";
const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";

const EYEBROW = {
  fontSize: 11,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  color: TXT2,
};

const ROLE_KR: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Cashier" };

// ── The ONE time filter: calendar windows, not rolling days ────────────
type ReportRange = "week" | "month" | "quarter" | "lastQuarter" | "year";

const RANGES: { key: ReportRange; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "lastQuarter", label: "Last quarter" },
  { key: "year", label: "This year" },
];

/** [start, end) of the calendar period. Weeks run Monday → Sunday (ISO);
 *  quarters begin Jan / Apr / Jul / Oct; last quarter is fully bounded so
 *  the current quarter can never leak into it. */
function windowFor(key: ReportRange, now: Date): { start: number; end: number } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const q = Math.floor(m / 3) * 3;
  switch (key) {
    case "week": {
      const dow = (now.getDay() + 6) % 7; // Mon = 0
      return { start: new Date(y, m, d - dow).getTime(), end: new Date(y, m, d - dow + 7).getTime() };
    }
    case "month":
      return { start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime() };
    case "quarter":
      return { start: new Date(y, q, 1).getTime(), end: new Date(y, q + 3, 1).getTime() };
    case "lastQuarter":
      return { start: new Date(y, q - 3, 1).getTime(), end: new Date(y, q, 1).getTime() };
    case "year":
      return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
  }
}

const SPARK_BUCKETS: Record<ReportRange, number> = { week: 7, month: 15, quarter: 13, lastQuarter: 13, year: 12 };

/** Sale totals bucketed across [start, end) — the headline sparkline. */
function revenueSeries(sales: any[], start: number, end: number, n: number): number[] {
  const span = Math.max(1, end - start);
  const step = span / n;
  const vals = new Array(n).fill(0);
  for (const s of sales) {
    const t = saleTime(s);
    if (isNaN(t) || t < start || t >= end) continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor((t - start) / step)));
    vals[i] += saleAmount(s);
  }
  return vals;
}

/** Revenue only — no cost/margin is ever rendered, so the chain runs with
 *  an empty cost map (the figure it produces, `revenue`, never touches it). */
const NO_COST = new Map<string, number>();

/** Compact axis money: G24.3k / G1.2M / G450 — chart labels only. */
function shortG(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000000) return `G${(v / 1000000).toFixed(1)}M`;
  if (a >= 1000) return `G${(v / 1000).toFixed(1)}k`;
  return `G${Math.round(v)}`;
}

function Empty({ text }: { text: string }) {
  return <Text style={{ fontSize: 13, color: TXT2, paddingVertical: 6 }}>{text}</Text>;
}

function Divider() {
  return <View style={{ height: 0.5, backgroundColor: LINE, marginVertical: 26 }} />;
}

function SectionHead({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ fontSize: 21, fontWeight: "800", letterSpacing: -0.4, color: TXT }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 13, color: TXT2, marginTop: 4 }}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <Text style={{ fontSize: 11, fontWeight: "700", color: TXT3, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 6 }} numberOfLines={1}>
          {badge}
        </Text>
      ) : null}
    </View>
  );
}

/** Green line + fading gradient fill over bucketed revenue (headline card). */
function Sparkline({ values }: { values: number[] }) {
  const [w, setW] = useState(0);
  const H = 64;
  const n = values.length;
  const onLayout = (e: any) => setW(e.nativeEvent.layout.width);
  let line = "";
  let fill = "";
  if (w > 0 && n >= 2) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-6) { min -= 1; max += 1; }
    const x = (i: number) => (i / (n - 1)) * w;
    const y = (v: number) => H - 6 - ((v - min) / (max - min)) * (H - 12);
    const coords = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    line = coords.join(" ");
    fill = `M0,${H} L${coords.join(" L")} L${w},${H} Z`;
  }
  return (
    <View style={{ marginTop: 16, height: H }} onLayout={onLayout}>
      {line ? (
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="revSparkGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={GREEN} stopOpacity="0.35" />
              <Stop offset="1" stopColor={GREEN} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={fill} fill="url(#revSparkGrad)" />
          <Polyline points={line} fill="none" stroke={GREEN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}

/** One ranked row of a breakdown: rank · name · block number, then the bar
 *  (scaled to the leader) with the share-of-period figure. Every number
 *  ships with its chart — nothing bare. */
function RankedRow({
  rank, name, value, share, leader, isFirst,
}: { rank: number; name: string; value: number; share: number; leader: number; isFirst: boolean }) {
  const w = leader > 0 && value > 0 ? Math.max(4, (value / leader) * 100) : 0;
  return (
    <View style={{ paddingTop: 14, paddingBottom: 14, borderTopWidth: isFirst ? 0 : 0.5, borderTopColor: LINE }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ width: 30, fontSize: 13, fontWeight: "600", color: TXT3, ...monoStyle }}>
          {String(rank).padStart(2, "0")}
        </Text>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: TXT }} numberOfLines={1}>{name}</Text>
        <Text style={{ fontSize: 16, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(Math.round(value))}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, paddingLeft: 30 }}>
        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: TRACK, overflow: "hidden" }}>
          <View style={{ width: `${w}%` as any, height: 6, borderRadius: 3, backgroundColor: GREEN }} />
        </View>
        <Text style={{ fontSize: 12, fontWeight: "700", color: TXT2, minWidth: 46, textAlign: "right", ...monoStyle }}>
          {share.toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

/** A breakdown section: headline block total + ranked rows + chart bars. */
function RankedBreakdown({
  title, subtitle, badge, rows, total, emptyText, moreLabel,
}: {
  title: string;
  subtitle: string;
  badge: string;
  rows: { id: string; name: string; revenue: number }[];
  total: number;
  emptyText: string;
  moreLabel: string;
}) {
  const top = rows.slice(0, 5);
  const rest = rows.slice(5);
  const restSum = rest.reduce((a, r) => a + r.revenue, 0);
  const leader = top.length ? Math.max(...top.map(r => r.revenue)) : 0;
  return (
    <View>
      <SectionHead title={title} subtitle={subtitle} badge={badge} />
      {top.length === 0 ? (
        <Empty text={emptyText} />
      ) : (
        <>
          {/* The section's own block number: what this breakdown accounts for */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, backgroundColor: CARD, borderRadius: 14, borderWidth: 0.5, borderColor: CARD_BD, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Text style={{ fontSize: 9.5, fontWeight: "700", color: TXT2, textTransform: "uppercase", letterSpacing: 0.6, flex: 1 }} numberOfLines={1}>
              {rows.length} {rows.length === 1 ? moreLabel.replace(/s$/, "") : moreLabel}
            </Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(Math.round(total))}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            {top.map((r, i) => (
              <RankedRow
                key={r.id}
                rank={i + 1}
                name={r.name}
                value={r.revenue}
                share={total > 0 ? (r.revenue / total) * 100 : 0}
                leader={leader}
                isFirst={i === 0}
              />
            ))}
          </View>
          {rest.length > 0 ? (
            <Text style={{ fontSize: 11, color: TXT3, marginTop: 8, ...monoStyle }}>
              +{rest.length} more · {fmtG(Math.round(restSum))}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

export default function SalesReportScreen({
  role = "manager",
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
  const { padH } = useResponsive();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [range, setRange] = useState<ReportRange>("month");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Pinned top block: collapses while scrolling down, returns on scroll up.
  const collapse = useRef(new Animated.Value(0)).current;
  const [headerH, setHeaderH] = useState(0);
  const lastY = useRef(0);
  const pendingDy = useRef(0);
  const collapsed = useRef(false);

  const setCollapsed = useCallback((next: boolean) => {
    if (collapsed.current === next) return;
    collapsed.current = next;
    Animated.timing(collapse, {
      toValue: next ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [collapse]);

  // Direction with a small hysteresis: hide after 24px net down-scroll,
  // reveal after 24px net up — and always show again at the very top.
  const onScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y <= 4) {
      pendingDy.current = 0;
      setCollapsed(false);
      return;
    }
    pendingDy.current += dy;
    if (pendingDy.current > 24) {
      pendingDy.current = 0;
      setCollapsed(true);
    } else if (pendingDy.current < -24) {
      pendingDy.current = 0;
      setCollapsed(false);
    }
  }, [setCollapsed]);

  // Owner sees every store; others get assigned stores plus this device's
  // selling store (same union Reports and Tranzaksyon use).
  const scopedStores = useMemo(() => {
    if (role === "owner") return null;
    const ids = userStoreIds.length ? [...userStoreIds] : [];
    if (!ids.includes(storeId)) ids.push(storeId);
    return ids;
  }, [role, userStoreIds, storeId]);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const next = await loadAnalyticsData(db, scopedStores);
      if (mounted.current) setData(next);
    } catch {}
  }, [scopedStores]);

  async function refresh(withCloud: boolean) {
    if (!mounted.current) return;
    setRefreshing(true);
    try {
      if (withCloud) {
        try { await new SyncManager(storeId, deviceId).fullSync({ quiet: true }); } catch {}
        if (!mounted.current) return;
      }
      await load();
      if (mounted.current) setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  useEffect(() => { refresh(true); }, [load]);
  // Live: same salesEvents + 15s poll + foreground reload the other reports use.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { salesEvents } = await import("../salesEvents");
        unsub = salesEvents.subscribe(() => { load().catch(() => {}); });
      } catch {}
    })();
    const t = setInterval(() => { load().catch(() => {}); }, 15000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") refresh(false); });
    return () => { clearInterval(t); sub.remove(); if (unsub) unsub(); };
  }, [load]);

  // Every figure below comes from the SAME window — the one range filter.
  // Breakdowns run the General Analytics chain (variant → product →
  // category) on line revenue; the headline and type split run on sale
  // totals. credit_payments is deliberately never read: a credit sale's
  // full total is already in `sales`, repayments would double count.
  const m = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const { start, end } = windowFor(range, now);
    const inWin = data.sales.filter(s => {
      const t = saleTime(s);
      return !isNaN(t) && t >= start && t < end;
    });
    const total = inWin.reduce((a, s) => a + saleAmount(s), 0);

    const vi = variantIndex({ items: data.model.items ?? [], variants: data.model.variants ?? [] });
    const variantRows = metricsByVariant(inWin, data.lines, NO_COST, vi);
    const productRows = metricsByProduct(variantRows, data.products);
    const cats = primaryCategoryByProduct(data.productCategories, data.categories);
    const categoryRows = metricsByCategory({
      productRows: productRows,
      byProduct: cats.byProduct,
      categoryNames: cats.names,
    });
    const byRevenue = (rows: { id: string; name: string; revenue: number }[]) =>
      [...rows].filter(r => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);

    // Transaction type — cash / credit prominent, everything else is the
    // "mobile" bucket (moncash / natcash / mobile), shown smaller. There is
    // no multi-cash method in the data, so no block for one.
    let cash = 0, credit = 0, mobile = 0, moncash = 0, natcash = 0, mobileOther = 0;
    for (const s of inWin) {
      const amt = saleAmount(s);
      const pm = String(s?.payment_method ?? "cash").toLowerCase();
      if (pm === "credit") credit += amt;
      else if (pm === "cash") cash += amt;
      else {
        mobile += amt;
        if (pm === "moncash") moncash += amt;
        else if (pm === "natcash") natcash += amt;
        else mobileOther += amt;
      }
    }

    const sparkEnd = Math.min(end, now.getTime());
    const spark = revenueSeries(inWin, start, sparkEnd > start ? sparkEnd : end, SPARK_BUCKETS[range]);

    return {
      total,
      productsRanked: byRevenue(productRows),
      categoriesRanked: byRevenue(categoryRows),
      cash, credit, mobile, moncash, natcash, mobileOther,
      spark,
    };
  }, [data, range]);

  const rangeLabel = RANGES.find(r => r.key === range)?.label ?? range;
  const scopeLabel = role === "owner" ? "All stores" : (storeName ?? storeId);

  if (!data || !m) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  const typeTotal = m.cash + m.credit + m.mobile;
  const typeShare = (v: number) => (typeTotal > 0 ? (v / typeTotal) * 100 : 0);
  const slices = [
    m.cash > 0 ? { value: m.cash, color: GREEN } : null,
    m.credit > 0 ? { value: m.credit, color: GOLD } : null,
    m.mobile > 0 ? { value: m.mobile, color: BLUE } : null,
  ].filter(Boolean) as { value: number; color: string }[];
  const pieData = slices.length ? slices : [{ value: 1, color: "rgba(255,255,255,0.12)" }];
  const hasSales = m.total > 0;
  const rowsEmptyText = hasSales ? "No line items to break down." : "No sales in this period.";
  const mobileParts = [
    m.moncash > 0 ? `MonCash ${fmtG(Math.round(m.moncash))}` : null,
    m.natcash > 0 ? `NatCash ${fmtG(Math.round(m.natcash))}` : null,
    m.mobileOther > 0 ? `Other ${fmtG(Math.round(m.mobileOther))}` : null,
  ].filter(Boolean) as string[];

  // Collapse animation targets. Until the block's height is measured we let
  // it lay out naturally (undefined height), then interpolate it away.
  const heightAnim = headerH > 0
    ? collapse.interpolate({ inputRange: [0, 1], outputRange: [headerH, 0] })
    : undefined;
  const headerOpacity = collapse.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0] });
  const headerShift = collapse.interpolate({ inputRange: [0, 1], outputRange: [0, -24] });

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Pinned top: the title block collapses on scroll down; the time
          filter underneath never moves — always reachable. */}
      <View style={{ backgroundColor: BG, paddingHorizontal: padH }}>
        <Animated.View style={{ overflow: "hidden", height: heightAnim }}>
          <Animated.View
            onLayout={e => {
              const h = Math.round(e.nativeEvent.layout.height);
              if (h > 0 && h !== headerH) setHeaderH(h);
            }}
            style={{ paddingTop: padH, opacity: headerOpacity, transform: [{ translateY: headerShift }] }}
          >
            <View style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={EYEBROW}>Store overview</Text>
                <Text style={{ fontSize: 30, fontWeight: "800", color: TXT, letterSpacing: -0.8, marginTop: 6 }}>Sales Report</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {onBack ? (
                  <Pressable
                    onPress={onBack}
                    accessibilityLabel="Back"
                    style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
                  </Pressable>
                ) : (
                  <View style={{ width: topIconBtn.size }} />
                )}
                <Pressable
                  onPress={() => refresh(true)}
                  disabled={refreshing}
                  accessibilityLabel="Refresh"
                  style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center", opacity: refreshing ? 0.5 : 1 }}
                >
                  {refreshing ? <ActivityIndicator size="small" color={TXT} /> : <Ionicons name="refresh" size={topIconBtn.iconSize} color={topIconBtn.icon} />}
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Time filter — ONE control; it moves every number and chart below.
            Pinned: never collapses, so the range can change at any scroll. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, marginTop: 16, paddingBottom: 2 }}>
          {RANGES.map(r => {
            const active = range === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => setRange(r.key)}
                style={{ paddingBottom: 7, borderBottomWidth: 2.5, borderBottomColor: active ? "#fff" : "transparent" }}
              >
                <Text style={{ fontSize: 13, fontWeight: active ? "800" : "600", color: active ? "#fff" : TXT2 }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: padH, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={GREEN} colors={[GREEN]} />}
      >

      {/* 1 — total sales revenue: headline block + sparkline. Top-line only:
          no cost, no margin — just what came in during the period. */}
      <View style={{ backgroundColor: CARD, borderRadius: 20, borderWidth: 0.5, borderColor: CARD_BD, padding: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: "#d9d9d9" }}>Total sales revenue</Text>
          <View style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: TXT2 }} numberOfLines={1}>{rangeLabel}</Text>
          </View>
        </View>
        <Text
          style={{ fontSize: 40, fontWeight: "800", color: TXT, letterSpacing: -1, marginTop: 8, ...monoStyle }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {fmtG(Math.round(m.total))}
        </Text>
        <Sparkline values={m.spark} />
      </View>

      <Divider />

      {/* 2 — revenue by category: block totals + bars, ranked */}
      <RankedBreakdown
        title="Revenue by category"
        subtitle="Products rolled up to their primary category"
        badge={rangeLabel}
        rows={m.categoriesRanked}
        total={m.categoriesRanked.reduce((a, r) => a + r.revenue, 0)}
        emptyText={rowsEmptyText}
        moreLabel="categories"
      />

      <Divider />

      {/* 3 — revenue by product: aggregated at the VARIANT level (what
          actually sells), rolled up to product — items are cost containers,
          never a reporting dimension. */}
      <RankedBreakdown
        title="Revenue by product"
        subtitle="Variants sold, rolled up to product"
        badge={rangeLabel}
        rows={m.productsRanked}
        total={m.productsRanked.reduce((a, r) => a + r.revenue, 0)}
        emptyText={rowsEmptyText}
        moreLabel="products"
      />

      <Divider />

      {/* 4 — revenue by transaction type: cash + credit prominent, mobile
          smaller (rarely used). The chart is the mix donut. */}
      <View>
        <SectionHead
          title="Revenue by transaction type"
          subtitle="Cash and credit lead — mobile is rarely used"
          badge={rangeLabel}
        />
        {!hasSales ? (
          <Empty text="No sales in this period." />
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              {([["Cash", m.cash, GREEN], ["Credit", m.credit, GOLD]] as const).map(([label, value, color]) => (
                <View key={label} style={{ flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 0.5, borderColor: CARD_BD, padding: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                    <Text style={{ fontSize: 10, fontWeight: "800", color: TXT2, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</Text>
                  </View>
                  <Text style={{ fontSize: 24, fontWeight: "800", color: TXT, letterSpacing: -0.6, marginTop: 8 }} numberOfLines={1} adjustsFontSizeToFit>
                    {fmtG(Math.round(value))}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: TXT2, marginTop: 4, ...monoStyle }}>{typeShare(value).toFixed(0)}% of revenue</Text>
                </View>
              ))}
            </View>

            {/* Mix donut — one chart for the whole section */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 18 }}>
              <PieChart
                donut
                data={pieData}
                radius={64}
                innerRadius={42}
                innerCircleColor="#000"
                strokeWidth={0}
                centerLabelComponent={() => (
                  <View style={{ alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: TXT, ...monoStyle }}>{shortG(Math.round(typeTotal))}</Text>
                    <Text style={{ fontSize: 9, color: TXT3 }}>total</Text>
                  </View>
                )}
              />
              <View style={{ flex: 1, gap: 12 }}>
                {([["Cash", m.cash, GREEN], ["Credit", m.credit, GOLD]] as const).map(([label, value, color]) => (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
                    <Text style={{ flex: 1, fontSize: 14.5, fontWeight: "700", color: TXT }}>{label}</Text>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(Math.round(value))}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Mobile — deliberately smaller: rare method, no equal weight */}
            <View style={{ marginTop: 14, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, borderWidth: 0.5, borderColor: LINE, paddingHorizontal: 12, paddingVertical: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: BLUE }} />
                <Text style={{ fontSize: 11.5, fontWeight: "700", color: TXT2, textTransform: "uppercase", letterSpacing: 0.6 }}>Mobile</Text>
                <Text style={{ flex: 1 }} />
                <Text style={{ fontSize: 13, fontWeight: "700", color: TXT2, ...monoStyle }}>{fmtG(Math.round(m.mobile))}</Text>
                <Text style={{ fontSize: 11, color: TXT3, minWidth: 40, textAlign: "right", ...monoStyle }}>{typeShare(m.mobile).toFixed(0)}%</Text>
              </View>
              {mobileParts.length > 0 ? (
                <Text style={{ fontSize: 10.5, color: TXT3, marginTop: 4, paddingLeft: 15, ...monoStyle }}>{mobileParts.join("  ·  ")}</Text>
              ) : null}
            </View>

            {/* Repayments are credit-analytics territory — say why, in-app. */}
            <Text style={{ fontSize: 11, color: TXT3, marginTop: 12, lineHeight: 16 }}>
              Credit repayments aren't counted here — they're tracked separately, so revenue is never double counted.
            </Text>
          </>
        )}
      </View>

      <Text style={{ fontSize: 10, color: TXT3, textAlign: "center", marginTop: 18 }} numberOfLines={1}>
        {scopeLabel} • {ROLE_KR[role] ?? role}{lastUpdated ? ` • updated ${lastUpdated}` : ""}
      </Text>
      </ScrollView>
    </View>
  );
}
