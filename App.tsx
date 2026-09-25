import React, { useState, useRef, useEffect, useCallback } from "react";
import { SafeAreaView, Text, View, Pressable, TextInput, Alert, Modal, Animated, Easing, BackHandler, KeyboardAvoidingView, Platform, ScrollView, AppState, Dimensions, Image, StatusBar } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
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
import ShiftReportScreen from "./src/screens/ShiftReportScreen";
import AccountCenter from "./src/screens/home/AccountCenter";
import MoreScreen from "./src/screens/MoreScreen";
import type { BusinessType } from "./src/users";
import SecurityCenter from "./src/screens/home/SecurityCenter";
import StoreScreen from "./src/screens/home/StoreScreen";
import TeamScreen, { type Employee } from "./src/screens/home/TeamScreen";
import { BottomNav, Tab } from "./src/components/BottomNav";
import { TabsFab } from "./src/components/TabsFab";
import { tabsUI } from "./src/tabsUI";
import { ht } from "./src/i18n";
import { USERS, type Role, type User } from "./src/users";
import { palette, radius, shadow } from "./src/theme";
import { Ionicons } from "@expo/vector-icons";
import { useAuthState } from "./src/auth/authStore";
import LoginScreen from "./src/screens/LoginScreen";
import { fmtG } from "./src/format";

export type { Role, User };

export type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean; breachedAt?: string; revokedBy?: string };

const STORE_ID = "demo-store-id";
// NOTE: device id is NOT a Math.random() const (RAM-only, changes every
// rebundle). It is loaded once from SecureStore (disk) into state below.
const PROGRAM_OPENING_VAL = 10000;
const SUPERVISOR_IDS = ["owner-1", "admin-1", "manager-1"];

