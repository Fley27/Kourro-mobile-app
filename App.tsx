import React, { useState, useRef, useEffect, useCallback } from "react";
import { Text, View, Pressable, TextInput, Alert, Modal, Animated, Easing, BackHandler, ScrollView, AppState, Image, StatusBar, Platform } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import POSScreen from "./src/screens/POSScreen";
import HomeScreen from "./src/screens/HomeScreen";
import InventoryScreen from "./src/screens/InventoryScreen";
import TransactionsScreen from "./src/screens/TransactionsScreen";
import ShiftScreen from "./src/screens/ShiftScreen";
import AccountCenter from "./src/screens/home/AccountCenter";
import MoreScreen from "./src/screens/MoreScreen";
import OrdersScreen from "./src/orders/OrdersScreen";
import CustomersScreen from "./src/screens/CustomersScreen";
import type { BusinessType } from "./src/users";
import SecurityCenter from "./src/screens/home/SecurityCenter";
import StoreScreen from "./src/screens/home/StoreScreen";
import TeamScreen, { type Employee } from "./src/screens/home/TeamScreen";
import { BottomNav, Tab, visibleTabsFor } from "./src/components/BottomNav";
import { MenuSidebar } from "./src/components/MenuSidebar";
import { IS_TABLET_DEVICE, SIDEBAR_RAIL, MENU_W_EXPANDED, SidebarWidthProvider } from "./src/responsive";
import { type MoreEntry } from "./src/menu/entries";
import { defaultMenuCollapsed, loadMenuCollapsed, saveMenuCollapsed } from "./src/menu/sidebarState";
import { TabsFab } from "./src/components/TabsFab";
import { tabsUI } from "./src/tabsUI";
import { notifUI, type NotifRoute } from "./src/notifRoute";
import { initNotifRouting } from "./src/notifications";
import { OrdersFab } from "./src/components/OrdersFab";
import { SyncErrorBanner } from "./src/components/SyncErrorBanner";
import { SubscriptionBanner } from "./src/components/SubscriptionBanner";
import { SyncStatusIndicator } from "./src/components/SyncStatusIndicator";
import { SyncIssueBanner } from "./src/components/SyncIssueBanner";
import { InitialDownloadBanner } from "./src/components/InitialDownloadBanner";
import { ordersUI } from "./src/ordersUI";
import { ht } from "./src/i18n";
import { USERS, getUserById, USER_IDS, type Role, type User } from "./src/users";
import { FALLBACK_STORE_ID, STORE_IDS, deriveId, reportIdForShift, mintId } from "./src/db/ids";
import { blackPalette as palette, radius, shadow } from "./src/theme";
import { Ionicons } from "@expo/vector-icons";
import { useAuthState } from "./src/auth/authStore";
import { useWritable, refreshSubscriptionFromDb } from "./src/subscription/subscription";
import { isLiveSupabase } from "./src/auth/supabase";
import type { Proformat } from "./src/promos/types";
import LoginScreen from "./src/screens/LoginScreen";
import { fmtG } from "./src/format";
import { GlobalUploadTransition, uploadSuccess, uploadError } from "./src/components/UploadTransition";
import { KeyboardSafeView } from "./src/components/KeyboardSafe";
import { DarkBackButton } from "./src/components/BackButton";

export type { Role, User };

export type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean; breachedAt?: string; revokedBy?: string };



// The active store is React state (see below) — resolved from the user's
// roster in live mode, never a hardcoded uuid. Non-React code (autoSync,
// checkout) reads the mirrored value in src/storeContext.

// Yellow apricot — shift-gate banner background (text on it stays white).
const APRICOT = "#f2a63c";
// NOTE: device id is NOT a Math.random() const (RAM-only, changes every
// rebundle). It is loaded once from SecureStore (disk) into state below.

