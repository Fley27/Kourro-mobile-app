// Credit Report — the premium, rule-based credit view inside Reports.
// Two tabs: business-wide health (outstanding, signal, aging, collection) and
// a per-customer list that opens a decision-support profile. All math lives
// in ../../creditAnalytics so the numbers can be checked outside the screen;
// nothing here blocks a sale.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, AppState, ActivityIndicator } from "react-native";
import { Text } from "../../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, monoStyle } from "../../format";
import { getDb } from "../../db";
import { SyncManager } from "../../sync/syncManager";
import { useResponsive } from "../../responsive";
import { ColumnChart, LineChart, type ChartBar } from "../../components/charts";
import CreditCustomerProfile from "./CreditCustomerProfile";
import {
  creditHealth,
  customerCreditRows,
  sortCustomerRows,
  type AgingBandKey,
  type CreditDirection,
  type CreditRow,
  type CustomerRow,
  type CustomerSort,
  type PaymentRow,
} from "../../creditAnalytics";

const BG = "rgba(0,0,0,0.96)";
const CARD = "rgba(255,255,255,0.05)";
const CARD_BD = "rgba(255,255,255,0.09)";
const SEG_BG = "rgba(255,255,255,0.05)";
const SEG_ACTIVE = "rgba(255,255,255,0.10)";
const RADIUS = 24;
const GREEN = "#5ce68a";
const GREEN_TINT = "rgba(92,230,138,0.10)";
const GREEN_BD = "rgba(92,230,138,0.35)";
const AMBER = "#f0a63c";
const ORANGE = "#e08a4b";
const RED = "#e06c5b";
const RED_TINT = "rgba(224,108,91,0.10)";
const RED_BD = "rgba(224,108,91,0.35)";
const TXT = "#ffffff";
const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";
const INACTIVE = "#8a8a8e";

const EYEBROW = {
  fontSize: 11,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  color: TXT2,
};

/** Square outlined button — the header controls and the card icon badges. */
const SQUARE = {
  width: 54,
  height: 54,
  borderRadius: 18,
  backgroundColor: CARD,
  borderWidth: 1,
  borderColor: CARD_BD,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const BAND_COLOR: Record<AgingBandKey, string> = { lt30: GREEN, d30_60: AMBER, d60_90: ORANGE, g90: RED };
/** Chart labels exactly as the design shows them: <30 / 30-60 / 60-90 / 90+. */
const BAND_LABEL: Record<AgingBandKey, string> = { lt30: "<30", d30_60: "30-60", d60_90: "60-90", g90: "90+" };
const SIGNAL_TINT: Record<CreditDirection, { bg: string; bd: string; icon: string }> = {
  improving: { bg: GREEN_TINT, bd: GREEN_BD, icon: "checkmark-circle" },
  stable: { bg: "rgba(240,166,60,0.10)", bd: "rgba(240,166,60,0.35)", icon: "pulse" },
  declining: { bg: RED_TINT, bd: RED_BD, icon: "alert-circle" },
};
const SIGNAL_COLOR: Record<CreditDirection, string> = { improving: GREEN, stable: AMBER, declining: RED };
const TABS: [string, string][] = [["health", "Business Health"], ["customers", "Customers"]];
const SORTS: [CustomerSort, string][] = [["overdue", "Most overdue"], ["balance", "Largest balance"], ["name", "Name"]];
/** Section copy per sort — the list is titled by how it is ordered. */
const SECTION: Record<CustomerSort, { title: string; sub: string }> = {
  overdue: { title: "Soonest overdue", sub: "Customers needing attention first." },
  balance: { title: "Largest balances", sub: "Where the most credit is sitting." },
  name: { title: "All customers", sub: "Every account with credit, A to Z." },
};

/** Points of collection-rate movement that count as a direction (pp). */
const RATE_STEP_PP = 5;

type Loaded = { credits: CreditRow[]; payments: PaymentRow[]; customers: CustomerRow[] };

const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function CardHead({ title, subtitle, icon }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, paddingTop: 2 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4, color: TXT }}>{title}</Text>
        <Text style={{ fontSize: 14, color: TXT2, marginTop: 5, lineHeight: 19 }}>{subtitle}</Text>
      </View>
      <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BD, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={GREEN} />
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={{ fontSize: 13, color: TXT2, paddingVertical: 8, lineHeight: 19 }}>{text}</Text>;
}