// employees <-> SQLite mapping (team roster persistence)
const empStoreId = (store?: string) => store === "Dèlma" ? "st-delma" : store === "Petyonvil" ? "st-petyonvil" : STORE_ID;
const empStoreName = (sid?: string) => sid === "st-delma" ? "Dèlma" : sid === "st-petyonvil" ? "Petyonvil" : "Petyonvil";
const parseSalary = (s: any) => { const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
function empFromRow(r: any): any {
  const base = USERS.find(u => u.id === r.id);
  return {
    id: r.id,
    name: r.full_name,
    role: r.role,
    phone: r.phone ?? "",
    address: r.address ?? "",
    store: empStoreName(r.store_id),
    emergency: { name: "", address: "", phone: "" },
    secret: base?.secret ?? "",
    password: "",
    lastAction: "",
    kpi: "",
    salary: `${fmtG(Number(r.salary) || 0)}`,
    isOnline: !!r.online_status,
    active: !!r.is_active,
  } as any;
}

export default function App() {
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

  (Text as any).defaultProps = (Text as any).defaultProps || {};
  (Text as any).defaultProps.style = [{ fontFamily: "Inter_500Medium" }, (Text as any).defaultProps.style];
  (TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
  (TextInput as any).defaultProps.style = [{ fontFamily: "Inter_400Regular" }, (TextInput as any).defaultProps.style];

  const [tab, setTab] = useState<Tab>("pos");
  // Bumping remounts MoreScreen, back to the hub (the Retounen button is gone).
  const [moreKey, setMoreKey] = useState(0);
  // Tablets are portrait-only: lock orientation so the
  // tablet layouts are always shown. Phones stay freely rotatable.
  // NOTE: classification must be rotation-independent (Platform.isPad /
  // smallest screen side). A width-based check would misclassify a phone
  // held in landscape as a tablet and lock it sideways permanently.
  const [isTabletDevice] = useState(() => {
    if (Platform.OS === "ios") return !!Platform.isPad;
    const s = Dimensions.get("screen");
    return Math.min(s.width, s.height) >= 600;
  });
  useEffect(() => {
    (async () => {
      try {
        if (isTabletDevice) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
        } else {
          await ScreenOrientation.unlockAsync();
        }
      } catch {}
    })();
  }, [isTabletDevice]);  const [showShift, setShowShift] = useState(false);
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<any | null>(null);
  // Add Sale from Customers: customer to preselect in POS on tab switch.
  const [posAttachCustomer, setPosAttachCustomer] = useState<any | null>(null);
  const auth = useAuthState();
  // Stable device id from HARD memory (SecureStore/Keychain). Survives
  // rebundles + restarts; used for suspended-sales + sync attribution.
  const [deviceId, setDeviceId] = useState<string>("device-pending");
  useEffect(() => {
    (async () => {
      try {
        const { getOrCreateDeviceId } = await import("./src/device");
        setDeviceId(await getOrCreateDeviceId());
      } catch {}
    })();
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
      } catch (e) {
        console.warn("[db] boot check failed:", String(e));
      }
    })();
  }, []);
  // Derive from the persisted session (SecureStore), not a RAM-only useState
  // default — otherwise shift lookups use a stale "cashier-1" after login.
  const currentUser = auth.user ?? USERS[0];
  const currentUserId = currentUser?.id ?? "cashier-1";
  const role = currentUser.role;
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [pendingShift, setPendingShift] = useState<any | null>(null);
  const [shiftVersion, setShiftVersion] = useState(0);

  const [showShiftStart, setShowShiftStart] = useState(false);
  const [shiftOpeningInput, setShiftOpeningInput] = useState("10000");
  const [shiftSecretInput, setShiftSecretInput] = useState("");
  const [shiftConfirmationChoice, setShiftConfirmationChoice] = useState<"yes" | "no" | null>(null);
  const [pendingDiscrepancy, setPendingDiscrepancy] = useState<any | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [tabDataVersion, setTabDataVersion] = useState(0);

  // Refresh the FAB's open-tab count straight from the DB so it shows whenever
  // suspended sales exist (any tab, even after leaving and returning).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM suspended_sales WHERE status = 'open'")) as any[];
        if (!cancelled) tabsUI.setCount((rows ?? []).length);
      } catch { if (!cancelled) tabsUI.setCount(0); }
    }
    refresh();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { cancelled = true; sub.remove(); };
  }, [tabDataVersion]);

  // FAB tap from any screen: jump to POS and open its tabs sheet.
  const onTabFABOpen = useCallback(() => {
    setTab("pos");
    // give the POS tab a tick to mount, then request the sheet
    setTimeout(() => tabsUI.requestOpen(() => {}), 60);
  }, []);

  // --- Global store context (Apple-like Account Center) — persisted to SQLite (except users) ---
  const [stores, setStores] = useState<StoreItem[]>(() => [
    { id: "st-petyonvil", name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", createdAt: new Date().toISOString() },
    { id: "st-delma", name: "Delmas", location: "Dèlma", code: "DL-9034", createdAt: new Date().toISOString() },
  ]);
  const [activeStoreId, setActiveStoreId] = useState<string>("st-petyonvil");
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
        } else {
          // first launch — seed SQLite with initial stores
          const initial = [
            { id: "st-petyonvil", name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", createdAt: new Date().toISOString() },
            { id: "st-delma", name: "Delmas", location: "Dèlma", code: "DL-9034", createdAt: new Date().toISOString() },
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
  }, []);
  // Persist stores on change (for testing: verify sqlite survives restart)
  useEffect(() => {
    if (!storesHydrated) return;
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
  const [employees, setEmployees] = useState<Employee[]>(() =>
    USERS.map(u => ({
      ...u,
      store: u.store ?? "Petyonvil",
      lastAction: u.role === "cashier" ? "Vente #VTE-1021 • il y a 12 min" : u.role === "manager" ? "Ajustement stock • il y a 1 h" : "Clôture caisse • hier",
      kpi: u.role === "cashier" ? "22 ventes • G 1 540/panier" : "18 tâches • 98% précision",
      salary: u.role === "owner" ? "G 45 000" : u.role === "admin" ? "G 32 000" : u.role === "manager" ? "G 25 000" : "G 12 000",
      address: u.id === "owner-1" ? "Pétion-Ville, Rue Panaméricaine 12" : u.id === "admin-1" ? "Delmas 33, Impasse Lafleur" : u.id === "manager-1" ? "Carrefour, Bizoton 45" : "Kenscoff, Route de Furcy",
      isOnline: u.role === "owner" || u.role === "admin" ? true : Math.random() > 0.4,
      emergency: u.id === "owner-1" ? { name: "Marie Owner", address: "Pétion-Ville, Rue Clerveaux 8", phone: "+509 3100 0001" } : u.id === "admin-1" ? { name: "Jean Admin", address: "Delmas 31, Rue Tirlemont", phone: "+509 3100 0002" } : u.id === "manager-1" ? { name: "Sophie Manager", address: "Carrefour, Mahotière 12", phone: "+509 3100 0003" } : { name: "Luc Cashier", address: "Pétion-Ville, Laboule 10", phone: "+509 3100 0004" },
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
        setUserStoreIds(await loadUserStoreIds(await getDb(), currentUser));
      } catch {}
    })();
  }, [currentUser?.id]);
  // Hydrate the team roster from SQLite (persistent across restarts); seed once if empty
  useEffect(() => {
    if (!storesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const rows = (await db.getAllAsync("SELECT * FROM employees WHERE is_deleted=0 OR is_deleted IS NULL")) as any[];
        if (rows.length > 0) {
          setEmployees(rows.map(empFromRow));
        } else {
        for (const e of employees) {
          await db.runAsync(
            "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, phone, salary, address, is_active, online_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [e.id, empStoreId(e.store), e.name, e.role, e.phone ?? "", parseSalary(e.salary), e.address ?? "", e.active ? 1 : 0, e.isOnline ? 1 : 0, new Date().toISOString(), new Date().toISOString()]
          );
          try {
            await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [e.id, empStoreId(e.store)]);
          } catch {}
        }
        }
      } catch {}
      setEmployeesHydrated(true);
    })();
  }, [storesHydrated]);
  // Persist any roster change (add / edit / toggle) so it survives app restarts
  useEffect(() => {
    if (!employeesHydrated) return;
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        for (const e of employees) {
          await db.runAsync(
            "INSERT OR REPLACE INTO employees (id, store_id, full_name, role, phone, salary, address, is_active, online_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [e.id, empStoreId(e.store), e.name, e.role, e.phone ?? "", parseSalary(e.salary), e.address ?? "", e.active ? 1 : 0, e.isOnline ? 1 : 0, new Date().toISOString(), new Date().toISOString()]
          );
          try {
            await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [e.id, empStoreId(e.store)]);
          } catch {}
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
  const [newEmpPhone, setNewEmpPhone] = useState("");
  const [newEmpAddress, setNewEmpAddress] = useState("");
  const [newEmpEmergName, setNewEmpEmergName] = useState("");
  const [newEmpEmergPhone, setNewEmpEmergPhone] = useState("");
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

  // Shift sheet spring
  const sheetTranslate = useRef(new Animated.Value(320)).current;
  useEffect(() => {
    Animated.spring(sheetTranslate, {
      toValue: showShiftStart ? 0 : 320,
      tension: 280,
      friction: 24,
      useNativeDriver: true,
    }).start();
  }, [showShiftStart]);

  React.useEffect(() => {
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const shifts = (await db.getAllAsync("SELECT * FROM shifts ORDER BY start_time DESC LIMIT 5")) as any[];
        const active = shifts.find((s: any) => s.status === "open" && s.cashier_id === currentUserId) || shifts.find((s: any) => s.status === "open") || null;
        setActiveShift(active);
        setPendingShift(shifts.find((s: any) => s.status === "pending" && s.cashier_id === currentUserId) || null);
      } catch {}
    })();
  }, [tab, showShift, shiftVersion, currentUserId]);

  const isCashierRole = role === "cashier";
  const canManageStore = role === "admin" || role === "owner";

  React.useEffect(() => {
    (async () => {
      try {
        const { getDb } = await import("./src/db");
        const db = await getDb();
        const cds = (await db.getAllAsync("SELECT * FROM cash_discrepancies")) as any[];
        const pending = cds.find((c: any) => c.status === "pending" || c.status === "reassigned");
        setPendingDiscrepancy(pending || null);
      } catch {}
    })();
  }, [activeShift, tab]);

  const hasPendingDiscrepancy = !!pendingDiscrepancy && (pendingDiscrepancy.status === "pending" || pendingDiscrepancy.status === "reassigned");
  const isCashierConfirmed = !!activeShift && !!activeShift.cashier_confirmed;
  const canSell = !isCashierRole || (!!activeShift && isCashierConfirmed && !hasPendingDiscrepancy);

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
          : tab === "transactions"
            ? ht.transactions
            : tab === "more"
              ? "Plis"
              : ht.home;

  if (!fontsReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)", padding: 6 }}>
          <Image source={require("./assets/kourro-logo.png")} style={{ width: 34, height: 34, resizeMode: "contain" }} />
        </View>
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: palette.ink, marginTop: 10, letterSpacing: -0.2 }}>Kourro</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.muted2, marginTop: 2 }}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  if (auth.status === "signedout") {
    return <LoginScreen onAuthed={() => {}} />;
  }

  if (auth.status === "loading") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)", padding: 6 }}>
          <Image source={require("./assets/kourro-logo.png")} style={{ width: 34, height: 34, resizeMode: "contain" }} />
        </View>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.muted2, marginTop: 2 }}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  async function handleBeginShiftToggle() {
    if (activeShift) {
      setShowShift(true);
      return;
    }
    if (pendingShift) {
      // A ticket is awaiting a supervisor — do not let the cashier redo the cash confirmation.
      Alert.alert("Chanjman ap tann", "Ou te fè yon tikit (Pa dakò). Chanjman w la make 'ap tann' — ou pa ka rebay konfimasyon an. Yon sipèvizè dwe rezoud li anvan ou ka kòmanse.");
      return;
    }
    setShowShiftStart(true);
  }

  function closeShiftStartSheet() {
    setShowShiftStart(false);
    setShiftConfirmationChoice(null);
    setShiftSecretInput("");
  }

  async function beginShiftAgree() {
    try {
      const { getDb } = await import("./src/db");
      const db = await getDb();
      const allShifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
      const existing = allShifts.find((s: any) => s.status === "open" && s.cashier_id === currentUser.id);
      console.log("[beginShiftAgree] existing shifts count=", allShifts.length, "existing_open=", existing ? existing.id : "none");
      if (existing) {
        setActiveShift(existing);
        closeShiftStartSheet();
        setShiftVersion(v => v + 1);
        Alert.alert("Chanjman kòmanse ✓", `Kes la dakò a ${fmtG(existing.opening_balance)}. Vant debloke — ou ka kòmanse vann kounye a.`);
        return;
      }
      const ts = new Date().toISOString();
      const id = `shift-${Date.now()}`;
      await db.runAsync("INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [id, STORE_ID, currentUser.id, "manager-1", PROGRAM_OPENING_VAL, "open", ts, null, 1, 1, 1]);
      console.log("[beginShiftAgree] INSERTED shift id=", id, "store_id=", STORE_ID, "cashier_id=", currentUser.id, "opening=", PROGRAM_OPENING_VAL);
      for (const sup of SUPERVISOR_IDS) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${sup}`, sup, "shift_opening", id, `${currentUser.name} konfime ${fmtG(PROGRAM_OPENING_VAL)} nan kach la. Chanjman kòmanse epi vant debloke.`, "pending", ts]);
      }
      setActiveShift({ id, store_id: STORE_ID, cashier_id: currentUser.id, manager_id: "manager-1", opening_balance: PROGRAM_OPENING_VAL, status: "open", start_time: ts, cashier_confirmed: 1, manager_confirmed: 1, supervisor_confirmed: 1 });
      closeShiftStartSheet();
      setShiftVersion(v => v + 1);
      Alert.alert("Chanjman kòmanse ✓", `Kes la dakò a ${fmtG(PROGRAM_OPENING_VAL)}. Notification ale bay Owner/Admin/Manager. Vant debloke — ou ka kòmanse vann kounye a.`);
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  async function fileShiftComplaint() {
    const stated = parseFloat(shiftOpeningInput);
    if (isNaN(stated) || stated <= 0) return Alert.alert("Antre montan", "Ki kach ou reyèlman konte nan kes la?");
    const amt = stated;
    try {
      const { getDb } = await import("./src/db");
      const db = await getDb();
      const ts = new Date().toISOString();
      const pendingShiftId = `shift-${Date.now()}`;
      await db.runAsync("INSERT INTO shifts (id, store_id, cashier_id, manager_id, opening_balance, status, start_time, end_time, cashier_confirmed, manager_confirmed, supervisor_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [pendingShiftId, STORE_ID, currentUser.id, "manager-1", amt, "pending", ts, null, 0, 0, 0]);
      await db.runAsync("INSERT INTO cash_discrepancies (id, shift_id, manager_amount, cashier_amount, difference, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [`cd-${Date.now()}`, pendingShiftId, PROGRAM_OPENING_VAL, amt, PROGRAM_OPENING_VAL - amt, "pending", currentUser.id, ts]);
      for (const sup of SUPERVISOR_IDS) {
        await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
          [`notif-${Date.now()}-${sup}-plent`, sup, "shift_review", pendingShiftId, `${currentUser.name} pa dakò: konte ${fmtG(amt)} olye de ${fmtG(PROGRAM_OPENING_VAL)}. Vant ret bloke jiskaske sipèvizè revize.`, "pending", ts]);
      }
      setPendingShift({ id: pendingShiftId, opening_balance: amt, status: "pending", cashier_confirmed: 0 });
      setActiveShift(null);
      closeShiftStartSheet();
      setShiftVersion(v => v + 1);
      Alert.alert("Plent voye", `Ou konte ${fmtG(amt)} olye de ${fmtG(PROGRAM_OPENING_VAL)} (diferans ${fmtG(Math.abs(PROGRAM_OPENING_VAL - amt))}). Vant rete bloke — yon sipèvizè dwe rezoud tikit la anvan ou ka kòmanse.`);
    } catch (e) { Alert.alert("Erè", String(e)); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      {/* Cashier shift gate — luxury amber/red with hairline */}
      {isCashierRole && !activeShift && tab === "pos" && !pendingShift && (
        <View style={{ backgroundColor: palette.warningBg, borderBottomWidth: 0.5, borderColor: palette.warningBd, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#fff", borderWidth: 0.5, borderColor: palette.warningBd, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="lock-closed-outline" size={16} color={palette.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: palette.warning, fontSize: 12, letterSpacing: -0.1 }}>Chanjman fèmen — Vant bloke</Text>
            <Text style={{ fontFamily: "Inter_400Regular", color: palette.warningDot, fontSize: 11, marginTop: 1 }}>Ou dwe kòmanse chanjman (Lajan Disponib) anvan ou ka vann.</Text>
          </View>
        </View>
      )}
      {isCashierRole && pendingShift && tab === "pos" && (
        <View style={{ backgroundColor: palette.warningBg, borderBottomWidth: 0.5, borderColor: palette.warningBd, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#fff", borderWidth: 0.5, borderColor: palette.warningBd, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="time-outline" size={16} color={palette.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: palette.warning, fontSize: 12, letterSpacing: -0.1 }}>Chanjman ap tann — Vant bloke</Text>
            <Text style={{ fontFamily: "Inter_400Regular", color: palette.warningDot, fontSize: 11, marginTop: 1 }}>Ou fè yon tikit (Pa dakò). Yon sipèvizè dwe rezoud li anvan ou ka kòmanse.</Text>
          </View>
        </View>
      )}
      {isCashierRole && hasPendingDiscrepancy && tab === "pos" && (
        <View style={{ backgroundColor: palette.dangerBg, borderBottomWidth: 0.5, borderColor: palette.dangerBd, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#fff", borderWidth: 0.5, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="warning-outline" size={16} color={palette.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", color: palette.danger, fontSize: 12 }}>Vant bloke — Tann konfimasyon sipèvizè</Text>
            <Text style={{ fontFamily: "Inter_400Regular", color: palette.dangerDot, fontSize: 11, marginTop: 1 }}>Ou rapòte {fmtG(pendingDiscrepancy?.cashier_amount)} olye de {fmtG(pendingDiscrepancy?.manager_amount)} (manke {fmtG(pendingDiscrepancy?.difference)}).</Text>
          </View>
        </View>
      )}

      {/* Lajan Disponib modal — opens via Kòmanse Chanjman */}
      {showShiftStart && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(10,10,11,0.34)", justifyContent: "flex-end" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
              <Animated.View style={{
                backgroundColor: palette.surface,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                padding: 18,
                borderTopWidth: 0.5, borderColor: palette.hairline,
                transform: [{ translateY: sheetTranslate }],
                ...shadow.elevated,
              }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="briefcase-outline" size={20} color={palette.accentGold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 17, color: palette.ink, letterSpacing: -0.3 }}>Lajan Disponib</Text>
                <Text style={{ fontFamily: "Inter_400Regular", color: palette.muted2, fontSize: 11, marginTop: 1 }}>Lajan ki disponib pou chak kesye — {currentUser.name}</Text>
              </View>
            </View>

            <View style={{ marginTop: 16, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, padding: 12, borderWidth: 0.5, borderColor: palette.hairline }}>
              <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Montan pwogram nan atann</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: palette.accentGold, marginTop: 2 }}>{fmtG(PROGRAM_OPENING_VAL)}</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: palette.muted2, marginTop: 2 }}>Sa pwogram nan deklare kes la genyen kòm kach ouvèti</Text>
            </View>

            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: palette.ink, marginTop: 16 }}>Eske ou dakò ak montan kes la?</Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => setShiftConfirmationChoice("no")} style={{ flex: 1, backgroundColor: shiftConfirmationChoice === "no" ? palette.dangerBg : palette.surface, borderWidth: 1, borderColor: shiftConfirmationChoice === "no" ? palette.dangerBd : palette.hairlineStrong, borderRadius: radius.md, padding: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                <Ionicons name="close-circle" size={18} color={palette.danger} />
                <Text style={{ color: palette.danger, fontFamily: "Inter_700Bold", fontSize: 13 }}>Pa dakò</Text>
              </Pressable>
              <Pressable onPress={() => setShiftConfirmationChoice("yes")} style={{ flex: 1, backgroundColor: shiftConfirmationChoice === "yes" ? palette.accentGold : palette.surface, borderWidth: 1, borderColor: shiftConfirmationChoice === "yes" ? "rgba(255,255,255,0.3)" : palette.hairlineStrong, borderRadius: radius.md, padding: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, ...(shiftConfirmationChoice === "yes" ? shadow.soft : {}) }}>
                <Ionicons name="checkmark-circle" size={18} color={shiftConfirmationChoice === "yes" ? "#fff" : palette.success} />
                <Text style={{ color: shiftConfirmationChoice === "yes" ? "#fff" : palette.ink, fontFamily: "Inter_700Bold", fontSize: 13 }}>Dakò</Text>
              </Pressable>
            </View>

            {!shiftConfirmationChoice ? (
              <Text style={{ marginTop: 12, color: palette.muted2, fontSize: 11, textAlign: "center", fontFamily: "Inter_400Regular" }}>Chwazi Dakò oswa Pa dakò pou kòmanse.</Text>
            ) : (
              <>
                {shiftConfirmationChoice === "no" && (
                  <View style={{ backgroundColor: palette.bg, borderRadius: radius.md, padding: 12, marginTop: 14, borderWidth: 0.5, borderColor: palette.separator }}>
                    <Text style={{ fontSize: 10, color: palette.muted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase" }}>Ki KACH OU REYÈLMAN KONTE? (G)</Text>
                    <TextInput value={shiftOpeningInput} placeholder={String(PROGRAM_OPENING_VAL)} placeholderTextColor={palette.muted3} onChangeText={setShiftOpeningInput} keyboardType="numeric" style={{ borderWidth: 0.5, borderColor: palette.ink2, borderRadius: radius.sm, padding: 11, marginTop: 8, fontFamily: "Inter_700Bold", backgroundColor: palette.surface, color: palette.ink }} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.muted, marginTop: 6 }}>Antre vrè montan. Yon plent ap ale bay Owner/Admin/Manadjè — vant rete bloke jiskaske yo rezoud.</Text>
                  </View>
                )}
                {shiftConfirmationChoice === "yes" && (
                  <View style={{ marginTop: 14, backgroundColor: palette.successBg, borderWidth: 0.5, borderColor: palette.successBd, borderRadius: radius.md, padding: 12 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: palette.success }}>✓ Dakò — chanjman kòmanse imedyatman</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: palette.success, marginTop: 4 }}>Pa bezwen kòd. Notifikasyon ale bay Owner/Admin/Manager. Ou ka kòmanse vann.</Text>
                  </View>
                )}
              </>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => { setShowShiftStart(false); setShiftConfirmationChoice(null); setShiftSecretInput(""); }} style={{ flex: 1, padding: 13, backgroundColor: palette.surfaceGrouped, borderRadius: radius.md, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink }}>Anile</Text></Pressable>
              <Pressable
                onPress={shiftConfirmationChoice === "no" ? fileShiftComplaint : beginShiftAgree}
                disabled={!shiftConfirmationChoice}
                style={{ flex: 1, padding: 13, backgroundColor: shiftConfirmationChoice ? palette.ink2 : palette.separator, borderRadius: radius.md, alignItems: "center", ...shadow.soft }}
              >
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>{shiftConfirmationChoice === "yes" ? "Dakò — Kòmanse" : shiftConfirmationChoice === "no" ? "Voye Plent" : "Konfime"}</Text>
              </Pressable>
            </View>
              </Animated.View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: palette.accentGold, shadowColor: palette.accentGold, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
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
              {isCashierRole && activeShift && (
                <Pressable
                  onPress={() => { setShowProfileMenu(false); setShowShift(true); }}
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
                await clearCartDraft(await getDb(), STORE_ID, currentUser?.id ?? null);
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

      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {showAccountCenter ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <Pressable onPress={() => setShowAccountCenter(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontSize: 12 }}>← Retounen</Text></Pressable>
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
              <Pressable onPress={() => setShowSecurity(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontSize: 12 }}>← Retounen</Text></Pressable>
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
              <Pressable onPress={() => setShowStore(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontSize: 12 }}>← Retounen</Text></Pressable>
            </View>
            <StoreScreen
              role={role}
              activeStore={activeStore}
              storeId={STORE_ID}
              storeCount={stores?.length ?? 0}
              appDisabled={appDisabled}
              setAppDisabled={setAppDisabled}
              canManageStore={canManageStore}
              onOpenAccountCenter={() => setShowAccountCenter(true)}
              onOpenShiftReport={() => { setShowStore(false); setShowShift(true); }}
              onGoSales={() => { setShowStore(false); setTab("pos"); }}
              onShiftResolved={() => setShiftVersion(v=>v+1)}
              currentUser={currentUser}
              cashiers={cashiers}
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
              newEmpPhone={newEmpPhone}
              setNewEmpPhone={setNewEmpPhone}
              newEmpAddress={newEmpAddress}
              setNewEmpAddress={setNewEmpAddress}
              newEmpEmergName={newEmpEmergName}
              setNewEmpEmergName={setNewEmpEmergName}
              newEmpEmergPhone={newEmpEmergPhone}
              setNewEmpEmergPhone={setNewEmpEmergPhone}
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
              addRoleOptions={addRoleOptions}
              showAdd={showAddEmp}
              setShowAdd={setShowAddEmp}
            />
          </View>
        ) : showShift ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <Pressable onPress={() => setShowShift(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontSize: 12 }}>← Retounen</Text></Pressable>
            </View>
            <ShiftReportScreen storeId={STORE_ID} role={role} currentUser={currentUser} />
          </View>
        ) : showInventory ? (
          <View style={{ flex: 1 }}>
            <View style={{ padding: 12, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0.5, borderColor: palette.hairline }}>
              <Pressable onPress={() => setShowInventory(false)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontSize: 12 }}>← Retounen</Text></Pressable>
            </View>
            <InventoryScreen
              role={role}
              currentUser={currentUser}
              onClose={() => setShowInventory(false)}
              onSaved={() => { setShowInventory(false); setInventoryVersion(v => v + 1); }}
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
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>Konsole Sipò</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {tab === "home" && <HomeScreen onGoPos={() => setTab("pos")} onGoShift={() => setShowShift(true)} onOpenStore={() => setShowStore(true)} onOpenTeam={() => setShowTeam(true)} role={role} currentUser={currentUser} employees={employees} stores={stores} setStores={setStores} activeStoreId={activeStoreId} setActiveStoreId={setActiveStoreId} appDisabled={appDisabled} setAppDisabled={setAppDisabled} onOpenAccountCenter={() => setShowAccountCenter(true)} onShiftResolved={() => setShiftVersion(v=>v+1)} />}
            {tab === "pos" && (
              !canSell ? (
                <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: hasPendingDiscrepancy ? palette.dangerBg : pendingShift ? palette.warningBg : palette.accentGoldSoft, borderWidth: 0.5, borderColor: hasPendingDiscrepancy ? palette.dangerBd : pendingShift ? palette.warningBd : palette.accentGold, alignItems: "center", justifyContent: "center", ...shadow.card }}>
                    <Ionicons name={hasPendingDiscrepancy ? "warning-outline" : pendingShift ? "time-outline" : "lock-closed-outline"} size={32} color={hasPendingDiscrepancy ? palette.danger : pendingShift ? palette.warning : palette.accentGold} />
                  </View>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 16, textAlign: "center", color: palette.ink, letterSpacing: -0.4 }}>{hasPendingDiscrepancy ? (pendingDiscrepancy?.status === "reassigned" ? "Sipèvizè reasigne — konfime" : "Tann konfimasyon sipèvizè") : (pendingShift ? "Chanjman ap tann — Vant bloke" : "Vant bloke — Chanjman pa kòmanse")}</Text>
                  <Text style={{ fontFamily: "Inter_400Regular", color: palette.muted, textAlign: "center", marginTop: 8, fontSize: 13, lineHeight: 18 }}>
                    {hasPendingDiscrepancy
                      ? pendingDiscrepancy?.status === "reassigned"
                        ? `Sipèvizè reasigne kach la a ${fmtG(pendingDiscrepancy?.reassigned_amount)} (ou te di ${fmtG(pendingDiscrepancy?.cashier_amount)}). Si ou dakò ak ${fmtG(pendingDiscrepancy?.reassigned_amount)}, konfime ak kòd ou (${currentUser.secret}) pou kòmanse vann.`
                        : `Ou rapòte ${fmtG(pendingDiscrepancy?.cashier_amount)} olye de ${fmtG(pendingDiscrepancy?.manager_amount)}. Tout sipèvizè resevwa notifikasyon. Ou pa ka vann jiskaske yo konfime.`
                      : pendingShift
                        ? `Ou te fè yon tikit (Pa dakò). Chanjman w la make "ap tann" — ou pa ka rebay konfimasyon an. Yon sipèvizè dwe rezoud li anvan ou ka kòmanse.`
                        : `Ou dwe kòmanse chanjman anvan ou ka vann. Peze katon anba a pou louvri Lajan Disponib epi atestine montan kes la.`}
                  </Text>
                  {!hasPendingDiscrepancy && !pendingShift && (
                    <Pressable onPress={() => setShowStore(true)} android_ripple={{ color: "rgba(200,162,74,0.25)" }} style={({ pressed }) => [{ marginTop: 20, backgroundColor: palette.accentGold, paddingHorizontal: 22, paddingVertical: 13, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: 8, ...shadow.soft }, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                      <Ionicons name="briefcase-outline" size={16} color="#fff" />
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>Tyeke Konbyen Ou Gen Nan Kès Ou</Text>
                    </Pressable>
                  )}
                  {hasPendingDiscrepancy && pendingDiscrepancy?.status === "reassigned" && (
                    <View style={{ marginTop: 16, width: "100%", backgroundColor: palette.blueBg, borderWidth: 0.5, borderColor: palette.blueBd, borderRadius: radius.md, padding: 14 }}>
                      <Text style={{ fontFamily: "Inter_700Bold", color: palette.blue, textAlign: "center", fontSize: 13 }}>Sipèvizè panse ou te konte mal</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: palette.blue, textAlign: "center", marginTop: 4 }}>Li reasigne a {fmtG(pendingDiscrepancy?.reassigned_amount)}. Si ou dakò, peze pou konfime ak kòd ou.</Text>
                      <Pressable onPress={async () => {
                        if (!pendingDiscrepancy) return;
                        const { getDb } = await import("./src/db");
                        const db = await getDb();
                        const amt = Number(pendingDiscrepancy.reassigned_amount);
                        await db.runAsync("UPDATE cash_discrepancies SET status = ? WHERE id = ?", ["approved", pendingDiscrepancy.id]);
                        const shifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
                        const s = shifts.find((x: any) => x.id === pendingDiscrepancy.shift_id);
                        if (s) { s.opening_balance = amt; s.cashier_confirmed = 1; s.supervisor_confirmed = 1; }
                        setPendingDiscrepancy(null);
                        const allShifts = (await db.getAllAsync("SELECT * FROM shifts")) as any[];
                        const active = allShifts.find((x: any) => x.status === "open");
                        setActiveShift(active || null);
                        Alert.alert("Konfime ✓", `Konfime ${fmtG(amt)} — ou ka kòmanse vann`);
                      }} style={{ marginTop: 10, backgroundColor: palette.ink2, padding: 11, borderRadius: radius.sm, alignItems: "center" }}>
                        <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>✓ Mwen dakò ({fmtG(pendingDiscrepancy?.reassigned_amount)}) — Kòd {currentUser.secret}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : (
                <POSScreen
                  storeId={STORE_ID}
                  deviceId={deviceId}
                  role={role}
                  currentUser={currentUser}
                  storeName={activeStore?.name ?? "Pétion-Ville"}
                  selectedCreditCustomer={selectedCreditCustomer}
                  onSelectCreditCustomer={setSelectedCreditCustomer}
                  onTabsChanged={() => setTabDataVersion(v => v + 1)}
                  attachCustomer={posAttachCustomer}
                  onAttachCustomerConsumed={() => setPosAttachCustomer(null)}
                />
              )
            )}
            {tab === "transactions" && <TransactionsScreen role={role} storeId={STORE_ID} storeName={activeStore?.name ?? "Pétion-Ville"} currentUser={currentUser} userStoreIds={userStoreIds} />}
            {tab === "more" && (
              <MoreScreen
                key={moreKey}
                role={role}
                businessType={businessType}
                currentUser={currentUser}
                storeId={STORE_ID}
                storeName={activeStore?.name ?? "Pétion-Ville"}
                inventoryVersion={inventoryVersion}
                onInventorySaved={() => setInventoryVersion(v => v + 1)}
                onOpenStore={() => setShowStore(true)}
                onOpenTeam={() => setShowTeam(true)}
                onAddSale={(c) => { setPosAttachCustomer(c); setTab("pos"); }}
                onLogout={async () => {
                  try {
                    const { getDb } = await import("./src/db");
                    const { clearCartDraft } = await import("./src/sales/cartDraft");
                    await clearCartDraft(await getDb(), STORE_ID, currentUser?.id ?? null);
                  } catch {}
                  auth.signOut();
                }}
                userStoreIds={userStoreIds}
                stores={stores}
                deviceId={deviceId}
              />
            )}
          </>
        )}
      </View>

      {!showAccountCenter && !showSecurity && !showStore && !showShift && !showInventory && <BottomNav active={tab} onChange={(t) => { setShowTeam(false); if (t === "more" && tab === "more") setMoreKey(k => k + 1); setTab(t); }} />}
      {/* Round draggable tabs FAB — root level, floats above header, nav and screens */}
      <TabsFab onOpen={onTabFABOpen} />
    </SafeAreaView>
  );
}
