// Auth store for the mobile app — shared singleton (zustand) so App + screens
// see the same session state. Session/profile persisted via SecureStore.
//
// Live-mode login priority (offline-first):
//   1. every attempt probes connectivity first
//   2. ONLINE → real Supabase login is ALWAYS the priority path
//   3. OFFLINE (or the online attempt cannot reach the network) → verify the
//      password against the per-user offline credential cache
//      (src/auth/offlineCreds.ts, 30-day window anchored on the last
//      successful online login)
// A local (non-hosted) boot restores the cached profile outright; a hosted
// boot with a dead network falls back to the offline credential record.
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { supabase, isLiveSupabase } from "./supabase";
import { USERS, type Role, type User } from "../users";
import { mintId } from "../db/ids";
import { recheckOnline } from "../net/connectivity";
import {
  getOfflineCred,
  getOfflineCredByEmail,
  offlineCredWithinWindow,
  saveOfflineCredential,
  verifyOfflinePassword,
  type OfflineCredRecord,
} from "./offlineCreds";
import {
  applySubscriptionSnapshot,
  fetchSubscriptionSnapshot,
  hydrateSubscriptionFromDb,
} from "../subscription/subscription";

export type AuthStatus = "loading" | "signedout" | "signedin";

/** How this session was established: via Supabase (online) or the cache. */
export type AuthMode = "online" | "offline";

export type CachedProfile = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  pin: string | null;
  store: string;
};

const PROFILE_KEY = "jm_profile_cache";

export function mapProfileToUser(p: CachedProfile): User {
  return {
    id: p.userId,
    name: p.name,
    role: p.role,
    secret: p.pin ?? "",
    store: p.store || "Petyonvil",
  };
}

// Local/mock boot (no real Supabase stack): one-tap demo credentials — one per
// role. Each user's `secret` doubles as the offline PIN. The app's full demo
// roster lives in `../users` (owner/admin/manager/cashier).
export const DEMO_CREDENTIALS: CachedProfile[] = USERS.map(u => ({
  userId: u.id,
  email: `${u.role}@demo.magazen.ht`,
  name: u.name,
  role: u.role,
  pin: u.secret,
  store: u.store ?? "Petyonvil",
}));

export const demoProfile: CachedProfile = DEMO_CREDENTIALS.find(c => c.role === "cashier") ?? DEMO_CREDENTIALS[0];
export const demoUser: User = mapProfileToUser(demoProfile);

export async function cacheProfile(p: CachedProfile) {
  try { await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(p)); } catch {}
}
export async function readCachedProfile(): Promise<CachedProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as CachedProfile) : null;
  } catch { return null; }
}
async function clearCachedProfile() {
  try { await SecureStore.deleteItemAsync(PROFILE_KEY); } catch {}
}

/**
 * Access token for the middleware sync calls. Session persists in SecureStore
 * and auto-refreshes (supabase.ts), so this is always the CURRENT token.
 * Returns null in mock mode or when there is no live session (PIN unlock after
 * expiry) — sync must then skip the cycle rather than go token-less: the
 * middleware validates the JWT and derives the caller's stores from it.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!isLiveSupabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch { return null; }
}

/**
 * Force a session refresh. Called when the middleware rejects our token with a
 * 401: without this a device keeps retrying with the same dead JWT and its pull
 * cursor freezes forever (empty catalog, no cross-device history).
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!isLiveSupabase) return null;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) return null;
    return data?.session?.access_token ?? null;
  } catch { return null; }
}

/**
 * ONLINE hydration: profile + org + subscription snapshot come live from
 * Supabase, then the offline credential cache is refreshed for this user
 * (password hash only when the plaintext is in hand — sign-in/sign-up — while
 * a boot restore just refreshes the 30-day window, proven by the fact the
 * profile fetch itself succeeded online).
 */
