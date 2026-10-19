import React, { useMemo, useState, useRef, useEffect } from "react";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, StyleSheet, Animated, Easing, KeyboardAvoidingView, Platform, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../../theme";
import { useResponsive } from "../../responsive";
import { storeIdForLocation } from "../../org";
import { getDb } from "../../db";
import { EmployeeProfileBody } from "../../components/EmployeeProfile";
import { ModalScreen, CustomerProfileHeader } from "../../components/CustomerProfile";
import { PhoneField, CountryDialPicker } from "../../components/CustomerForm";
import { formatPhoneDigits, normalizePhoneInput, inferPhoneIso } from "../../phoneFormat";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";
import { isValidEmail } from "../../pickup-staging/useOnline";
import { supabase, middlewareUrl } from "../../auth/supabase";
import { fmtG } from "../../format";
import { orgIdOf, ensurePayPeriod, expectedPayment, paymentHistory, periodById, periodDeficitRows, recordSalaryChange, salaryCacheString, peerSalaryHint } from "../../payroll";

const GOLD = palette.accentGold;
const GOLD_SOFT = palette.accentGoldSoft;
const GOLD_BD = "#E3D6B8";

export type Employee = {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
  salary: string;
  address?: string;
  store?: string;
  isOnline?: boolean;
  active: boolean;
  secret: string;
  password: string;
  lastAction: string;
  kpi: string;
  emergency?: { name: string; address: string; phone: string } | null;
};

const ROLE_META: Record<string, { label: string; color: string; bg: string; bd: string }> = {
  owner: { label: "OWNER", color: "#7A5C10", bg: GOLD_SOFT, bd: GOLD_BD },
  admin: { label: "ADMIN", color: "#1E40AF", bg: "#EFF6FF", bd: "#BFDBFE" },
  manager: { label: "MANAGER", color: "#92400E", bg: "#FFFBEB", bd: "#FDE68A" },
  cashier: { label: "KESYE", color: "#6D28D9", bg: "#F5F3FF", bd: "#DDD6FE" },
  associate: { label: "ASOSYE", color: "#0F766E", bg: "#F0FDFA", bd: "#99F6E4" },
  cook: { label: "KUIZINYE", color: "#9A3412", bg: "#FFF7ED", bd: "#FED7AA" },
};

// "Modifye wòl" option labels — team roles show in Kreyol (Asosye/Kuizinye)
// so the tap-through reads like the rest of the app, not raw role slugs.
const ROLE_OPTION_LABEL: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  associate: "Asosye",
  cook: "Kuizinye",
};

const STORE_LABELS: Record<string, string> = {
  Petyonvil: "Pétion-Ville",
  Dèlma: "Dèlma",
  Sant: "Sant",
};

// Role-default monthly salary (goud) shown PREFILLED in the add form — the
// owner edits it freely; it only tracks the role while the owner never
// touched the field (smart default, not a lock).
const ROLE_SALARY_DEFAULT: Record<string, number> = {
  admin: 32000, manager: 25000, cashier: 12000, associate: 12000, cook: 12000,
};
const HT_MONTHS = ["Jan", "Fev", "Mas", "Avr", "Me", "Jen", "Jiy", "Out", "Sep", "Okt", "Nov", "Des"];
function periodLabel(startDate: string, endDate: string): string {
  const s = String(startDate ?? "").split("-");
  const e = String(endDate ?? "").split("-");
  const sm = HT_MONTHS[Number(s[1]) - 1] ?? s[1];
  const em = HT_MONTHS[Number(e[1]) - 1] ?? e[1];
  if (s[0] === e[0] && s[1] === e[1]) return `${sm} ${s[0]}`;
  return `${sm} ${s[0]} → ${em} ${e[0]}`;
}

/** Strong typable password: 12 chars, ambiguous glyphs (0/O/1/l) removed so a
 * cashier can read it off a screen and type it on a register keyboard. */
function randomPassword(length = 12): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Dark field styling — mirrors CustomerForm's darkInput so the staff edit
// form reads exactly like the customer edit form.
const DARK_FIELD = {
  backgroundColor: "#0a0a0a",
  borderWidth: 1,
  borderColor: "#3a3a3c",
  borderRadius: 12,
  height: 60,
  paddingHorizontal: 16,
  fontSize: 16,
  color: "#fff",
} as const;

