// General Analytics — the owner/admin home. Exactly seven sections of
// AGGREGATES: gross profit headline (sparkline + delta), then profit
// contribution, margin and units sold each rolled up the same chain —
// variant → product → category (a "Report by" pill picks the level) — plus
// cost-trend lines, supplier opportunities, and a net-profit "coming soon"
// note. Items are cost source only, never a reporting dimension; no per-sale
// rows here — Tranzaksyon owns those, and Rapò → Sales is the aggregate
// sales dashboard (SalesReportScreen). UI copy is English (money/number
// formats stay the app's).
//
// Money is owner/admin territory by ROUTING (HomeScreen only mounts this for
// those roles), so there is no extra canSeeMoney gate inside.
//
// Design: reference mock — black translucent canvas, white text, vivid green
// accent, segmented range pills, bare section headers on black, SVG charts,
// gold-edged opportunity cards. Cost honesty is preserved: every profit
// figure ships with its coverage line, never a made-up margin.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, AppState, ActivityIndicator } from "react-native";
import { Text } from "../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Rect, Stop, Text as SvgText } from "react-native-svg";
import { fmtG, monoStyle } from "../format";
import { fonts } from "../theme";
import { getDb } from "../db";
import { syncNow } from "../sync/autoSync";
import { useResponsive } from "../responsive";
import { RANGES } from "./home/types";
import type { RangeKey } from "./home/types";
import { loadAnalyticsData, type AnalyticsData } from "../analytics/load";
import {
  salesInRange,
  saleAmount,
  saleTime,
  rangeStart,
  itemCostsFor,
  lineRevenue,
  profitTotals,
  primaryCategoryByProduct,
  metricsByVariant,
  metricsByProduct,
  metricsByCategory,
  variantIndex,
  profitContribution,
  costCoveredRows,
  costTrendForItem,
  supplierComparison,
  type CostTrend,
  type VariantIndex,
  type MetricRow,
} from "../analytics/metrics";
import { formatCheckoutRow } from "../labels";
import { FALLBACK_STORE_ID } from "../db/ids";

// ── Reference-mock palette ─────────────────────────────────────────────
const BG = "rgba(0,0,0,0.96)"; // black + translucent screen canvas
const CARD = "rgba(255,255,255,0.05)"; // subtle card fill
const CARD_BD = "rgba(255,255,255,0.09)";
const LINE = "rgba(255,255,255,0.09)"; // hairline separators
const SEG_BG = "rgba(255,255,255,0.06)";
const SEG_ACTIVE = "rgba(255,255,255,0.14)";
const TRACK = "#2a2a2a"; // bar track
const GREEN = "#5ce68a"; // primary accent
const GREEN_BG = "rgba(92,230,138,0.15)";
const AMBER = "#f0a63c";
const AMBER_BG = "rgba(240,166,60,0.16)";
const RED = "#e06c5b";
const RED_BG = "rgba(224,108,91,0.16)";
const PURPLE = "#8b7cf6";
const TXT = "#ffffff";
const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";

const ROLE_KR: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Cashier" };

const SHORT_RANGE: Record<RangeKey, string> = {
  today: "Today",
  "7d": "7d",
  "28d": "28d",
  "6m": "6m",
  "1y": "1y",
  lifetime: "All",
};
const DELTA_LABEL: Record<RangeKey, string> = {
  today: "vs yesterday",
  "7d": "vs prev week",
  "28d": "vs prev month",
  "6m": "vs prev 6 mo",
  "1y": "vs prev year",
  lifetime: "",
};
/** Full range names for the units-sold badge (RANGES carries the French
 *  labels used by the rest of the app — analytics speaks English). */
const RANGE_BADGE: Record<RangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "6m": "Last 6 months",
  "1y": "Last year",
  lifetime: "All time",
};

/** The three reporting levels of BOTH chains (profit and volume): variant
 *  is the base figure, product sums its variants, category sums products. */
type DimKey = "variant" | "product" | "category";
const DIMS: [DimKey, string][] = [["variant", "Variant"], ["product", "Product"], ["category", "Category"]];
const DIM_ONE: Record<DimKey, string> = { variant: "variant", product: "product", category: "category" };
const DIM_MANY: Record<DimKey, string> = { variant: "variants", product: "products", category: "categories" };

const EYEBROW = {
  fontSize: 11,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  color: TXT2,
};

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

/** Green line + fading gradient fill over bucketed values (hero card). */
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
            <LinearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={GREEN} stopOpacity="0.35" />
              <Stop offset="1" stopColor={GREEN} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={fill} fill="url(#sparkGrad)" />
          <Polyline points={line} fill="none" stroke={GREEN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}

