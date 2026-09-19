import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl, Animated, Easing } from "react-native";
import { palette, radius } from "../theme";
import type { RangeKey, TeamKPI } from "./home/types";
import { RANGES } from "./home/types";
import AnalyticsTab from "./home/AnalyticsTab";
import SalesTab from "./home/SalesTab";
import { useResponsive, centerBox } from "../responsive";

type Props = {
  onGoPos: () => void;
  onGoShift?: () => void;
  onOpenStore?: () => void;
  onOpenTeam?: () => void;
  role?: string;
  currentUser?: any;
  employees?: any[];
  stores?: StoreItem[];
  setStores?: (v: StoreItem[] | ((prev: StoreItem[]) => StoreItem[])) => void;
  activeStoreId?: string;
  setActiveStoreId?: (id: string) => void;
  appDisabled?: boolean;
  setAppDisabled?: (v: boolean | ((prev: boolean) => boolean)) => void;
  onOpenAccountCenter?: () => void;
  onShiftResolved?: () => void;
};
type TabKey = "analytics" | "sales" | "employees" | "store";
type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string };

const TREND = [ { d: "Lun", v: 32000 }, { d: "Mar", v: 41000 }, { d: "Mer", v: 38000 }, { d: "Jeu", v: 52000 }, { d: "Ven", v: 61000 }, { d: "Sam", v: 74000 }, { d: "Dim", v: 68000 } ];
const HOURLY = [ { d: "08h", v: 4200 }, { d: "09h", v: 6800 }, { d: "11h", v: 9800 }, { d: "13h", v: 12500 }, { d: "15h", v: 15200 }, { d: "17h", v: 11200 }, { d: "19h", v: 5600 } ];
const WEEKS_28D = [ { d: "S1", v: 42000 }, { d: "S2", v: 58000 }, { d: "S3", v: 47000 }, { d: "S4", v: 61000 } ];
const MONTHS_6M = [ { d: "Nov", v: 98000 }, { d: "Déc", v: 112000 }, { d: "Jan", v: 105000 }, { d: "Fév", v: 128000 }, { d: "Mar", v: 142000 }, { d: "Avr", v: 135000 } ];
const MONTHS_1Y = [ { d: "Mai", v: 85000 }, { d: "Jui", v: 92000 }, { d: "Jui", v: 88000 }, { d: "Aoû", v: 105000 }, { d: "Sep", v: 98000 }, { d: "Oct", v: 112000 }, { d: "Nov", v: 108000 }, { d: "Déc", v: 125000 }, { d: "Jan", v: 118000 }, { d: "Fév", v: 130000 }, { d: "Mar", v: 142000 }, { d: "Avr", v: 138000 } ];
const LIFETIME = [ { d: "2021", v: 320000 }, { d: "2022", v: 410000 }, { d: "2023", v: 480000 }, { d: "2024", v: 560000 }, { d: "2025", v: 620000 } ];

const SALES = Array.from({ length: 18 }).map((_, i) => {
  const d = new Date(); d.setDate(d.getDate() - i * 2);
  const amt = 1200 + (i % 5) * 800 + Math.round(Math.random() * 600);
  const pay = ["cash", "credit", "moncash", "natcash"][i % 4] as string;
  return { id: `sale-${1000 + i}`, sale_number: `VTE-${(10000 + i).toString()}`, date: d.toISOString(), customer: ["Jean B.", "Marie C.", "Pierre M.", "Sophie C."][i % 4], amount: amt, pay, status: pay === "credit" ? (i % 3 === 0 ? "pending" : "paid") : "completed" };
});

const BEST_ITEMS = [
  { name: "Riz 25kg", sku: "RICE-25KG", qty: 42, amount: 134400, icon: "🍚", rank: 1 },
  { name: "Prestige 330ml", sku: "PREST-330", qty: 38, amount: 3800, icon: "🍺", rank: 2 },
  { name: "Lwil 5L", sku: "OIL-5L", qty: 27, amount: 29700, icon: "🫒", rank: 3 },
  { name: "Farine 25kg", sku: "FARIN-25KG", qty: 21, amount: 58800, icon: "🌾", rank: 4 },
  { name: "Sik 10kg", sku: "SIK-10KG", qty: 19, amount: 18050, icon: "🍬", rank: 5 },
];