export default function CreditReportScreen({
  role = "owner",
  storeId = "demo-store-id",
  storeName,
  userStoreIds = [],
  deviceId = "device-unknown",
  onBack,
}: {
  role?: string;
  storeId?: string;
  storeName?: string;
  userStoreIds?: string[];
  deviceId?: string;
  onBack?: () => void;
}) {
  const { padH } = useResponsive();
  const [data, setData] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<"health" | "customers">("health");
  const [sort, setSort] = useState<CustomerSort>("overdue");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Owner sees every store; others get assigned stores plus this device's
  // selling store (same union Analytics and Reports use).
  const scopedStores = useMemo(() => {
    if (role === "owner") return null;
    const ids = userStoreIds.length ? [...userStoreIds] : [];
    if (!ids.includes(storeId)) ids.push(storeId);
    return ids;
  }, [role, userStoreIds, storeId]);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const sales = ((await db.getAllAsync("SELECT id, created_at FROM sales")) as any[]) ?? [];
      const saleDate = new Map(sales.map(s => [String(s.id), String(s.created_at ?? "")]));
      let credits = ((await db.getAllAsync("SELECT * FROM credits")) as any[]) ?? [];
      let customers = ((await db.getAllAsync("SELECT * FROM customers")) as any[]) ?? [];
      if (scopedStores) {
        const inScope = (r: any) => scopedStores.includes(String(r.store_id ?? storeId));
        credits = credits.filter(inScope);
        customers = customers.filter(inScope);
      }
      // Credits carry no created_at — the sale is the issue date.
      credits = credits.map(c => ({ ...c, issued_at: saleDate.get(String(c.sale_id ?? "")) || null }));
      const known = new Set(credits.map(c => String(c.id)));
      const allPayments = ((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]) ?? [];
      const payments = allPayments.filter(
        p => known.has(String(p.credit_id ?? "")) || known.has(String(p.debt_id ?? ""))
      );
      if (mounted.current) setData({ credits, payments, customers });
    } catch {}
  }, [scopedStores, storeId]);

  async function refresh(withCloud: boolean) {
    if (!mounted.current) return;
    setRefreshing(true);
    try {
      if (withCloud) {
        try { await new SyncManager(storeId, deviceId).fullSync({ quiet: true }); } catch {}
        if (!mounted.current) return;
      }
      await load();
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
        const { salesEvents } = await import("../../salesEvents");
        unsub = salesEvents.subscribe(() => { load().catch(() => {}); });
      } catch {}
    })();
    const t = setInterval(() => { load().catch(() => {}); }, 15000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") refresh(false); });
    return () => { clearInterval(t); sub.remove(); if (unsub) unsub(); };
  }, [load]);

  const now = Date.now();
  const health = useMemo(
    () => (data ? creditHealth({ credits: data.credits, payments: data.payments, now }) : null),
    [data, now]
  );
  const rows = useMemo(
    () => (data ? sortCustomerRows(customerCreditRows(data.credits, data.customers, now), sort) : []),
    [data, sort, now]
  );

  if (!data || !health) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  const dirColor = SIGNAL_COLOR[health.direction];
  const tint = SIGNAL_TINT[health.direction];

  // Collection cohorts → the single line under the chart.
  const rates = health.cohorts.map(c => c.rate).filter((r): r is number => r !== null && r !== undefined);
  const lastCohort = health.cohorts[health.cohorts.length - 1];
  const avgRate = rates.length ? Math.round(mean(rates)) : 0;

  // One takeaway under the collection card (advisory, same numbers as above).
  const insight = ((): { lead: string; body: string } => {
    if (!rates.length) return { lead: "Nothing to collect yet.", body: "No credit was issued in the last six months." };
    if (rates.length < 2) return { lead: "Early signal.", body: "One cohort of credit is measured so far — the trend needs another month." };
    const recentLen = Math.min(2, rates.length - 1);
    const recent = mean(rates.slice(-recentLen));
    const prior = mean(rates.slice(0, rates.length - recentLen));
    if (recent - prior >= RATE_STEP_PP) return { lead: "Healthy momentum.", body: "Collection performance is up across every recent cycle." };
    if (prior - recent >= RATE_STEP_PP) return { lead: "Collection is slipping.", body: "Recent months came back slower than the ones before them." };
    return { lead: "Steady recovery.", body: "Collection is holding steady across recent cycles." };
  })();

  const agingBars: ChartBar[] = health.aging.map(b => ({
    label: BAND_LABEL[b.key],
    value: b.amount,
    color: BAND_COLOR[b.key],
  }));

  // Customers takeaway: who to chase first (same rule as the "Most overdue" sort).
  const overdueRows = rows.filter(r => r.balance > 0 && r.daysOverdue > 0);
  const overdueSum = overdueRows.reduce((a, r) => a + r.balance, 0);
  const openSum = rows.reduce((a, r) => a + r.balance, 0);
  const worst = overdueRows.length
    ? overdueRows.reduce((a, r) => (r.daysOverdue > a.daysOverdue ? r : a))
    : null;
  const custInsight = !rows.length
    ? { lead: "No credit customers yet.", body: "Issue credit from the register and accounts show up here." }
    : worst
      ? {
          lead: `${worst.name} first.`,
          body: `${overdueRows.length} account${overdueRows.length === 1 ? " is" : "s are"} past due — ${fmtG(overdueSum)} waiting to be collected.`,
        }
      : openSum > 0
        ? { lead: "Nothing past due.", body: `${fmtG(openSum)} is open but not yet due — the due dates are the ones to watch.` }
        : { lead: "All settled.", body: "Every account on this scope has paid what it owed." };

  const deltaPct = health.delta ? Math.round(health.delta.pct) : null;
  const rising = (deltaPct ?? 0) > 0;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: BG }}
        contentContainerStyle={{ padding: padH, paddingTop: 8, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={GREEN} colors={[GREEN]} />}
      >
        {/* Header — live eyebrow, title, one shield control (pull to refresh too) */}
        <View style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN }} />
              <Text style={{ ...EYEBROW, color: GREEN }}>Reports · Live view</Text>
            </View>
            <Text style={{ fontSize: 34, fontWeight: "800", color: TXT, letterSpacing: -1, marginTop: 8 }}>Credit Analytics</Text>
            <Text style={{ fontSize: 15.5, color: TXT2, marginTop: 8, lineHeight: 22 }}>A clear view of the credit your business carries.</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {onBack ? (
              <Pressable onPress={onBack} accessibilityLabel="Back" style={SQUARE}>
                <Ionicons name="chevron-back" size={22} color={TXT} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => refresh(true)}
              disabled={refreshing}
              accessibilityLabel="Refresh"
              style={SQUARE}
            >
              {refreshing ? <ActivityIndicator size="small" color={GREEN} /> : <Ionicons name="shield-checkmark" size={23} color={GREEN} />}
            </Pressable>
          </View>
        </View>

        {/* Tabs */}
        <View style={{ marginTop: 22, flexDirection: "row", backgroundColor: SEG_BG, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 6, gap: 6 }}>
          {TABS.map(([key, label]) => {
            const active = tab === key;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key as "health" | "customers")}
                style={{ flex: 1, height: 46, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: active ? SEG_ACTIVE : "transparent" }}
              >
                <Text style={{ fontSize: 15, fontWeight: active ? "800" : "600", color: active ? TXT : INACTIVE }} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "health" ? (
          <>
            {/* Outstanding — eyebrow, figure, month-over-month move */}
            <View style={{ marginTop: 20, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", letterSpacing: 1.8, color: INACTIVE }}>Total outstanding credit</Text>
              <Text style={{ fontSize: 38, fontWeight: "800", letterSpacing: -1.2, color: TXT, marginTop: 10, ...monoStyle }}>
                {fmtG(health.outstanding)}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                {deltaPct !== null && deltaPct !== 0 ? (
                  <>
                    <Ionicons name={rising ? "trending-up" : "trending-down"} size={17} color={rising ? RED : GREEN} />
                    <Text style={{ fontSize: 15, fontWeight: "700", color: rising ? RED : GREEN }}>
                      {Math.abs(deltaPct)}% this month
                    </Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: "700", color: TXT2 }}>
                    {deltaPct === null ? "No prior month to compare" : "Flat this month"}
                  </Text>
                )}
              </View>
            </View>

            {/* Signal — one line of direction + one line of guidance */}
            <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: tint.bg, borderRadius: RADIUS, borderWidth: 1, borderColor: tint.bd, padding: 18 }}>
              <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: tint.bg, borderWidth: 1, borderColor: tint.bd, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={tint.icon as any} size={22} color={dirColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16.5, fontWeight: "800", letterSpacing: -0.2, color: dirColor }}>{health.headline}</Text>
                <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.86)", marginTop: 4, lineHeight: 20 }}>{health.guidance}</Text>
              </View>
            </View>

            {/* Aging */}
            <View style={{ marginTop: 16, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
              <CardHead title="Aging Breakdown" subtitle="Outstanding balance by age" icon="bar-chart" />
              <View style={{ height: 14 }} />
              <ColumnChart bars={agingBars} format={v => fmtG(v)} height={200} />
            </View>

            {/* Collection */}
            <View style={{ marginTop: 16, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
              <CardHead title="Collection Rate" subtitle="Six-month recovery trend" icon="analytics" />
              <View style={{ height: 14 }} />
              <LineChart
                points={health.cohorts.map(c => ({ label: c.label, value: c.rate ?? 0 }))}
                color={GREEN}
                height={185}
                yMin={0}
                yMax={100}
              />
              <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 12, lineHeight: 18 }}>
                {rates.length && lastCohort
                  ? `${lastCohort.label}: ${Math.round(lastCohort.rate ?? 0)}% of issued credit repaid — ${avgRate}% average across ${rates.length} month${rates.length === 1 ? "" : "s"}.`
                  : "No credit issued in the last 6 months — nothing to collect yet."}
              </Text>
            </View>

            {/* Takeaway */}
            <View style={{ marginTop: 16, flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 20, borderWidth: 0.5, borderColor: GREEN_BD, padding: 18 }}>
              <Ionicons name="sparkles" size={18} color={GREEN} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 14.5, lineHeight: 21, color: TXT2 }}>
                <Text style={{ fontWeight: "800", color: TXT }}>{insight.lead} </Text>
                {insight.body}
              </Text>
            </View>
          </>
        ) : (
          <>
            {/* Sort */}
            <View style={{ marginTop: 18, flexDirection: "row", backgroundColor: SEG_BG, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 6, gap: 6 }}>
              {SORTS.map(([key, label]) => {
                const active = sort === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setSort(key)}
                    style={{ flex: 1, height: 42, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: active ? SEG_ACTIVE : "transparent" }}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: active ? "800" : "600", color: active ? TXT : INACTIVE }} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* List card — section head + account pill, rows divided inside */}
            <View style={{ marginTop: 16, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, paddingTop: 22 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 22 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4, color: TXT }}>{SECTION[sort].title}</Text>
                  <Text style={{ fontSize: 14, color: TXT2, marginTop: 5, lineHeight: 19 }}>{SECTION[sort].sub}</Text>
                </View>
                <View style={{ borderRadius: 999, borderWidth: 1, borderColor: CARD_BD, backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: TXT2 }}>
                    {rows.length} account{rows.length === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 14 }}>
                {rows.length ? (
                  rows.map((r, i) => {
                    const paid = r.balance <= 0;
                    const status = paid
                      ? { text: "Paid in full", color: GREEN }
                      : r.daysOverdue > 20
                        ? { text: `${r.daysOverdue} days overdue`, color: RED }
                        : r.daysOverdue > 0
                          ? { text: `${r.daysOverdue} day${r.daysOverdue === 1 ? "" : "s"} overdue`, color: AMBER }
                          : { text: "Not due yet", color: TXT3 };
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => setProfileId(r.id)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 14,
                          paddingHorizontal: 22,
                          paddingVertical: 16,
                          borderTopWidth: i ? 0.5 : 0,
                          borderTopColor: "rgba(255,255,255,0.07)",
                        }}
                      >
                        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: CARD_BD, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="cash" size={19} color={TXT2} />
                        </View>
                        <View style={{ flex: 1, paddingRight: 6 }}>
                          <Text style={{ fontSize: 16, fontWeight: "700", color: TXT }} numberOfLines={1}>{r.name}</Text>
                          <Text style={{ fontSize: 13, color: TXT2, marginTop: 4 }} numberOfLines={1}>
                            {paid ? "No open balance" : `${r.openCount} credit${r.openCount === 1 ? "" : "s"} open`}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 16.5, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(r.balance)}</Text>
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: status.color, marginTop: 4 }}>{status.text}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={17} color={TXT3} />
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
                    <Empty text="No credit customers yet — issue credit from the register and it shows up here." />
                  </View>
                )}
              </View>
            </View>

            {/* Takeaway */}
            <View style={{ marginTop: 16, flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 20, borderWidth: 0.5, borderColor: GREEN_BD, padding: 18 }}>
              <Ionicons name="sparkles" size={18} color={GREEN} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 14.5, lineHeight: 21, color: TXT2 }}>
                <Text style={{ fontWeight: "800", color: TXT }}>{custInsight.lead} </Text>
                {custInsight.body}
              </Text>
            </View>

            <Text style={{ fontSize: 11.5, color: TXT3, marginTop: 16, lineHeight: 16 }}>
              Tap a customer for their payment history, behavior and a suggested limit. Suggestions are guidance — the decision stays with you.
            </Text>
          </>
        )}
      </ScrollView>
      {profileId ? (
        <CreditCustomerProfile
          customerId={profileId}
          credits={data.credits}
          payments={data.payments}
          customers={data.customers}
          onClose={() => setProfileId(null)}
          onChanged={() => { refresh(false).catch(() => {}); }}
        />
      ) : null}
    </>
  );
}
