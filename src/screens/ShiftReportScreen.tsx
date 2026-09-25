import React, { useCallback, useEffect, useRef, useState } from "react";
import { palette, radius, shadow } from "../theme";
import { Ionicons } from "@expo/vector-icons";
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import { getDb } from "../db";
import { ht } from "../i18n";
import { USERS, getUserById } from "../users";
import { notifyLocal } from "../notifications";
import { fmtG, fmt, monoStyle } from "../format";
import { useResponsive, centerBox, sheetBox } from "../responsive";
import { salesEvents } from "../salesEvents";

type Sale = { id: string; sale_number: string; total: number; payment_method: string; status: string; created_at: string; amount_paid: number; seller_role?: string; seller_id?: string; store_id?: string };
type Shift = { id: string; opening_balance: number; status: string; start_time: string; cashier_confirmed: number; manager_confirmed: number; supervisor_confirmed: number; actual_cash?: number; cashier_id?: string };

const RANK: Record<string, number> = { cashier: 0, stock: 0, manager: 1, admin: 2, owner: 3 };
const ROLE_ICON: Record<string, string> = { cashier: "👤", manager: "👔", admin: "🛡️", owner: "👑" };
// Decision vocabulary for the report_reviews audit trail (mirrors web-app).
const DECISION_INFO: Record<string, { label: string; icon: any; color: string }> = {
  debt: { label: "Dèt ouvè", icon: "briefcase-outline", color: palette.warningDot },
  waived_negligible: { label: "Pèt neglij", icon: "warning-outline", color: palette.accentGold },
  approved: { label: "Apwouve", icon: "checkmark-circle-outline", color: palette.success },
  revoke_to_debt: { label: "Revoke → Dèt", icon: "refresh-outline", color: palette.danger },
  approve_waive: { label: "Pèt konfime", icon: "shield-checkmark-outline", color: palette.success },
};
const DECISION_MSG: Record<string, string> = {
  debt: "defisi RETRE SOU DÈT kesye a",
  waived_negligible: "defisi ABANDONE kòm pèt (neglij) — ap tann apwobasyon pi wo",
  approved: "apwouve (balanse)",
  revoke_to_debt: "PÈT REVOKE → tounen DÈT ouvè",
  approve_waive: "pèt konfime",
};
const initialsOf = (n: string) => n.split(" ").filter(Boolean).map((w: string) => w[0]?.toUpperCase()).slice(0, 2).join("") || "?";
const td = (iso: string | null | undefined): string => {
  const d = new Date(iso ?? "");
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

export default function ShiftReportScreen({ storeId, role = "seller", currentUser }: { storeId: string; role?: string; currentUser?: any }) {
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
  const [reviewReports, setReviewReports] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [showEnd, setShowEnd] = useState(false);
  const [actualCash, setActualCash] = useState("");
  const [pendingValidateId, setPendingValidateId] = useState<string | null>(null);
  const [managerPassword, setManagerPassword] = useState("");
  const [salaryDeductions, setSalaryDeductions] = useState<any[]>([]);
  const [monthlyLosses, setMonthlyLosses] = useState<any[]>([]);
  // Supervisor review studio — append-only report_reviews audit trail
  const [reviews, setReviews] = useState<any[]>([]);
  const [revTab, setRevTab] = useState<"pending" | "waived" | "debt" | "journal">("pending");
  const [waiveFor, setWaiveFor] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const loadInFlight = useRef(false);

  const myRank = RANK[role] ?? 0;
  const isCashier = myRank === 0;
  const isSupervisor = myRank >= 1;

  const today = new Date().toISOString().slice(0, 10);
  // Primitive id for stable load() identity — depending on the whole currentUser
  // object re-creates load() every render (new object identity), which re-runs the
  // effects below endlessly and the screen never settles ("can't refreshing").
  const currentUserId = currentUser?.id ?? null;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    // Background refreshes (interval / sales events / pull-to-refresh) must not
    // flip the full-screen `loading` spinner — the report stays visible and only
    // the refresh indicator spins. Overlaps are skipped.
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const db = await getDb();
      const allSales = (await db.getAllAsync("SELECT * FROM sales")) as Sale[];
      const allItems = (await db.getAllAsync("SELECT * FROM sale_items")) as any[];
      const shifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      const cms = (await db.getAllAsync("SELECT * FROM cash_movements")) as any[];
      // Credit cash collected is recorded in credit_payments (payment_method "cash") —
// debt_collections is never written by any screen, so read the real table here.
      const dcs = ((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]).filter((p: any) => (p.payment_method ?? "cash") === "cash");
      const cds = (await db.getAllAsync("SELECT * FROM cashier_deficits")) as any[];
      setReviews((((await db.getAllAsync("SELECT * FROM report_reviews")) as any[]) ?? [])
        .filter((rv: any) => (rv.store_id ?? storeId) === storeId)
        .sort((a: any, b: any) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))));
      const allReports = (await db.getAllAsync("SELECT * FROM daily_reports")) as any[];
      const allSets = (await db.getAllAsync("SELECT * FROM deficit_settlements")) as any[];
      const salaries = (await db.getAllAsync("SELECT * FROM salary_deductions")) as any[];
      const losses = (await db.getAllAsync("SELECT * FROM monthly_losses")) as any[];

      // Store-scoped, today's data
      const storeSales = allSales.filter(s => (s.store_id ?? storeId) === storeId && (!s.created_at || s.created_at.slice(0, 10) === today));
      const storeShifts = shifts.filter((s: any) => (s.store_id ?? storeId) === storeId);
      const storeCMs = cms.filter((c: any) => (c.store_id ?? storeId) === storeId);
      const storeDCs = dcs.filter((d: any) => (d.store_id ?? storeId) === storeId);
      const storeCDs = cds.filter((c: any) => (c.store_id ?? storeId) === storeId);
      const storeReports = allReports.filter((r: any) => (r.store_id ?? storeId) === storeId && r.report_date === today);
      setReviewReports(allReports
        .filter((r: any) => (r.store_id ?? storeId) === storeId && r.status === "closed" && (RANK[r.role] ?? 0) === 0)
        .sort((a: any, b: any) => String(b.report_date ?? "").localeCompare(String(a.report_date ?? ""))));

      // The active open shift for this cashier (if any); otherwise nearest open
      const myOpen = storeShifts.find((s: any) => s.status === "open" && (!s.cashier_id || s.cashier_id === currentUserId));
      // This cashier's approved shift for today (open preferred, else latest) — its opening anchors the till.
      // Fallbacks (active open shift even if unattributed / started another UTC day) so the opening never silently drops to 0.
      const myOpenStrict = storeShifts.find((s: any) => s.status === "open" && (s.cashier_id ?? null) === (currentUserId ?? null));
      const mineToday = storeShifts
        .filter((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null) && String(s.start_time ?? "").slice(0, 10) === today)
        .sort((a: any, b: any) => (((b.status === "open") ? 1 : 0) - ((a.status === "open") ? 1 : 0)) || String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")));
      // Cross-store fallback: shifts written with a different store_id (e.g. legacy
      // StoreScreen writes using "st-petyonvil" while this report reads "demo-store-id").
      // Without this, myOpening silently drops to 0 on mobile while web shows the amount.
      const mineTodayAny = shifts
        .filter((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null) && String(s.start_time ?? "").slice(0, 10) === today)
        .sort((a: any, b: any) => (((b.status === "open") ? 1 : 0) - ((a.status === "open") ? 1 : 0)) || String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")));
      const myOpenAny = shifts.find((s: any) => s.status === "open" && (s.cashier_id ?? null) === (currentUserId ?? null));
      const resolvedShift = mineToday[0] ?? myOpenStrict ?? myOpen ?? mineTodayAny[0] ?? myOpenAny ?? storeShifts.find((s: any) => s.status === "open") ?? shifts.find((s: any) => s.status === "open") ?? null;
      setShift(myOpen || storeShifts.find((s: any) => s.status === "open") || myOpenAny || shifts.find((s: any) => s.status === "open") || null);
      setMyShiftToday(resolvedShift);
      // Include cash movements linked to the resolved shift even if they were stored
      // under a different store_id, so withdrawals are not silently dropped either.
      const cmsForTill = resolvedShift
        ? storeCMs.concat(cms.filter((c: any) => (c as any).shift_id === (resolvedShift as any).id && !(storeCMs as any[]).includes(c)))
        : storeCMs;
      setWithdrawals(cmsForTill.filter((c: any) => c.type === "withdrawal"));
      setInventoryPickups(cmsForTill.filter((c: any) => c.type === "inventory"));
      setDebtCollections(storeDCs);
      setCashierDebts(storeCDs);
      setReports(storeReports);
      setSettlements(allSets.filter((s:any)=>(s.store_id??storeId)===storeId).sort((a:any,b:any)=>String(b.period_end).localeCompare(String(a.period_end))));
      setSalaryDeductions(salaries.filter((s: any) => (s.store_id ?? storeId) === storeId));
      setMonthlyLosses(losses.filter((l: any) => (l.store_id ?? storeId) === storeId));

      if (storeSales.length === 0 && !resolvedShift && !currentUserId) {
        setSales([]);
      } else {
        setSales(storeSales);
        setItems(allItems);
      }
    } catch (e) {
      console.log("[ShiftReport load] failed:", e);
    } finally { setLoading(false); setRefreshing(false); loadInFlight.current = false; }
  }, [currentUserId, storeId, role, today]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // salesEvents.subscribe is synchronous — subscribe directly so cleanup
    // always unsubscribes the real listener (the old async IIFE could leak it).
    // load() identity is stable now (primitive deps), so the interval survives.
    const unsub = salesEvents.subscribe(() => { load({ silent: true }); });
    const id = setInterval(() => { load({ silent: true }); }, 4000);
    return () => { try { unsub(); } catch {} clearInterval(id); };
  }, [load]);

  // ---------- Roll-up totals (true roll-up, no double count) ----------
  // A sale is attributed to a role via seller_role. A report of role r includes
  // all sales whose seller_role is at-or-below r (team roll-up) so the owner sees
  // the full store total exactly once.
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

  // Collections: rolled up by the user who collected (no seller_role column — approximate via created_by taker)
  const collectedTotal = debtCollections.filter((x: any) => String(x.created_at ?? "").slice(0, 10) === today).reduce((s: number, x: any) => s + Number(x.amount), 0) || 0;

  const inventoryTotal = inventoryPickups.filter((w: any) => w.validated_by).reduce((s, x) => s + Number(x.amount), 0);
  // Till math is person-scoped: this cashier's approved shift opening today
  // + their cash sales today + their cash credit-collections today − withdrawals from their register today.
  const meId = currentUser?.id ?? null;
  const myOpening = Number((myShiftToday as any)?.opening_balance ?? 0);
  const myCashTotal = rollupSales.filter(s => s.payment_method === "cash" && ((s as any).seller_id ?? null) === meId).reduce((s, x) => s + Number(x.total), 0);
  const myCollectedTotal = debtCollections.filter((x: any) => String(x.created_at ?? "").slice(0, 10) === today && (x.collected_by ?? null) === meId).reduce((s: number, x: any) => s + Number(x.amount), 0) || 0;
  const myWithdrawalsTotal = withdrawals
    .filter((w: any) => w.validated_by && String(w.created_at ?? "").slice(0, 10) === today && ((w.taken_by ?? null) === meId || (myShiftToday && (w as any).shift_id && (w as any).shift_id === (myShiftToday as any).id && !(w as any).taken_by)))
    .reduce((s, x) => s + Number(x.amount), 0) || 0;
  // Expected cash for the current cashier's till (when a shift is open)
  const expectedCash = myOpening + myCashTotal + myCollectedTotal - myWithdrawalsTotal;
  // After a cashier closes, `shift` (open-only) becomes null, but the till's
  // closing count must still be shown. Fall back to the closed shift today and
  // to the persisted daily report so the deficit stays visible.
  const reportRowForDeficit = reports.find((r: any) => r.user_id === currentUserId && r.report_date === today);
  const actualFromShift = (shift as any)?.actual_cash ?? (myShiftToday as any)?.actual_cash ?? null;
  const actual = (actualFromShift ?? reportRowForDeficit?.actual_cash ?? null) as number | null;
  const deficit = actual !== null ? expectedCash - actual : null;

  // ---------- Sequential end report ----------
  const submittedReports = reports.filter((r: any) => r.status === "closed");
  const pendingReport = reports.find((r: any) => r.user_id === currentUser?.id && r.status === "pending");
  const myReportClosed = submittedReports.some((r: any) => r.user_id === currentUser?.id);

  async function ensureReport() {
    try {
    const db = await getDb();
    if (reports.some((r: any) => r.user_id === currentUser?.id)) return;
    await db.runAsync(
      "INSERT INTO daily_reports (id, store_id, report_date, role, user_id, status, cash_sales, moncash_sales, natcash_sales, credit_sales, credit_collected_cash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [`rep-${currentUser.id}-${today}`, storeId, today, role, currentUser.id, "pending", cashTotal, moncashTotal, natcashTotal, creditTotal, collectedTotal, new Date().toISOString()]
    );
    } catch (e) {
      console.log("[ensureReport] failed:", e);
      throw e;
    }
  }

  /** Shift block: a user cannot close while THEIR open tabs (Vant an Atann) exist. */
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
    // Dynamic deficit: uses the amount the cashier actually counted at close time
    // (passed as `counted`), falling back to the persisted `actual` if already closed.
    // Previous mobile code used stale `actual ?? expectedCash` → deficit was always 0.
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
    // Persist shift closure atomically with the report when a counted amount is supplied
    if (isCashier && shift && counted != null) {
      try {
        await db.runAsync("UPDATE shifts SET actual_cash = ?, status = ? WHERE id = ?", [counted, "closed", shift.id]);
        setShift((prev: any) => prev ? { ...prev, actual_cash: counted, status: "closed" } : prev);
        setMyShiftToday((prev: any) => prev && prev.id === (shift as any).id ? { ...prev, actual_cash: counted, status: "closed" } : prev);
      } catch {}
    }
    await ensureReport();
    await db.runAsync("UPDATE daily_reports SET status = ?, expected_cash = ?, actual_cash = ?, deficit = ?, submitted_at = ?, closed_at = ? WHERE user_id = ? AND report_date = ? AND store_id = ?",
      ["closed", expectedCash, finalActual, deficitAmt, new Date().toISOString(), new Date().toISOString(), currentUser.id, today, storeId]);

    // Shift end wipes any unfinished cart draft for this cashier.
    try {
      const { clearCartDraft } = await import("../sales/cartDraft");
      await clearCartDraft(db, storeId, currentUser.id);
    } catch {}

    // Accumulate the cashier's deficit on a persistent running balance
    if (isCashier && deficitAmt > 0) {
      const existing = await db.getAllAsync("SELECT * FROM cashier_deficits WHERE status = ?", ["open"]);
      const todayRow = existing.find((d: any) => d.cashier_id === currentUser.id && d.date === today && d.store_id === storeId);
      if (todayRow) {
        await db.runAsync("UPDATE cashier_deficits SET deficit = ?, updated_at = ? WHERE id = ?", [Number(todayRow.deficit) + deficitAmt, new Date().toISOString(), todayRow.id]);
      } else {
        await db.runAsync("INSERT INTO cashier_deficits (id, store_id, cashier_id, date, deficit, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`def-${currentUser.id}-${today}`, storeId, currentUser.id, today, deficitAmt, "open", new Date().toISOString()]);
      }
    }

    // Notify supervisors of the same store + every owner (owner sees all stores)
    // Cross-store fallback when demo data uses "demo-store-id" for every report.
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
        const supName = getUserById(uid)?.name ?? uid;
        const supRole = (getUserById(uid)?.role ?? "").toUpperCase();
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${uid}-${Math.random().toString(36).slice(2, 5)}`, uid, "report_closed", `rep-${currentUser.id}-${today}`,
            `${currentUser.name} (${role.toUpperCase()}) fèmen rapò jounen li. Atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)} — Defisi: ${fmtG(deficitAmt)}${deficitAmt>0?` (dèt anrejistre pou ${currentUser.name})`:""}`, "pending", new Date().toISOString()]);
      }
    }
    const supLabel = cashierStore ? `Manadjè/Admin (${cashierStore}) + Owner` : "Manadjè/Admin/Owner";
    Alert.alert("Rapò Fèmen", isSupervisor
      ? `Rapò ${role.toUpperCase()} fèmen. Notifikasyon voye bay ${supLabel}.`
      : `Rapò kesye fèmen. Atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)} — Defisi ${fmtG(deficitAmt)} anrejistre. Notifikasyon voye bay ${supLabel}.`);
    notifyLocal(deficitAmt > 0 ? `Rapò fèmen — Defisi ${fmtG(deficitAmt)}` : "Rapò fèmen", `${currentUser.name} fèmen rapò jounen li (atann ${fmtG(expectedCash)}, konte ${fmtG(finalActual ?? 0)}, defisi ${fmtG(deficitAmt)})`);
    try { const { salesEvents } = await import("../salesEvents"); salesEvents.emit(); } catch {}
    load({ silent: true });
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Fèmen rapò echwe");
    }
  }

  function pickUserForRole(sid: string, r: string): string | null {
    const appUsers = USERS.filter(u => u.role === r);
    const sameStore = appUsers.find(u => u.store === sid);
    return sameStore?.id ?? appUsers[0]?.id ?? null;
  }

  // ---------- Closed-report review (manager/admin/owner) ----------
  // Same-store visibility: a manager/admin only sees deficits from their store; owner sees all.
  const visibleReport = (r: any) => {
    if ((currentUser as any)?.role === "owner") return true;
    const cashier = getUserById(r.user_id);
    if (!cashier?.store) return true;
    return cashier.store === (currentUser as any)?.store;
  };
  // Immutable audit trail → the current decision for a report is the last appended row.
  const latestByReport = new Map<string, any>();
  for (const rv of [...reviews].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))) latestByReport.set(rv.report_id, rv);
  const canOverride = (rv: any) => myRank > Number(rv.decided_by_rank ?? 0);
  const reviewStage = (r: any): "todo" | "waived" | "done" => {
    if (!visibleReport(r)) return "done";
    // Legacy reports decided before the audit trail existed stay locked as "done".
    if (r.reviewed_by && !latestByReport.has(r.id)) return "done";
    const latest = latestByReport.get(r.id);
    if (!latest) return "todo";
    if (latest.decision === "waived_negligible") return canOverride(latest) ? "waived" : "done";
    return "done";
  };
  const pendingReports = reviewReports.filter((r: any) => reviewStage(r) === "todo");
  const waivedReports = reviewReports.filter((r: any) => reviewStage(r) === "waived");
  const openDeficitOf = (r: any) => cashierDebts.find((d: any) => d.status === "open" && d.cashier_id === r.user_id && d.date === r.report_date);
  const totalDebtOf = (cashierId: string) => cashierDebts.filter((d: any) => (d.status === "open" || d.status === "partial") && d.cashier_id === cashierId).reduce((s, d) => s + Number(d.deficit ?? 0), 0);
  const openDebts = cashierDebts.filter((d: any) => d.status === "open" && (d.store_id ?? storeId) === storeId);

  async function notifyCharges(msg: string) {
    try {
    const db = await getDb();
    const targets = USERS.filter(u => u.role === "manager" || u.role === "admin" || u.role === "owner");
    for (const t of targets) {
      if (t.id === currentUser?.id) continue;
      await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
        [`notif-${Date.now()}-${t.id}-${Math.random().toString(36).slice(2, 5)}`, t.id, "deficit", "deficit-resolution", msg, "pending", new Date().toISOString()]);
    }
    } catch (e) {
      console.log("[notifyCharges] failed:", e);
    }
  }

  async function sendDeficitReminder() {
    if (openDebts.length === 0) return Alert.alert("Pa gen defisi", "Pa gen defisi kesye ouvè ki poko revize kounye a.");
    try {
    const total = openDebts.reduce((s, d) => s + Number(d.deficit ?? 0), 0);
    await notifyCharges(`Rapèl: gen ${openDebts.length} defisi kesye ouvè (total ${fmtG(total)}). Manadjè/Admin/Owner dwe revize anvan fèmen mwa.`);
    Alert.alert("Rapèl voye", `Rapèl defisi voye bay Manadjè/Admin/Owner (${openDebts.length} kesye).`);
    load({ silent: true });
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Voye rapèl echwe");
    }
  }

  // Append to the audit trail + apply side effects. Never edits a previous review row.
  async function addReportReview(r: any, decision: string, reason?: string, previousReviewId?: string) {
    if (myRank < 1) return Alert.alert("Sèl sipèvizè", "Se sèlman Manadjè/Admin/Owner ka revize yon rapò");
    try {
    const db = await getDb();
    const ts = new Date().toISOString();
    const deficitAmt = Number(r.deficit ?? 0);
    const cashierName = getUserById(r.user_id)?.name ?? r.user_id;
    const meta = DECISION_INFO[decision];
    await db.runAsync(
      "INSERT INTO report_reviews (id, store_id, report_id, cashier_id, report_date, deficit, decision, decided_by, decided_by_role, decided_by_rank, reason, previous_review_id, created_at, lamport_clock, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [`rev-${r.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, storeId, r.id, r.user_id, r.report_date, deficitAmt, decision, currentUser?.id ?? null, currentUser?.role ?? null, myRank, reason ?? null, previousReviewId ?? null, ts, 1, ts]);
    await db.runAsync("UPDATE daily_reports SET reviewed_by = ?, reviewed_at = ? WHERE id = ?", [currentUser?.id ?? null, ts, r.id]);
    const cd = openDeficitOf(r);
    if (decision === "debt" || decision === "revoke_to_debt") {
      // Re-open the current open deficit, or reverse a previously waived one
      // (status resolved + waiver), or open a fresh row (never hard-delete).
      const waivedRow = cashierDebts.find((d: any) => d.cashier_id === r.user_id && d.date === r.report_date && d.status === "resolved" && d.resolution === "waived_negligible");
      if (cd || waivedRow) {
        const target = cd ?? waivedRow;
        await db.runAsync("UPDATE cashier_deficits SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", ["open", null, null, null, target.id]);
      } else {
        await db.runAsync("INSERT INTO cashier_deficits (id, store_id, cashier_id, date, deficit, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`def-${r.user_id}-${r.report_date}-${Date.now()}`, storeId, r.user_id, r.report_date, deficitAmt, "open", ts]);
      }
      if (decision === "revoke_to_debt" && previousReviewId) {
        // Reverse the waived loss with a compensating audit entry (never hard-delete loss rows).
        await db.runAsync("INSERT INTO monthly_losses (id, store_id, month, cashier_id, amount, origin, reason, registered_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
          [`loss-${Date.now()}`, storeId, String(r.report_date).slice(0, 7), r.user_id, -deficitAmt, "revocation_reversal", `Rektifikasyon apwobasyon ${previousReviewId}`, currentUser?.id ?? null, ts]);
      }
    } else if (decision === "waived_negligible") {
      if (cd) {
        await db.runAsync("UPDATE cashier_deficits SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", ["resolved", "waived_negligible", currentUser?.id ?? null, ts, cd.id]);
      }
      await db.runAsync("INSERT INTO monthly_losses (id, store_id, month, cashier_id, amount, origin, reason, registered_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [`loss-${Date.now()}`, storeId, String(r.report_date).slice(0, 7), r.user_id, deficitAmt, "waived_negligible", reason ?? "Defisi negligeable", currentUser?.id ?? null, ts]);
    }
    await notifyCharges(`${cashierName}: ${DECISION_MSG[decision] ?? decision} (${fmtG(deficitAmt)}) pa ${currentUser?.name ?? currentUser?.id}.`);
    notifyLocal("Revizyon rapò", `${cashierName} (${r.report_date}) · ${meta.label} · ${fmtG(deficitAmt)} — ${currentUser?.name ?? currentUser?.role}`);
    Alert.alert(meta.label, decision === "revoke_to_debt"
      ? `Dèt ${fmtG(deficitAmt)} reouvri pou ${cashierName}; pèt la konpense nan rejis la.`
      : decision === "debt"
        ? `Dèt total ${cashierName}: ${fmtG(totalDebtOf(r.user_id))}.`
        : `Rapò ${cashierName} (${r.report_date}) rekòde: ${meta.label}.`);
    const { salesEvents: ev } = await import("../salesEvents");
    try { ev.emit(); } catch {}
    load({ silent: true });
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Revizyon rapò echwe");
    }
  }

  async function submitDecision(r: any, decision: string, reason?: string, previousReviewId?: string) {
    if (decision === "waived_negligible" && !reason) { setWaiveFor(r.id); setWaiveReason(""); return; }
    setWaiveFor(null); setWaiveReason("");
    await addReportReview(r, decision, reason, previousReviewId);
  }

  // Deficit settlements FSM (period aggregation)
  async function createSettlement(cashierId: string) {
    if (!isSupervisor || !currentUser) { Alert.alert("Sèl Sipèvizè","Sèl Manadjè/Admin/Owner ka kreye règleman"); return; }
    const opens = cashierDebts.filter((d:any)=>d.cashier_id===cashierId && d.status==="open");
    if (opens.length===0) { Alert.alert("Pa gen dèt","Pa gen defisi ouvè pou kesye sa"); return; }
    const total = opens.reduce((s:number,x:any)=>s+Number(x.deficit||0),0);
    const dates = opens.map((x:any)=>x.date).sort();
    const deficit_ids = JSON.stringify(opens.map((x:any)=>x.id));
    const db = await getDb(); const ts = new Date().toISOString();
    const dup = settlements.find(s=>s.cashier_id===cashierId && s.period_start===dates[0] && s.period_end===dates[dates.length-1] && s.status!=="paid" && s.status!=="waived");
    if (dup) { Alert.alert("Deja egziste","Gen yon règleman ouvè deja pou peryòd sa"); return; }
    await db.runAsync("INSERT INTO deficit_settlements (id, store_id, cashier_id, period_start, period_end, deficit_ids, total, paid, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [`set-${Date.now()}`, storeId, cashierId, dates[0], dates[dates.length-1], deficit_ids, total, 0, "open", currentUser.id, ts]);
    Alert.alert("Règleman kreye", `${getUserById(cashierId)?.name ?? cashierId}: ${opens.length} dèt • ${fmtG(total)}`);
    load({ silent: true });
  }
  async function paySettlement(settlementId: string, amount: number) {
    if (!currentUser) return;
    const s = settlements.find(x=>x.id===settlementId);
    if (!s) return;
    if (s.status==="paid" || s.status==="waived") { Alert.alert("Fèmen","Règleman sa deja fèmen"); return; }
    if (amount<=0) { Alert.alert("Montan","Antre yon montan >0"); return; }
    const newPaid = Number(s.paid||0)+amount;
    if (newPaid > Number(s.total)) { Alert.alert("Twòp","Peman depase total"); return; }
    const db = await getDb();
    await db.runAsync("UPDATE deficit_settlements SET paid = ?, paid_by = ?, paid_at = ? WHERE id = ?", [newPaid, currentUser.id, new Date().toISOString(), settlementId]);
    if (newPaid >= Number(s.total)) {
      const ids: string[] = JSON.parse(s.deficit_ids||"[]");
      for (const did of ids) { try { await db.runAsync("UPDATE cashier_deficits SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", ["paid", currentUser.id, new Date().toISOString(), did]); } catch {} }
      notifyLocal("Règleman peye", (getUserById(s.cashier_id)?.name ?? s.cashier_id)+" peye nèt");
    }
    Alert.alert(newPaid>=Number(s.total)?"Peye nèt":"Peman anrejistre", fmtG(amount));
    load({ silent: true });
  }
  async function waiveSettlement(settlementId: string) {
    if (!isSupervisor || !currentUser) return;
    await (await getDb()).runAsync("UPDATE deficit_settlements SET status = ? WHERE id = ?", ["waived", settlementId]);
    Alert.alert("Abandone","Règleman abandone"); load({ silent: true });
  }

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /><Text style={{ marginTop: 8, color: "#64748b" }}>Ap chaje...</Text></View>;

  const todayStr = new Date().toLocaleDateString("fr-HT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const productMap = new Map<string, { name: string; qty: number; total: number }>();
  for (const it of items) {
    const cur = productMap.get(it.product_name) ?? { name: it.product_name, qty: 0, total: 0 };
    cur.qty += Number(it.quantity);
    cur.total += Number(it.line_total);
    productMap.set(it.product_name, cur);
  }
  if (productMap.size === 0 && sales.length > 0) {
    for (const s of sales) productMap.set(s.sale_number, { name: s.sale_number, qty: 1, total: Number(s.total) });
  }
  const productsSold = Array.from(productMap.values()).sort((a, b) => b.qty - a.qty);

  const reportRow = reports.find((r: any) => r.user_id === currentUser?.id);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: padH, paddingBottom: 32, alignItems: isTablet ? "center" : undefined }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accentGold} colors={[palette.ink2]} />}>
      <View style={{ width: "100%" }}>
      {/* Header */}
      <View style={{ backgroundColor: palette.ink2, borderRadius: radius.lg, padding: 16, ...shadow.card, borderTopWidth: 2.5, borderTopColor: palette.accentGold }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ flex: 1, fontFamily: "Inter_700Bold", color: "#fff", fontWeight: "700", fontSize: 20, letterSpacing: -0.3 }} numberOfLines={1}>{todayStr}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => { setRefreshing(true); load({ silent: true }); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)" }}>
            {refreshing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={15} color="#fff" />}
          </Pressable>
          {role && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(200,162,74,0.16)", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accentGold }} />
              <Text style={{ fontFamily: "Inter_700Bold", color: palette.accentGold, fontWeight: "700", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" }}>{role === "owner" ? "Patwon" : role}</Text>
            </View>
          )}
          </View>
        </View>
      </View>

      {/* Hero — Total Sales */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, padding: 18, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.successBd }}>
            <Ionicons name="cash-outline" size={22} color={palette.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>Total Vant Jodi a</Text>
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 34, color: palette.ink, letterSpacing: -0.5 }}>{salesTotal} <Text style={{ fontSize: 16, color: palette.muted2 }}>G</Text></Text>
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.successBg }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: palette.success, fontWeight: "700", fontSize: 10, textTransform: "uppercase" }}>
              {isSupervisor ? (role === "owner" ? "Magazen" : "Sòm Ekip") : "Mwen"}
            </Text>
          </View>
        </View>

        {/* Payment breakdown */}
        <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 16 }} />
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 12 }}>Repatisyon Peman</Text>
        <View style={{ marginTop: 8, gap: 8 }}>
          {[{ k: "Kach", v: cashTotal, c: palette.success }, { k: "MonCash", v: moncashTotal, c: palette.blue }, { k: "NatCash", v: natcashTotal, c: palette.warningDot }, { k: "Kredi", v: creditTotal, c: palette.accentGold }, { k: "Kolekte Dèt", v: collectedTotal, c: palette.emerald }].map(x => {
            const pct = Math.max(0, Math.min(100, (x.v / (salesTotal || 1)) * 100));
            return (
              <View key={x.k} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: x.c }} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.muted2, flex: 1, width: 90 }}>{x.k}</Text>
                <View style={{ flex: 0.7, height: 5, borderRadius: 3, backgroundColor: palette.surfaceGrouped, overflow: "hidden" }}>
                  <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: x.c }} />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, color: x.c, minWidth: 84, textAlign: "right", ...monoStyle }}>{fmtG(x.v)}</Text>
              </View>
            );
          })}
        </View>
        <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 12 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.muted, fontWeight: "700" }}>{role === "owner" ? "Total Magazen" : "Vant Total (Ekip ou)"}</Text>
          <Text style={{ fontFamily: "Inter_700Bold", color: palette.success, fontWeight: "700", fontSize: 20, textAlign: "right", ...monoStyle }}>{fmtG(salesTotal)}</Text>
        </View>
      </View>

      {/* Cash reconciliation — keep visible after close so the till stays auditable */}
      {(shift || myShiftToday) && (
        <View style={{ marginTop: 14, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.xl, padding: 16, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)" }}>
              <Ionicons name="briefcase-outline" size={18} color={palette.accentGold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 }}>Kach Espere nan Kès</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 24, color: palette.ink, letterSpacing: -0.3, marginTop: 2, textAlign: "right", ...monoStyle }}>{fmt(expectedCash)} <Text style={{ fontSize: 13, color: palette.muted2 }}>G</Text></Text>
            </View>
          </View>
          <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 12 }} />
          <View style={{ gap: 6, marginTop: 8 }}>
            {[
              { lbl: "Ouvèti", v: myOpening, add: true },
              { lbl: "Vant Kach", v: myCashTotal, add: true },
              { lbl: "Kolekte Dèt", v: myCollectedTotal, add: true },
              { lbl: "Retrè", v: myWithdrawalsTotal, add: false },
            ].map(row => (
              <View key={row.lbl} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.muted }}>{row.lbl}</Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, color: row.add ? palette.inkSoft : palette.danger }}>{row.add ? "+" : "−"}{fmtG(row.v)}</Text>
              </View>
            ))}
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2, marginTop: 6 }}>{myOpening} ouvèti + {myCashTotal} vant kach + {myCollectedTotal} kolekte − {myWithdrawalsTotal} retrè = kach espere</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted3, marginTop: 4 }}>Sous ouvèti: {myShiftToday ? `${myShiftToday.id} • ${String(myShiftToday.start_time ?? "?").slice(0, 16)} • ${myShiftToday.status} • kesye=${myShiftToday.cashier_id ?? "?"}` : "okenn chanjman jwenn"}</Text>
          </View>
          <View style={{ height: 0.5, backgroundColor: palette.separator, marginTop: 10 }} />
          {inventoryPickups.length > 0 && (
            <View style={{ marginTop: 10, gap: 6 }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, fontWeight: "600" }}>Kach depans ({fmtG(inventoryTotal)}):</Text>
              {inventoryPickups.map((w: any) => (
                <View key={w.id} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: palette.warningBg, padding: 9, borderRadius: radius.md, borderWidth: 0.5, borderColor: palette.warningBd, alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 11 }}>Kach depans {fmtG(w.amount)} — {w.reason}</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.muted2 }}>Depi kès {getUserById(w.taken_by ?? "")?.name ?? w.taken_by ?? "—"} • Anrejistre pa {getUserById(w.created_by)?.name ?? w.created_by}</Text>
                  </View>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: palette.success, fontWeight: "600" }}>✓ {w.validated_by ? "Valide" : "Pandan"}</Text>
                </View>
              ))}
            </View>
          )}
          {withdrawals.length > 0 && (
            <Text style={{ fontFamily: "Inter_400Regular", fontWeight: "600", fontSize: 10, color: palette.muted2, marginTop: 8 }}>{withdrawals.length} retrè • Detay nan seksyon "Retrè Jounen" anba</Text>
          )}
        </View>
      )}

      {/* Deficit / close report */}
      {actual !== null ? (
        <View style={{ marginTop: 14, backgroundColor: deficit === 0 ? palette.successBg : deficit! > 0 ? palette.dangerBg : palette.successBg, borderRadius: radius.lg, padding: 16, borderWidth: 0.5, borderColor: deficit === 0 ? palette.successBd : palette.dangerBd, flexDirection: "row", justifyContent: "space-between", alignItems: "center", ...shadow.soft }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14, color: deficit! === 0 ? palette.success : palette.danger }}>{deficit! === 0 ? `✓ Balanse` : deficit! > 0 ? `⚠️ Defisi: ${fmtG(deficit!)}` : `✓ Sipè: ${fmtG(Math.abs(deficit!))}`}</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: deficit === 0 ? palette.success : palette.danger }}>Espere {fmtG(expectedCash)} • Konte {fmtG(actual)}</Text>
          </View>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: deficit === 0 ? palette.successBg : palette.dangerBg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={deficit === 0 ? "checkmark-circle" : "warning"} size={22} color={deficit === 0 ? palette.success : palette.danger} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: 14, backgroundColor: palette.ink2, borderRadius: radius.lg, padding: 18, alignItems: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: palette.accentGold }}>
            <Ionicons name="cash-outline" size={24} color={palette.accentGold} />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontWeight: "700", fontSize: 15, marginTop: 10 }}>Konte Kach Ou Nan Kès La</Text>
          <Text style={{ fontFamily: "Inter_400Regular", color: palette.muted3, fontSize: 11, marginTop: 3, textAlign: "center" }}>Konte tout kòb ou genyen nan kès la, antre montan an. Dwe konpare ak {fmtG(expectedCash)} ki espere.</Text>
          <Pressable onPress={() => setShowEnd(true)} style={{ marginTop: 12, backgroundColor: palette.success, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.pill }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontWeight: "700", fontSize: 13 }}>Konte & Antre Montan Mwen</Text>
          </Pressable>
        </View>
      )}

      {/* Supervisor review studio — Apple-style segmented workflow (report_reviews audit trail) */}
      {isSupervisor && (
        <View style={{ marginTop: 12, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.soft }}>
          <View style={{ padding: 14, paddingBottom: 12, backgroundColor: palette.ink2, borderTopWidth: 3, borderTopColor: palette.accentGold }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="shield-checkmark-outline" size={17} color={palette.accentGold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.2 }}>Kontwòl Rapò Kesye</Text>
                <Text style={{ color: palette.muted3, fontSize: 9.5, marginTop: 2, fontFamily: "Inter_400Regular" }}>
                  {pendingReports.length} pou revize · {waivedReports.length} apwobasyon · {openDebts.length} dèt ouvè
                </Text>
              </View>
              <Pressable onPress={sendDeficitReminder} style={{ backgroundColor: palette.accentGold, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Rapèl</Text>
              </Pressable>
            </View>

            {/* Pill segmented control */}
            <View style={{ flexDirection: "row", gap: 3, marginTop: 12, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: radius.sm, padding: 3 }}>
              {([
                { id: "pending", label: "Revizyon", icon: "time-outline", n: pendingReports.length },
                { id: "waived", label: "Apwobasyon", icon: "warning-outline", n: waivedReports.length },
                { id: "debt", label: "Dèt", icon: "briefcase-outline", n: openDebts.length },
                { id: "journal", label: "Jounal", icon: "list-outline", n: reviews.length },
              ] as const).map((t: any) => {
                const on = revTab === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setRevTab(t.id)}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 9, backgroundColor: on ? palette.surface : "transparent", ...(on ? shadow.soft : null) }}>
                    <Ionicons name={t.icon} size={13} color={on ? palette.ink : "rgba(255,255,255,0.55)"} />
                    <Text style={{ fontWeight: "700", fontSize: 10, color: on ? palette.ink : "rgba(255,255,255,0.65)", letterSpacing: 0.2 }}>{t.label}</Text>
                    {t.n > 0 && (
                      <Text style={{ overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: on ? (t.id === "pending" ? palette.successBg : t.id === "waived" ? palette.warningBg : palette.surface2) : "rgba(255,255,255,0.14)", color: on ? (t.id === "pending" ? palette.success : t.id === "waived" ? palette.warning : palette.muted) : "#fff", fontSize: 9, fontWeight: "800" }}>{t.n}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ padding: 13, gap: 10 }}>
            {/* TAB: Revizyon */}
            {revTab === "pending" && (
              pendingReports.length === 0 ? (
                <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>✓ Ryen pou revize kounye a.</Text>
              ) : (
                pendingReports.map((r: any) => {
                  const revAmt = Number(r.deficit ?? 0);
                  const cashierName = getUserById(r.user_id)?.name ?? r.user_id;
                  const cashierStore = getUserById(r.user_id)?.store ?? r.store_id ?? storeId;
                  const openCd = openDeficitOf(r);
                  const owe = Number(openCd?.deficit ?? revAmt);
                  const open = waiveFor === r.id;
                  return (
                    <View key={`rv-${r.id}`} style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: revAmt > 0 ? palette.warningBd : palette.hairline, borderRadius: radius.md, overflow: "hidden", ...shadow.soft }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 11, paddingBottom: 11, paddingHorizontal: 12 }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: revAmt > 0 ? palette.warningBg : palette.successBg, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontWeight: "800", fontSize: 12, color: revAmt > 0 ? palette.warning : palette.success }}>{initialsOf(cashierName)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700", fontSize: 12.5, color: palette.ink, fontFamily: "Inter_700Bold" }}>
                            {cashierName} <Text style={{ fontWeight: "600", color: palette.muted2, fontSize: 9.5 }}>KESYE · {(cashierStore ?? "").toUpperCase()}</Text>
                          </Text>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 1 }}>Rapò {r.report_date} · Fèmen {td(r.closed_at ?? r.submitted_at ?? r.created_at)}</Text>
                        </View>
                        {revAmt > 0 ? (
                          <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.warningBg, color: palette.warning, fontWeight: "800", fontSize: 10.5, overflow: "hidden" }}>Defisi {fmt(revAmt)}</Text>
                        ) : (
                          <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.successBg, color: palette.success, fontWeight: "800", fontSize: 10.5, overflow: "hidden" }}>Balanse</Text>
                        )}
                      </View>

                      <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderColor: palette.hairline }}>
                        <View style={{ flex: 1, paddingTop: 9, paddingBottom: 9, paddingHorizontal: 12 }}>
                          <Text style={{ fontSize: 9, color: palette.muted2, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 }}>Atann</Text>
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: palette.ink, marginTop: 2 }}>{fmt(Number(r.expected_cash ?? 0))}</Text>
                        </View>
                        <View style={{ width: 0.5, backgroundColor: palette.hairline }} />
                        <View style={{ flex: 1, paddingTop: 9, paddingBottom: 9, paddingHorizontal: 12 }}>
                          <Text style={{ fontSize: 9, color: palette.muted2, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 }}>Konte</Text>
                          <Text style={{ fontSize: 12.5, fontWeight: "700", color: palette.ink, marginTop: 2 }}>{fmt(Number(r.actual_cash ?? 0))}</Text>
                        </View>
                        <View style={{ width: 0.5, backgroundColor: palette.hairline }} />
                        <View style={{ flex: 1, paddingTop: 9, paddingBottom: 9, paddingHorizontal: 12, backgroundColor: revAmt > 0 ? palette.warningBg : palette.surface2 }}>
                          <Text style={{ fontSize: 9, color: revAmt > 0 ? palette.warning : palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 }}>Defisi</Text>
                          <Text style={{ fontSize: 12.5, fontWeight: "800", color: revAmt > 0 ? palette.warning : palette.success, marginTop: 2 }}>{revAmt > 0 ? `−${fmt(revAmt)}` : "0"}</Text>
                        </View>
                      </View>

                      <View style={{ paddingTop: 7, paddingBottom: 7, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="briefcase-outline" size={12} color={palette.muted2} />
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2 }}>
                          {openCd
                            ? <>Dèt ouvè kounye a: <Text style={{ fontWeight: "700", color: palette.warning }}>{fmtG(owe)}</Text></>
                            : "Pa gen dèt ouvè pou jou sa a — dèt la pralouvri ak desizyon an."}
                        </Text>
                      </View>

                      {revAmt > 0 ? (
                        open ? (
                          <View style={{ paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline, backgroundColor: palette.accentGoldSoft }}>
                            <Text style={{ fontSize: 10.5, fontWeight: "700", color: palette.inkSoft, marginBottom: 6 }}>
                              Abandone kòm pèt (neglij) — w ap ap tann apwobasyon yon grad pi wo.
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <TextInput
                                value={waiveReason}
                                onChangeText={setWaiveReason}
                                placeholder="Rezon (opsyonèl)…"
                                placeholderTextColor={palette.muted3}
                                style={{ flex: 1, fontSize: 12, paddingVertical: 7, paddingHorizontal: 9, borderRadius: radius.sm, backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, color: palette.ink }} />
                              <Pressable onPress={() => addReportReview(r, "waived_negligible", waiveReason.trim())} style={{ backgroundColor: palette.success, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 }}>
                                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Konfime</Text>
                              </Pressable>
                              <Pressable onPress={() => setWaiveFor(null)} style={{ backgroundColor: palette.surface2, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 }}>
                                <Text style={{ fontWeight: "700", fontSize: 10 }}>Anile</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline }}>
                            <Pressable onPress={() => submitDecision(r, "debt")} style={{ flex: 1, backgroundColor: palette.accentGold, borderRadius: radius.sm, paddingVertical: 9, alignItems: "center" }}>
                              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Kreye Dèt — {fmtG(owe)}</Text>
                            </Pressable>
                            <Pressable onPress={() => submitDecision(r, "waived_negligible")} style={{ backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 12, alignItems: "center" }}>
                              <Text style={{ fontWeight: "700", fontSize: 10 }}>Abandone kòm pèt</Text>
                            </Pressable>
                          </View>
                        )
                      ) : (
                        <View style={{ paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline }}>
                          <Pressable onPress={() => submitDecision(r, "approved")} style={{ alignSelf: "flex-start", backgroundColor: palette.success, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 14 }}>
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>✓ Aprove Rapò</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )
            )}

            {/* TAB: Apwobasyon */}
            {revTab === "waived" && (
              waivedReports.length === 0 ? (
                <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>✓ Pa gen desizyon an atant.</Text>
              ) : (
                waivedReports.map((r: any) => {
                  const rv = latestByReport.get(r.id);
                  const revAmt = Number(r.deficit ?? 0);
                  const cashierName = getUserById(r.user_id)?.name ?? r.user_id;
                  return (
                    <View key={`wa-${r.id}`} style={{ backgroundColor: palette.surface, borderWidth: 0.5, borderColor: `${palette.accentGold}55`, borderRadius: radius.md, overflow: "hidden", ...shadow.soft }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 11, paddingBottom: 11, paddingHorizontal: 12 }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontWeight: "800", fontSize: 12, color: palette.accentGold }}>{initialsOf(cashierName)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700", fontSize: 12.5, color: palette.ink, fontFamily: "Inter_700Bold" }}>{cashierName} <Text style={{ fontWeight: "600", color: palette.muted2, fontSize: 9.5 }}>KESYE</Text></Text>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 1 }}>Rapò {r.report_date}</Text>
                        </View>
                        <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.accentGoldSoft, color: palette.accentGold, fontWeight: "800", fontSize: 10.5, overflow: "hidden" }}>Pèt {fmtG(revAmt)}</Text>
                      </View>
                      <View style={{ paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline, backgroundColor: palette.surface2 }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted }}>
                          Abandone pa <Text style={{ fontWeight: "700", color: palette.inkSoft }}>{getUserById(rv?.decided_by)?.name ?? rv?.decided_by ?? "?"}</Text> ({rv?.decided_by_role?.toUpperCase()}) · {td(rv?.created_at)}
                        </Text>
                        {rv?.reason ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 2 }}>“{rv.reason}”</Text> : null}
                      </View>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, borderTopWidth: 0.5, borderColor: palette.hairline }}>
                        <Pressable onPress={() => submitDecision(r, "approve_waive", rv?.reason, rv?.id)} style={{ flex: 1, backgroundColor: palette.success, borderRadius: radius.sm, paddingVertical: 9, alignItems: "center" }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>✓ Apwouve Pèt</Text>
                        </Pressable>
                        <Pressable onPress={() => submitDecision(r, "revoke_to_debt", rv?.reason, rv?.id)} style={{ flex: 1, backgroundColor: palette.danger, borderRadius: radius.sm, paddingVertical: 9, alignItems: "center" }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Revoke → Dèt</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )
            )}

            {/* TAB: Dèt (open debt + period settlements) */}
            {revTab === "debt" && (() => {
              const opens = cashierDebts.filter((d: any) => d.status === "open");
              const byCashier: Record<string, any[]> = {};
              opens.forEach((d: any) => { (byCashier[d.cashier_id] ??= []).push(d); });
              const groups = Object.entries(byCashier);
              return (
                <>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2 }}>Defisi ki poko peye — gwoup pa kesye. Kreye yon règleman pou yon peryòd. FSM: open → partial → paid; waived fèmen.</Text>
                  {groups.length === 0 ? (
                    <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>✓ Pa gen defisi ouvè pou règleman.</Text>
                  ) : groups.map(([cid, rows]: any) => {
                    const total = rows.reduce((s: number, x: any) => s + Number(x.deficit || 0), 0);
                    const dates = rows.map((x: any) => x.date).sort();
                    return (
                      <View key={cid} style={{ backgroundColor: palette.warningBg, borderWidth: 0.5, borderColor: palette.warningBd, borderRadius: radius.md, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontWeight: "800", fontSize: 10, color: palette.warning }}>{initialsOf(getUserById(cid)?.name ?? cid)}</Text>
                          </View>
                          <View>
                            <Text style={{ fontWeight: "700", fontSize: 12 }}>{getUserById(cid)?.name ?? cid}</Text>
                            <Text style={{ fontSize: 10, color: palette.muted2 }}>{rows.length} dèt • {fmtG(total)} • {dates[0]} → {dates[dates.length - 1]}</Text>
                          </View>
                        </View>
                        <Pressable onPress={() => createSettlement(cid)} style={{ backgroundColor: palette.success, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12 }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Kreye règleman</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  {settlements.length > 0 && (
                    <View style={{ gap: 8, marginTop: 4, borderTopWidth: 0.5, borderColor: palette.separator, paddingTop: 10 }}>
                      <Text style={{ fontWeight: "700", fontSize: 11 }}>Règleman yo ({settlements.length})</Text>
                      {settlements.map((s: any) => (
                        <View key={s.id} style={{ backgroundColor: s.status === "paid" ? palette.successBg : s.status === "waived" ? palette.surface2 : palette.surface, borderWidth: 0.5, borderColor: s.status === "paid" ? palette.successBd : palette.hairline, borderRadius: radius.md, padding: 10 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ fontWeight: "700", fontSize: 12 }}>{getUserById(s.cashier_id)?.name ?? s.cashier_id}</Text><Text style={{ fontWeight: "700", fontSize: 11, color: s.status === "paid" ? palette.success : s.status === "partial" ? palette.warningDot : palette.muted }}>{s.status} · {fmtG(s.paid)} / {fmtG(s.total)}</Text></View>
                          <Text style={{ fontSize: 10, color: palette.muted2 }}>{s.period_start} → {s.period_end} · {JSON.parse(s.deficit_ids || "[]").length} dèt</Text>
                          {s.status !== "paid" && s.status !== "waived" && (
                            <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                              <Pressable onPress={() => paySettlement(s.id, Number(s.total) - Number(s.paid))} style={{ flex: 1, backgroundColor: palette.success, borderRadius: radius.sm, paddingVertical: 8, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Peye rès {fmtG(Number(s.total) - Number(s.paid))}</Text></Pressable>
                              <Pressable onPress={() => waiveSettlement(s.id)} style={{ backgroundColor: palette.surface2, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 }}><Text style={{ fontWeight: "700", fontSize: 10 }}>Abandone</Text></Pressable>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </>
              );
            })()}

            {/* TAB: Jounal (append-only audit trail) */}
            {revTab === "journal" && (() => {
              const trail = [...reviews].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
              const dets = reviews.filter((v: any) => v.decision === "debt" || v.decision === "revoke_to_debt").length;
              const waives = reviews.filter((v: any) => v.decision === "waived_negligible").length;
              const losses = reviews.filter((v: any) => v.decision === "approve_waive").length;
              return (
                <>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.surface2, color: palette.muted, fontSize: 10, fontWeight: "700", overflow: "hidden" }}>{reviews.length} desizyon</Text>
                    <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.warningBg, color: palette.warning, fontSize: 10, fontWeight: "700", overflow: "hidden" }}>{dets} dèt</Text>
                    <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.accentGoldSoft, color: palette.accentGold, fontSize: 10, fontWeight: "700", overflow: "hidden" }}>{waives} pèt neglij</Text>
                    <Text style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.successBg, color: palette.success, fontSize: 10, fontWeight: "700", overflow: "hidden" }}>{losses} konfime</Text>
                  </View>
                  {trail.length === 0 ? (
                    <Text style={{ color: palette.success, fontWeight: "700", fontSize: 12 }}>✓ Jounal la vid.</Text>
                  ) : (
                    <View>
                      {trail.map((v: any, i: number) => {
                        const meta = DECISION_INFO[v.decision] ?? { label: v.decision, icon: "document-text-outline", color: palette.muted2 };
                        const act = getUserById(v.decided_by);
                        return (
                          <View key={v.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 9, borderTopWidth: i === 0 ? 0 : 0.5, borderColor: palette.hairline }}>
                            <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: `${meta.color}18`, alignItems: "center", justifyContent: "center" }}>
                              <Ionicons name={meta.icon} size={13} color={meta.color} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                                <Text style={{ fontSize: 11.5, fontWeight: "700", color: palette.ink }}>{meta.label}</Text>
                                <Text style={{ fontSize: 11, fontWeight: "800", color: meta.color }}>{Number(v.deficit) > 0 ? `${fmtG(Number(v.deficit))}` : "—"}</Text>
                              </View>
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 1 }}>{getUserById(v.cashier_id)?.name ?? v.cashier_id} · {v.report_date}</Text>
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9.5, color: palette.muted3, marginTop: 1 }}>
                                {act?.name ?? act?.id ?? "?"} ({v.decided_by_role}) · {td(v.created_at)}
                                {v.reason ? <Text> · “{v.reason}”</Text> : null}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      )}

      {/* Daily withdrawals ledger — supervisors only */}
      {isSupervisor && (() => {
        const ledger = [...withdrawals, ...inventoryPickups]
          .filter((m: any) => !m.created_at || m.created_at.slice(0, 10) === today)
          .sort((a: any, b: any) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
        const ledgerTotal = ledger.reduce((s: number, m: any) => s + Number(m.amount), 0);
        const done = ledger.filter((m: any) => m.validated_by).length;
        return (
          <View style={{ marginTop: 12, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.soft }}>
            <View style={{ padding: 13, borderBottomWidth: 0.5, borderColor: palette.separator, backgroundColor: palette.ink2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="briefcase-outline" size={17} color={palette.accentGold} />
                </View>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" }}>Retrè Jounen</Text>
              </View>
              <Text style={{ color: palette.muted3, fontSize: 10, marginTop: 4, fontFamily: "Inter_400Regular" }}>{ledger.length} mouvman • Total -{fmtG(ledgerTotal)} • {done}/{ledger.length} valide</Text>
            </View>
            {ledger.length === 0 ? (
              <View style={{ padding: 14, alignItems: "center" }}>
                <Text style={{ color: palette.muted3, fontSize: 12 }}>Pa gen retrè oswa kach depans jodi a.</Text>
              </View>
            ) : (
              <View style={{ gap: 8, padding: 12 }}>
                {ledger.map((m: any) => {
                  const isInv = m.type === "inventory";
                  return (
                    <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: isInv ? palette.warningBg : palette.surface2, padding: 10, borderRadius: radius.md, borderWidth: 0.5, borderColor: isInv ? palette.warningBd : palette.hairline, alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 12 }}>{isInv ? "🗂 Kach depans" : "💵 Retrè"} -{fmtG(m.amount)}</Text>
                        <Text style={{ fontSize: 9, color: palette.muted2, marginTop: 2 }}>{m.reason}</Text>
                        <Text style={{ fontSize: 9, color: palette.muted2, marginTop: 2 }}>
                          Anrejistre pa <Text style={{ fontWeight: "700" }}>{getUserById(m.created_by)?.name ?? m.created_by}</Text>
                          {m.taken_by ? ` • Pran pa ${getUserById(m.taken_by)?.name ?? m.taken_by}` : ""}
                        </Text>
                        <Text style={{ fontSize: 9, color: palette.muted3, marginTop: 2 }}>
                          {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6, marginLeft: 8 }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: m.validated_by ? palette.success : palette.warning }}>{m.validated_by ? "✓ Valide" : "⏳ Pandan"}</Text>
                        {!m.validated_by && !isInv && (
                          <Pressable onPress={() => setPendingValidateId(m.id)} style={{ backgroundColor: palette.warningBg, borderWidth: 0.5, borderColor: palette.warningBd, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill }}>
                            <Text style={{ color: palette.warning, fontWeight: "700", fontSize: 10 }}>Konfime</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })()}

      {/* Withdrawal validate dialog */}
      {pendingValidateId && (() => {
        const w = withdrawals.find((x: any) => x.id === pendingValidateId);
        const takenUser = getUserById(w?.taken_by ?? "");
        return (
          <View style={{ marginTop: 12, backgroundColor: palette.warningBg, borderWidth: 0.5, borderColor: palette.warningBd, borderRadius: radius.md, padding: 11 }}>
            <Text style={{ fontWeight: "700", fontSize: 12, color: palette.warning }}>Konfime retrè {fmtG(w?.amount)} — se sèlman {takenUser?.name ?? w?.taken_by} ki ka valide ak kòd li.</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput placeholder="Kòd sekrè" value={managerPassword} onChangeText={setManagerPassword} secureTextEntry keyboardType="numeric" style={{ flex: 1, borderWidth: 0.5, borderColor: palette.warningBd, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 10, minHeight: 48, backgroundColor: palette.surface }} />
              <Pressable onPress={async () => {
                if (managerPassword.trim() !== String(takenUser?.secret ?? "").trim()) return Alert.alert("Kòd pa bon", "Kòd sekrè a pa kòrèk.");
                try {
                const db = await getDb();
                await db.runAsync("UPDATE cash_movements SET validated_by = ? WHERE id = ?", [`${takenUser?.name} (valide)`, pendingValidateId]);
                Alert.alert("Valide", `Retrè ${fmtG(w?.amount)} valide.`);
                setPendingValidateId(null); setManagerPassword(""); load({ silent: true });
                } catch (e: any) {
                  Alert.alert("Erè", e?.message ?? "Validasyon echwe");
                }
              }} style={{ backgroundColor: palette.success, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>Valide</Text></Pressable>
            </View>
          </View>
        );
      })()}

      {/* Products sold */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.soft }}>
        <View style={{ padding: 13, borderBottomWidth: 0.5, borderColor: palette.separator, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="document-text-outline" size={17} color={palette.ink} />
            </View>
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 }}>{ht.productsSold}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: palette.surface2 }}>
              <Text style={{ fontFamily: "Inter_700Bold", color: palette.muted2, fontWeight: "700", fontSize: 10 }}>{productsSold.length}</Text>
            </View>
          </View>
          <Pressable onPress={() => load({ silent: true })} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}>
            {refreshing ? <ActivityIndicator size="small" color={palette.ink} /> : <Ionicons name="refresh" size={15} color={palette.ink} />}
          </Pressable>
        </View>
        {productsSold.map(p => (
          <View key={p.name} style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12 }}>{p.name}</Text>
              <Text style={{ color: palette.muted2, fontSize: 10 }}>Vann: {p.qty}</Text>
            </View>
            <Text style={{ fontWeight: "700", fontSize: 12 }}>{fmtG(p.total)}</Text>
          </View>
        ))}
      </View>

      {/* Sales list */}
      <View style={{ marginTop: 14, backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.soft }}>
        <View style={{ padding: 13, borderBottomWidth: 0.5, borderColor: palette.separator, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="checkmark-circle" size={17} color={palette.success} />
            </View>
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 }}>Vant Jodi a</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: palette.surface2 }}>
              <Text style={{ fontFamily: "Inter_700Bold", color: palette.muted2, fontWeight: "700", fontSize: 10 }}>{sales.length}</Text>
            </View>
          </View>
        </View>
        {sales.map(s => (
          <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
            <View>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12 }}>{s.sale_number}</Text>
              <Text style={{ fontSize: 10, color: palette.muted2 }}>{new Date(s.created_at).toLocaleTimeString()} • {s.payment_method} {s.seller_role ? `• ${s.seller_role}` : ""}</Text>
            </View>
            <Text style={{ fontWeight: "700", color: s.payment_method === "cash" ? palette.success : palette.accentGold }}>{fmtG(s.total)}</Text>
          </View>
        ))}
      </View>

      {/* End report modal */}
      <Modal visible={showEnd} transparent animationType="slide" onRequestClose={() => setShowEnd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.45)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", ...(isTablet && { alignItems: "center", width }) }}>
              <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 18, ...shadow.elevated }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: palette.separator, alignSelf: "center", marginBottom: 12 }} />
            <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center", fontSize: 15 }}>Fèmen Chanjman — Konte Kach</Text>
            <Text style={{ textAlign: "center", color: palette.muted2, fontSize: 12, marginTop: 4 }}>Konbyen kach ou genyen kounye a?</Text>
            <View style={{ backgroundColor: palette.surface2, borderRadius: radius.md, padding: 11, marginTop: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
              <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>KACH ESPERE</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 20, color: palette.accentGold }}>{fmtG(expectedCash)}</Text>
              <Text style={{ fontSize: 9, color: palette.muted2 }}>{myOpening} ouvèti + {myCashTotal} vant kach + {myCollectedTotal} kolekte − {myWithdrawalsTotal} retrè = kach espere</Text>
            </View>
            <TextInput placeholder="Antre kach ou konte" value={actualCash} onChangeText={setActualCash} keyboardType="numeric" autoFocus style={{ borderWidth: 0.5, borderColor: palette.success, borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: 14, minHeight: 52, marginTop: 12, fontWeight: "700", fontSize: 18, textAlign: "center", backgroundColor: palette.surface, fontFamily: "Inter_700Bold", color: palette.ink }} />
            {actualCash ? (
              <View style={{ marginTop: 8, padding: 10, borderRadius: radius.md, backgroundColor: parseFloat(actualCash) === expectedCash ? palette.successBg : parseFloat(actualCash) < expectedCash ? palette.dangerBg : palette.blueBg, borderWidth: 0.5, borderColor: parseFloat(actualCash) === expectedCash ? palette.successBd : parseFloat(actualCash) < expectedCash ? palette.dangerBd : palette.blueBd }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", textAlign: "center", color: parseFloat(actualCash) === expectedCash ? palette.success : parseFloat(actualCash) < expectedCash ? palette.danger : palette.blue }}>
                  {parseFloat(actualCash) === expectedCash ? `✓ Balanse — pa gen defisi` : parseFloat(actualCash) < expectedCash ? `⚠️ Defisi: ${fmtG(expectedCash - parseFloat(actualCash))}` : `Sipè: ${fmtG(parseFloat(actualCash) - expectedCash)}`}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => setShowEnd(false)} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700" }}>Anile</Text></Pressable>
              <Pressable onPress={async () => {
                const amt = parseFloat(actualCash);
                if (isNaN(amt)) return Alert.alert("Antre montan kach ou konte");
                const myTabs = await openTabsForMe();
                if (myTabs.length) return Alert.alert("Tab ouvè — pa ka fèmen", `Ou gen ${myTabs.length} vant an atann. Fèmen oswa anile yo nan Vant anvan ou fèmen chanjman an.`);
                setShowEnd(false); setActualCash("");
                await endReport(amt);
              }} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.ink2, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)", ...shadow.soft }}><Text style={{ color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" }}>Fèmen & Voye Rapò</Text></Pressable>
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </ScrollView>
  );
}
