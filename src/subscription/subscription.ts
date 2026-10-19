// Subscription snapshot + local read-only enforcement.
//
// The authoritative writability rule lives in @retail/shared-types
// (isSubscriptionWritable) — the same rule the middleware and the Postgres
// trigger (migration 029) apply. This module only mirrors the LAST ONLINE
// snapshot into local state so the UI can block/unblock writes instantly,
// even offline:
//   - reads are NEVER gated here (screens keep working, orders stay visible)
//   - writes go through guardWrite(); close-out actions pass closeOut:true
//   - the server remains the enforcement backstop; a tampered local snapshot
//     can only produce a push that the server refuses.
import { create } from "zustand";
import { isSubscriptionWritable } from "@retail/shared-types";
import { supabase, isLiveSupabase } from "../auth/supabase";
import type { SubscriptionSnapshot } from "./types";

const META_KEY = "org_subscription";
const REFRESH_THROTTLE_MS = 15 * 60 * 1000;

export const SUBSCRIPTION_BLOCKED_MESSAGE =
  "Abònman ekspire — ou ka gade done yo sèlman. Konekte ak pwopriyetè a pou renouvle.";

export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Pa gen abònman aktif — ou ka gade done yo sèlman. Konekte ak pwopriyetè a.";

/** Never blocks local (mock) dev — only live Supabase enforces. */
function enforceLocal(): boolean {
  return isLiveSupabase;
}

export function snapshotWritable(snapshot: SubscriptionSnapshot | null, now: number = Date.now()): boolean {
  if (!enforceLocal()) return true;
  if (!snapshot) return false;
  return isSubscriptionWritable(
    { status: snapshot.status, trial_ends_at: snapshot.trial_ends_at, renews_at: snapshot.renews_at },
    now
  );
}

export function snapshotReason(snapshot: SubscriptionSnapshot | null): string {
  if (!snapshot) return SUBSCRIPTION_INACTIVE_MESSAGE;
  return SUBSCRIPTION_BLOCKED_MESSAGE;
}

type SubscriptionState = {
  snapshot: SubscriptionSnapshot | null;
  writable: boolean;
  reason: string | null;
  /** True once a snapshot (or the absence of one) has been applied at least once. */
  ready: boolean;
  lastRefreshAt: number;
};

export const useSubscriptionStore = create<SubscriptionState>(() => ({
  snapshot: null,
  writable: !enforceLocal(),
  reason: null,
  ready: !enforceLocal(),
  lastRefreshAt: 0,
}));

/** Apply a snapshot to the store (and optionally persist it to SQLite _meta). */
export function applySubscriptionSnapshot(
  snapshot: SubscriptionSnapshot | null,
  opts: { persist?: boolean } = {}
): void {
  const writable = snapshotWritable(snapshot);
  useSubscriptionStore.setState({
    snapshot,
    writable,
    reason: writable ? null : snapshotReason(snapshot),
    ready: true,
  });
  if (opts.persist !== false) {
    void persistSubscriptionMeta(snapshot);
  }
}

async function persistSubscriptionMeta(snapshot: SubscriptionSnapshot | null): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [
      META_KEY,
      JSON.stringify(snapshot),
    ]);
  } catch {}
}

/** Read the persisted snapshot at boot (before any network call). */
export async function hydrateSubscriptionFromDb(): Promise<void> {
  if (!enforceLocal()) {
    applySubscriptionSnapshot(null, { persist: false });
    return;
  }
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    const rows = (await db.getAllAsync("SELECT value FROM _meta WHERE key = ?", [META_KEY])) as any[];
    const raw = rows?.[0]?.value;
    const snapshot = raw ? (JSON.parse(String(raw)) as SubscriptionSnapshot) : null;
    // Shared device: _meta is device-wide, so a snapshot persisted by the
    // PREVIOUS user (another org) must never unlock the next one — read-only
    // until an online refresh brings the right org's row.
    if (snapshot && snapshot.organizationId) {
      const currentOrg = await currentOrgIdFromDb();
      if (currentOrg && currentOrg !== snapshot.organizationId) {
        applySubscriptionSnapshot(null, { persist: false });
        return;
      }
    }
    applySubscriptionSnapshot(snapshot, { persist: false });
  } catch {
    // No DB yet / parse failure: fail toward read-only (server backstops).
    if (!useSubscriptionStore.getState().ready) applySubscriptionSnapshot(null, { persist: false });
  }
}

/** Fetch the latest subscription row for the org from Supabase (RLS: tenant read). */
export async function fetchSubscriptionSnapshot(orgId: string | null): Promise<SubscriptionSnapshot | null> {
  if (!isLiveSupabase || !orgId) return null;
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("plan_code,status,trial_ends_at,renews_at,created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as any;
    return {
      organizationId: orgId,
      plan_code: row.plan_code ?? null,
      status: row.status ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      renews_at: row.renews_at ?? null,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Network refresh (login, foreground, throttled sync cycles). A failed fetch
 * (offline) keeps the previous snapshot — never flips the device writable.
 */
export async function refreshSubscription(orgId: string | null, opts: { force?: boolean } = {}): Promise<void> {
  if (!isLiveSupabase || !orgId) return;
  const st = useSubscriptionStore.getState();
  if (!opts.force && Date.now() - st.lastRefreshAt < REFRESH_THROTTLE_MS && st.ready) return;
  useSubscriptionStore.setState({ lastRefreshAt: Date.now() });
  const snapshot = await fetchSubscriptionSnapshot(orgId);
  if (snapshot) applySubscriptionSnapshot(snapshot, { persist: true });
}

/** The org this device is bound to (written at login/hydrate into _meta). */
export async function currentOrgIdFromDb(): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    const rows = (await db.getAllAsync("SELECT value FROM _meta WHERE key = 'organization_id'")) as any[];
    const v = rows?.[0]?.value;
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

/** refreshSubscription() with the org resolved from SQLite (foreground/sync). */
export async function refreshSubscriptionFromDb(opts: { force?: boolean } = {}): Promise<void> {
  if (!isLiveSupabase) return;
  const orgId = await currentOrgIdFromDb();
  await refreshSubscription(orgId, opts);
}

export type WriteGuardResult = { ok: true } | { ok: false; message: string };

/**
 * Local write gate for action functions. `closeOut: true` marks writes that
 * CLOSE/retire an existing record (close shift, submit report, cancel an open
 * order) — those must always pass or records stay stranded open.
 */
export function guardWrite(opts: { closeOut?: boolean } = {}): WriteGuardResult {
  if (opts.closeOut) return { ok: true };
  if (!enforceLocal()) return { ok: true };
  const st = useSubscriptionStore.getState();
  if (st.writable) return { ok: true };
  return { ok: false, message: st.reason ?? SUBSCRIPTION_BLOCKED_MESSAGE };
}

/**
 * Throwing form of guardWrite for plain async model functions whose callers
 * already surface errors (try/catch → alert/toast).
 */
export function assertWritable(opts: { closeOut?: boolean } = {}): void {
  const g = guardWrite(opts);
  if (!g.ok) throw new Error(g.message);
}

/** React hook form: true while the org may write (false ⇒ read-only UI). */
export function useWritable(): boolean {
  return useSubscriptionStore(s => s.writable);
}
