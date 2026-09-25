import React, { useState, useEffect } from "react";
import { View, Text, Pressable, Modal, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { fmtG, fmt, monoStyle } from "../../format";
import { getUserById, USERS } from "../../users";
import { notifyLocal } from "../../notifications";
import { palette, radius, shadow } from "../../theme";
import { findSaleDetail, changeSalePaymentMethod, describeChange, salePaymentLabel, formatMoney, type SaleDetail } from "../../salesCorrection";
import { useResponsive, centerBox, sheetBox } from "../../responsive";
// STAGING-PICKUP: single gated import — delete this + the STAGING block below to remove.
import PickupToggleCard from "../../pickup-staging/PickupToggleCard";
import PickupRedeemEntry from "../../pickup-staging/PickupRedeemEntry";

export type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean }; 

export type Cashier = { id: string; name: string; store?: string };

type Props = {
  role: string;
  activeStore?: StoreItem;
  // Operational store id used for ALL shift / cash DB writes + reads.
  // Must match the storeId passed to ShiftReportScreen / POSScreen ("demo-store-id").
  // activeStore.id ("st-petyonvil", ...) is display-only — never use it for writes,
  // otherwise the shift becomes invisible to the shift report (opening = 0).
  storeId?: string;
  storeCount?: number;
  appDisabled?: boolean;
  setAppDisabled?: (v: boolean | ((prev: boolean) => boolean)) => void;
  canManageStore?: boolean;
  onOpenAccountCenter?: () => void;
  onOpenShiftReport?: () => void;
  onGoSales?: () => void;
  onShiftResolved?: () => void;
  currentUser?: any;
  cashiers?: Cashier[];
};