function TabIcon({ kind, active }: { kind: TabKey; active: boolean }) {
  const c = active ? palette.ink : palette.muted2;
  switch (kind) {
    case "analytics":
      return (
        <View style={{ width: 14, height: 12, flexDirection: "row", alignItems: "flex-end", gap: 2, justifyContent: "center" }}>
          <View style={{ width: 3, height: 6, backgroundColor: c, borderRadius: 1 }} />
          <View style={{ width: 3, height: 10, backgroundColor: c, borderRadius: 1 }} />
          <View style={{ width: 3, height: 7, backgroundColor: c, borderRadius: 1 }} />
        </View>
      );
    case "sales":
      return (
        <View style={{ width: 14, height: 12, borderWidth: 1.2, borderColor: c, borderRadius: 3, padding: 2, gap: 1.5, justifyContent: "center" }}>
          <View style={{ height: 1.2, backgroundColor: c, borderRadius: 1, width: "100%" }} />
          <View style={{ height: 1.2, backgroundColor: c, borderRadius: 1, width: "70%" }} />
          <View style={{ height: 1.2, backgroundColor: c, borderRadius: 1, width: "90%" }} />
        </View>
      );
    case "employees":
      return (
        <View style={{ width: 14, height: 12, alignItems: "center", justifyContent: "center" }}>
          <View style={{ flexDirection: "row", gap: 2 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, borderWidth: 1.2, borderColor: c }} />
            <View style={{ width: 5, height: 5, borderRadius: 3, borderWidth: 1.2, borderColor: c }} />
          </View>
          <View style={{ width: 13, height: 4, borderWidth: 1.2, borderColor: c, borderRadius: 3, marginTop: 1.5 }} />
        </View>
      );
    case "store":
      return (
        <View style={{ width: 14, height: 12, borderWidth: 1.2, borderColor: c, borderRadius: 3, alignItems: "center", paddingTop: 1.5 }}>
          <View style={{ width: 8, height: 5, borderWidth: 1.2, borderColor: c, borderRadius: 2 }} />
          <View style={{ width: 10, height: 1.2, backgroundColor: c, borderRadius: 1, marginTop: 1.5 }} />
        </View>
      );
    default:
      return <View style={{ width: 14, height: 12, borderWidth: 1.2, borderColor: c, borderRadius: 3 }} />;
  }
}

export { type RangeKey } from "./home/types";