async function hydrateFromSession(
  userId: string,
  cache: CachedProfile | null,
  opts: { password?: string } = {}
) {
  const { data: profile } = await supabase.from("profiles")
    .select("id,email,full_name,role,pin_code,organization_id")
    .eq("id", userId).maybeSingle();
  if (!profile) {
    // The session is valid but the profile fetch didn't land (offline boot,
    // cold start without network). Fall back to this user's cached offline
    // record instead of force-signing-out — the app must keep working offline.
    const rec = await getOfflineCred(userId);
    if (rec && offlineCredWithinWindow(rec) && rec.password) {
      await enterOfflineSession(rec, { keepSession: true });
      return;
    }
    useAuthStore.setState({ status: "signedout", mode: null });
    return;
  }
  const orgId = (profile as any).organization_id ?? null;
  // First store for the org (display name only; data stays offline-first).
  let storeName = cache?.store ?? "Petyonvil";
  if (orgId) {
    const { data: stores } = await supabase.from("stores")
      .select("name").eq("organization_id", orgId).limit(3);
    if (stores?.length) storeName = (stores[0] as any).name;
    // Payroll (028) keys the org-wide period cycle by organization id —
    // persist it so periods/salary rows can be derived while offline.
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES ('organization_id', ?)", [String(orgId)]);
    } catch {}
  }
  const cp: CachedProfile = {
    userId, email: (profile as any).email ?? "",
    name: (profile as any).full_name ?? "Itilizatè",
    role: (profile as any).role ?? "cashier",
    pin: (profile as any).pin_code ?? cache?.pin ?? null,
    store: storeName,
  };
  await cacheProfile(cp);
  // Message the server proved reachable: refresh the subscription snapshot so
  // local read-only state tracks the org, then re-cache this user's offline
  // credentials with a fresh 30-day window.
  const now = new Date().toISOString();
  const snapshot = orgId ? await fetchSubscriptionSnapshot(String(orgId)) : null;
  applySubscriptionSnapshot(snapshot, { persist: true });
  await saveOfflineCredential({
    userId,
    email: cp.email,
    name: cp.name,
    role: cp.role,
    store: cp.store,
    orgId: orgId ? String(orgId) : null,
    password: opts.password,
    subscription: snapshot,
    onlineAuthAt: now,
  });
  useAuthStore.setState({ cached: cp, user: mapProfileToUser(cp), status: "signedin", mode: "online", error: null });
  void dropForeignRosterRows(userId);
}

/**
 * OFFLINE session entry: identity, role, store and the subscription snapshot
 * all come from the cached credential record. Writes stay possible locally
 * (subject to local read-only), queue in the outbox and sync once this user
 * logs in online again.
 */
async function enterOfflineSession(
  rec: OfflineCredRecord,
  opts: { keepSession?: boolean } = {}
): Promise<void> {
  // Token hygiene on a shared device: a cached session belonging to SOMEONE
  // ELSE must never survive another person's offline login — sync would push
  // and pull under the wrong identity. Clear it locally (no network needed).
  if (!opts.keepSession) {
    try {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data?.session?.user?.id ?? null;
      if (sessionUser && sessionUser !== rec.userId) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      }
    } catch {}
  }
  if (rec.orgId) {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES ('organization_id', ?)", [String(rec.orgId)]);
    } catch {}
  }
  applySubscriptionSnapshot(rec.subscription, { persist: true });
  const cp: CachedProfile = {
    userId: rec.userId,
    email: rec.email,
    name: rec.name,
    role: rec.role,
    pin: null,
    store: rec.store,
  };
  await cacheProfile(cp);
  useAuthStore.setState({ cached: cp, user: mapProfileToUser(cp), status: "signedin", mode: "offline", error: null });
  void dropForeignRosterRows(rec.userId);
}

/** Network/fetch failures (as opposed to invalid credentials). */
function isNetworkAuthError(e: any): boolean {
  const name = String(e?.name ?? "");
  const msg = String(e?.message ?? "");
  return name === "AuthRetryableFetchError"
    || name === "TypeError"
    || /network|fetch failed|timeout|abort/i.test(msg);
}

/**
 * Offline login: verify the password against the per-user cache, then enter a
 * session. The 30-day window is per user — a shared tablet holds one record
 * per staff member, each with its own independent window.
 */
async function offlineSignIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const r = await verifyOfflinePassword(email, password);
  if (!r.ok) {
    const m = r.reason === "expired"
      ? "Aksè offline ekspire apre 30 jou. Konekte sou entènèt pou rafrechi l."
      : r.reason === "bad_password"
        ? "Modpas pa kòrèk."
        : "Kont sa a pa anrejistre sou aparèy sa a. Konekte sou entènèt yon fwa anvan.";
    useAuthStore.setState({ error: m });
    return { ok: false, error: m };
  }
  await enterOfflineSession(r.record);
  return { ok: true };
}

