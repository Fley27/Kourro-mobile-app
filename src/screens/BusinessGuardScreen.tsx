// Business Guard — the weekly control room inside Reports (renamed from KPI).
// Three tabs, spec-ordered:
//   Queue   — the weekly action queue, week-sectioned like the design:
//             THIS WEEK first (unconfirmed until Monday's 7:00 AM review),
//             then each earlier week: the Monday-review banner, shift reports
//             waiting to be confirmed (confirm = closed + confirmed clock-out),
//             YOUR DECISION rows with Decide, ABOVE YOUR LEVEL rows (locked
//             to the role that can decide them), and the resolved rows.
//   Health  — business health, styled after the visual mock:
//             net profit (gross − unrecovered + recovered − salaries, current
//             week excluded and footnoted, "Partial" pill), efficiency
//             (revenue/transactions per hour with deltas vs the previous
//             period, weekly revenue-per-labor-hour line), when-you-perform-
//             best (7×16 revenue heat map over 8 weeks + peak window), and
//             staffing match (hourly sales vs staff on floor, weekday/weekend
//             toggle, understaffed hours in red).
//   Staff  — employees list → profile (mock-led): identity with a "reports
//             to" line and a flag pill, a stats card (revenue, hours, 8-week
//             performance trend, deficit limits with bars), a 7-day login &
//             activity timeline, and the employee's own deficit history.
//             Cashiers display as "Associate"; owner sees everyone.
//
// All math lives in ../../businessGuard so it can be checked outside the
// screen; this file only loads rows and renders them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, AppState, ActivityIndicator, useWindowDimensions, TextInput, Modal } from "react-native";
import { Text } from "../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import { fmt, fmtG, monoStyle } from "../format";
import { getDb } from "../db";
import { syncNow } from "../sync/autoSync";
import { useResponsive } from "../responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LineChart } from "../components/charts";
import { loadAnalyticsData, type AnalyticsData } from "../analytics/load";
import { notifyWeeklyDeficitReview } from "../notifications";
import { USERS, ROLE_RANK, getUserById } from "../users";
import ShiftReportDetail, { type ReportDetailData, resolveReportShift, paymentInReportShift } from "./ShiftReportDetail";
import { itemCostsFor, profitTotals, variantIndex } from "../analytics/metrics";
import {
  DAY,
  WEEKDAY_LABELS,
  addDays,
  canLogDeficitFor,
  cascadeCashierIds,
  dayKey,
  dayTimeline,
  deficitFlag,
  deficitState,
  employeeStats,
  epoch,
  excludedUnsettled,
  hoursWorked,
  hourTag,
  inLocalDay,
  localDayRange,
  netProfit,
  perHourMetrics,
  proratedSalaries,
  queueRows,
  revenueHeat,
  scopeRoles,
  sessionsFromShifts,
  staffingByHour,
  weekBucket,
  weekStart,
  weeklyRevenuePerHour,
  type DayTimeline,
  type DeficitRow,
  type Resolution,
  type EmployeeStats,
  type QueueRow,
} from "../businessGuard";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";
import { FALLBACK_STORE_ID } from "../db/ids";
import { mintId } from "../db/ids";

const BG = "rgba(0,0,0,0.96)";
const CARD = "rgba(255,255,255,0.05)";
const CARD_BD = "rgba(255,255,255,0.09)";
const LINE = "rgba(255,255,255,0.09)";
const SEG_BG = "rgba(255,255,255,0.05)";
const SEG_ACTIVE = "rgba(255,255,255,0.10)";
const RADIUS = 24;
const GREEN = "#5ce68a";
const GREEN_TINT = "rgba(92,230,138,0.10)";
const GREEN_BD = "rgba(92,230,138,0.35)";
const AMBER = "#f0a63c";
const AMBER_TINT = "rgba(240,166,60,0.10)";
const AMBER_BD = "rgba(240,166,60,0.35)";
const RED = "#e06c5b";
const RED_TINT = "rgba(224,108,91,0.10)";
const RED_BD = "rgba(224,108,91,0.35)";
const TXT = "#ffffff";
const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";
const INACTIVE = "#8a8a8e";
const TRACK = "#242426";

const EYEBROW = {
  fontSize: 11,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  color: TXT2,
};

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

const TABS: [string, string][] = [["queue", "Queue"], ["health", "Health"], ["staff", "Staff"]];
type TabKey = "queue" | "health" | "staff";
type RangeKey = "this" | "last" | "28d";
const RANGES: [RangeKey, string][] = [["this", "This week"], ["last", "Last week"], ["28d", "28 days"]];

const STATE_META = {
  open: { label: "Open", color: AMBER, bg: AMBER_TINT, bd: AMBER_BD, icon: "time-outline" },
  paid: { label: "Paid", color: GREEN, bg: GREEN_TINT, bd: GREEN_BD, icon: "checkmark-circle" },
  salary: { label: "From salary", color: GREEN, bg: GREEN_TINT, bd: GREEN_BD, icon: "checkmark-circle" },
  forgiven: { label: "Forgiven", color: TXT2, bg: "rgba(255,255,255,0.07)", bd: CARD_BD, icon: "hand-left-outline" },
} as const;

const HEAT_COLORS: Record<string, string> = {
  none: "rgba(255,255,255,0.05)",
  idle: "rgba(240,166,60,0.55)",
  active: GREEN,
};

/** Queue decision sheet contract — one active row, one chosen resolution. */
export type Decider = {
  activeId: string | null;
  choice: Resolution | null;
  reason: string;
  saving: boolean;
  canDecide: (row: QueueRow) => boolean;
  open: (row: QueueRow) => void;
  cancel: () => void;
  pick: (c: Resolution) => void;
  setReason: (t: string) => void;
  save: (row: QueueRow) => void;
};

type Loaded = {
  employees: any[];
  shifts: any[];
  deficits: DeficitRow[];
  reports: any[];
  receipts: any[];
  analytics: AnalyticsData;
  flagPct: number;
};

/** A submitted shift report waiting for confirmation, with its row stats. */
export type ReportCard = {
  id: string;
  userId: string;
  name: string;
  role: string;
  reportDate: string;
  submittedLabel: string;
  sales: number;
  cashShort: number;
  standby: number;
  shiftOpen: boolean;
  expected: number;
  actual: number | null;
};

/** One week section of the queue. */
export type BucketModel = {
  bucket: "this" | "last" | "older";
  range: { upper: string; sentence: string; title: string };
  weekHeader: string;
  unconfirmedUntil: string;
  openRows: QueueRow[];      // this-week open rows — visible, not decidable yet
  decideRows: QueueRow[];    // open + in my scope (older weeks)
  aboveRows: QueueRow[];     // open + needs a higher role (older weeks)
  resolvedRows: QueueRow[];
  reports: ReportCard[];
  openCount: number;
  openSum: number;
};

const ROLE_RANKS: Record<string, number> = ROLE_RANK as unknown as Record<string, number>;
const rankOf = (r?: string | null) => (r ? ROLE_RANKS[String(r)] ?? 1 : 0);

/** Deficits of managers need an admin; of admins/owners — an owner. */
const LOCK_LABEL: Record<string, string> = { manager: "Admin", admin: "Owner", owner: "Owner", cashier: "Manager" };

/** Employee-facing role names — a cashier is shown as an "Associate". */
const ROLE_TEXT: Record<string, string> = { cashier: "Associate" };
function roleDisplay(role: string): string {
  const key = String(role ?? "").toLowerCase();
  if (ROLE_TEXT[key]) return ROLE_TEXT[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
}

const MON_UP = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const monUp = (ds: string) => MON_UP[Number(ds.slice(5, 7)) - 1] ?? "";
const monT = (ds: string) => { const m = monUp(ds); return m ? m[0] + m.slice(1).toLowerCase() : ""; };

/** Week labels: "SEP 21–27" (same month), "SEP 28 – OCT 4" (crosses). */
function bucketRange(bucket: "this" | "last" | "older", now: number) {
  if (bucket === "older") return { upper: "EARLIER", sentence: "earlier", title: "Earlier", weekHeader: "Earlier" };
  const w = bucket === "this" ? weekStart(now) : addDays(weekStart(now), -7);
  const end = addDays(w, 6);
  const d1 = Number(w.slice(8, 10));
  const d2 = Number(end.slice(8, 10));
  const same = w.slice(0, 7) === end.slice(0, 7);
  const upper = same ? `${monUp(w)} ${d1}–${d2}` : `${monUp(w)} ${d1} – ${monUp(end)} ${d2}`;
  const sentence = same ? `${monT(w)} ${d1}–${d2}` : `${monT(w)} ${d1} – ${monT(end)} ${d2}`;
  const title = same ? `${monT(w)} ${d1} – ${d2}` : `${monT(w)} ${d1} – ${monT(end)} ${d2}`;
  return { upper, sentence, title, weekHeader: bucket === "this" ? `THIS WEEK · ${upper}` : `Week of ${title}` };
}

/** Next Monday 7:00 AM — when this week's deficits become decidable. */
function unconfirmedUntilLabel(): string {
  const d = new Date();
  const delta = ((1 - d.getDay() + 7) % 7) || 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  const wd = next.toLocaleDateString("en-US", { weekday: "short" });
  const mon = next.toLocaleDateString("en-US", { month: "short" });
  return `${wd} ${mon} ${next.getDate()}, 7:00 AM`;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";

const hour1 = (n: number) => `${Math.round(n * 10) / 10} h`;

function CardHead({ title, subtitle, icon, tint = GREEN }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; tint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, paddingTop: 2 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4, color: TXT }}>{title}</Text>
        <Text style={{ fontSize: 14, color: TXT2, marginTop: 5, lineHeight: 19 }}>{subtitle}</Text>
      </View>
      <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BD, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
    </View>
  );
}

function Stat({ label, value, hint, color = TXT }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 150, backgroundColor: CARD, borderRadius: 20, borderWidth: 0.5, borderColor: CARD_BD, padding: 16 }}>
      <Text style={{ ...EYEBROW, fontSize: 10, letterSpacing: 1.4 }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.6, color, marginTop: 8, ...monoStyle }}>{value}</Text>
      {hint ? <Text style={{ fontSize: 12, color: TXT3, marginTop: 5 }}>{hint}</Text> : null}
    </View>
  );
}

function Pill({ text, color, bg, bd }: { text: string; color: string; bg: string; bd: string }) {
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: bg, borderWidth: 1, borderColor: bd }}>
      <Text style={{ fontSize: 11, fontWeight: "800", color, letterSpacing: 0.3 }}>{text}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={{ fontSize: 13.5, color: TXT2, lineHeight: 20, paddingVertical: 10 }}>{text}</Text>;
}