// employees <-> SQLite mapping (team roster persistence)
const empStoreId = (store?: string) => store === "Dèlma" ? STORE_IDS.delmas : store === "Petyonvil" ? STORE_IDS.petionVille : FALLBACK_STORE_ID;
const empStoreName = (sid?: string) => sid === STORE_IDS.delmas || sid === "st-delma" ? "Dèlma" : "Petyonvil";
const parseSalary = (s: any) => { const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
function empFromRow(r: any): any {
  const base = USERS.find(u => u.id === r.id);
  let emergency: { name: string; address: string; phone: string } | null = null;
  if (r.emergency_json) {
    try {
      const parsed = JSON.parse(r.emergency_json);
      if (parsed && typeof parsed === "object") {
        emergency = { name: String(parsed.name ?? ""), address: String(parsed.address ?? ""), phone: String(parsed.phone ?? "") };
      }
    } catch {}
  }
  return {
    id: r.id,
    name: r.full_name,
    role: r.role,
    phone: r.phone ?? "",
    email: (r as any).email ?? "",
    address: r.address ?? "",
    store: empStoreName(r.store_id),
    emergency,
    secret: base?.secret ?? "",
    password: "",
    lastAction: "",
    kpi: "",
    salary: `${fmtG(Number(r.salary) || 0)}`,
    isOnline: !!r.online_status,
    active: !!r.is_active,
  } as any;
}

// Identity-stable state guards: pull cycles bump `syncTick` often, and the
// roster/employees effects re-run on every tick. Re-setting the same content
// as a fresh array would retrigger every consumer's [array]-identity deps —
// including the report screens' `refresh(true)`-on-`[load]` effect (visible
// up/down RefreshControl bounce) and the employees persist effect, which
// re-queues roster outbox rows and feeds an infinite push→pull echo loop.
const sameStrArr = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const empSig = (e: any) =>
  [e?.id, e?.name, e?.role, e?.phone, e?.address, e?.store, e?.salary, e?.active, e?.isOnline, JSON.stringify(e?.emergency ?? null)].join("|");
const sameEmployees = (a: any[], b: any[]) =>
  a.length === b.length && a.every((e, i) => empSig(e) === empSig(b[i]));
const storeSig = (s: any) =>
  [s?.id, s?.name, s?.location, s?.code, s?.disabled, s?.breachFlagged].join("|");
const sameStores = (a: any[], b: any[]) =>
  a.length === b.length && a.every((s, i) => storeSig(s) === storeSig(b[i]));

// Armed once fontsLoaded (see AppShell) — never while the family is in flight.
let fontDefaultsArmed = false;

function AppShell() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // Graceful degradation (offline-safe): never block startup on fonts.
  // If the Google-fonts payload can't load, fall back to system fonts
  // after a short timeout instead of hanging on the splash forever.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontTimedOut;

  // Arm the Inter defaults exactly once — and only after useFonts actually
  // finished. Arming them on every render while the family is still in
  // flight is what trips expo-font's "You started loading the font
  // Inter_500Medium, but used it before it finished loading" warning
  // (styleless Texts — LogBox/overlays included — pick the default up),
  // and re-nesting the style array on every render grows it unboundedly.
  // fontError / timeout keep the system-font fallback promised above.
  if (fontsLoaded && !fontDefaultsArmed) {
    fontDefaultsArmed = true;
    (Text as any).defaultProps = (Text as any).defaultProps || {};
    (Text as any).defaultProps.style = [{ fontFamily: "Inter_500Medium" }, (Text as any).defaultProps.style];
    (TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
    (TextInput as any).defaultProps.style = [{ fontFamily: "Inter_400Regular" }, (TextInput as any).defaultProps.style];
  }

  const [tab, setTab] = useState<Tab>("pos");
  // Bumping remounts MoreScreen, back to the hub (the Retounen button is gone).
  const [moreKey, setMoreKey] = useState(0);
  // Tablet: which tool body is open — controlled into MoreScreen so the
  // MenuSidebar drives it (null = the body area's empty state). The phone
  // keeps MoreScreen's INTERNAL selection so re-pressing Plis still resets
  // to the hub via the moreKey remount above.
  const [moreSel, setMoreSel] = useState<MoreEntry | null>(null);
  // Tablet menu collapse — instant toggle (no width animation: the sidebar's
  // width IS useResponsive().width's sidebar term, so both must flip in the
  // same render pass), persisted in _meta (src/menu/sidebarState.ts).
  const [menuCollapsed, setMenuCollapsed] = useState(() => IS_TABLET_DEVICE && defaultMenuCollapsed());
  // Hydrate the stored collapse choice once; the smart default above covers
  // first run (wide windows start expanded, narrow ones collapsed).
  useEffect(() => {
    if (!IS_TABLET_DEVICE) return;
    let alive = true;
    loadMenuCollapsed().then(v => { if (alive) setMenuCollapsed(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Orientation is build-time only: app.json's orientation "default" bakes
  // iPhone portrait + all four iPad orientations into Info.plist (and lets
  // Android rotate). We never touch expo-screen-orientation at runtime —
  // tablets get their two-pane layouts in BOTH orientations (device class
  // lives in src/responsive.ts, rotation-independent), and phones keep the
  // portrait mask from the plist.
  const [showShift, setShowShift] = useState(false);
  // Bumped by the Shift header's Open Shift button; ShiftScreen reacts by
  // opening the supervisor's own-shift entry (or jumping to their own view).
  const [shiftSignal, setShiftSignal] = useState(0);
  // Bumped by the header's Close Shift button; ShiftScreen opens the Shift
  // Closing Summary (Review & Submit Report) — same flow for every role.
  const [shiftCloseSignal, setShiftCloseSignal] = useState(0);
  // True while this user's shift is open — the header button toggles
  // Open Shift ⇄ Close Shift accordingly. Pushed up by ShiftScreen.
  const [shiftOpen, setShiftOpen] = useState(false);
  // True while the supervisor Open Shift view takes the full device screen —
  // App chrome (header bar, tabs FAB, bottom nav) hides underneath it.
  const [shiftFull, setShiftFull] = useState(false);
  React.useEffect(() => { if (!showShift) setShiftFull(false); }, [showShift]);
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<any | null>(null);
  // Add Sale from Customers: customer to preselect in POS on tab switch.
  const [posAttachCustomer, setPosAttachCustomer] = useState<any | null>(null);
  // Proformat → POS: lines to load into the cart (frozen prices) on tab switch.
  const [posSeed, setPosSeed] = useState<{ proformat: Proformat; customerId: string | null } | null>(null);
  const auth = useAuthState();
  // Stable device id from HARD memory (SecureStore/Keychain). Survives
  // rebundles + restarts; used for suspended-sales + sync attribution.
  const [deviceId, setDeviceId] = useState<string>("device-pending");
  // --- Global store context (Apple-like Account Center) — persisted to SQLite (except users) ---
  // Live mode: the list starts empty and is filled from the user's own
  // memberships (REST, RLS-scoped) — the demo locations only exist off-live.
  const [stores, setStores] = useState<StoreItem[]>(() => isLiveSupabase ? [] : [
    { id: STORE_IDS.petionVille, name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", createdAt: new Date().toISOString() },
    { id: STORE_IDS.delmas, name: "Delmas", location: "Dèlma", code: "DL-9034", createdAt: new Date().toISOString() },
  ]);
  const [activeStoreId, setActiveStoreId] = useState<string>(STORE_IDS.petionVille);
  // Live mode blocks sync (and every tenant-scoped write path) until the
  // roster has resolved a store this user actually belongs to.
  const [storeResolved, setStoreResolved] = useState(!isLiveSupabase);
  useEffect(() => {
    (async () => {
      try {
        const { getOrCreateDeviceId } = await import("./src/device");
        setDeviceId(await getOrCreateDeviceId());
      } catch {}
    })();
  }, []);
  // Background sync — ONE loop for every screen instead of a per-screen call:
  // push this device's outbox, pull everyone else's changes, then emit
  // salesEvents so mounted lists reload themselves. Starts once we know the
  // device id, who is signed in, AND which store this device is on (in live
  // mode the roster must have resolved it — a fallback uuid would be another
  // tenant's store). Stops on sign-out or store switch.
  useEffect(() => {
    if (deviceId === "device-pending" || !auth.user) return;
    if (isLiveSupabase && !storeResolved) return;
    let cancelled = false;
    (async () => {
      try {
        const autoSync = await import("./src/sync/autoSync");
        if (cancelled) return;
        autoSync.configureSync(activeStoreId, deviceId);
        autoSync.startAutoSync();
      } catch {}
    })();
    return () => {
      cancelled = true;
      import("./src/sync/autoSync").then(m => m.stopAutoSync()).catch(() => {});
    };
  }, [auth.user?.id, deviceId, activeStoreId, storeResolved]);
  // Re-hydrate the roster / store lists whenever new rows land in SQLite — a
  // pull from another register (autoSync emits after a pull) or our own write.
  // Without this App-level data froze at boot, so a screen could never reflect
  // another device's changes.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const { salesEvents } = await import("./src/salesEvents");
        unsub = salesEvents.subscribe(() => setSyncTick(t => t + 1));
      } catch {}
    })();
    return () => { unsub?.(); };
  }, []);
  // Boot diagnostics: which storage backend is live + how many sales are on
  // disk. Check Metro logs after a rebundle — backend must stay "sqlite"
  // and salesCount must not drop. If backend flips to "memory", the
  // expo-sqlite native module failed to init (see the [db] warning above).
  useEffect(() => {
    (async () => {
      try {
        const { getDb, getDbBackend } = await import("./src/db");
        const db = await getDb();
        const sales = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
        const saleItems = ((await db.getAllAsync("SELECT * FROM sale_items")) as any[]) ?? [];
        console.log(`[db] boot check: backend=${getDbBackend()} sales=${sales.length} sale_items=${saleItems.length}`);
        // Batch drafts are device-local and expire after 14 days. Sweep them
        // before anything can show a count, then keep the daily reminder in
        // step with what's actually left.
        try {
          const { purgeExpiredBatchDrafts } = await import("./src/inventory/batchDraft");
          const { notifyDraftReminder } = await import("./src/notifications");
          await notifyDraftReminder((await purgeExpiredBatchDrafts(db)) > 0);
        } catch {}
      } catch (e) {
        console.warn("[db] boot check failed:", String(e));
      }
    })();
  }, []);
  // Derive from the persisted session (SecureStore), not a RAM-only useState
  // default — otherwise shift lookups use a stale "cashier-1" after login.
  const currentUser = auth.user ?? USERS[0];
  const currentUserId = currentUser?.id ?? USER_IDS.cashier;
  const role = currentUser.role;
  const [activeShift, setActiveShift] = useState<any | null>(null);
  // A cashier sells once their shift entry exists for today — pending
  // (awaiting manager confirmation) included: confirmation is informational,
  // never a hard stop. Only a missing/rejected entry blocks the till.
  const [shiftTodayActive, setShiftTodayActive] = useState(false);
  const [pendingShift, setPendingShift] = useState<any | null>(null);
  // True after the cashier closes (submits) their report while the shift still
  // waits for supervisor review — sales stay blocked until confirm/sign-out.
  const [awaitingReview, setAwaitingReview] = useState(false);
  // True once the shift gate finished its first DB read for this user.
  const [shiftGateLoaded, setShiftGateLoaded] = useState(false);
  // The user the gate data belongs to. On login the first render with the
  // resolved user still carries the PREVIOUS user's gate values (effects run
  // after render) — the redirect must never act on that stale window.
  const shiftGateFor = useRef<string | null>(null);
  // Any shift row (opened/closed, pending included) or report for this user
  // today — when set, the cashier is NOT force-redirected to Shift on login.
  const [hasShiftHistoryToday, setHasShiftHistoryToday] = useState(false);
  const [shiftVersion, setShiftVersion] = useState(0);

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [tabDataVersion, setTabDataVersion] = useState(0);

  // Shared-device session hygiene: whenever the signed-in IDENTITY changes,
  // drop every piece of per-user view state so nothing from the previous
  // person's session can leak into the next one (open screens, preselected
  // customers, proformat seeds, tab). Store data itself stays (role-gated).
  const lastAuthUserRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = auth.user?.id ?? null;
    if (lastAuthUserRef.current === uid) return;
    lastAuthUserRef.current = uid;
    setTab("pos");
    setMoreKey(k => k + 1);
    setMoreSel(null);
    setShowShift(false);
    setShiftFull(false);
    setSelectedCreditCustomer(null);
    setPosAttachCustomer(null);
    setPosSeed(null);
    setShowProfileMenu(false);
    setShowAccountCenter(false);
    setShowSecurity(false);
    setShowStore(false);
    setShowTeam(false);
    setShowInventory(false);
    setTabDataVersion(v => v + 1);
  }, [auth.user?.id]);

  // Subscription snapshot upkeep: refresh when the app returns to foreground
  // (renewal should lift read-only without a re-login). Throttled in the
  // subscription module; sync cycles also refresh it.
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") void refreshSubscriptionFromDb();
    });
    return () => sub.remove();
  }, []);

  // Refresh the FAB counts straight from the DB so they show whenever there
  // is something pending (any tab, even after leaving and returning): open
  // suspended sales + not-yet-paid orders.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM suspended_sales WHERE status = 'open'")) as any[];
        if (!cancelled) tabsUI.setCount((rows ?? []).length);
      } catch { if (!cancelled) tabsUI.setCount(0); }
      try {
        const { listOrders } = await import("./src/orders/store");
        const rows = await listOrders(activeStoreId);
        if (!cancelled) ordersUI.setCount(rows.length);
      } catch { if (!cancelled) ordersUI.setCount(0); }
    }
    refresh();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { cancelled = true; sub.remove(); };
  }, [tabDataVersion, activeStoreId]);

  // Business Guard: only a supervisor's confirmation ends the cashier's
  // session. Watch THIS user's report for today — when it transitions
  // submitted → closed by someone else while they are logged in, sign out.
  // A report already closed on launch is never a transition (no logout loop).
  const reportStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const uid = auth.user?.id ?? null;
    if (!uid) return;
    reportStatusRef.current = {};
    let cancelled = false;
    const check = async () => {
      try {
        const { getDb } = await import("./src/db");
        const { localDayKey } = await import("./src/businessGuard");
        const db = await getDb();
        const today = localDayKey();
        const rows = (await db.getAllAsync(
          "SELECT id, status, reviewed_by FROM daily_reports WHERE user_id = ? AND report_date = ?",
          [uid, today]
        ).catch(() => [])) as any[];
        if (cancelled || !rows?.length) return;
        for (const r of rows) {
          const prev = reportStatusRef.current[String(r.id)];
          reportStatusRef.current[String(r.id)] = String(r.status ?? "");
          if (prev === "submitted" && String(r.status) === "closed" && r.reviewed_by && String(r.reviewed_by) !== uid) {
            try {
              const { clearCartDraft } = await import("./src/sales/cartDraft");
              await clearCartDraft(await getDb(), activeStoreId, uid);
            } catch {}
            auth.signOut().catch(() => {});
            return;
          }
        }
      } catch {}
    };
    check();
    const t = setInterval(check, 10000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") setTimeout(check, 500); });
    return () => { cancelled = true; clearInterval(t); sub.remove(); };
  }, [auth.user?.id, activeStoreId]);

  // Unified Shift: open shifts + reports auto-close daily at the configured
  // low-traffic time (default 06:00 local). Two rules, one sweep every
  // register runs on boot, every 60s, and on every foreground:
  //   • a shift whose day is already settled (report submitted/closed) only
  //     needs the bookkeeping close — the review is the report, not the row;
  //   • a report-less shift closes only when its owner is INACTIVE (no
  //     presence heartbeat in 10 minutes), and only a supervisor writes the
  //     auto report — so reviewed_by keeps a rank for the next-open checks.
  // Whoever is actively on the app keeps their till; an abandoned one closes
  // at the first sweep after 06:00.
  useEffect(() => {
    const uid = auth.user?.id;
    if (!uid) return;
    let cancelled = false;
    const INACTIVE_MS = 10 * 60_000;
    const run = async () => {
      try {
        const { getDb } = await import("./src/db");
        const { shiftAutoCloseDue, reconcileShift, localDayKey } = await import("./src/businessGuard");
        const db = await getDb();
        const meta = ((await db.getAllAsync("SELECT * FROM _meta WHERE key = 'shift_autoclose_time'").catch(() => [])) ?? []) as any[];
        // Per-shift due check, never a blanket "past HH:MM" gate: a rebundle
        // re-runs this poll, and closing every open shift just because the
        // clock is past the time would lose shifts still in use (see
        // shiftAutoCloseDue). A shift only closes after its OWN first
        // post-clock-in HH:MM occurrence has passed.
        const nowDate = new Date();
        const open = ((await db.getAllAsync("SELECT * FROM shifts WHERE status = 'open'").catch(() => [])) ?? []) as any[];
        if (!open.length) return;
        const emps = ((await db.getAllAsync("SELECT id, role, updated_at, full_name FROM employees").catch(() => [])) ?? []) as any[];
        const empById = new Map(emps.map((e: any) => [String(e.id), e]));
        const isSupervisor = role === "manager" || role === "admin" || role === "owner";
        for (const s of open) {
          if (cancelled) return;
          const owner = String(s.cashier_id ?? "");
          if (!owner) continue;
          if (!shiftAutoCloseDue(s.start_time, nowDate, meta[0]?.value)) continue;
          const day = (String(s.start_time ?? "") ? localDayKey(s.start_time) : localDayKey());
          // The report that belongs to THIS shift: exact link first, then a
          // legacy day report (no shift_id) — a sibling shift's closed report
          // on a multi-shift day must never settle this one.
          const reps = ((await db.getAllAsync(
            "SELECT * FROM daily_reports WHERE shift_id = ? OR (user_id = ? AND report_date = ? AND (shift_id IS NULL OR shift_id = ''))",
            [s.id, owner, day]).catch(() => [])) ?? []) as any[];
          const linked = reps.find((r: any) => String(r.shift_id ?? "") === String(s.id))
            ?? reps.find((r: any) => r.shift_id == null || String(r.shift_id) === "");
          const ts = new Date().toISOString();
          const settled = !!linked && (linked.status === "submitted" || linked.status === "closed");
          if (settled) {
            // The person finished their side — just close the row wherever
            // this sweep runs.
            await db.runAsync("UPDATE shifts SET status = 'closed', end_time = ?, auto_closed = 1, updated_at = ? WHERE id = ? AND status = 'open'", [ts, ts, s.id]);
            continue;
          }
          // No settled report: only a supervisor closes it, and only once the
          // owner stopped beating (app closed / signed out / gone).
          if (!isSupervisor) continue;
          const emp = empById.get(owner);
          const seen = Date.parse(String(emp?.updated_at ?? ""));
          if (!isNaN(seen) && Date.now() - seen < INACTIVE_MS) continue; // still online
          const allSales = ((await db.getAllAsync("SELECT * FROM sales").catch(() => [])) ?? []) as any[];
          // Per-shift only: transactions since THIS shift started (not the
          // whole day) feed the Final Total, same as the cashier flow.
          const since = String(s.start_time ?? "");
          const inShift = (ts2: any) => String(ts2 ?? "") >= since;
          const daySales = allSales.filter((x: any) => (x.seller_id ?? null) === owner && inShift(x.created_at) && !Number(x.standby ?? 0));
          const cashSales = daySales.filter((x: any) => x.payment_method === "cash").reduce((a: number, x: any) => a + (x.total ?? 0), 0);
          const debts = ((await db.getAllAsync("SELECT * FROM credit_payments").catch(() => [])) ?? []).filter((p: any) => (p.payment_method ?? "cash") === "cash" && (p.collected_by ?? null) === owner && inShift(p.created_at));
          const debt = debts.reduce((a: number, p: any) => a + Number(p.amount ?? 0), 0);
          const cms = ((await db.getAllAsync("SELECT * FROM cash_movements").catch(() => [])) ?? []).filter((m: any) => (m.shift_id != null && m.shift_id === s.id) || ((m.taken_by ?? null) === owner && inShift(m.created_at)));
          const cashOut = cms.filter((m: any) => m.type === "withdrawal" || m.type === "inventory").reduce((a: number, m: any) => a + Number(m.amount ?? 0), 0);
          const inventoryTotal = Number(cms.filter((m: any) => m.type === "inventory").reduce((a: number, m: any) => a + Number(m.amount ?? 0), 0));
          const expected = reconcileShift({ opening: Number(s.opening_balance ?? 0), cashSales, debtCollected: debt, cashOut, standbyCarry: 0 });
          const repRole = String(emp?.role ?? (owner === uid ? role : "cashier"));
          if (!linked) {
            await db.runAsync("INSERT INTO daily_reports (id, store_id, report_date, role, user_id, shift_id, status, standby_carry, opening_balance, expected_cash, actual_cash, deficit, cash_sales, credit_collected_cash, withdrawals_total, inventory_total, submitted_at, closed_at, reviewed_by, reviewed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [reportIdForShift(String(s.id)), s.store_id ?? activeStoreId, day, repRole, owner, s.id, "closed", 0, Number(s.opening_balance ?? 0), expected, expected, 0, cashSales, debt, cashOut, inventoryTotal, ts, ts, uid, ts, ts, ts]);
          } else {
            await db.runAsync("UPDATE daily_reports SET status = ?, expected_cash = ?, actual_cash = ?, deficit = ?, shift_id = COALESCE(shift_id, ?), cash_sales = ?, credit_collected_cash = ?, withdrawals_total = ?, inventory_total = ?, submitted_at = ?, closed_at = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
              ["closed", expected, expected, 0, s.id, cashSales, debt, cashOut, inventoryTotal, ts, ts, uid, ts, ts, String(linked.id)]);
          }
          await db.runAsync("UPDATE shifts SET status = 'closed', end_time = ?, actual_cash = ?, auto_closed = 1, updated_at = ? WHERE id = ? AND status = 'open'", [ts, expected, ts, s.id]);
          try {
            const startLabel = (() => {
              try { return new Date(String(s.start_time)).toLocaleTimeString("fr-HT", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
            })();
            await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
              [mintId(), owner, "shift_auto_closed", s.id,
                `Chanjman w te louvri${startLabel ? ` a ${startLabel}` : ""} fèmen otomatik a ${String(meta[0]?.value ?? "06:00")} — paske w pa t aktif. Rapò jounen an make fèmen pou revizyon.`, "pending", ts]);
          } catch {}
          console.log(`[auto-close] shift ${s.id} of ${owner} closed at ${ts} (expected ${expected})`);
        }
      } catch (e) {
        console.warn("[auto-close] failed:", String(e));
      }
    };
    run();
    const t = setInterval(run, 60000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") setTimeout(run, 500); });
    return () => { cancelled = true; clearInterval(t); sub.remove(); };
  }, [auth.user?.id, role, activeStoreId]);

  // FAB tap from any screen: jump to POS and open its tabs sheet.
  const onTabFABOpen = useCallback(() => {
    setTab("pos");
    // give the POS tab a tick to mount, then request the sheet
    setTimeout(() => tabsUI.requestOpen(() => {}), 60);
  }, []);

  // Shared by the phone's bottom bar and the tablet sidebar's TAB rows:
  // leaving Shift/Team stacks, re-pressing Plis bumps More back to its hub.
  const onNavChange = useCallback((t: Tab) => {
    setShowShift(false);
    setShowTeam(false);
    if (t === "more" && tab === "more") setMoreKey(k => k + 1);
    setTab(t);
  }, [tab]);

  // --- Global store context — stores/activeStoreId/storeResolved are declared
  // near deviceId above (the sync + guard effects depend on them).
  const [appDisabled, setAppDisabled] = useState(false);
  const [storesHydrated, setStoresHydrated] = useState(false);
  // Business type (owner-only setting, inherited by all location stores).
  const [businessType, setBusinessTypeState] = useState<BusinessType>("retail");
  useEffect(() => {
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const { getBusinessType, ensureEmployeeStores } = await import("./src/org");
        const db = await getDb();
        setBusinessTypeState(await getBusinessType(db));
        await ensureEmployeeStores(db);
      } catch {}
    })();
  }, []);
  const changeBusinessType = async (t: BusinessType) => {
    setBusinessTypeState(t);
    try {
      const { getDb } = await import("./src/db");
      const { setBusinessType } = await import("./src/org");
      await setBusinessType(await getDb(), t);
    } catch {}
  };
  // Hydrate stores / activeStoreId / appDisabled from SQLite for persistent testing
  useEffect(() => {
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM stores")) as any[];
        if (rows.length > 0) {
          const mapped: StoreItem[] = rows
            .filter((r: any) => !r.is_deleted)
            .map((r: any) => ({
              id: r.id,
              name: r.name,
              location: r.location ?? "",
              code: r.code ?? "",
              createdAt: r.created_at ?? new Date().toISOString(),
              disabled: !!r.disabled,
              breachFlagged: !!r.breach_flagged,
              breachedAt: r.breached_at ?? undefined,
              revokedBy: r.revoked_by ?? undefined,
            }));
          if (mapped.length > 0) setStores(mapped);
          // A previous roster already landed — good enough to sync offline.
          if (isLiveSupabase && mapped.length > 0) setStoreResolved(true);
        } else if (!isLiveSupabase) {
          // first launch (demo mode only) — seed SQLite with initial stores
          const initial = [
            { id: STORE_IDS.petionVille, name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", createdAt: new Date().toISOString() },
            { id: STORE_IDS.delmas, name: "Delmas", location: "Dèlma", code: "DL-9034", createdAt: new Date().toISOString() },
          ];
          for (const s of initial) {
            await db.runAsync(
              "INSERT OR REPLACE INTO stores (id, name, location, code, currency, created_at, updated_at, disabled, breach_flagged, breached_at, revoked_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              [s.id, s.name, s.location, s.code, "HTG", s.createdAt, new Date().toISOString(), 0, 0, null, null]
            );
          }
        }
        const metaRows = (await db.getAllAsync("SELECT * FROM _meta WHERE key IN ('active_store_id','app_disabled')")) as any[];
        const active = metaRows.find((r: any) => r.key === "active_store_id")?.value;
        if (active) setActiveStoreId(active);
        const disabledVal = metaRows.find((r: any) => r.key === "app_disabled")?.value;
        if (disabledVal != null) setAppDisabled(disabledVal === "1" || disabledVal === "true");
      } catch {}
      setStoresHydrated(true);
    })();
  }, [syncTick]);
  // Persist stores on change (for testing: verify sqlite survives restart)
  useEffect(() => {
    if (!storesHydrated) return;
    // Live mode boots with an empty list until the roster lands — an empty
    // state must never wipe the previously synced stores table.
    if (isLiveSupabase && stores.length === 0) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        for (const s of stores) {
          await db.runAsync(
            "INSERT OR REPLACE INTO stores (id, name, location, code, currency, created_at, updated_at, disabled, breach_flagged, breached_at, revoked_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [s.id, s.name, s.location, s.code, "HTG", s.createdAt, new Date().toISOString(), s.disabled ? 1 : 0, s.breachFlagged ? 1 : 0, (s.breachedAt as any) ?? null, (s.revokedBy as any) ?? null]
          );
        }
        // remove deleted stores from DB (compare ids)
        const existing = (await db.getAllAsync("SELECT id FROM stores")) as any[];
        const currentIds = new Set(stores.map(s => s.id));
        for (const row of existing) {
          if (!currentIds.has(row.id)) await db.runAsync("DELETE FROM stores WHERE id = ?", [row.id]);
        }
      } catch {}
    })();
  }, [stores, storesHydrated]);
  useEffect(() => {
    if (!storesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["active_store_id", activeStoreId]);
      } catch {}
    })();
  }, [activeStoreId, storesHydrated]);
  useEffect(() => {
    if (!storesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["app_disabled", appDisabled ? "1" : "0"]);
      } catch {}
    })();
  }, [appDisabled, storesHydrated]);
  // Demo seed roster — MOCK devices only. A live device's roster comes from
  // the pulled profiles; seeding six demo people here painted "old staff"
  // onto real teams and showed one person twice once their real row arrived.
  const [employees, setEmployees] = useState<Employee[]>(() =>
    isLiveSupabase ? [] : USERS.map(u => ({
      ...u,
      store: u.store ?? "Petyonvil",
      lastAction: u.role === "cashier" ? "Vente #VTE-1021 • il y a 12 min" : u.role === "manager" ? "Ajustement stock • il y a 1 h" : "Clôture caisse • hier",
      kpi: u.role === "cashier" ? "22 ventes • G 1 540/panier" : "18 tâches • 98% précision",
      salary: u.role === "owner" ? "G 45 000" : u.role === "admin" ? "G 32 000" : u.role === "manager" ? "G 25 000" : "G 12 000",
      address: u.id === USER_IDS.owner ? "Pétion-Ville, Rue Panaméricaine 12" : u.id === USER_IDS.admin ? "Delmas 33, Impasse Lafleur" : u.id === USER_IDS.manager ? "Carrefour, Bizoton 45" : "Kenscoff, Route de Furcy",
      isOnline: u.role === "owner" || u.role === "admin" ? true : Math.random() > 0.4,
      emergency: u.id === USER_IDS.owner ? { name: "Marie Owner", address: "Pétion-Ville, Rue Clerveaux 8", phone: "+509 3100 0001" } : u.id === USER_IDS.admin ? { name: "Jean Admin", address: "Delmas 31, Rue Tirlemont", phone: "+509 3100 0002" } : u.id === USER_IDS.manager ? { name: "Sophie Manager", address: "Carrefour, Mahotière 12", phone: "+509 3100 0003" } : { name: "Luc Cashier", address: "Pétion-Ville, Laboule 10", phone: "+509 3100 0004" },
      active: true,
      password: `${u.id}-pass`,
    }) as any)
  );
  const [employeesHydrated, setEmployeesHydrated] = useState(false);
  // Store locations this user works in (employee<->store relationship).
  const [userStoreIds, setUserStoreIds] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const { loadUserStoreIds } = await import("./src/org");
        const next = await loadUserStoreIds(await getDb(), currentUser);
        // Same-content pulls must keep array identity: a fresh array here
        // invalidates report-screen `load` callbacks and re-fires their
        // cloud refresh (visible RefreshControl bounce).
        setUserStoreIds(prev => (sameStrArr(prev, next) ? prev : next));
      } catch {}
    })();
  }, [currentUser?.id, syncTick]);
  // Live mode: resolve which stores this user may touch from their own
  // memberships (REST, RLS-scoped) — the device never trusts a hardcoded
  // location. Re-runs after each pull so a roster change lands eventually.
  useEffect(() => {
    if (!auth.user || !isLiveSupabase) return;
    let cancelled = false;
    (async () => {
      try {
        const { fetchRoster, applyRosterToDb } = await import("./src/auth/roster");
        const roster = await fetchRoster();
        if (cancelled || !roster) return;
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const meta = ((await db.getAllAsync("SELECT value FROM _meta WHERE key = 'active_store_id'").catch(() => [])) ?? []) as any[];
        const preferred = meta[0]?.value ?? null;
        const chosen = await applyRosterToDb(roster, preferred);
        if (cancelled || !chosen) return;
        setActiveStoreId(chosen);
        // Identity-stable: same roster content must not churn downstream
        // [userStoreIds]/[stores] deps (report bounce + persist re-runs).
        setUserStoreIds(prev => (sameStrArr(prev, roster.storeIds) ? prev : roster.storeIds));
        // Refresh the visible store list from the roster (names/codes included).
        setStores(prev => {
          const next = roster.stores.map(s => ({
            id: s.id,
            name: s.name,
            location: s.location ?? "",
            code: s.code ?? "",
            createdAt: s.created_at ?? new Date().toISOString(),
            disabled: !!s.disabled,
            breachFlagged: !!s.breach_flagged,
            breachedAt: s.breached_at ?? undefined,
            revokedBy: s.revoked_by ?? undefined,
          }));
          return sameStores(prev, next) ? prev : next;
        });
        setStoreResolved(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [auth.user?.id, syncTick]);
  // Mirror the active store for non-React consumers (autoSync, checkout).
  useEffect(() => {
    import("./src/storeContext").then(m => m.setActiveStoreId(activeStoreId)).catch(() => {});
  }, [activeStoreId]);
  // Hydrate the team roster from SQLite (persistent across restarts); seed once if empty
  useEffect(() => {
    if (!storesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        // Roster list salary is a display cache; salary_history is the truth.
        // Heal before reading so a device that pulled salary rows (or was
        // edited elsewhere) never renders a stale/zero salary in the list.
        try {
          const { healSalaryCaches } = await import("./src/payroll");
          await healSalaryCaches(db);
        } catch {}
        // Live device: drop the demo seed roster older builds left behind —
        // local-only ids can never be real accounts, and the leftovers read
        // as stale duplicates of the pulled team. Queued pushes of those ids
        // die with them instead of aging out into a sync banner.
        if (isLiveSupabase) {
          const demoIds = Object.values(USER_IDS) as string[];
          const marks = demoIds.map(() => "?").join(",");
          await db.runAsync(`DELETE FROM employees WHERE id IN (${marks})`, demoIds).catch(() => {});
          await db.runAsync(`DELETE FROM employee_stores WHERE employee_id IN (${marks})`, demoIds).catch(() => {});
          for (const id of demoIds) {
            await db.runAsync("DELETE FROM outbox WHERE payload LIKE ?", [`%${id}%`]).catch(() => {});
          }
        }
        const rows = (await db.getAllAsync("SELECT * FROM employees WHERE is_deleted=0 OR is_deleted IS NULL")) as any[];
        if (rows.length > 0) {
          // Identity-stable: this effect re-runs on every syncTick, and a
          // fresh employees array re-fires the persist effect below, which
          // re-queues roster outbox rows — an infinite push→pull echo.
          const next = rows.map(empFromRow);
          setEmployees(prev => (sameEmployees(prev, next) ? prev : next));
        } else if (!isLiveSupabase) {
        for (const e of employees) {
          await db.runAsync(
            "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, phone, email, salary, address, emergency_json, is_active, online_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [e.id, empStoreId(e.store), e.name, e.role, e.phone ?? "", (e as any).email ?? null, parseSalary(e.salary), e.address ?? "", e.emergency ? JSON.stringify(e.emergency) : null, e.active ? 1 : 0, e.isOnline ? 1 : 0, new Date().toISOString(), new Date().toISOString()]
          );
          try {
            await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [e.id, empStoreId(e.store)]);
          } catch {}
        }
        }
      } catch {}
      setEmployeesHydrated(true);
    })();
  }, [storesHydrated, syncTick]);
  // Persist any roster change (add / edit / toggle) so it survives app restarts
  useEffect(() => {
    if (!employeesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        // Owner/admin roster edits travel to the cloud (pair-keyed upsert on
        // the server): membership rows + the profile name/role/email. Only
        // uuid ids go up (local demo ids stay local). Rows for login-less
        // staff can't satisfy the server FK/NOT NULLs — they fail, age out
        // after MAX_PUSH_ATTEMPTS, and surface once as a human banner.
        const canRosterPush = role === "owner" || role === "admin";
        const isUuid = (x: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x ?? ""));
        // Outbox dedupe: this effect re-runs on every employees change, and
        // re-queueing identical rows each time floods the 100-row push window.
        const queuedIds = new Set<string>();
        try {
          const ob = ((await db.getAllAsync("SELECT table_name, payload FROM outbox").catch(() => [])) ?? []) as any[];
          for (const o of ob) {
            try {
              const pid = String(JSON.parse(String(o?.payload ?? "{}"))?.id ?? "");
              if (pid) queuedIds.add(`${o.table_name}:${pid}`);
            } catch {}
          }
        } catch {}
        for (const e of employees) {
          await db.runAsync(
            "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, phone, email, salary, address, emergency_json, is_active, online_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [e.id, empStoreId(e.store), e.name, e.role, e.phone ?? "", (e as any).email ?? null, parseSalary(e.salary), e.address ?? "", e.emergency ? JSON.stringify(e.emergency) : null, e.active ? 1 : 0, e.isOnline ? 1 : 0, new Date().toISOString(), new Date().toISOString()]
          );
          try {
            await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [e.id, empStoreId(e.store)]);
          } catch {}
          // Memberships: owner/admin mint them (the server rejects anyone
          // else). Profiles: owner/admin push anyone's; every role may push
          // its OWN row (server "self" scope) so staff self-edits — name and
          // emergency contact — reach the cloud like any other data.
          const canPushProfile = canRosterPush || e.id === currentUser?.id;
          if (canRosterPush && isUuid(e.id)) {
            const sid = empStoreId(e.store);
            if (isUuid(sid)) {
              const smId = deriveId("sm", e.id, sid);
              if (!queuedIds.has(`store_members:${smId}`)) {
                try {
                  const { insertOutbox } = await import("./src/db");
                  await insertOutbox("store_members", "update", {
                    id: smId, store_id: sid, user_id: e.id,
                    role: e.role, created_at: new Date().toISOString(),
                  }, db);
                  queuedIds.add(`store_members:${smId}`);
                } catch {}
              }
            }
          }
          if (canPushProfile && isUuid(e.id)) {
              if (!queuedIds.has(`profiles:${e.id}`)) {
                try {
                  const { insertOutbox } = await import("./src/db");
                  await insertOutbox("profiles", "update", {
                    id: e.id, full_name: e.name, role: e.role,
                    ...((e as any).email ? { email: (e as any).email } : {}),
                    // Emergency contact syncs with the profile row (027).
                    // Explicit nulls: clearing the section must clear the cloud.
                    emergency_name: e.emergency?.name ?? null,
                    emergency_phone: e.emergency?.phone ?? null,
                    emergency_address: e.emergency?.address ?? null,
                    updated_at: new Date().toISOString(), is_deleted: 0,
                  }, db);
                  queuedIds.add(`profiles:${e.id}`);
                } catch {}
              }
          }
        }
        const existing = (await db.getAllAsync("SELECT id FROM employees")) as any[];
        const ids = new Set(employees.map(e => e.id));
        for (const r of existing) {
          if (!ids.has(r.id)) await db.runAsync("DELETE FROM employees WHERE id = ?", [r.id]);
        }
      } catch {}
    })();
  }, [employees, employeesHydrated]);
  const [showAccountCenter, setShowAccountCenter] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const activeStore = stores.find(s => s.id === activeStoreId) ?? stores[0];
  const storeBlocked = !!activeStore?.disabled;

  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpRole, setNewEmpRole] = useState("cashier");
  const [newEmpSalary, setNewEmpSalary] = useState("12000");
  const [newEmpEmail, setNewEmpEmail] = useState("");
  const [newEmpAddress, setNewEmpAddress] = useState("");
  const [newEmpEmergName, setNewEmpEmergName] = useState("");
  const [newEmpEmergAddress, setNewEmpEmergAddress] = useState("");
  const [newEmpError, setNewEmpError] = useState("");
  const [editingEmp, setEditingEmp] = useState<any | null>(null);
  const [editEmpRole, setEditEmpRole] = useState("cashier");
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [selfEditEmp, setSelfEditEmp] = useState<any | null>(null);
  const [selfSecret, setSelfSecret] = useState("");
  const [selfPassword, setSelfPassword] = useState("");
  const [showAddEmp, setShowAddEmp] = useState(false);

  const canManageEmployees = role === "admin" || role === "owner";
  const cashiers = employees.filter(e => e.role === "cashier").map(e => ({ id: e.id, name: e.name, store: e.store ?? (activeStore ? activeStore.location : undefined) }));
  const HIER: Record<string, number> = { owner: 4, admin: 3, manager: 2, cashier: 1, associate: 1, cook: 1 };
  const canAddRole = (targetRole: string) => {
    if (targetRole === "owner") return false;
    if (!HIER[role] || !HIER[targetRole]) return false;
    if (HIER[role] <= HIER[targetRole]) return false;
    return role === "owner" || role === "admin";
  };
  const canEditRoleFor = (target: any, newRole: string) => {
    if (target.role === "owner") return false;
    if (newRole === "owner") return false;
    if (target.id === currentUser?.id) return false;
    if (HIER[role] <= HIER[target.role]) return false;
    if (HIER[role] <= HIER[newRole]) return false;
    return true;
  };
  const canAffect = (target: any) => HIER[role] > HIER[target.role];
  const canToggle = (target: any) => target.role !== "owner" && target.id !== currentUser?.id && canAffect(target);
  const canResetOther = (target: any) => {
    if (target.id === currentUser?.id) return false;
    if (target.role === "owner") return false;
    return canAffect(target);
  };
  const canChangeSelf = (target: any) => target.id === currentUser?.id;
  // Salary changes (028): owner/admin only, strict superior, never self, and
  // never an owner target — inactive employees are blocked too.
  const canEditSalary = (target: any) => (role === "owner" || role === "admin") && canAffect(target) && !!target?.active;
  const addRoleOptions = role === "owner"
    ? ["admin", "manager", "cashier", "associate", ...(businessType === "retail" ? [] : ["cook"])]
    : role === "admin"
      ? ["manager", "cashier", "associate", ...(businessType === "retail" ? [] : ["cook"])]
      : [];

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (showInventory) { setShowInventory(false); return true; }
      if (showSecurity) { setShowSecurity(false); return true; }
      if (showAccountCenter) { setShowAccountCenter(false); return true; }
      if (showStore) { setShowStore(false); return true; }
      if (showTeam) { setShowTeam(false); return true; }
      if (showShift) { setShowShift(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [showSecurity, showAccountCenter, showStore, showTeam, showShift, showInventory]);

  // Luxury entrance animation — Apple-like
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslate = useRef(new Animated.Value(-8)).current;
  useEffect(() => {
    if (fontsReady) {
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(headerTranslate, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [fontsReady]);

  // Profile menu spring
  const profileScale = useRef(new Animated.Value(0.96)).current;
  const profileOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showProfileMenu) {
      Animated.parallel([
        Animated.spring(profileScale, { toValue: 1, tension: 260, friction: 18, useNativeDriver: true }),
        Animated.timing(profileOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      profileScale.setValue(0.96);
      profileOpacity.setValue(0);
    }
  }, [showProfileMenu]);

  // Shift gate for the cashier's till. Polls every 10s so a manager confirming
  // a pending opening on another device unlocks the till here without a restart.
  // The redirect decision below may ONLY run on a successful read: a failed
  // query must never look like "no shift exists". On failure previous states
  // are kept and loaded stays false so the next poll retries.
  const refreshShifts = useCallback(async () => {
    setShiftGateLoaded(false);
    try {
      const { getDb } = await import("./src/db");
      const { inLocalDay, localDayKey } = await import("./src/businessGuard");
      const db = await getDb();
      const shifts = (await db.getAllAsync("SELECT * FROM shifts ORDER BY start_time DESC LIMIT 50")) as any[];
      const active = shifts.find((s: any) => s.status === "open" && s.cashier_id === currentUserId) || shifts.find((s: any) => s.status === "open") || null;
      setActiveShift(active);
      setPendingShift(shifts.find((s: any) => s.status === "pending" && s.cashier_id === currentUserId) || null);
      const day = localDayKey();
      // Overnight-proof: an open/pending shift counts whatever day it started
      // on — midnight must not kill it (bars/restaurants work past it).
      const liveShift = (s: any) => (s.cashier_id ?? null) === (currentUserId ?? null)
        && (s.status === "pending" || s.status === "open");
      setShiftTodayActive(shifts.some(liveShift));
      // Awaiting review = this user submitted today's report and it hasn't
      // been closed by a supervisor yet. Sales stay blocked in this window.
      // Any report row today also means the shift was already opened before
      // (or is done) — no force-redirect to Shift on login.
      // Pure existence check: any shift row (open/pending/closed — rejected
      // excluded) or any report row. Confirmation flags are never consulted.
      // A failed read anywhere here keeps the gate unloaded (never looks like
      // an empty day) and the next poll retries.
      const reps = (await db.getAllAsync(
        "SELECT status FROM daily_reports WHERE user_id = ? AND report_date = ?",
        [currentUserId, day]
      )) as any[];
      setAwaitingReview((reps ?? []).some((r: any) => String(r.status ?? "") === "submitted"));
      const hadShift = shifts.some((s: any) => (s.cashier_id ?? null) === (currentUserId ?? null)
        && ((s.status === "open" || s.status === "pending")
          || (String(s.status ?? "") === "closed"
            && (inLocalDay(s.start_time, day) || (s.end_time ? inLocalDay(s.end_time, day) : false)))));
      setHasShiftHistoryToday(hadShift || (reps ?? []).length > 0);
      shiftGateFor.current = currentUserId;
      setShiftGateLoaded(true);
    } catch { /* keep previous states; next poll retries */ }
  }, [currentUserId]);

  React.useEffect(() => {
    refreshShifts();
    const t = setInterval(refreshShifts, 10000);
    return () => clearInterval(t);
  }, [refreshShifts, tab, showShift, shiftVersion]);

  // Fresh mount only (cold start or Fast Refresh remount): never inherit a
  // stuck-open Shift overlay over checkout. Deliberate opens happen via taps;
  // the login auto-land below re-opens it when truly needed (no shift yet).
  React.useEffect(() => { setShowShift(false); }, []);

  // Cashiers land in Shift only when they have nothing for today yet — no
  // open/pending shift and no opened-or-closed shift/report. An open shift,
  // a pending approval, or a submitted/closed report means no redirect.
  // Checkout stays gated behind an opened shift (canSell). One decision per
  // login so a manual ← Retounen still lets them leave without being forced.
  // Decides only for the resolved login — the pre-login fallback user must
  // never trigger the redirect (its empty history would wrongly open Shift
  // and the overlay would stay stuck open after login resolves).
  const shiftAutoLandedFor = useRef<string | null>(null);
  const loginUserId = auth.user?.id ?? null;
  // Deliberate opens (taps) are sacred: only a stale, non-deliberate overlay
  // may ever be closed automatically (login decision below).
  const userOpenedShift = useRef(false);
  // The three overlay screens are mutually exclusive: the content area renders
  // them by fixed priority (Store → Team → Shift), so opening one MUST clear
  // the others or the tap looks dead (Team stayed on screen when Shift was
  // opened from it — you had to navigate elsewhere first).
  const openShiftDeliberate = useCallback(() => {
    userOpenedShift.current = true;
    setShowStore(false);
    setShowTeam(false);
    setShowShift(true);
  }, []);
  const openTeam = useCallback(() => { setShowStore(false); setShowShift(false); setShowTeam(true); }, []);
  const openStore = useCallback(() => { setShowShift(false); setShowTeam(false); setShowStore(true); }, []);
  React.useEffect(() => {
    if (!loginUserId) { shiftAutoLandedFor.current = null; userOpenedShift.current = false; return; }
    if (role !== "cashier") { shiftAutoLandedFor.current = null; return; }
    if (!currentUserId || !shiftGateLoaded || shiftGateFor.current !== currentUserId || shiftAutoLandedFor.current === currentUserId) return;
    shiftAutoLandedFor.current = currentUserId;
    if (!hasShiftHistoryToday) setShowShift(true);
    // Stale overlay (e.g. state preserved across a Fast Refresh) with a shift
    // on record: take it off checkout — but never a deliberate open.
    else if (showShift && !userOpenedShift.current) setShowShift(false);
  }, [role, currentUserId, loginUserId, shiftGateLoaded, hasShiftHistoryToday, showShift]);

  // Landing tab after login, per role — one auto-land per login so manual
  // navigation still sticks afterwards. Owner/admin/manager start on Kay,
  // cashiers on checkout/Vant (the Shift overlay still takes over on top when
  // they have no shift yet), associates on Kòmand (no shift needed).
  const roleLandedFor = useRef<string | null>(null);
  React.useEffect(() => {
    if (!loginUserId) { roleLandedFor.current = null; return; }
    if (!currentUserId || roleLandedFor.current === currentUserId) return;
    roleLandedFor.current = currentUserId;
    if (role === "associate") {
      setShowShift(false);
      setTab("orders");
    } else if (role === "cashier") {
      setTab("pos");
    } else if (role === "owner" || role === "admin" || role === "manager") {
      setTab("home");
    }
  }, [role, currentUserId, loginUserId]);

  // --- Notification deep-link (src/notifRoute.ts) ---
  // A tapped notification names the record that triggered it. Peel off any
  // overlay stacked on top, switch to the screen that record lives on, then
  // hand the route to notifUI — which parks it until that screen mounts (or
  // hands it straight over if it's already on screen).
  const applyNotifRoute = useCallback((r: NotifRoute) => {
    setShowAccountCenter(false);
    setShowSecurity(false);
    setShowStore(false);
    setShowTeam(false);
    setShowInventory(false);
    if (r.screen === "order") { setShowShift(false); setTab("orders"); }
    else if (r.screen === "sale") { setShowShift(false); setTab("transactions"); }
    else openShiftDeliberate();
    notifUI.request(r);
  }, [openShiftDeliberate]);

  // A cold-start tap lands while the session is still hydrating. Applying it
  // there would be pointless: the per-role landing effect above owns the tab
  // until auth settles. Hold the route instead of racing it.
  const authStatusRef = useRef(auth.status);
  authStatusRef.current = auth.status;
  const pendingNotifRoute = useRef<NotifRoute | null>(null);
  const onNotifRoute = useCallback((r: NotifRoute) => {
    if (authStatusRef.current !== "signedin") { pendingNotifRoute.current = r; return; }
    applyNotifRoute(r);
  }, [applyNotifRoute]);
  useEffect(() => initNotifRouting(onNotifRoute), [onNotifRoute]);
  // Declared after the role-landing effect on purpose: in the commit that
  // resolves auth both run, and this one goes last — so the route's tab wins.
  useEffect(() => {
    if (auth.status !== "signedin") return;
    const r = pendingNotifRoute.current;
    if (!r) return;
    pendingNotifRoute.current = null;
    applyNotifRoute(r);
  }, [auth.status, applyNotifRoute]);

  const isCashierRole = role === "cashier";
  // Nav per role — owner/admin/manager/cashier get Kay, Vant, Tranzaksyon,
  // Plis. Kliyan + Kòmand live in Plis (and associates keep them as tabs).
  // Kitchen devices never see the board.
  // Associates work the floor: Kliyan + Kòmand + Plis (Katalòg / Logout live
  // in Plis) — no checkout, no reports. One definition for both navs now
  // (src/components/BottomNav.tsx) — the tablet sidebar reuses it for row
  // gating so the rail and the menu can't disagree about access.
  const visibleTabs: Tab[] = visibleTabsFor(role);
  const canManageStore = role === "admin" || role === "owner";

  // ── MenuSidebar wiring (tablet only) ─────────────────────────────────────
  // Collapse toggle — persist inside the updater so the flip never races a
  // save of the previous value (fire-and-forget write, like everywhere else).
  const toggleMenu = useCallback(() => {
    setMenuCollapsed(v => {
      const next = !v;
      saveMenuCollapsed(next);
      return next;
    });
  }, []);
  // Tool row → that body inside MoreScreen. Overlays that mask the tab area
  // close first (Store too: the rail stays visible above it, so a tap here
  // must actually change what's on screen).
  const onMenuTool = useCallback((id: MoreEntry) => {
    setShowStore(false);
    setShowShift(false);
    setShowTeam(false);
    setMoreSel(id);
    setTab("more");
  }, []);
  // Tab row (Dashboard / Vant / Tranzaksyon / Kliyan / Kòmand) — same
  // semantics as the phone nav, plus unmasking Store.
  const onMenuTab = useCallback((t: Tab) => {
    setShowStore(false);
    onNavChange(t);
  }, [onNavChange]);
  // One logout flow for the Plis list and the sidebar footer.
  const logoutFlow = async () => {
    try {
      const { getDb } = await import("./src/db");
      const { clearCartDraft } = await import("./src/sales/cartDraft");
      await clearCartDraft(await getDb(), activeStoreId, currentUser?.id ?? null);
    } catch {}
    auth.signOut();
  };

  // Selling is hard-gated behind an open shift for every role. A pending
  // (unconfirmed) opening still unlocks selling — only a missing shift blocks.
  // After close (report submitted, awaiting review) sales stay blocked.
  // Subscription read-only (expired/paused) is the third gate: reads stay up,
  // new sales are blocked locally (and refused server-side).
  const subscriptionWritable = useWritable();
  const canSell = shiftTodayActive && !awaitingReview && subscriptionWritable;

  const screenTitle = showInventory
    ? "Nouvo Livrezon"
    : showSecurity
      ? "Konsole Sipò"
    : showAccountCenter
        ? "Kourro"
    : showStore
      ? "Magazen"
    : showTeam
      ? "Ekip"
    : showShift
      ? ht.shiftReport
      : tab === "home"
        ? ht.home
        : tab === "pos"
          ? ht.sale
          : tab === "orders"
            ? "Kòmand"
          : tab === "transactions"
            ? ht.transactions
            : tab === "more"
              ? "Plis"
              : ht.home;

  // Sync auth banner — when middleware rejects our token (401/403) the loop
  // keeps retrying in the background; this surfaces it so a register isn't a
  // silent empty catalog. autoSync clears it on the next successful cycle.
  const [syncAuthError, setSyncAuthError] = useState<string | null>(null);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const autoSync = await import("./src/sync/autoSync");
        unsub = autoSync.onSyncAuthError(setSyncAuthError);
      } catch {}
    })();
    return () => { unsub?.(); };
  }, []);

  if (!fontsReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {/* Current brand: the wordmark — same asset as the login hero (the
            old square badge read as a stale logo on the very first screen). */}
        <Image source={require("./assets/kourro-wordmark.png")} style={{ width: 180, height: 47, resizeMode: "contain" }} />
        {/* System font (fontWeight, no Inter family) — these render BEFORE
            useFonts finishes, so requesting Inter here would be the very
            "used it before it finished loading" case the warning describes. */}
        <Text style={{ fontWeight: "400", fontSize: 11, color: palette.muted2, marginTop: 14 }}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  if (auth.status === "signedout") {
    return <LoginScreen onAuthed={() => {}} />;
  }

  if (auth.status === "loading") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <Image source={require("./assets/kourro-wordmark.png")} style={{ width: 180, height: 47, resizeMode: "contain" }} />
        <Text style={{ fontWeight: "400", fontSize: 11, color: palette.muted2, marginTop: 14 }}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  return (
    // SafeAreaProvider wraps the whole app (App → AppShell) so insets are
    // available everywhere, including inside native Modals: useSafeAreaInsets()
    // and SafeScreen read React context, which flows through a Modal, whereas
    // react-native-safe-area-context's native SafeAreaView walks the Modal's
    // *native* superview chain, finds no provider there and pads zero.
    // SidebarWidthProvider rides the same way: it carries the menu's current
    // width so every useResponsive() consumer reflows the instant the menu
    // toggles (context flows through Modals too).
    <SidebarWidthProvider value={menuCollapsed ? SIDEBAR_RAIL : MENU_W_EXPANDED}>
    {/* Auth banner spans the full width above both layouts (tablet row and
        phone column) so it's visible on every device. */}
    <SyncErrorBanner message={syncAuthError} onSignOut={() => { auth.signOut().catch(() => {}); }} />
    {/* Subscription read-only lock: persistent while the org's plan is
        expired/paused/unknown. Reads keep working; writes are gated. */}
    <SubscriptionBanner />
    {/* Human-language sync alert (amber): push rejects / pull failures in
        plain words, auto-hides 30s after each new alert. */}
    <SyncIssueBanner />
    {/* First-download banner: a new device starts empty — say data is coming */}
    <InitialDownloadBanner />
    <View style={{ flex: 1, backgroundColor: "#000", flexDirection: IS_TABLET_DEVICE ? "row" : "column" }}>
      {/* Tablets navigate from the permanent menu in the left rail; the bottom
          bar never renders. */}
      {IS_TABLET_DEVICE && !shiftFull && (
        <MenuSidebar
          role={role}
          currentUserId={currentUserId}
          userName={currentUser.name}
          storeName={activeStore?.name ?? "Pétion-Ville"}
          businessType={businessType}
          inventoryVersion={inventoryVersion}
          activeTab={tab}
          moreSelection={moreSel}
          collapsed={menuCollapsed}
          onToggle={toggleMenu}
          onTab={onMenuTab}
          onTool={onMenuTool}
          onPosOpen={onTabFABOpen}
          onOpenStore={openStore}
          onOpenTeam={openTeam}
          onOpenShift={() => openShiftDeliberate()}
          openOverlay={showTeam ? "team" : showShift ? "shift" : null}
          onLogout={logoutFlow}
        />
      )}
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      {/* Cashier shift gate — the Shift screen owns the whole lifecycle now */}
      {isCashierRole && !shiftTodayActive && tab === "pos" && (
        // Shift gate banner — flat yellow apricot block, white text, no
        // accent color and no tinted background.
        <View style={{ backgroundColor: APRICOT, borderBottomWidth: 0.5, borderColor: "rgba(0,0,0,0.25)", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed-outline" size={16} color={APRICOT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontSize: 12, letterSpacing: -0.1 }}>Chanjman fèmen — Vant bloke</Text>
            <Text style={{ fontFamily: "Inter_400Regular", color: "#fff", fontSize: 11, marginTop: 1 }}>Ou dwe kòmanse chanjman anvan ou ka vann.</Text>
          </View>
          <Pressable onPress={() => { openShiftDeliberate(); setShiftSignal(v => v + 1); }} hitSlop={8}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>Shift →</Text>
          </Pressable>
        </View>
      )}
      {isCashierRole && pendingShift && !activeShift && tab === "pos" && (
        <View style={{ backgroundColor: "rgba(34,211,238,0.07)", borderBottomWidth: 0.5, borderColor: "rgba(34,211,238,0.25)", padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(34,211,238,0.15)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="information-circle-outline" size={15} color="#22d3ee" />
          </View>
          <Text style={{ flex: 1, fontFamily: "Inter_400Regular", color: "#a5f3fc", fontSize: 11, lineHeight: 16 }}>
            Shift ou an kours — {fmtG(Number(pendingShift.opening_stated ?? 0))} an atant konfimasyon {getUserById(pendingShift.manager_id)?.name ?? "manadjè a"}. Sa pa bloke vant ou.
          </Text>
          <Pressable onPress={() => { openShiftDeliberate(); setShiftSignal(v => v + 1); }} hitSlop={8}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#22d3ee" }}>Shift →</Text>
          </Pressable>
        </View>
      )}

      <Modal transparent visible={showProfileMenu} animationType="fade" onRequestClose={() => setShowProfileMenu(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(10,10,11,0.20)" }} onPress={() => setShowProfileMenu(false)}>
          <Animated.View style={{
            position: "absolute", top: 72, right: 16, width: 292,
            backgroundColor: palette.surface,
            borderRadius: radius.lg, padding: 18,
            borderWidth: 0.5, borderColor: palette.hairlineStrong,
            opacity: profileOpacity,
            transform: [{ scale: profileScale }],
            ...shadow.elevated,
          }}>
            {/* Profile header */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: palette.separator }}>
              <View style={{ position: "relative" }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#1c1c1e", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: palette.accentGold, shadowColor: palette.accentGold, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
                  <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontSize: 19, letterSpacing: 0.5 }}>{currentUser.name.split(" ").map(part => part[0]).slice(0, 2).join("").toUpperCase()}</Text>
                </View>
                <View style={{ position: "absolute", right: 1, bottom: 1, width: 13, height: 13, borderRadius: 7, backgroundColor: palette.successDot, borderWidth: 2.5, borderColor: palette.surface }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: palette.ink, letterSpacing: -0.3 }} numberOfLines={1}>{currentUser.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 }}>
                  <View style={{ height: 19, borderRadius: 9, paddingHorizontal: 7, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)" }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 8, color: palette.accentGold, letterSpacing: 0.8, textTransform: "uppercase" }}>{currentUser.role}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Action rows — Apple settings list */}
            <View style={{ marginTop: 14, backgroundColor: palette.surface2, borderRadius: radius.md, overflow: "hidden", borderWidth: 0.5, borderColor: palette.hairline }}>
              {isCashierRole && activeShift && !awaitingReview && (
                <Pressable
                  onPress={() => { setShowProfileMenu(false); openShiftDeliberate(); setShiftCloseSignal(v => v + 1); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: palette.separator }}
                >
                  <Ionicons name={activeShift ? "checkmark-circle" : "time-outline"} size={20} color={activeShift ? palette.success : palette.muted2} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }}>Fin Travay</Text>
                  </View>
                  <Text style={{ color: palette.muted3, fontSize: 16, fontWeight: "500" }}>›</Text>
                </Pressable>
              )}
              {role === "owner" && (
                <Pressable
                  onPress={() => { setShowProfileMenu(false); setShowAccountCenter(true); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: palette.separator }}
                >
                  <Ionicons name="business-outline" size={20} color={palette.accentGold} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }}>Kourro</Text>
                  </View>
                  <Text style={{ color: palette.muted3, fontSize: 16, fontWeight: "500" }}>›</Text>
                </Pressable>
              )}
            </View>

            {/* Log out — Apple logout style */}
            <Pressable onPress={async () => {
              setShowProfileMenu(false);
              try {
                const { getDb } = await import("./src/db");
                const { clearCartDraft } = await import("./src/sales/cartDraft");
                await clearCartDraft(await getDb(), activeStoreId, currentUser?.id ?? null);
              } catch {}
              auth.signOut();
            }} style={{ marginTop: 14, backgroundColor: palette.dangerBg, borderRadius: radius.md, paddingVertical: 14, alignItems: "center", borderWidth: 0.5, borderColor: palette.dangerBd }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Ionicons name="log-out-outline" size={17} color={palette.danger} />
                <Text style={{ fontFamily: "Inter_700Bold", color: palette.danger, letterSpacing: 0.2, fontSize: 13 }}>Log out</Text>
              </View>
            </Pressable>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted3, textAlign: "center", marginTop: 10 }}>Tap deyò pou fèmen</Text>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Root keyboard lift: iOS only — Android rides softwareKeyboardLayoutMode
          "pan" (window-level, also covers Modal windows). iOS Modals are separate
          windows and carry their own KeyboardSafeView inside. Nested KAVs below
          are overlap-based, so screens with their own KAV never double-lift. */}
      <KeyboardSafeView enabled={Platform.OS === "ios"}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {showAccountCenter ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <DarkBackButton onPress={() => setShowAccountCenter(false)} />
              <View style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: 4, backgroundColor: palette.successDot }} />
            </View>
            <AccountCenter
              role={role}
              stores={stores}
              setStores={setStores}
              activeStoreId={activeStoreId}
              setActiveStoreId={setActiveStoreId}
              appDisabled={appDisabled}
              setAppDisabled={setAppDisabled}
              businessType={businessType}
              onBusinessTypeChange={changeBusinessType}
              onClose={() => setShowAccountCenter(false)}
            />
          </View>
        ) : showSecurity ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <DarkBackButton onPress={() => setShowSecurity(false)} />
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>Konsole Sipò</Text>
              <View style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: 4, backgroundColor: palette.warningDot }} />
            </View>
            <SecurityCenter
              stores={stores}
              setStores={setStores}
              activeStoreId={activeStoreId}
              setActiveStoreId={setActiveStoreId}
              onClose={() => setShowSecurity(false)}
            />
          </View>
        ) : showStore ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <DarkBackButton onPress={() => setShowStore(false)} />
            </View>
            <StoreScreen
              role={role}
              activeStore={activeStore}
              storeId={activeStoreId}
              storeCount={stores?.length ?? 0}
              appDisabled={appDisabled}
              setAppDisabled={setAppDisabled}
              canManageStore={canManageStore}
              onOpenAccountCenter={() => setShowAccountCenter(true)}
              onOpenShiftReport={() => { setShowStore(false); openShiftDeliberate(); }}
              onGoSales={() => { setShowStore(false); setTab("pos"); }}
              currentUser={currentUser}
            />
          </View>
        ) : showTeam ? (
          <View style={{ flex: 1 }}>
            <TeamScreen
              employees={employees}
              setEmployees={setEmployees}
              role={role}
              currentUser={currentUser}
              activeStore={activeStore?.location ?? "Petyonvil"}
              userStoreIds={userStoreIds}
              editingEmp={editingEmp}
              setEditingEmp={setEditingEmp}
              editEmpRole={editEmpRole}
              setEditEmpRole={setEditEmpRole}
              selfEditEmp={selfEditEmp}
              setSelfEditEmp={setSelfEditEmp}
              selfSecret={selfSecret}
              setSelfSecret={setSelfSecret}
              selfPassword={selfPassword}
              setSelfPassword={setSelfPassword}
              resetTarget={resetTarget}
              setResetTarget={setResetTarget}
              newEmpName={newEmpName}
              setNewEmpName={setNewEmpName}
              newEmpRole={newEmpRole}
              setNewEmpRole={setNewEmpRole}
              newEmpSalary={newEmpSalary}
              setNewEmpSalary={setNewEmpSalary}
              newEmpEmail={newEmpEmail}
              setNewEmpEmail={setNewEmpEmail}
              newEmpAddress={newEmpAddress}
              setNewEmpAddress={setNewEmpAddress}
              newEmpEmergName={newEmpEmergName}
              setNewEmpEmergName={setNewEmpEmergName}
              newEmpEmergAddress={newEmpEmergAddress}
              setNewEmpEmergAddress={setNewEmpEmergAddress}
              newEmpError={newEmpError}
              setNewEmpError={setNewEmpError}
              canManageEmployees={canManageEmployees}
              canAddRole={canAddRole}
              canEditRoleFor={canEditRoleFor}
              canAffect={canAffect}
              canToggle={canToggle}
              canResetOther={canResetOther}
              canChangeSelf={canChangeSelf}
              canEditSalary={canEditSalary}
              addRoleOptions={addRoleOptions}
              showAdd={showAddEmp}
              setShowAdd={setShowAddEmp}
            />
          </View>
        ) : showShift ? (
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            {!shiftFull && (
              <View style={{ padding: 12, backgroundColor: "#000", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottomWidth: 0.5, borderColor: "rgba(255,255,255,0.12)" }}>
                <DarkBackButton onPress={() => setShowShift(false)} />
                {(role === "cashier" || role === "manager" || role === "admin" || role === "owner") && (
                  awaitingReview ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(34,211,238,0.08)", borderWidth: 1, borderColor: "rgba(34,211,238,0.35)" }}>
                      <Ionicons name="time-outline" size={15} color="#22d3ee" />
                      <Text style={{ fontFamily: "Inter_700Bold", color: "#22d3ee", fontSize: 14 }}>Awaiting review</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => (shiftOpen ? setShiftCloseSignal(v => v + 1) : setShiftSignal(v => v + 1))}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: shiftOpen ? "rgba(224,108,91,0.10)" : "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: shiftOpen ? "rgba(224,108,91,0.45)" : "rgba(255,255,255,0.12)" }}>
                      <Ionicons name={shiftOpen ? "lock-closed-outline" : "key-outline"} size={15} color={shiftOpen ? "#e06c5b" : "#fff"} />
                      <Text style={{ fontFamily: "Inter_700Bold", color: shiftOpen ? "#e06c5b" : "#fff", fontSize: 14 }}>{shiftOpen ? "Close Shift" : "Open Shift"}</Text>
                    </Pressable>
                  )
                )}
              </View>
            )}
            <ShiftScreen storeId={activeStoreId} role={role} currentUser={currentUser} openSignal={shiftSignal} closeSignal={shiftCloseSignal} onOpenState={setShiftOpen} onFullView={setShiftFull} />
          </View>
        ) : showInventory ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <DarkBackButton onPress={() => setShowInventory(false)} />
            </View>
            <InventoryScreen
              role={role}
              currentUser={currentUser}
              onClose={() => setShowInventory(false)}
              onSaved={() => setInventoryVersion(v => v + 1)}
            />
          </View>
        ) : storeBlocked ? (
          <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center", ...shadow.card }}>
              <Ionicons name="lock-closed" size={28} color={palette.danger} />
            </View>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 14, textAlign: "center", color: palette.ink, letterSpacing: -0.4 }}>Magazen sa a bloke</Text>
            <Text style={{ fontFamily: "Inter_400Regular", color: palette.muted, textAlign: "center", marginTop: 8, fontSize: 13, lineHeight: 18 }}>
              Tout aktivite sou magazen <Text style={{ fontWeight: "700", color: palette.ink }}>{activeStore?.name}</Text> te sispann apre yon bès sekirite. Kontakte Konsole Sipò pou rektifye.
            </Text>
            <Pressable onPress={() => setShowSecurity(true)} style={{ marginTop: 18, backgroundColor: palette.ink2, paddingHorizontal: 22, paddingVertical: 13, borderRadius: radius.md, ...shadow.soft }}>
              <Text style={{ color: "#000", fontFamily: "Inter_700Bold" }}>Konsole Sipò</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {tab === "home" && <HomeScreen onGoPos={() => setTab("pos")} onGoShift={() => openShiftDeliberate()} onOpenStore={openStore} onOpenTeam={openTeam} role={role} currentUser={currentUser} employees={employees} stores={stores} setStores={setStores} activeStoreId={activeStoreId} setActiveStoreId={setActiveStoreId} appDisabled={appDisabled} setAppDisabled={setAppDisabled} onOpenAccountCenter={() => setShowAccountCenter(true)} onShiftResolved={() => setShiftVersion(v=>v+1)} storeId={activeStoreId} storeName={activeStore?.name ?? "Pétion-Ville"} userStoreIds={userStoreIds} deviceId={deviceId} />}
            {tab === "pos" && (
              !canSell ? (
                // Shift-flow gate — same dark language as the Shift screen:
                // pure black, cyan (SHIFT live) accents, CTA in the Kòmanse
                // style (cyan fill, deep-teal label). Never gold (Business
                // Guard) and never the paper palette.
                <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: "rgba(34,211,238,0.10)", borderWidth: 0.5, borderColor: "rgba(34,211,238,0.30)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="lock-closed-outline" size={32} color="#22d3ee" />
                  </View>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 16, textAlign: "center", color: "#fff", letterSpacing: -0.4 }}>{awaitingReview ? "Awaiting review — Vant bloke" : "Vant Bloke"}</Text>
                  <Text style={{ fontFamily: "Inter_400Regular", color: "#9a9a9e", textAlign: "center", marginTop: 8, fontSize: 13, lineHeight: 18 }}>
                    {awaitingReview
                      ? "Rapò ou soumèt — ap tann konfimasyon sipèvizè. Vant bloke pandan revizyon an."
                      : "Ou dwe kòmanse chanjman anvan ou ka vann. Peze bouton anba a pou louvri shift la."}
                  </Text>
                  <Pressable onPress={() => openShiftDeliberate()} android_ripple={{ color: "rgba(34,211,238,0.25)" }} style={({ pressed }) => [{ marginTop: 20, backgroundColor: "#22d3ee", paddingHorizontal: 22, paddingVertical: 13, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: 8 }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                    <Ionicons name={awaitingReview ? "time-outline" : "key-outline"} size={16} color="#06222b" />
                    <Text style={{ color: "#06222b", fontFamily: "Inter_700Bold" }}>{awaitingReview ? "Wè Shift" : "Kòmane Jounen Ou"}</Text>
                  </Pressable>
                </View>
              ) : (
                <POSScreen
                  storeId={activeStoreId}
                  deviceId={deviceId}
                  role={role}
                  currentUser={currentUser}
                  storeName={activeStore?.name ?? "Pétion-Ville"}
                  selectedCreditCustomer={selectedCreditCustomer}
                  onSelectCreditCustomer={setSelectedCreditCustomer}
                  onTabsChanged={() => setTabDataVersion(v => v + 1)}
                  attachCustomer={posAttachCustomer}
                  onAttachCustomerConsumed={() => setPosAttachCustomer(null)}
                  seed={posSeed}
                  onSeedConsumed={() => setPosSeed(null)}
                  canSell={canSell}
                />
              )
            )}
            {tab === "orders" && (
              <OrdersScreen
                storeId={activeStoreId}
                deviceId={deviceId}
                storeName={activeStore?.name ?? "Pétion-Ville"}
                role={role}
                currentUser={currentUser}
                businessType={businessType}
                canSell={canSell}
                reloadKey={tabDataVersion}
              />
            )}
            {tab === "customers" && (
              <CustomersScreen
                role={role}
                currentUser={currentUser}
                onAddSale={(c) => { setPosAttachCustomer(c); setTab("pos"); }}
              />
            )}
            {tab === "transactions" && <TransactionsScreen role={role} storeId={activeStoreId} storeName={activeStore?.name ?? "Pétion-Ville"} currentUser={currentUser} userStoreIds={userStoreIds} />}
            {tab === "more" && (
              <MoreScreen
                key={moreKey}
                role={role}
                businessType={businessType}
                currentUser={currentUser}
                storeId={activeStoreId}
                storeName={activeStore?.name ?? "Pétion-Ville"}
                inventoryVersion={inventoryVersion}
                onInventorySaved={() => setInventoryVersion(v => v + 1)}
                onOpenStore={openStore}
                onOpenTeam={openTeam}
                onOpenShift={() => openShiftDeliberate()}
                onLogout={logoutFlow}
                userStoreIds={userStoreIds}
                stores={stores}
                deviceId={deviceId}
                onLoadIntoCart={(pfo, customerId) => { setPosSeed({ proformat: pfo, customerId }); setTab("pos"); }}
                /* Tablet: the MenuSidebar owns the selection (bodies only — the
                   hub never renders there). Phone passes nothing so the hub stays
                   uncontrolled and the moreKey remount still resets it. */
                {...(IS_TABLET_DEVICE ? { selection: moreSel, onSelectionChange: setMoreSel } : {})}
              />
            )}
          </>
        )}
      </View>
      </KeyboardSafeView>

      {/* Round draggable tabs FAB — root level, floats above header, nav and screens.
          Tablets keep the same job as a badge on the sidebar's Vant item. */}
      {!shiftFull && !IS_TABLET_DEVICE && <TabsFab onOpen={onTabFABOpen} />}
      {/* Orders shortcut FAB — only cashier/manager/admin/owner with an open
          shift; shows the not-yet-paid count and jumps to Kòmand. Tablets
          carry the same count as the sidebar's Kòmand badge. */}
      {!shiftFull && !IS_TABLET_DEVICE && canSell && (["cashier", "manager", "admin", "owner"] as string[]).includes(role) && (
        <OrdersFab onOpen={() => setTab("orders")} />
      )}
    </SafeAreaView>
      {/* Bottom nav sits outside the safe area so the bar lands flush on the screen edge.
          Shift keeps it visible (dark background + visible menu) — switching tabs exits Shift.
          Tablets never show it — MenuSidebar (left rail) owns navigation there. */}
      {!IS_TABLET_DEVICE && !showAccountCenter && !showSecurity && !showStore && !showInventory && !shiftFull && <BottomNav active={tab} visibleTabs={visibleTabs} onChange={onNavChange} />}
      {/* Shared post-save/edit overlay — replaces result Alerts app-wide */}
      <GlobalUploadTransition />
      {/* Quiet catch-up indicator (initial download / stale sweep) — never blocks work */}
      <SyncStatusIndicator />
    </View>
    </SidebarWidthProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}
