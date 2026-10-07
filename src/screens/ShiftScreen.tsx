// Shift — the unified shift lifecycle (opens / daily report / cash register),
// redesigned around two distinct role experiences:
//   • Cashiers land in an ACTION screen: big numeric entry + manager picker,
//     then a live today-only dashboard. A pending manager confirmation is a
//     gentle notice — selling is never blocked by it.
//   • Supervisors (manager/admin/owner) land in a TEAM DASHBOARD: who is
//     active, who needs their confirmation, who hasn't opened — cascading
//     upward, action bubbling to the top. Their own shift entry is a
//     deliberate secondary detour.
// Visual identity is deliberately distinct from Business Guard (gold, weekly,
// card queue): Shift is cyan "live today" with a status-badge language.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { blackPalette as palette, radius, shadow } from "../theme";
import { Ionicons } from "@expo/vector-icons";
import { View, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../components/InterText";
import { getDb, insertOutbox } from "../db";
import { carryTotal, inLocalDay, localDayKey, localDayRange, reconcileShift } from "../businessGuard";
import { USERS, getUserById, USER_IDS } from "../users";
import { notifyLocal } from "../notifications";
import { notifUI, type NotifRoute } from "../notifRoute";
import { fmtG, fmt, monoStyle } from "../format";
import { useResponsive, sheetBox } from "../responsive";
import { salesEvents } from "../salesEvents";
import { uploadSuccess, uploadError } from "../components/UploadTransition";
import { MoneyInput } from "../components/maskedInput";
import { saleLineLabel } from "../labels";
import { attachLineLabels } from "../receipts";
import { useAuthState } from "../auth/authStore";
import ShiftReportDetail, { type ReportDetailData, resolveReportShift, paymentInReportShift } from "./ShiftReportDetail";
import { DarkBackButton } from "../components/BackButton";
import { SafeScreen } from "../components/SafeScreen";
import { reportIdForDay, reportIdForShift } from "../db/ids";
import { mintId } from "../db/ids";

type Sale = { id: string; sale_number: string; total: number; payment_method: string; status: string; created_at: string; amount_paid: number; seller_role?: string; seller_id?: string; store_id?: string; standby?: number };
type Shift = { id: string; opening_balance: number; opening_stated?: number; opening_confirmed_by?: string; status: string; start_time: string; cashier_confirmed: number; manager_confirmed: number; supervisor_confirmed: number; actual_cash?: number; cashier_id?: string };

const RANK: Record<string, number> = { cashier: 0, stock: 0, manager: 1, admin: 2, owner: 3 };
const initialsOf = (n: string) => n.split(" ").filter(Boolean).map((w: string) => w[0]?.toUpperCase()).slice(0, 2).join("") || "?";
const td = (iso: string | null | undefined): string => {
  const d = new Date(iso ?? "");
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};
const ago = (iso: string | null | undefined): string => {
  const t = new Date(iso ?? "").getTime();
  if (isNaN(t)) return "—";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "kounye a";
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.floor(m / 60)} h`;
};

// ── Shift visual identity (distinct from Business Guard's gold) ────────────
const SHIFT = {
  live: "#22d3ee",
  liveSoft: "rgba(34,211,238,0.10)",
  liveBd: "rgba(34,211,238,0.30)",
  active: "#34d399",
  activeSoft: "rgba(52,211,153,0.12)",
  activeBd: "rgba(52,211,153,0.35)",
  pending: "#fbbf24",
  pendingSoft: "rgba(251,191,36,0.12)",
  pendingBd: "rgba(251,191,36,0.35)",
  disputed: "#fb7185",
  disputedSoft: "rgba(251,113,133,0.12)",
  disputedBd: "rgba(251,113,133,0.35)",
  review: "#60a5fa",
  reviewSoft: "rgba(96,165,250,0.12)",
  reviewBd: "rgba(96,165,250,0.35)",
  closed: "#94a3b8",
  closedSoft: "rgba(148,163,184,0.12)",
  closedBd: "rgba(148,163,184,0.30)",
  notOpened: "#64748b",
  notOpenedSoft: "rgba(100,116,139,0.10)",
  notOpenedBd: "rgba(100,116,139,0.30)",
};

type ShiftStatus = "active" | "pending" | "disputed" | "review" | "closed" | "not-opened";

const STATUS_META: Record<ShiftStatus, { label: string; color: string; bg: string; bd: string }> = {
  active: { label: "Active", color: SHIFT.active, bg: SHIFT.activeSoft, bd: SHIFT.activeBd },
  pending: { label: "Pending confirmation", color: SHIFT.pending, bg: SHIFT.pendingSoft, bd: SHIFT.pendingBd },
  disputed: { label: "Disputed", color: SHIFT.disputed, bg: SHIFT.disputedSoft, bd: SHIFT.disputedBd },
  review: { label: "Awaiting review", color: SHIFT.review, bg: SHIFT.reviewSoft, bd: SHIFT.reviewBd },
  closed: { label: "Closed", color: SHIFT.closed, bg: SHIFT.closedSoft, bd: SHIFT.closedBd },
  "not-opened": { label: "Not opened", color: SHIFT.notOpened, bg: SHIFT.notOpenedSoft, bd: SHIFT.notOpenedBd },
};

function StatusBadge({ status }: { status: ShiftStatus }) {
  const m = STATUS_META[status];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: m.bg, borderWidth: 0.5, borderColor: m.bd }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.color }} />
      <Text style={{ fontSize: 10, fontWeight: "800", color: m.color, letterSpacing: 0.3 }}>{m.label.toUpperCase()}</Text>
    </View>
  );
}

function StatCard({ label, value, sub, color = palette.ink }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
      <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>{label}</Text>
      <Text style={{ fontSize: 26, fontWeight: "800", color, letterSpacing: -0.5, marginTop: 6, ...monoStyle }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 10.5, color: palette.muted3, marginTop: 3 }}>{sub}</Text> : null}
    </View>
  );
}

function SectionTitle({ icon, title, count, color = palette.ink }: { icon: keyof typeof Ionicons.glyphMap; title: string; count?: number; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={{ fontSize: 12, fontWeight: "800", color, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</Text>
      {count != null && count > 0 ? (
        <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: SHIFT.liveSoft, borderWidth: 0.5, borderColor: SHIFT.liveBd }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: SHIFT.live }}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

function QueueEmpty({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={{ minHeight: 320, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(52,211,153,0.12)", borderWidth: 1, borderColor: "rgba(52,211,153,0.30)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="checkmark" size={30} color={SHIFT.active} />
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 16, color: "#fff", marginTop: 16, textAlign: "center" }}>{title}</Text>
      <Text style={{ fontSize: 13, color: "#9a9a9e", marginTop: 6, textAlign: "center", lineHeight: 18 }}>{sub}</Text>
    </View>
  );
}

// ── Tender-style amount entry (POS TenderView language) ────────────────────
// Display box + white tender button + bottom hairline keypad on dark black.
const TENDER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];

function tenderPress(value: string, k: string): string {
  if (k === "back") return value.slice(0, -1);
  const next = k === "00" ? `${value}00` : `${value}${k}`;
  return next.length > 9 ? value : next;
}

function TenderDisplay({ amount, label }: { amount: string; label: string }) {
  const n = amount === "" ? 0 : Number(amount);
  return (
    <View style={{ borderWidth: 1, borderColor: "#3a3a3c", backgroundColor: "#111", borderRadius: 12, padding: 16, marginTop: 12 }}>
      <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 1.6 }}>{label}</Text>
      <Text style={{ fontSize: 34, color: "#fff", marginTop: 6, ...monoStyle }}>{fmtG(Number.isFinite(n) ? n : 0)}</Text>
    </View>
  );
}

function TenderKeypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View>
      {[0, 1, 2, 3].map(r => (
        <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 0.5, borderTopColor: "#262626" }}>
          {[0, 1, 2].map(ci => {
            const k = TENDER_KEYS[r * 3 + ci];
            return (
              <Pressable key={ci} onPress={() => onChange(tenderPress(value, k))} style={{ flex: 1, height: 62, alignItems: "center", justifyContent: "center", borderRightWidth: ci < 2 ? 0.5 : 0, borderRightColor: "#262626" }}>
                {k === "back" ? (
                  <Ionicons name="backspace-outline" size={24} color="#fff" />
                ) : (
                  <Text style={{ fontSize: 26, fontWeight: "500", color: "#fff" }}>{k}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#3a3a3c", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: SHIFT.liveBd }}>
      <Text style={{ fontWeight: "800", fontSize: size * 0.32, color: "#fff" }}>{initialsOf(name)}</Text>
    </View>
  );
}

type TeamMember = { id: string; name: string; role: string; store?: string };
type PersonReport = {
  user: TeamMember;
  shift: any | null;
  report: any | null;
  sales: any[];
  items: any[];
  debts: any[];
  movements: any[];
  hands: any[];
};

export default function ShiftScreen({ storeId, role = "seller", currentUser, openSignal = 0, closeSignal = 0, onOpenState, onFullView }: { storeId: string; role?: string; currentUser?: any; openSignal?: number; closeSignal?: number; onOpenState?: (open: boolean) => void; onFullView?: (full: boolean) => void }) {
  const { width, isTablet, padH } = useResponsive();
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState<Shift | null>(null);
  const [myShiftToday, setMyShiftToday] = useState<any | null>(null);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [inventoryPickups, setInventoryPickups] = useState<any[]>([]);
  const [debtCollections, setDebtCollections] = useState<any[]>([]);
  const [cashierDebts, setCashierDebts] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [allReports, setAllReports] = useState<any[]>([]);
  const [reviewReports, setReviewReports] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [showEnd, setShowEnd] = useState(false);
  const auth = useAuthState();
  const [actualCash, setActualCash] = useState("");
  const [pendingValidateId, setPendingValidateId] = useState<string | null>(null);
  const [managerPassword, setManagerPassword] = useState("");
  const [salaryDeductions, setSalaryDeductions] = useState<any[]>([]);
  const [monthlyLosses, setMonthlyLosses] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [hands, setHands] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const loadInFlight = useRef(false);
  // Opening flow
  const [openForm, setOpenForm] = useState(false);
  const [openAmount, setOpenAmount] = useState("");
  const [openManager, setOpenManager] = useState("");
  const [pendingOpenings, setPendingOpenings] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [claimFor, setClaimFor] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState("");
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [resolveAmount, setResolveAmount] = useState("");
  // Cash-out writer
  const [cashOutForm, setCashOutForm] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState("");
  const [cashOutReason, setCashOutReason] = useState("");
  const [cashOutType, setCashOutType] = useState<"withdrawal" | "inventory">("withdrawal");
  // Debt-collected quick entry (amount + note, logged to today's till)
  const [quickDebts, setQuickDebts] = useState<any[]>([]);
  const [debtForm, setDebtForm] = useState(false);
  const [debtAmount, setDebtAmount] = useState("");
  const [debtNote, setDebtNote] = useState("");
  // History + supervisor views
  const [pastReports, setPastReports] = useState<any[]>([]);
  // Report ids with an open dispute (past rows wear the "Disputed" status)
  const [pastDisputeIds, setPastDisputeIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ReportDetailData | null>(null);
  const [autoCloseTime, setAutoCloseTime] = useState("06:30");
  // Supervisor: team dashboard + own shift + person drill-in + review queue
  const [teamShifts, setTeamShifts] = useState<any[]>([]);
  const [teamReports, setTeamReports] = useState<any[]>([]);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [supView, setSupView] = useState<"team" | "own" | "open">("team");
  // Cashier: the full-screen Open Shift modal is the first thing she sees when
  // today's shift isn't open yet — opening the shift is her priority action.
  const [cashierOpenView, setCashierOpenView] = useState(false);
  const [ownShiftAmount, setOwnShiftAmount] = useState("");
  const [person, setPerson] = useState<PersonReport | null>(null);
  // Review queue tabs + inline expansion (supervisor main screen)
  const [queueTab, setQueueTab] = useState<"pending" | "confirmed" | "disputed">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // End-shift checkboxes
  const [checkCounted, setCheckCounted] = useState(false);
  const [checkCashOut, setCheckCashOut] = useState(false);
  const [checkStandby, setCheckStandby] = useState(false);

  const myRank = RANK[role] ?? 0;
  const isCashier = myRank === 0;
  const isSupervisor = myRank >= 1;
  // Full-screen Open Shift view (supervisor team jump, cashier entry modal)
  // hides the App chrome via onFullView. Runs post-render.
  useEffect(() => { onFullView?.(supView === "open" || (isCashier && cashierOpenView)); }, [supView, cashierOpenView, isCashier, onFullView]);

  // --- Notification deep-link (src/notifRoute.ts) ---
  // The handler closes over the current render's data (openReportDetail reads
  // `reviews`, the queue reads the loaded rows), so it is rewritten every
  // render into a ref and the subscription itself never churns.
  const notifHandler = useRef<(r: NotifRoute) => boolean>(() => false);
  useEffect(() => {
    notifHandler.current = (r) => {
      if (r.screen === "report") { openReportDetail(r.id); return true; }
      if (r.screen === "shift") {
        if (isSupervisor) setSupView("team");
        return true;
      }
      if (r.screen === "queue") {
        // Supervisors work these rows out of the team queue — land on the tab
        // the notification belongs to, expanded to the row it names.
        if (isSupervisor) { setSupView("team"); setQueueTab(r.tab); setExpandedId(r.id ?? null); return true; }
        // Cashiers have no team queue: their own report is the record.
        if (r.id && reports.some((x: any) => String(x?.id) === String(r.id))) { openReportDetail(r.id); return true; }
        return true;
      }
      return false;
    };
  });
  // Register only once the first load has landed — a report opened straight
  // out of a cold start needs `reviews` to carry the dispute/decision state.
  const [routeReady, setRouteReady] = useState(false);
  useEffect(() => { if (!loading) setRouteReady(true); }, [loading]);
  useEffect(() => {
    if (!routeReady) return;
    return notifUI.register(r => notifHandler.current(r));
  }, [routeReady]);

  // Local business day — the store's day flips at local midnight, not at
  // 00:00 UTC. A UTC "today" made every sale vanish from the day filter after
  // 20:00 local (Net sales = 0, Final Total wrong).
  const today = localDayKey();
  const currentUserId = currentUser?.id ?? null;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const db = await getDb();
      const allSales = (await db.getAllAsync("SELECT * FROM sales")) as Sale[];
      const allItems = (await db.getAllAsync("SELECT * FROM sale_items")) as any[];
      await attachLineLabels(db, allItems).catch(() => {});
      const shifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      const cms = (await db.getAllAsync("SELECT * FROM cash_movements")) as any[];
      const dcs = ((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]).filter((p: any) => (p.payment_method ?? "cash") === "cash");
      const qdcs = ((await db.getAllAsync("SELECT * FROM debt_collections").catch(() => [])) ?? []) as any[];
      const cds = (await db.getAllAsync("SELECT * FROM cashier_deficits")) as any[];
      setReviews((((await db.getAllAsync("SELECT * FROM report_reviews")) as any[]) ?? [])
        .filter((rv: any) => (rv.store_id ?? storeId) === storeId)
        .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))));
      const allReports = (await db.getAllAsync("SELECT * FROM daily_reports")) as any[];
      const allSets = (await db.getAllAsync("SELECT * FROM deficit_settlements")) as any[];
      const allHands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []) as any[];
      const salaries = (await db.getAllAsync("SELECT * FROM salary_deductions")) as any[];
      const losses = (await db.getAllAsync("SELECT * FROM monthly_losses")) as any[];
      const allChecks = ((await db.getAllAsync("SELECT * FROM cash_register_checks").catch(() => [])) ?? []) as any[];
      const employees = ((await db.getAllAsync("SELECT * FROM employees").catch(() => [])) ?? []) as any[];
      const meta = ((await db.getAllAsync("SELECT * FROM _meta WHERE key = 'shift_autoclose_time'").catch(() => [])) ?? []) as any[];
      if (meta[0]?.value) setAutoCloseTime(String(meta[0].value));

      // Overnight shifts survive midnight: sales/debts from yesterday stay
      // visible so the still-open shift's window (shift start → now) keeps
      // its figures. Downstream inMyWindow trims precisely per shift.
      const yesterdayKey = localDayKey(Date.now() - 86400000);
      const storeSales = allSales.filter(s => (s.store_id ?? storeId) === storeId && (!s.created_at || inLocalDay(s.created_at, today) || inLocalDay(s.created_at, yesterdayKey)));
      const storeShifts = shifts.filter((s: any) => (s.store_id ?? storeId) === storeId);
      const storeCMs = cms.filter((c: any) => (c.store_id ?? storeId) === storeId);
      const storeDCs = dcs.filter((d: any) => (d.store_id ?? storeId) === storeId);
      const storeCDs = cds.filter((c: any) => (c.store_id ?? storeId) === storeId);
      const storeReports = allReports.filter((r: any) => (r.store_id ?? storeId) === storeId && r.report_date === today);
      setReviewReports(allReports
        .filter((r: any) => (r.store_id ?? storeId) === storeId && (r.status === "closed" || r.status === "submitted") && (RANK[r.role] ?? 0) === 0)
        .sort((a: any, b: any) => String(b.report_date ?? "").localeCompare(String(a.report_date ?? ""))));
      // Store-wide today: pending openings (visible to everyone — any date,
      // a pending opening never expires at midnight), team shifts,
      // team reports, and the cashier roster for the "not opened" section.
      const todayShifts = storeShifts.filter((s: any) => inLocalDay(s.start_time, today) || String(s.status ?? "") === "pending");
      setPendingOpenings(todayShifts
        .filter((s: any) => s.status === "pending")
        .sort((a: any, b: any) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""))));
      setTeamShifts(todayShifts);
      setTeamReports(storeReports);
      setClaims(allChecks
        .filter((c: any) => (c.store_id ?? storeId) === storeId && c.status === "pending" && (c.action === "claim" || c.action === "report_dispute"))
        .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))));
      // All-time open report disputes for this cashier — drives the history row status.
      setPastDisputeIds(new Set(allChecks
        .filter((c: any) => (c.store_id ?? storeId) === storeId && c.action === "report_dispute" && c.status === "pending" && (c.cashier_id ?? null) === (currentUserId ?? null) && c.report_id)
        .map((c: any) => String(c.report_id))));
      const rosterIds = new Set<string>();
      const nextRoster: TeamMember[] = [];
      for (const u of USERS) {
        if (u.role === "cashier") { nextRoster.push({ id: u.id, name: u.name, role: "cashier", store: u.store }); rosterIds.add(u.id); }
      }
      for (const e of employees) {
        if (e.role === "cashier" && !rosterIds.has(String(e.id)) && !nextRoster.some(r => r.name === e.full_name)) {
          nextRoster.push({ id: String(e.id), name: e.full_name, role: "cashier", store: e.store_id });
          rosterIds.add(String(e.id));
        }
      }
      setRoster(nextRoster);
      setPastReports(allReports
        .filter((r: any) => String(r.user_id ?? "") === String(currentUserId ?? ""))
        .sort((a: any, b: any) => String(b.report_date ?? "").localeCompare(String(a.report_date ?? "")) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));

      const myOpen = storeShifts.find((s: any) => s.status === "open" && (!s.cashier_id || s.cashier_id === currentUserId));
      const myOpenStrict = storeShifts.find((s: any) => s.status === "open" && (s.cashier_id ?? null) === (currentUserId ?? null));
      const mineToday = storeShifts
        .filter((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null) && (inLocalDay(s.start_time, today) || String(s.status ?? "") === "open" || String(s.status ?? "") === "pending"))
        .sort((a: any, b: any) => (((b.status === "open") ? 1 : 0) - ((a.status === "open") ? 1 : 0)) || String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")));
      const mineTodayAny = shifts
        .filter((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null) && (inLocalDay(s.start_time, today) || String(s.status ?? "") === "open" || String(s.status ?? "") === "pending"))
        .sort((a: any, b: any) => (((b.status === "open") ? 1 : 0) - ((a.status === "open") ? 1 : 0)) || String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")));
      const myOpenAny = shifts.find((s: any) => s.status === "open" && (s.cashier_id ?? null) === (currentUserId ?? null));
      const resolvedShift = mineToday[0] ?? myOpenStrict ?? myOpen ?? mineTodayAny[0] ?? myOpenAny ?? storeShifts.find((s: any) => s.status === "open") ?? shifts.find((s: any) => s.status === "open") ?? null;
      setShift(myOpen || storeShifts.find((s: any) => s.status === "open") || myOpenAny || shifts.find((s: any) => s.status === "open") || null);
      setMyShiftToday(resolvedShift);
      const cmsForTill = resolvedShift
        ? storeCMs.concat(cms.filter((c: any) => (c as any).shift_id === (resolvedShift as any).id && !(storeCMs as any[]).includes(c)))
        : storeCMs;
      setWithdrawals(cmsForTill.filter((c: any) => c.type === "withdrawal"));
      setInventoryPickups(cmsForTill.filter((c: any) => c.type === "inventory"));
      setDebtCollections(storeDCs);
      setQuickDebts(qdcs.filter((d: any) => (d.store_id ?? storeId) === storeId && (inLocalDay(d.created_at, today) || inLocalDay(d.created_at, yesterdayKey))));
      setCashierDebts(storeCDs);
      setReports(storeReports);
      setAllReports(allReports);
      setSettlements(allSets.filter((s:any)=>(s.store_id??storeId)===storeId).sort((a:any,b:any)=>String(b.period_end).localeCompare(String(a.period_end))));
      setHands(allHands.filter((h: any) => (h.store_id ?? storeId) === storeId));
      setSalaryDeductions(salaries.filter((s: any) => (s.store_id ?? storeId) === storeId));
      setMonthlyLosses(losses.filter((l: any) => (l.store_id ?? storeId) === storeId));

      if (storeSales.length === 0 && !resolvedShift && !currentUserId) {
        setSales([]);
      } else {
        setSales(storeSales);
        setItems(allItems);
      }
    } catch (e) {
      console.log("[Shift load] failed:", e);
    } finally { setLoading(false); setRefreshing(false); loadInFlight.current = false; }
  }, [currentUserId, storeId, role, today]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = salesEvents.subscribe(() => { load({ silent: true }); });
    const id = setInterval(() => { load({ silent: true }); }, 4000);
    return () => { try { unsub(); } catch {} clearInterval(id); };
  }, [load]);

  // Header Open Shift button (App overlay bar): supervisors jump to their own
  // shift view, or open the self-entry modal when they have none today.
  // Cashiers get the button in the same position — it reopens the entry modal.
  // Only an awaiting (submitted) report keeps the modal shut; closed reports
  // don't block it (multi-shift days — submitOpening enforces eligibility).
  const openSignalSeen = useRef(0);
  useEffect(() => {
    if (!openSignal || openSignal === openSignalSeen.current) return;
    openSignalSeen.current = openSignal;
    if (isCashier) { if (String(myReportToday?.status ?? "") !== "submitted") setCashierOpenView(true); return; }
    if (!isSupervisor) return;
    if (hasShiftToday) setSupView("own");
    else setSupView("open");
  });

  // ---------- Roll-up totals (true roll-up, no double count) ----------
  function salesFor(rank: number) {
    return sales.filter(s => (RANK[s.seller_role ?? "cashier"] ?? 0) <= rank);
  }
  const rollupSales = salesFor(myRank);
  const cashSales = rollupSales.filter(s => s.payment_method === "cash");
  const moncashSales = rollupSales.filter(s => s.payment_method === "moncash");
  const natcashSales = rollupSales.filter(s => s.payment_method === "natcash");
  const creditSales = rollupSales.filter(s => s.payment_method === "credit");
  const cashTotal = cashSales.reduce((s, x) => s + Number(x.total), 0);
  const moncashTotal = moncashSales.reduce((s, x) => s + Number(x.total), 0);
  const natcashTotal = natcashSales.reduce((s, x) => s + Number(x.total), 0);
  const creditTotal = creditSales.reduce((s, x) => s + Number(x.total), 0);
  const salesTotal = cashTotal + moncashTotal + natcashTotal + creditTotal;
  // Quick-logged debt (amount + note, no credit link needed) counts with the till.
  const myShiftIds = new Set<string>();
  for (const s of teamShifts) if (String((s as any).cashier_id) === String(currentUserId)) myShiftIds.add(String((s as any).id));
  if (myShiftToday && String((myShiftToday as any).cashier_id ?? "") === String(currentUserId ?? "") && (myShiftToday as any).id) myShiftIds.add(String((myShiftToday as any).id));
  const myQuickTotal = quickDebts.filter((d: any) => myShiftIds.has(String(d.shift_id ?? ""))).reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0) || 0;
  // ── Shift window: this user's clock-in → now. Every till figure below is
  // scoped to that window AND to this user — never the calendar day — so a
  // supervisor's cash removal from her register inside the window counts
  // against her report (same rule for every user). Timestamps are ISO.
  // Overnight shifts keep their true start: the window is NEVER cut at
  // midnight (bars/restaurants work past it — the shift must not disappear).
  const dayStart = localDayRange(today)[0];
  const windowStart = String((myShiftToday as any)?.start_time ?? "") || dayStart;
  const effStart = windowStart;
  const windowEnd = new Date().toISOString();
  const inMyWindow = (ts: any) => {
    const s = String(ts ?? "");
    if (!s) return false;
    if (windowStart) return s >= effStart && s <= windowEnd;
    return inLocalDay(s, today);
  };
  const belongsToMyTill = (w: any) =>
    myShiftIds.has(String(w?.shift_id ?? "")) || (w?.taken_by ?? null) === currentUserId || (w?.created_by ?? null) === currentUserId;
  const inventoryTotal = inventoryPickups
    .filter((w: any) => w.validated_by && inMyWindow(w.created_at) && belongsToMyTill(w))
    .reduce((s: number, x: any) => s + Number(x.amount), 0);

  // Person-scoped till math (this cashier's own shift today)
  const meId = currentUser?.id ?? null;
  // Active report = the report for THIS shift — never a previous shift's
  // frozen total. Exact shift link first; then, while my own shift is still
  // open/pending, only its awaiting (submitted/pending) report; legacy
  // day/id matches apply solely when I have no active shift of my own.
  const myShiftId = (myShiftToday as any)?.id ?? null;
  const myMineShift = myShiftToday && (myShiftToday as any).cashier_id === currentUserId ? myShiftToday : null;
  const myActiveMine = myMineShift && ((myMineShift as any).status === "open" || (myMineShift as any).status === "pending") ? myMineShift : null;
  const mineToday = reports.filter((r: any) => r.user_id === currentUserId && r.report_date === today);
  const myReportToday = (myShiftId ? mineToday.find((r: any) => (r as any).shift_id === myShiftId) : undefined)
    ?? (myActiveMine
      ? mineToday.find((r: any) => (String(r.status ?? "") === "submitted" || String(r.status ?? "") === "pending")
        && (!(r as any).shift_id || String((r as any).shift_id) === String((myActiveMine as any).id)))
      : undefined)
    ?? (!myActiveMine
      ? (mineToday.find((r: any) => r.id === reportIdForDay(currentUserId, today)) ?? mineToday[0])
      : undefined)
    ?? null;
  const reportLocked = !!myReportToday && (myReportToday.status === "submitted" || myReportToday.status === "closed");
  const myOpening = Number((myShiftToday as any)?.opening_balance ?? 0);
  const myOwnSales = sales.filter(s => (s.seller_id ?? null) === meId && !Number((s as any).standby ?? 0) && inMyWindow(s.created_at));
  const myCashTotal = myOwnSales.filter(s => s.payment_method === "cash").reduce((s: number, x) => s + Number(x.total), 0);
  const myMoncashTotal = myOwnSales.filter(s => s.payment_method === "moncash").reduce((s: number, x) => s + Number(x.total), 0);
  const myNatcashTotal = myOwnSales.filter(s => s.payment_method === "natcash").reduce((s: number, x) => s + Number(x.total), 0);
  const myCreditTotal = myOwnSales.filter(s => s.payment_method === "credit").reduce((s: number, x) => s + Number(x.total), 0);
  const mySalesTotal = myCashTotal + myMoncashTotal + myNatcashTotal + myCreditTotal;
  const myTxnCount = myOwnSales.length;
  const myCollectedTotal = (debtCollections.filter((x: any) => (x.collected_by ?? null) === meId
    && ((x.shift_id != null && String(x.shift_id) !== "")
      ? (!!myActiveMine && String(x.shift_id) === String((myActiveMine as any).id))
      : inMyWindow(x.created_at))).reduce((s: number, x: any) => s + Number(x.amount), 0) || 0) + myQuickTotal;
  const myCashOutTotal = withdrawals
    .filter((w: any) => w.validated_by && inMyWindow(w.created_at) && belongsToMyTill(w))
    .reduce((s: number, x) => s + Number(x.amount), 0) || 0;
  const myStandbyCarry = Number(myReportToday?.standby_carry ?? 0);
  const expectedCashLive = reconcileShift({ opening: myOpening, cashSales: myCashTotal, debtCollected: myCollectedTotal, cashOut: myCashOutTotal + inventoryTotal, standbyCarry: myStandbyCarry });
  const expectedCash = reportLocked && myReportToday?.expected_cash != null ? Number(myReportToday.expected_cash) : expectedCashLive;
  const reportRowForDeficit = myReportToday;
  const actualFromShift = (shift as any)?.actual_cash ?? (myShiftToday as any)?.actual_cash ?? null;
  const actual = (actualFromShift ?? reportRowForDeficit?.actual_cash ?? null) as number | null;
  const deficit = actual !== null ? expectedCash - actual : null;
  // Standby sales rung after this shift's report locked — window-scoped so a
  // previous shift/day never leaks into this shift's handover and carry.
  const myStandbySales = sales.filter((s: any) => Number(s.standby ?? 0) === 1 && (s.seller_id ?? null) === meId && s.payment_method === "cash" && inMyWindow(s.created_at));
  const myStandbyAmount = myStandbySales.reduce((sum, x) => sum + Number(x.total ?? 0), 0);
  const myStandbyCashCount = myStandbySales.length;
  // Latest standby handover for this cashier (ids are timestamped — one per
  // shift). Overnight-proof: uncarried hands never expire at midnight; only
  // the display fallback is bounded to recent days.
  const myHands = hands
    .filter((h: any) => (h.cashier_id ?? null) === (currentUserId ?? null))
    .sort((a: any, b: any) => String(b.handed_at ?? b.created_at ?? "").localeCompare(String(a.handed_at ?? a.created_at ?? "")));
  const twoDaysAgoKey = localDayKey(Date.now() - 2 * 86400000);
  const myHand = myHands.find((h: any) => h.carried_into_report_id == null || String(h.carried_into_report_id) === "")
    ?? myHands.find((h: any) => String(h.handed_at ?? h.created_at ?? "").slice(0, 10) >= twoDaysAgoKey)
    ?? hands.find((h: any) => h.id === `hand-${currentUserId}-${today}`) ?? null;

  // ---------- Opening a shift ----------
  const managerList = USERS.filter(u => u.role === "manager" || u.role === "admin" || u.role === "owner");
  const defaultManager = () => {
    const cs = (currentUser as any)?.store;
    return managerList.find(u => u.store === cs)?.id ?? managerList[0]?.id ?? USER_IDS.manager;
  };
  const myPendingShift = pendingOpenings.find((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null)) ?? null;
  const hasShiftToday = !!(myShiftToday && (myShiftToday.cashier_id ?? null) === (currentUserId ?? null) && (myShiftToday.status === "pending" || myShiftToday.status === "open"));
  const reportSubmitted = !!(myReportToday && (myReportToday.status === "submitted" || myReportToday.status === "closed"));
  // Before a shift is open there is no till — the opening float is typed by
  // the user themself in the Open Shift modal. Force every balance readout
  // to zero until the shift is live (and back to zero once submitted).
  const shiftLive = hasShiftToday && !reportSubmitted;
  const headerBalance = shiftLive ? expectedCash : 0;

  // Cashier priority: once the first load lands, if today's shift isn't open
  // yet the full-screen Open Shift modal IS the first thing she sees.
  // Fires once per mount — never on the 4s silent polls, never after submit.
  // Fresh mount only: never inherit a stuck-open entry modal (e.g. state
  // preserved across a Fast Refresh). The auto-open below re-opens it when
  // truly needed (no shift yet).
  useEffect(() => { setCashierOpenView(false); }, []);
  const cashierAutoOpened = useRef(false);
  useEffect(() => {
    if (cashierAutoOpened.current || !isCashier || loading) return;
    cashierAutoOpened.current = true;
    if (!hasShiftToday && !reportSubmitted) setCashierOpenView(true);
  }, [isCashier, loading, hasShiftToday, reportSubmitted]);

  // Push this user's shift-open state up so the App header can toggle the
  // button Open Shift ⇄ Close Shift (identical for every role). A submitted
  // report means there is nothing left to close — the button reverts.
  useEffect(() => { onOpenState?.(hasShiftToday && !reportSubmitted); }, [hasShiftToday, reportSubmitted, onOpenState]);

  // Header Close Shift button → the Shift Closing Summary (Review & Submit
  // Report). Same flow for cashiers and supervisors.
  const closeSignalSeen = useRef(0);
  useEffect(() => {
    if (!closeSignal || closeSignal === closeSignalSeen.current) return;
    closeSignalSeen.current = closeSignal;
    if (!hasShiftToday || reportSubmitted) return;
    setActualCash(""); setCheckCounted(false); setCheckCashOut(false); setCheckStandby(false);
    setShowEnd(true);
  });

  async function submitOpening() {
    if (!currentUser?.id) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    // Cashiers type into openAmount; supervisors into ownShiftAmount (their modal).
    const amt = parseFloat(isCashier ? openAmount : ownShiftAmount);
    if (isNaN(amt) || amt < 0) return Alert.alert("Antre montan", "Antre montan kach ou reyèlman resevwa nan kes la.");
    // Multi-shift days: a cashier opens a new shift only when every previous
    // shift today is closed + accepted by a higher rank with zero deficit.
    if (isCashier) {
      const mineShifts = teamShifts.filter((s: any) => String(s.cashier_id ?? "") === String(currentUser.id));
      if (mineShifts.some((s: any) => s.status === "open" || s.status === "pending"))
        return Alert.alert("Chanjman ouvè", "Fèmen chanjman ou anvan ou louvri yon lòt.");
      const mineReps = reports.filter((r: any) => String(r.user_id ?? "") === String(currentUser.id));
      if (mineReps.some((r: any) => String(r.status ?? "") !== "closed"))
        return Alert.alert("Ap tann revizyon", "Rapò anvan an poko konfime pa yon sipèvizè.");
      for (const r of mineReps) {
        const reviewer = r.reviewed_by ? getUserById(r.reviewed_by) : null;
        const reviewerRank = reviewer ? (RANK[(reviewer as any).role] ?? 0) : 0;
        if (!r.reviewed_by || String(r.reviewed_by) === String(currentUser.id) || reviewerRank < 1)
          return Alert.alert("Pa aksepte", "Chanjman anvan an dwe aksepte pa yon sipèvizè anvan ou louvri yon lòt.");
        // Strict: any deficit figure on a previous shift blocks a new one —
        // even if it was later settled or waived.
        if (Number(r.deficit ?? 0) > 0)
          return Alert.alert("Defisi", "Gen defisi sou chanjman anvan an — ou pa ka louvri yon lòt chanjman jodi a.");
      }
      const openDef = cashierDebts.filter((d: any) => String(d.cashier_id ?? "") === String(currentUser.id) && (d.status === "open" || d.status === "partial"));
      if (openDef.length > 0)
        return Alert.alert("Dèt ouvè", "Gen dèt defisi ouvè sou non ou — ou pa ka louvri yon lòt chanjman jodi a.");
    }
    if (!isCashier) {
      // Supervisors: self-entered, self-confirmed, visible system-wide immediately.
      try {
        const db = await getDb();
        const ts = new Date().toISOString();
        const id = mintId();
        await db.runAsync("INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, opening_stated, opening_confirmed_by, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, storeId, currentUser.id, currentUser.id, amt, amt, currentUser.id, "open", ts, null, 1, 1, 1, ts, ts]);
        for (const sup of USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id)) {
          await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), sup.id, "shift_opening", id, `${currentUser.name} ouvèt chanjman li ak ${fmtG(amt)} (antre pa li menm).`, "pending", ts]);
        }
        uploadSuccess("Chanjman kòmanse ✓", `Ouvert pa ou menm — ${fmtG(amt)}. Ou ka kòmanse vann kounye a.`);
        setOwnShiftAmount("");
        setSupView("own");
        load({ silent: true });
      } catch (e: any) { uploadError("Erè", e?.message ?? "Ouverture echwe"); }
      return;
    }
    // The cashier modal has no picker cycle if none was touched — fall back to
    // the store's manager so the shift can open without leaving the modal.
    const mgr = openManager || defaultManager();
    if (!mgr) return Alert.alert("Chwazi manadjè", "Chwazi manadjè ki remèt kach la.");
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      const id = mintId();
      await db.runAsync("INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, opening_stated, opening_confirmed_by, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, storeId, currentUser.id, mgr, 0, amt, null, "pending", ts, null, 0, 0, 0, ts, ts]);
      await db.runAsync("INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [mintId(), storeId, "", currentUser.id, localDayKey(ts), amt, amt, "pending", "opening", currentUser.id, role, 0, null, null, ts, ts]);
      for (const sup of USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id)) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [mintId(), sup.id, "shift_opening_pending", id, `${currentUser.name} antre ${fmtG(amt)} pou ouvèti — manadjè konfime: ${getUserById(mgr)?.name ?? mgr}. Vant debloke kounye a.`, "pending", ts]);
      }
      // The rows above are a log nothing renders — this is the tap that
      // actually reaches a human. Same record: this shift, pending queue.
      notifyLocal("Ouverture pou konfime", `${currentUser.name} antre ${fmtG(amt)} pou ouvèti — ap tann konfimasyon manadjè a (${getUserById(mgr)?.name ?? mgr}).`, { screen: "queue", tab: "pending", id });
      uploadSuccess("Chanjman kòmanse ✓", `${fmtG(amt)} anrejistre — ou ka kòmanse vann kounye a. Ap tann konfimasyon ${getUserById(mgr)?.name ?? "manadjè a"}.`);
      setOpenForm(false); setOpenAmount("");
      // Shift is open — land her on the live dashboard, not the entry modal.
      setCashierOpenView(false);
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Ouverture echwe"); }
  }

  async function resolveOpening(shiftId: string, action: "approve" | "set" | "reject", amountOverride?: string) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka konfimasyon yon ouverture");
    const s = pendingOpenings.find((p: any) => p.id === shiftId);
    if (!s) return Alert.alert("Pa jwenn", "Ouverture sa a pa la ankò.");
    let amt = Number(s.opening_stated ?? 0);
    if (action === "set") {
      amt = parseFloat(amountOverride ?? resolveAmount);
      if (isNaN(amt) || amt < 0) return Alert.alert("Antre montan", "Antre montan kòrèk la");
    }
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      if (action === "reject") {
        await db.runAsync("UPDATE shifts SET status = ?, end_time = ?, updated_at = ? WHERE id = ?", ["rejected", ts, ts, shiftId]);
      } else {
        await db.runAsync("UPDATE shifts SET status = ?, opening_balance = ?, cashier_confirmed = ?, manager_confirmed = ?, supervisor_confirmed = ?, opening_confirmed_by = ?, updated_at = ? WHERE id = ?",
          ["open", amt, 1, 1, 1, currentUser.id, ts, shiftId]);
      }
      // Overnight-proof: resolve the opening check by id (its check_date may
      // be yesterday while the shift is still pending), not by today's date.
      const openingCheck = claims.find((c: any) => (c.cashier_id ?? null) === (s.cashier_id ?? null) && c.action === "opening" && c.status === "pending") ?? null;
      if (openingCheck) {
        await db.runAsync("UPDATE cash_register_checks SET status = ?, action = ?, approved_by = ?, correct_amount = ? WHERE id = ?",
          [action === "reject" ? "rejected" : "approved", action === "reject" ? "opening_rejected" : "opening_confirmed", currentUser.id, action === "set" ? amt : null, (openingCheck as any).id]);
      } else {
        await db.runAsync("UPDATE cash_register_checks SET status = ?, action = ?, approved_by = ?, correct_amount = ? WHERE cashier_id = ? AND check_date = ? AND action = 'opening' AND status = 'pending'",
          [action === "reject" ? "rejected" : "approved", action === "reject" ? "opening_rejected" : "opening_confirmed", currentUser.id, action === "set" ? amt : null, s.cashier_id, today]);
      }
      const cashierMsg = action === "reject"
        ? `${currentUser?.name ?? "Sipèvizè"} refize ouverture ou. Re-kòmanse chanjman la ak montan ki bon.`
        : `${currentUser?.name ?? "Sipèvizè"} konfime kes ou a ${fmtG(amt)}. Chanjman ou konfime.`;
      await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [mintId(), s.cashier_id, action === "reject" ? "shift_opening_rejected" : "shift_opening_confirmed", shiftId, cashierMsg, "pending", ts]);
      for (const sup of USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id)) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [mintId(), sup.id, "shift_opening_resolved", shiftId, `${currentUser?.name ?? "Sipèvizè"} ${action === "reject" ? "refize" : "konfime"} ouverture ${getUserById(s.cashier_id)?.name ?? s.cashier_id} (${fmtG(amt)}).`, "pending", ts]);
      }
      notifyLocal("Ouverture rezoud", cashierMsg, { screen: "queue", tab: "pending", id: shiftId });
      uploadSuccess("Ouverture rezoud ✓", cashierMsg);
      setResolveFor(null); setResolveAmount("");
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Rezolisyon echwe"); }
  }

  async function fileClaim(shiftId: string) {
    if (!currentUser?.id) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    const s = pendingOpenings.find((p: any) => p.id === shiftId);
    if (!s) return;
    const amt = parseFloat(claimAmount);
    if (isNaN(amt) || amt < 0) return Alert.alert("Antre montan", "Antre montan ou konnen ki kòrèk.");
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync("INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [mintId(), storeId, "", s.cashier_id, today, amt, Number(s.opening_stated ?? 0), "pending", "claim", currentUser.id, role, 0, null, null, ts, ts]);
      for (const sup of USERS.filter(u => u.role === "manager" || u.role === "admin" || u.role === "owner")) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [mintId(), sup.id, "shift_claim", shiftId, `${currentUser.name} fè plent sou ouverture ${getUserById(s.cashier_id)?.name ?? s.cashier_id}: li di se ${fmtG(amt)}.`, "pending", ts]);
      }
      // Same as the opening ping above: the DB rows have no reader, so the
      // supervisor only learns of the claim through a tappable notification.
      notifyLocal("Plent sou ouverture", `${currentUser.name} fè plent sou ouverture ${getUserById(s.cashier_id)?.name ?? s.cashier_id}: li di se ${fmtG(amt)}.`, { screen: "queue", tab: "pending", id: shiftId });
      uploadSuccess("Plent anrejistre", `Plent sou ${getUserById(s.cashier_id)?.name ?? "kesye a"} voye bay tout sipèvizè.`);
      setClaimFor(null); setClaimAmount("");
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Plent echwe"); }
  }

  async function resolveClaim(checkId: string, ok: boolean) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka rezoud yon plent");
    const c = claims.find((x: any) => x.id === checkId);
    if (!c) return;
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync("UPDATE cash_register_checks SET status = ?, approved_by = ? WHERE id = ?", [ok ? "approved" : "rejected", currentUser.id, checkId]);
      let msg = `${currentUser?.name ?? "Sipèvizè"} ${ok ? "apwouve" : "rejete"} plent sa a.`;
      if (ok) {
        const s = pendingOpenings.find((p: any) => p.cashier_id === c.cashier_id);
        if (s) {
          const amt = Number(c.stated_amount ?? 0);
          await db.runAsync("UPDATE shifts SET status = ?, opening_balance = ?, cashier_confirmed = ?, manager_confirmed = ?, supervisor_confirmed = ?, opening_confirmed_by = ?, updated_at = ? WHERE id = ?",
            ["open", amt, 1, 1, 1, currentUser.id, ts, s.id]);
          msg = `${currentUser?.name ?? "Sipèvizè"} apwouve plent la — ouverture ${getUserById(c.cashier_id)?.name ?? c.cashier_id} kòmanse ak ${fmtG(amt)}.`;
        }
      }
      await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [mintId(), c.cashier_id, "shift_claim_resolved", checkId, msg, "pending", ts]);
      const claimShiftId: string | null = pendingOpenings.find((p: any) => p.cashier_id === c.cashier_id)?.id ?? null;
      notifyLocal("Plent rezoud", msg, claimShiftId ? { screen: "queue", tab: "pending", id: claimShiftId } : { screen: "shift" });
      uploadSuccess("Plent rezoud ✓", msg);
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Rezolisyon plent echwe"); }
  }

  // ---------- Report dispute (supervisor sends a submitted report back) ----------
  async function disputeReport(r: any) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka konteste yon rapò");
    if (!currentUser?.id) return;
    if (claims.some((c: any) => c.report_id === r.id && c.action === "report_dispute")) {
      return Alert.alert("Deja konteste", "Rapò sa a gen yon plent ouvè deja.");
    }
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      const id = mintId();
      await db.runAsync("INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, storeId, r.id, r.user_id, r.report_date, Number(r.actual_cash ?? 0), Number(r.expected_cash ?? 0), "pending", "report_dispute", currentUser.id, role, 0, null, null, ts, ts]);
      const cashierName = getUserById(r.user_id)?.name ?? r.user_id;
      await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [mintId(), r.user_id, "report_disputed", r.id, `${currentUser?.name ?? "Sipèvizè"} konteste rapò ${r.report_date} ou — verifye kes la epi re-soumèt.`, "pending", ts]);
      for (const sup of USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id)) {
        try {
          await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), sup.id, "report_disputed", r.id, `${currentUser?.name ?? "Sipèvizè"} konteste rapò ${cashierName} (${r.report_date}).`, "pending", ts]);
        } catch {}
      }
      notifyLocal("Rapò konteste", `Rapò ${cashierName} voye tounen bay kesye a.`, { screen: "queue", tab: "disputed", id: r.id });
      uploadSuccess("Konteste ✓", `Rapò ${cashierName} make disputed — kesye a resevwa notifikasyon.`);
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Kontestasyon echwe"); }
  }

  async function resolveReportDispute(checkId: string, ok: boolean) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka rezoud yon plent");
    const c = claims.find((x: any) => x.id === checkId && x.action === "report_dispute");
    if (!c) return;
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync("UPDATE cash_register_checks SET status = ?, approved_by = ? WHERE id = ?", [ok ? "approved" : "rejected", currentUser.id, checkId]);
      if (ok) {
        const r = teamReports.find((x: any) => x.id === c.report_id && x.status === "submitted");
        if (r) {
          await confirmReport(r);
          return;
        }
      }
      await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [mintId(), c.cashier_id, "report_dispute_dismissed", checkId, `${currentUser?.name ?? "Sipèvizè"} retire plent sou rapò ${c.check_date} ou — rapò a toujou soumèt.`, "pending", ts]);
      notifyLocal("Plent retire", "Plent sou rapò a retire.",
        c.report_id ? { screen: "report", id: String(c.report_id) } : { screen: "shift" });
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Rezolisyon plent echwe"); }
  }

  // ---------- Cash-out writer (non-sales cash taken from the drawer) ----------
  async function addCashOut() {
    if (!shift && !myShiftToday) return;
    const amt = parseFloat(cashOutAmount);
    if (isNaN(amt) || amt <= 0) return Alert.alert("Antre montan", "Antre yon montan > 0");
    const owner = (shift ?? myShiftToday) as any;
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync("INSERT INTO cash_movements (id, shift_id, store_id, type, amount, reason, created_by, taken_by, validated_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [mintId(), owner.id ?? null, storeId, cashOutType, amt, cashOutReason.trim() || (cashOutType === "inventory" ? "Kach depans" : "Retrè kach"), currentUser.id, owner.cashier_id ?? currentUserId, `${currentUser.name}`, ts]);
      notifyLocal(cashOutType === "inventory" ? "Kach depans" : "Retrè kach", `${fmtG(amt)} ${cashOutType === "inventory" ? "depans" : "retire"} nan kès ${getUserById(owner.cashier_id)?.name ?? "kesye a"} — ${cashOutReason.trim() || "san rezon"}`, { screen: "shift" });
      uploadSuccess("Anrejistre ✓", `${fmtG(amt)} ${cashOutType === "inventory" ? "kach depans" : "retrè"} anrejistre nan chanjman an.`);
      setCashOutForm(false); setCashOutAmount(""); setCashOutReason("");
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Anrejistreman echwe"); }
  }

  // ---------- Debt-collected quick entry (amount + note, no credit link needed) ----------
  async function addDebtCollection() {
    const ownShift = teamShifts.find((s: any) => String(s.cashier_id) === String(currentUserId) && (s.status === "pending" || s.status === "open"))
      ?? (((myShiftToday as any)?.cashier_id ?? null) === (currentUserId ?? null) ? myShiftToday : null);
    if (!ownShift) return Alert.alert("Pa gen chanjman", "Ouvri chanjman anvan ou anrejistre dèt.");
    const amt = parseFloat(debtAmount);
    if (isNaN(amt) || amt <= 0) return Alert.alert("Antre montan", "Antre yon montan > 0");
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      const id = mintId();
      const note = debtNote.trim();
      await db.runAsync("INSERT INTO debt_collections (id, shift_id, store_id, customer_id, amount, created_at) VALUES (?,?,?,?,?,?)",
        [id, (ownShift as any).id ?? null, storeId, null, amt, ts]);
      try {
        await insertOutbox("debt_collections", "create", { id, shift_id: (ownShift as any).id ?? null, store_id: storeId, customer_id: null, amount: amt, note: note || null, created_at: ts });
      } catch {}
      for (const sup of USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id)) {
        try {
          await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), sup.id, "debt_collected", id, `${currentUser.name} anrejistre ${fmtG(amt)} dèt kolekte${note ? ` — ${note}` : ""}.`, "pending", ts]);
        } catch {}
      }
      notifyLocal("Dèt kolekte", `${fmtG(amt)} anrejistre nan kes la${note ? ` — ${note}` : ""}.`, { screen: "shift" });
      uploadSuccess("Anrejistre ✓", `${fmtG(amt)} dèt kolekte anrejistre — konte ak kes la, pa ak vant.`);
      setDebtForm(false); setDebtAmount(""); setDebtNote("");
      load({ silent: true });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Anrejistreman echwe"); }
  }

  // ---------- Report drill-in (past reports / today's report) ----------
  async function openReportDetail(reportId: string) {
    try {
      const db = await getDb();
      const rep = ((await db.getAllAsync("SELECT * FROM daily_reports WHERE id = ?", [reportId]).catch(() => [])) ?? [])[0];
      if (!rep) return Alert.alert("Pa jwenn", "Rapò sa a pa la.");
      // Per-shift attribution: the report's own shift (overnight-safe), legacy
      // rows resolved by the shift active when the report was written, and an
      // unlinked report bounded to its own day — never history-wide.
      const { shift: repShift, inWin } = await resolveReportShift(db, rep);
      const cms = ((await db.getAllAsync("SELECT * FROM cash_movements").catch(() => [])) ?? []) as any[];
      // Per-shift only: this shift's tagged movements, plus untagged ones
      // taken by this cashier inside THIS shift's window (start → end).
      const movements = cms.filter((m: any) => (m.shift_id && repShift && String(m.shift_id) === String(repShift.id)) || (!m.shift_id && inWin(m.created_at) && (m.taken_by ?? null) === (rep.user_id ?? null)));
      const hands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []).filter((h: any) => h.carried_into_report_id === reportId);
      const debts = ((await db.getAllAsync("SELECT * FROM credit_payments").catch(() => [])) ?? [])
        .filter((p: any) => (p.collected_by ?? null) === (rep.user_id ?? null) && paymentInReportShift(p, repShift, inWin));
      setDetail({ report: rep, shift: repShift, movements, hands, debts, reviews: reviews.filter((r: any) => r.report_id === reportId) });
    } catch (e: any) { uploadError("Erè", e?.message ?? "Chajman rapò echwe"); }
  }

  // ---------- Supervisor: person drill-in (live report for today) ----------
  // Shared fetcher: full drill-in modal and inline queue cards use the same
  // live data so the numbers always agree.
  async function fetchPerson(member: TeamMember): Promise<PersonReport | null> {
    const db = await getDb();
    // Overnight-proof: span yesterday→today so a shift started before
    // midnight is found; the live shift's own window trims precisely.
    const yKey = localDayKey(Date.now() - 86400000);
    const wideLo = localDayRange(yKey)[0];
    const wideHi = localDayRange(today)[1];
    const inWide = (ts: any) => { const s = String(ts ?? ""); return s !== "" && s >= wideLo && s < wideHi; };
    const shifts = ((await db.getAllAsync("SELECT * FROM shifts WHERE cashier_id = ? AND start_time >= ? AND start_time < ?", [member.id, wideLo, wideHi]).catch(() => [])) ?? []) as any[];
    // Last shift first: the live view always follows the latest (open)
    // shift — never the day's first one on multi-shift days.
    const ordered = shifts.slice().sort((a: any, b: any) => (((b.status === "open") ? 1 : 0) - ((a.status === "open") ? 1 : 0)) || String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")));
    const liveShift = ordered[0] ?? null;
    // Latest submitted report first so the confirm action targets the shift
    // awaiting review; otherwise the latest report overall.
    const memberReps = teamReports.filter((r: any) => r.user_id === member.id);
    const rep = memberReps.filter((r: any) => String(r.status ?? "") === "submitted")
      .sort((a: any, b: any) => String(b.submitted_at ?? b.created_at ?? "").localeCompare(String(a.submitted_at ?? a.created_at ?? "")))[0]
      ?? memberReps.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
    const sales = (await db.getAllAsync("SELECT * FROM sales WHERE seller_id = ? AND created_at >= ? AND created_at < ?", [member.id, wideLo, wideHi]).catch((): any => []) as any[]) ?? [];
    const items = ((await db.getAllAsync("SELECT * FROM sale_items").catch(() => [])) ?? []).filter((it: any) => sales.some((s: any) => s.id === it.sale_id));
    await attachLineLabels(db, items).catch(() => {});
    const debts = ((await db.getAllAsync("SELECT * FROM credit_payments").catch(() => [])) ?? []).filter((p: any) => (p.payment_method ?? "cash") === "cash" && inWide(p.created_at) && (p.collected_by ?? null) === member.id)
      .concat((((await db.getAllAsync("SELECT * FROM debt_collections").catch(() => [])) ?? []) as any[]).filter((d: any) => inWide(d.created_at) && shifts.some((s: any) => s.id === d.shift_id)));
    const cms = ((await db.getAllAsync("SELECT * FROM cash_movements").catch(() => [])) ?? []).filter((m: any) => (m.shift_id && shifts.some((s: any) => s.id === m.shift_id)) || ((m.taken_by ?? null) === member.id && inWide(m.created_at)));
    const hands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []).filter((h: any) => (h.cashier_id ?? null) === member.id && inWide(h.handed_at ?? h.created_at));
    return { user: member, shift: liveShift, report: rep, sales, items, debts, movements: cms, hands };
  }

  async function openPerson(member: TeamMember) {
    try {
      const data = await fetchPerson(member);
      if (data) setPerson(data);
    } catch (e: any) { uploadError("Erè", e?.message ?? "Chajman moun echwe"); }
  }

  // ---------- Sequential end report ----------
  // One report per shift (multi-shift days): the id and shift_id pin the
  // report to the shift it closes. Legacy rows keep rep-${uid}-${day}.
  // Returns the report id (existing or newly created).
  async function ensureReport(): Promise<string | null> {
    try {
      const db = await getDb();
      const shiftId = (myShiftToday as any)?.id ?? null;
      const repId = shiftId ? reportIdForShift(shiftId) : reportIdForDay(currentUser.id, today);
      if (reports.some((r: any) => r.id === repId || (shiftId && (r as any).shift_id === shiftId))) return repId;
      let carry = 0;
      let carriedIds: string[] = [];
      try {
        const allHands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []) as any[];
        const mineHands = allHands.filter((h: any) => (h.store_id ?? storeId) === storeId && h.cashier_id === currentUser.id);
        carry = carryTotal(mineHands);
        carriedIds = mineHands
          .filter((h: any) => Number(h?.cashier_confirmed ?? 0) === 1 && (h?.carried_into_report_id == null || String(h.carried_into_report_id) === "") && !Number(h?.is_deleted ?? 0))
          .map((h: any) => String(h.id));
      } catch {}
      // Store THIS user's shift-window figures (not the store roll-up) so the
      // saved report shows exactly what her till handled — incl. MonCash/NatCash
      // for the manager to verify.
      await db.runAsync(
        "INSERT INTO daily_reports (id, store_id, report_date, role, user_id, shift_id, status, standby_carry, opening_balance, cash_sales, moncash_sales, natcash_sales, credit_sales, credit_collected_cash, withdrawals_total, inventory_total, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [repId, storeId, today, role, currentUser.id, shiftId, "pending", carry, myOpening, myCashTotal, myMoncashTotal, myNatcashTotal, myCreditTotal, myCollectedTotal, myCashOutTotal, inventoryTotal, new Date().toISOString()]
      );
      if (carriedIds.length) {
        const ts = new Date().toISOString();
        for (const hid of carriedIds) {
          try {
            await db.runAsync("UPDATE standby_hands SET carried_into_report_id = ?, carried_at = ?, updated_at = ?, dirty = ? WHERE id = ?",
              [repId, ts, ts, 1, hid]);
          } catch {}
        }
      }
      return repId;
      } catch (e) {
      console.log("[ensureReport] failed:", e);
      throw e;
    }
  }

  async function handAndConfirmStandby() {
    if (!currentUser?.id) return;
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      // Timestamped ids — one handover per shift on multi-shift days. Points
      // at the locked (submitted) report when there is one, else the legacy
      // per-day id.
      const handId = mintId();
      const lockedRepId = (myReportToday as any)?.id ?? reportIdForDay(currentUser.id, today);
      const existing = hands.find((h: any) => (h.cashier_id ?? null) === currentUser.id
        && (h.carried_into_report_id == null || String(h.carried_into_report_id) === "")
        && Number(h?.cashier_confirmed ?? 0) === 0);
      if (!existing) {
        const cashierStore = (currentUser as any)?.store ?? null;
        let managers = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id && (u.store === cashierStore || u.role === "owner"));
        if (!managers.length) managers = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id);
        const managerId = managers[0]?.id ?? USER_IDS.manager;
        await db.runAsync(
          "INSERT INTO standby_hands (id, store_id, cashier_id, manager_id, report_id, sale_count, amount, handed_at, cashier_confirmed, confirmed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [handId, storeId, currentUser.id, managerId, lockedRepId, myStandbyCashCount, myStandbyAmount, ts, 1, ts, ts, ts]);
      } else {
        await db.runAsync("UPDATE standby_hands SET cashier_confirmed = ?, confirmed_at = ?, updated_at = ?, dirty = ? WHERE id = ?",
          [1, ts, ts, 1, (existing as any).id]);
      }
      const cashierStore = (currentUser as any)?.store ?? null;
      let notifyIds = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id && (u.store === cashierStore || u.role === "owner")).map(u => u.id);
      if (!notifyIds.length) notifyIds = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id).map(u => u.id);
      const confirmedHandId = existing ? String((existing as any).id) : handId;
      for (const uid of [...new Set(notifyIds)].slice(0, 6)) {
        try {
          await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), uid, "standby_confirmed", confirmedHandId,
              `${currentUser.name} konfime li pase ${fmtG(myStandbyAmount)} standby (${myStandbyCashCount} vant) apre rapò li.`, "pending", ts]);
        } catch {}
      }
      uploadSuccess("Standby konfime", `${fmtG(myStandbyAmount)} pase bay manadjè a.`);
      notifyLocal("Standby konfime", `${fmtG(myStandbyAmount)} standby pase bay manadjè a.`, { screen: "shift" });
      try { const { salesEvents: ev } = await import("../salesEvents"); ev.emit(); } catch {}
      load({ silent: true });
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Pase standby echwe");
    }
  }

  async function openTabsForMe(): Promise<any[]> {
    try {
      const db = await getDb();
      const rows = (await db.getAllAsync("SELECT * FROM suspended_sales WHERE status = 'open'").catch(() => [])) as any[];
      return (rows ?? []).filter((t: any) => (t.cashier_id ?? null) === (currentUser?.id ?? null));
    } catch { return []; }
  }

  async function endReport(counted?: number) {
    if (!currentUser?.id) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    const myTabs = await openTabsForMe();
    if (myTabs.length) {
      return Alert.alert("Tab ouvè — pa ka fèmen", `Ou gen ${myTabs.length} vant an atann (${myTabs.slice(0, 3).map((t: any) => t.label).join(" · ")}${myTabs.length > 3 ? "…" : ""}). Fèmen oswa anile yo nan Vant anvan ou fèmen chanjman an.`);
    }
    const countedActual = counted ?? actual;
    if (isCashier && countedActual == null) {
      Alert.alert("Antre montan", "Antre montan kach ou konte anvan ou fèmen rapò a.");
      setShowEnd(true);
      return;
    }
    const deficitAmt = isCashier ? Math.max(0, expectedCash - (countedActual ?? expectedCash)) : 0;
    const finalActual = countedActual;
    try {
      const db = await getDb();
      if (isCashier && shift && counted != null) {
        try {
          await db.runAsync("UPDATE shifts SET actual_cash = ?, cashier_confirmed = 1, updated_at = ? WHERE id = ?", [counted, new Date().toISOString(), shift.id]);
          setShift((prev: any) => prev ? { ...prev, actual_cash: counted } : prev);
          setMyShiftToday((prev: any) => prev && prev.id === (shift as any).id ? { ...prev, actual_cash: counted } : prev);
        } catch {}
      }
      // Refresh EVERY itemized figure at submit — the row may already exist
      // (reopened/resubmitted report) and ensureReport only writes on first
      // insert, so stale figures would make the report disagree with the
      // cards she just confirmed (Final Total ≠ itemized sum).
      // Keyed by report id: one report per shift on multi-shift days.
      const submitRepId = (await ensureReport())
        ?? (myReportToday as any)?.id
        ?? ((myShiftToday as any)?.id ? reportIdForShift((myShiftToday as any).id) : reportIdForDay(currentUser.id, today));
      await db.runAsync("UPDATE daily_reports SET status = ?, expected_cash = ?, actual_cash = ?, deficit = ?, submitted_at = ?, closed_at = ?, standby_carry = ?, opening_balance = ?, cash_sales = ?, moncash_sales = ?, natcash_sales = ?, credit_sales = ?, credit_collected_cash = ?, withdrawals_total = ?, inventory_total = ?, updated_at = ? WHERE id = ?",
        ["submitted", expectedCash, finalActual, deficitAmt, new Date().toISOString(), null, myStandbyCarry, myOpening, myCashTotal, myMoncashTotal, myNatcashTotal, myCreditTotal, myCollectedTotal, myCashOutTotal, inventoryTotal, new Date().toISOString(), submitRepId]);
      try {
        const { clearCartDraft } = await import("../sales/cartDraft");
        await clearCartDraft(db, storeId, currentUser.id);
      } catch {}
      if (isCashier && deficitAmt > 0) {
        const existing = await db.getAllAsync("SELECT * FROM cashier_deficits WHERE status = ?", ["open"]);
        const todayRow = existing.find((d: any) => d.cashier_id === currentUser.id && d.date === today && d.store_id === storeId);
        if (todayRow) {
          await db.runAsync("UPDATE cashier_deficits SET deficit = ?, updated_at = ? WHERE id = ?", [Number(todayRow.deficit) + deficitAmt, new Date().toISOString(), todayRow.id]);
        } else {
          await db.runAsync("INSERT INTO cashier_deficits (id, store_id, cashier_id, date, deficit, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), storeId, currentUser.id, today, deficitAmt, "open", new Date().toISOString()]);
        }
      }
      const cashierStore = (currentUser as any)?.store ?? null;
      let supervisorIds: string[] = USERS
        .filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id && (u.store === cashierStore || u.role === "owner"))
        .map(u => u.id);
      if (supervisorIds.length === 0) {
        supervisorIds = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner") && u.id !== currentUser.id).map(u => u.id);
      }
      const notifyIds = [...new Set(supervisorIds)];
      if (notifyIds.length > 0) {
        for (const uid of [...new Set(notifyIds)]) {
          if (uid === currentUser.id) continue;
          await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), uid, "report_submitted", submitRepId,
            `${currentUser.name} (${role.toUpperCase()}) soumèt rapò jounen li — ap tann konfimasyon ou. Atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)} — Defisi: ${fmtG(deficitAmt)}${deficitAmt>0?` (dèt anrejistre pou ${currentUser.name})`:""}`, "pending", new Date().toISOString()]);
        }
      }
      const supLabel = cashierStore ? `Manadjè/Admin (${cashierStore}) + Owner` : "Manadjè/Admin/Owner";
      uploadSuccess("Rapò soumèt", `Rapò kesye soumèt — ap tann konfimasyon sipèvizè a. Atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)} — Defisi ${fmtG(deficitAmt)}. Notifikasyon voye bay ${supLabel}.`);
      notifyLocal(deficitAmt > 0 ? `Rapò soumèt — Defisi ${fmtG(deficitAmt)}` : "Rapò soumèt", `${currentUser.name} soumèt rapò jounen li (atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)}, defisi ${fmtG(deficitAmt)}) — ap tann konfimasyon.`, { screen: "report", id: String(submitRepId) });
      try { const { salesEvents } = await import("../salesEvents"); salesEvents.emit(); } catch {}
      setCheckCounted(false); setCheckCashOut(false); setCheckStandby(false);
      load({ silent: true });
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Fèmen rapò echwe");
    }
  }

  // ---------- Lightweight confirm (manager/admin/owner) ----------
  // Daily queue only: confirm today's submitted report → closed. A deficit
  // found here opens a cashier_deficits row that Business Guard (weekly
  // queue) resolves later — no debt/waive/settlement decisions here.
  const visibleReport = (r: any) => {
    if ((currentUser as any)?.role === "owner") return true;
    const cashier = getUserById(r.user_id);
    if (!cashier?.store) return true;
    return cashier.store === (currentUser as any)?.store;
  };
  const pendingReports = teamReports
    .filter((r: any) => r.status === "submitted" && (RANK[r.role] ?? 0) < myRank && r.user_id !== currentUserId && visibleReport(r))
    .sort((a: any, b: any) => String(b.submitted_at ?? b.created_at ?? "").localeCompare(String(a.submitted_at ?? a.created_at ?? "")));

  // Lightweight confirm: close today's submitted report. No deficit
  // decisions here — a deficit opens a cashier_deficits row that Business
  // Guard (weekly queue) resolves later.
  async function confirmReport(r: any) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka konfime yon rapò");
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      const deficitAmt = Number(r.deficit ?? 0);
      const cashierName = getUserById(r.user_id)?.name ?? r.user_id;
      const decision = deficitAmt > 0 ? "debt" : "approved";
      await db.runAsync(
        "INSERT INTO report_reviews (id, store_id, report_id, cashier_id, report_date, deficit, decision, decided_by, decided_by_role, decided_by_rank, reason, previous_review_id, created_at, lamport_clock, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [mintId(), storeId, r.id, r.user_id, r.report_date, deficitAmt, decision, currentUser?.id ?? null, currentUser?.role ?? null, myRank, null, null, ts, 1, ts]);
      await db.runAsync("UPDATE daily_reports SET reviewed_by = ?, reviewed_at = ?, status = ?, closed_at = ? WHERE id = ?", [currentUser?.id ?? null, ts, "closed", ts, r.id]);
      try {
        // Sequential shifts: close the shift this report belongs to. Legacy
        // rows predate shift_id — fall back to closing today's open shifts.
        if ((r as any).shift_id) {
          await db.runAsync(
            "UPDATE shifts SET status = 'closed', end_time = ?, manager_confirmed = 1, updated_at = ? WHERE id = ? AND status = 'open'",
            [ts, ts, (r as any).shift_id]);
        } else {
          await db.runAsync(
            "UPDATE shifts SET status = 'closed', end_time = ?, manager_confirmed = 1, updated_at = ? WHERE cashier_id = ? AND start_time >= ? AND start_time < ? AND status = 'open'",
            [ts, ts, r.user_id, ...localDayRange(r.report_date)]);
        }
      } catch {}
      try {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [mintId(), r.user_id, "report_confirmed", r.id,
            `Rapò ${r.report_date} konfime pa ${currentUser?.name ?? currentUser?.role}. Chanjman ou fèmen — ou ka dekonekte.`, "pending", ts]);
      } catch {}
      if (deficitAmt > 0) {
        const existing = (await db.getAllAsync("SELECT * FROM cashier_deficits WHERE cashier_id = ? AND date = ? AND store_id = ?", [r.user_id, r.report_date, storeId]).catch(() => [])) as any[];
        if (existing.length === 0) {
          await db.runAsync("INSERT INTO cashier_deficits (id, store_id, cashier_id, date, deficit, status, created_at) VALUES (?,?,?,?,?,?,?)",
            [mintId(), storeId, r.user_id, r.report_date, deficitAmt, "open", ts]);
        }
      }
      notifyLocal("Rapò konfime", deficitAmt > 0
        ? `${cashierName} (${r.report_date}) konfime — defisi ${fmtG(deficitAmt)} ap swiv nan Business Guard.`
        : `${cashierName} (${r.report_date}) konfime — balanse.`,
        { screen: "report", id: String(r.id) });
      uploadSuccess("Rapò konfime ✓", deficitAmt > 0
        ? `${cashierName}: defisi ${fmtG(deficitAmt)} anrejistre — ap swiv nan Business Guard.`
        : `${cashierName}: rapò balanse, fèmen.`);
      const { salesEvents: ev } = await import("../salesEvents");
      try { ev.emit(); } catch {}
      load({ silent: true });
      if (String(currentUser?.id ?? "") === String(r.user_id ?? "")) {
        setTimeout(() => { auth.signOut().catch(() => {}); }, 600);
      }
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Konfimasyon rapò echwe");
    }
  }

  if (loading) return <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={SHIFT.live} /><Text style={{ marginTop: 8, color: "#9a9a9e" }}>Ap chaje...</Text></View>;

  const todayStr = new Date().toLocaleDateString("fr-HT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const reportRow = reports.find((r: any) => r.user_id === currentUser?.id);

  // Supervisor team dashboard data — cascade one level apart, action bubbles up.
  // Owner sees all stores; others only their own store's people.
  const sameStore = (uid: string) => {
    if ((currentUser as any)?.role === "owner") return true;
    const u = getUserById(uid);
    if (!u?.store) return true;
    return u.store === (currentUser as any)?.store;
  };
  const notOpened = roster.filter(r => !teamShifts.some((s: any) => String(s.cashier_id) === r.id) && sameStore(r.id));
  const myPendingOpenings = pendingOpenings.filter((s: any) => s.manager_id === currentUserId);
  const activeShifts = teamShifts.filter((s: any) => s.status === "open" && sameStore(String(s.cashier_id)));
  // Disputes (both kinds) — visible system-wide, bubble to the top.
  const myDisputes = claims.filter((c: any) => sameStore(c.cashier_id));
  const otherPendingOpenings = pendingOpenings.filter((s: any) => s.manager_id !== currentUserId);
  const confirmCount = myPendingOpenings.length + pendingReports.length + myDisputes.length;
  // Review queue (supervisor main screen): pending = openings + submitted
  // reports, confirmed = closed today, disputed = open claims of both kinds.
  const confirmedToday = teamReports
    .filter((r: any) => r.status === "closed" && visibleReport(r))
    .sort((a: any, b: any) => String(b.closed_at ?? b.reviewed_at ?? "").localeCompare(String(a.closed_at ?? a.reviewed_at ?? "")));
  const openingDisputes = myDisputes.filter((c: any) => (c.action ?? "claim") === "claim");
  const reportDisputes = myDisputes.filter((c: any) => c.action === "report_dispute");
  const isSevere = (r: any) => {
    const d = Number(r.deficit ?? 0);
    if (d <= 0) return false;
    return d >= 500 || d >= 0.1 * Number(r.expected_cash ?? 0);
  };
  const dateEyebrow = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  const dateStr = `${new Date().toLocaleDateString("en-GB", { weekday: "short" })}, ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  // ── Cashier main screen: history of past reports, one status per row ──
  // Designed in the pending-row language of the review queue: #151518 card,
  // 44px circle, mono amount + status pill, hairline border, chevron.
  // Priority: an open dispute outranks the deficit, a clean close = Well done.
  const cashierHistoryHeading = (
    <View style={{ marginTop: 18, flexDirection: "row", alignItems: "center" }}>
      <Text style={{ fontSize: 11, color: "#9a9a9e", fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", flex: 1 }}>Daily report · {dateEyebrow}</Text>
      <View style={{ minWidth: 32, height: 20, paddingHorizontal: 8, borderRadius: 10, backgroundColor: "#1E1E22", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
        <Text style={{ fontWeight: "800", fontSize: 11, color: "#fff" }}>{pastReports.length}</Text>
      </View>
    </View>
  );
  const cashierHistoryList = pastReports.length === 0 ? (
    <QueueEmpty title="Pa gen rapò ankò" sub="Premye rapò ou ap parèt isit la lè ou fèmen chanjman ou." />
  ) : pastReports.map((r: any) => {
    const d = Number(r.deficit ?? 0);
    const disputed = pastDisputeIds.has(String(r.id));
    const isPending = String(r.status ?? "") === "pending";
    const pill = isPending
      ? { label: "Pending", icon: "time-outline" as const, bg: SHIFT.pendingSoft, fg: SHIFT.pending, bd: SHIFT.pendingBd }
      : disputed
      ? { label: "Disputed", icon: "alert-circle-outline" as const, bg: SHIFT.disputedSoft, fg: SHIFT.disputed, bd: SHIFT.disputedBd }
      : d > 0
        ? { label: `Deficit ${fmtG(d)}`, icon: "warning-outline" as const, bg: SHIFT.pendingSoft, fg: SHIFT.pending, bd: SHIFT.pendingBd }
        : { label: "Well done", icon: "checkmark-circle-outline" as const, bg: SHIFT.activeSoft, fg: SHIFT.active, bd: SHIFT.activeBd };
    const rd = new Date(`${r.report_date}T12:00:00`);
    return (
      <Pressable key={r.id} onPress={() => openReportDetail(r.id)} style={{ backgroundColor: "#151518", borderRadius: 18, marginBottom: 10, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff", ...monoStyle }}>{String(rd.getDate()).padStart(2, "0")}</Text>
            <Text style={{ fontSize: 7.5, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6, marginTop: -1 }}>{rd.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{rd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
            <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Atann {fmtG(Number(r.expected_cash ?? 0))} · Konte {fmtG(Number(r.actual_cash ?? 0))}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 5 }}>
            <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(Number(r.actual_cash ?? 0))}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: pill.bg, borderWidth: 0.5, borderColor: pill.bd }}>
              <Ionicons name={pill.icon} size={10} color={pill.fg} />
              <Text style={{ fontSize: 9.5, fontWeight: "800", color: pill.fg, letterSpacing: 0.4 }}>{pill.label.toUpperCase()}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#6e6e73" />
        </View>
      </Pressable>
    );
  });

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Header — Shift's own identity: cyan "live today", not Business Guard gold */}
      <View style={{ paddingHorizontal: padH, paddingTop: 10, paddingBottom: 12, display: (isSupervisor && supView === "open") || (isCashier && cashierOpenView) ? "none" : "flex" }}>
        <View style={{ backgroundColor: "#1c1c1e", borderRadius: radius.lg, padding: 16, ...shadow.card, borderTopWidth: 2.5, borderTopColor: SHIFT.live }}>
          {isSupervisor ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
                  <Ionicons name="person-outline" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 16, color: "#fff" }} numberOfLines={1}>{currentUser?.name ?? ""}</Text>
                  <Text style={{ fontSize: 10, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 2 }}>{role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Manager"}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: "#1B1B1F", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
                  <Ionicons name="wallet-outline" size={22} color={SHIFT.active} />
                  <View>
                    <Text style={{ fontWeight: "800", fontSize: 17, color: SHIFT.active, ...monoStyle }}>{fmtG(headerBalance)}</Text>
                    <Text style={{ fontSize: 9, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 1 }}>Current balance</Text>
                  </View>
                </View>
                <Pressable onPress={() => { setRefreshing(true); load({ silent: true }); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)" }}>
                  {refreshing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={15} color="#fff" />}
                </Pressable>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
                <Ionicons name="person-outline" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 16, color: "#fff" }} numberOfLines={1}>{currentUser?.name ?? ""}</Text>
                <Text style={{ fontSize: 10, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 2 }}>Cashier</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: "#1B1B1F", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
                <Ionicons name="wallet-outline" size={22} color={SHIFT.active} />
                <View>
                  <Text style={{ fontWeight: "800", fontSize: 17, color: SHIFT.active, ...monoStyle }}>{fmtG(headerBalance)}</Text>
                  <Text style={{ fontSize: 9, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 1 }}>Current balance</Text>
                </View>
              </View>
              <Pressable onPress={() => { setRefreshing(true); load({ silent: true }); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)" }}>
                {refreshing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={15} color="#fff" />}
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1, display: (isSupervisor && supView === "open") || (isCashier && cashierOpenView) ? "none" : "flex" }} contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 40 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SHIFT.live} colors={[SHIFT.live]} />}>

        {/* ══ CASHIER: no live shift — the main screen IS the report history.
             The Open Shift modal (auto-shown, reopen via the header button)
             is the only place to open. ══ */}
        {isCashier && !hasShiftToday && !reportSubmitted && (
          <>{cashierHistoryHeading}{cashierHistoryList}</>
        )}

        {/* ══ CASHIER: shift started (pending or open) — live today-only dashboard ══ */}
        {isCashier && hasShiftToday && !reportSubmitted && (
          <>
            {/* Gentle, persistent, informational — never a hard stop */}
            {myShiftToday.status === "pending" ? (
              claims.some((c: any) => c.cashier_id === currentUserId) ? (
                <View style={{ marginTop: 12, backgroundColor: SHIFT.disputedSoft, borderRadius: radius.md, borderWidth: 0.5, borderColor: SHIFT.disputedBd, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="alert-circle-outline" size={17} color={SHIFT.disputed} />
                    <Text style={{ flex: 1, fontSize: 11.5, color: SHIFT.disputed, lineHeight: 17 }}>
                      Ouvèti w konteste — {fmtG(Number(claims.find((c: any) => c.cashier_id === currentUserId)?.stated_amount ?? myOpening))} ou di vs {fmtG(Number(myShiftToday.opening_stated ?? 0))} anrejistre. Tout moun ka wè plent la.
                    </Text>
                    <StatusBadge status="disputed" />
                  </View>
                  {claimFor === myShiftToday.id ? (
                    <View style={{ marginTop: 10, backgroundColor: palette.surface, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
                      <MoneyInput placeholder="Montan kòrèk" value={claimAmount} onChangeText={setClaimAmount} keyboardType="numeric" style={{ borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 10, minHeight: 42, fontWeight: "700", fontSize: 15, textAlign: "center", backgroundColor: palette.surfaceGrouped, fontFamily: "Inter_700Bold", color: palette.ink }} />
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                        <Pressable onPress={() => fileClaim(myShiftToday.id)} style={{ flex: 1, backgroundColor: SHIFT.disputed, borderRadius: radius.sm, paddingVertical: 9, alignItems: "center" }}>
                          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>Voye plent lan</Text>
                        </Pressable>
                        <Pressable onPress={() => { setClaimFor(null); setClaimAmount(""); }} style={{ backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 12 }}>
                          <Text style={{ fontWeight: "700", fontSize: 11, color: "#fff" }}>Anile</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable onPress={() => { setClaimFor(myShiftToday.id); setClaimAmount(String(myShiftToday.opening_stated ?? "")); }} style={{ marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 0.5, borderColor: SHIFT.disputedBd }}>
                      <Ionicons name="flag-outline" size={13} color={SHIFT.disputed} />
                      <Text style={{ fontSize: 11, fontWeight: "800", color: SHIFT.disputed }}>Konteste montan an</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View style={{ marginTop: 12, backgroundColor: SHIFT.pendingSoft, borderRadius: radius.md, borderWidth: 0.5, borderColor: SHIFT.pendingBd, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="information-circle-outline" size={17} color={SHIFT.pending} />
                    <Text style={{ flex: 1, fontSize: 11.5, color: SHIFT.pending, lineHeight: 17 }}>
                      {fmtG(myOpening)} an kours — {getUserById(myShiftToday.manager_id)?.name ?? "manadjè a"} poko konfime. Sa pa bloke vant ou.
                    </Text>
                  </View>
                  {claimFor === myShiftToday.id ? (
                    <View style={{ marginTop: 10, backgroundColor: palette.surface, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
                      <MoneyInput placeholder="Montan kòrèk" value={claimAmount} onChangeText={setClaimAmount} keyboardType="numeric" style={{ borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 10, minHeight: 42, fontWeight: "700", fontSize: 15, textAlign: "center", backgroundColor: palette.surfaceGrouped, fontFamily: "Inter_700Bold", color: palette.ink }} />
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                        <Pressable onPress={() => fileClaim(myShiftToday.id)} style={{ flex: 1, backgroundColor: SHIFT.disputed, borderRadius: radius.sm, paddingVertical: 9, alignItems: "center" }}>
                          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>Voye plent lan</Text>
                        </Pressable>
                        <Pressable onPress={() => { setClaimFor(null); setClaimAmount(""); }} style={{ backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 12 }}>
                          <Text style={{ fontWeight: "700", fontSize: 11, color: "#fff" }}>Anile</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable onPress={() => { setClaimFor(myShiftToday.id); setClaimAmount(String(myShiftToday.opening_stated ?? "")); }} style={{ marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 0.5, borderColor: SHIFT.pendingBd }}>
                      <Ionicons name="flag-outline" size={13} color={SHIFT.pending} />
                      <Text style={{ fontSize: 11, fontWeight: "800", color: SHIFT.pending }}>Montan an pa bon?</Text>
                    </Pressable>
                  )}
                </View>
              )
            ) : (
              <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: SHIFT.activeSoft, borderRadius: radius.md, borderWidth: 0.5, borderColor: SHIFT.activeBd, padding: 12 }}>
                <Ionicons name="checkmark-circle-outline" size={17} color={SHIFT.active} />
                <Text style={{ flex: 1, fontSize: 11.5, color: SHIFT.active, lineHeight: 17 }}>
                  Chanjman konfime — {fmtG(myOpening)} ouvèti. Bon travay.
                </Text>
              </View>
            )}

            {/* Standby handover (post-lock sales) */}
            {(myStandbyAmount > 0 || myHand) && (
              <View style={{ marginTop: 12, borderRadius: radius.md, borderWidth: 0.5, borderColor: myHand && Number(myHand.cashier_confirmed ?? 0) === 1 ? SHIFT.activeBd : SHIFT.pendingBd, backgroundColor: myHand && Number(myHand.cashier_confirmed ?? 0) === 1 ? SHIFT.activeSoft : SHIFT.pendingSoft, padding: 13 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="hourglass-outline" size={16} color={SHIFT.pending} />
                  <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12.5, color: palette.ink, flex: 1 }}>Standby — vant apre rapò fèmen</Text>
                  {myStandbyAmount > 0 ? <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 13, color: palette.ink }}>{fmtG(myStandbyAmount)}</Text> : null}
                </View>
                {myHand && Number(myHand.cashier_confirmed ?? 0) === 1 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                    <Ionicons name="checkmark-circle" size={14} color={SHIFT.active} />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: SHIFT.active }}>✓ Konfime {td(myHand.confirmed_at ?? myHand.handed_at)} — {fmtG(Number(myHand.amount ?? 0))} pase bay manadjè a</Text>
                  </View>
                ) : myStandbyAmount > 0 ? (
                  <Pressable onPress={handAndConfirmStandby} style={({ pressed }) => [{ marginTop: 10, alignSelf: "flex-start", backgroundColor: "#16130c", borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7, opacity: pressed ? 0.9 : 1 }]}>
                    <Ionicons name="hand-left-outline" size={14} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11.5, color: "#fff" }}>Mwen konfime m pase kòb la</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* Main screen is the report history — past rows with their status */}
            {cashierHistoryHeading}
            {cashierHistoryList}
          </>
        )}

        {/* ══ CASHIER: report submitted — clean history view, nothing else competing ══ */}
        {isCashier && reportSubmitted && (
          <>
            {myStandbyAmount > 0 && (
              <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: SHIFT.pendingSoft, borderRadius: radius.md, borderWidth: 0.5, borderColor: SHIFT.pendingBd, padding: 12 }}>
                <Ionicons name="hourglass-outline" size={17} color={SHIFT.pending} />
                <Text style={{ flex: 1, fontSize: 11.5, color: SHIFT.pending, lineHeight: 17 }}>
                  {myStandbyCashCount} vant standby ({fmtG(myStandbyAmount)}) apre rapò ou — kòb la dwe pase bay manadjè a.
                </Text>
              </View>
            )}
            {cashierHistoryHeading}
            {cashierHistoryList}
          </>
        )}

        {/* ══ SUPERVISOR: Pending Approvals review queue (main screen) ══ */}
        {isSupervisor && supView === "team" && (
          <>
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: "#9a9a9e", fontWeight: "700", letterSpacing: 2, textTransform: "uppercase" }}>Daily report · {dateEyebrow}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 30, color: "#fff", letterSpacing: -0.5, flex: 1 }}>Pending Approvals</Text>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#f5c542", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontWeight: "800", fontSize: 16, color: "#0B0B0D" }}>{confirmCount}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: "#9a9a9e", flex: 1 }}>Review queue</Text>
                <Text style={{ fontSize: 12, color: "#6e6e73" }}>{myPendingOpenings.length + otherPendingOpenings.length + pendingReports.length} reports</Text>
              </View>
              {/* Tabs */}
              <View style={{ flexDirection: "row", backgroundColor: "#1E1E22", borderRadius: 14, padding: 4, gap: 4 }}>
                {(["pending", "confirmed", "disputed"] as const).map(t => {
                  const on = queueTab === t;
                  const n = t === "pending" ? myPendingOpenings.length + otherPendingOpenings.length + pendingReports.length : t === "confirmed" ? confirmedToday.length : myDisputes.length;
                  return (
                    <Pressable key={t} onPress={() => { setQueueTab(t); setExpandedId(null); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: on ? "rgba(255,255,255,0.10)" : "transparent" }}>
                      <Text style={{ fontSize: 13, fontWeight: on ? "800" : "600", color: on ? "#fff" : "#8e8e93", textTransform: "capitalize" }}>{t}{n > 0 ? ` (${n})` : ""}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Pending tab: openings (mine actionable, others visible) + submitted reports */}
              {queueTab === "pending" && (
                <View style={{ marginTop: 12 }}>
                  {myPendingOpenings.length + otherPendingOpenings.length + pendingReports.length === 0 ? (
                    <QueueEmpty title="Anyen ap tann" sub="Tout ekip la ajou." />
                  ) : null}
                  {myPendingOpenings.map((s: any) => (
                    <QueueOpeningRow key={s.id} opening={s} mine expanded={expandedId === s.id}
                      onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      onResolve={resolveOpening} />
                  ))}
                  {otherPendingOpenings.map((s: any) => (
                    <QueueOpeningRow key={s.id} opening={s} mine={false} expanded={false}
                      onToggle={() => openPerson({ id: s.cashier_id, name: getUserById(s.cashier_id)?.name ?? s.cashier_id, role: "cashier" })}
                      onResolve={resolveOpening} />
                  ))}
                  {pendingReports.map((r: any) => (
                    <QueueReportRow key={r.id} report={r} severe={isSevere(r)} expanded={expandedId === r.id}
                      onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      loadPerson={fetchPerson}
                      onConfirm={() => confirmReport(r)}
                      onDispute={() => disputeReport(r)}
                      onInspect={() => openPerson({ id: r.user_id, name: getUserById(r.user_id)?.name ?? r.user_id, role: r.role })} />
                  ))}
                </View>
              )}

              {/* Confirmed tab: closed today — tap drills into the live report */}
              {queueTab === "confirmed" && (
                <View style={{ marginTop: 12 }}>
                  {confirmedToday.length === 0 ? (
                    <QueueEmpty title="Pa gen rapò konfime" sub="Rapò w konfime jodi a ap parèt isit la." />
                  ) : confirmedToday.map((r: any) => {
                    const name = getUserById(r.user_id)?.name ?? r.user_id;
                    const d = Number(r.deficit ?? 0);
                    return (
                      <Pressable key={r.id} onPress={() => openPerson({ id: r.user_id, name, role: r.role })} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#151518", borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
                        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{initialsOf(name)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{name}</Text>
                          <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Confirmed {ago(r.closed_at ?? r.reviewed_at)}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 5 }}>
                          <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(Number(r.expected_cash ?? 0))}</Text>
                          {d > 0 ? (
                            <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.warningBg, color: palette.warning, fontWeight: "800", fontSize: 10 }}>DEFICIT</Text>
                          ) : (
                            <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: SHIFT.activeSoft, color: SHIFT.active, fontWeight: "800", fontSize: 10 }}>CONFIRMED</Text>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#6e6e73" />
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Disputed tab: opening claims + report disputes, resolved inline */}
              {queueTab === "disputed" && (
                <View style={{ marginTop: 12 }}>
                  {myDisputes.length === 0 ? (
                    <QueueEmpty title="Pa gen plent" sub="Plent sou ouverture ap parèt isit la." />
                  ) : null}
                  {openingDisputes.map((c: any) => {
                    const name = getUserById(c.cashier_id)?.name ?? c.cashier_id;
                    return (
                      <View key={c.id} style={{ backgroundColor: "#151518", borderWidth: 0.5, borderColor: SHIFT.disputedBd, borderRadius: 18, overflow: "hidden", marginBottom: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{initialsOf(name)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{name}</Text>
                            <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Di {fmtG(Number(c.stated_amount ?? 0))} vs {fmtG(Number(c.program_amount ?? 0))} anrejistre</Text>
                          </View>
                          <StatusBadge status="disputed" />
                        </View>
                        <View style={{ flexDirection: "row", gap: 6, padding: 12, borderTopWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
                          <Pressable onPress={() => resolveClaim(c.id, true)} style={{ flex: 1, backgroundColor: SHIFT.active, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ color: "#06281c", fontWeight: "800", fontSize: 12 }}>Apwouve plent</Text>
                          </Pressable>
                          <Pressable onPress={() => resolveClaim(c.id, false)} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Rejete</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                  {reportDisputes.map((c: any) => {
                    const name = getUserById(c.cashier_id)?.name ?? c.cashier_id;
                    const r = teamReports.find((x: any) => x.id === c.report_id);
                    return (
                      <View key={c.id} style={{ backgroundColor: "#151518", borderWidth: 0.5, borderColor: SHIFT.disputedBd, borderRadius: 18, overflow: "hidden", marginBottom: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{initialsOf(name)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{name}</Text>
                            <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Rapò {c.check_date} konteste pa {getUserById(c.set_by)?.name ?? "sipèvizè"}</Text>
                          </View>
                          <StatusBadge status="disputed" />
                        </View>
                        <View style={{ flexDirection: "row", gap: 6, padding: 12, borderTopWidth: 0.5, borderColor: "rgba(255,255,255,0.08)" }}>
                          <Pressable onPress={() => resolveReportDispute(c.id, true)} style={{ flex: 1, backgroundColor: "#4ade80", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ color: "#06281c", fontWeight: "800", fontSize: 12 }}>Konfime rapò{r ? ` · ${fmtG(Number(r.expected_cash ?? 0))}` : ""}</Text>
                          </Pressable>
                          <Pressable onPress={() => resolveReportDispute(c.id, false)} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                            <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Retire plent</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Other pending openings (not named to me) */}
            {otherPendingOpenings.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <SectionTitle icon="hourglass-outline" title="Ouverture an atant konfimasyon" count={otherPendingOpenings.length} color={SHIFT.pending} />
                {otherPendingOpenings.map((s: any) => {
                  const m = { id: s.cashier_id, name: getUserById(s.cashier_id)?.name ?? s.cashier_id, role: "cashier" };
                  return (
                    <Pressable key={s.id} onPress={() => openPerson(m)} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.surface, borderRadius: radius.lg, padding: 13, marginBottom: 8, borderWidth: 0.5, borderColor: palette.hairline }}>
                      <Avatar name={m.name} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13.5, fontWeight: "700", color: palette.ink }}>{m.name}</Text>
                        <Text style={{ fontSize: 10.5, color: palette.muted2, marginTop: 2 }}>{fmtG(Number(s.opening_stated ?? 0))} · manadjè: {getUserById(s.manager_id)?.name ?? s.manager_id}</Text>
                      </View>
                      <StatusBadge status="pending" />
                    </Pressable>
                  );
                })}
              </View>
            )}

          </>
        )}

        {/* ══ SUPERVISOR: own shift (secondary detour) ══ */}
        {isSupervisor && supView === "own" && hasShiftToday && (
          <>
            <View style={{ marginTop: 12, alignSelf: "flex-start" }}>
              <DarkBackButton onPress={() => setSupView("team")} />
            </View>
            {!reportSubmitted ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {myReportToday ? (
                  <Pressable onPress={() => openReportDetail(myReportToday.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Ionicons name="document-text-outline" size={15} color={palette.inkSoft} />
                    <Text style={{ fontSize: 12, fontWeight: "800", color: palette.inkSoft }}>Wè rapò mwen</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => { setActualCash(""); setCheckCounted(false); setCheckCashOut(false); setCheckStandby(false); setShowEnd(true); }} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: "#16130c", borderWidth: 1, borderColor: SHIFT.liveBd }}>
                  <Ionicons name="power-outline" size={15} color={SHIFT.live} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff" }}>Fèmen rapò mwen</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.hairline, padding: 13 }}>
              <Ionicons name="time-outline" size={16} color={palette.muted2} />
              <Text style={{ flex: 1, fontSize: 11.5, color: palette.muted2, lineHeight: 17 }}>
                Sinon fèmen otomatik chak jou a <Text style={{ fontWeight: "800", color: palette.inkSoft }}>{autoCloseTime}</Text> — ou ka fèmen rapò w manyèlman pi bonè.
              </Text>
            </View>
          </>
        )}
        {isSupervisor && supView === "own" && !hasShiftToday && (
          <View style={{ marginTop: 12, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 22, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 17, color: palette.ink, letterSpacing: -0.2 }}>Ouvert pa ou menm</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 5, textAlign: "center" }}>Antre kach ouvèti a — pa bezwen apwobasyon.</Text>
            <MoneyInput placeholder="0" value={ownShiftAmount} onChangeText={setOwnShiftAmount} keyboardType="numeric" style={{ borderWidth: 1, borderColor: palette.ink2, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: 16, minHeight: 64, marginTop: 14, fontWeight: "800", fontSize: 32, textAlign: "center", backgroundColor: palette.surfaceGrouped, fontFamily: "Inter_700Bold", color: palette.ink, width: "100%" }} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16, width: "100%" }}>
              <Pressable onPress={() => setSupView("team")} style={{ flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline }}>
                <Text style={{ fontWeight: "700", color: palette.ink }}>Anile</Text>
              </Pressable>
              <Pressable onPress={submitOpening} disabled={!ownShiftAmount} style={{ flex: 2, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", backgroundColor: ownShiftAmount ? SHIFT.live : palette.surfaceGrouped, opacity: ownShiftAmount ? 1 : 0.6 }}>
                <Text style={{ color: ownShiftAmount ? "#06222b" : palette.muted, fontWeight: "800" }}>Kòmanse</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ══ End shift — Review & Submit Report (cashier closing sheet) ══ */}
      <Modal visible={showEnd} animationType="slide" onRequestClose={() => setShowEnd(false)}>
        <SafeScreen style={{ flex: 1, backgroundColor: "#0B0B0D" }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: Platform.OS === "ios" ? 6 : 14, paddingBottom: 40, ...(isTablet && { alignItems: "center" }) }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%" }}>
                {(() => {
                  const countedVal = parseFloat(actualCash);
                  const hasCounted = actualCash.trim() !== "" && !isNaN(countedVal) && countedVal >= 0;
                  const cashCount = myOwnSales.filter(s => s.payment_method === "cash").length;
                  const cashRemoved = myCashOutTotal + inventoryTotal;
                  const diff = hasCounted ? expectedCash - countedVal : null;
                  const canSubmit = hasCounted && checkCounted && (myStandbyAmount === 0 || checkStandby);
                  const card = { backgroundColor: "#1B1B1F", borderRadius: 22 as const, padding: 18, marginTop: 12, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)" };
                  const cardLabel = { fontSize: 11, color: "#9a9a9e", fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 1.6 };
                  const bigNum = { fontFamily: "Inter_700Bold", fontWeight: "800" as const, fontSize: 36, letterSpacing: -0.5, marginTop: 8, ...monoStyle };
                  return (
                    <View>
                      {/* Identity */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#26262B", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
                          <Text style={{ fontWeight: "800", fontSize: 16, color: "#fff" }}>{initialsOf(currentUser?.name ?? "?")}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 17, color: "#fff" }}>{currentUser?.name ?? ""}</Text>
                          <Text style={{ fontSize: 11, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 2 }}>{role === "owner" ? "Patwon" : role === "cashier" ? "Cashier" : role}</Text>
                        </View>
                        <Pressable onPress={() => setShowEnd(false)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="close" size={16} color="#fff" />
                        </Pressable>
                      </View>

                      <Text style={{ fontSize: 12, color: SHIFT.active, fontWeight: "800", letterSpacing: 2.4, textTransform: "uppercase", marginTop: 22 }}>Shift closing</Text>
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 32, color: "#fff", letterSpacing: -0.6, marginTop: 8 }}>Review & Submit Report</Text>
                      <Text style={{ fontSize: 13, color: "#9a9a9e", marginTop: 6 }}>{todayStr}  •  {currentUser?.name ?? ""}</Text>

                      <Text style={{ fontSize: 12, color: "#9a9a9e", fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginTop: 24 }}>Your shift</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                        <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 19, color: "#fff", flex: 1 }}>Itemized breakdown</Text>
                        <Ionicons name="shield-checkmark-outline" size={22} color={SHIFT.active} />
                      </View>

                      {/* Opening float */}
                      <View style={card}>
                        <Text style={cardLabel}>Opening float</Text>
                        <Text style={[bigNum, { color: "#fff" }]}>{fmtG(myOpening)}</Text>
                      </View>

                      {/* Cash Sale */}
                      <View style={[card, { borderColor: "rgba(52,211,153,0.25)" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={[cardLabel, { flex: 1 }]}>Cash Sale</Text>
                          <Ionicons name="trending-up" size={20} color={SHIFT.active} />
                        </View>
                        <Text style={[bigNum, { color: SHIFT.active }]}>{fmtG(myCashTotal)}</Text>
                        <Text style={{ fontSize: 11, color: "#6e6e73", marginTop: 4 }}>{cashCount} cash sale{cashCount === 1 ? "" : "s"} · {myTxnCount} transaction{myTxnCount === 1 ? "" : "s"} total this shift</Text>
                      </View>

                      {/* Cash removed */}
                      <View style={[card, { backgroundColor: "rgba(224,108,91,0.07)", borderColor: "rgba(224,108,91,0.25)" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={[cardLabel, { flex: 1 }]}>Cash removed</Text>
                          <Ionicons name="trending-down" size={20} color="#e06c5b" />
                        </View>
                        <Text style={[bigNum, { color: "#e06c5b" }]}>{fmtG(cashRemoved)}</Text>
                        <Text style={{ fontSize: 11, color: "#6e6e73", marginTop: 4 }}>Withdrawals {fmtG(myCashOutTotal)} · Expenses {fmtG(inventoryTotal)}</Text>
                      </View>

                      {/* Debt collected */}
                      <View style={card}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={[cardLabel, { flex: 1 }]}>Debt collected · cash only</Text>
                          <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: "#60a5fa", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 13, fontWeight: "800", color: "#60a5fa" }}>$</Text>
                          </View>
                        </View>
                        <Text style={[bigNum, { color: SHIFT.active }]}>{fmtG(myCollectedTotal)}</Text>
                      </View>

                      {/* MonCash — business account, not in the register */}
                      <View style={[card, { borderColor: "rgba(96,165,250,0.25)" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={[cardLabel, { flex: 1 }]}>MonCash · business account</Text>
                          <Ionicons name="phone-portrait-outline" size={19} color="#60a5fa" />
                        </View>
                        <Text style={[bigNum, { color: "#60a5fa" }]}>{fmtG(myMoncashTotal)}</Text>
                        <Text style={{ fontSize: 11, color: "#6e6e73", marginTop: 4 }}>Goes to the business account — not counted in the register total.</Text>
                      </View>

                      {/* NatCash — business account, not in the register */}
                      <View style={[card, { borderColor: "rgba(250,204,21,0.25)" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={[cardLabel, { flex: 1 }]}>NatCash · business account</Text>
                          <Ionicons name="cellular-outline" size={19} color="#facc15" />
                        </View>
                        <Text style={[bigNum, { color: "#facc15" }]}>{fmtG(myNatcashTotal)}</Text>
                        <Text style={{ fontSize: 11, color: "#6e6e73", marginTop: 4 }}>Goes to the business account — not counted in the register total.</Text>
                      </View>

                      {/* Standby carryover */}
                      <View style={card}>
                        <Text style={cardLabel}>Standby carryover</Text>
                        <Text style={[bigNum, { color: "#fff" }]}>{fmtG(myStandbyCarry)}</Text>
                      </View>

                      {/* Cash counted */}
                      <View style={[card, { borderColor: hasCounted ? SHIFT.activeBd : "rgba(255,255,255,0.12)" }]}>
                        <Text style={cardLabel}>Cash counted</Text>
                        <Text style={{ fontSize: 11, color: "#6e6e73", marginTop: 4 }}>Count the cash in the drawer and enter it here.</Text>
                        <MoneyInput placeholder="0" value={actualCash} onChangeText={setActualCash} keyboardType="numeric" style={{ borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, minHeight: 60, marginTop: 10, fontWeight: "800", fontSize: 32, textAlign: "center", backgroundColor: "#0B0B0D", fontFamily: "Inter_700Bold", color: "#fff" }} />
                        {hasCounted && diff !== null ? (
                          <Text style={{ fontWeight: "800", fontSize: 13, marginTop: 8, textAlign: "center", color: diff === 0 ? SHIFT.active : diff > 0 ? "#e06c5b" : "#60a5fa" }}>
                            {diff === 0 ? "✓ Balanced — no deficit" : diff > 0 ? `Deficit: ${fmtG(diff)}` : `Over: ${fmtG(Math.abs(diff))}`}
                          </Text>
                        ) : null}
                      </View>

                      {/* Final total */}
                      <View style={[card, { borderColor: "rgba(52,211,153,0.45)" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <View style={{ flex: 1 }}>
                            <Text style={[cardLabel, { color: SHIFT.active }]}>Final total</Text>
                            <Text style={[bigNum, { color: "#fff", fontSize: 44 }]}>{fmtG(expectedCash)}</Text>
                          </View>
                          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(52,211,153,0.15)", alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name="checkmark" size={28} color={SHIFT.active} />
                          </View>
                        </View>
                        <Text style={{ fontSize: 12.5, color: "#9a9a9e", marginTop: 8, lineHeight: 18 }}>Opening float + cash sales + cash debt + carryover − cash removed. MonCash/NatCash go to the business account.</Text>
                      </View>

                      {/* One last check */}
                      <View style={[card, { marginTop: 16 }]}>
                        <Text style={cardLabel}>One last check</Text>
                        <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 24, color: "#fff", letterSpacing: -0.3, marginTop: 8 }}>Everything looks right?</Text>
                        <Text style={{ fontSize: 13, color: "#9a9a9e", marginTop: 8, lineHeight: 19 }}>Please confirm your totals before sending this report to the manager review queue.</Text>
                        <Pressable onPress={() => setCheckCounted(!checkCounted)} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, borderWidth: 0.5, borderColor: checkCounted ? SHIFT.activeBd : "rgba(255,255,255,0.12)", backgroundColor: checkCounted ? "rgba(52,211,153,0.08)" : "transparent", borderRadius: 16, padding: 16 }}>
                          <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: checkCounted ? SHIFT.active : "#6e6e73", backgroundColor: checkCounted ? SHIFT.active : "transparent", alignItems: "center", justifyContent: "center" }}>
                            {checkCounted ? <Ionicons name="checkmark" size={16} color="#06281c" /> : null}
                          </View>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff", flex: 1 }}>I confirm these totals are accurate</Text>
                        </Pressable>
                        {myStandbyAmount > 0 ? (
                          <Pressable onPress={() => setCheckStandby(!checkStandby)} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, borderWidth: 0.5, borderColor: checkStandby ? SHIFT.pendingBd : "rgba(255,255,255,0.12)", backgroundColor: checkStandby ? SHIFT.pendingSoft : "transparent", borderRadius: 16, padding: 16 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: checkStandby ? SHIFT.pending : "#6e6e73", backgroundColor: checkStandby ? SHIFT.pending : "transparent", alignItems: "center", justifyContent: "center" }}>
                              {checkStandby ? <Ionicons name="checkmark" size={16} color="#06222b" /> : null}
                            </View>
                            <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff", flex: 1 }}>Standby money ({fmtG(myStandbyAmount)}) handed to manager</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          onPress={async () => {
                            const amt = parseFloat(actualCash);
                            if (isNaN(amt) || amt < 0) return Alert.alert("Enter cash", "Count the cash in the drawer and enter the amount first.");
                            if (!checkCounted) return Alert.alert("Confirm totals", "Please confirm your totals are accurate before submitting.");
                            const myTabs = await openTabsForMe();
                            if (myTabs.length) return Alert.alert("Tab ouvè — pa ka fèmen", `Ou gen ${myTabs.length} vant an atann. Fèmen oswa anile yo nan Vant anvan ou fèmen chanjman an.`);
                            setShowEnd(false); setActualCash("");
                            await endReport(amt);
                          }}
                          disabled={!canSubmit}
                          style={{ marginTop: 16, minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: canSubmit ? SHIFT.active : "rgba(255,255,255,0.08)", opacity: canSubmit ? 1 : 0.7 }}>
                          <Text style={{ fontWeight: "800", fontSize: 15, fontFamily: "Inter_700Bold", color: canSubmit ? "#06281c" : "#6e6e73" }}>Submit Shift Report</Text>
                        </Pressable>
                        <Text style={{ fontSize: 12, color: "#6e6e73", textAlign: "center", marginTop: 10 }}>This action cannot be undone</Text>
                        <Pressable onPress={() => setShowEnd(false)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, alignSelf: "flex-start" }}>
                          <Ionicons name="arrow-back" size={16} color="#9a9a9e" />
                          <Text style={{ fontSize: 14, fontWeight: "600", color: "#9a9a9e" }}>Back to Shift</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })()}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeScreen>
      </Modal>

      {/* ══ Supervisor: Open Shift full screen (dark keypad, no superior picker) ══ */}
      {isSupervisor && supView === "open" && (
        <OpenShiftScreen
          name={currentUser?.name ?? ""}
          roleLabel={role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Manager"}
          storeName={(currentUser as any)?.store ?? "Front till"}
          dateStr={dateStr}
          status={!hasShiftToday ? "opening" : myShiftToday.status === "pending" ? "pending" : "active"}
          pendingShift={myPendingShift}
          pendingManager={getUserById(myPendingShift?.manager_id)?.name ?? "manadjè a"}
          live={{ sales: fmtG(mySalesTotal), txns: myTxnCount, collected: fmtG(myCollectedTotal), expected: fmtG(headerBalance) }}
          amount={ownShiftAmount}
          onAmount={setOwnShiftAmount}
          valid={ownShiftAmount.trim() !== "" && !isNaN(parseFloat(ownShiftAmount)) && parseFloat(ownShiftAmount) >= 0}
          onStart={submitOpening}
          onViewShift={() => setSupView("own")}
          onCloseShift={() => { setActualCash(""); setCheckCounted(false); setCheckCashOut(false); setCheckStandby(false); setShowEnd(true); }}
          onClose={() => setSupView("team")}
        />
      )}

      {/* ══ Cashier: Open Shift full screen — the first thing she sees, and the
           single place to open. Same position header button reopens it. ══ */}
      {isCashier && cashierOpenView && (
        <OpenShiftScreen
          name={currentUser?.name ?? ""}
          roleLabel="Cashier"
          storeName={(currentUser as any)?.store ?? "Front till"}
          dateStr={dateStr}
          status={!hasShiftToday ? "opening" : myShiftToday.status === "pending" ? "pending" : "active"}
          pendingShift={myPendingShift}
          pendingManager={getUserById(myPendingShift?.manager_id)?.name ?? "manadjè a"}
          live={{ sales: fmtG(mySalesTotal), txns: myTxnCount, collected: fmtG(myCollectedTotal), expected: fmtG(headerBalance) }}
          amount={openAmount}
          onAmount={setOpenAmount}
          valid={openAmount.trim() !== "" && !isNaN(parseFloat(openAmount)) && parseFloat(openAmount) >= 0}
          onStart={submitOpening}
          managers={managerList.map(m => ({ id: m.id, name: m.name, role: m.role }))}
          managerId={openManager || defaultManager()}
          onManager={setOpenManager}
          onViewShift={() => setCashierOpenView(false)}
          onCloseShift={() => { setCashierOpenView(false); setActualCash(""); setCheckCounted(false); setCheckCashOut(false); setCheckStandby(false); setShowEnd(true); }}
          onClose={() => setCashierOpenView(false)}
        />
      )}

      {/* ══ Supervisor: person drill-in — live report for today ══ */}
      {person && <PersonReport person={person} onClose={() => setPerson(null)} onOpenConfirm={() => { const r = person.report; setPerson(null); if (r) confirmReport(r); }} myRank={myRank} disputed={claims.some((c: any) => c.cashier_id === person.user.id)} />}

      {/* Itemized report drill-in (past reports / today's report) */}
      {detail ? <ShiftReportDetail data={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

function PersonReport({ person, onClose, onOpenConfirm, myRank, disputed }: {
  person: PersonReport;
  onClose: () => void;
  onOpenConfirm: () => void;
  myRank: number;
  disputed?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { user, shift, report, sales, items, debts, movements, hands } = person;
  const [expanded, setExpanded] = useState<string | null>(null);
  const status: ShiftStatus = disputed ? "disputed"
    : shift?.status === "open" ? "active"
    : shift?.status === "pending" ? "pending"
    : report?.status === "submitted" ? "review"
    : report?.status === "closed" ? "closed"
    : "not-opened";
  const opening = Number(shift?.opening_balance ?? 0);
  // Her shift window (clock-in → now) — same scoping as her own report, so the
  // manager verifies exactly the figures she submitted.
  const winStart = String((shift as any)?.start_time ?? "");
  const winEnd = String((shift as any)?.end_time ?? new Date().toISOString());
  const inWin = (ts: any) => { const s = String(ts ?? ""); return s !== "" && (!winStart || (s >= winStart && s <= winEnd)); };
  const cashSales = sales.filter(s => s.payment_method === "cash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const moncashSales = sales.filter(s => s.payment_method === "moncash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const natcashSales = sales.filter(s => s.payment_method === "natcash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const debt = debts.filter(d => inWin(d.created_at)).reduce((a, x) => a + Number(x.amount ?? 0), 0);
  const cashOut = movements.filter(m => (m.type === "withdrawal" || m.type === "inventory") && inWin(m.created_at)).reduce((a, x) => a + Number(x.amount ?? 0), 0);
  const carry = Number(report?.standby_cash ?? 0);
  const expected = reconcileShift({ opening, cashSales, debtCollected: debt, cashOut, standbyCarry: carry });
  const actual = report?.actual_cash != null ? Number(report.actual_cash) : (shift?.actual_cash != null ? Number(shift.actual_cash) : null);
  const deficit = actual !== null ? expected - actual : null;
  const canReview = report?.status === "submitted" && (RANK[report.role] ?? 0) < myRank;
  const itemsFor = (saleId: string) => items.filter(it => it.sale_id === saleId);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(10,10,11,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 18, paddingBottom: 18 + insets.bottom, maxHeight: "92%", ...shadow.elevated }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: palette.separator, alignSelf: "center", marginBottom: 12 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={user.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 16, color: palette.ink, letterSpacing: -0.2 }}>{user.name}</Text>
              <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{user.role}{user.store ? ` · ${user.store}` : ""} · jodi a</Text>
            </View>
            <StatusBadge status={status} />
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}>
              <Ionicons name="close" size={15} color={palette.ink} />
            </Pressable>
          </View>

          <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Vant" value={fmtG(sales.filter(s => !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0))} sub={`${sales.filter(s => inWin(s.created_at)).length} tranzaksyon`} color={palette.success} />
              <StatCard label="Kolekte dèt" value={fmtG(debt)} sub="pa vant" color={palette.emerald} />
            </View>

            <View style={{ marginTop: 12, backgroundColor: palette.surface2, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 10.5, color: palette.muted2 }}>Ouvèti (float)</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, ...monoStyle }}>+{fmtG(opening)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ fontSize: 10.5, color: palette.muted2 }}>MonCash (kont biznis)</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: palette.blue, ...monoStyle }}>{fmtG(moncashSales)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ fontSize: 10.5, color: palette.muted2 }}>NatCash (kont biznis)</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: palette.warningDot, ...monoStyle }}>{fmtG(natcashSales)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ fontSize: 10.5, color: palette.muted2 }}>Kach espere</Text>
                <Text style={{ fontSize: 13, fontWeight: "800", color: SHIFT.live, ...monoStyle }}>{fmtG(expected)}</Text>
              </View>
              {actual !== null ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ fontSize: 10.5, color: palette.muted2 }}>Konte</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink, ...monoStyle }}>{fmtG(actual)}</Text>
                </View>
              ) : null}
              {deficit !== null && deficit !== 0 ? (
                <Text style={{ fontSize: 11, fontWeight: "800", color: deficit > 0 ? palette.danger : SHIFT.active, marginTop: 6 }}>
                  {deficit > 0 ? `Defisi ${fmtG(deficit)}` : `Sipè ${fmtG(Math.abs(deficit))}`}
                </Text>
              ) : null}
            </View>

            {canReview ? (
              <Pressable onPress={onOpenConfirm} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: SHIFT.reviewSoft, borderRadius: radius.md, padding: 13, borderWidth: 0.5, borderColor: SHIFT.reviewBd }}>
                <Ionicons name="shield-checkmark-outline" size={16} color={SHIFT.review} />
                <Text style={{ fontSize: 13, fontWeight: "800", color: SHIFT.review }}>Konfime rapò sa a</Text>
              </Pressable>
            ) : null}

            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 16, marginBottom: 8 }}>Tranzaksyon yo — jodi a</Text>
            {sales.length === 0 ? (
              <Text style={{ color: palette.muted3, fontSize: 12.5 }}>Pa gen tranzaksyon jodi a.</Text>
            ) : sales.slice(0, 30).map((s: any) => {
              const open = expanded === s.id;
              const saleItems = itemsFor(s.id);
              return (
                <View key={s.id} style={{ marginBottom: 8, borderRadius: radius.md, borderWidth: 0.5, borderColor: open ? SHIFT.liveBd : palette.hairline, backgroundColor: palette.surface, overflow: "hidden" }}>
                  <Pressable onPress={() => setExpanded(open ? null : s.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: palette.ink }}>{s.sale_number}</Text>
                      <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 1 }}>{s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""} · {s.payment_method}{Number(s.standby ?? 0) ? " · standby" : ""}</Text>
                    </View>
                    <Text style={{ fontSize: 12.5, fontWeight: "800", color: s.payment_method === "cash" ? palette.success : palette.accentGold, ...monoStyle }}>{fmtG(Number(s.total ?? 0))}</Text>
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={15} color={palette.muted3} />
                  </Pressable>
                  {open ? (
                    <View style={{ paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 0.5, borderTopColor: palette.separatorSoft }}>
                      {saleItems.length === 0 ? (
                        <Text style={{ fontSize: 11, color: palette.muted3 }}>Pa gen atik.</Text>
                      ) : saleItems.map((it: any) => (
                        <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 }}>
                          <Text style={{ fontSize: 11, color: palette.muted3, ...monoStyle, width: 36 }}>{Number(it.quantity ?? 0)} ×</Text>
                          <Text numberOfLines={2} style={{ flex: 1, fontSize: 11, color: palette.ink }}>{saleLineLabel(it)}</Text>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: palette.ink, ...monoStyle }}>{fmtG(Number(it.line_total ?? 0))}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {sales.length > 30 ? <Text style={{ fontSize: 10.5, color: palette.muted3 }}>+{sales.length - 30} lòt…</Text> : null}
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Review queue rows (supervisor main screen, dark) ───────────────────────
// Pending Approvals: tappable rows that expand inline into the itemized
// breakdown + Confirm / Dispute actions. Same live data as the drill-in.
function QueueBadge({ kind }: { kind: "pending" | "deficit" | "severe" }) {
  if (kind === "severe") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: "#e06c5b", backgroundColor: "rgba(224,108,91,0.12)" }}>
        <Ionicons name="warning-outline" size={12} color="#e06c5b" />
        <Text style={{ fontSize: 10, fontWeight: "800", color: "#e06c5b", letterSpacing: 0.4 }}>SEVERE DEFICIT</Text>
      </View>
    );
  }
  if (kind === "deficit") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: SHIFT.pendingBd, backgroundColor: SHIFT.pendingSoft }}>
        <Ionicons name="warning-outline" size={12} color={SHIFT.pending} />
        <Text style={{ fontSize: 10, fontWeight: "800", color: SHIFT.pending, letterSpacing: 0.4 }}>DEFICIT</Text>
      </View>
    );
  }
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: SHIFT.pendingBd }}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: SHIFT.pending, letterSpacing: 0.4 }}>PENDING</Text>
    </View>
  );
}