export default function BusinessGuardScreen({
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
  const { padH } = useResponsive();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [data, setData] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<TabKey>("queue");
  const [range, setRange] = useState<RangeKey>("this");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Deficit decision sheet (Queue tab): paid | salary | forgiven + typed reason
  const [decideId, setDecideId] = useState<string | null>(null);
  const [decision, setDecision] = useState<Resolution | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Shift-report confirmation (Queue tab): close report + confirmed clock-out.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [guardReport, setGuardReport] = useState<ReportDetailData | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Owner sees every store; others get assigned stores plus this device's
  // selling store — the same union the other reports scope with.
  const scopedStores = useMemo(() => {
    if (role === "owner") return null;
    const ids = userStoreIds.length ? [...userStoreIds] : [];
    if (!ids.includes(storeId)) ids.push(storeId);
    return ids;
  }, [role, userStoreIds, storeId]);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const one = async (sql: string): Promise<any[]> => {
        try { return ((await db.getAllAsync(sql)) as any[]) ?? []; } catch { return []; }
      };
      const [employees, employeeStores, shifts, deficits, reports, receipts, meta, analytics] = await Promise.all([
        one("SELECT * FROM employees"),
        one("SELECT * FROM employee_stores"),
        one("SELECT * FROM shifts"),
        one("SELECT * FROM cashier_deficits"),
        one("SELECT * FROM daily_reports"),
        one("SELECT sale_id, cashier_id, cashier_name FROM receipts"),
        one("SELECT * FROM _meta"),
        loadAnalyticsData(db, scopedStores),
      ]);
      const inScope = (store: any) => !scopedStores || scopedStores.includes(String(store ?? storeId));
      const empScopes = new Map<string, string[]>();
      for (const es of employeeStores) {
        const arr = empScopes.get(String(es.employee_id)) ?? [];
        arr.push(String(es.store_id));
        empScopes.set(String(es.employee_id), arr);
      }
      const emp = employees.filter((e: any) => inScope(e.store_id) || (empScopes.get(String(e.id)) ?? []).some(s => inScope(s)));
      // Deficit actors are auth user ids (cashier-1…); employees are emp-*.
      // Resolve roles through both spaces — employees win when names match.
      const userByName = new Map(USERS.map(u => [u.name, u]));
      const roleByActor = new Map<string, string>();
      for (const e of emp) {
        roleByActor.set(String(e.id), String(e.role ?? "cashier"));
        const u = userByName.get(String(e.full_name));
        if (u) roleByActor.set(u.id, String(e.role ?? "cashier"));
      }
      for (const u of USERS) if (!roleByActor.has(u.id)) roleByActor.set(u.id, String(u.role));
      // Visibility = what you may decide, OR same-level / higher rows shown
      // read-only ("Above your level" in the queue).
      const actorId = String(currentUser?.id ?? "");
      const myRank = rankOf(String(role));
      const visibleDeficit = (d: any) => {
        const id = String(d.cashier_id);
        if (id === actorId) return true;
        const r = roleByActor.get(id);
        if (!r) return false;
        return canLogDeficitFor(String(role), r) || rankOf(r) >= myRank;
      };
      // Monday 7:00 AM reminder = count of deficits logged LAST week (the
      // past week's new ones the review is for). Rescheduled on every open.
      try {
        const w = weekStart(new Date());
        const lastWeek = addDays(w, -7);
        const newLastWeek = (deficits ?? []).filter((d: any) => {
          const day = dayKey(d.date);
          return day >= lastWeek && day < w;
        }).length;
        notifyWeeklyDeficitReview(newLastWeek).catch(() => {});
      } catch {}
      const flagPctRow = (meta ?? []).find((m: any) => String(m.key) === "guard_deficit_flag_pct");
      const flagPct = flagPctRow ? Number(flagPctRow.value) || 0.1 : 0.1;
      if (mounted.current) {
        setData({
          employees: emp,
          shifts: (shifts ?? []).filter((s: any) => inScope(s.store_id)),
          deficits: (deficits ?? []).filter((d: any) => inScope(d.store_id) && visibleDeficit(d)),
          reports: (reports ?? []).filter((r: any) => inScope(r.store_id)),
          receipts: receipts ?? [],
          analytics,
          flagPct,
        });
      }
    } catch {}
  }, [scopedStores, storeId, role, currentUser]);

  async function refresh(withCloud: boolean) {
    if (!mounted.current) return;
    setRefreshing(true);
    try {
      if (withCloud) {
        try { await syncNow({ quiet: true, storeId, deviceId }); } catch {}
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
        const { salesEvents } = await import("../salesEvents");
        unsub = salesEvents.subscribe(() => { load().catch(() => {}); });
      } catch {}
    })();
    const t = setInterval(() => { load().catch(() => {}); }, 15000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") refresh(false); });
    return () => { clearInterval(t); sub.remove(); if (unsub) unsub(); };
  }, [load]);

  const now = Date.now();
  const windows: Record<RangeKey, { from: number; to: number }> = useMemo(() => {
    const w = Date.parse(`${weekStart(now)}T00:00:00Z`);
    return {
      this: { from: w, to: now + 1 },
      last: { from: w - 7 * DAY, to: w },
      "28d": { from: now - 28 * DAY, to: now + 1 },
    };
  }, [now]);

  const guard = useMemo(() => {
    if (!data) return null;
    const { from, to } = windows[range];
    const sessions = sessionsFromShifts(data.shifts, now);
    const sales = data.analytics.sales.filter((s: any) => {
      const t = s?.created_at ? epoch(s.created_at) : NaN;
      return !isNaN(t) && t >= from && t < to;
    });
    const unitCost = itemCostsFor(data.analytics.model.items, data.analytics.model.batches, data.analytics.costRows);
    const vi = variantIndex({ items: data.analytics.model.items, variants: data.analytics.model.variants });
    const grossProfit = profitTotals(sales, data.analytics.lines, unitCost, vi).profit;
    // A deficit counts toward the period it is RESOLVED in (open ones stay on
    // their logged date); the current week's are excluded — not settled yet.
    const thisWeek = weekStart(now);
    const guardDeficits = data.deficits.filter(d => {
      const anchor = d.resolved_at ? dayKey(d.resolved_at) : dayKey(d.date);
      const t = Date.parse(`${anchor}T00:00:00Z`);
      if (t < from || t >= to) return false;
      return weekStart(anchor) !== thisWeek;
    });
    const salaries = proratedSalaries(data.employees, from, to);
    const np = netProfit({ grossProfit, deficits: guardDeficits, salaries });
    // queueRows resolves names/roles by cashier_id — add an entry per auth
    // user id (deficits reference those), borrowing the matching employee's
    // salary for flag thresholds.
    const guardEmployees = [...data.employees];
    const haveId = new Set(guardEmployees.map(e => String(e.id)));
    for (const u of USERS) {
      if (haveId.has(u.id)) continue;
      const emp = guardEmployees.find(e => String(e.full_name) === u.name);
      guardEmployees.push({ id: u.id, full_name: u.name, role: emp ? String((emp as any).role ?? u.role) : String(u.role), salary: Number((emp as any)?.salary ?? 0) });
    }
    const queue = queueRows(data.deficits, guardEmployees, now, data.flagPct).map(q => {
      const src = data.deficits.find(d => String(d.id) === String(q.id));
      return src?.report_id ? { ...q, reportId: String(src.report_id) } : q;
    });
    const metrics = perHourMetrics(sales, sessions, from, to);
    // Equal-length previous window for the rate deltas ("vs last week").
    const prevWin = range === "this"
      ? { from: Date.parse(`${addDays(thisWeek, -7)}T00:00:00Z`), to: Date.parse(`${thisWeek}T00:00:00Z`) }
      : range === "last"
        ? { from: Date.parse(`${addDays(thisWeek, -14)}T00:00:00Z`), to: Date.parse(`${addDays(thisWeek, -7)}T00:00:00Z`) }
        : { from: now - 28 * DAY, to: now };
    const prevMetrics = perHourMetrics(data.analytics.sales, sessions, prevWin.from, prevWin.to);
    // The pattern sections (weekly line, heat map, staffing) always read the
    // trailing 8 weeks — they describe shape, not the selected money window.
    const patternFrom = Date.parse(`${addDays(thisWeek, -49)}T00:00:00Z`);
    const patternTo = now + 1;
    const trend = weeklyRevenuePerHour(data.analytics.sales, sessions, now, 8);
    const heat = revenueHeat(data.analytics.sales, patternFrom, patternTo, 8, 23);
    const staffWeekday = staffingByHour(data.analytics.sales, sessions, patternFrom, patternTo, "weekday", 8, 23);
    const staffWeekend = staffingByHour(data.analytics.sales, sessions, patternFrom, patternTo, "weekend", 8, 23);
    const excluded = excludedUnsettled(data.deficits, from, to, now);
    return {
      from, to, sessions, sales, np, queue, metrics, prevMetrics,
      trend, heat, staffWeekday, staffWeekend, excluded,
      openCount: data.deficits.filter(d => String(d.status ?? "") !== "resolved").length,
      flaggedCount: queue.filter(q => q.flagged && q.state === "open").length,
    };
  }, [data, windows, range, now]);

  // Shifts, sales and deficits are stamped with auth logins (cashier-1…)
  // while employees are emp-*. Map every staff row back into the employees'
  // id space (sales also fall back to the receipts snapshot — cashier_id /
  // cashier_name — for rows stamped before seller_id existed), otherwise
  // every per-person revenue/hours/flag filter matches nothing.
  const norm = useMemo(() => {
    if (!data) return null;
    const byLogin = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const e of data.employees) {
      const empId = String(e.id);
      byLogin.set(empId, empId);
      const nm = String(e.full_name ?? "").trim().toLowerCase();
      if (nm && !byName.has(nm)) byName.set(nm, empId);
    }
    for (const u of USERS) {
      const uid = String(u.id);
      if (byLogin.has(uid)) continue;
      byLogin.set(uid, byName.get(String(u.name ?? "").trim().toLowerCase()) ?? uid);
    }
    const toEmp = (v: any) => byLogin.get(String(v ?? "")) ?? String(v ?? "");
    const receiptEmp = new Map<string, string>();
    for (const r of data.receipts ?? []) {
      const emp = (r?.cashier_id ? byLogin.get(String(r.cashier_id)) : null)
        ?? (r?.cashier_name ? byName.get(String(r.cashier_name).trim().toLowerCase()) : null);
      if (emp) receiptEmp.set(String(r.sale_id), emp);
    }
    const sales = (data.analytics.sales ?? []).map((s: any) => ({
      ...s,
      seller_id: String(s?.seller_id ?? "") ? toEmp(s.seller_id) : receiptEmp.get(String(s?.id ?? "")) ?? null,
    }));
    const shifts = (data.shifts ?? []).map((s: any) => ({ ...s, cashier_id: toEmp(s.cashier_id), manager_id: toEmp(s.manager_id) }));
    const deficits = (data.deficits ?? []).map((d: DeficitRow) => ({ ...d, cashier_id: toEmp(d.cashier_id) }));
    return { sales, shifts, deficits };
  }, [data]);

  const staffList = useMemo(() => {
    if (!data || !norm) return [];
    const { from, to } = windows[range];
    const sessions = sessionsFromShifts(norm.shifts, now);
    // Scope: owner sees everyone; admin sees managers + cashiers; a manager
    // sees themselves plus their own cashiers (cascade), owner sees everything.
    const actorRole = String(role);
    const actorId = String(currentUser?.id ?? "");
    const visible = data.employees.filter((e: any) => {
      const id = String(e.id);
      const r = String(e.role ?? "cashier");
      if (actorRole === "owner") return true;
      if (id === actorId) return true;
      if (scopeRoles(actorRole).includes(r as any)) return true;
      return false;
    });
    const managerCashiers = (id: string) =>
      new Set(cascadeCashierIds(norm.shifts, id).map(String));
    return visible
      .map((e: any) => {
        const id = String(e.id);
        const cascade = managerCashiers(id);
        const stats: EmployeeStats = employeeStats({
          employee: e, sales: norm.sales, sessions,
          deficits: norm.deficits, from, to, now, flagPct: data.flagPct,
        });
        // Manager-level statistics cascade to their own cashiers.
        const kids = data.employees.filter(k => cascade.has(String(k.id)));
        const teamRevenue = kids.reduce((a, k) => a + employeeStats({ employee: k, sales: norm.sales, sessions, deficits: norm.deficits, from, to, now, flagPct: data.flagPct }).revenue, 0);
        const teamHours = kids.reduce((a, k) => a + hoursWorked(sessions, from, to, String(k.id)), 0);
        const teamDeficits = norm.deficits.filter(d => cascade.has(String(d.cashier_id)));
        // The profile's history is the employee's own deficits, not the team's.
        const ownDeficits = norm.deficits.filter(d => String(d.cashier_id) === id);
        return { employee: e, stats, kids, teamRevenue, teamHours, teamDeficits, ownDeficits };
      })
      .sort((a, b) => b.stats.revenue - a.stats.revenue || String(a.employee.full_name).localeCompare(String(b.employee.full_name)));
  }, [data, norm, windows, range, now, role, currentUser]);

  const staffMember = staffId ? staffList.find(p => String(p.employee.id) === staffId) ?? null : null;

  // Profile-only series: the trailing 8-week revenue-per-hour trend, the
  // last 7 days of clocked hours, and the manager this employee reports to.
  const staffTrend = useMemo(() => {
    if (!norm || !staffMember) return null;
    const sessions = sessionsFromShifts(norm.shifts, now);
    return weeklyRevenuePerHour(norm.sales, sessions, now, 8, String(staffMember.employee.id));
  }, [norm, staffMember, now]);

  const staffTimeline = useMemo(() => {
    if (!norm || !staffMember) return null;
    const from = Date.parse(`${addDays(dayKey(now), -6)}T00:00:00Z`);
    const sessions = sessionsFromShifts(norm.shifts, now);
    return dayTimeline(norm.sales, sessions, from, now + 1, String(staffMember.employee.id));
  }, [norm, staffMember, now]);

  // "Reports to": whoever clocked them in most; supervisors (Owner, Admin,
  // Manager) also fall back to the role chain — Manager → Admin → Owner.
  const reportsTo = useMemo(() => {
    if (!data || !norm || !staffMember) return null;
    const emp = staffMember.employee;
    const id = String(emp.id);
    const nameOf = (empId: string) => {
      const e = (data.employees ?? []).find((x: any) => String(x.id) === empId);
      if (e) return String((e as any).full_name ?? empId);
      const u = USERS.find(x => String(x.id) === empId);
      return u ? String(u.name) : null;
    };
    const counts = new Map<string, number>();
    for (const s of norm.shifts ?? []) {
      if (String(s?.cashier_id ?? "") !== id) continue;
      const m = String(s?.manager_id ?? "");
      if (m && m !== id) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    let best = "";
    let n = 0;
    for (const [m, c] of counts) if (c > n) { n = c; best = m; }
    if (best) {
      const nm = nameOf(best);
      if (nm) return nm;
    }
    const r = String(emp.role ?? "").toLowerCase();
    const chain = r === "manager" ? ["admin", "owner"] : r === "admin" ? ["owner"] : [];
    for (const want of chain) {
      const hit = (data.employees ?? []).find((x: any) => String(x.role ?? "").toLowerCase() === want && String(x.id) !== id);
      if (hit) return String((hit as any).full_name ?? "");
      const u = USERS.find(x => String(x.role) === want && String(x.id) !== id);
      if (u) return String(u.name);
    }
    return null;
  }, [data, norm, staffMember]);

  // Supervisor section: each cascaded cashier's rolling-90 deficit as % of
  // their own salary — flagged rows are the ones counting toward this person.
  const staffTeam = useMemo(() => {
    if (!data || !norm || !staffMember || !staffMember.kids.length) return null;
    const rows = staffMember.kids.map((k: any) => {
      const kidId = String(k.id);
      const fl = deficitFlag(
        norm.deficits.filter(d => String(d.cashier_id) === kidId),
        Number(k.salary ?? 0), now, data.flagPct
      );
      const salary = Number(k.salary ?? 0);
      return {
        id: kidId,
        name: String(k.full_name ?? kidId),
        role: String(k.role ?? "cashier"),
        flagged: fl.flagged,
        rolling90: fl.rolling90,
        pct: salary > 0 ? (fl.rolling90 / salary) * 100 : 0,
      };
    }).sort((a, b) => b.pct - a.pct || b.rolling90 - a.rolling90);
    return {
      rows,
      total: rows.reduce((a, r) => a + r.rolling90, 0),
      flaggedCount: rows.filter(r => r.flagged).length,
    };
  }, [data, norm, staffMember, now]);

  // Business Guard → the exact source report behind a deficit (investigation:
  // every itemized line, not just the suspicious total). Lines are attributed
  // to THE shift they were done in — never every shift of the same day.
  const openGuardReport = useCallback(async (reportId: string) => {
    try {
      const db = await getDb();
      const rep = ((await db.getAllAsync("SELECT * FROM daily_reports WHERE id = ?", [reportId]).catch(() => [])) ?? [])[0];
      if (!rep) return;
      const { shift: repShift, inWin } = await resolveReportShift(db, rep);
      const cms = ((await db.getAllAsync("SELECT * FROM cash_movements").catch(() => [])) ?? []) as any[];
      const movements = cms.filter((m: any) => (m.shift_id && repShift && String(m.shift_id) === String(repShift.id)) || (!m.shift_id && inWin(m.created_at) && (m.taken_by ?? null) === (rep.user_id ?? null)));
      const hands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []).filter((h: any) => h.carried_into_report_id === reportId);
      const debts = ((await db.getAllAsync("SELECT * FROM credit_payments").catch(() => [])) ?? [])
        .filter((pp: any) => (pp.collected_by ?? null) === (rep.user_id ?? null) && paymentInReportShift(pp, repShift, inWin));
      const revs = ((await db.getAllAsync("SELECT * FROM report_reviews WHERE report_id = ?", [reportId]).catch(() => [])) ?? []) as any[];
      setGuardReport({ report: rep, shift: repShift, movements, hands, debts, reviews: revs });
    } catch (e) {
      console.log("[guard report] failed:", e);
    }
  }, []);

  if (!data || !guard) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  async function submitDecision(row: QueueRow, choice: Resolution) {
    if (saving) return;
    const text = reason.trim();
    if (choice === "forgiven" && !text) return; // typed reason is required
    setSaving(true);
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync(
        "UPDATE cashier_deficits SET status = ?, resolution = ?, resolution_reason = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?",
        ["resolved", choice, choice === "forgiven" ? text : null, String(currentUser?.id ?? ""), ts, ts, row.id]
      );
      setDecideId(null);
      setDecision(null);
      setReason("");
      await load();
    } catch {
      // Keep the sheet open so the typed reason is never lost.
    } finally {
      setSaving(false);
    }
  }

  const decider: Decider = {
    activeId: decideId,
    choice: decision,
    reason,
    saving,
    canDecide: row => row.state === "open" && row.bucket !== "this" && canLogDeficitFor(String(role), row.cashierRole),
    open: row => {
      setDecideId(prev => (prev === row.id ? null : row.id));
      setDecision(null);
      setReason("");
    },
    cancel: () => { setDecideId(null); setDecision(null); setReason(""); },
    pick: c => setDecision(c),
    setReason,
    save: row => submitDecision(row, decision ?? "paid"),
  };

  const rangeLabel = RANGES.find(r => r[0] === range)?.[1] ?? "";

  // Confirm = close the report + write the confirmed clock-out + notify the
  // cashier (their session ends via the App.tsx report watcher).
  async function confirmSubmittedReport(rep: ReportCard) {
    if (confirming) return;
    setConfirming(true);
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync(
        "UPDATE daily_reports SET status = 'closed', closed_at = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        [ts, String(currentUser?.id ?? ""), ts, rep.id]
      );
      try {
        await db.runAsync(
          "UPDATE shifts SET status = 'closed', end_time = ?, manager_confirmed = 1, updated_at = ? WHERE cashier_id = ? AND start_time >= ? AND start_time < ? AND status = 'open'",
          [ts, ts, rep.userId, ...localDayRange(rep.reportDate)]
        );
      } catch {}
      try {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [mintId(), rep.userId, "report_confirmed", rep.id,
            `Rapò ${rep.reportDate} konfime pa ${currentUser?.name ?? role}. Chanjman ou fèmen — ou ka dekonekte.`, "pending", ts]);
      } catch {}
      setConfirmId(null);
      await load();
    } catch {} finally {
      setConfirming(false);
    }
  }

  const confirm = {
    activeId: confirmId,
    saving: confirming,
    open: (id: string) => setConfirmId(prev => (prev === id ? null : id)),
    cancel: () => setConfirmId(null),
    save: (rep: ReportCard) => confirmSubmittedReport(rep),
  };

  // Week sections: deficits (split by what this viewer may do) + submitted
  // shift reports, bucketed by their date — this week first.
  const queueBuckets: BucketModel[] = (() => {
    if (!data || !guard) return [];
    const myRank = rankOf(String(role));
    const submitted = (data.reports ?? []).filter((r: any) => {
      if (r.status !== "submitted") return false;
      const sRank = rankOf(String(r.role ?? "cashier"));
      return sRank <= 1 && myRank > sRank && String(r.user_id ?? "") !== String(currentUser?.id ?? "");
    });
    const sales = data.analytics.sales ?? [];
    const asc = (a: QueueRow, b: QueueRow) => a.day.localeCompare(b.day) || b.amount - a.amount;
    const desc = (a: QueueRow, b: QueueRow) => b.day.localeCompare(a.day) || b.amount - a.amount;
    const out: BucketModel[] = [];
    for (const bucket of ["this", "last", "older"] as const) {
      const all = guard.queue.filter(q => q.bucket === bucket);
      const open = all.filter(q => q.state === "open");
      const resolved = all.filter(q => q.state !== "open");
      const reports: ReportCard[] = submitted
        .filter(r => weekBucket(dayKey(String(r.report_date ?? "")), now) === bucket)
        .map((r: any) => {
          const day = String(r.report_date ?? "");
          const mine = sales.filter((x: any) => String(x.seller_id ?? "") === String(r.user_id) && inLocalDay(x?.created_at, day));
          const cashMine = mine.filter((x: any) => x.payment_method === "cash");
          const t = r.submitted_at ? new Date(r.submitted_at) : null;
          const timeLabel = t && !isNaN(t.getTime()) ? t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
          return {
            id: String(r.id),
            userId: String(r.user_id ?? ""),
            name: getUserById(String(r.user_id ?? ""))?.name ?? String(r.user_id ?? ""),
            role: String(r.role ?? "cashier"),
            reportDate: day,
            submittedLabel: timeLabel ? `End-of-shift · submitted ${timeLabel}` : "End-of-shift · submitted",
            sales: mine.filter((x: any) => !Number(x.standby ?? 0)).reduce((a, x) => a + Number(x.total ?? 0), 0),
            cashShort: Number(r.deficit ?? 0),
            standby: cashMine.filter((x: any) => Number(x.standby ?? 0)).reduce((a, x) => a + Number(x.total ?? 0), 0),
            shiftOpen: (data.shifts ?? []).some((sh: any) => String(sh.cashier_id ?? "") === String(r.user_id) && String(sh.status ?? "") === "open" && inLocalDay(sh?.start_time, day)),
            expected: Number(r.expected_cash ?? 0),
            actual: r.actual_cash == null ? null : Number(r.actual_cash),
          } as ReportCard;
        })
        .sort((a, b) => b.reportDate.localeCompare(a.reportDate));
      const decideRows = bucket === "this" ? [] : open.filter(q => canLogDeficitFor(String(role), q.cashierRole)).sort(asc);
      const aboveRows = bucket === "this" ? [] : open.filter(q => !canLogDeficitFor(String(role), q.cashierRole)).sort(asc);
      const openRows = bucket === "this" ? open.sort(asc) : [];
      const resolvedRows = resolved.sort(desc);
      if (!decideRows.length && !aboveRows.length && !openRows.length && !resolvedRows.length && !reports.length) continue;
      const rg = bucketRange(bucket, now);
      out.push({
        bucket,
        range: rg,
        weekHeader: rg.weekHeader,
        unconfirmedUntil: unconfirmedUntilLabel(),
        openRows, decideRows, aboveRows, resolvedRows, reports,
        openCount: open.length,
        openSum: open.reduce((a, q) => a + q.amount, 0),
      });
    }
    return out;
  })();

  return (
    <>
      <KeyboardSafeScrollView
        style={{ flex: 1, backgroundColor: BG }}
        contentContainerStyle={{ padding: padH, paddingTop: 8, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={GREEN} colors={[GREEN]} />}
      >
        {/* Header */}
        <View style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN }} />
              <Text style={{ ...EYEBROW, color: GREEN }}>Reports · Weekly review</Text>
            </View>
            <Text style={{ fontSize: 34, fontWeight: "800", color: TXT, letterSpacing: -1, marginTop: 8 }}>Business Guard</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {onBack ? (
              <Pressable onPress={onBack} accessibilityLabel="Back" style={SQUARE}>
                <Ionicons name="chevron-back" size={22} color={TXT} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => refresh(true)} disabled={refreshing} accessibilityLabel="Refresh" style={SQUARE}>
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
                onPress={() => { setTab(key as TabKey); setStaffId(null); }}
                style={{ flex: 1, height: 46, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: active ? SEG_ACTIVE : "transparent" }}
              >
                <Text style={{ fontSize: 15, fontWeight: active ? "800" : "600", color: active ? TXT : INACTIVE }} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "queue" ? (
          <>
            <QueueTab buckets={queueBuckets} openCount={guard.openCount} decider={decider} confirm={confirm} onViewReport={openGuardReport} />
            {guardReport ? <ShiftReportDetail data={guardReport} onClose={() => setGuardReport(null)} /> : null}
          </>
        ) : null}

        {tab === "health" ? (
          <HealthTab
            range={range} setRange={setRange} rangeLabel={rangeLabel}
            np={guard.np} metrics={guard.metrics} prevMetrics={guard.prevMetrics}
            excluded={guard.excluded} trend={guard.trend} heat={guard.heat}
            staffWeekday={guard.staffWeekday} staffWeekend={guard.staffWeekend}
            width={winW - padH * 2}
          />
        ) : null}

        {tab === "staff" ? (
          <StaffTab staffList={staffList} onSelect={setStaffId} flagPct={data.flagPct} actorRole={String(role)} actorId={String(currentUser?.id ?? "")} />
        ) : null}
      </KeyboardSafeScrollView>

      {/* Employee profile — a full-height modal over the tabs. */}
      <Modal
        visible={tab === "staff" && staffMember != null}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setStaffId(null)}
      >
        <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top + 8, paddingBottom: insets.bottom }}>
          <KeyboardSafeScrollView contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 44 }} showsVerticalScrollIndicator={false}>
            {staffMember ? (
              <StaffProfile
                back={() => setStaffId(null)}
                staffMember={staffMember}
                rangeLabel={rangeLabel}
                trend={staffTrend}
                timeline={staffTimeline}
                reportsTo={reportsTo}
                team={staffTeam}
                flagPct={data.flagPct}
                canDecideFor={targetRole => canLogDeficitFor(String(role), targetRole)}
              />
            ) : null}
          </KeyboardSafeScrollView>
        </View>
      </Modal>
    </>
  );
}