type Props = {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  role: string;
  currentUser?: any;
  activeStore: string;
  userStoreIds?: string[];
  editingEmp: any | null;
  setEditingEmp: (e: any | null) => void;
  editEmpRole: string;
  setEditEmpRole: (r: string) => void;
  resetTarget: any | null;
  setResetTarget: (e: any | null) => void;
  selfEditEmp: any | null;
  setSelfEditEmp: (e: any | null) => void;
  selfSecret: string;
  setSelfSecret: (s: string) => void;
  selfPassword: string;
  setSelfPassword: (s: string) => void;
  newEmpName: string;
  setNewEmpName: (s: string) => void;
  newEmpRole: string;
  setNewEmpRole: (s: string) => void;
  newEmpSalary: string;
  setNewEmpSalary: (s: string) => void;
  newEmpEmail: string;
  setNewEmpEmail: (s: string) => void;
  newEmpAddress: string;
  setNewEmpAddress: (s: string) => void;
  newEmpEmergName: string;
  setNewEmpEmergName: (s: string) => void;
  newEmpEmergAddress: string;
  setNewEmpEmergAddress: (s: string) => void;
  newEmpError: string;
  setNewEmpError: (s: string) => void;
  canManageEmployees: boolean;
  canAddRole: (targetRole: string) => boolean;
  canEditRoleFor: (target: any, newRole: string) => boolean;
  canAffect: (target: any) => boolean;
  canToggle: (target: any) => boolean;
  canResetOther: (target: any) => boolean;
  canChangeSelf: (target: any) => boolean;
  canEditSalary: (target: any) => boolean;
  addRoleOptions: string[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
};

export default function TeamScreen({
  employees, setEmployees, currentUser, role, activeStore, userStoreIds = [],
  editingEmp, setEditingEmp, editEmpRole, setEditEmpRole,
  resetTarget, setResetTarget,
  selfEditEmp, setSelfEditEmp, selfSecret, setSelfSecret, selfPassword, setSelfPassword,
  newEmpName, setNewEmpName, newEmpRole, setNewEmpRole,
  newEmpSalary, setNewEmpSalary,
  newEmpEmail, setNewEmpEmail,
  newEmpAddress, setNewEmpAddress,
  newEmpEmergName, setNewEmpEmergName,
  newEmpEmergAddress, setNewEmpEmergAddress,
  newEmpError, setNewEmpError,
  canManageEmployees, canAddRole, canEditRoleFor, canAffect, canToggle, canResetOther, canChangeSelf, canEditSalary,
  addRoleOptions, showAdd, setShowAdd,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilter, setDraftFilter] = useState<"all" | "active" | "inactive">("all");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [empStats, setEmpStats] = useState({ sales: 0, total: 0 });
  // Refetch on every open (id transition null↔id) — same-object reopens
  // would otherwise skip the fetch and show stale zeros.
  const selectedEmpId = selectedEmp?.id ?? null;
  const selectedEmpName = String(selectedEmp?.name ?? "").trim().toLowerCase();
  useEffect(() => {
    if (!selectedEmpId) return;
    (async () => {
      try {
        const db = await getDb();
        const allSales = ((await db.getAllAsync("SELECT * FROM sales").catch(() => [])) as any[]) ?? [];
        // Receipts snapshot the cashier too (id + name columns) — second
        // attribution path for sales stamped under a different login id or
        // before seller_id existed.
        const allReceipts = ((await db.getAllAsync("SELECT sale_id, cashier_id, cashier_name FROM receipts").catch(() => [])) as any[]) ?? [];
        const receiptSaleIds = new Set(
          allReceipts
            .filter(r => String(r.cashier_id ?? "") === selectedEmpId || String(r.cashier_name ?? "").trim().toLowerCase() === selectedEmpName)
            .map(r => r.sale_id)
        );
        const mine = allSales.filter(s =>
          String(s.status ?? "") !== "cancelled" &&
          (String(s.seller_id ?? "") === selectedEmpId || receiptSaleIds.has(s.id))
        );
        setEmpStats({ sales: mine.length, total: mine.reduce((a: number, s: any) => a + Number(s.total ?? s.amount ?? s.subtotal ?? 0), 0) });
      } catch { setEmpStats({ sales: 0, total: 0 }); }
    })();
  }, [selectedEmpId, selectedEmpName]);
  const [empNameCollapsed, setEmpNameCollapsed] = useState(false);
  const titleFade = useRef(new Animated.Value(0)).current;
  const detailScrollRef = useRef<any>(null);
  const empLastName = useMemo(() => {
    const parts = String(selectedEmp?.name ?? "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(1).join(" ") || parts[0] || "";
  }, [selectedEmp]);
  useEffect(() => {
    Animated.timing(titleFade, { toValue: empNameCollapsed ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [empNameCollapsed, titleFade]);
  useEffect(() => {
    setEmpNameCollapsed(false);
    detailScrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [selectedEmp]);
  const [modalView, setModalView] = useState<"detail" | "edit" | "selfEdit" | "reset" | "email" | "info" | "emerg" | "salary" | "paymentDetail">("detail");
  // Email edit (owner-only) + last generated temp credential (shown so the
  // owner can hand it over — previously generated silently and lost).
  const [emailInput, setEmailInput] = useState("");
  // Personal-info edit form (customer-edit style): strict superior only,
  // never the owner as target; email field owner-only (read-only "Owner"
  // chip otherwise); phone uses the customer PhoneField (flag + mask).
  const [infoName, setInfoName] = useState("");
  const [infoPhoneDigits, setInfoPhoneDigits] = useState("");
  const [infoPhoneIso, setInfoPhoneIso] = useState("HT");
  const [infoDialOpen, setInfoDialOpen] = useState(false);
  const [infoEmail, setInfoEmail] = useState("");
  const [infoAddress, setInfoAddress] = useState("");
  // Emergency-contact edit form (same gates as personal info).
  const [emergName, setEmergName] = useState("");
  const [emergPhoneDigits, setEmergPhoneDigits] = useState("");
  const [emergPhoneIso, setEmergPhoneIso] = useState("HT");
  const [emergDialOpen, setEmergDialOpen] = useState(false);
  const [emergAddress, setEmergAddress] = useState("");
  const [resetResult, setResetResult] = useState<{ label: string; value: string } | null>(null);
  // Payroll (028): live expected payment + closed-payment history for the
  // selected employee, and the two payroll sheets (salary edit + breakdown).
  const [empPayroll, setEmpPayroll] = useState<{ salary: number; deficits: number; expected: number; periodLabel: string } | null>(null);
  const [empPayments, setEmpPayments] = useState<Array<any>>([]);
  const [payrollVersion, setPayrollVersion] = useState(0);
  const [salaryEmp, setSalaryEmp] = useState<Employee | null>(null);
  const [salaryInput, setSalaryInput] = useState("");
  const [paymentDetail, setPaymentDetail] = useState<{ payment: any; label: string; range: string; deficits: any[] } | null>(null);
  // Payroll (028): live expected payment + closed-payment history for the
  // selected employee. Re-runs when payrollVersion bumps (after any salary
  // write) so the figures never go stale.
  useEffect(() => {
    if (!selectedEmpId || !selectedEmp || !canSeeSalary(selectedEmp)) {
      setEmpPayroll(null);
      setEmpPayments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        const orgId = await orgIdOf(db);
        const period = await ensurePayPeriod(db, orgId);
        const exp = await expectedPayment(db, selectedEmpId, period);
        const pays = await paymentHistory(db, selectedEmpId);
        const rows: any[] = [];
        for (const p of (pays ?? []).slice(0, 8)) {
          const per = await periodById(db, String((p as any).period_id ?? ""));
          rows.push({
            ...p,
            label: per ? periodLabel(per.start_date, per.end_date) : String((p as any).closed_at ?? "").slice(0, 10),
            range: per ? `${per.start_date} → ${per.end_date}` : "",
          });
        }
        if (!cancelled) {
          setEmpPayroll({ ...exp, periodLabel: periodLabel(period.start_date, period.end_date) });
          setEmpPayments(rows);
        }
      } catch {
        if (!cancelled) { setEmpPayroll(null); setEmpPayments([]); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpId, (selectedEmp as any)?.salary, (selectedEmp as any)?.active, payrollVersion]);
  // Owner-only email editing for any employee (own included).
  const canEditEmail = () => role === "owner";
  // Staff edit their OWN profile (name/phone/address/emergency); a strict
  // superior edits anyone below (never the owner as target). Email stays
  // owner-only via canEditEmail.
  const canEditInfo = (t: any) => t?.id === currentUser?.id || (t?.role !== "owner" && canAffect(t));
  const [resetTargetEmp, setResetTargetEmp] = useState<Employee | null>(null);
  const { width, isTablet, padH } = useResponsive();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: modalView === "detail" ? 0 : 1,
      duration: modalView === "detail" ? 250 : 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [modalView]);

  const slide = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const opacity = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const currentStore = activeStore || currentUser?.store || "Petyonvil";

  const LEVEL: Record<string, number> = { owner: 4, admin: 3, manager: 2, cashier: 1, associate: 1, cook: 1 };

  // Phase 4 matrix — store scope via the employee<->store relationship, then
  // role subsets: owner sees everything; admin sees self + managers/cashiers/
  // associates/cooks in his stores (never other admins); manager sees self +
  // cashiers/associates/cooks in his stores.
  const myStoreIds = userStoreIds.length ? userStoreIds : [storeIdForLocation(currentUser?.store)];
  const inMyStores = (e: Employee) =>
    role === "owner" ? true : myStoreIds.includes(storeIdForLocation((e as any).store));
  const visibleEmployees = useMemo(() => {
    const inScope = employees.filter(e => inMyStores(e) || e.role === "owner");
    if (role === "owner") return inScope;
    if (role === "admin") {
      return inScope.filter(e =>
        ["manager", "cashier", "associate", "cook"].includes(e.role) ||
        (e.role === "admin" && e.id === currentUser?.id)
      );
    }
    if (role === "manager") {
      return inScope.filter(e =>
        ["cashier", "associate", "cook"].includes(e.role) || e.id === currentUser?.id
      );
    }
    return [];
  }, [employees, role, currentUser?.id, myStoreIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSeeSalary = (e: Employee) => {
    if (role !== "admin") return true;
    if (e.role !== "admin") return true;
    return e.id === currentUser?.id;
  };

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = visibleEmployees;
    if (filter === "active") result = result.filter(e => e.active);
    if (filter === "inactive") result = result.filter(e => !e.active);
    if (q) {
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        String(e.phone ?? "").toLowerCase().includes(q) ||
        String(e.salary ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [visibleEmployees, search, filter]);

  const toggleActive = (e: Employee) => {
    if (e.role === "owner") { Alert.alert("Pa ka dezaktive Owner."); return; }
    setEmployees(prev => prev.map(x => (x.id === e.id ? { ...x, active: !x.active } : x)));
  };

  const IOSToggle = ({ value, onToggle }: { value: boolean; onToggle: () => void }) => (
    <Pressable
      onPress={onToggle}
      style={{
        width: 51, height: 31, borderRadius: 16,
        backgroundColor: value ? "#34C759" : "#E5E5EA",
        justifyContent: "center",
        padding: 2,
        shadowColor: value ? "#34C759" : "#000",
        shadowOpacity: value ? 0.2 : 0.04,
        shadowRadius: value ? 8 : 4,
        shadowOffset: { width: 0, height: value ? 3 : 1 },
      }}
    >
      <View style={{
        width: 27, height: 27, borderRadius: 14,
        backgroundColor: "white",
        marginLeft: value ? 22 : 0,
        shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
      }} />
    </Pressable>
  );

  // Customer-edit-style dark form for staff general info. Valid gates the
  // header Save pill (same pattern as CustomersScreen's edit sheet).
  const infoValid =
    !!selectedEmp &&
    infoName.trim().length > 0 &&
    (!infoEmail.trim() || isValidEmail(infoEmail.trim()));

  function openInfoForm() {
    if (!selectedEmp) return;
    const stored = String((selectedEmp as any).phone ?? "");
    setInfoName(String(selectedEmp.name ?? ""));
    setInfoPhoneDigits(normalizePhoneInput(stored));
    setInfoPhoneIso(inferPhoneIso(stored) || "HT");
    setInfoEmail(String((selectedEmp as any).email ?? ""));
    setInfoAddress(String((selectedEmp as any).address ?? ""));
    setInfoDialOpen(false);
    setModalView("info");
  }

  function openEmergForm() {
    if (!selectedEmp) return;
    const em = (selectedEmp as any).emergency ?? { name: "", phone: "", address: "" };
    const stored = String(em.phone ?? "");
    setEmergName(String(em.name ?? ""));
    setEmergPhoneDigits(normalizePhoneInput(stored));
    setEmergPhoneIso(inferPhoneIso(stored) || "HT");
    setEmergAddress(String(em.address ?? ""));
    setEmergDialOpen(false);
    setModalView("emerg");
  }

  // Emergency form: all-optional — everything empty clears the section; if
  // anything is filled, the contact's name becomes required.
  const emergHasAny = !!(emergName.trim() || emergPhoneDigits || emergAddress.trim());
  const emergValid = !emergHasAny || emergName.trim().length > 0;

  /** Modifye salè (owner/admin, strict superior): opens with the CURRENT
   * amount — the cache digits, else the role default. Append-only history. */
  function openSalaryForm() {
    if (!selectedEmp) return;
    const digits = Math.round(Number(String(selectedEmp.salary ?? "").replace(/[^0-9.]/g, "")) || 0);
    setSalaryEmp(selectedEmp);
    setSalaryInput(String(digits || ROLE_SALARY_DEFAULT[selectedEmp.role] || 12000));
    setModalView("salary");
  }
  const salaryValid = (Number(String(salaryInput).replace(/[^0-9.]/g, "")) || 0) > 0;

  async function saveSalary() {
    if (!salaryEmp) return;
    const amount = Math.round(Number(String(salaryInput).replace(/[^0-9.]/g, "")) || 0);
    if (amount <= 0) { Alert.alert("Montan envalid", "Antre yon salè ki pi gran pase zewo."); return; }
    try {
      const db = await getDb();
      const orgId = await orgIdOf(db);
      // Append-only: a NEW dated row; the previous salary stays in history.
      await recordSalaryChange(db, { employeeId: salaryEmp.id, amount, orgId, storeId: storeIdForLocation(currentStore) });
      const shown = salaryCacheString(amount);
      setEmployees(prev => prev.map(x => x.id === salaryEmp.id ? { ...x, salary: shown } : x));
      setSelectedEmp(prev => (prev && prev.id === salaryEmp.id ? { ...prev, salary: shown } : prev));
      setPayrollVersion(v => v + 1);
    } catch { Alert.alert("Erè", "Salè a pa t ka anrejistre."); return; }
    setSalaryEmp(null);
    setModalView("detail");
  }

  /** Breakdown for one closed payment: the deficits netted at close. */
  async function openPaymentDetail(p: any) {
    if (!selectedEmp) return;
    try {
      const db = await getDb();
      const per = await periodById(db, String(p?.period_id ?? ""));
      const rows = per ? await periodDeficitRows(db, selectedEmp.id, per) : [];
      setPaymentDetail({
        payment: p,
        label: p?.label ?? "",
        range: per ? `${per.start_date} → ${per.end_date}` : "",
        deficits: rows as any[],
      });
      setModalView("paymentDetail");
    } catch {}
  }

  function saveInfo() {
    if (!selectedEmp) return;
    if (!canEditInfo(selectedEmp)) { Alert.alert("Pa gen dwa", "Se yon siperyè strik ka modifye enfòmasyon sa a."); return; }
    if (!infoName.trim()) { Alert.alert("Non obligatwa", "Non anplwaye pa ka vid."); return; }
    if (infoEmail.trim() && !isValidEmail(infoEmail.trim())) { Alert.alert("Imel valab", "Antre yon imel valab oswa kite chèn an vid."); return; }
    const patch: Partial<Employee> = {
      name: infoName.trim(),
      phone: infoPhoneDigits ? formatPhoneDigits(infoPhoneDigits, infoPhoneIso) : "",
      address: infoAddress.trim(),
    };
    if (canEditEmail()) (patch as any).email = infoEmail.trim().toLowerCase();
    setEmployees(prev => prev.map(x => x.id === selectedEmp.id ? { ...x, ...patch } : x));
    setSelectedEmp({ ...selectedEmp, ...patch } as Employee);
    setModalView("detail");
  }

  function saveEmergency() {
    if (!selectedEmp) return;
    if (!canEditInfo(selectedEmp)) { Alert.alert("Pa gen dwa", "Se yon siperyè strik ka modifye enfòmasyon sa a."); return; }
    if (emergHasAny && !emergName.trim()) { Alert.alert("Non obligatwa", "Non kontak obligatwa si ou ranpli lòt chèn yo."); return; }
    const emergency = emergHasAny
      ? { name: emergName.trim(), phone: emergPhoneDigits ? formatPhoneDigits(emergPhoneDigits, emergPhoneIso) : "", address: emergAddress.trim() }
      : null;
    setEmployees(prev => prev.map(x => x.id === selectedEmp.id ? { ...x, emergency } : x));
    setSelectedEmp({ ...selectedEmp, emergency } as Employee);
    setModalView("detail");
  }

  // ── Add staff (customer-add style sheet) ──
  // Phones use the customer PhoneField (digits + country mask). On Kreye the
  // middleware creates the GoTrue login + cloud profile and emails the temp
  // password; the response carries the password ONCE for the creator to copy.
  const [newEmpPhoneDigits, setNewEmpPhoneDigits] = useState("");
  const [newEmpPhoneIso, setNewEmpPhoneIso] = useState("HT");
  const [newEmpDialOpen, setNewEmpDialOpen] = useState(false);
  const [newEmpEmergPhoneDigits, setNewEmpEmergPhoneDigits] = useState("");
  const [newEmpEmergPhoneIso, setNewEmpEmergPhoneIso] = useState("HT");
  const [newEmpEmergDialOpen, setNewEmpEmergDialOpen] = useState(false);
  const [addView, setAddView] = useState<"form" | "done">("form");
  const [addSaving, setAddSaving] = useState(false);
  const [addResult, setAddResult] = useState<{ password: string; pin: string; emailSent: boolean } | null>(null);

  const addPhoneOk = newEmpPhoneDigits.length >= 7;
  const addEmergHasAny = !!(newEmpEmergName.trim() || newEmpEmergPhoneDigits || newEmpEmergAddress.trim());
  const addValid =
    !!newEmpName.trim() && addPhoneOk && isValidEmail(newEmpEmail.trim()) &&
    !!newEmpAddress.trim() && canAddRole(newEmpRole) && (!addEmergHasAny || !!newEmpEmergName.trim());

  function resetAddForm() {
    setNewEmpName(""); setNewEmpRole("cashier"); setNewEmpEmail(""); setNewEmpAddress("");
    setNewEmpSalary(String(ROLE_SALARY_DEFAULT.cashier));
    setNewEmpEmergName(""); setNewEmpEmergAddress(""); setNewEmpError("");
    setNewEmpPhoneDigits(""); setNewEmpPhoneIso("HT");
    setNewEmpEmergPhoneDigits(""); setNewEmpEmergPhoneIso("HT");
    setNewEmpDialOpen(false); setNewEmpEmergDialOpen(false);
    setAddView("form"); setAddResult(null); setAddSaving(false);
  }
  function closeAdd() { setShowAdd(false); resetAddForm(); }

  async function submitAddStaff() {
    if (addSaving || !addValid) return;
    setNewEmpError("");
    const norm = (s: any) => String(s ?? "").trim().toLowerCase();
    const phone = formatPhoneDigits(newEmpPhoneDigits, newEmpPhoneIso);
    const dup = employees.some(x =>
      norm(x?.name) === norm(newEmpName) ||
      (phone !== "" && String(x?.phone ?? "").trim() === phone)
    );
    if (dup) { setNewEmpError("Anplwaye sa a egziste deja."); return; }
    setAddSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch(`${middlewareUrl}/api/staff/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          store_id: storeIdForLocation(currentStore),
          email: newEmpEmail.trim().toLowerCase(),
          full_name: newEmpName.trim(),
          role: newEmpRole,
        }),
      });
      const out = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const msg =
          res.status === 409 ? "Imel sa a gen kont deja." :
          res.status === 401 || res.status === 403 ? "Ou pa gen dwa ajoute anplwaye." :
          String(out?.message ?? "Kreye kont la echwe.");
        setNewEmpError(msg);
        return;
      }
      const id = String(out.user_id);
      const salaryAmount = Math.round(Number(String(newEmpSalary).replace(/[^0-9.]/g, "")) || 0);
      // Payroll (028): the visible add-form salary becomes the FIRST dated
      // salary_history row (employees.salary stays a display cache).
      if (salaryAmount > 0) {
        try {
          const db = await getDb();
          const orgId = await orgIdOf(db);
          await recordSalaryChange(db, { employeeId: id, amount: salaryAmount, orgId, storeId: storeIdForLocation(currentStore) });
        } catch {}
      }
      setEmployees(prev => [...prev, {
        id,
        name: newEmpName.trim(),
        role: newEmpRole as any,
        phone,
        email: newEmpEmail.trim().toLowerCase(),
        address: newEmpAddress.trim(),
        store: currentStore,
        emergency: addEmergHasAny
          ? { name: newEmpEmergName.trim(), phone: newEmpEmergPhoneDigits ? formatPhoneDigits(newEmpEmergPhoneDigits, newEmpEmergPhoneIso) : "", address: newEmpEmergAddress.trim() }
          : null,
        secret: String(out.pin ?? "0000"),
        password: String(out.password ?? ""),
        lastAction: "Nouvo manm",
        kpi: "—",
        salary: salaryAmount > 0 ? salaryCacheString(salaryAmount) : (newEmpRole === "admin" ? "G 32 000" : newEmpRole === "manager" ? "G 25 000" : "G 12 000"),
        isOnline: false,
        active: true,
      } as any]);
      setAddResult({ password: String(out.password ?? ""), pin: String(out.pin ?? ""), emailSent: !!out.email_sent });
      setAddView("done");
    } catch {
      setNewEmpError("Kreye kont la mande entènèt.");
    } finally {
      setAddSaving(false);
    }
  }

  // Shared employee-detail body (profile / edit-role / self-edit / reset).
  // Phone shows it inside the full-screen detail Modal below; the tablet
  // two-panel layout renders the same content in the right pane instead.
  const detailContent = (
    <>
            {modalView === "detail" ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setSelectedEmp(null)} accessibilityLabel="Close" hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={31} color="#fff" />
                  </Pressable>
                  <Animated.View style={{ flex: 1, opacity: titleFade }}>
                    <Text style={{ textAlign: "center", fontWeight: "800", fontSize: 18, color: "#fff" }} numberOfLines={1}>{empLastName}</Text>
                  </Animated.View>
                  {selectedEmp && canEditInfo(selectedEmp) ? (
                  <Pressable
                    onPress={openInfoForm}
                    accessibilityLabel="Edit"
                    style={{ height: 44, paddingHorizontal: 24, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ fontWeight: "800", fontSize: 15, color: "#000" }}>Edit</Text>
                  </Pressable>
                ) : (
                  <View style={{ width: 44 }} />
                )}
                </View>

            {modalView === "detail" && selectedEmp && <KeyboardSafeScrollView ref={detailScrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1, marginTop: 6 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={e => setEmpNameCollapsed(e.nativeEvent.contentOffset.y > 100)}>
              <View style={{ marginTop: 10 }}>
              <EmployeeProfileBody
                employee={selectedEmp}
                stats={empStats}
                canSeeSalary={canSeeSalary(selectedEmp)}
                roleLabel={(ROLE_META[selectedEmp.role] ?? ROLE_META.cashier).label}
                storeLabel={STORE_LABELS[selectedEmp.store ?? ""] ?? selectedEmp.store}
                isSelf={selectedEmp.id === currentUser?.id}
                canToggleActive={canToggle(selectedEmp)}
                canEditRole={canAffect(selectedEmp) && selectedEmp.role !== "owner" && selectedEmp.id !== currentUser?.id}
                canEditCredentials={canChangeSelf(selectedEmp) || canResetOther(selectedEmp)}
                canEditEmail={canEditEmail()}
                canEditEmergency={canEditInfo(selectedEmp)}
                canEditSalary={canEditSalary(selectedEmp)}
                payroll={empPayroll}
                payments={empPayments}
                onOpenPayment={openPaymentDetail}
                onEditSalary={openSalaryForm}
                onEditEmail={() => { setEmailInput(String((selectedEmp as any)?.email ?? "")); setResetResult(null); setModalView("email"); }}
                onEditEmergency={openEmergForm}
                onToggleActive={() => { toggleActive(selectedEmp); setSelectedEmp({ ...selectedEmp, active: !selectedEmp.active }); }}
                onEditRole={() => { setEditingEmp(selectedEmp); setEditEmpRole(selectedEmp.role); setModalView("edit"); }}
                onEditCredentials={() => {
                  if (canChangeSelf(selectedEmp)) { setSelfEditEmp(selectedEmp); setSelfSecret(""); setSelfPassword(""); setModalView("selfEdit"); }
                  else { setResetTargetEmp(selectedEmp); setResetResult(null); setModalView("reset"); }
                }}
              />
              </View>
            </KeyboardSafeScrollView>}
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingRight: 16 }}>
                    <Text style={{ fontSize: 24, color: "#fff", fontWeight: "500", lineHeight: 24 }}>‹</Text>
                    <Text style={{ fontSize: 16, color: "#fff", fontWeight: "500", marginLeft: 4 }}>Dèyè</Text>
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  {modalView === "info" || modalView === "emerg" || modalView === "salary" ? (
                    (() => {
                      const valid = modalView === "emerg" ? emergValid : modalView === "salary" ? salaryValid : infoValid;
                      const onSave = modalView === "emerg" ? saveEmergency : modalView === "salary" ? saveSalary : saveInfo;
                      return (
                        <Pressable
                          onPress={onSave}
                          disabled={!valid}
                          style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: valid ? "#fff" : "#2b2b2b" }}
                        >
                          <Text style={{ fontWeight: "800", fontSize: 15, color: valid ? "#000" : "#6e6e73" }}>Save</Text>
                        </Pressable>
                      );
                    })()
                  ) : null}
                </View>
                <KeyboardSafeScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1, marginTop: 6 }} contentContainerStyle={{ paddingBottom: 24 }}>

            {/* Edit role — inside modal (dark sheet, black chrome) */}
            {modalView === "edit" && editingEmp && (
              <Animated.View style={{ padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff", letterSpacing: -0.4 }}>Modifye wòl</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", textAlign: "center", marginTop: 2 }}>{ROLE_OPTION_LABEL[editingEmp.role] ?? editingEmp.role} → {ROLE_OPTION_LABEL[editEmpRole] ?? editEmpRole}</Text>
                </View>
                {editingEmp.role === "owner" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#1a0d0d", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#5a1a1a" }}>
                    <Ionicons name="alert-circle" size={18} color="#FF453A" />
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: "#FF453A" }}>Pa ka modifye aksè Owner.</Text>
                  </View>
                ) : null}
                {editingEmp.id === currentUser?.id && role === "admin" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#241a05", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#5a451a" }}>
                    <Ionicons name="alert-circle" size={18} color="#FFD60A" />
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: "#FFD60A" }}>Admin pa ka bese tèt li.</Text>
                  </View>
                ) : null}
                <View style={{ gap: 6 }}>
                  <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Nouvo wòl</Text>
                  <View style={{ backgroundColor: "#0a0a0a", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    {(["admin", "manager", "cashier", "associate", "cook"] as const).filter(r => canEditRoleFor(editingEmp, r)).map((r, i, arr) => (
                      <Pressable key={r} onPress={() => setEditEmpRole(r)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: "#3a3a3c" }}>
                        <Ionicons name="person-outline" size={18} color="#8e8e93" style={{ marginRight: 12 }} />
                        <Text style={{ flex: 1, fontSize: 15, color: "#fff", fontWeight: "500" }}>{ROLE_OPTION_LABEL[r] ?? r}</Text>
                        {editEmpRole === r && <Ionicons name="checkmark-circle" size={20} color="#fff" />}
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#2b2b2b", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#fff" }}>Anile</Text></Pressable>
                  <Pressable
                    onPress={() => {
                      if (!canEditRoleFor(editingEmp, editEmpRole as any)) { Alert.alert("Refize", "Pa ka pwomouvwa nan Owner, pa ka manyen Owner, Admin pa ka bese tèt li."); return; }
                      setEmployees(prev => prev.map(x => x.id === editingEmp.id ? { ...x, role: editEmpRole as any } : x));
                      setSelectedEmp(null); setModalView("detail");
                    }}
                    style={{ flex: 1, paddingVertical: 14, backgroundColor: canEditRoleFor(editingEmp, editEmpRole as any) ? "#fff" : "#2b2b2b", borderRadius: 12, alignItems: "center" }}>
                    <Text style={{ color: canEditRoleFor(editingEmp, editEmpRole as any) ? "#000" : "#6e6e73", fontWeight: "700", fontSize: 15 }}>Anrejistre</Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Self edit — inside modal (dark sheet, black chrome) */}
            {modalView === "selfEdit" && selfEditEmp && (
              <Animated.View style={{ padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff", letterSpacing: -0.4 }}>Chanje pa mwen</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", textAlign: "center", marginTop: 2 }}>Se sèlman ou ki ka chanje kòd / modpas ou.</Text>
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", color: "#9C7A1E", letterSpacing: 0.8, textTransform: "uppercase" }}>Modpas / Kòd</Text>
                  <View style={{ backgroundColor: "#0a0a0a", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#3a3a3c" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                      <Ionicons name="key-outline" size={18} color="#8e8e93" style={{ position: "absolute", left: 14 }} />
                      <TextInput placeholder="Nouvo kòd — kite vid" placeholderTextColor="#8e8e93" value={selfSecret} onChangeText={setSelfSecret} secureTextEntry style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#fff" }} />
                    </View>
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: "#3a3a3c", marginLeft: 44 }} />
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                      <Ionicons name="lock-closed-outline" size={18} color="#8e8e93" style={{ position: "absolute", left: 14 }} />
                      <TextInput placeholder="Nouvo modpas — kite vid" placeholderTextColor="#8e8e93" value={selfPassword} onChangeText={setSelfPassword} secureTextEntry style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#fff" }} />
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#2b2b2b", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#fff" }}>Anile</Text></Pressable>
                  <Pressable
                    onPress={() => {
                      if (!selfSecret.trim() && !selfPassword.trim()) { Alert.alert("Antre kòd oswa modpas"); return; }
                      setEmployees(prev => prev.map(x => x.id === selfEditEmp.id ? { ...x, secret: selfSecret.trim() || x.secret, password: selfPassword.trim() || x.password } : x));
                      setSelfEditEmp(null); setSelfSecret(""); setSelfPassword(""); setSelectedEmp(null); setModalView("detail");
                    }}
                    style={{ flex: 1, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>Anrejistre pa mwen</Text></Pressable>
                </View>
              </Animated.View>
            )}

            {/* General-info edit — customer-edit-style dark form; strict
                superior, never owner; email editable by owner only. */}
            {modalView === "info" && selectedEmp && (
              <Animated.View style={{ transform: [{ translateX: slide }], opacity }}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 }}>Modifye enfòmasyon</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 18 }}>{selectedEmp.name}</Text>

                <View style={{ marginBottom: 12 }}>
                  <TextInput value={infoName} onChangeText={setInfoName} placeholder="Non konplè" placeholderTextColor="#8e8e93" style={DARK_FIELD} />
                </View>
                <PhoneField
                  value={infoPhoneDigits}
                  onChange={setInfoPhoneDigits}
                  country={infoPhoneIso}
                  onPressFlag={() => setInfoDialOpen(true)}
                />
                {!canEditEmail() ? (
                  <View style={{ alignItems: "flex-end", marginBottom: 6 }}>
                    <View style={{ backgroundColor: "#2b2b2b", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: "#8e8e93" }}>Owner</Text>
                    </View>
                  </View>
                ) : null}
                <View style={{ marginBottom: 12 }}>
                  <TextInput
                    value={infoEmail}
                    onChangeText={setInfoEmail}
                    editable={canEditEmail()}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Imel"
                    placeholderTextColor="#8e8e93"
                    style={[DARK_FIELD, canEditEmail() ? null : { opacity: 0.55 }]}
                  />
                </View>
                <View style={{ marginBottom: 12 }}>
                  <TextInput value={infoAddress} onChangeText={setInfoAddress} placeholder="Adrès" placeholderTextColor="#8e8e93" multiline textAlignVertical="top" style={[DARK_FIELD, { height: 96, paddingTop: 14 }]} />
                </View>
                <Text style={{ color: "#8e8e93", fontSize: 12 }}>Non obligatwa; lòt chèn yo opsyonèl. Imel: sèlman Owner ka modifye l.</Text>
                <CountryDialPicker
                  visible={infoDialOpen}
                  onClose={() => setInfoDialOpen(false)}
                  onPick={iso => setInfoPhoneIso(iso)}
                  title="Kòd peyi"
                />
              </Animated.View>
            )}

            {/* Emergency contact — customer-edit-style dark form; same gates
                as personal info. All-optional; empty Save clears the section. */}
            {modalView === "emerg" && selectedEmp && (
              <Animated.View style={{ transform: [{ translateX: slide }], opacity }}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 }}>Kontak ijans</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 18 }}>{selectedEmp.name}</Text>

                <View style={{ marginBottom: 12 }}>
                  <TextInput value={emergName} onChangeText={setEmergName} placeholder="Non kontak" placeholderTextColor="#8e8e93" style={DARK_FIELD} />
                </View>
                <PhoneField
                  value={emergPhoneDigits}
                  onChange={setEmergPhoneDigits}
                  country={emergPhoneIso}
                  onPressFlag={() => setEmergDialOpen(true)}
                />
                <View style={{ marginBottom: 12 }}>
                  <TextInput value={emergAddress} onChangeText={setEmergAddress} placeholder="Adrès kontak" placeholderTextColor="#8e8e93" multiline textAlignVertical="top" style={[DARK_FIELD, { height: 96, paddingTop: 14 }]} />
                </View>
                <Text style={{ color: "#8e8e93", fontSize: 12 }}>Tout chèn yo opsyonèl. Voye tout vid pou effase kontak ijans la.</Text>
                <CountryDialPicker
                  visible={emergDialOpen}
                  onClose={() => setEmergDialOpen(false)}
                  onPick={iso => setEmergPhoneIso(iso)}
                  title="Kòd peyi"
                />
              </Animated.View>
            )}

            {/* Modifye salè — append-only (028): saving writes a NEW dated
                row; the old salary stays in history. Owner/admin, strict
                superior only, inactive targets blocked. */}
            {modalView === "salary" && salaryEmp && (
              <Animated.View style={{ transform: [{ translateX: slide }], opacity }}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 }}>Modifye salè</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 18 }}>{salaryEmp.name} — aktyèlman {salaryEmp.salary} / mwa</Text>
                <TextInput
                  value={salaryInput}
                  onChangeText={v => setSalaryInput(v.replace(/[^0-9]/g, ""))}
                  placeholder="Nouvo salè pa mwa"
                  placeholderTextColor="#8e8e93"
                  keyboardType="number-pad"
                  style={DARK_FIELD}
                />
                {(() => {
                  const hint = peerSalaryHint(Number(salaryInput) || 0, salaryEmp.role, employees, salaryEmp.id);
                  return hint ? <Text style={{ color: "#FFD60A", fontSize: 12, marginTop: 8 }}>{hint}</Text> : null;
                })()}
                <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 10 }}>Chak chanjman se yon nouvo liy date — ansyen salè a rete nan istwa a.</Text>
              </Animated.View>
            )}

            {/* Payment breakdown — one closed payment: salary − period deficits. */}
            {modalView === "paymentDetail" && paymentDetail && (
              <Animated.View style={{ transform: [{ translateX: slide }], opacity }}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 }}>Detay peman</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 18 }}>{paymentDetail.label}{paymentDetail.range ? ` · ${paymentDetail.range}` : ""}</Text>
                <View style={{ backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, padding: 16, marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Salè</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>{fmtG(Number(paymentDetail.payment.salary_amount ?? 0))}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 14 }}>Defisit (sou salè)</Text>
                    <Text style={{ color: "#FF453A", fontSize: 14, fontWeight: "600" }}>− {fmtG(Number(paymentDetail.payment.deficit_total ?? 0))}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#262626", marginVertical: 6 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}>
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Nèt peye</Text>
                    <Text style={{ color: "#30D158", fontSize: 15, fontWeight: "800" }}>{fmtG(Number(paymentDetail.payment.net_amount ?? 0))}</Text>
                  </View>
                </View>
                {paymentDetail.deficits.length ? (
                  <>
                    <Text style={{ color: "#8e8e93", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Defisit peryòd la</Text>
                    {paymentDetail.deficits.map((d: any, i: number) => (
                      <View key={String(d.id ?? i)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderBottomWidth: i < paymentDetail.deficits.length - 1 ? 1 : 0, borderBottomColor: "#262626" }}>
                        <Text style={{ color: "#fff", fontSize: 14 }}>{String(d.date ?? "")}</Text>
                        <Text style={{ color: "#FF453A", fontSize: 14, fontWeight: "600" }}>− {fmtG(Number(d.amount ?? 0))}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </Animated.View>
            )}

            {/* Email edit (owner-only) — inside modal (dark sheet, black chrome) */}
            {modalView === "email" && selectedEmp && (
              <Animated.View style={{ padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff", letterSpacing: -0.4 }}>Modifye imel</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", textAlign: "center", marginTop: 2 }}>{selectedEmp.name}</Text>
                </View>
                <View style={{ backgroundColor: "#0a0a0a", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#3a3a3c" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }}>
                    <Ionicons name="mail-outline" size={18} color="#8e8e93" style={{ position: "absolute", left: 14 }} />
                    <TextInput placeholder="Imel" placeholderTextColor="#8e8e93" value={emailInput} onChangeText={setEmailInput} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, paddingLeft: 30, paddingVertical: 14, fontSize: 15, color: "#fff" }} />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => setModalView("detail")} style={{ flex: 1, paddingVertical: 14, backgroundColor: "#2b2b2b", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: "#fff" }}>Anile</Text></Pressable>
                  <Pressable
                    onPress={() => {
                      if (role !== "owner") { Alert.alert("Pa gen dwa", "Sèlman Owner ka modifye imel."); return; }
                      if (!isValidEmail(emailInput.trim())) { Alert.alert("Imel obligatwa", "Antre yon imel valab."); return; }
                      const next = emailInput.trim().toLowerCase();
                      setEmployees(prev => prev.map(x => x.id === selectedEmp.id ? { ...x, email: next } : x));
                      setSelectedEmp({ ...selectedEmp, email: next } as any);
                      setModalView("detail");
                    }}
                    style={{ flex: 1, paddingVertical: 14, backgroundColor: "#fff", borderRadius: 12, alignItems: "center" }}><Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>Anrejistre</Text></Pressable>
                </View>
              </Animated.View>
            )}

            {/* Reset — inside modal (dark sheet, black chrome) */}
            {modalView === "reset" && resetTargetEmp && (
              <Animated.View style={{ padding: 16, paddingBottom: 28, gap: 16, transform: [{ translateX: slide }], opacity }}>
                <View style={{ alignItems: "center", gap: 2 }}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff", letterSpacing: -0.4 }}>Reyinisyialize</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", textAlign: "center", marginTop: 2 }}>Ou pa wè ansyen kòd/modpas. Reyinisyializasyon fòse itilizatè a mete nouvo pa li menm.</Text>
                </View>
                {resetResult ? (
                  <View style={{ backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 16, padding: 16, alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#a1967f" }}>{resetResult.label}</Text>
                    <Text selectable style={{ fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: 1 }}>{resetResult.value}</Text>
                    <Text style={{ fontSize: 12, color: "#a1967f", textAlign: "center" }}>Bay li bay anplwaye a — l ap disparèt lè w fèmen.</Text>
                  </View>
                ) : (
                <View style={{ backgroundColor: "#0a0a0a", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#3a3a3c" }}>
                  <Pressable onPress={() => { const v = String(1000 + Math.floor(Math.random()*9000)).slice(-4); setEmployees(prev => prev.map(x => x.id === resetTargetEmp.id ? { ...x, secret: v } : x)); setResetResult({ label: "Nouvo kòd tanporè", value: v }); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#3a3a3c" }}>
                    <Ionicons name="key-outline" size={20} color="#FF453A" style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, fontSize: 15, color: "#FF453A", fontWeight: "600" }}>Reyinisyialize kòd</Text>
                    <Ionicons name="chevron-forward" size={18} color="#6e6e73" />
                  </Pressable>
                  <Pressable onPress={() => { const v = randomPassword(); setEmployees(prev => prev.map(x => x.id === resetTargetEmp.id ? { ...x, password: v } : x)); setResetResult({ label: "Nouvo modpas", value: v }); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 14 }}>
                    <Ionicons name="lock-closed-outline" size={20} color="#FF453A" style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, fontSize: 15, color: "#FF453A", fontWeight: "600" }}>Reyinisyialize modpas</Text>
                    <Ionicons name="chevron-forward" size={18} color="#6e6e73" />
                  </Pressable>
                </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <Pressable onPress={() => { setResetResult(null); setSelectedEmp(null); setModalView("detail"); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: resetResult ? "#fff" : "#2b2b2b", borderRadius: 12, alignItems: "center" }}><Text style={{ fontWeight: "600", fontSize: 15, color: resetResult ? "#000" : "#fff" }}>{resetResult ? "Fèmen" : "Anile"}</Text></Pressable>
                </View>
              </Animated.View>
            )}
                </KeyboardSafeScrollView>
              </>
            )}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Title + add */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: padH, paddingTop: 18, paddingBottom: 14 }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Ekip</Text>
        {canManageEmployees ? (
          <Pressable
            onPress={() => setShowAdd(true)}
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        ) : null}
      </View>
      {/* Tablet two panels: list left (flex 3), employee detail right (flex 2). */}
      <View style={{ flexDirection: isTablet ? "row" : "column", flex: 1, gap: isTablet ? 12 : 0, paddingHorizontal: isTablet ? padH : 0, paddingBottom: isTablet ? 10 : 0 }}>
        <View style={{ flex: isTablet ? 3 : 1, minWidth: 0 }}>
      {/* Search + filter */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: isTablet ? 0 : padH, marginBottom: 8 }}>
        <View style={{ flex: 1, height: 56, flexDirection: "row", alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 28, paddingHorizontal: 16 }}>
          <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chèche non, wòl, telefon…"
            placeholderTextColor="#8e8e93"
            returnKeyType="search"
            style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: "#fff" }}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color="#8e8e93" />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => { setDraftFilter(filter); setShowFilters(true); }}
          style={{
            width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
            backgroundColor: filter !== "all" ? "#fff" : "#000",
            borderWidth: 1, borderColor: filter !== "all" ? "#fff" : "#3a3a3c",
          }}
        >
          <Ionicons name="filter" size={20} color={filter !== "all" ? "#000" : "#fff"} />
        </Pressable>
      </View>
      <KeyboardSafeScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      {/* Employee rows — customers-list style */}
      {list.length === 0 ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>{search || filter !== "all" ? "Pa gen rezilta" : "Pa gen anplwaye"}</Text>
          <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>Eseye chanje rechèch oswa filtè.</Text>
        </View>
      ) : (
        [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))).map((e) => {
          const meta = ROLE_META[e.role] ?? ROLE_META.cashier;
          const isSelf = e.id === currentUser?.id;
          return (
            <Pressable
              key={e.id}
              onPress={() => { setSelectedEmp(e); setModalView("detail"); }}
              style={{ opacity: e.active ? 1 : 0.55 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: isTablet ? 0 : padH, paddingVertical: 14, backgroundColor: isTablet && selectedEmp?.id === e.id ? "#1c1c1e" : "transparent" }}>
                <View>
                  <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{e.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                  </View>
                  <View style={{
                    position: "absolute", right: -2, bottom: -2,
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: e.isOnline ? "#34C759" : "#3a3a3c",
                    borderWidth: 2, borderColor: "#000",
                  }} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontWeight: "600", fontSize: 17, color: "#fff", flexShrink: 1 }} numberOfLines={1}>{e.name}</Text>
                    {isSelf ? <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", backgroundColor: "#2b2b2b", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>OU</Text> : null}
                  </View>
                  <Text style={{ fontSize: 14, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{meta.label} · {e.phone ?? "—"}</Text>
                  <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 1 }} numberOfLines={1}>{canSeeSalary(e) ? `${e.salary} / mwa` : "Konfidansyèl"}</Text>
                </View>
                {canToggle(e) ? (
                  <IOSToggle value={e.active} onToggle={() => toggleActive(e)} />
                ) : null}
              </View>
              <View style={{ height: 1, backgroundColor: "#262626", marginLeft: isTablet ? 64 : padH + 64 }} />
            </Pressable>
          );
        })
      )}
      </KeyboardSafeScrollView>
        </View>
        {isTablet && (
          <View style={{ flex: 2, minWidth: 300, backgroundColor: "#000", borderRadius: radius.lg, borderWidth: 1, borderColor: "#262626", overflow: "hidden" }}>
            {selectedEmp ? (
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <View style={{ flex: 1, backgroundColor: "#000", padding: 18 }}>
                  {detailContent}
                </View>
              </KeyboardAvoidingView>
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Ionicons name="people-outline" size={44} color="#3a3a3c" />
                <Text style={{ color: "#8e8e93", fontSize: 15, fontWeight: "600" }}>Chwazi yon anplwaye</Text>
                <Text style={{ color: "#6e6e73", fontSize: 13 }}>Tape sou yon non pou wè detay li</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Filters sheet — Transactions style */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFilters(false)} />
          <View style={{ backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32 + insets.bottom, maxHeight: "85%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>Filters</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setDraftFilter("all")}
                  style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: draftFilter !== "all" ? "#fff" : "#6e6e73" }}>Clear All</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setFilter(draftFilter); setShowFilters(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {(["all", "active", "inactive"] as const).map(key => {
              const checked = draftFilter === key;
              const label = key === "all" ? "Tout" : key === "active" ? "Aktif" : "Inaktif";
              return (
                <Pressable
                  key={key}
                  onPress={() => setDraftFilter(key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Add member — full-screen black sheet (customer-add design):
          form → invite (GoTrue + profile + SMTP email) → one-time password
          card the creator can copy / share. */}
      <Modal visible={showAdd} transparent={false} animationType="slide" onRequestClose={closeAdd}>
        <ModalScreen>
          <CustomerProfileHeader
            onBack={closeAdd}
            backIcon="x-circle"
            title={addView === "done" ? "Kont kreye" : "Nouvo anplwaye"}
            headerAction={addView === "form" ? (
              <Pressable
                onPress={submitAddStaff}
                disabled={!addValid || addSaving}
                style={{ paddingHorizontal: 26, paddingVertical: 14, borderRadius: 26, backgroundColor: addValid && !addSaving ? "#fff" : "#2b2b2b" }}
              >
                <Text style={{ fontWeight: "800", fontSize: 15, color: addValid && !addSaving ? "#000" : "#6e6e73" }}>{addSaving ? "…" : "Kreye"}</Text>
              </Pressable>
            ) : undefined}
          />
          {addView === "form" ? (
            <KeyboardSafeScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 12 }}>Enfòmasyon pèsònèl</Text>
              <View style={{ marginBottom: 12 }}>
                <TextInput value={newEmpName} onChangeText={v => { setNewEmpName(v); if (newEmpError) setNewEmpError(""); }} placeholder="Non konplè" placeholderTextColor="#8e8e93" style={DARK_FIELD} />
              </View>
              <PhoneField
                value={newEmpPhoneDigits}
                onChange={v => { setNewEmpPhoneDigits(v); if (newEmpError) setNewEmpError(""); }}
                country={newEmpPhoneIso}
                onPressFlag={() => setNewEmpDialOpen(true)}
              />
              <View style={{ marginBottom: 12 }}>
                <TextInput value={newEmpEmail} onChangeText={v => { setNewEmpEmail(v); if (newEmpError) setNewEmpError(""); }} placeholder="Imel — li sèvi pou konekte" placeholderTextColor="#8e8e93" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={DARK_FIELD} />
              </View>
              <View style={{ marginBottom: 4 }}>
                <TextInput value={newEmpAddress} onChangeText={v => { setNewEmpAddress(v); if (newEmpError) setNewEmpError(""); }} placeholder="Adrès" placeholderTextColor="#8e8e93" multiline textAlignVertical="top" style={[DARK_FIELD, { height: 96, paddingTop: 14 }]} />
              </View>

              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginTop: 18, marginBottom: 12 }}>Wòl</Text>
              <View style={{ flexDirection: "row", backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, padding: 4, gap: 4 }}>
                {addRoleOptions.map(r => {
                  const active = newEmpRole === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => {
                        // Smart default: the salary follows the role while the
                        // owner never touched the field; once edited, hands off.
                        const wasDefault = newEmpSalary === String(ROLE_SALARY_DEFAULT[newEmpRole] ?? 12000);
                        setNewEmpRole(r);
                        if (wasDefault) setNewEmpSalary(String(ROLE_SALARY_DEFAULT[r] ?? 12000));
                      }}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? "#fff" : "transparent", alignItems: "center" }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#000" : "#8e8e93", letterSpacing: 0.3 }}>{r.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginTop: 18, marginBottom: 12 }}>Salè</Text>
              <TextInput
                value={newEmpSalary}
                onChangeText={v => setNewEmpSalary(v.replace(/[^0-9]/g, ""))}
                placeholder="Salè pa mwa an goud"
                placeholderTextColor="#8e8e93"
                keyboardType="number-pad"
                style={DARK_FIELD}
              />
              {(() => {
                const hint = peerSalaryHint(Number(newEmpSalary) || 0, newEmpRole, employees);
                return hint ? (
                  <Text style={{ color: "#FFD60A", fontSize: 12, marginTop: 8 }}>{hint}</Text>
                ) : (
                  <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 8 }}>Salè prekounye a selon wòl la — ou lib pou chanje l.</Text>
                );
              })()}

              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginTop: 22, marginBottom: 4 }}>Kontak ijans</Text>
              <Text style={{ color: "#8e8e93", fontSize: 12, marginBottom: 12 }}>Opsyonèl — ou ka ranpli l pita nan Edit → Kontak ijans.</Text>
              <View style={{ marginBottom: 12 }}>
                <TextInput value={newEmpEmergName} onChangeText={setNewEmpEmergName} placeholder="Non kontak" placeholderTextColor="#8e8e93" style={DARK_FIELD} />
              </View>
              <PhoneField
                value={newEmpEmergPhoneDigits}
                onChange={setNewEmpEmergPhoneDigits}
                country={newEmpEmergPhoneIso}
                onPressFlag={() => setNewEmpEmergDialOpen(true)}
              />
              <View style={{ marginBottom: 12 }}>
                <TextInput value={newEmpEmergAddress} onChangeText={setNewEmpEmergAddress} placeholder="Adrès kontak" placeholderTextColor="#8e8e93" multiline textAlignVertical="top" style={[DARK_FIELD, { height: 96, paddingTop: 14 }]} />
              </View>

              {newEmpError ? (
                <View style={{ marginTop: 4, backgroundColor: "#1a0d0d", borderWidth: 1, borderColor: "#5a1a1a", borderRadius: 12, padding: 12 }}>
                  <Text style={{ color: "#ff6961", fontSize: 13, fontWeight: "600" }}>{newEmpError}</Text>
                </View>
              ) : null}

              <CountryDialPicker visible={newEmpDialOpen} onClose={() => setNewEmpDialOpen(false)} onPick={iso => setNewEmpPhoneIso(iso)} title="Kòd peyi" />
              <CountryDialPicker visible={newEmpEmergDialOpen} onClose={() => setNewEmpEmergDialOpen(false)} onPick={iso => setNewEmpEmergPhoneIso(iso)} title="Kòd peyi" />
              <View style={{ height: 28 }} />
            </KeyboardSafeScrollView>
          ) : (
            <KeyboardSafeScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: "center", paddingTop: 16, gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="checkmark" size={34} color="#fff" />
                </View>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.3 }}>Kont kreye</Text>
                <Text style={{ color: "#8e8e93", fontSize: 13, textAlign: "center", paddingHorizontal: 12 }}>
                  {addResult?.emailSent
                    ? `Imel voye a ${newEmpEmail.trim().toLowerCase()}`
                    : "Kont la kreye — pataje modpas la ak anplwaye a."}
                </Text>
                <View style={{ width: "100%", backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 16, padding: 18, alignItems: "center", gap: 6, marginTop: 10 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 11, fontWeight: "700", letterSpacing: 0.8 }}>MODPAS TANPORÈ</Text>
                  <Text selectable style={{ color: "#fff", fontSize: 26, fontWeight: "800", letterSpacing: 2 }}>{addResult?.password}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 13 }}>PIN:</Text>
                    <Text selectable style={{ color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 3 }}>{addResult?.pin}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    Share.share({
                      message: `Kourro\nImel: ${newEmpEmail.trim().toLowerCase()}\nModpas tanporè: ${addResult?.password ?? ""}\nPIN: ${addResult?.pin ?? ""}`,
                    }).catch(() => {});
                  }}
                  style={{ width: "100%", marginTop: 6, backgroundColor: "#2b2b2b", borderRadius: 14, paddingVertical: 15, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                >
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Pataje</Text>
                </Pressable>
                <Pressable onPress={closeAdd} style={{ width: "100%", marginTop: 4, marginBottom: 20, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 15, alignItems: "center" }}>
                  <Text style={{ color: "#000", fontWeight: "800", fontSize: 15 }}>Fèmen</Text>
                </Pressable>
              </View>
            </KeyboardSafeScrollView>
          )}
        </ModalScreen>
      </Modal>

      {/* Employee detail — phone: full-screen modal (tablet: right pane). */}
      {!isTablet && selectedEmp && (
        <Modal visible transparent={false} animationType="slide" onRequestClose={() => setSelectedEmp(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: "#000", padding: 18, paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }}>
              {detailContent}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

    </View>
  );
}