export default function HomeScreen({ onGoPos, onGoShift, role = "cashier", currentUser, employees = [], stores, setStores, activeStoreId, setActiveStoreId, appDisabled, setAppDisabled, onOpenAccountCenter, onOpenStore, onOpenTeam, onShiftResolved }: Props) {
  const responsive = useResponsive();
  const { width, isTablet, padH } = responsive;
  const [tab, setTab] = useState<TabKey>("analytics");
  const [range, setRange] = useState<RangeKey>("today");

  const activeStore = (stores ?? []).find(s => s.id === activeStoreId) ?? (stores ?? [])[0];

  const [dbSales, setDbSales] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([]);
  const [allSaleItems, setAllSaleItems] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [creditPayments, setCreditPayments] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Display price per product (multi-variant model; read-only here)
  const [priceByProduct, setPriceByProduct] = useState<Record<string, number>>({});

  const loadSales = useCallback(async () => {
    try {
      const { getDb } = await import("../db");
      const db: any = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM sales ORDER BY created_at DESC, updated_at DESC")) as any[];
      const custs = (await db.getAllAsync("SELECT * FROM customers")) as any[];
      const items = (await db.getAllAsync("SELECT * FROM sale_items")) as any[];
      const products = (await db.getAllAsync("SELECT * FROM products")) as any[];
      let creditRows: any[] = [];
      let creditPaymentRows: any[] = [];
      try { creditRows = (await db.getAllAsync("SELECT * FROM credits")) as any[]; } catch {}
      try { creditPaymentRows = (await db.getAllAsync("SELECT * FROM credit_payments")) as any[]; } catch {}
      setCredits(creditRows ?? []);
      setCreditPayments(creditPaymentRows ?? []);
      const low = (products ?? []).filter((p: any) => Number(p.stock_quantity) <= Number(p.low_stock_threshold));
      setLowStockProducts(low);
      try {
        const { loadPricing, getDisplayPrice } = await import("../pricing");
        const pm = await loadPricing(db);
        const map: Record<string, number> = {};
        for (const p of products ?? []) {
          const d = getDisplayPrice(pm, p.id);
          map[p.id] = d && d.price > 0 ? d.price : Number(p.selling_price ?? 0) || 0;
        }
        setPriceByProduct(map);
      } catch {}
      setAllSaleItems(items ?? []);
      if (rows && rows.length > 0) {
        const custMap = new Map(custs.map((c: any) => [c.id, c.name]));
        const mapped = rows.map((r: any) => ({
          id: r.id,
          sale_number: r.sale_number ?? r.id,
          date: r.created_at ?? r.updated_at ?? new Date().toISOString(),
          customer: custMap.get(r.customer_id) ?? r.customer_id ?? "—",
          amount: Number(r.total ?? r.amount ?? r.subtotal ?? 0),
          pay: String(r.payment_method ?? r.pay ?? "cash").toLowerCase(),
          status: String(r.status ?? "completed").toLowerCase(),
          raw: r,
        }));
        setDbSales(mapped);
      } else {
        setDbSales([]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales, tab, range]);

  useEffect(() => {
    let unsub: (()=>void) | null = null;
    (async () => {
      try {
        const { salesEvents } = await import("../salesEvents");
        unsub = salesEvents.subscribe(loadSales);
      } catch {}
    })();
    const id = setInterval(loadSales, 2000);
    return () => { clearInterval(id); if (unsub) unsub(); };
  }, [loadSales]);

  const filteredSales = useMemo(() => {
    const now = new Date();
    const salesSrc = dbSales.length > 0 ? dbSales : SALES;
    const filtered = salesSrc.filter(s => {
      const rawDate = (s as any).date ?? (s as any).created_at ?? (s as any).updated_at;
      const d = new Date(rawDate);
      const diff = (now.getTime() - d.getTime()) / 86400000;
      const st = String((s as any).status ?? "").toLowerCase();
      const isSuccess = st === "completed" || st === "paid" || st === "pending" || st === "credit";
      if (!isSuccess) return false;
      if (range === "today") return diff < 1;
      if (range === "7d") return diff < 7;
      if (range === "28d") return diff < 28;
      if (range === "6m") return diff < 180;
      if (range === "1y") return diff < 365;
      return true;
    });
    return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [range, dbSales]);

  const salesSource = dbSales.length > 0 ? dbSales : SALES;
  const getAmt = (s: any) => Number(s.amount ?? s.total ?? 0);
  const getPay = (s: any) => String(s.pay ?? s.payment_method ?? "cash").toLowerCase();

  const todaySales = salesSource.filter(s => {
    const raw = (s as any).date ?? (s as any).created_at ?? (s as any).updated_at;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) / 86400000 < 1;
  });
  const yesterdaySales = salesSource.filter(s => {
    const raw = (s as any).date ?? (s as any).created_at ?? (s as any).updated_at;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return false;
    const diff = (Date.now() - d.getTime()) / 86400000;
    return diff >= 1 && diff < 2;
  });
  const getAmtToday = getAmt;
  const getPayToday = getPay;
  const todayTotal = todaySales.reduce((a, b) => a + getAmtToday(b), 0) || 0;
  const todayCount = todaySales.length;
  const todayCash = todaySales.filter(s => getPayToday(s) === "cash").reduce((a, b) => a + getAmtToday(b), 0);
  const todayCredit = todaySales.filter(s => getPayToday(s) === "credit").reduce((a, b) => a + getAmtToday(b), 0);
  const todayMonCash = todaySales.filter(s => getPayToday(s) === "moncash").reduce((a, b) => a + getAmtToday(b), 0);
  const todayNatCash = todaySales.filter(s => getPayToday(s) === "natcash").reduce((a, b) => a + getAmtToday(b), 0);
  const todayCashPct = todayTotal ? Math.round((todayCash / todayTotal) * 100) : 0;
  const todayCreditPct = todayTotal ? Math.round((todayCredit / todayTotal) * 100) : 0;
  const todayMonCashPct = todayTotal ? Math.round((todayMonCash / todayTotal) * 100) : 0;
  const todayNatCashPct = todayTotal ? Math.round((todayNatCash / todayTotal) * 100) : 0;

  const avgBasket = todayCount ? Math.round(todayTotal / todayCount) : 0;
  const yesterdayTotal = yesterdaySales.reduce((a,b)=> a + getAmt(b),0);
  const growthPct = yesterdayTotal ? Math.round(((todayTotal - yesterdayTotal)/yesterdayTotal)*100) : (todayTotal>0?100:0);
  const lowStockCount = lowStockProducts.length;
  const lowStockValue = lowStockProducts.reduce((sum:number,p:any)=> sum + Number(priceByProduct[p.id] ?? p.selling_price ?? 0)*Number(p.stock_quantity||0),0);

  const profitStats = useMemo(() => {
    const revenue = filteredSales.reduce((a, b) => a + getAmt(b), 0);
    const ids = new Set(filteredSales.map(s => s.id));
    let cost = 0;
    for (const it of allSaleItems) {
      if (ids.has(it.sale_id)) cost += Number(it.cost_price ?? 0);
    }
    if (cost === 0 && revenue > 0) cost = revenue * 0.65;
    const profit = revenue - cost;
    const margin = revenue ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, margin };
  }, [filteredSales, allSaleItems]);

  const dynamicBestItems = useMemo(() => {
    if (!allSaleItems || allSaleItems.length===0) return BEST_ITEMS;
    const map = new Map<string,{name:string; sku:string; qty:number; amount:number}>();
    for (const it of allSaleItems) {
      const key = String(it.product_name || it.product_id || "Unknown");
      const cur = map.get(key) ?? { name: key, sku: String(it.product_id||key).slice(0,12), qty: 0, amount: 0 };
      cur.qty += Number(it.quantity||0);
      cur.amount += Number(it.line_total|| Number(it.quantity||0)*Number(it.unit_price||0));
      map.set(key, cur);
    }
    const sorted = Array.from(map.values()).sort((a,b)=> b.qty - a.qty).slice(0,5);
    if (sorted.length===0) return BEST_ITEMS;
    return sorted.map((it,i)=> ({ name: it.name, sku: it.sku, qty: it.qty, amount: it.amount, icon: ["🍚","🍺","🫒","🌾","🍬"][i] ?? "📦", rank: i+1 }));
  }, [allSaleItems]);

  const dynamicTrend = useMemo(() => {
    if (!salesSource || salesSource.length===0) {
      if (range==="today") return HOURLY;
      if (range==="7d") return TREND;
      if (range==="28d") return WEEKS_28D;
      if (range==="6m") return MONTHS_6M;
      if (range==="1y") return MONTHS_1Y;
      return LIFETIME;
    }
    const now = new Date();
    if (range==="today") {
      const buckets = ["08h","09h","11h","13h","15h","17h","19h"];
      const hours = [8,9,11,13,15,17,19];
      return buckets.map((label,i)=>{
        const h = hours[i];
        const v = todaySales.filter(s=>{
          const d = new Date((s as any).date);
          return d.getHours()===h || (h===19 && d.getHours()>=19) || (h===8 && d.getHours()<=8);
        }).reduce((sum,s)=> sum+getAmt(s),0);
        return { d: label, v: v || 0 };
      });
    }
    if (range==="7d") {
      const weekday = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
      const map: Record<string,number> = {};
      weekday.forEach(d=> map[d]=0);
      const src = salesSource.filter(s=>{
        const d = new Date((s as any).date);
        return (now.getTime()-d.getTime())/86400000 < 7;
      });
      for (const s of src) {
        const d = new Date((s as any).date);
        const k = weekday[d.getDay()];
        map[k]=(map[k]||0)+getAmt(s);
      }
      const order: string[] = [];
      for(let i=6;i>=0;i--){ const d=new Date(now); d.setDate(now.getDate()-i); order.push(weekday[d.getDay()]); }
      const uniq = [...new Set(order)];
      return uniq.map(k=> ({ d:k, v: map[k]||0 }));
    }
    if (range==="28d") {
      const weeks = [{d:"S1",v:0},{d:"S2",v:0},{d:"S3",v:0},{d:"S4",v:0}];
      const src = salesSource.filter(s=>{
        const d = new Date((s as any).date);
        return (now.getTime()-d.getTime())/86400000 < 28;
      });
      for (const s of src) {
        const diff = Math.floor((now.getTime()-new Date((s as any).date).getTime())/ (7*86400000));
        const idx = Math.max(0, Math.min(3, 3 - diff));
        weeks[idx].v += getAmt(s);
      }
      return weeks;
    }
    if (range==="6m" || range==="1y") {
      const months = ["Jan","Fév","Mar","Avr","Mai","Jui","Juil","Aoû","Sep","Oct","Nov","Déc"];
      const count = range==="6m"?6:12;
      const buckets = months.slice(0,count).map(()=>0);
      const src = salesSource.filter(s=> (now.getTime()-new Date((s as any).date).getTime())/86400000 < (range==="6m"?180:365));
      const startMonth = (now.getMonth() - count + 1 + 12)%12;
      for(const s of src){
        const d=new Date((s as any).date);
        const m=d.getMonth();
        let idx = (m - startMonth + 12)%12;
        if (idx>=0 && idx<count) buckets[idx]+=getAmt(s);
      }
      const labels = [];
      for(let i=0;i<count;i++){ labels.push(months[(startMonth+i)%12]); }
      return labels.map((d,i)=> ({ d, v: buckets[i]||0 }));
    }
    const years = ["2021","2022","2023","2024","2025"];
    return years.map(y=>{
      const v = salesSource.filter(s=> String(new Date((s as any).date).getFullYear())===y).reduce((sum,s)=> sum+getAmt(s),0);
      return { d:y, v: v||0 };
    });
  }, [salesSource, todaySales, range]);

  const teamKPI = useMemo<TeamKPI>(() => {
    const now = new Date();
    const getAmt = (s: any) => Number(s.amount ?? s.total ?? 0);
    const getPay = (s: any) => String(s.pay ?? s.payment_method ?? "cash").toLowerCase();
    const getDate = (s: any) => s?.date ?? s?.created_at ?? s?.updated_at;

    const inRange = (dateStr: string) => {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const diff = (now.getTime() - d.getTime()) / 86400000;
      if (range === "today") return diff < 1;
      if (range === "7d") return diff < 7;
      if (range === "28d") return diff < 28;
      if (range === "6m") return diff < 180;
      if (range === "1y") return diff < 365;
      return true;
    };

    const salesSrc = dbSales.length > 0 ? dbSales : SALES;
    const rangeSales = salesSrc.filter((s: any) => {
      const st = String(s?.status ?? "").toLowerCase();
      const isSuccess = st === "completed" || st === "paid" || st === "pending" || st === "credit";
      return isSuccess && inRange(getDate(s));
    });

    const totalSales = rangeSales.reduce((a, b) => a + getAmt(b), 0);
    const transactionCount = rangeSales.length;
    const cashSales = rangeSales.filter(s => getPay(s) === "cash").reduce((a, b) => a + getAmt(b), 0);
    const creditSales = rangeSales.filter(s => getPay(s) === "credit").reduce((a, b) => a + getAmt(b), 0);
    const monCash = rangeSales.filter(s => getPay(s) === "moncash").reduce((a, b) => a + getAmt(b), 0);
    const natCash = rangeSales.filter(s => getPay(s) === "natcash").reduce((a, b) => a + getAmt(b), 0);
    const mobileAmount = monCash + natCash;

    const creditSrc = credits ?? [];
    const rangeCredits = creditSrc.filter((c: any) => inRange(getDate(c)));
    const totalCreditIssued = rangeCredits.reduce((a: number, c: any) => a + Number(c.amount || 0), 0);
    const creditIds = new Set(rangeCredits.map((c: any) => c.id));
    const creditCollected = (creditPayments ?? []).filter((p: any) => creditIds.has(p.credit_id) || creditIds.has(p.debt_id)).reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
    const creditOutstanding = Math.max(0, totalCreditIssued - creditCollected);

    const cost = rangeSales.reduce((acc: number, s: any) => {
      const ids = new Set([s.id, s.sale_number]);
      let saleCost = 0;
      for (const it of allSaleItems) {
        if (ids.has(it.sale_id)) saleCost += Number(it.cost_price ?? 0);
      }
      return acc + saleCost;
    }, 0);
    const grossProfit = totalSales - (cost || Math.round(totalSales * 0.65));

    const profitLabels = [RANGES.find((r: any) => r.key === range)?.label ?? range];
    const profitSegments = [
      {
        label: "Cash Sales",
        cashSales,
        collectedCredit: creditCollected,
        outstandingCredit: creditOutstanding,
      },
    ];

    return {
      cashSales,
      creditSales,
      mobileAmount,
      totalSales,
      transactionCount,
      totalCreditIssued,
      creditCollected,
      creditOutstanding,
      grossProfit,
      profitLabels,
      profitSegments,
    };
  }, [range, dbSales, credits, creditPayments, allSaleItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSales();
    setRefreshing(false);
  }, [loadSales]);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 480, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [tab]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.bg }}
        contentContainerStyle={{ padding: padH, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.ink2} colors={[palette.ink2]} />}
      >
        <View style={{ width: "100%", gap: 16 }}>
        {/* iOS Segmented — Luxury charcoal active */}
        <View style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 3, flexDirection: "row", borderWidth: 0.5, borderColor: palette.hairline }}>
          {[
            { k: "analytics" as TabKey, l: "Analytics" },
            ...(role === "cashier" ? [] : [{ k: "sales" as TabKey, l: "KPI" }]),
            ...(role === "cashier" ? [] : [{ k: "employees" as TabKey, l: "Team" }]),
            { k: "store" as TabKey, l: "Store" },
          ].map(t => {
            const active = tab === t.k;
            return (
              <Pressable
                key={t.k}
                onPress={() => (t.k === "store" ? onOpenStore?.() : t.k === "employees" ? onOpenTeam?.() : setTab(t.k))}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: active ? "white" : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 5,
                  shadowColor: active ? "#000" : "transparent",
                  shadowOpacity: active ? 0.08 : 0,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: active ? 2 : 0,
                }}
              >
                <TabIcon kind={t.k} active={active} />
                <Text style={{ fontSize: 13, fontWeight: active ? "600" : "400", color: active ? palette.ink : palette.muted2, letterSpacing: -0.2 }}>{t.l}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "analytics" && (
          <AnalyticsTab
            range={range}
            setRange={setRange}
            todayTotal={todayTotal}
            todayCount={todayCount}
            growthPct={growthPct}
            todayCash={todayCash}
            todayCredit={todayCredit}
            todayMonCash={todayMonCash}
            todayNatCash={todayNatCash}
            todayCashPct={todayCashPct}
            todayCreditPct={todayCreditPct}
            todayMonCashPct={todayMonCashPct}
            todayNatCashPct={todayNatCashPct}
            avgBasket={avgBasket}
            profitStats={profitStats}
            filteredSalesCount={filteredSales.length}
            lowStockCount={lowStockCount}
            lowStockValue={lowStockValue}
            dynamicTrend={dynamicTrend}
            dynamicBestItems={dynamicBestItems}
            dbSalesLength={dbSales.length}
            role={role}
            currentUser={currentUser}
          />
        )}

        {tab === "sales" && (
          <SalesTab
            teamKPI={teamKPI}
            range={range}
            setRange={setRange}
          />
        )}

        {tab === "employees" && null}

        {tab === "store" && null}
        </View>
      </ScrollView>

    </View>
  );
}