// ── Tab 1: weekly action queue ─────────────────────────────────────────────

/** Amounts show cents only when they exist: "G 2 185" / "G 42,50". */
const money = (n: number) => {
  const v = Number(n) || 0;
  return fmtG(v, Number.isInteger(v) ? 0 : 2);
};

const AVATAR: Record<string, { bg: string; bd: string; fg: string }> = {
  cashier: { bg: "rgba(46,92,96,0.55)", bd: "rgba(126,186,190,0.35)", fg: "#cfe8e6" },
  manager: { bg: "rgba(126,92,34,0.55)", bd: "rgba(200,162,74,0.4)", fg: "#eccf9a" },
  admin: { bg: "rgba(98,76,142,0.55)", bd: "rgba(154,124,222,0.4)", fg: "#d9cbf5" },
  owner: { bg: "rgba(132,108,44,0.5)", bd: "rgba(200,162,74,0.45)", fg: "#ecd9a5" },
};

function Avatar({ name, role }: { name: string; role: string }) {
  const c = AVATAR[role] ?? AVATAR.cashier;
  return (
    <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: c.bg, borderWidth: 1, borderColor: c.bd, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 15, fontWeight: "800", color: c.fg, letterSpacing: 0.2 }}>{initials(name)}</Text>
    </View>
  );
}

