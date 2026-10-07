// Shared menu model — the phone "Plis" list (MoreScreen) and the tablet
// sidebar (MenuSidebar) both build from these definitions so role gating and
// per-role ordering can never drift between the two navs.
import { Ionicons } from "@expo/vector-icons";
import type { Role } from "../users";

export type IconName = keyof typeof Ionicons.glyphMap;

// "reports" is the phone's Rapò hub row; "sales" | "credits" | "guard" are
// the tablet sidebar's flattened report bodies (the phone hub nests them).
export type MoreEntry =
  | "reports"
  | "shift"
  | "proformat"
  | "catalog"
  | "inventory"
  | "customers"
  | "suppliers"
  | "orders"
  | "pickups"
  | "store"
  | "staff"
  | "sales"
  | "credits"
  | "guard";

export type EntryDef = {
  id: MoreEntry;
  title: string;
  subtitle: string;
  icon: IconName;
  roles: string[];
};

export const ENTRIES: EntryDef[] = [
  { id: "reports", title: "Rapò", subtitle: "Reports", icon: "bar-chart-outline", roles: ["owner", "admin", "manager"] },
  // The unified shift lifecycle — open, daily report, cash register in one flow.
  { id: "shift", title: "Shift", subtitle: "Chanjman • rapò • kès", icon: "key-outline", roles: ["owner", "admin", "manager", "cashier"] },
  // Promotions — proformat (price quote, any seller), right after the daily
  // shift row. The rabais/coupon hub row is parked for now.
  { id: "proformat", title: "Proformat", subtitle: "Devi • koupon kliyan", icon: "document-text-outline", roles: ["owner", "admin", "manager", "cashier"] },
  { id: "catalog", title: "Katalòg", subtitle: "Catalog", icon: "cube-outline", roles: ["owner", "admin", "manager", "cashier", "associate", "cook"] },
  { id: "inventory", title: "Envantè", subtitle: "Inventory", icon: "archive-outline", roles: ["owner", "admin", "manager", "cashier"] },
  { id: "customers", title: "Kliyan", subtitle: "Customers", icon: "people-outline", roles: ["owner", "admin", "manager", "cashier", "associate"] },
  { id: "suppliers", title: "Founisè", subtitle: "Suppliers", icon: "storefront-outline", roles: ["owner", "admin"] },
  { id: "orders", title: "Kòmand", subtitle: "Orders", icon: "clipboard-outline", roles: ["owner", "admin", "manager", "cashier", "cook"] },
  // Goods owed (paid, not yet collected) — open to every role, deliberately
  // separate from money/credit.
  { id: "pickups", title: "Pickups", subtitle: "Byen pou pran", icon: "bag-handle-outline", roles: ["owner", "admin", "manager", "cashier", "cook"] },
  { id: "store", title: "Magazen", subtitle: "Store", icon: "business-outline", roles: ["owner", "cook"] },
  { id: "staff", title: "Ekip", subtitle: "Staff", icon: "people-circle-outline", roles: ["owner", "admin", "manager"] },
];

/** Tablet-sidebar-only report rows — the Rapò hub flattened into the menu.
 *  Sales is owner/admin only: a manager's Dashboard already IS the sales
 *  report, so a second row would be a pure duplicate. */
export const REPORT_ROWS: EntryDef[] = [
  { id: "sales", title: "Sales", subtitle: "Rapò vant", icon: "bar-chart-outline", roles: ["owner", "admin"] },
  { id: "credits", title: "Credits", subtitle: "Dèt ak limite kliyan", icon: "cash-outline", roles: ["owner", "admin", "manager"] },
  { id: "guard", title: "Business Guard", subtitle: "Sante biznis • ekip", icon: "shield-checkmark-outline", roles: ["owner", "admin", "manager"] },
];

// Sidebar copy overrides — the tablet menu speaks slightly more Creole than
// the phone list (Profòma / Anplwaye); titles/subtitles not listed here fall
// back to the ENTRIES strings above.
export const SIDEBAR_TITLE: Partial<Record<MoreEntry, string>> = {
  proformat: "Profòma",
  staff: "Anplwaye",
};
export const SIDEBAR_SUBTITLE: Partial<Record<MoreEntry, string>> = {
  staff: "Ekip",
};

// Hub order is per role: each role opens this screen for a different reason,
// so what they reach for most sits highest. Rapò is pinned first and Magazen
// pinned last (right above Log out) — they never appear in these lists.
// Tweak a row here to reorder that role's menu.
const PRIORITY: Record<Role, MoreEntry[]> = {
  // Restock → stock → goods owed → credit/debt → sourcing → occasional edits.
  owner: ["proformat", "orders", "inventory", "pickups", "customers", "suppliers", "catalog", "staff"],
  admin: ["proformat", "orders", "inventory", "pickups", "customers", "suppliers", "catalog", "staff"],
  // Runs the floor: same daily rhythm, no sourcing access.
  manager: ["shift", "proformat", "orders", "inventory", "pickups", "customers", "catalog", "staff"],
  // At the till: the shift is the daily heartbeat, then credit, stock, goods owed.
  cashier: ["shift", "proformat", "customers", "inventory", "pickups", "orders", "catalog"],
  // Front of house reads the menu.
  associate: ["catalog"],
  // Kitchen asks for supplies, then checks the menu.
  cook: ["orders", "catalog", "pickups"],
};

const UNRANKED = 500;

export function rank(role: string, id: MoreEntry): number {
  if (id === "reports") return -2;  // pinned first
  // The shift is the daily heartbeat for the floor roles — pinned with reports.
  if (id === "shift" && (role === "cashier" || role === "manager")) return -2;
  if (id === "store") return 999;   // pinned last, just above Log out
  const list = PRIORITY[role as Role];
  const i = list ? list.indexOf(id) : -1;
  return i === -1 ? UNRANKED : i;
}