export default function StoreScreen({
  role,
  activeStore,
  storeId: storeIdProp,
  storeCount = 0,
  appDisabled = false,
  setAppDisabled,
  canManageStore = false,
  onOpenAccountCenter,
  onOpenShiftReport,
  onGoSales,
  onShiftResolved,
  currentUser,
  cashiers = [],
}: Props) {
  const responsive = useResponsive();
  const { width, isTablet, padH } = responsive;
  const name = activeStore?.name ?? "Magazen";
  const location = activeStore?.location ?? "—";
  const created = activeStore?.createdAt ? new Date(activeStore.createdAt).toLocaleDateString() : "—";
  const isOwner = role === "owner";
  const blocked = !!activeStore?.disabled;
  const isSupervisor = role === "owner" || role === "admin" || role === "manager";

  const options = cashiers.length
    ? cashiers
    : [{ id: "cashier-1", name: "Sophie Cashier", store: location }];
  const activeCashiers = options.filter(c => !c.store || c.store === location || !location).concat(
    options.filter(c => c.store && c.store !== location)
  );

  const [showInv, setShowInv] = useState(false);
  const [showInvCashierDropdown, setShowInvCashierDropdown] = useState(false);
  const [invCashier, setInvCashier] = useState<string>("");
  const [invAmt, setInvAmt] = useState("");
  const [invComment, setInvComment] = useState("");
  const [invSecret, setInvSecret] = useState("");

  // Pre-shift cash register check
  const PROGRAM_OPENING = 10000;
  const [showRegister, setShowRegister] = useState(false);
  const [regProgram, setRegProgram] = useState(String(PROGRAM_OPENING));
  const [regStated, setRegStated] = useState("");
  const [regView, setRegView] = useState<"ask" | "disagree" | "supervisor" | "setup" | "pending">("ask");
  const [pendingChecks, setPendingChecks] = useState<any[]>([]);
  // supervisor-approval-from-cashier-device mode
  const [superUser, setSuperUser] = useState<string>("");
  const [superSecret, setSuperSecret] = useState("");
  const [superDropdown, setSuperDropdown] = useState(false);
  const [delegatedSupervisor, setDelegatedSupervisor] = useState<any | null>(null);
  const [supervisorEntry, setSupervisorEntry] = useState<"pending" | "disagree" | null>(null);
  const effectiveIsSupervisor = isSupervisor || !!delegatedSupervisor;
  const effectiveSupervisor = delegatedSupervisor ?? (isSupervisor ? currentUser : null);
  const [setupCashier, setSetupCashier] = useState<string>("");
  const [setupCashierDropdown, setSetupCashierDropdown] = useState(false);
  const [setupLocked, setSetupLocked] = useState(false);
  const [lockedCashiers, setLockedCashiers] = useState<string[]>([]);
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null);
  const [correctAmount, setCorrectAmount] = useState("");
  // Operational store id — MUST match ShiftReportScreen/POSScreen ("demo-store-id").
  // activeStore.id is display-only (st-petyonvil/st-delma); using it for writes
  // orphans shifts + cash_movements so the report finds opening = 0.
  const storeId = storeIdProp ?? "demo-store-id";
  const [cashierShift, setCashierShift] = useState<any | null>(null);

  // Sales Options — sale lookup & payment method correction
  const [showSalesOptions, setShowSalesOptions] = useState(false);
  const [saleQuery, setSaleQuery] = useState("");
  const [searchingSale, setSearchingSale] = useState(false);
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null);
  const [saleError, setSaleError] = useState("");
  const [pendingChange, setPendingChange] = useState<"cash" | "credit" | null>(null);
  const [applyingChange, setApplyingChange] = useState(false);

  useEffect(() => {
    (async () => {
      if (isSupervisor || !currentUser) { setCashierShift(null); return; }
      try {
        const d = await getDb();
        const all = (await d.getAllAsync("SELECT * FROM shifts")) as any[];
        const mine = all.find((s: any) => s.cashier_id === currentUser.id && (s.status === "open" || s.status === "pending"));
        setCashierShift(mine || null);
      } catch { setCashierShift(null); }
    })();
  }, [isSupervisor, currentUser?.id, pendingChecks]);

  const shiftVerified = !isSupervisor && !!currentUser && cashierShift?.status === "open";

  async function loadChecks() {
    try {
    const d = await getDb();
    const all = (await d.getAllAsync("SELECT * FROM cash_register_checks")) as any[];
    setPendingChecks(all.filter((c: any) => (c.store_id ?? storeId) === storeId && c.status === "pending"));
    setLockedCashiers(all.filter((c: any) => (c.store_id ?? storeId) === storeId && c.action === "set_program").map((c: any) => c.cashier_id));
    } catch (e) {
      console.log("[loadChecks] failed:", e);
    }
  }

  // Load the program opening amount for a given cashier (falls back to "the usual")
  async function loadCashierProgram(cashierId?: string) {
    if (!cashierId) { setRegProgram(String(PROGRAM_OPENING)); setSetupLocked(false); return; }
    try {
      const d = await getDb();
      const all = (await d.getAllAsync("SELECT * FROM cash_register_checks")) as any[];
      const program = all
        .filter((c: any) => (c.store_id ?? storeId) === storeId && c.action === "set_program" && c.cashier_id === cashierId)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
      setSetupLocked(!!program);
      setRegProgram(program && program.correct_amount != null ? String(program.correct_amount) : String(PROGRAM_OPENING));
    } catch { setRegProgram(String(PROGRAM_OPENING)); setSetupLocked(false); }
  }

  // Agree: cashier accepts the opening amount — immediate start, no complaint
  async function agreeRegister() {
    if (!currentUser) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    const program = parseFloat(regProgram) || PROGRAM_OPENING;
    try {
      const db = await getDb();
      const shifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      const existing = shifts.find((s: any) => s.status === "open" && s.cashier_id === currentUser.id);
      if (existing) {
        Alert.alert("Chanjman kòmanse ✓", `Ou gen yon chanjman ouvè a ${fmtG(existing.opening_balance)}. Ou pa bezwen rekòmanse konfimasyon an.`);
        setShowRegister(false);
        if (onGoSales) onGoSales();
        return;
      }
      // Dakò -> accept the program amount: the shift begins immediately (confirmed).
      // No second confirmation step; the header switches to "Fèmen Chanjman".
      const ts = new Date().toISOString();
      const shiftId = `shift-${Date.now()}`;
      await db.runAsync(
        "INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [shiftId, storeId, currentUser.id, "manager-1", program, "open", ts, null, 1, 1, 1]
      );
      await db.runAsync(
        "INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`reg-${Date.now()}`, storeId, "", currentUser.id, ts.slice(0,10), program, program, "approved", "self_match", "owner-1", "owner", 1, null, null, ts]
      );
      const notifTargets = USERS.filter(u => (u.store === (activeStore?.name ?? "") || storeId === "demo-store-id") && (u.role === "admin" || u.role === "manager" || u.role === "owner"));
      for (const t of notifTargets) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${t.id}-${Math.random().toString(36).slice(2, 5)}`, t.id, "shift_opening", shiftId, `${currentUser.name} kòmanse chanjman ak ${fmtG(program)}.`, "pending", ts]);
      }
      notifyLocal("Chanjman kòmanse", `Kes la dakò a ${fmtG(program)}. Ou ka kòmanse vann kounye a.`);
      Alert.alert("Dakò ✓", `Kes la konfime pou ${fmtG(program)}. Chanjman kòmanse — ou ka kòmanse vann, pèsonn pap mande ou ankò.`);
      setRegStated(""); setRegView("ask"); setShowRegister(false);
      loadChecks();
      onShiftResolved?.();
      if (onGoSales) onGoSales();
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  // Disagree: cashier refuses the opening amount -> push to the complaint form view
  function disagreeRegister() {
    setRegView("disagree");
  }

  // Supervisor: change the program opening amount in the app (they fund the register)
  async function saveProgramAmount() {
    const approver = effectiveSupervisor;
    if (!approver) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    if (!effectiveIsSupervisor) return Alert.alert("Sèl Sipèvizè", "Sèl Admin/Manadjè/Owner ka chanje montan pwogram nan");
    const cashier = activeCashiers.find(c => c.id === setupCashier);
    if (!cashier) return Alert.alert("Chwazi kesye", "Chwazi kesye a nan lis la anvan");
    if (setupLocked) return Alert.alert("Fiks", "Montan kes sa a te deja fikse. Pèsonn pa ka chanje li oswa reset li ankò.");
    const amount = parseFloat(regProgram);
    if (isNaN(amount) || amount < 0) return Alert.alert("Antre montan", "Antre yon montan pwogram valid");
    try {
      const db = await getDb();
      const ts2 = new Date().toISOString();
      await db.runAsync(
        "INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`reg-${Date.now()}`, storeId, "", cashier.id, ts2.slice(0,10), amount, amount, "approved", "set_program", approver.id, approver.role ?? "manager", 0, approver.id, amount, ts2]
      );
      setRegProgram(String(amount));
      notifyLocal("Montan kes chanje", `${approver.name} mete montan ouvèti kes ${cashier.name} a sou ${fmtG(amount)}`);
      Alert.alert("Anrejistre ✓", `Montan ouvèti kes ${cashier.name} a mete sou ${fmtG(amount)}. Kesye a wè l lè li ouvri kes la. Ou ka chanje pou yon lòt kesye oswa fèmen.`);
      loadChecks();
      setSetupCashier("");
      setSetupCashierDropdown(false);
      setRegProgram(String(PROGRAM_OPENING));
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  // Submit the complaint after disagreeing
  async function fileRegisterComplaint() {
    if (!currentUser) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    const stated = parseFloat(regStated);
    if (isNaN(stated) || stated < 0) return Alert.alert("Antre montan", "Antre montan kach ou reyèlman konte nan kes la");
    const program = parseFloat(regProgram) || PROGRAM_OPENING;
    try {
      const db = await getDb();
      const ts = new Date().toISOString();
      await db.runAsync(
        "INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`reg-${Date.now()}`, storeId, "", currentUser.id, ts.slice(0,10), stated, program, "pending", "complaint", "owner-1", "owner", 1, null, null, ts]
      );
      // Pa dakò -> start a pending shift: cashier is blocked (status "pending"),
      // waiting for a supervisor. They cannot restart the cash confirmation.
      await db.runAsync(
        "INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [`shift-${Date.now()}`, storeId, currentUser.id, "manager-1", stated, "pending", ts, null, 0, 0, 0]
      );
      const notifTargets = USERS.filter(u => (u.store === (activeStore?.name ?? "") || storeId === "demo-store-id") && (u.role === "admin" || u.role === "manager" || u.role === "owner"));
      for (const t of notifTargets) {
        if (t.id === currentUser.id) continue;
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${t.id}-${Math.random().toString(36).slice(2, 5)}`, t.id, "reg_complaint", `reg-${Date.now()}`,
            `${currentUser.name} pa dakò ak kes la: li konte ${fmtG(stated)} olye de ${fmtG(program)}. Chanjman an sispann (atant yo). Yon sipèvizè dwe revize.`, "pending", ts]);
      }
      notifyLocal("Plent Kach", `${currentUser.name} pa dakò ak kes la (konte ${fmtG(stated)}, atann ${fmtG(program)})`);
      Alert.alert("Plent voye", `Ou pa dakò ak kes la (${fmtG(stated)}). Chanjman ou make "ap tann" — Notifikasyon voye bay Admin/Manadjè/Owner. Ou pa ka kòmanse jiskaske yo konfime.`);
      setRegStated(""); setRegView("ask"); setShowRegister(false);
      loadChecks();
      onShiftResolved?.();
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  useEffect(() => { loadChecks(); }, []);

  function verifySupervisorAndEnterSetup() {
    const pick = USERS.find(u => u.id === superUser);
    if (!pick || (pick.role !== "owner" && pick.role !== "admin" && pick.role !== "manager"))
      return Alert.alert("Chwazi sipèvizè", "Chwazi yon sipèvizè (Owner/Admin/Manadjè) ki pral aprouve");
    if (String(superSecret).trim() !== String(pick.secret).trim())
      return Alert.alert("Kòd pa bon", "Kòd sekrè a pa kòrèk. Kòd yo trete tankou paswòd — yo pa janm montre.");
    setDelegatedSupervisor(pick);
    // Keep secret cleared after success but keep user id for audit
    setSuperSecret("");
    setSuperDropdown(false);
    setRegView("setup");
    loadChecks();
    if (pick.id && pick.name) {
      loadCashierProgram(undefined);
    }
  }

  // Resolve a pending register check as a supervisor (from own app or cashier's device via "I am a supervisor")
  async function resolveRegisterAction(checkId: string, action: "approve" | "disagree" | "set") {
    // Authentication: delegated supervisor (verified via cashier device) takes precedence,
    // then direct supervisor auth in the supervisor window, then native supervisor role.
    let actingUser: any = null;
    if (delegatedSupervisor) {
      actingUser = delegatedSupervisor;
    } else if (regView === "supervisor") {
      const pick = USERS.find(u => u.id === superUser);
      if (!pick || (pick.role !== "owner" && pick.role !== "admin" && pick.role !== "manager"))
        return Alert.alert("Chwazi sipèvizè", "Chwazi yon sipèvizè (Owner/Admin/Manadjè) ki pral aprouve");
      if (String(superSecret).trim() !== String(pick.secret).trim())
        return Alert.alert("Kòd pa bon", "Kòd sekrè a pa kòrèk. Kòd yo trete tankou paswòd — yo pa janm montre.");
      actingUser = pick;
    } else if (isSupervisor && currentUser) {
      actingUser = currentUser;
    } else {
      return Alert.alert("Pa otorize", "Sèl yon sipèvizè (Owner/Admin/Manadjè) ka aprouve");
    }

    const check = pendingChecks.find(c => c.id === checkId);
    if (!check) return Alert.alert("Pa jwenn plent");

    let correctAmountValue = 0;
    if (action === "set") {
      correctAmountValue = parseFloat(correctAmount);
      if (isNaN(correctAmountValue) || correctAmountValue < 0) return Alert.alert("Antre montan", "Antre montan kòrèk la");
    }

    try {
      const db = await getDb();
      await db.runAsync("UPDATE cash_register_checks SET status = ?, action = ?, approved_by = ?, correct_amount = ? WHERE id = ?",
        [action === "disagree" ? "rejected" : "approved", action, actingUser.id, action === "set" ? correctAmountValue : null, checkId]);

      // The resolved amount becomes the cashier's opening amount for the day:
      //   "approve" -> the cashier's stated amount is accepted
      //   "set"     -> the supervisor's corrected amount is used
      // Record it as the locked program amount (set_program) and open the cashier's shift
      // with that opening_balance, so it is considered by the daily report.
      const dayAmount = action === "set" ? correctAmountValue : (parseFloat(check.stated_amount) || parseFloat(check.program_amount) || 0);
      let openedShiftId = "";
      const cashierId = check.cashier_id;
      const allShifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      // ONLY the cashier's pending shift. Do not match an already-open shift,
      // otherwise the wrong row is reopened and the unresolved pending row blocks sales.
      const pendingShift = allShifts.find((s: any) => s.cashier_id === cashierId && s.status === "pending");
      if (action === "disagree") {
        // Supervisor rejects the ticket -> close the pending shift so the pending
        // status clears and the cashier is not left stuck "ap tann".
        if (pendingShift) {
          openedShiftId = pendingShift.id;
          await db.runAsync("UPDATE shifts SET status = ?, end_time = ? WHERE id = ?", ["rejected", new Date().toISOString(), pendingShift.id]);
        }
      } else if (action === "approve" || action === "set") {
        const ts = new Date().toISOString();
        await db.runAsync(
          "INSERT INTO cash_register_checks (id, store_id, report_id, cashier_id, check_date, stated_amount, program_amount, status, action, set_by, set_by_role, is_default, approved_by, correct_amount, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [`reg-set-${Date.now()}`, storeId, "", cashierId, ts.slice(0,10), dayAmount, dayAmount, "approved", "set_program", actingUser.id, actingUser.role ?? "manager", 0, actingUser.id, dayAmount, ts]
        );
        // The cashier's pending shift becomes the confirmed, open shift for the day,
        // on the SAME row (cashier_confirmed=1 -> canSell unlocks).
        if (pendingShift) {
          openedShiftId = pendingShift.id;
          await db.runAsync("UPDATE shifts SET status = ?, opening_balance = ?, cashier_confirmed = ?, manager_confirmed = ?, supervisor_confirmed = ? WHERE id = ?",
            ["open", dayAmount, 1, 1, 1, pendingShift.id]);
        } else {
          openedShiftId = `shift-${Date.now()}`;
          await db.runAsync("INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [openedShiftId, storeId, cashierId, "manager-1", dayAmount, "open", ts, null, 1, 1, 1]);
        }
      }

      const db2 = await getDb();
      const notifTargets = USERS.filter(u => (u.store === (activeStore?.name ?? "") || storeId === "demo-store-id"));
      const msg = action === "disagree"
        ? `${actingUser.name} pa dakò ak tikit ou. Kes ou rete fèmen — al kontakte sipèvizè a pou repati.`
        : action === "set"
          ? `${actingUser.name} fikse kes ou sou ${fmtG(dayAmount)}. Chanjman ou kòmanse — sales debloke, ou ka kòmanse vann.`
          : `${actingUser.name} konfime kes ou a ${fmtG(dayAmount)}. Chanjman ou kòmanse — sales debloke, ou ka kòmanse vann.`;
      const cashierMsg = msg;
      for (const t of notifTargets) {
        if (t.id === actingUser.id) continue;
        await db2.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${t.id}-${Math.random().toString(36).slice(2, 5)}`, t.id, "reg_resolved", checkId, msg, "pending", new Date().toISOString()]);
      }
      // Always notify the ticket's cashier of the supervisor's action, in any case.
      if (check.cashier_id !== actingUser.id) {
        await db2.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${check.cashier_id}-${Math.random().toString(36).slice(2, 5)}`, check.cashier_id, action === "disagree" ? "reg_rejected" : "shift_start", openedShiftId || checkId, cashierMsg, "pending", new Date().toISOString()]);
      }
      notifyLocal("Kes rezoud", msg);
      Alert.alert("Kes konfime ✓", msg);
      setSuperUser(""); setSuperSecret(""); setCorrectAmount(""); setActiveCheckId(null);
      const remaining = pendingChecks.filter((p: any) => p.id !== checkId);
      if (remaining.length === 0) {
        setShowRegister(false);
        setRegView("ask");
        setPendingChecks([]);
        setDelegatedSupervisor(null);
        setSupervisorEntry(null);
      } else {
        setPendingChecks(remaining);
        setRegView("setup");
      }
      loadChecks();
      onShiftResolved?.();
      // If the cashier whose ticket was resolved is the current device cashier,
      // also navigate to sales so the unlock is felt immediately.
      if (check.cashier_id === currentUser?.id && (action === "approve" || action === "set")) {
        onGoSales?.();
      }
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  async function handleInventoryPickup() {
    if (!currentUser) return Alert.alert("Sesi", "Ou dwe konekte yon itilizatè");
    if (!isSupervisor) return Alert.alert("Sèl Sipèvizè", "Sèl Owner/Admin/Manager ka retire kach");
    const amt = parseFloat(invAmt);
    if (!amt || isNaN(amt) || amt <= 0) return Alert.alert("Antre montan", "Antre yon montan valab");
    const cashier = getUserById(invCashier) ?? activeCashiers.find(c => c.id === invCashier);
    if (!cashier) return Alert.alert("Chwazi kesye", "Chwazi kesye k ap bay kach la");
    if (String(invSecret).trim() !== String(currentUser.secret).trim()) {
      return Alert.alert("Kòd pa bon", "Kòd sekrè ou pa kòrèk.");
    }
    try {
      const db = await getDb();
      const shifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      const open = shifts.find((s: any) => s.status === "open");
      const shiftId = open ? open.id : "";
      await db.runAsync(
        "INSERT INTO cash_movements (id, shift_id, store_id, type, amount, reason, created_by, taken_by, validated_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [`cm-inv-${Date.now()}`, shiftId, storeId, "inventory", amt, invComment || "Retrè kach", currentUser.id, cashier.id, `${currentUser.name}`, new Date().toISOString()]
      );
      Alert.alert("Kach anrejistre", `${fmtG(amt)} retire depi kès ${cashier.name} (${invComment || "retrè kach"}) — anrejistre pa ${currentUser.name}. Li ap reflete imedyatman nan rapò jounen kesye a.`);
      notifyLocal("Retire Kach", `${fmtG(amt)} retire depi kès ${cashier.name} — ${invComment || "retrè kach"}`);
      setInvAmt(""); setInvComment(""); setInvSecret("");
      setShowInv(false);
    } catch (e) {
      Alert.alert("Erè", String(e));
    }
  }

  async function handleSaleSearch() {
    setSaleError("");
    setSaleDetail(null);
    setPendingChange(null);
    const q = saleQuery.trim();
    if (!q) return setSaleError("Antre id oswa nimewo vant la");
    setSearchingSale(true);
    try {
      const db = await getDb();
      const detail = await findSaleDetail(db, storeId, q);
      if (!detail) {
        setSaleError("Vant pa jwenn — verifye id la");
      } else {
        setSaleDetail(detail);
      }
    } catch (e: any) {
      setSaleError(e?.message ?? "Erè pandan rechèch");
    } finally {
      setSearchingSale(false);
    }
  }

  async function handleApplyChange() {
    if (!saleDetail || !pendingChange) return;
    setApplyingChange(true);
    try {
      const db = await getDb();
      const res = await changeSalePaymentMethod(saleDetail, pendingChange, { db, storeId, storeName: name, currentUser });
      try { const { salesEvents } = await import("../../salesEvents"); salesEvents.emit(); } catch {}
      notifyLocal("Koreksyon Vant ✓", `Vant ${res.sale.sale_number} chanje soti ${salePaymentLabel(res.previous)} → ${salePaymentLabel(res.target)} — analytics ak rapò mete ajou.`);
      Alert.alert(
        "Koreksyon anrejistre ✓",
        `Vant ${res.sale.sale_number}\nSoti ${salePaymentLabel(res.previous)} → ${salePaymentLabel(res.target)}\nTOTAL: ${formatMoney(Number(res.sale.total ?? 0))}\nResi: ${res.receiptNumber}\n\nAnalytics ak rapò jounen an mete ajou otomatikman.`
      );
      setSaleDetail(null);
      setSaleQuery("");
      setPendingChange(null);
      setShowSalesOptions(false);
    } catch (e: any) {
      Alert.alert("Koreksyon echwe", e?.message ?? "Imposib fè koreksyon an");
    } finally {
      setApplyingChange(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg, flexGrow: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24, alignItems: "center" }} showsVerticalScrollIndicator={false}>
      <View style={{ width: "100%", gap: 12 }}>
      {blocked && (
        <View style={{ backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, borderRadius: radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed" size={18} color={palette.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 13, color: palette.danger }}>Magazen bloke</Text>
            <Text style={{ fontSize: 11, color: palette.danger, marginTop: 2, lineHeight: 15 }}>Sispann apre yon bès sekirite. Tout aktivite enfim. Kontakte Konsole Sipò.</Text>
          </View>
        </View>
      )}

      {/* Active store summary card */}
      <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="storefront-outline" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontWeight: "700", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>{name}</Text>
              <View style={{ backgroundColor: palette.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: palette.success, letterSpacing: 0.3 }}>AKTIF</Text>
              </View>
            </View>
            <Text style={{ fontSize: 13, color: palette.muted2, marginTop: 2 }}>{location} • Depi {created}</Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={palette.ink} />
        </View>

        {/* Store details */}
        <View style={{ marginTop: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="location-outline" size={13} color={palette.muted2} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Lokal/site</Text>
            </View>
            <Text style={{ fontSize: 13, color: palette.ink, fontWeight: "600" }}>{location}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="lock-closed-outline" size={13} color={palette.muted2} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Kòd sekrè</Text>
            </View>
            <Text style={{ fontSize: 11, color: palette.muted3, fontStyle: "italic" }}>pa vizib • sere deyò app la</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name={appDisabled ? "lock-closed-outline" : "lock-open-outline"} size={13} color={appDisabled ? palette.danger : palette.success} />
              <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "500" }}>Stat</Text>
            </View>
            <Text style={{ fontSize: 13, color: appDisabled ? palette.danger : palette.success, fontWeight: "700" }}>{appDisabled ? "Li sèlman" : "Aktif"}</Text>
          </View>
        </View>
      </View>

      {/* Pre-shift cash register check */}
      <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
        <Pressable onPress={async () => {
          if (shiftVerified) return;
          if (!isSupervisor && onOpenShiftReport && currentUser) {
            try {
              const d = await getDb();
              const shiftsAll = (await d.getAllAsync("SELECT * FROM shifts")) as any[];
              const myOpen = shiftsAll.find((s: any) => s.status === "open" && s.cashier_id === currentUser.id);
              const myPending = shiftsAll.find((s: any) => s.status === "pending" && s.cashier_id === currentUser.id);
              if (myOpen) { onOpenShiftReport(); return; }
              if (myPending) { setShowRegister(true); setSuperUser(""); setSuperSecret(""); setDelegatedSupervisor(null); setSupervisorEntry(null); setRegView("pending"); loadCashierProgram(currentUser?.id); return; }
            } catch {}
          }
          setShowRegister(true); setSuperUser(""); setSuperSecret(""); setDelegatedSupervisor(null); setSupervisorEntry(null); setRegView(isSupervisor ? "setup" : "ask"); if (!isSupervisor) loadCashierProgram(currentUser?.id);
        }} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: shiftVerified ? 0.55 : 1 }}>
          <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="briefcase-outline" size={20} color={shiftVerified ? palette.muted2 : palette.accentGold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Lajan Disponib</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>
              {shiftVerified ? "Vèrifye — Ou kòmanse chanjman" : "Lajan Ki disponib pou chak kesye"}
            </Text>
          </View>
          {shiftVerified ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Ionicons name="checkmark-circle" size={14} color={palette.success} />
              <Text style={{ color: palette.success, fontSize: 12, fontWeight: "700" }}>Vèrifye</Text>
            </View>
          ) : (effectiveIsSupervisor ? pendingChecks.length : pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id).length) > 0 ? (
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{effectiveIsSupervisor ? pendingChecks.length : pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id).length}</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
          )}
        </Pressable>
      </View>

      {/* Daily report — priority 1 */}
      {onOpenShiftReport && (
        <Pressable
          onPress={onOpenShiftReport}
          style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
        >
          <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="document-text-outline" size={20} color={palette.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Rapò Jounen</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Chanjman • Vant • Retrè • Diskrepans — rapò chak jou</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
        </Pressable>
      )}

      {/* Sales Options — sale lookup & payment method correction */}
      <Pressable
        onPress={() => { setShowSalesOptions(true); setSaleQuery(""); setSaleError(""); setSaleDetail(null); setPendingChange(null); }}
        style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
      >
        <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.blueBg, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="receipt-outline" size={20} color={palette.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Opsyon Vant</Text>
          <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Chèche yon vant pa id • View detay yo • Korekte Kach/Kredi</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
      </Pressable>

      {/* Inventory cash take — priority 2 (Owner/Admin/Manager) */}
      {isSupervisor && (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
          <Pressable onPress={() => setShowInv(true)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="cash-outline" size={20} color={palette.accentGold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Retire Kach</Text>
              <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Retire kach depi kès yon kesye pou depans (envantè, faktirite…)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
          </Pressable>
        </View>
      )}

      {/* Account Center — priority 3 (Owner only) */}
      {isOwner && onOpenAccountCenter && (
        <Pressable
          onPress={onOpenAccountCenter}
          style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}
        >
          <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="business-outline" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Kourro</Text>
            <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 2 }}>Jere magazen ou yo • Chwazi aktif • Kòd sekrè ({storeCount})</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted3} />
        </Pressable>
      )}

      {/* App access toggle — priority 4 (Owner/Admin) */}
      {canManageStore && (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={appDisabled ? "lock-closed-outline" : "lock-open-outline"} size={18} color={appDisabled ? palette.danger : palette.muted2} />
              </View>
              <View>
                <Text style={{ fontWeight: "600", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Aksè app</Text>
                <Text style={{ fontSize: 12, color: appDisabled ? palette.danger : palette.muted2, marginTop: 2 }}>{appDisabled ? "Li sèlman" : "Tout moun ka ekri"}</Text>
              </View>
            </View>
            {setAppDisabled && (
              <Pressable onPress={() => setAppDisabled(v => !v)} style={{ backgroundColor: appDisabled ? palette.danger : palette.ink2, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, ...shadow.soft }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff", letterSpacing: 0.2 }}>{appDisabled ? "Aktive" : "Dezaktive"}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* STAGING-PICKUP: manager toggle (device-local). Delete block to remove. */}
      <PickupToggleCard storeId={storeId} role={role} />
      {/* STAGING-PICKUP: cashier redemption entry (flag-gated). Delete block to remove. */}
      <PickupRedeemEntry storeId={storeId} cashierId={currentUser?.id ?? null} storeName={activeStore?.name ?? null} cashierName={currentUser?.name ?? null} />

      {/* Non-owner note */}
      {!isOwner && (
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, borderWidth: 0.5, borderColor: palette.hairline }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="information-circle-outline" size={16} color={palette.muted2} />
            <Text style={{ fontSize: 13, color: palette.muted2, flex: 1 }}>Ou ap itilize magazen <Text style={{ fontWeight: "700", color: palette.ink }}>{name}</Text>. Kontak sipò pou jere l.</Text>
          </View>
        </View>
      )}

      {/* Inventory cash take modal */}
      <Modal visible={showInv} transparent animationType="slide" onRequestClose={() => setShowInv(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.40)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, maxHeight: "92%", borderTopWidth: 0.5, borderColor: palette.hairline, ...shadow.elevated }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="cash-outline" size={19} color={palette.accentGold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }}>Retire Kach</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>Retire kach depi kès yon kesye pou depans (envantè, faktirite…) • anrejistre pa sipèvizè</Text>
              </View>
              <Pressable onPress={() => setShowInv(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={palette.muted2} />
              </Pressable>
            </View>

            {/* Cashier dropdown */}
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 16 }}>Kesye ki bay kach la</Text>
            <Pressable
              onPress={() => setShowInvCashierDropdown(v => !v)}
              style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 0.5, borderColor: showInvCashierDropdown ? palette.accentGold : palette.hairlineStrong, backgroundColor: palette.surfaceGrouped }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{(activeCashiers.find(c => c.id === invCashier)?.name ?? "—").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{activeCashiers.find(c => c.id === invCashier)?.name ?? "Chwazi kesye"}</Text>
                <Text style={{ fontSize: 11, color: palette.muted2 }}>{activeCashiers.find(c => c.id === invCashier)?.store ?? "Kesye"}</Text>
              </View>
              <Ionicons name={showInvCashierDropdown ? "chevron-up" : "chevron-down"} size={18} color={palette.muted2} />
            </Pressable>

            {showInvCashierDropdown && (
              <View style={{ marginTop: 6, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.md, overflow: "hidden", backgroundColor: palette.surface, ...shadow.soft }}>
                {activeCashiers.map((c, idx) => {
                  const selected = c.id === invCashier;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => { setInvCashier(c.id); setShowInvCashierDropdown(false); }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: selected ? palette.accentGoldSoft : palette.surface, borderTopWidth: idx === 0 ? 0 : 0.5, borderTopColor: palette.separator }}
                    >
                      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{c.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{c.name}</Text>
                        <Text style={{ fontSize: 11, color: palette.muted2 }}>{c.store ?? "Kesye"}</Text>
                      </View>
                      {selected && <Ionicons name="checkmark-circle" size={20} color={palette.accentGold} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 16 }}>Montan (G) *</Text>
            <TextInput value={invAmt} onChangeText={setInvAmt} keyboardType="numeric" placeholder="5000" placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, padding: 13, minHeight: 50, marginTop: 6, color: palette.ink, fontFamily: "Inter_700Bold", fontWeight: "700", backgroundColor: palette.bg }} />

            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 12 }}>Rezon / Kòmantè</Text>
            <TextInput value={invComment} onChangeText={setInvComment} placeholder="Fason yo pral itilize kach la (eg. envantè, faktirite)" placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, padding: 13, minHeight: 50, marginTop: 6, color: palette.ink, backgroundColor: palette.bg }} />

            {/* Supervisor secret */}
            <View style={{ marginTop: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 12 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12, color: palette.accentGold }}>🔐 Kòd sekrè ou</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.muted2, marginTop: 2 }}>Sèlman sipèvizè ka anrejistre</Text>
              <TextInput value={invSecret} onChangeText={setInvSecret} secureTextEntry keyboardType="numeric" placeholder="Antre kòd sekrè ou" placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.sm, padding: 12, minHeight: 48, marginTop: 8, backgroundColor: palette.surface, fontFamily: "Inter_700Bold", fontWeight: "700", color: palette.ink }} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setShowInv(false)} style={{ flex: 1, padding: 13, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", color: palette.ink }}>Anile</Text></Pressable>
              <Pressable onPress={handleInventoryPickup} style={{ flex: 1, padding: 13, backgroundColor: palette.ink2, borderRadius: radius.md, alignItems: "center", ...shadow.soft }}>
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700" }}>Anrejistre</Text>
              </Pressable>
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pre-shift cash register modal */}
      <Modal visible={showRegister} transparent animationType="slide" onRequestClose={() => { setShowRegister(false); setDelegatedSupervisor(null); setSupervisorEntry(null); setSuperUser(""); setSuperSecret(""); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.40)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, maxHeight: "92%", borderTopWidth: 0.5, borderColor: palette.hairline, ...shadow.elevated }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {regView === "ask" || (regView === "setup" && !delegatedSupervisor) ? (
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="briefcase-outline" size={19} color={palette.accentGold} />
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    if (regView === "disagree") setRegView("ask");
                    else if (regView === "pending") { setShowRegister(false); setDelegatedSupervisor(null); setSupervisorEntry(null); setSuperUser(""); setSuperSecret(""); }
                    else if (regView === "supervisor") setRegView(supervisorEntry ?? "pending");
                    else if (regView === "setup" && delegatedSupervisor) setRegView("supervisor");
                    else setRegView("disagree");
                  }}
                  hitSlop={8}
                  style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="arrow-back" size={20} color={palette.ink} />
                </Pressable>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }}>Lajan Disponib</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>{delegatedSupervisor ? `Aji kòm ${delegatedSupervisor.name} — menm ekran ak app sipèvizè a` : "Anvan kòmanse, kesye konte kach kes la epi fè l matche ak pwogram nan"}</Text>
              </View>
              <Pressable onPress={() => { setShowRegister(false); setDelegatedSupervisor(null); setSupervisorEntry(null); setSuperUser(""); setSuperSecret(""); }} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={palette.muted2} />
              </Pressable>
            </View>

            {regView === "setup" ? (
              <>
                {delegatedSupervisor && (
                  <View style={{ marginTop: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.md, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="shield-checkmark" size={16} color={palette.accentGold} />
                    <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "700", flex: 1 }}>Verifye kòm {delegatedSupervisor.name} ({delegatedSupervisor.role}) • menm pwosesis ak app sipèvizè a</Text>
                  </View>
                )}
                {/* PRIORITY: pending complaints first when there are claims */}
                {pendingChecks.length > 0 && (
                  <View style={{ marginTop: 18, gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="alert-circle" size={17} color={palette.danger} />
                        <Text style={{ fontSize: 13, color: palette.ink, fontWeight: "800" }}>Plent kesye yo</Text>
                      </View>
                      <View style={{ backgroundColor: palette.dangerBg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 11, color: palette.danger, fontWeight: "800" }}>{pendingChecks.length} atant</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted2, lineHeight: 16, marginTop: -4 }}>
                      Kesye yo pa te dakò ak montan a. Rezoud chak plent anvan ou fikse montan kes.
                    </Text>

                    <View style={{ gap: 8 }}>
                      {pendingChecks.map((c) => (
                        <View key={c.id} style={{ backgroundColor: palette.surface, borderRadius: radius.md, overflow: "hidden", borderWidth: 0.5, borderColor: palette.hairline, ...shadow.soft }}>
                          <View style={{ height: 3, backgroundColor: palette.danger }} />
                          <View style={{ padding: 12 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center" }}>
                                <Text style={{ fontSize: 12, fontWeight: "800", color: palette.accentGold }}>{(getUserById(c.cashier_id)?.name ?? "?").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 14, fontWeight: "800", color: palette.ink }}>{getUserById(c.cashier_id)?.name ?? c.cashier_id}</Text>
                                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>Kesye pa dakò ak montan a</Text>
                              </View>
                            </View>

                            <View style={{ marginTop: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10, gap: 6 }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                <Text style={{ fontSize: 11, color: palette.muted2 }}>Kesye te konte</Text>
                                <Text style={{ fontSize: 13, fontWeight: "800", color: palette.danger, textAlign: "right", ...monoStyle }}>{fmtG(c.stated_amount)}</Text>
                              </View>
                              <View style={{ height: 0.5, backgroundColor: palette.hairline }} />
                              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                <Text style={{ fontSize: 11, color: palette.muted2 }}>Pwogram nan atann</Text>
                                <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, textAlign: "right", ...monoStyle }}>{fmtG(c.program_amount)}</Text>
                              </View>
                            </View>

                            {activeCheckId === c.id ? (
                              <View style={{ marginTop: 12 }}>
                                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                                  <TextInput value={correctAmount} onChangeText={setCorrectAmount} keyboardType="numeric" placeholder="Antre nouvo montan" placeholderTextColor={palette.muted3} style={{ flex: 1, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 44, color: palette.ink, backgroundColor: palette.surface2, fontSize: 13 }} />
                                  <Pressable onPress={() => resolveRegisterAction(c.id, "set")} android_ripple={{ color: "rgba(255,255,255,0.2)" }} style={({ pressed }) => [{
                                    backgroundColor: palette.accentGold, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 44, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
                                  }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                                    <Ionicons name="lock-closed" size={15} color="#fff" />
                                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Fikse montan</Text>
                                  </Pressable>
                                </View>
                                <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 6, lineHeight: 14 }}>
                                  Montan sa a pral fikse. Yon fwa anrejistre, l pa ka chanje ankò.
                                </Text>
                                <Pressable onPress={() => { setActiveCheckId(null); setCorrectAmount(""); }} hitSlop={8} style={{ marginTop: 6, alignSelf: "flex-start" }}>
                                  <Text style={{ fontSize: 12, color: palette.muted2, fontWeight: "600" }}>Anile</Text>
                                </Pressable>
                              </View>
                            ) : (
                              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                                <Pressable onPress={() => { setActiveCheckId(c.id); setCorrectAmount(""); }} android_ripple={{ color: "rgba(176,0,32,0.12)" }} style={({ pressed }) => [{
                                  flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd,
                                }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
                                  <Ionicons name="close" size={16} color={palette.danger} />
                                  <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 12 }}>Pa dakò</Text>
                                </Pressable>
                                <Pressable onPress={() => resolveRegisterAction(c.id, "approve")} android_ripple={{ color: "rgba(10,124,62,0.12)" }} style={({ pressed }) => [{
                                  flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: palette.success,
                                }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
                                  <Ionicons name="checkmark" size={16} color="#fff" />
                                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Konfime</Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Cashier amount form — hidden until all pending claims are resolved */}
                {pendingChecks.length === 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontWeight: "800", fontSize: 16, color: palette.ink }}>Sè ou ki mete kach nan kes la</Text>
                  <Text style={{ fontSize: 12, color: palette.muted2, marginTop: 4, lineHeight: 17, marginBottom: 16 }}>
                    Se ou (Admin/Manadjè/Owner) ki mete lajan nan kes la anvan jounen an. Ou pa gen pou konfime kes la — chwazi yon kesye epi, si montan an diferan de nòmal, chanje li nan app la anvan.
                  </Text>

                  {/* Cashier dropdown */}
                  <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Kesye a</Text>
                  <Pressable onPress={() => setSetupCashierDropdown(v => !v)} style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 0.5, borderColor: setupCashierDropdown ? palette.accentGold : palette.hairlineStrong, backgroundColor: palette.surfaceGrouped }}>
                    <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{(activeCashiers.find(c => c.id === setupCashier)?.name ?? "—").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{activeCashiers.find(c => c.id === setupCashier)?.name ?? "Chwazi kesye"}</Text>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>{setupCashier ? "Antre montan kes pou kesye sa a" : "Kesye yo nan magazen sa a"}</Text>
                    </View>
                    <Ionicons name={setupCashierDropdown ? "chevron-up" : "chevron-down"} size={18} color={palette.muted2} />
                  </Pressable>
                  {setupCashierDropdown && (
                    <View style={{ marginTop: 6, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.md, overflow: "hidden", backgroundColor: palette.surface, ...shadow.soft }}>
                      {activeCashiers.map((c) => (
                        <Pressable key={c.id} onPress={() => { setSetupCashier(c.id); setSetupCashierDropdown(false); loadCashierProgram(c.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: setupCashier === c.id ? palette.accentGoldSoft : palette.surface }}>
                          <Text style={{ fontSize: 12 }}>👤</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{c.name}</Text>
                            <Text style={{ fontSize: 11, color: palette.muted2 }}>{lockedCashiers.includes(c.id) ? "🔒 Fiks — pa ka chanje" : "Kesye"}</Text>
                          </View>
                          {lockedCashiers.includes(c.id)
                            ? <Ionicons name="lock-closed" size={18} color={palette.muted3} />
                            : (setupCashier === c.id && <Ionicons name="checkmark-circle" size={20} color={palette.accentGold} />)}
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <View style={{ marginTop: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
                      Montan ouvèti kes la — {setupCashier ? activeCashiers.find(c => c.id === setupCashier)?.name : "kite vid oswa kitite"} (G)
                    </Text>
                    <TextInput value={regProgram} onChangeText={setRegProgram} keyboardType="numeric" placeholder="10000" placeholderTextColor={palette.muted3} editable={!!setupCashier && !setupLocked} style={{ borderWidth: 0.5, borderColor: setupLocked ? palette.hairline : palette.hairlineStrong, borderRadius: radius.sm, padding: 13, minHeight: 52, marginTop: 6, color: palette.ink, fontFamily: "Inter_700Bold", fontWeight: "700", backgroundColor: palette.bg, opacity: setupCashier && !setupLocked ? 1 : 0.6 }} />
                    <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 6, lineHeight: 14 }}>
                      {setupLocked
                        ? "🔒 Montan sa a fiks nan app la. Li te mete yon fwa — pèsonn pa ka chanje l oswa reset l ankò."
                        : setupCashier
                          ? "Si ou pa chanje li, kesye a ap wè montan nòmal (anvan) a."
                          : "Chwazi yon kesye pi wo a pou fikse montan kes li."}
                    </Text>
                  </View>
                  {setupLocked ? (
                    <View style={{ marginTop: 14, backgroundColor: palette.successBg, borderWidth: 0.5, borderColor: palette.success, borderRadius: radius.md, padding: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                      <Ionicons name="lock-closed" size={18} color={palette.success} />
                      <Text style={{ color: palette.success, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14 }}>Fiks — Pa ka Chanje</Text>
                    </View>
                  ) : (
                    <Pressable onPress={saveProgramAmount} android_ripple={{ color: "rgba(255,255,255,0.2)" }} style={({ pressed }) => [{
                      marginTop: 14, backgroundColor: palette.accentGold, borderRadius: radius.md, padding: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, ...shadow.soft,
                    }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15 }}>Anrejistre Montan Kes</Text>
                    </Pressable>
                  )}
                  <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 10, lineHeight: 15 }}>Ou ka mete yon montan diferan pou chak kesye.</Text>
                </View>
                )}
              </>
            ) : regView === "ask" ? (
              <>
                {/* Program opening amount */}
                <View style={{ marginTop: 16, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
                  <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Montan pwogram nan atann</Text>
                  <Text style={{ fontWeight: "900", fontSize: 18, color: palette.accentGold, marginTop: 2, textAlign: "left", ...monoStyle }}>{fmtG(regProgram || PROGRAM_OPENING)}</Text>
                  <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>Sa pwogram nan deklare kes la genyen kòm kach ouvèti</Text>
                </View>

                {/* Direct agree / disagree question */}
                <Text style={{ fontWeight: "800", fontSize: 15, color: palette.ink, marginTop: 16 }}>Eske ou dakò ak montan kes la?</Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <Pressable
                    onPress={disagreeRegister}
                    android_ripple={{ color: "rgba(153,27,27,0.12)" }}
                    style={({ pressed }) => [{
                      flex: 1, minHeight: 56, borderRadius: radius.md,
                      backgroundColor: palette.dangerBg,
                      alignItems: "center", justifyContent: "center",
                      flexDirection: "row", gap: 8,
                      borderWidth: 1, borderColor: palette.dangerBd,
                    }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
                  >
                    <Ionicons name="close-circle" size={20} color={palette.danger} />
                    <Text style={{ color: palette.danger, fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15 }}>Pa dakò</Text>
                  </Pressable>
                  <Pressable
                    onPress={agreeRegister}
                    android_ripple={{ color: "rgba(255,255,255,0.2)" }}
                    style={({ pressed }) => [{
                      flex: 1, minHeight: 56, borderRadius: radius.md,
                      backgroundColor: palette.accentGold,
                      alignItems: "center", justifyContent: "center",
                      flexDirection: "row", gap: 8,
                      borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
                      ...shadow.soft,
                    }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
                  >
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 15 }}>Dakò</Text>
                  </Pressable>
                </View>

                {/* Pending checks — cashier sees only own ticket */}
                {(effectiveIsSupervisor ? pendingChecks : pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id)).length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Plent nan atant ({(effectiveIsSupervisor ? pendingChecks : pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id)).length})</Text>
                    <View style={{ gap: 8, marginTop: 8 }}>
                      {(effectiveIsSupervisor ? pendingChecks : pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id)).map((c) => (
                        <View key={c.id} style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink }}>{getUserById(c.cashier_id)?.name ?? c.cashier_id} — konte {fmtG(c.stated_amount)} (atann {fmtG(c.program_amount)})</Text>
                          {effectiveIsSupervisor && (
                            <View style={{ marginTop: 8, gap: 6 }}>
                              <View style={{ flexDirection: "row", gap: 6 }}>
                                <Pressable onPress={() => resolveRegisterAction(c.id, "approve")} style={{ flex: 1, backgroundColor: palette.successBg, borderWidth: 0.5, borderColor: palette.success, borderRadius: radius.md, paddingVertical: 9, alignItems: "center" }}>
                                  <Text style={{ color: palette.success, fontWeight: "700", fontSize: 11 }}>Konfime kesye ({c.stated_amount})</Text>
                                </Pressable>
                                <Pressable onPress={() => resolveRegisterAction(c.id, "disagree")} style={{ flex: 1, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.md, paddingVertical: 9, alignItems: "center" }}>
                                  <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Pa dakò</Text>
                                </Pressable>
                              </View>
                              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                                <TextInput value={activeCheckId === c.id ? correctAmount : ""} onChangeText={(t) => { setActiveCheckId(c.id); setCorrectAmount(t); }} keyboardType="numeric" placeholder="Montan kòrèk" placeholderTextColor={palette.muted3} style={{ flex: 1, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.md, padding: 10, minHeight: 44, color: palette.ink, backgroundColor: palette.surface }} />
                                <Pressable onPress={() => { setActiveCheckId(c.id); resolveRegisterAction(c.id, "set"); }} style={{ backgroundColor: palette.ink2, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 }}>
                                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>Fikse montan</Text>
                                </Pressable>
                              </View>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                )}

              </>
            ) : regView === "disagree" ? (
              <>
                <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 12 }}>Ki kach ou reyèlman konte? (G) *</Text>
                <TextInput value={regStated} onChangeText={setRegStated} keyboardType="numeric" placeholder="Konbyen ou konte tout bon" placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, padding: 13, minHeight: 50, marginTop: 6, color: palette.ink, fontFamily: "Inter_700Bold", fontWeight: "700", backgroundColor: palette.bg }} />
                <Pressable onPress={fileRegisterComplaint} style={{ marginTop: 16, backgroundColor: palette.ink2, borderRadius: radius.md, padding: 14, alignItems: "center", ...shadow.soft }}>
                  <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700" }}>Voye Plent → Notifye Admin/Manadjè/Owner</Text>
                </Pressable>

                {/* I am a supervisor — only here, once disagreeing.
                    Purpose: the supervisor, present at the cashier's app, resolves the pending
                    ticket(s) right here. It is NOT for starting/re-confirming the shift. */}
                <Pressable onPress={() => { setSupervisorEntry("disagree"); setRegView("supervisor"); }} style={{ marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.accentGold, borderStyle: "dashed" }}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={palette.accentGold} />
                  <Text style={{ color: palette.accentGold, fontWeight: "700", fontSize: 13 }}>Sipèvizè: Rezoud tikit yo depi isit ({pendingChecks.filter((c:any)=>c.cashier_id===currentUser?.id).length})</Text>
                </Pressable>
              </>
            ) : regView === "pending" ? (
              <>
                <View style={{ marginTop: 10, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.md, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="time-outline" size={18} color={palette.danger} />
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13, color: palette.danger }}>Tikit ou ap tann verifikasyon</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: palette.ink, marginTop: 6, lineHeight: 17 }}>Ou pa dakò ak kes la. Chanjman ou make "ap tann" — ou pa ka kòmanse jiskaske yon sipèvizè jere tikit la.</Text>
                </View>

                {pendingChecks.filter((c: any) => c.cashier_id === currentUser?.id).map((c) => (
                  <View key={c.id} style={{ marginTop: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Plent ou</Text>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                      <Text style={{ fontSize: 12, color: palette.muted2 }}>Ou te konte</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, textAlign: "right", ...monoStyle }}>{fmtG(c.stated_amount)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: palette.muted2 }}>Pwogram nan atann</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, textAlign: "right", ...monoStyle }}>{fmtG(c.program_amount)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTopWidth: 0.5, borderTopColor: palette.hairline }}>
                      <Text style={{ fontSize: 12, color: palette.muted2 }}>Diferans</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: (parseFloat(c.stated_amount) || 0) < (parseFloat(c.program_amount) || 0) ? palette.danger : palette.success }}>
                        {fmtG((parseFloat(c.program_amount) || 0) - (parseFloat(c.stated_amount) || 0))}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 8 }}>⭐ Fòse sou {fmtG(c.stated_amount)}</Text>
                  </View>
                ))}

                <View style={{ marginTop: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 10 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12, color: palette.accentGold }}>🛡️ Yon sipèvizè la bò kote w?</Text>
                  <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4, lineHeight: 15 }}>Si yon Owner/Admin/Manadjè la avè w, li ka rezoud tikit la tou dwèt sou aplikasyon w sa a — pa bezwen chanje oswa rekòmanse.</Text>
                </View>
                <Pressable onPress={() => { setSupervisorEntry("pending"); setRegView("supervisor"); }} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.accentGold, borderStyle: "dashed", backgroundColor: palette.bg }}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={palette.accentGold} />
                  <Text style={{ color: palette.accentGold, fontWeight: "700", fontSize: 13 }}>Sipèvizè: Rezoud tikit yo depi isit</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={{ marginTop: 10, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 10 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12, color: palette.accentGold }}>🛡️ Rezoud tikit kesye a</Text>
                  <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4, lineHeight: 15 }}>Sipèvizè ki la prezante sou aplikasyon kesye a rezoud tikit ki ap tann yo isit la. Antre kòd sekrè w la — apre verifikasyon w ap wè menm ekran ak app sipèvizè a.</Text>
                </View>
                <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 10 }}>Kiyès sipèvizè a?</Text>
                <Pressable onPress={() => setSuperDropdown(v => !v)} style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 0.5, borderColor: superDropdown ? palette.accentGold : palette.hairlineStrong, backgroundColor: palette.surfaceGrouped }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{(USERS.find(u => u.id === superUser)?.name ?? "—").split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{USERS.find(u => u.id === superUser)?.name ?? "Chwazi sipèvizè"}</Text>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>{USERS.find(u => u.id === superUser)?.role ?? "Owner / Admin / Manadjè"}</Text>
                  </View>
                  <Ionicons name={superDropdown ? "chevron-up" : "chevron-down"} size={18} color={palette.muted2} />
                </Pressable>
                {superDropdown && (
                  <View style={{ marginTop: 6, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.md, overflow: "hidden", backgroundColor: palette.surface, ...shadow.soft }}>
                    {USERS.filter(u => u.role === "owner" || u.role === "admin" || u.role === "manager").map((u) => (
                      <Pressable key={u.id} onPress={() => { setSuperUser(u.id); setSuperDropdown(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: superUser === u.id ? palette.accentGoldSoft : palette.surface }}>
                        <Text style={{ fontSize: 12 }}>{u.role === "owner" ? "👑" : u.role === "admin" ? "🛡️" : "👔"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700", fontSize: 14, color: palette.ink }}>{u.name}</Text>
                          <Text style={{ fontSize: 11, color: palette.muted2 }}>{u.role}</Text>
                        </View>
                        {superUser === u.id && <Ionicons name="checkmark-circle" size={20} color={palette.accentGold} />}
                      </Pressable>
                    ))}
                  </View>
                )}
                <View style={{ marginTop: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 12 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 12, color: palette.accentGold }}>🔐 Kòd sekrè ou</Text>
                  <TextInput value={superSecret} onChangeText={setSuperSecret} secureTextEntry keyboardType="numeric" placeholder="Antre kòd sekrè ou" placeholderTextColor={palette.muted3} style={{ borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.sm, padding: 12, minHeight: 48, marginTop: 8, backgroundColor: palette.surface, fontFamily: "Inter_700Bold", fontWeight: "700", color: palette.ink }} />
                </View>

                <Pressable onPress={verifySupervisorAndEnterSetup} android_ripple={{ color: "rgba(255,255,255,0.2)" }} style={({ pressed }) => [{ marginTop: 16, backgroundColor: palette.ink2, borderRadius: radius.md, padding: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, ...shadow.soft }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                  <Ionicons name="shield-checkmark" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14 }}>Verifye & Kontinye</Text>
                </Pressable>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 8, textAlign: "center", lineHeight: 15 }}>Apre verifikasyon w ap wè menm ekran ak app sipèvizè a (plent yo ak menm design).</Text>
              </>
            )}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sales Options — search, view & correct a sale */}
      <Modal visible={showSalesOptions} transparent animationType="slide" onRequestClose={() => setShowSalesOptions(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.45)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, maxHeight: "94%", borderTopWidth: 0.5, borderColor: palette.hairline, ...shadow.elevated }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.blueBg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="receipt-outline" size={19} color={palette.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }}>Opsyon Vant</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }}>Chèche yon vant pa id oswa nimewo • View tout detay yo epi korije si sa nesesè</Text>
              </View>
              <Pressable onPress={() => setShowSalesOptions(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={palette.muted2} />
              </Pressable>
            </View>

            <View style={{ marginTop: 16, flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1, borderWidth: 0.5, borderColor: palette.hairlineStrong, borderRadius: radius.sm, paddingHorizontal: 12, backgroundColor: palette.bg, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="search" size={16} color={palette.muted3} />
                <TextInput
                  value={saleQuery}
                  onChangeText={(t) => { setSaleQuery(t); setSaleError(""); }}
                  onSubmitEditing={handleSaleSearch}
                  placeholder="ID oswa nimewo vant (eg. sale-1725…)"
                  placeholderTextColor={palette.muted3}
                  autoCapitalize="none"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 13, color: palette.ink, fontFamily: "Inter_400Regular", minHeight: 46 }}
                />
              </View>
              <Pressable onPress={handleSaleSearch} disabled={searchingSale} style={{ backgroundColor: palette.ink2, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 13, ...shadow.soft }}>
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 13 }}>{searchingSale ? "…" : "Chèche"}</Text>
              </Pressable>
            </View>

            {!!saleError && (
              <View style={{ marginTop: 12, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="alert-circle" size={16} color={palette.danger} />
                <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "600", flex: 1 }}>{saleError}</Text>
              </View>
            )}

            {saleDetail && !pendingChange && (
              <View style={{ marginTop: 14 }}>
                <View style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.lg, padding: 14, borderWidth: 0.5, borderColor: palette.hairline }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View>
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 15, color: palette.ink }}>Vant {saleDetail.sale.sale_number ?? saleDetail.sale.id}</Text>
                      <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{new Date(saleDetail.sale.created_at ?? new Date()).toLocaleDateString()} • {new Date(saleDetail.sale.created_at ?? new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                    </View>
                    <View style={{ backgroundColor: saleDetail.sale.payment_method === "credit" ? palette.warningBg : palette.successBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: saleDetail.sale.payment_method === "credit" ? palette.accentGoldSoft : palette.successBd }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: saleDetail.sale.payment_method === "credit" ? palette.accentGold : palette.success }}>{salePaymentLabel(saleDetail.sale.payment_method)}</Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, paddingTop: 10, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Kesye</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600" }}>{getUserById(saleDetail.sale.seller_id)?.name ?? saleDetail.sale.seller_id ?? "—"}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Kliyan</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600", flexShrink: 1, marginLeft: 12, textAlign: "right" }}>{saleDetail.customer ? `${saleDetail.customer.name}${saleDetail.customer.id_card_number ? ` (${saleDetail.customer.id_card_number})` : ""}` : "Pa gen kliyan"}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Atik</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600" }}>{saleDetail.items.length} atik</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>TOTAL</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle }}>{formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Pe</Text>
                      <Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600", ...monoStyle }}>{formatMoney(Number(saleDetail.sale.amount_paid ?? 0))}</Text>
                    </View>
                    {Number(saleDetail.sale.amount_due ?? 0) > 0 && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 11, color: palette.muted2 }}>Reste dwe</Text>
                        <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", ...monoStyle }}>{formatMoney(Number(saleDetail.sale.amount_due ?? 0))}</Text>
                      </View>
                    )}
                  </View>

                  {saleDetail.items.length > 0 && (
                    <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: palette.hairline, paddingTop: 10, gap: 6 }}>
                      {saleDetail.items.map((it, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                          <Text style={{ fontSize: 11, color: palette.muted3, ...monoStyle, width: 40 }}>{it.quantity} ×</Text>
                          <Text numberOfLines={2} style={{ flex: 1, fontSize: 11, color: palette.ink, fontWeight: "500", lineHeight: 15 }}>{it.product_name ?? it.name}{it.variant && it.variant !== "Regular" ? ` · ${it.variant}` : ""}</Text>
                          <Text style={{ fontSize: 11, color: palette.ink, fontWeight: "700", ...monoStyle }}>{formatMoney(Number(it.line_total ?? 0))}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Correction actions (role-based) */}
                <View style={{ marginTop: 12, gap: 10 }}>
                  {saleDetail.sale.payment_method === "credit" && (
                    <Pressable onPress={() => setPendingChange("cash")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.successBg, borderRadius: radius.md, padding: 14, borderWidth: 0.5, borderColor: palette.successBd }}>
                      <Ionicons name="cash-outline" size={17} color={palette.success} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 13, color: palette.success }}>Rektifye an Kach (vant te Kach)</Text>
                    </Pressable>
                  )}
                  {saleDetail.sale.payment_method === "cash" && effectiveIsSupervisor && (
                    <Pressable onPress={() => setPendingChange("credit")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: palette.accentGoldSoft, borderRadius: radius.md, padding: 14, borderWidth: 0.5, borderColor: palette.accentGold }}>
                      <Ionicons name="pricetag-outline" size={17} color={palette.accentGold} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 13, color: palette.accentGold }}>Chanje an Kredi (sipèvizè)</Text>
                    </Pressable>
                  )}
                  {saleDetail.sale.payment_method === "cash" && !effectiveIsSupervisor && (
                    <View style={{ backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="lock-closed-outline" size={15} color={palette.muted2} />
                      <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "500", flex: 1 }}>Yon vant Kach pa ka vin Kredi pa yon kesye — sèl yon sipèvizè ka fè koreksyon sa.</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Confirmation panel */}
            {saleDetail && pendingChange && (
              <View style={{ marginTop: 14, backgroundColor: saleDetail.sale.payment_method === "credit" ? palette.successBg : palette.accentGoldSoft, borderWidth: 0.5, borderColor: saleDetail.sale.payment_method === "credit" ? palette.successBd : palette.accentGold, borderRadius: radius.lg, padding: 14 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 14, color: palette.ink }}>Konfime koreksyon</Text>
                <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 3, lineHeight: 16 }}>Koreksyon sa pral mete ajou analytics, rapò jounen an ak resi yo otomatikman.</Text>
                <View style={{ marginTop: 10, gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>Rejim aktyèl</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: palette.ink }}>{salePaymentLabel(saleDetail.sale.payment_method)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>Aprè koreksyon</Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: pendingChange === "credit" ? palette.accentGold : palette.success }}>{pendingChange === "credit" ? "Kredi" : "Kach"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: palette.muted2 }}>TOTAL</Text>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: palette.ink, ...monoStyle }}>{formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                  </View>
                  {pendingChange === "cash" && saleDetail.credit && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Dèt retire nan kliyan</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: palette.danger, ...monoStyle }}>− {formatMoney(Math.max(0, Number(saleDetail.credit.balance ?? 0)))}</Text>
                    </View>
                  )}
                  {pendingChange === "credit" && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 11, color: palette.muted2 }}>Nouvo dèt kliyan</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: palette.danger, ...monoStyle }}>+ {formatMoney(Number(saleDetail.sale.total ?? 0))}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable onPress={() => setPendingChange(null)} style={{ flex: 1, padding: 13, backgroundColor: palette.surface, borderRadius: radius.md, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontWeight: "700", color: palette.ink }}>Anile</Text>
                  </Pressable>
                  <Pressable onPress={handleApplyChange} disabled={applyingChange} style={{ flex: 1, padding: 13, backgroundColor: palette.ink2, borderRadius: radius.md, alignItems: "center", ...shadow.soft }}>
                    <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontWeight: "700" }}>{applyingChange ? "Aplike…" : "Konfime ✓"}</Text>
                  </Pressable>
                </View>
              </View>
            )}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </ScrollView>
  );
}