function SectionHead({ label, right, rightColor = TXT3, rightMono = false }: { label: string; right?: string; rightColor?: string; rightMono?: boolean }) {
  return (
    <View style={{ marginTop: 24, marginBottom: 10, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ ...EYEBROW, fontSize: 11.5, letterSpacing: 1.7, flexShrink: 1 }}>{label}</Text>
      {right ? (
        <Text style={{ fontSize: rightMono ? 14 : 12.5, fontWeight: rightMono ? 800 : 600, color: rightColor, ...(rightMono ? monoStyle : {}) }}>{right}</Text>
      ) : null}
    </View>
  );
}

function GroupedCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, overflow: "hidden" }}>
      {children}
    </View>
  );
}

type RowMode = "unconfirmed" | "decide" | "locked" | "resolved";

function DeficitRow({ row, decider, mode, first, onViewReport }: { row: QueueRow; decider: Decider; mode: RowMode; first: boolean; onViewReport: (reportId: string) => void }) {
  const meta = STATE_META[row.state] ?? STATE_META.open;
  const dayLabel = new Date(Date.parse(`${row.day}T00:00:00Z`))
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const reason = row.state === "forgiven" && row.resolutionReason ? row.resolutionReason : null;
  const roleLabel = roleDisplay(row.cashierRole || "cashier");
  const subtitle = `${roleLabel} · ${dayLabel}${reason ? ` · ${reason}` : ""}`;
  const active = decider.activeId === row.id;
  return (
    <View>
      {!first ? <View style={{ height: 0.5, backgroundColor: LINE }} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 16, paddingVertical: 15 }}>
        <Avatar name={row.cashierName} role={row.cashierRole} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: TXT, letterSpacing: -0.2, flexShrink: 1 }} numberOfLines={1}>{row.cashierName}</Text>
            {row.flagged && row.state === "open" ? <Ionicons name="flag" size={12} color={RED} /> : null}
          </View>
          <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 3 }} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: TXT, ...monoStyle }}>{money(row.amount)}</Text>
          {mode === "decide" ? (
            <Pressable onPress={() => decider.open(row)} hitSlop={8}>
              <Text style={{ fontSize: 12.5, fontWeight: "800", color: AMBER }}>Decide →</Text>
            </Pressable>
          ) : mode === "locked" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Ionicons name="lock-closed-outline" size={12} color={TXT3} />
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: TXT3 }}>{LOCK_LABEL[row.cashierRole] ?? "Admin"}</Text>
            </View>
          ) : mode === "resolved" ? (
            <Pill text={`● ${meta.label}`} color={meta.color} bg={meta.bg} bd={meta.bd} />
          ) : null}
        </View>
      </View>
      {row.reportId ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Pressable onPress={() => onViewReport(row.reportId!)} hitSlop={6}>
            <Text style={{ fontSize: 12, fontWeight: "800", color: TXT2 }}>Wè rapò sous la →</Text>
          </Pressable>
        </View>
      ) : null}
      {active ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
          <DecisionSheet row={row} decider={decider} />
        </View>
      ) : null}
    </View>
  );
}

type ConfirmContract = {
  activeId: string | null;
  saving: boolean;
  open: (id: string) => void;
  cancel: () => void;
  save: (rep: ReportCard) => void;
};