type AuthState = {
  status: AuthStatus;
  /** "online" = Supabase session; "offline" = cached-credential session. */
  mode: AuthMode | null;
  user: User | null;
  cached: CachedProfile | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string, name: string, storeName: string) => Promise<{ ok: boolean; error?: string }>;
  unlockWithPin: (pin: string) => { ok: boolean; error?: string };
  demoSignIn: (userId?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/**
 * Drop identity-sensitive outbox rows (roster/profile) queued by a DIFFERENT
 * user: roster writes are role-checked per caller, so they can never succeed
 * under this session — keeping them only produces "Sync rejte" warnings the
 * new user can't fix. Store-scoped rows (sales, catalog…) stay queued no
 * matter who queued them. No-op when the same user returns.
 */
export async function dropForeignRosterRows(myId: string | null): Promise<void> {
  if (!myId) return;
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    await db.runAsync(
      "DELETE FROM outbox WHERE table_name IN ('store_members','profiles','employee_stores') AND queued_by IS NOT NULL AND queued_by != ?",
      [myId]
    );
  } catch {}
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  mode: null,
  user: null,
  cached: null,
  error: null,

  signIn: async (email, password) => {
    set({ error: null });
    if (!isLiveSupabase) {
      // Mock: validate against the demo credentials roster by email prefix.
      // Any password of 6+ chars is accepted locally.
      const key = email.trim().toLowerCase();
      const cred = DEMO_CREDENTIALS.find(c => c.email.toLowerCase() === key)
        ?? DEMO_CREDENTIALS.find(c => key.startsWith(`${c.role}@demo.magazen.ht`))
        ?? demoProfile;
      await cacheProfile(cred);
      set({ cached: cred, user: mapProfileToUser(cred), status: "signedin", mode: "offline", error: null });
      void dropForeignRosterRows(mapProfileToUser(cred)?.id ?? null);
      return { ok: true };
    }

    // Priority check: is there internet? Force a fresh probe — the cached
    // signal is up to 20s stale, and this is exactly the decision point.
    const online = await recheckOnline();
    const cachedRec = await getOfflineCredByEmail(email);
    if (online || !cachedRec) {
      // Internet available → the real online login is ALWAYS the priority
      // path. Also the only path when this device holds no cached record: a
      // false-negative probe must never block an otherwise valid login.
      let e: any = null;
      let uid: string | null = null;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        e = error ?? null;
        uid = data?.user?.id ?? null;
      } catch (thrown) {
        e = thrown;
      }
      if (!e) {
        if (!uid) { const m = "Imel la pa verifye."; set({ error: m }); return { ok: false, error: m }; }
        await hydrateFromSession(uid, null, { password });
        return { ok: true };
      }
      // Credentials rejected by the server → report as-is. Never fall back to
      // the offline cache for a refused password: the server's answer wins.
      if (!isNetworkAuthError(e) || !cachedRec) {
        const m = isNetworkAuthError(e)
          ? "Sèvè a pa disponib. Verifye koneksyon an, oswa antre ak yon kont ki anrejistre sou aparèy sa a."
          : e?.message ?? "Koneksyon enposib.";
        set({ error: m });
        return { ok: false, error: m };
      }
      // Network dropped mid-attempt with a cached record in hand → offline.
    }
    return offlineSignIn(email, password);
  },

  signUp: async (email, password, name, storeName) => {
    set({ error: null });
    if (!isLiveSupabase) {
      // Mock: create a local owner account (no backend needed to try the flow).
      const cred: CachedProfile = {
        userId: mintId(),
        email: email.trim().toLowerCase(),
        name: name.trim() || "Nouvo Pwopriyetè",
        role: "owner",
        pin: "1",
        store: storeName.trim() || "Petyonvil",
      };
      await cacheProfile(cred);
      set({ cached: cred, user: mapProfileToUser(cred), status: "signedin", mode: "offline", error: null });
      return { ok: true };
    }
    const { data, error: e } = await supabase.auth.signUp({ email, password });
    if (e) { set({ error: e.message }); return { ok: false, error: e.message }; }
    const uid = data.user?.id;
    if (!uid) { const m = "Kont pa kreye — verifye imel ou."; set({ error: m }); return { ok: false, error: m }; }
    try {
      await supabase.from("profiles").insert({
        id: uid, email, full_name: name, role: "owner", language: "ht", organization_id: null,
      });
      const { data: org, error: orgErr } = await supabase.from("organizations")
        .insert({ owner_id: uid, name: storeName, currency: "HTG" }).select().single();
      if (orgErr) throw orgErr;
      await supabase.from("profiles").update({ organization_id: org.id }).eq("id", uid);
      const { data: loc, error: locErr } = await supabase.from("stores").insert({
        name: storeName, owner_id: uid, organization_id: org.id, is_active: true,
      }).select().single();
      if (locErr) throw locErr;
      await supabase.from("store_members").insert({ store_id: loc.id, organization_id: org.id, user_id: uid, role: "owner" });
      await supabase.from("subscriptions").insert({
        organization_id: org.id, plan_code: "basic", status: "trial",
        trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      });
    } catch (err) {
      const m = `Eskè, nou pa t kapab kreye magazen ou: ${(err as any)?.message ?? err}`;
      set({ error: m });
      return { ok: false, error: m };
    }
    await hydrateFromSession(uid, null, { password });
    return { ok: true };
  },

  unlockWithPin: (pin) => {
    const { cached } = useAuthStore.getState();
    if (!cached) return { ok: false, error: "Pa gen sesyon anrejistre." };
    if (cached.pin && cached.pin !== pin) return { ok: false, error: "PIN pa kòrèk." };
    set({ user: mapProfileToUser(cached), status: "signedin", mode: "offline" });
    return { ok: true };
  },

  demoSignIn: async (userId?: string) => {
    const cred = DEMO_CREDENTIALS.find(c => c.userId === userId) ?? demoProfile;
    await cacheProfile(cred);
    set({ cached: cred, user: mapProfileToUser(cred), status: "signedin", mode: "offline", error: null });
    void dropForeignRosterRows(mapProfileToUser(cred)?.id ?? null);
  },

  signOut: async () => {
    // Who is leaving: identity-sensitive outbox rows (roster/profile) queued
    // by THIS user are theirs to keep retrying — but rows queued by a
    // PREVIOUS user can never succeed under a new session (roster writes are
    // role-checked per caller), so drop those instead of warning the next
    // cashier about rejections they can't fix. Sales and other store-scoped
    // rows stay queued no matter who queued them.
    const leavingId: string | null = useAuthStore.getState()?.user?.id ?? null;
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      await db.runAsync(
        "DELETE FROM outbox WHERE table_name IN ('store_members','profiles','employee_stores') AND queued_by IS NOT NULL AND queued_by != ?",
        [leavingId]
      );
    } catch {}
    await Promise.all([supabase.auth.signOut().catch(() => {}), clearCachedProfile()]);
    // Offline credential records are deliberately NOT deleted: on a shared
    // device every user keeps their own 30-day offline window and can log
    // back in (offline) after anyone signs out.
    set({ user: null, cached: null, status: "signedout", mode: null, error: null });
  },
}));

