// Organization layer: business type + employee<->store assignments.
//
// - business_type is account-level, owner-only, inherited by every location
//   store ("retail" | "bar" | "resto", default "retail").
// - Every employee belongs to at least one store location, modeled as the
//   employee_stores join (legacy single-store values migrate into it once).
// - "Own store" scoping everywhere resolves through loadUserStoreIds().
import type { BusinessType, User } from "./users";
import { USERS } from "./users";
import { insertOutbox } from "./db";

export type { BusinessType };

const BUSINESS_TYPE_KEY = "business_type";
const EMP_STORES_SEED_KEY = "seed_employee_stores_v1";

export async function getBusinessType(db: any): Promise<BusinessType> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [BUSINESS_TYPE_KEY])) as any[];
    const v = rows?.[0]?.value;
    return v === "bar" || v === "resto" ? v : "retail";
  } catch {
    return "retail";
  }
}

export async function setBusinessType(db: any, t: BusinessType): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [BUSINESS_TYPE_KEY, t]);
}

// Location name ("Petyonvil") -> store id ("st-petyonvil"), mirroring the
// legacy convention. Unknown locations fall back to the given store id.
export function storeIdForLocation(location?: string | null, fallback = "demo-store-id"): string {
  if (location === "Dèlma") return "st-delma";
  if (location === "Petyonvil") return "st-petyonvil";
  return fallback;
}

async function ensureEmployeeStoresTable(db: any): Promise<void> {
  try {
    await db.execAsync?.(
      "CREATE TABLE IF NOT EXISTS employee_stores (employee_id TEXT NOT NULL, store_id TEXT NOT NULL, PRIMARY KEY (employee_id, store_id))"
    );
  } catch {}
  // execAsync is a no-op on the in-memory fallback; the shim handles the table natively.
}

async function linkEmployeeStore(db: any, employeeId: string, storeId: string): Promise<void> {
  try {
    await db.runAsync("INSERT OR REPLACE INTO employee_stores (employee_id, store_id) VALUES (?,?)", [
      employeeId,
      storeId,
    ]);
    try {
      await insertOutbox("employee_stores", "create", {
        employee_id: employeeId,
        store_id: storeId,
        created_at: new Date().toISOString(),
      });
    } catch {}
  } catch {}
}

/** One-time migration of legacy single-store assignments into the join table. */
export async function ensureEmployeeStores(db: any, fallbackStoreId = "demo-store-id"): Promise<void> {
  await ensureEmployeeStoresTable(db);
  try {
    const flagged = (await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [EMP_STORES_SEED_KEY])) as any[];
    if (flagged.length) return;
    const seen = new Set<string>();
    const link = async (eid: string, sid: string) => {
      const k = `${eid}|${sid}`;
      if (!eid || !sid || seen.has(k)) return;
      seen.add(k);
      await linkEmployeeStore(db, eid, sid);
    };
    try {
      const rows = (await db.getAllAsync("SELECT id, store_id FROM employees")) as any[];
      for (const r of rows ?? []) await link(r.id, r.store_id);
    } catch {}
    for (const u of USERS) await link(u.id, storeIdForLocation(u.store, fallbackStoreId));
    try {
      await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [EMP_STORES_SEED_KEY, "1"]);
    } catch {}
  } catch {}
}

/** Store ids this user works in. Falls back to their legacy single store. */
export async function loadUserStoreIds(db: any, user: Pick<User, "id" | "store"> | null, fallbackStoreId = "demo-store-id"): Promise<string[]> {
  const fallback = [storeIdForLocation(user?.store, fallbackStoreId)];
  try {
    if (!user?.id) return fallback;
    const rows = (await db.getAllAsync("SELECT * FROM employee_stores WHERE employee_id = ?", [user.id])) as any[];
    const ids = [...new Set((rows ?? []).map((r: any) => r.store_id).filter(Boolean))];
    return ids.length ? ids : fallback;
  } catch {
    return fallback;
  }
}

/** True when the user may see data scoped to the given store. Owners see all. */
export function canSeeStore(role: string, userStoreIds: string[], storeId: string): boolean {
  if (role === "owner") return true;
  return userStoreIds.includes(storeId);
}