function ReportConfirmCard({ rep, confirm }: { rep: ReportCard; confirm: ConfirmContract }) {
  const active = confirm.activeId === rep.id;
  const col = (label: string, value: string, color: string) => (
    <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 12 }}>
      <Text style={{ fontSize: 11.5, color: TXT3 }}>{label}</Text>
      <Text style={{ fontSize: 15.5, fontWeight: "800", color, marginTop: 4, ...monoStyle }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, overflow: "hidden" }}>
      <Pressable onPress={() => confirm.open(rep.id)} style={{ flexDirection: "row", alignItems: "center", gap: 13, padding: 16 }}>
        <Avatar name={rep.name} role={rep.role} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16.5, fontWeight: "800", color: TXT, letterSpacing: -0.2 }} numberOfLines={1}>{rep.name}</Text>
          <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 3 }} numberOfLines={1}>{rep.submittedLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={TXT3} />
      </Pressable>
      <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderColor: LINE }}>
        {col("Sales", money(rep.sales), TXT)}
        <View style={{ width: 0.5, backgroundColor: LINE }} />
        {col("Cash short", money(rep.cashShort), rep.cashShort > 0 ? RED : TXT2)}
        <View style={{ width: 0.5, backgroundColor: LINE }} />
        {col("Standby", `${rep.standby > 0 ? "+" : ""}${money(rep.standby)}`, rep.standby > 0 ? TXT : TXT2)}
      </View>
      {rep.shiftOpen ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 0.5, borderColor: LINE, backgroundColor: "rgba(255,255,255,0.04)" }}>
          <Ionicons name="exit-outline" size={14} color={TXT2} />
          <Text style={{ fontSize: 12, color: TXT2, flex: 1 }}>Still clocked in — logs out when you confirm</Text>
        </View>
      ) : null}
      {active ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
          <ConfirmSheet rep={rep} confirm={confirm} />
        </View>
      ) : null}
    </View>
  );
}

function ConfirmSheet({ rep, confirm }: { rep: ReportCard; confirm: ConfirmContract }) {
  const mini = (label: string, value: string, color = TXT) => (
    <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, borderWidth: 0.5, borderColor: CARD_BD, padding: 10 }}>
      <Text style={{ fontSize: 9.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, color: TXT3 }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: "800", color, marginTop: 5, ...monoStyle }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: CARD_BD, padding: 14 }}>
      <Text style={{ ...EYEBROW, fontSize: 10, letterSpacing: 1.4 }}>Confirm end of shift</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        {mini("Expected", money(rep.expected))}
        {mini("Counted", rep.actual != null ? money(rep.actual) : "—")}
        {mini("Deficit", money(rep.cashShort), rep.cashShort > 0 ? RED : GREEN)}
      </View>
      <Text style={{ fontSize: 12.5, color: TXT2, lineHeight: 18, marginTop: 10 }}>
        Closes the report and clocks {rep.name.split(/\s+/)[0] ?? "the cashier"} out{rep.shiftOpen ? " — they are still clocked in, so their session ends too" : ""}.
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Pressable
          onPress={() => confirm.save(rep)}
          disabled={confirm.saving}
          style={{ flex: 1, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: GREEN, opacity: confirm.saving ? 0.6 : 1 }}
        >
          <Text style={{ fontSize: 14.5, fontWeight: "800", color: "#07230f" }}>{confirm.saving ? "Confirming…" : "Confirm & clock out"}</Text>
        </Pressable>
        <Pressable onPress={confirm.cancel} style={{ width: 92, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: CARD_BD }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: TXT2 }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QueueTab({ buckets, openCount, decider, confirm, onViewReport }: {
  buckets: BucketModel[];
  openCount: number;
  decider: Decider;
  confirm: ConfirmContract;
  onViewReport: (reportId: string) => void;
}) {
  if (!buckets.length) {
    return (
      <View style={{ marginTop: 20, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
        <CardHead
          title="Weekly action queue"
          subtitle={openCount === 0 ? "Nothing is waiting on a decision." : `${openCount} deficit${openCount === 1 ? "" : "s"} still awaiting a decision.`}
          icon="list-outline"
        />
        <Text style={{ fontSize: 13.5, color: TXT2, lineHeight: 20, marginTop: 14 }}>
          Queue clear. No deficit or shift report is waiting on this scope.
        </Text>
      </View>
    );
  }
  return <>{buckets.map(b => <WeekSection key={b.bucket} b={b} decider={decider} confirm={confirm} onViewReport={onViewReport} />)}</>;
}

function WeekSection({ b, decider, confirm, onViewReport }: { b: BucketModel; decider: Decider; confirm: ConfirmContract; onViewReport: (reportId: string) => void }) {
  const isThis = b.bucket === "this";
  const showMonday = b.bucket === "last" && b.openCount > 0;
  const decideSum = b.decideRows.reduce((a, q) => a + q.amount, 0);
  return (
    <View style={{ marginTop: 26 }}>
      {isThis ? (
        <Text style={{ ...EYEBROW, fontSize: 12.5, letterSpacing: 1.8 }}>{b.weekHeader}</Text>
      ) : (
        <Text style={{ fontSize: 16.5, fontWeight: "600", color: TXT2, letterSpacing: -0.2 }}>{b.weekHeader}</Text>
      )}

      {showMonday ? (
        <View style={{ marginTop: 14, flexDirection: "row", gap: 14, backgroundColor: "rgba(240,166,60,0.06)", borderRadius: 20, borderWidth: 1, borderColor: AMBER_BD, padding: 16, alignItems: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: AMBER, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="notifications" size={21} color="#20130a" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ ...EYEBROW, color: AMBER, fontSize: 11, letterSpacing: 1.8 }}>Monday review</Text>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: AMBER }}>Mon 7:00 AM</Text>
            </View>
            <Text style={{ fontSize: 15, fontWeight: "600", color: TXT, marginTop: 6, lineHeight: 21 }}>
              {b.openCount} deficit{b.openCount === 1 ? "" : "s"} from {b.range.sentence} need{b.openCount === 1 ? "s" : ""} a decision · <Text style={monoStyle}>{money(b.openSum)}</Text>
            </Text>
          </View>
        </View>
      ) : null}

      {b.reports.length ? (
        <>
          <SectionHead label="Shift reports to confirm" right={`${b.reports.length} waiting`} />
          <View style={{ gap: 12 }}>
            {b.reports.map(rep => <ReportConfirmCard key={rep.id} rep={rep} confirm={confirm} />)}
          </View>
        </>
      ) : null}

      {isThis ? (
        b.openRows.length ? (
          <>
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 18, borderWidth: 1, borderColor: CARD_BD, padding: 15 }}>
              <Ionicons name="lock-closed-outline" size={15} color={TXT2} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 13.5, color: TXT2, lineHeight: 19.5 }}>
                Unconfirmed until {b.unconfirmedUntil}. Not counted in any monthly total yet.
              </Text>
            </View>
            <View style={{ marginTop: 12 }}>
              <GroupedCard>
                {b.openRows.map((row, i) => (
                  <DeficitRow key={row.id} row={row} decider={decider} mode="unconfirmed" first={i === 0} onViewReport={onViewReport} />
                ))}
              </GroupedCard>
            </View>
          </>
        ) : null
      ) : (
        <>
          {b.decideRows.length ? (
            <>
              <SectionHead label={`Your decision · ${b.range.upper}`} right={money(decideSum)} rightColor={TXT} rightMono />
              <GroupedCard>
                {b.decideRows.map((row, i) => (
                  <DeficitRow key={row.id} row={row} decider={decider} mode={decider.canDecide(row) ? "decide" : "locked"} first={i === 0} onViewReport={onViewReport} />
                ))}
              </GroupedCard>
            </>
          ) : null}

          {b.aboveRows.length ? (
            <>
              <SectionHead label="Above your level" />
              <GroupedCard>
                {b.aboveRows.map((row, i) => (
                  <DeficitRow key={row.id} row={row} decider={decider} mode="locked" first={i === 0} onViewReport={onViewReport} />
                ))}
              </GroupedCard>
            </>
          ) : null}
        </>
      )}

      {b.resolvedRows.length ? (
        <>
          <SectionHead label={isThis ? "Resolved this week" : `Resolved · ${b.range.upper}`} right={`${b.resolvedRows.length} closed`} />
          <GroupedCard>
            {b.resolvedRows.map((row, i) => (
              <DeficitRow key={row.id} row={row} decider={decider} mode="resolved" first={i === 0} onViewReport={onViewReport} />
            ))}
          </GroupedCard>
        </>
      ) : null}
    </View>
  );
}

const CHOICES: [Resolution, string][] = [["paid", "Paid by employee"], ["salary", "Taken from salary"], ["forgiven", "Forgiven"]];

function DecisionSheet({ row, decider }: { row: QueueRow; decider: Decider }) {
  const choice = decider.choice;
  const valid = choice === "forgiven" ? reason_ok(decider.reason) : choice !== null;
  return (
    <View style={{ borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: CARD_BD, padding: 14 }}>
      <Text style={{ ...EYEBROW, fontSize: 10, letterSpacing: 1.4 }}>Record a decision · {money(row.amount)}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        {CHOICES.map(([key, label]) => {
          const active = choice === key;
          const c = key === "forgiven" ? TXT2 : GREEN;
          return (
            <Pressable
              key={key}
              onPress={() => decider.pick(key)}
              style={{ flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: active ? (key === "forgiven" ? "rgba(255,255,255,0.10)" : GREEN_TINT) : "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: active ? (key === "forgiven" ? CARD_BD : GREEN_BD) : "transparent" }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: active ? c : INACTIVE }} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {choice === "forgiven" ? (
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={decider.reason}
            onChangeText={decider.setReason}
            placeholder="Reason (required)"
            placeholderTextColor={TXT3}
            multiline
            style={{ minHeight: 62, borderRadius: 12, borderWidth: 1, borderColor: decider.reason.trim() ? CARD_BD : RED_BD, backgroundColor: "rgba(255,255,255,0.05)", color: TXT, fontSize: 14, padding: 12, textAlignVertical: "top" }}
          />
          <Text style={{ fontSize: 11.5, color: decider.reason.trim() ? TXT3 : RED, marginTop: 6 }}>
            Forgiving a deficit needs a typed reason — it stays on the employee's record.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Pressable
          onPress={() => decider.save(row)}
          disabled={!valid || decider.saving}
          style={{ flex: 1, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: valid ? GREEN : "rgba(255,255,255,0.10)", opacity: decider.saving ? 0.6 : 1 }}
        >
          <Text style={{ fontSize: 14.5, fontWeight: "800", color: valid ? "#07230f" : INACTIVE }}>
            {decider.saving ? "Saving…" : "Save decision"}
          </Text>
        </Pressable>
        <Pressable onPress={decider.cancel} style={{ width: 92, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: CARD_BD }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: TXT2 }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const reason_ok = (t: string) => t.trim().length > 0;

// ── Tab 2: business health ─────────────────────────────────────────────────

// Mock palette: the health tab runs on gold/cream (line, heat, accents), red
// for short-handed hours, tan for overstaffed — everything else stays neutral.
const GOLD = "#d8bd8b";
const GOLD_BD = "rgba(216,189,139,0.5)";
const TAN = "#a09667";

/** Heat intensity → cell fill (dark neutral → olive → gold → cream peak). */
const HEAT_BG = (t: number): string =>
  t <= 0.001 ? "rgba(255,255,255,0.05)"
    : t < 0.2 ? "#413c30"
    : t < 0.4 ? "#6d6244"
    : t < 0.6 ? "#98875a"
    : t < 0.8 ? "#c4ad72"
    : "#ffe9b4";

/** Uppercase section label with an optional right-hand caption. */
function SectionLabel({ label, right }: { label: string; right?: string }) {
  return (
    <View style={{ marginTop: 26, flexDirection: "row", alignItems: "center" }}>
      <Text style={{ flex: 1, ...EYEBROW }}>{label}</Text>
      {right ? <Text style={{ fontSize: 12, color: TXT3 }}>{right}</Text> : null}
    </View>
  );
}

/** One efficiency KPI: label, big rate, delta vs the previous period. */
function KpiCard({ label, value, delta, prevLabel, accent, note }: {
  label: string;
  value: string;
  delta: number | null;
  prevLabel: string;
  accent?: boolean;
  note?: string | null;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: accent ? GOLD_BD : CARD_BD, padding: 16 }}>
      <Text style={{ fontSize: 14, color: TXT2 }}>{label}</Text>
      <Text style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.8, color: TXT, marginTop: 8, ...monoStyle }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
        {note != null ? (
          <Text style={{ fontSize: 12, color: TXT3 }}>{note}</Text>
        ) : delta != null ? (
          <>
            <Ionicons name={delta >= 0 ? "arrow-up" : "arrow-down"} size={12} color={delta >= 0 ? GREEN : RED} />
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: delta >= 0 ? GREEN : RED }}>{`${Math.abs(delta).toFixed(1)}%`}</Text>
            <Text style={{ fontSize: 12, color: TXT3 }}>vs {prevLabel}</Text>
          </>
        ) : (
          <Text style={{ fontSize: 12, color: TXT3 }}>No prior period</Text>
        )}
      </View>
    </View>
  );
}

function LegendDot({ color, label, bar }: { color: string; label: string; bar?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {bar ? (
        <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: color }} />
      ) : (
        <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color }} />
      )}
      <Text style={{ fontSize: 11.5, color: TXT3 }}>{label}</Text>
    </View>
  );
}