export function useAuthState(): AuthState {
  return useAuthStore();
}

// Restore on boot: live session → profile; else cached → PIN screen; else login.
// NOTE: the cached profile lives in SecureStore (HARD memory / disk), so it
// survives Metro rebundles + cold restarts. We must read it even in mock
// (non-live Supabase) mode — otherwise every rebundle wipes the session and
// forces a full login, looking like data loss.
async function restore() {
  const cache = await readCachedProfile();
  if (!isLiveSupabase) {
    // Local dev: restore straight from the cached profile — a rebundle or app
    // restart must not bounce a tester back to the login form. signOut() clears
    // the cache, so an explicit log out still needs credentials to get back in.
    if (cache) {
      useAuthStore.setState({ cached: cache, user: mapProfileToUser(cache), status: "signedin", mode: "offline", error: null });
    } else {
      useAuthStore.setState({ status: "signedout", error: null });
    }
    return;
  }
  // Load the persisted subscription snapshot first: the moment a session is
  // restored (or the login screen shows), local read-only state is correct.
  await hydrateSubscriptionFromDb();
  // Live mode: never seed `cached` from the legacy single-profile disk key.
  // A session restored offline falls back to THIS user's offline credential
  // record (see hydrateFromSession); the old profile cache belongs to whoever
  // used the device last and must not speak for the current session.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await hydrateFromSession(session.user.id, cache);
  } else {
    useAuthStore.setState({ status: "signedout" });
  }
}
restore();