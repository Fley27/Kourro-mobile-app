/**
 * Roster + store list for the signed-in user.
 *
 * In live mode the stores this device may touch come from the user's own
 * memberships (RLS: `stores`/`store_members` are readable for the caller's
 * stores) — never from the hardcoded demo locations. The result feeds the
 * local `stores` table, the active-store pick, and the sync configuration.
 *
 * Other people's profiles and cross-store memberships only arrive through the
 * middleware pull (service role, org scope) — this module is bootstrap only.
 */
import { supabase, isLiveSupabase } from "./supabase";

export type RosterStore = {
  id: string;
  name: string;
  location: string | null;
  code: string | null;
  currency: string | null;
  created_at: string | null;
  updated_at: string | null;
  disabled: number;
  breach_flagged: number;
  breached_at: string | null;
  revoked_by: string | null;
};

export type Roster = {
  stores: RosterStore[];
  storeIds: string[];
  /** Membership roles keyed by store id (highest role wins). */
  roleByStore: Record<string, string>;
};

/** Fetch this user's stores + memberships. Returns null in mock mode. */
export async function fetchRoster(): Promise<Roster | null> {
  if (!isLiveSupabase) return null;
  try {
    const [{ data: storeRows, error: sErr }, { data: memberRows }] = await Promise.all([
      supabase.from("stores").select("*"),
      supabase.from("store_members").select("store_id, role"),
    ]);
    if (sErr) return null;
    const stores: RosterStore[] = (storeRows ?? [])
      .filter((r: any) => !r.is_deleted)
      .map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
        location: r.location ?? null,
        code: r.code ?? null,
        currency: r.currency ?? null,
        created_at: r.created_at ?? null,
        updated_at: r.updated_at ?? null,
        disabled: r.disabled ? 1 : 0,
        breach_flagged: r.breach_flagged ? 1 : 0,
        breached_at: r.breached_at ?? null,
        revoked_by: r.revoked_by ?? null,
      }));
    const roleByStore: Record<string, string> = {};
    for (const m of memberRows ?? []) {
      const sid = String((m as any).store_id);
      const role = String((m as any).role ?? "cashier");
      const prev = roleByStore[sid];
      const rank = (r: string) => ({ cashier: 0, associate: 0, cook: 0, manager: 1, admin: 2, owner: 3 } as any)[r] ?? 0;
      if (!prev || rank(role) > rank(prev)) roleByStore[sid] = role;
    }
    return { stores, storeIds: stores.map(s => s.id), roleByStore };
  } catch {
    return null;
  }
}

/**
 * Persist the roster into SQLite (stores + the user's own membership rows)
 * and return the store this device should be on: the persisted choice when
 * it's still in the roster, else the first store of the business.
 */
export async function applyRosterToDb(roster: Roster, preferredStoreId: string | null): Promise<string | null> {
  if (!roster.stores.length) return null;
  const { getDb } = await import("../db");
  const db = await getDb();
  for (const s of roster.stores) {
    await db.runAsync(
      `INSERT OR REPLACE INTO stores (id, name, location, code, currency, created_at, updated_at, disabled, breach_flagged, breached_at, revoked_by, lamport_clock, is_deleted, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0)`,
      [s.id, s.name, s.location, s.code, s.currency ?? "HTG", s.created_at ?? new Date().toISOString(), s.updated_at ?? new Date().toISOString(), s.disabled, s.breach_flagged, s.breached_at, s.revoked_by]
    );
  }
  // Drop demo/foreign stores this user doesn't own — a pulled row from another
  // tenant must never linger in the picker.
  const keep = new Set(roster.stores.map(s => s.id));
  const existing = (await db.getAllAsync("SELECT id FROM stores")) as any[];
  for (const row of existing) {
    if (!keep.has(String(row.id))) await db.runAsync("DELETE FROM stores WHERE id = ?", [row.id]);
  }
  const valid = preferredStoreId && keep.has(preferredStoreId) ? preferredStoreId : roster.stores[0].id;
  await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["active_store_id", valid]);
  return valid;
}