function HealthTab({
  range, setRange, rangeLabel, np, metrics, prevMetrics, excluded, trend, heat, staffWeekday, staffWeekend, width,
}: {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  rangeLabel: string;
  np: ReturnType<typeof netProfit>;
  metrics: ReturnType<typeof perHourMetrics>;
  prevMetrics: ReturnType<typeof perHourMetrics>;
  excluded: number;
  trend: ReturnType<typeof weeklyRevenuePerHour>;
  heat: ReturnType<typeof revenueHeat>;
  staffWeekday: ReturnType<typeof staffingByHour>;
  staffWeekend: ReturnType<typeof staffingByHour>;
  width: number;
}) {
  const [staffGroup, setStaffGroup] = useState<"weekday" | "weekend">("weekday");
  const prevLabel = range === "this" ? "last week" : range === "last" ? "prior week" : "prior 4 wks";
  const pctDelta = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  // Hero — "G 26 794,50" split: big head, small grey cents, sign on the head.
  const heroSign = np.total < 0 ? "−" : "";
  const heroRaw = fmtG(Math.abs(np.total), 2);
  const commaAt = heroRaw.lastIndexOf(",");
  const heroHead = `${heroSign}${commaAt >= 0 ? heroRaw.slice(0, commaAt) : heroRaw}`;
  const heroCents = commaAt >= 0 ? heroRaw.slice(commaAt) : "";

  const npRows: Array<{ label: string; hint: string; text: string; color: string }> = [
    { label: "Gross profit", hint: "From General Analytics", text: fmtG(np.grossProfit), color: TXT },
    { label: "Unrecovered deficits", hint: "Forgiven or left unpaid", text: np.unrecovered > 0 ? `−${fmtG(np.unrecovered)}` : fmtG(0), color: RED },
    { label: "Recovered deficits", hint: "Paid or taken from salary", text: np.recovered > 0 ? `+${fmtG(np.recovered)}` : fmtG(0), color: GREEN },
    { label: "Salaries paid", hint: `Payroll · ${rangeLabel.toLowerCase()}`, text: np.salaries > 0 ? `−${fmtG(np.salaries)}` : fmtG(0), color: TXT },
  ];

  // Weekly line: label every ~third point so the row stays readable.
  const tN = trend.points.length;
  const tIdx = tN <= 4 ? trend.points.map((_, i) => i) : [0, Math.round((tN - 1) / 3), Math.round(((tN - 1) * 2) / 3), tN - 1];

  // Heat grid: hours 8a–11p (16 columns), cells sized to the card width.
  const GAP = 3;
  const DAY_W = 30;
  const cellW = Math.max(6, Math.floor((width - 40 - DAY_W - GAP * 15) / 16));
  const cellH = Math.max(14, cellW + 4);

  const staffData = staffGroup === "weekday" ? staffWeekday : staffWeekend;
  const CH = 150;
  const maxRev = Math.max(0.0001, ...staffData.hours.map(h => h.revenue));
  const maxStaff = Math.max(0.0001, ...staffData.hours.map(h => h.staff));

  return (
    <>
      {/* Range pills */}
      <View style={{ marginTop: 16, flexDirection: "row", backgroundColor: SEG_BG, borderRadius: 999, borderWidth: 0.5, borderColor: CARD_BD, padding: 5, gap: 5 }}>
        {RANGES.map(([key, label]) => {
          const active = range === key;
          return (
            <Pressable key={key} onPress={() => setRange(key)} style={{ flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? SEG_ACTIVE : "transparent" }}>
              <Text style={{ fontSize: 13.5, fontWeight: active ? "800" : "600", color: active ? TXT : INACTIVE }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Net profit — period eyebrow, big hero, line items, footnotes */}
      <Text style={{ ...EYEBROW, marginTop: 18 }}>{rangeLabel} · settled only</Text>
      <View style={{ marginTop: 10, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, overflow: "hidden" }}>
        <View style={{ padding: 22, paddingBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 16.5, fontWeight: "700", color: TXT, letterSpacing: -0.2 }} numberOfLines={1}>
              Net profit · {rangeLabel}
            </Text>
            <Pill text="Partial" color={TXT2} bg="rgba(255,255,255,0.07)" bd={CARD_BD} />
          </View>
          <Text style={{ fontSize: 44, fontWeight: "800", letterSpacing: -1.5, color: np.total >= 0 ? TXT : RED, marginTop: 10, ...monoStyle }} numberOfLines={1} adjustsFontSizeToFit>
            {heroHead}
            <Text style={{ fontSize: 22, fontWeight: "700", color: TXT3 }}>{heroCents}</Text>
          </Text>
          <View style={{ marginTop: 8 }}>
            {npRows.map((r, i) => (
              <View key={r.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: LINE }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontSize: 15.5, fontWeight: "600", color: TXT }}>{r.label}</Text>
                  <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 2 }}>{r.hint}</Text>
                </View>
                <Text style={{ fontSize: 16.5, fontWeight: "700", color: r.color, ...monoStyle }}>{r.text}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ borderTopWidth: 0.5, borderTopColor: LINE, backgroundColor: "rgba(255,255,255,0.03)", padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Ionicons name="information-circle-outline" size={16} color={TXT3} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 12.5, color: INACTIVE, lineHeight: 18 }}>{np.note}</Text>
          </View>
          {excluded > 0 ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="lock-closed-outline" size={14} color={TXT3} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 12.5, color: INACTIVE, lineHeight: 18 }}>
                Excluded: {fmtG(excluded)} logged this week — not settled yet.
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Efficiency */}
      <SectionLabel label="Efficiency" right={`Per hour worked · ${hour1(metrics.hours)} clocked`} />
      <View style={{ marginTop: 12, flexDirection: "row", gap: 12 }}>
        <KpiCard label="Revenue / hr" value={metrics.reliable ? fmtG(metrics.revenuePerHour, 2) : "—"} delta={metrics.reliable ? pctDelta(metrics.revenuePerHour, prevMetrics.revenuePerHour) : null} prevLabel={prevLabel} accent note={metrics.reliable ? null : `Only ${hour1(metrics.hours)} clocked`} />
        <KpiCard label="Transactions / hr" value={metrics.reliable ? String(Math.round(metrics.transactionsPerHour * 10) / 10) : "—"} delta={metrics.reliable ? pctDelta(metrics.transactionsPerHour, prevMetrics.transactionsPerHour) : null} prevLabel={prevLabel} note={metrics.reliable ? null : `Only ${hour1(metrics.hours)} clocked`} />
      </View>
      <View style={{ marginTop: 14, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "700", color: TXT, letterSpacing: -0.2 }}>Revenue per labor hour, weekly</Text>
          <Text style={{ fontSize: 12.5, color: TXT2, ...monoStyle }}>{`${fmt(trend.hours)} hrs · 8 wks`}</Text>
        </View>
        <View style={{ marginTop: 10 }}>
          <LineChart points={trend.points} color={GOLD} height={148} endDot />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
          {tIdx.map((i, k) => (
            <Text key={k} style={{ fontSize: 11, color: TXT3 }}>{trend.points[i]?.label ?? ""}</Text>
          ))}
        </View>
      </View>

      {/* When you perform best */}
      <SectionLabel label="When you perform best" />
      <View style={{ marginTop: 12, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 16.5, fontWeight: "800", color: TXT, letterSpacing: -0.3 }} numberOfLines={1}>
            {heat.peak ? `Peak: ${heat.peak.label}` : "Peak: —"}
          </Text>
          <Text style={{ fontSize: 12.5, color: TXT3 }}>Revenue per hour, 8 wks</Text>
        </View>
        <View style={{ marginTop: 14 }}>
          {WEEKDAY_LABELS.map((d, w) => (
            <View key={d} style={{ flexDirection: "row", alignItems: "center", marginTop: GAP }}>
              <Text style={{ width: DAY_W, fontSize: 10, color: TXT3 }}>{d}</Text>
              {Array.from({ length: 16 }, (_, i) => {
                const rev = heat.cells[w * 24 + (8 + i)]?.revenue ?? 0;
                return (
                  <View
                    key={i}
                    style={{ width: cellW, height: cellH, borderRadius: 4, marginRight: GAP, backgroundColor: HEAT_BG(heat.max > 0 ? rev / heat.max : 0) }}
                  />
                );
              })}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", paddingLeft: DAY_W, marginTop: 8 }}>
          {Array.from({ length: 16 }, (_, i) => (
            <View key={i} style={{ width: cellW + GAP, alignItems: "center" }}>
              {i % 3 === 0 ? <Text style={{ fontSize: 9.5, color: TXT3 }}>{hourTag(8 + i)}</Text> : null}
            </View>
          ))}
        </View>
      </View>

      {/* Staffing match */}
      <SectionLabel label="Staffing match" />
      <View style={{ marginTop: 12, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 16.5, fontWeight: "800", color: TXT, letterSpacing: -0.3 }}>Staffing vs. sales</Text>
          <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12, padding: 3 }}>
            {([["weekday", "Weekday"], ["weekend", "Weekend"]] as const).map(([key, label]) => {
              const active = staffGroup === key;
              return (
                <Pressable key={key} onPress={() => setStaffGroup(key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: active ? "#fff" : "transparent" }}>
                  <Text style={{ fontSize: 13, fontWeight: active ? "800" : "600", color: active ? "#000" : INACTIVE }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Hourly bars — red = the hour took more revenue than its share of
            staff; white dash = staff on floor that hour */}
        <View style={{ height: CH, flexDirection: "row", alignItems: "flex-end", marginTop: 16 }}>
          {staffData.hours.map(h => {
            const barH = h.revenue > 0 ? Math.max(4, Math.round((h.revenue / maxRev) * (CH - 12))) : 0;
            const dash = h.staff > 0 ? Math.round((h.staff / maxStaff) * (CH - 28)) : 0;
            return (
              <View key={h.hour} style={{ flex: 1, height: CH, marginHorizontal: 1.5, justifyContent: "flex-end" }}>
                {barH > 0 ? <View style={{ height: barH, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: h.short ? RED : TAN }} /> : null}
                {h.staff > 0 ? (
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: dash, height: 3, borderRadius: 2, backgroundColor: "#fff" }} />
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          {staffData.hours.map((h, i) => (
            <View key={h.hour} style={{ flex: 1, alignItems: "center" }}>
              {i % 3 === 0 ? <Text style={{ fontSize: 9.5, color: TXT3 }}>{hourTag(h.hour)}</Text> : null}
            </View>
          ))}
        </View>

        {/* Legend */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: "#fff" }} />
            <Text style={{ fontSize: 12.5, color: TXT2 }}>Staff on floor</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: RED }} />
            <Text style={{ fontSize: 12.5, color: TXT2 }}>Understaffed</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: TAN }} />
            <Text style={{ fontSize: 12.5, color: TXT2 }}>Overstaffed</Text>
          </View>
        </View>

        <View style={{ height: 0.5, backgroundColor: LINE, marginTop: 14 }} />
        <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.88)", lineHeight: 20, marginTop: 12 }}>{staffData.insight}</Text>
      </View>
    </>
  );
}

// ── Tab 3: staff profiles ──────────────────────────────────────────────────

function StaffTab({ staffList, onSelect, flagPct, actorId }: {
  staffList: Array<{ employee: any; stats: EmployeeStats; kids: any[]; teamRevenue: number; teamHours: number; teamDeficits: DeficitRow[]; ownDeficits?: DeficitRow[] }>;
  onSelect: (id: string) => void;
  flagPct: number;
  actorRole: string;
  actorId: string;
}) {
  const groups = React.useMemo(() => {
    const ORDER = ["owner", "admin", "manager", "cashier", "associate", "cook"];
    const rank = (r: string) => {
      const i = ORDER.indexOf(String(r ?? "").toLowerCase());
      return i >= 0 ? i : ORDER.length;
    };
    const by = new Map<string, typeof staffList>();
    for (const item of staffList) {
      const r = String(item.employee?.role ?? "cashier").toLowerCase();
      const arr = by.get(r) ?? [];
      arr.push(item);
      by.set(r, arr);
    }
    return [...by.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([role, items]) => ({
        role,
        label: `${roleDisplay(role).toUpperCase()}S`,
        items: [...items].sort((a, b) => b.stats.revenue - a.stats.revenue || String(a.employee.full_name).localeCompare(String(b.employee.full_name))),
      }));
  }, [staffList]);
  return (
    <>
      {groups.map(g => (
        <View key={g.role} style={{ marginTop: 22 }}>
          <Text style={{ ...EYEBROW, fontSize: 11.5, letterSpacing: 1.7 }}>{g.label}</Text>
          <View style={{ marginTop: 10 }}>
            <GroupedCard>
              {g.items.map(({ employee, stats, kids }, i) => {
                const id = String(employee.id);
                const role = String(employee.role ?? "cashier");
                const self = id === actorId;
                return (
                  <View key={id}>
                    {i > 0 ? <View style={{ height: 0.5, backgroundColor: LINE }} /> : null}
                    <Pressable onPress={() => onSelect(id)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 }}>
                      <Avatar name={String(employee.full_name ?? "?")} role={role} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                          <Text style={{ fontSize: 16, fontWeight: "800", color: TXT, letterSpacing: -0.2, flexShrink: 1 }} numberOfLines={1}>{String(employee.full_name ?? id)}</Text>
                          {self ? <Pill text="You" color={TXT2} bg="rgba(255,255,255,0.07)" bd={CARD_BD} /> : null}
                        </View>
                        <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 3 }} numberOfLines={1}>
                          {roleDisplay(role)} · {hour1(stats.hours)} · {stats.transactions} tx{kids.length ? ` · +${kids.length} cashier${kids.length === 1 ? "" : "s"}` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 16, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(stats.revenue)}</Text>
                        {stats.flag.flagged ? (
                          <View style={{ marginTop: 6 }}>
                            <Pill text="Flagged" color={RED} bg={RED_TINT} bd={RED_BD} />
                          </View>
                        ) : stats.openCount > 0 ? (
                          <View style={{ marginTop: 6 }}>
                            <Pill text={`${stats.openCount} open`} color={AMBER} bg={AMBER_TINT} bd={AMBER_BD} />
                          </View>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={TXT3} />
                    </Pressable>
                  </View>
                );
              })}
            </GroupedCard>
          </View>
        </View>
      ))}
      {staffList.length === 0 ? <Empty text="No employees on this scope." /> : null}
      <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 14, lineHeight: 18 }}>
        Flag threshold = {Math.round(flagPct * 100)}% of each employee's own salary (single deficit or rolling 90 days).
      </Text>
    </>
  );
}