function QueueReportRow({ report, severe, expanded, onToggle, loadPerson, onConfirm, onDispute, onInspect }: {
  report: any;
  severe: boolean;
  expanded: boolean;
  onToggle: () => void;
  loadPerson: (m: TeamMember) => Promise<PersonReport | null>;
  onConfirm: () => void;
  onDispute: () => void;
  onInspect: () => void;
}) {
  const name = getUserById(report.user_id)?.name ?? report.user_id;
  const deficitAmt = Number(report.deficit ?? 0);
  const member: TeamMember = { id: report.user_id, name, role: report.role };
  return (
    <View style={{ backgroundColor: "#151518", borderRadius: 18, marginBottom: 10, borderWidth: 0.5, borderColor: expanded ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <Pressable onPress={onToggle} onLongPress={onInspect} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{initialsOf(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{name}</Text>
          <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Submitted {ago(report.submitted_at ?? report.created_at)}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(Number(report.expected_cash ?? 0))}</Text>
          <QueueBadge kind={deficitAmt > 0 ? (severe ? "severe" : "deficit") : "pending"} />
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-forward"} size={16} color="#6e6e73" />
      </Pressable>
      {expanded ? <ReportExpand member={member} report={report} loadPerson={loadPerson} onConfirm={onConfirm} onDispute={onDispute} /> : null}
    </View>
  );
}

function ReportExpand({ member, report, loadPerson, onConfirm, onDispute }: {
  member: TeamMember;
  report: any;
  loadPerson: (m: TeamMember) => Promise<PersonReport | null>;
  onConfirm: () => void;
  onDispute: () => void;
}) {
  const [data, setData] = useState<PersonReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPerson(member).then(d => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [member.id]);
  const shift = data?.shift ?? null;
  const sales = data?.sales ?? [];
  const debts = data?.debts ?? [];
  const movements = data?.movements ?? [];
  const opening = Number(shift?.opening_balance ?? report.opening_balance ?? 0);
  // Her shift window (clock-in → now) — matches the figures she submitted.
  const winStart = String((shift as any)?.start_time ?? "");
  const winEnd = String((shift as any)?.end_time ?? new Date().toISOString());
  const inWin = (ts: any) => { const s = String(ts ?? ""); return s !== "" && (!winStart || (s >= winStart && s <= winEnd)); };
  const cashSales = sales.filter(s => s.payment_method === "cash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const moncashSales = sales.filter(s => s.payment_method === "moncash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const natcashSales = sales.filter(s => s.payment_method === "natcash" && !Number(s.standby ?? 0) && inWin(s.created_at)).reduce((a, x) => a + Number(x.total ?? 0), 0);
  const debt = debts.filter(d => inWin(d.created_at)).reduce((a, x) => a + Number(x.amount ?? 0), 0);
  const cashOut = movements.filter(m => (m.type === "withdrawal" || m.type === "inventory") && inWin(m.created_at)).reduce((a, x) => a + Number(x.amount ?? 0), 0);
  const carry = Number(report.standby_carry ?? report.standby_cash ?? 0);
  const expected = reconcileShift({ opening, cashSales, debtCollected: debt, cashOut, standbyCarry: carry });
  const gridLabel = { fontSize: 10, color: "#8e8e93", fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 1 };
  const gridValue = { fontWeight: "800" as const, fontSize: 21, marginTop: 8, ...monoStyle };
  const cell = { flex: 1, backgroundColor: "#1E1E22", borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.06)" };
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{member.name}</Text>
      <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>Daily report · {new Date(`${report.report_date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</Text>
      {!data ? (
        <Text style={{ color: "#6e6e73", fontSize: 12, marginTop: 12 }}>Ap chaje breakdown…</Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={cell}>
              <Text style={gridLabel}>Opening float</Text>
              <Text style={[gridValue, { color: "#fff" }]}>{fmtG(opening)}</Text>
            </View>
            <View style={cell}>
              <Text style={gridLabel}>Cash Sale</Text>
              <Text style={[gridValue, { color: "#4ade80" }]}>{fmtG(cashSales)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={cell}>
              <Text style={gridLabel}>MonCash · biznis</Text>
              <Text style={[gridValue, { color: "#60a5fa" }]}>{fmtG(moncashSales)}</Text>
            </View>
            <View style={cell}>
              <Text style={gridLabel}>NatCash · biznis</Text>
              <Text style={[gridValue, { color: "#facc15" }]}>{fmtG(natcashSales)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={cell}>
              <Text style={gridLabel}>Cash removed</Text>
              <Text style={[gridValue, { color: "#e06c5b" }]}>{fmtG(cashOut)}</Text>
            </View>
            <View style={cell}>
              <Text style={gridLabel}>Debt collected</Text>
              <Text style={[gridValue, { color: "#60a5fa" }]}>{fmtG(debt)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(74,222,128,0.08)", borderRadius: 16, padding: 14, marginTop: 8, borderWidth: 0.5, borderColor: "rgba(74,222,128,0.25)" }}>
            <Ionicons name="wallet-outline" size={18} color="#4ade80" />
            <Text style={[gridLabel, { flex: 1, marginLeft: 8 }]}>Final total</Text>
            <Text style={{ fontWeight: "800", fontSize: 24, color: "#4ade80", ...monoStyle }}>{fmtG(expected)}</Text>
          </View>
        </>
      )}
      <Pressable
        disabled={confirming}
        onPress={() => { setConfirming(true); try { onConfirm(); } finally { setTimeout(() => setConfirming(false), 1500); } }}
        style={{ marginTop: 12, backgroundColor: "#4ade80", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: confirming ? 0.6 : 1 }}>
        <Ionicons name="checkmark" size={17} color="#06281c" />
        <Text style={{ color: "#06281c", fontWeight: "800", fontSize: 14 }}>{confirming ? "Ap konfime…" : "Confirm Report"}</Text>
      </Pressable>
      <Pressable onPress={onDispute} style={{ marginTop: 8, borderWidth: 1, borderColor: "rgba(224,108,91,0.5)", borderRadius: 14, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
        <Ionicons name="chatbox-outline" size={16} color="#e06c5b" />
        <Text style={{ color: "#e06c5b", fontWeight: "700", fontSize: 14 }}>Dispute</Text>
      </Pressable>
    </View>
  );
}

function QueueOpeningRow({ opening, mine, expanded, onToggle, onResolve }: {
  opening: any;
  mine: boolean;
  expanded: boolean;
  onToggle: () => void;
  onResolve: (shiftId: string, action: "approve" | "set" | "reject", amount?: string) => void;
}) {
  const name = getUserById(opening.cashier_id)?.name ?? opening.cashier_id;
  const [fixAmount, setFixAmount] = useState("");
  const [fixing, setFixing] = useState(false);
  return (
    <View style={{ backgroundColor: "#151518", borderRadius: 18, marginBottom: 10, borderWidth: 0.5, borderColor: expanded ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <Pressable onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{initialsOf(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{name}</Text>
          <Text style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 2 }}>
            {mine ? `Opened ${ago(opening.start_time)} — needs your confirm` : `Opened ${ago(opening.start_time)} · ${getUserById(opening.manager_id)?.name ?? ""}`}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", ...monoStyle }}>{fmtG(Number(opening.opening_stated ?? 0))}</Text>
          <QueueBadge kind="pending" />
        </View>
        <Ionicons name={mine && expanded ? "chevron-up" : "chevron-forward"} size={16} color="#6e6e73" />
      </Pressable>
      {mine && expanded ? (
        fixing ? (
          <View style={{ padding: 12, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.08)" }}>
            <MoneyInput placeholder="Montan kòrèk" value={fixAmount} onChangeText={setFixAmount} keyboardType="numeric" autoFocus style={{ borderWidth: 0.5, borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 11, minHeight: 46, fontWeight: "700", fontSize: 17, textAlign: "center", backgroundColor: "#0B0B0D", fontFamily: "Inter_700Bold", color: "#fff" }} />
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
              <Pressable onPress={() => { onResolve(opening.id, "set", fixAmount); setFixing(false); setFixAmount(""); }} style={{ flex: 1, backgroundColor: "#22d3ee", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
                <Text style={{ color: "#06222b", fontWeight: "800", fontSize: 12 }}>Korije & konfime</Text>
              </Pressable>
              <Pressable onPress={() => { setFixing(false); setFixAmount(""); }} style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Anile</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 6, padding: 12, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.08)" }}>
            <Pressable onPress={() => onResolve(opening.id, "approve")} style={{ flex: 1, backgroundColor: "#4ade80", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ color: "#06281c", fontWeight: "800", fontSize: 12 }}>Apwouve</Text>
            </Pressable>
            <Pressable onPress={() => { setFixing(true); setFixAmount(String(opening.opening_stated ?? "")); }} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: "#fff" }}>Korije</Text>
            </Pressable>
            <Pressable onPress={() => onResolve(opening.id, "reject")} style={{ backgroundColor: "rgba(224,108,91,0.12)", borderWidth: 0.5, borderColor: "rgba(224,108,91,0.4)", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
              <Text style={{ color: "#e06c5b", fontWeight: "800", fontSize: 12 }}>Rejete</Text>
            </Pressable>
          </View>
        )
      ) : null}
    </View>
  );
}

// ── Open Shift modal (full screen, dark keypad) ──
// The single place to open a shift: identity header row with close, opening-
// float keypad docked at the bottom, contextual body per shift state. Cashiers
// additionally get the superior picker (who hands over the cash); supervisors
// self-confirm and omit it.
export type OpenShiftTab = "opening" | "pending" | "active";

function OpenShiftScreen({ name, roleLabel, storeName, dateStr, status, pendingShift, pendingManager, live, amount, onAmount, valid, onStart, onViewShift, onCloseShift, onClose, managers, managerId, onManager }: {
  name: string;
  roleLabel: string;
  storeName: string;
  dateStr: string;
  status: OpenShiftTab;
  pendingShift: any | null;
  pendingManager: string;
  live: { sales: string; txns: number; collected: string; expected: string };
  amount: string;
  onAmount: (v: string) => void;
  valid: boolean;
  onStart: () => void;
  onViewShift: () => void;
  onCloseShift: () => void;
  onClose: () => void;
  // Cashier only: who hands over the cash. Supervisors self-confirm — omit.
  managers?: { id: string; name: string; role?: string }[];
  managerId?: string;
  onManager?: (id: string) => void;
}) {
  const tenderOpen = status === "opening";
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 }}>
        <View style={{ alignSelf: "flex-start" }}>
          <Pressable onPress={onClose} hitSlop={8} style={{ width: 45, height: 45, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={40} color="#fff" />
          </Pressable>
        </View>
            {tenderOpen ? (
              <>
                <View style={{ backgroundColor: "#151518", borderRadius: 22, padding: 18, marginTop: 12, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 17, color: "#fff" }}>Start your shift</Text>
                      <Text style={{ fontSize: 12.5, color: "#9a9a9e", marginTop: 4, lineHeight: 18 }}>Count the till and record the opening float.</Text>
                    </View>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(52,211,153,0.15)", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="wallet-outline" size={20} color={SHIFT.active} />
                    </View>
                  </View>
                  <TenderDisplay amount={amount} label="OPENING FLOAT" />
                  {managers && managers.length > 0 && onManager ? (
                    <>
                      <Text style={{ fontSize: 10, color: "#9a9a9e", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 14 }}>Ki remèt kach la?</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {managers.map(m => {
                            const on = (managerId ?? "") === m.id;
                            return (
                              <Pressable key={m.id} onPress={() => onManager?.(m.id)} style={{ paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999, backgroundColor: on ? SHIFT.live : "#1E1E22", borderWidth: 1.5, borderColor: on ? SHIFT.live : "rgba(255,255,255,0.10)" }}>
                                <Text style={{ fontSize: 12.5, fontWeight: "700", color: on ? "#06222b" : "#fff" }}>{m.name}</Text>
                                {m.role ? <Text style={{ fontSize: 9.5, color: on ? "#06222b" : "#9a9a9e", marginTop: 1 }}>{m.role}</Text> : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </>
                  ) : null}
                </View>
                <Pressable onPress={onStart} disabled={!valid} style={{ marginTop: 12, height: 56, borderRadius: 12, backgroundColor: valid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: valid ? 1 : 0.6 }}>
                  <Text style={{ color: valid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 16 }}>Start shift</Text>
                </Pressable>
              </>
            ) : null}

            {status === "pending" && (
              <View style={{ backgroundColor: "#151518", borderRadius: 22, padding: 18, marginTop: 12, borderWidth: 0.5, borderColor: SHIFT.pendingBd }}>
                {pendingShift ? (
                  <>
                    <Text style={{ fontSize: 11, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.6 }}>OPENING STATED</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 32, color: "#fff", marginTop: 6, ...monoStyle }}>{fmtG(Number(pendingShift.opening_stated ?? 0))}</Text>
                    <Text style={{ fontSize: 12.5, color: SHIFT.pending, marginTop: 6 }}>Waiting on {pendingManager} — informational only, selling stays unlocked.</Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 13, color: "#9a9a9e", textAlign: "center" }}>No pending opening.</Text>
                )}
              </View>
            )}

            {status === "active" && (
              <View style={{ backgroundColor: "#151518", borderRadius: 22, padding: 18, marginTop: 12, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)" }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.2 }}>SALES</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 20, color: SHIFT.active, marginTop: 4, ...monoStyle }}>{live.sales}</Text>
                    <Text style={{ fontSize: 10, color: "#6e6e73", marginTop: 2 }}>{live.txns} txns</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: "#9a9a9e", fontWeight: "700", letterSpacing: 1.2 }}>EXPECTED</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 20, color: "#fff", marginTop: 4, ...monoStyle }}>{live.expected}</Text>
                    <Text style={{ fontSize: 10, color: "#6e6e73", marginTop: 2 }}>Debt {live.collected}</Text>
                  </View>
                </View>
              </View>
            )}

            {status === "pending" ? (
              <View style={{ marginTop: 14, minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" }}>
                <Text style={{ fontWeight: "800", fontSize: 14, color: "#6e6e73" }}>Waiting confirmation…</Text>
              </View>
            ) : status === "active" ? (
              <Pressable onPress={onCloseShift} style={{ marginTop: 14, minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#3A1719", borderWidth: 1, borderColor: "rgba(224,108,91,0.4)" }}>
                <Text style={{ fontWeight: "800", fontSize: 15, fontFamily: "Inter_700Bold", color: "#e06c5b" }}>Close shift</Text>
              </Pressable>
            ) : null}
            <View style={{ height: 8 }} />
      </ScrollView>
      {tenderOpen ? (
        <View style={{ borderTopWidth: 0.5, borderTopColor: "#262626", backgroundColor: "#000" }}>
          <TenderKeypad value={amount} onChange={onAmount} />
        </View>
      ) : null}
    </View>
  );
}
