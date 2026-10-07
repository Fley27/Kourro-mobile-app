// Menu sidebar collapse persistence — a single key in the existing _meta
// key/value table (schema.ts), so there is no migration and no new table.
// First run (no stored value): smart default — expanded on wide windows,
// collapsed on narrow ones (small Android tablets / split-screen never
// start with the menu eating their content area).
import { Dimensions } from "react-native";
import { getDb } from "../db";

const KEY = "menu_collapsed";

export function defaultMenuCollapsed(): boolean {
  return Dimensions.get("window").width < 900;
}

export async function loadMenuCollapsed(): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = (await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [KEY])) as any[];
    const v = String(rows?.[0]?.value ?? "");
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {}
  return defaultMenuCollapsed();
}

export async function saveMenuCollapsed(collapsed: boolean): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [KEY, collapsed ? "1" : "0"]);
  } catch {}
}