/** Units-sold bars — purple gradient columns, green ring dots, labels below. */
function UnitsChart({ rows }: { rows: { name: string; qty: number; margin: number; coverage: number }[] }) {
  const [w, setW] = useState(0);
  const BASE = 160; // baseline y inside the svg
  const TOP = 16; // headroom for the unit count above the tallest bar
  const CY = BASE + 16; // margin ring centre
  const PCT_Y = CY + 20;
  const COV_Y = PCT_Y + 12;
  const H = COV_Y + 8;
  const n = Math.max(1, rows.length);
  const colW = w / n;
  const barW = Math.min(34, colW * 0.5);
  const max = Math.max(1, ...rows.map(r => r.qty));
  const maxH = BASE - TOP;
  const marginCol = (m: number) => (m >= 40 ? GREEN : m >= 0 ? AMBER : RED);
  return (
    <>
      <View style={{ height: H, marginTop: 14 }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            <Defs>
              <LinearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#9186f7" />
                <Stop offset="1" stopColor="#5b4fd0" />
              </LinearGradient>
            </Defs>
            {rows.map((r, i) => {
              const h = Math.max(6, (r.qty / max) * maxH);
              const x = i * colW + (colW - barW) / 2;
              const rx = Math.min(9, barW / 2);
              const cx = i * colW + colW / 2;
              const trackX = i * colW + 8;
              const trackW = Math.max(24, colW - 16);
              const costed = r.coverage > 0;
              const col = costed ? marginCol(r.margin) : TXT3;
              return (
                <React.Fragment key={i}>
                  <Rect x={x} y={BASE - h} width={barW} height={h} rx={rx} fill="url(#barGrad)" />
                  <Rect x={x} y={BASE - 8} width={barW} height={8} fill="url(#barGrad)" />
                  <SvgText fontFamily={fonts.bold} x={cx} y={BASE - h - 5} fontSize={11} fontWeight="700" fill="#fff" textAnchor="middle">
                    {r.qty}
                  </SvgText>
                  {/* margin as a mini track + fill (same language as the
                      Margin section): a 10px ring was too easy to confuse
                      with its own background at this size. */}
                  <Rect x={trackX} y={CY - 3} width={trackW} height={6} rx={3} fill="rgba(255,255,255,0.16)" />
                  {costed && r.margin > 0 ? (
                    <Rect
                      x={trackX}
                      y={CY - 3}
                      width={Math.max(4, (Math.min(100, r.margin) / 100) * trackW)}
                      height={6}
                      rx={3}
                      fill={col}
                    />
                  ) : null}
                  <SvgText fontFamily={fonts.bold} x={cx} y={PCT_Y} fontSize={11} fontWeight="800" fill={col} textAnchor="middle">
                    {costed ? `${r.margin.toFixed(0)}%` : "—"}
                  </SvgText>
                  {costed && r.coverage < 100 ? (
                    <SvgText fontFamily={fonts.medium} x={cx} y={COV_Y} fontSize={9} fill={AMBER} textAnchor="middle">
                      cost {Math.round(r.coverage)}%
                    </SvgText>
                  ) : null}
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row" }}>
        {rows.map((r, i) => (
          <Text key={i} style={{ flex: 1, fontSize: 9.5, color: TXT3, textAlign: "center" }} numberOfLines={1}>
            {r.name}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE }} />
          <Text style={{ fontSize: 11.5, color: TXT2 }}>units</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 18, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.16)", overflow: "hidden" }}>
            <View style={{ width: 11, height: 6, borderRadius: 3, backgroundColor: GREEN }} />
          </View>
          <Text style={{ fontSize: 11.5, color: TXT2 }}>margin</Text>
        </View>
      </View>
    </>
  );
}

/** Multi-series unit-cost lines with grid + date axis (Cost Trends). */
function CostChart({ series }: { series: { key: string; name: string; color: string; trend: CostTrend }[] }) {
  const [w, setW] = useState(0);
  const H = 180;
  const PL = 46;
  const PR = 6;
  const PT = 12;
  const PB = 26;

  let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const s of series) {
    for (const p of s.trend.points) {
      const t = Date.parse(p.date);
      if (isNaN(t)) continue;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      if (p.unitCost < vMin) vMin = p.unitCost;
      if (p.unitCost > vMax) vMax = p.unitCost;
    }
  }
  if (!isFinite(tMin)) return null;
  if (tMax <= tMin) tMax = tMin + 86400000;
  const vPad = (vMax - vMin) * 0.15 || Math.max(1, vMax * 0.1);
  vMin -= vPad;
  vMax += vPad;
  const X = (t: number) => PL + ((t - tMin) / (tMax - tMin)) * (w - PL - PR);
  const Y = (v: number) => PT + (1 - (v - vMin) / (vMax - vMin)) * (H - PT - PB);
  const yTicks = [0, 1, 2, 3].map(i => vMin + (i * (vMax - vMin)) / 3);
  const xTicks = [0, 1, 2, 3].map(i => tMin + (i * (tMax - tMin)) / 3);
  const fmtX = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });

  return (
    <>
      <View style={{ height: H, marginTop: 10 }} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            {yTicks.map((v, i) => (
              <React.Fragment key={`y${i}`}>
                <Line x1={PL} x2={w - PR} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                <SvgText fontFamily={fonts.medium} x={PL - 6} y={Y(v) + 3} fontSize="9.5" fill={TXT3} textAnchor="end">
                  {shortG(v)}
                </SvgText>
              </React.Fragment>
            ))}
            {xTicks.map((t, i) => (
              <SvgText fontFamily={fonts.medium} key={`x${i}`} x={Math.min(Math.max(X(t), PL), w - PR)} y={H - 6} fontSize="9.5" fill={TXT3} textAnchor="middle">
                {fmtX(t)}
              </SvgText>
            ))}
            {series.map(s => {
              const pts = s.trend.points
                .map(p => ({ t: Date.parse(p.date), v: p.unitCost }))
                .filter(p => !isNaN(p.t));
              if (pts.length < 2) return null;
              return (
                <Polyline
                  key={s.key}
                  points={pts.map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
        {series.map(s => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
            <Text style={{ fontSize: 12, color: TXT2 }} numberOfLines={1}>{s.name}</Text>
            {s.trend.deltaPct !== null ? (
              <Text style={{ fontSize: 11, fontWeight: "700", color: s.trend.deltaPct > 0.05 ? RED : s.trend.deltaPct < -0.05 ? GREEN : TXT3, ...monoStyle }}>
                {s.trend.deltaPct > 0 ? "+" : ""}{s.trend.deltaPct.toFixed(1)}%
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </>
  );
}

/** Profit per bucket across the active range — hero sparkline series, same
 *  chain as profitTotals: each bucket nets only the revenue of lines whose
 *  VARIANT resolves to an item with a batch-derived rate (that item is the
 *  cost source). */
function sparkSeries(
  data: AnalyticsData, range: RangeKey, now: number, unitCostByItem: Map<string, number>,
  vi: VariantIndex
): number[] {
  let from = rangeStart(range, now);
  if (from === null) {
    let min: number | null = null;
    for (const s of data.sales) {
      const t = saleTime(s);
      if (!isNaN(t) && (min === null || t < min)) min = t;
    }
    if (min === null) return [];
    from = min;
  }
  const N = range === "today" ? 12 : range === "7d" ? 7 : range === "28d" ? 28 : 26;
  const span = Math.max(1, now - from);
  const step = span / N;
  const linesBySale = new Map<string, any[]>();
  for (const l of data.lines) {
    const k = String(l?.sale_id);
    const arr = linesBySale.get(k) ?? [];
    arr.push(l);
    linesBySale.set(k, arr);
  }
  const vals = new Array(N).fill(0);
  for (const s of data.sales) {
    const t = saleTime(s);
    if (isNaN(t) || t < from || t > now) continue;
    const i = Math.min(N - 1, Math.max(0, Math.floor((t - from) / step)));
    const ls = linesBySale.get(String(s?.id)) ?? [];
    if (ls.length === 0) continue; // no lines → no costed revenue (profitTotals rule)
    let unknown = 0;
    let cost = 0;
    for (const l of ls) {
      const rate = unitCostByItem.get(vi.resolve(l).itemId) ?? 0;
      if (rate > 0) cost += rate * Number(l?.quantity ?? 0);
      else unknown += lineRevenue(l);
    }
    vals[i] += Math.max(0, saleAmount(s) - unknown) - cost;
  }
  return vals;
}

/** Profit in [start, end) — the previous-window half of the hero delta. */
function profitWindow(
  data: AnalyticsData, start: number, end: number, unitCostByItem: Map<string, number>,
  vi: VariantIndex
): number {
  const sales = data.sales.filter(s => {
    const t = saleTime(s);
    return !isNaN(t) && t >= start && t < end;
  });
  return profitTotals(sales, data.lines, unitCostByItem, vi).profit;
}

export default function AnalyticsScreen({
  role = "owner",
  storeId = FALLBACK_STORE_ID,
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
  const { padH, width, isTablet } = useResponsive();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [range, setRange] = useState<RangeKey>("today");
  // Reporting level for profit + volume (variant is the base figure).
  const [dim, setDim] = useState<DimKey>("variant");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
        try { await syncNow({ quiet: true, storeId, deviceId }); } catch {}
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

  // Every cost in this screen derives from ONE map: item → its own purchase
  // cost (received batches, else supplier quote, else stored items.cost),
  // spread across the product by the ratio chain. Nothing pools items or
  // catalog totals; an item with no cost anywhere stays unknown.
  const unitCostByItem = useMemo(
    () => itemCostsFor(data?.model.items ?? [], data?.model.batches ?? [], data?.costRows ?? []),
    [data]
  );

  // Sale line → the variant it sold. The variant's OWN item is the only
  // cost source; items never become a reporting row themselves.
  const vi = useMemo(
    () => variantIndex({ items: data?.model.items ?? [], variants: data?.model.variants ?? [] }),
    [data]
  );

  const m = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const sales = salesInRange(data.sales, range, now);
    const profit = profitTotals(sales, data.lines, unitCostByItem, vi);
    const cats = primaryCategoryByProduct(data.productCategories, data.categories);
    // One base pass, then the two upward rolls — profit and volume for the
    // selected level all come from these same rows (variant → product →
    // category, plain sums, never a flat catalog-wide blend).
    const variantRows = metricsByVariant(sales, data.lines, unitCostByItem, vi);
    const productRows = metricsByProduct(variantRows, data.products);
    const categoryRows = metricsByCategory({ productRows, byProduct: cats.byProduct, categoryNames: cats.names });
    const rows = { variant: variantRows, product: productRows, category: categoryRows };
    const levelRows: MetricRow[] = rows[dim];
    // Profit + margin only rank rows with a real batch-derived cost: a
    // zero-coverage row has no costed revenue at all, so its profit/margin
    // would be 0-of-nothing — never shown. Volume needs no cost, so every
    // row counts (units actually sold).
    const covered = costCoveredRows(levelRows);
    return {
      sales,
      profit,
      rows,
      volumeRows: [...levelRows].sort((a, b) => b.qty - a.qty),
      marginRows: covered.slice(0, 6),
      excluded: levelRows.length - covered.length,
      contribution: profitContribution(covered),
    };
  }, [data, range, unitCostByItem, vi, dim]);

  // Hero delta — current window vs the equal-length window before it.
  const deltaPct = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const start = rangeStart(range, now);
    if (start === null) return null;
    const len = now - start;
    const cur = profitWindow(data, start, now + 1, unitCostByItem, vi);
    const prev = profitWindow(data, start - len, start, unitCostByItem, vi);
    if (!(prev > 0)) return null;
    return ((cur - prev) / prev) * 100;
  }, [data, range, unitCostByItem, vi]);

  const spark = useMemo(
    () => (data ? sparkSeries(data, range, Date.now(), unitCostByItem, vi) : []),
    [data, range, unitCostByItem, vi]
  );

  // Cost-trend series: per ITEM (never per product) — the three items with
  // the richest own-batch history. Each series is that item's own
  // total_paid/quantity history; items of the same batch session never merge.
  const costSeries = useMemo(() => {
    if (!data) return [] as { key: string; name: string; color: string; trend: CostTrend }[];
    const batches = data.model.batches as any[];
    const counts = new Map<string, number>();
    for (const b of batches) {
      if (!b || b.is_deleted || String(b.status ?? "") !== "received" || !(Number(b.quantity ?? 0) > 0)) continue;
      counts.set(String(b.item_id), (counts.get(String(b.item_id)) ?? 0) + 1);
    }
    const itemById = new Map(data.model.items.map(i => [String(i.id), i]));
    const prodName = new Map(data.products.map(p => [String(p.id), String(p.name ?? p.id)]));
    const colors = [GREEN, PURPLE, AMBER];
    return [...counts.entries()]
      .filter(([id]) => itemById.has(id))
      .map(([id, count]) => ({ id, count, trend: costTrendForItem(data.model.batches, id) }))
      .filter(x => x.trend.points.length >= 2)
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((x, i) => {
        const it: any = itemById.get(x.id);
        const pname = prodName.get(String(it?.product_id ?? "")) ?? "";
        const iname = String(it?.name ?? x.id);
        // Item-level line, so the app pattern drops the variant token: "{item} {product}".
        return { key: x.id, name: formatCheckoutRow(iname, pname, null), color: colors[i], trend: x.trend };
      });
  }, [data]);

  const supplierGroups = useMemo(() => {
    if (!data) return [];
    return supplierComparison({
      products: data.products,
      allItems: data.model.items,
      batches: data.model.batches,
      costRows: data.costRows,
      productSuppliers: data.productSuppliers,
      suppliers: data.suppliers,
    });
  }, [data]);

  // Flattened opportunity cards, biggest per-unit saving first.
  const opportunities = useMemo(() => {
    const nameOf = new Map((data?.suppliers ?? []).map(s => [String(s.id), String(s.name ?? "")]));
    const out: {
      key: string;
      productName: string;
      current: string;
      currentCost: number;
      cheaper: string;
      cheaperCost: number;
      saving: number;
      stale: boolean;
    }[] = [];
    for (const g of supplierGroups) {
      for (const r of g.recommendations) {
        if (!(r.savingPerUnit > 0)) continue;
        out.push({
          key: `${g.supplierId}-${r.itemId}`,
          productName: r.productName,
          current: nameOf.get(String(r.currentSupplierId)) || g.supplierName,
          currentCost: r.currentUnitCost,
          cheaper: r.cheaperSupplierName,
          cheaperCost: r.cheaperUnitCost,
          saving: r.savingPerUnit,
          stale: r.stale,
        });
      }
    }
    out.sort((a, b) => b.saving - a.saving);
    return out.slice(0, 4);
  }, [supplierGroups, data]);

  // Why is a section empty? "No purchase-cost data." reads like the costs are
  // missing when they exist but there is no history (or no second supplier)
  // to show yet — say what would fill it instead.
  const costTrendEmpty = useMemo(() => {
    if (!data) return "No purchase-cost data.";
    const dated = data.model.batches.filter(
      b => b && !b.is_deleted && String(b.status) === "received" &&
        Number((b as any).quantity ?? 0) > 0 && String((b as any).date ?? "") !== "",
    );
    if (!dated.length) return "No purchase-cost data.";
    return "Each unit has been bought once so far — a second purchase on a later date starts its line.";
  }, [data]);

  const opportunityEmpty = useMemo(() => {
    if (!data) return "No purchase-cost data.";
    const quotes = (data.costRows ?? []).filter(r => r && !r.is_deleted);
    if (!quotes.length) return "No purchase-cost data.";
    const supByProduct = new Map<string, Set<string>>();
    for (const q of quotes) {
      const pid = String(q.product_id ?? "");
      if (!pid) continue;
      if (!supByProduct.has(pid)) supByProduct.set(pid, new Set());
      supByProduct.get(pid)!.add(String(q.supplier_id ?? ""));
    }
    const multi = [...supByProduct.values()].filter(s => s.size >= 2).length;
    if (!multi) return "Only one supplier quoted per product — record a second supplier's price to compare.";
    return "No cheaper alternative found on your delivered products.";
  }, [data]);

  const rangeLabel = RANGE_BADGE[range];
  const scopeLabel = role === "owner" ? "All stores" : (storeName ?? storeId);

  if (!data || !m) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  const { profit, volumeRows, contribution, marginRows, excluded } = m;
  const noCost = profit.coverage.pct === 0;

  // ── Layout blocks — one definition, two compositions: phone stacks every
  // block in a single column; tablet pairs sections into columns and adds a
  // KPI grid next to the hero (charts measure themselves, so they reflow). ──
  const rangeRow = (
    <View style={{ flexDirection: "row", backgroundColor: SEG_BG, borderRadius: 999, padding: 4 }}>
      {RANGES.map(r => {
        const active = range === r.key;
        return (
          <Pressable
            key={r.key}
            onPress={() => setRange(r.key)}
            style={{ flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? GREEN : "transparent" }}
          >
            <Text style={{ fontSize: 12, fontWeight: active ? "800" : "600", color: active ? "#0a0a0a" : TXT2 }} numberOfLines={1}>
              {SHORT_RANGE[r.key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const reportByRow = (
    <View style={{ flexDirection: "row", backgroundColor: SEG_BG, borderRadius: 999, padding: 3, alignSelf: "flex-start" }}>
      {DIMS.map(([k, label]) => {
        const active = dim === k;
        return (
          <Pressable
            key={k}
            onPress={() => setDim(k)}
            style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? SEG_ACTIVE : "transparent" }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: active ? "700" : "600", color: active ? TXT : TXT2 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const heroCard = (
    <View style={{ backgroundColor: CARD, borderRadius: 20, borderWidth: 0.5, borderColor: CARD_BD, padding: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: "#d9d9d9" }}>Gross profit</Text>
        {!noCost && deltaPct !== null && DELTA_LABEL[range] ? (
          <View
            style={{
              backgroundColor: deltaPct > 0 ? GREEN_BG : deltaPct < 0 ? RED_BG : "rgba(255,255,255,0.08)",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: deltaPct > 0 ? GREEN : deltaPct < 0 ? RED : TXT2 }}>
              {deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1)}% {DELTA_LABEL[range]}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        style={{ fontSize: 40, fontWeight: "800", color: TXT, letterSpacing: -1, marginTop: 8 }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {noCost ? "—" : fmtG(Math.round(profit.profit))}
      </Text>
      <Text style={{ fontSize: 12.5, color: TXT2, marginTop: 8 }}>
        {noCost
          ? `Revenue ${fmtG(Math.round(profit.revenue))}  ·  Cost —`
          : Math.round(profit.coveredRevenue) === Math.round(profit.revenue)
            ? `Revenue ${fmtG(Math.round(profit.revenue))}  ·  Cost ${fmtG(Math.round(profit.cost))}`
            : `Costed ${fmtG(Math.round(profit.coveredRevenue))}  ·  Cost ${fmtG(Math.round(profit.cost))}`}
      </Text>
      {profit.coverage.pct < 100 ? (
        <Text style={{ fontSize: 11, color: AMBER, marginTop: 6 }}>
          {noCost
            ? "No purchase-cost data — add purchase costs to see real profit."
            : `Cost data on ${Math.round(profit.coverage.pct)}% of lines — ${fmtG(Math.round(profit.revenue - profit.coveredRevenue))} revenue without cost excluded.`}
        </Text>
      ) : null}
      <Sparkline values={spark} />
      {noCost ? <Text style={{ fontSize: 10.5, color: TXT3, marginTop: 4 }}>These lines count as revenue only — no cost data.</Text> : null}
    </View>
  );

  // Tablet-only KPI column: the figures the hero compresses into one
  // sub-line, split out so the wide screen earns its extra pixels.
  const marginPct = noCost || !(profit.revenue > 0) ? null : (profit.profit / profit.revenue) * 100;
  const KPITile = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <View style={{ flex: 1, backgroundColor: CARD, borderRadius: 16, borderWidth: 0.5, borderColor: CARD_BD, padding: 16 }}>
      <Text style={{ fontSize: 10.5, color: TXT2, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: "800", color: tone ?? TXT, letterSpacing: -0.6, marginTop: 8 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
  const kpiGrid = (
    <>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <KPITile label="Revenue" value={fmtG(Math.round(profit.revenue))} />
        <KPITile label="Cost" value={noCost ? "—" : fmtG(Math.round(profit.cost))} />
      </View>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <KPITile
          label="Margin"
          value={marginPct === null ? "—" : `${marginPct.toFixed(0)}%`}
          tone={marginPct === null ? undefined : marginPct >= 40 ? GREEN : marginPct >= 0 ? AMBER : RED}
        />
        <KPITile label="Sales" value={String(m.sales.length)} />
      </View>
    </>
  );

  const profitSection = (
    <View>
      <SectionHead title={`Profit by ${DIM_ONE[dim]}`} subtitle="What actually makes money" badge="Top 5" />
      {contribution.length === 0 ? (
        <Empty text={volumeRows.length === 0 ? "No sales in this period." : `No ${DIM_MANY[dim]} have purchase-cost data.`} />
      ) : (
        contribution.slice(0, 5).map((p, i) => {
          const leader = Math.max(...contribution.map(c => Math.max(0, c.profit)));
          const w = leader > 0 && p.profit > 0 ? Math.max(4, (p.profit / leader) * 100) : 0;
          const col = p.profit >= 0 && p.margin >= 0 ? GREEN : RED;
          return (
            <View
              key={p.id}
              style={{ paddingTop: 14, paddingBottom: 14, borderTopWidth: i ? 0.5 : 0, borderTopColor: LINE, marginTop: i ? 0 : 12 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ width: 30, fontSize: 13, fontWeight: "600", color: TXT3, ...monoStyle }}>
                  {String(i + 1).padStart(2, "0")}
                </Text>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: TXT }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: p.profit >= 0 ? TXT : RED, ...monoStyle }}>
                  {fmtG(Math.round(p.profit))}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, paddingLeft: 30 }}>
                <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: TRACK, overflow: "hidden" }}>
                  <View style={{ width: `${w}%` as any, height: 6, borderRadius: 3, backgroundColor: col }} />
                </View>
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: col, minWidth: 78, textAlign: "right" }}>
                  {p.margin.toFixed(0)}% margin
                </Text>
              </View>
            </View>
          );
        })
      )}
      {excluded > 0 ? (
        <Text style={{ fontSize: 11, color: AMBER, marginTop: 12 }}>
          {excluded} {DIM_MANY[dim]} hidden — no purchase-cost data.
        </Text>
      ) : null}
    </View>
  );

  const marginSection = (
    <View>
      <SectionHead title={`Margin by ${DIM_ONE[dim]}`} subtitle="Where the business holds the line" />
      {marginRows.length === 0 ? (
        <Empty text={volumeRows.length === 0 ? "No sales in this period." : "No purchase-cost data to show margins."} />
      ) : (
        marginRows.map((r, i) => {
          const col = r.margin >= 40 ? GREEN : r.margin >= 0 ? AMBER : RED;
          const partial = r.coverage.pct < 100;
          return (
            <View key={r.id} style={{ paddingTop: 12, paddingBottom: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: LINE }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: TXT }} numberOfLines={1}>{r.name}</Text>
                {partial ? (
                  <Text style={{ fontSize: 10.5, color: AMBER, ...monoStyle }}>cost {Math.round(r.coverage.pct)}%</Text>
                ) : null}
                <Text style={{ fontSize: 15, fontWeight: "800", color: TXT, ...monoStyle }}>{r.margin.toFixed(0)}%</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: TRACK, marginTop: 10, overflow: "hidden" }}>
                <View style={{ width: `${Math.max(2, Math.min(100, r.margin))}%` as any, height: 8, borderRadius: 4, backgroundColor: col }} />
              </View>
            </View>
          );
        })
      )}
      {excluded > 0 ? (
        <Text style={{ fontSize: 11, color: AMBER, marginTop: 12 }}>
          {excluded} {DIM_MANY[dim]} hidden — no purchase-cost data.
        </Text>
      ) : null}
    </View>
  );

  const unitsSection = (
    <View>
      <SectionHead title={`Units sold by ${DIM_ONE[dim]}`} subtitle="Volume ≠ profit" badge={rangeLabel} />
      {volumeRows.length === 0 ? (
        <Empty text="No sales in this period." />
      ) : (
        <UnitsChart rows={volumeRows.slice(0, isTablet ? 8 : 6).map(p => ({ name: p.name, qty: p.qty, margin: p.margin, coverage: p.coverage.pct }))} />
      )}
    </View>
  );

  const costSection = (
    <View>
      <SectionHead title="Cost trends" subtitle="Each unit's own history — never blended" />
      {costSeries.length === 0 ? (
        <Empty text={costTrendEmpty} />
      ) : (
        <CostChart series={costSeries} />
      )}
    </View>
  );


  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{ padding: padH, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={GREEN} colors={[GREEN]} />}
    >
      {/* Header — eyebrow + title + outlined action circles */}
      <View style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={EYEBROW}>Store overview</Text>
          <Text style={{ fontSize: 30, fontWeight: "800", color: TXT, letterSpacing: -0.8, marginTop: 6 }}>Analytics</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityLabel="Back"
              style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={19} color={TXT} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => refresh(true)}
            disabled={refreshing}
            accessibilityLabel="Refresh"
            style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}
          >
            {refreshing ? <ActivityIndicator size="small" color={TXT} /> : <Ionicons name="refresh" size={18} color={TXT} />}
          </Pressable>
        </View>
      </View>

      {/* Range — segmented pills, green active. Tablet: range + Report-by share
          one row to buy back vertical space; phone keeps the stacked flow. */}
      {isTablet ? (
        <View style={{ marginTop: 18, flexDirection: "row", alignItems: "flex-end", gap: 24 }}>
          <View style={{ flex: 1 }}>{rangeRow}</View>
          <View>
            <Text style={{ ...EYEBROW, marginBottom: 8 }}>Report by</Text>
            {reportByRow}
          </View>
        </View>
      ) : (
        <>
          <View style={{ marginTop: 18 }}>{rangeRow}</View>
          {/* Report-by — the level BOTH chains roll through: variant (base),
              product (Σ its variants), category (Σ its products). */}
          <Text style={{ ...EYEBROW, marginTop: 18 }}>Report by</Text>
          <View style={{ marginTop: 8 }}>{reportByRow}</View>
        </>
      )}

      {/* 1 — gross profit hero: delta pill, big value, revenue·COGS, sparkline.
          Tablet: hero (3/5) sits beside a KPI column (2/5) — revenue, cost,
          margin % and sales count broken out of the hero's sub-line. */}
      {isTablet ? (
        <View style={{ marginTop: 18, flexDirection: "row", gap: 14 }}>
          <View style={{ flex: 3 }}>{heroCard}</View>
          <View style={{ flex: 2, gap: 14 }}>{kpiGrid}</View>
        </View>
      ) : (
        <View style={{ marginTop: 18 }}>{heroCard}</View>
      )}

      {/* 2-5 — analysis sections. Phone: full-width stack with horizontal
          dividers. Tablet: Profit|Margin and Units|Cost side by side with a
          vertical rule (charts reflow to their column via onLayout). */}
      {isTablet ? (
        <>
          <View style={{ marginTop: 30, flexDirection: "row" }}>
            <View style={{ flex: 1, paddingRight: 22 }}>{profitSection}</View>
            <View style={{ width: 1, backgroundColor: LINE, marginVertical: 6 }} />
            <View style={{ flex: 1, paddingLeft: 22 }}>{marginSection}</View>
          </View>
          <Divider />
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1, paddingRight: 22 }}>{unitsSection}</View>
            <View style={{ width: 1, backgroundColor: LINE, marginVertical: 6 }} />
            <View style={{ flex: 1, paddingLeft: 22 }}>{costSection}</View>
          </View>
        </>
      ) : (
        <>
          {/* 2 — profit contribution at the selected level, TOP 5 (cost-covered) */}
          <View style={{ marginTop: 30 }}>{profitSection}</View>
          <Divider />
          {/* 3 — margin at the selected level (cost-covered rows only) */}
          {marginSection}
          <Divider />
          {/* 4 — units sold at the selected level (volume needs no cost data) */}
          {unitsSection}
          <Divider />
          {/* 5 — cost trends */}
          {costSection}
        </>
      )}

      <Divider />

      {/* 6 — supplier opportunities */}
      <View>
        <SectionHead title="Supplier opportunities" subtitle="Products with a cheaper alternative" />
        {opportunities.length === 0 ? (
          <Empty text={opportunityEmpty} />
        ) : (
          <View style={{ gap: 14, marginTop: 14, flexDirection: isTablet ? "row" : "column", flexWrap: isTablet ? "wrap" : "nowrap" }}>
            {opportunities.map(o => (
              <View key={o.key} style={isTablet ? { width: "48%" } : undefined}>
                <View style={{ backgroundColor: CARD, borderRadius: 14, borderLeftWidth: 3, borderLeftColor: AMBER, padding: 16, gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ flex: 1, fontSize: 17, fontWeight: "800", color: TXT }} numberOfLines={1}>{o.productName}</Text>
                    <View style={{ backgroundColor: GREEN_BG, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: GREEN, ...monoStyle }}>Save {fmtG(Math.round(o.saving))}/unit</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 18 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: TXT2 }}>Current</Text>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: TXT, marginTop: 3 }} numberOfLines={1}>{o.current}</Text>
                      <Text style={{ fontSize: 13, color: "#d9d9d9", marginTop: 2, ...monoStyle }}>
                        {fmtG(Math.round(o.currentCost))} / unit
                      </Text>
                    </View>
                    <View style={{ width: 14, alignItems: "center", paddingTop: 24 }}>
                      <Ionicons name="arrow-up" size={14} color={AMBER} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: TXT2 }}>Alternative</Text>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: TXT, marginTop: 3 }} numberOfLines={1}>{o.cheaper}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: GREEN, marginTop: 2, ...monoStyle }}>
                        {fmtG(Math.round(o.cheaperCost))} / unit
                      </Text>
                    </View>
                  </View>
                  {o.stale ? <Text style={{ fontSize: 11, color: AMBER }}>Old data — verify before buying.</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 7 — net profit: honest placeholder */}
      <View style={{ marginTop: 26, backgroundColor: AMBER_BG, borderRadius: 14, borderWidth: 0.5, borderColor: "rgba(240,166,60,0.4)", padding: 14, flexDirection: "row", gap: 10 }}>
        <Ionicons name="time-outline" size={20} color={AMBER} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: TXT }}>Net profit — coming soon</Text>
          <Text style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)", marginTop: 3, lineHeight: 16 }}>
            After all expenses (rent, salaries, transport...) — we don't have fixed-cost data to calculate it yet. For now, gross profit above is based on purchase cost only.
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 10, color: TXT3, textAlign: "center", marginTop: 16 }} numberOfLines={1}>
        {scopeLabel} • {ROLE_KR[role] ?? role}{lastUpdated ? ` • updated ${lastUpdated}` : ""}
      </Text>
    </ScrollView>
  );
}