// Staff profile timeline helpers: last-7-day horizontal tracks, axis 6a–2a
// (the mock labels its ticks 8a, 12p, 4p, 8p, 12a).
const TL_FROM = 6;
const TL_SPAN = 20;
const TL_DAY_W = 52;
const TL_TICKS = [8, 12, 16, 20, 24];
const tlPct = (h: number) => Math.max(0, Math.min(100, ((Number(h) - TL_FROM) / TL_SPAN) * 100));

/** History-row status pills (mock wording: an open deficit is "Pending"). */
const HISTORY_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Pending", color: "#f0b64a", bg: "rgba(240,182,74,0.13)" },
  paid: { label: "Paid", color: "#5ad48a", bg: "rgba(90,212,138,0.13)" },
  salary: { label: "From salary", color: "#5ad48a", bg: "rgba(90,212,138,0.13)" },
  forgiven: { label: "Forgiven", color: "#a9a5e0", bg: "rgba(169,165,224,0.13)" },
};

/** "Thu Sep 24" from a date column (YYYY-MM-DD or ISO). */
const profileDay = (d: any) => {
  const day = String(d ?? "").slice(0, 10);
  const t = day.length === 10 ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (isNaN(t)) return "—";
  const wd = new Date(t).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${monT(day)} ${Number(day.slice(8, 10))}`;
};

/** "Sep 7" from an ISO timestamp. */
const profileMonthDay = (d: any) => {
  const day = String(d ?? "").slice(0, 10);
  const t = day.length === 10 ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (isNaN(t)) return "";
  return `${monT(day)} ${Number(day.slice(8, 10))}`;
};

function StaffProfile({
  back, staffMember, rangeLabel, trend, timeline, reportsTo, team, flagPct, canDecideFor,
}: {
  back: () => void;
  staffMember: { employee: any; stats: EmployeeStats; kids: any[]; teamRevenue: number; teamHours: number; teamDeficits: DeficitRow[]; ownDeficits: DeficitRow[] };
  rangeLabel: string;
  trend: ReturnType<typeof weeklyRevenuePerHour> | null;
  timeline: DayTimeline | null;
  reportsTo: string | null;
  team: {
    rows: Array<{ id: string; name: string; role: string; flagged: boolean; rolling90: number; pct: number }>;
    total: number;
    flaggedCount: number;
  } | null;
  flagPct: number;
  canDecideFor: (role: string) => boolean;
}) {
  const { employee, stats, kids, teamRevenue, teamHours, teamDeficits, ownDeficits } = staffMember;
  const name = String(employee.full_name ?? employee.id);
  const role = roleDisplay(String(employee.role ?? "cashier"));
  const f = stats.flag;
  const deficitRows = [...ownDeficits].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const shownRows = deficitRows.slice(0, 15);

  // 8-week trend: rate over the whole window + delta of the recent 4 weeks
  // against the 4 before them (points run oldest → newest).
  const trendPts = trend?.points ?? [];
  const rate = trend && trend.hours > 0 ? trend.revenue / trend.hours : null;
  const halfRate = (a: number, b: number) => {
    let rev = 0;
    let hrs = 0;
    for (let i = Math.max(0, a); i < Math.min(trendPts.length, b); i++) {
      rev += trendPts[i].revenue;
      hrs += trendPts[i].hours;
    }
    return hrs > 0 ? rev / hrs : null;
  };
  const recent4 = halfRate(trendPts.length - 4, trendPts.length);
  const prior4 = halfRate(trendPts.length - 8, trendPts.length - 4);
  const deltaPct = recent4 != null && prior4 != null && prior4 > 0 ? ((recent4 - prior4) / prior4) * 100 : null;
  const hasTrend = trendPts.some(p => p.value > 0 || p.revenue > 0);

  // Deficit-limit rows: bars fill against the threshold, % against salary.
  const salary = Number(f.salary ?? 0);
  const pctOfSalary = (amount: number) => (salary > 0 ? `${((amount / salary) * 100).toFixed(1)}%` : "—");
  const barW = (v: number) => (f.threshold > 0 ? `${Math.max(0, Math.min(100, (v / f.threshold) * 100))}%` : "0%");
  const over90 = f.threshold > 0 && f.rolling90 >= f.threshold;

  return (
    <>
      <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={back} hitSlop={8} accessibilityLabel="Back to staff" style={{ padding: 4 }}>
          <Ionicons name="close" size={40} color={TXT} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 }}>
        <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "#1f2b2a", borderWidth: 1, borderColor: CARD_BD, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 21, fontWeight: "800", color: TXT2 }}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 27, fontWeight: "800", letterSpacing: -0.7, color: TXT }} numberOfLines={1}>{name}</Text>
          <Text style={{ fontSize: 13.5, color: TXT2, marginTop: 3 }} numberOfLines={1}>
            {role}{reportsTo ? ` · reports to ${reportsTo}` : ""}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", marginTop: 14 }}>
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10,
          paddingHorizontal: 11, paddingVertical: 6,
          backgroundColor: f.flagged ? "rgba(224,108,91,0.13)" : "rgba(92,230,138,0.10)",
          borderWidth: 1, borderColor: f.flagged ? "rgba(224,108,91,0.4)" : "rgba(92,230,138,0.3)",
        }}>
          <Ionicons name={f.flagged ? "flag" : "shield-checkmark"} size={12} color={f.flagged ? RED : GREEN} />
          <Text style={{ fontSize: 12.5, fontWeight: "700", color: f.flagged ? RED : GREEN }}>
            {f.flagged ? (f.reason === "rolling90" ? "90-day over limit" : "Single deficit over limit") : "Within limit"}
          </Text>
        </View>
      </View>

      <SectionLabel label="Stats" right={rangeLabel} />
      <View style={{ marginTop: 12, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, overflow: "hidden" }}>
        {/* Revenue + hours */}
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, padding: 18, borderRightWidth: 1, borderRightColor: LINE }}>
            <Text style={{ fontSize: 13, color: TXT2 }}>Revenue generated</Text>
            <Text style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.7, color: TXT, marginTop: 6, ...monoStyle }} numberOfLines={1} adjustsFontSizeToFit>
              {fmtG(stats.revenue)}
            </Text>
          </View>
          <View style={{ flex: 1, padding: 18 }}>
            <Text style={{ fontSize: 13, color: TXT2 }}>Hours worked</Text>
            <Text style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.7, color: TXT, marginTop: 6, ...monoStyle }}>
              {Math.round(stats.hours)}
              <Text style={{ fontSize: 15, fontWeight: "700", color: TXT2 }}> h</Text>
            </Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: LINE }} />

        {/* 8-week performance trend */}
        <View style={{ padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, fontSize: 14, color: TXT2 }}>Performance trend · 8 wks</Text>
            {hasTrend ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {deltaPct != null ? (
                  <Ionicons name={deltaPct >= 0 ? "arrow-up" : "arrow-down"} size={12} color={deltaPct >= 0 ? GREEN : RED} />
                ) : null}
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: deltaPct == null ? TXT2 : deltaPct >= 0 ? GREEN : RED, ...monoStyle }}>
                  {deltaPct != null ? `${Math.abs(deltaPct).toFixed(1)}% · ` : ""}
                  {rate != null ? `${fmtG(rate, 2)}/hr` : ""}
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: 13, color: TXT3 }}>No data</Text>
            )}
          </View>
          <View style={{ marginTop: 8 }}>
            {hasTrend ? (
              <LineChart points={trendPts} color={GOLD} height={112} endDot />
            ) : (
              <View style={{ height: 60, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 12.5, color: TXT3 }}>No clocked revenue in this window.</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: LINE }} />

        {/* Deficit limits */}
        <View style={{ padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, fontSize: 13, color: TXT2 }}>Deficit limit · {Math.round(f.pct * 100)}% of {fmtG(f.salary)} salary</Text>
            <Text style={{ fontSize: 14, fontWeight: "700", color: TXT2, ...monoStyle }}>{fmtG(f.threshold, 2)}</Text>
          </View>

          <View style={{ marginTop: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: TXT }}>Rolling 90 days</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: over90 ? RED : TXT, ...monoStyle }}>
                {fmtG(f.rolling90, 2)}
                <Text style={{ color: over90 ? RED : TXT3 }}> · {pctOfSalary(f.rolling90)}</Text>
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" }}>
              <View style={{ width: barW(f.rolling90) as any, height: 6, borderRadius: 3, backgroundColor: over90 ? RED : TAN }} />
            </View>
          </View>

          <View style={{ marginTop: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", color: TXT }}>Largest single</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: TXT, ...monoStyle }}>
                {fmtG(f.singleWorst, 2)}
                <Text style={{ color: TXT3 }}> · {pctOfSalary(f.singleWorst)}</Text>
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" }}>
              <View style={{ width: barW(f.singleWorst) as any, height: 6, borderRadius: 3, backgroundColor: TAN }} />
            </View>
          </View>
        </View>
      </View>

      <SectionLabel label="Deficit history" right={`${deficitRows.length} entries`} />
      {shownRows.length === 0 ? (
        <Empty text="No deficit has been logged against this employee." />
      ) : (
        <View style={{ marginTop: 12, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, overflow: "hidden" }}>
          {shownRows.map((d, i) => {
            const st = deficitState(d);
            const m = HISTORY_META[st] ?? HISTORY_META.open;
            const logged = profileDay(d.date);
            const resolvedAt = d.resolved_at ? profileMonthDay(d.resolved_at) : "";
            return (
              <View key={String(d.id)} style={{ padding: 16, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: LINE }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ flex: 1, fontSize: 19, fontWeight: "800", color: TXT, ...monoStyle }}>{fmtG(Number(d.deficit ?? 0), 2)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: m.bg }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.color }} />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: m.color }}>{m.label}</Text>
                  </View>
                </View>
                {d.notes ? (
                  <Text style={{ fontSize: 14, color: TXT2, marginTop: 6, lineHeight: 19 }}>{d.notes}</Text>
                ) : null}
                <Text style={{ fontSize: 12, color: TXT3, marginTop: 5 }}>
                  Logged {logged}{resolvedAt ? ` · resolved ${resolvedAt}` : ""}
                </Text>
                {st === "forgiven" && d.resolution_reason ? (
                  <Text style={{ fontSize: 13, color: "#a9a5e0", marginTop: 7, fontStyle: "italic", lineHeight: 18 }}>
                    “{d.resolution_reason}”
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Login & activity — last 7 days, one horizontal track per day */}
      <View style={{ marginTop: 14, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, padding: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1, fontSize: 16.5, fontWeight: "800", letterSpacing: -0.3, color: TXT }}>Login &amp; activity</Text>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: TXT, ...monoStyle }}>
            {timeline ? `${Math.round(timeline.activePct)}% active` : "—"}
          </Text>
        </View>
        {!timeline || timeline.days.length === 0 ? (
          <Empty text="No clock-ins in the last 7 days." />
        ) : (
          <View style={{ marginTop: 14 }}>
            <View style={{ position: "relative" }}>
              {/* hour gridlines behind the day rows */}
              <View pointerEvents="none" style={{ position: "absolute", left: TL_DAY_W, right: 0, top: 0, bottom: 0 }}>
                {TL_TICKS.map(t => (
                  <View key={t} style={{ position: "absolute", left: `${tlPct(t)}%`, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.07)" }} />
                ))}
              </View>
              {timeline.days.map(day => {
                const empty = day.segs.length === 0;
                return (
                  <View key={day.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                    <Text style={{ width: TL_DAY_W, fontSize: 11.5, fontWeight: day.isToday ? "800" : "600", color: day.isToday ? TXT : empty ? TXT3 : TXT2 }}>
                      {day.label}
                    </Text>
                    <View style={{ flex: 1, height: 16, position: "relative" }}>
                      {empty ? (
                        <View style={{ position: "absolute", left: 0, right: 0, top: 7.5, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.3)" }} />
                      ) : (
                        <>
                          {day.segs.map((sg, i) => (
                            <View
                              key={i}
                              style={{
                                position: "absolute",
                                left: `${tlPct(sg.start)}%`,
                                width: `${Math.max(1.2, tlPct(sg.end) - tlPct(sg.start))}%`,
                                top: 2, bottom: 2, borderRadius: 4,
                                backgroundColor: sg.active ? GOLD : "rgba(255,255,255,0.16)",
                              }}
                            />
                          ))}
                          {day.clockIn != null ? (
                            <View style={{ position: "absolute", left: `${tlPct(day.clockIn)}%`, marginLeft: -1.25, top: 0, bottom: 0, width: 2.5, borderRadius: 1.5, backgroundColor: TXT }} />
                          ) : null}
                          {day.clockOut != null ? (
                            <View style={{ position: "absolute", left: `${tlPct(day.clockOut)}%`, marginLeft: -1.25, top: 0, bottom: 0, width: 2.5, borderRadius: 1.5, backgroundColor: TXT }} />
                          ) : null}
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            {/* hour scale */}
            <View style={{ flexDirection: "row", marginTop: 4 }}>
              <View style={{ width: TL_DAY_W }} />
              <View style={{ flex: 1, height: 14, position: "relative" }}>
                {TL_TICKS.map(t => (
                  <Text key={t} style={{ position: "absolute", left: `${tlPct(t)}%`, marginLeft: -16, width: 32, textAlign: "center", fontSize: 10, color: TXT3 }}>
                    {hourTag(t)}
                  </Text>
                ))}
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              <LegendDot color={GOLD} label="Active" />
              <LegendDot color="rgba(255,255,255,0.16)" label="Idle" />
              <LegendDot color={TXT} label="Clock in / out" bar />
            </View>
          </View>
        )}
      </View>

      {team ? (
        <>
          <SectionLabel label={`Team deficits · counts toward ${name.split(/\s+/)[0]}`} right={`${team.rows.length} reports`} />
          <View style={{ marginTop: 12, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: CARD_BD, overflow: "hidden" }}>
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, padding: 18, borderRightWidth: 1, borderRightColor: LINE }}>
                <Text style={{ fontSize: 13, color: TXT2 }}>Team 90-day total</Text>
                <Text style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.6, color: TXT, marginTop: 6, ...monoStyle }}>
                  {fmtG(team.total, 2)}
                </Text>
              </View>
              <View style={{ flex: 1, padding: 18 }}>
                <Text style={{ fontSize: 13, color: TXT2 }}>Flagged reports</Text>
                <Text style={{ fontSize: 24, fontWeight: "800", letterSpacing: -0.6, color: team.flaggedCount > 0 ? RED : TXT, marginTop: 6, ...monoStyle }}>
                  {team.flaggedCount} / {team.rows.length}
                </Text>
              </View>
            </View>
            {team.rows.map(r => (
              <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: LINE }}>
                <Avatar name={r.name} role={r.role} />
                <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: TXT }} numberOfLines={1}>{r.name}</Text>
                <View style={{ width: 96, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <View style={{
                    width: f.pct > 0 ? `${Math.max(0, Math.min(100, (r.pct / (f.pct * 100)) * 100))}%` : "0%",
                    height: 6, borderRadius: 3,
                    backgroundColor: r.flagged ? RED : r.rolling90 > 0 ? TAN : "transparent",
                  }} />
                </View>
                <Text style={{ width: 56, textAlign: "right", fontSize: 14, fontWeight: "700", color: r.flagged ? RED : r.rolling90 > 0 ? TXT : TXT3, ...monoStyle }}>
                  {r.pct.toFixed(1)}%
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}
