/**
 * autoSync — the app's single background sync loop.
 *
 * Every screen reads local SQLite, so seeing another device's data needs two
 * steps: push what this device wrote, then pull what changed elsewhere. Until
 * now only four report screens ever called SyncManager, so a sale sat in the
 * outbox until somebody happened to open a report, and no screen reloaded
 * after a pull either. This makes both halves a global concern instead of a
 * per-screen one:
 *
 *   - App calls configureSync(storeId, deviceId) + startAutoSync() once signed in
 *   - an immediate sync on start, then every SYNC_INTERVAL_MS, and again on
 *     every foreground (a register that sat in the background catches up)
 *   - insertOutbox() calls requestSync() after each local write, so a new sale
 *     leaves within a second instead of "whenever a report is opened"
 *   - a pull that brought records emits salesEvents, so every subscribed list
 *     reloads itself without the screen knowing about sync
 *   - a time-critical screen (order/line status) can call setUrgentSync(true)
 *     to drop the whole loop onto a fast lane: ~150ms push, 1.5s pull, plus an
 *     immediate catch-up pull the moment the screen opens
 */
import { AppState, Platform, type AppStateStatus } from "react-native";
import { SyncAuthError, SyncManager } from "./syncManager";
import { STALE_AFTER_DAYS } from "@retail/shared-types";
import { describePullError, describeRejects, type SyncAlert } from "./syncIssueText";
import { getOnline } from "../net/connectivity";

const SYNC_INTERVAL_MS = 6_000;
// Order/line status is time-critical — who delivered what, right now. While a
// time-critical screen holds the loop open it runs on this much tighter beat.
const FAST_SYNC_INTERVAL_MS = 1_500;
// A checkout writes ~a dozen outbox rows back to back — batch them into one push.
const WRITE_DEBOUNCE_MS = 400;
// …but on the fast lane a status tap must leave almost immediately.
const URGENT_WRITE_DEBOUNCE_MS = 150;
const FAILURE_RETRY_MS = 8_000;
const URGENT_RETRY_MS = 2_000;

let storeId: string | null = null;
let deviceId: string | null = null;
let manager: SyncManager | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerDueAt = 0;
let running = false;
let pending = false;
let started = false;
let urgent = false;
let subscription: { remove(): void } | null = null;
// One-shot device-mode flags: resolved on the first cycle after configureSync.
let modeResolved = false;
let pendingInitial = false;
let pendingCatchup = false;

// ── Presence pulse ──────────────────────────────────────────────────────────
// Once a minute (foreground only), stamp this user's profile so supervisors
// can see "who is online right now" on the Shift board. It rides the normal
// outbox → push path: cloud profiles accept self updates, and the pull hands
// the fresh timestamp to every device as employees.updated_at.
const HEARTBEAT_INTERVAL_MS = 90_000;
let lastHeartbeatAt = 0;

async function maybeHeartbeat(): Promise<void> {
  if (AppState.currentState !== "active") return;
  if (Date.now() - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  if (!(await isLiveAuthEnabled())) return;
  // Offline: don't stack undelivered beats in the outbox — the next online
  // cycle beats again within seconds of reconnecting.
  if (!getOnline()) return;
  try {
    const { useAuthStore } = await import("../auth/authStore");
    const me = useAuthStore.getState()?.user;
    if (!me?.id) return;
    const ts = new Date().toISOString();
    const { insertOutbox, getDb } = await import("../db");
    // Local mirror first: the auto-close sweep reads employees.updated_at, and
    // this device must never look "inactive" while its app is running.
    try {
      const db = await getDb();
      await db.runAsync("UPDATE employees SET updated_at = ? WHERE id = ?", [ts, me.id]);
    } catch {}
    await insertOutbox("profiles", "update", { id: me.id, full_name: me.name ?? "", updated_at: ts });
    lastHeartbeatAt = Date.now();
  } catch {}
}

// ── Web multi-tab leadership ────────────────────────────────────────────────
// Every browser tab shares one IndexedDB, so letting each tab run its own
// push/pull loop would sync the same rows N times. On web only the tab
// holding the Web Lock runs the loop; other tabs relay their "sync now"
// requests over BroadcastChannel and take over when the leader closes.
const isWeb = () => Platform.OS === "web";
let webLeader = !isWeb();
let webChannel: BroadcastChannel | null = null;
let webLockRelease: (() => void) | null = null;

async function acquireWebLeadership(): Promise<boolean> {
  if (!isWeb()) return true;
  if (webLeader) return true;
  const locks = (navigator as { locks?: { request: (...args: unknown[]) => Promise<unknown> } }).locks;
  if (!locks || typeof locks.request !== "function") {
    // No Web Locks (very old browser): fall back to per-tab syncing.
    webLeader = true;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => {
      release = r;
    });
    locks
      .request("jesyon-autosync", { ifAvailable: true }, async (lock: unknown) => {
        if (!lock) {
          resolve(false);
          return;
        }
        webLeader = true;
        webLockRelease = () => {
          try {
            release?.();
          } catch {
            /* already released */
          }
        };
        resolve(true);
        // Hold the lock for as long as this tab is the leader.
        await held;
        webLeader = false;
        webLockRelease = null;
      })
      .catch(() => resolve(false));
  });
}

function setupWebSyncChannel(): void {
  if (webChannel || typeof BroadcastChannel === "undefined") return;
  try {
    webChannel = new BroadcastChannel("jesyon-sync");
    webChannel.onmessage = (event: MessageEvent) => {
      if (!webLeader || !started) return;
      const data = event.data as { kind?: string } | undefined;
      if (data?.kind === "sync-now") schedule(0);
    };
  } catch {
    webChannel = null;
  }
}

// Last auth failure (401/403 from middleware). Surfaces on the home screen so a
// register whose token died isn't a silent empty forever. Cleared on the
// next successful sync cycle.
let lastAuthError: string | null = null;
const authErrorListeners = new Set<(msg: string | null) => void>();

function setAuthError(msg: string | null): void {
  if (lastAuthError === msg) return;
  lastAuthError = msg;
  for (const l of [...authErrorListeners]) {
    try { l(msg); } catch {}
  }
}

/** Subscribe to sync auth-error changes. Returns an unsubscribe fn. */
export function onSyncAuthError(cb: (msg: string | null) => void): () => void {
  authErrorListeners.add(cb);
  cb(lastAuthError);
  return () => { authErrorListeners.delete(cb); };
}

export function getSyncAuthError(): string | null {
  return lastAuthError;
}

// --- Sync status bus ------------------------------------------------------
// Quiet, observable state for the status chip: idle / initial download /
// stale catch-up, with a running record count. Normal incremental pulls stay
// silent — no UI, no warning (the app just has the data).
export type SyncPhase = "idle" | "initial" | "catchup";
export interface SyncStatus {
  phase: SyncPhase;
  records: number;
  /** True while a cycle is in flight (any phase). */
  busy: boolean;
  /** Last push-reject / pull failure as human-language alert lines (raw
   * server errors never reach the screen). Cleared on the next fully
   * successful cycle; the banner auto-hides 30s after each new alert. */
  alert: SyncAlert | null;
  /** An initial download is due but not currently running (failed mid-way,
   * offline) — the banner reads "retrying" instead of vanishing. */
  initialPending: boolean;
}
let syncStatus: SyncStatus = { phase: "idle", records: 0, busy: false, alert: null, initialPending: false };
const statusListeners = new Set<(s: SyncStatus) => void>();

function alertKey(a: SyncAlert | null): string {
  return a ? `${a.title}|${a.lines.join("|")}` : "";
}

function setSyncStatus(patch: Partial<SyncStatus>): void {
  const next = { ...syncStatus, ...patch };
  if (next.phase === syncStatus.phase && next.records === syncStatus.records && next.busy === syncStatus.busy && alertKey(next.alert) === alertKey(syncStatus.alert) && next.initialPending === syncStatus.initialPending) return;
  syncStatus = next;
  for (const l of [...statusListeners]) {
    try { l(next); } catch {}
  }
}

/** Subscribe to the quiet sync-status feed (initial download / catch-up). */
export function onSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb);
  cb(syncStatus);
  return () => { statusListeners.delete(cb); };
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

const isPlaceholderId = (id?: string | null) => !id || id === "device-pending" || id === "device-unknown";

/** Point the loop at this device. A placeholder id never downgrades a real one. */
export function configureSync(nextStoreId?: string | null, nextDeviceId?: string | null): void {
  if (!nextStoreId || !nextDeviceId) return;
  if (isPlaceholderId(nextDeviceId) && manager) return;
  if (nextStoreId === storeId && nextDeviceId === deviceId && manager) return;
  storeId = nextStoreId;
  deviceId = nextDeviceId;
  manager = new SyncManager(nextStoreId, nextDeviceId);
  // New manager = new device/store context — re-resolve initial/stale mode.
  modeResolved = false;
  pendingInitial = false;
  pendingCatchup = false;
  setSyncStatus({ initialPending: false });
}

export function isSyncConfigured(): boolean {
  return !!manager;
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timerDueAt = Date.now() + delayMs;
  timer = setTimeout(() => {
    timer = null;
    void syncNow({ quiet: true });
  }, delayMs);
}

/**
 * Push then pull. `quiet` only silences the console — failures are always
 * handled (retry sooner) because a flaky wifi must not become a crash.
 */
export async function syncNow(opts?: { quiet?: boolean; storeId?: string; deviceId?: string }): Promise<boolean> {
  configureSync(opts?.storeId, opts?.deviceId);
  if (!manager) return false;
  if (running) {
    // A cycle is in flight: run one more when it finishes rather than dropping
    // the request (the write that asked for this sync would wait a whole period).
    pending = true;
    return false;
  }
  running = true;
  let ok = true;
  try {
    // Middleware trusts only the JWT: attach the current access token, and in
    // live mode skip the cycle entirely without one (PIN unlock after expiry,
    // signed out) — a token-less push would 401 and a token-less pull would
    // return another tenant's data.
    const token = await resolveAccessToken();
    manager.setAccessToken(token ?? null);
    if (!token && (await isLiveAuthEnabled())) {
      ok = false;
      return false;
    }
    // Presence pulse — queued before the push so this cycle carries it.
    await maybeHeartbeat();
    // Device-mode check happens once per configured manager: a fresh device
    // (empty DB + real account) runs the phased initial download; a device
    // whose cursor is >STALE_AFTER_DAYS old sweeps open items on top of the
    // incremental pull. Both show the quiet indicator, never an alert.
    if (!modeResolved) {
      modeResolved = true;
      try {
        if (await manager.needsInitialDownload()) pendingInitial = true;
        else {
          const age = await manager.pullCursorAgeMs();
          if (age != null && age > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000) pendingCatchup = true;
          // Existing device, once: re-queue catalog rows that never reached
          // the cloud (dropped outbox entries, pre-fix writes). Fresh devices
          // skip — they have nothing local worth republishing.
          void import("./repairCatalog")
            .then(m => m.republishStrandedCatalog())
            .catch(() => {});
        }
      } catch {}
    }
    let authFailed = false;
    let pushClean = true;
    try {
      const report = await manager.pushToCloud();
      // Rejected rows would otherwise die silently after 8 attempts — raise
      // a human-language alert (raw server codes never reach the screen).
      if (report.rejected.length) {
        pushClean = false;
        const alert = describeRejects(report.rejected);
        if (alert) setSyncStatus({ alert });
      }
      // Subscription write-gate: the org went read-only server-side. Refresh
      // the local snapshot so every guard flips immediately (UI says why),
      // and keep the rows — they push after renewal.
      if (report.subscriptionBlocked) {
        void import("../subscription/subscription")
          .then(m => m.refreshSubscriptionFromDb({ force: true }))
          .catch(() => {});
      }
    } catch (e) {
      ok = false;
      if (isAuthError(e)) authFailed = true;
      if (!opts?.quiet) console.warn("[sync] push failed", e);
    }
    try {
      if (pendingInitial) {
        setSyncStatus({ phase: "initial", records: 0, busy: true, initialPending: true });
        const received = await manager.initialDownload(n => setSyncStatus({ phase: "initial", records: n }));
        pendingInitial = false;
        setSyncStatus({ initialPending: false });
        if (received > 0) await emitPulled();
      } else {
        if (pendingCatchup) setSyncStatus({ phase: "catchup", records: 0, busy: true });
        const received = await manager.pullFromCloud();
        if (received > 0) await emitPulled();
        if (pendingCatchup) {
          const swept = await manager.openItemsSweep();
          pendingCatchup = false;
          if (swept > 0) await emitPulled();
        }
      }
    } catch (e) {
      ok = false;
      if (isAuthError(e)) authFailed = true;
      else setSyncStatus({ alert: describePullError() });
      if (!opts?.quiet) console.warn("[sync] pull failed", e);
    } finally {
      setSyncStatus({ phase: "idle", busy: false });
    }
    // A fully clean cycle (push accepted everything, pull landed) clears the
    // alert — it never goes stale.
    if (ok && pushClean) setSyncStatus({ alert: null });
    // Offline is not "session expired": a 401 only means something when the
    // device could actually reach the network. Suppressing the banner offline
    // stops the offline-login flow from screaming a false expiry every cycle.
    const online = getOnline();
    // A 401/403 from middleware means our token is stale or the session is
    // gone. Retry once with a freshly-refreshed token instead of looping on the
    // same dead JWT forever (that's what froze a register's pull cursor and left
    // it with an empty catalog).
    if (authFailed && online && (await isLiveAuthEnabled())) {
      const fresh = await refreshAccessToken();
      if (fresh) {
        manager.setAccessToken(fresh);
        try {
          await manager.pushToCloud();
          try {
            const received = await manager.pullFromCloud();
            if (received > 0) await emitPulled();
            ok = true;
          } catch (e2) {
            if (isAuthError(e2)) authFailed = true; else ok = true;
          }
        } catch (e2) {
          if (isAuthError(e2)) authFailed = true;
        }
      }
    }
    setAuthError(authFailed && online ? "Sesyon an ekspire — konekte ankò." : null);
    // Payroll (028): if this device's clock saw the pay cycle expire, ask the
    // server to close it (it alone writes the payments + emails). Throttled
    // and local-expiry-gated inside; never blocks the cycle.
    if (!authFailed) {
      void import("../payroll").then(m => m.requestPeriodClose()).catch(() => {});
      // Keep the local subscription snapshot fresh on a working connection
      // (throttled inside; a renewal lifts the read-only logic everywhere).
      void import("../subscription/subscription").then(m => m.refreshSubscriptionFromDb()).catch(() => {});
    }
  } finally {
    running = false;
    if (pending) {
      pending = false;
      schedule(0);
    } else {
      schedule(
        ok
          ? urgent ? FAST_SYNC_INTERVAL_MS : SYNC_INTERVAL_MS
          : urgent ? URGENT_RETRY_MS : FAILURE_RETRY_MS
      );
    }
  }
  return ok;
}

/** Called after a local write: sync within ~a second, batching bursts. */
export function requestSync(delayMs: number = WRITE_DEBOUNCE_MS): void {
  if (!manager || !started) return;
  // Web follower tab: the leader owns the loop — ask it to run a cycle.
  if (isWeb() && !webLeader) {
    try {
      webChannel?.postMessage({ kind: "sync-now" });
    } catch {
      /* relay is best-effort; the leader's period still catches the write */
    }
    return;
  }
  // Fast lane: a status change (line delivered, tab ready…) must leave almost
  // immediately — collapse any longer debounce the caller asked for.
  if (urgent && delayMs > URGENT_WRITE_DEBOUNCE_MS) delayMs = URGENT_WRITE_DEBOUNCE_MS;
  // A cycle is already running — it will pick the write up on the follow-up
  // pass rather than letting the finally-block swallow this request.
  if (running) {
    pending = true;
    return;
  }
  if (timer && timerDueAt <= Date.now() + delayMs) return;
  schedule(delayMs);
}

/**
 * Priority lane for time-critical screens (order/line status). While on:
 * writes leave within ~150ms, a pull runs every FAST_SYNC_INTERVAL_MS instead
 * of SYNC_INTERVAL_MS, failures retry sooner — and turning it on pulls
 * immediately so the screen catches up the moment it opens.
 */
export function setUrgentSync(on: boolean): void {
  urgent = on;
  if (isWeb() && !webLeader) {
    try {
      webChannel?.postMessage({ kind: "sync-now" });
    } catch {
      /* relay is best-effort */
    }
    return;
  }
  if (started) schedule(on ? 0 : SYNC_INTERVAL_MS);
}

async function emitPulled(): Promise<void> {
  try {
    const { salesEvents } = await import("../salesEvents");
    salesEvents.emit();
  } catch {}
}

/** Boot the loop: sync now, then on a timer and on every foreground. */
export function startAutoSync(): void {
  if (started) return;
  started = true;
  if (isWeb()) setupWebSyncChannel();
  try {
    subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;
      if (isWeb() && !webLeader) {
        // A background tab can become the leader once the previous one closes.
        void acquireWebLeadership().then((ok) => {
          if (ok && started) schedule(0);
        });
        return;
      }
      schedule(0);
    });
  } catch {}
  if (isWeb()) {
    void acquireWebLeadership().then((ok) => {
      if (ok && started) schedule(0);
    });
  } else {
    schedule(0);
  }
}

export function stopAutoSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  timerDueAt = 0;
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  if (webLockRelease) {
    try { webLockRelease(); } catch {}
    webLockRelease = null;
  }
  if (webChannel) {
    try { webChannel.close(); } catch {}
    webChannel = null;
  }
  started = false;
  pending = false;
}

/** Live auth = Supabase JWTs are real; mock = middleware accepts token-less calls. */
async function isLiveAuthEnabled(): Promise<boolean> {
  try {
    const { isLiveSupabase } = await import("../auth/supabase");
    return isLiveSupabase;
  } catch {
    return false;
  }
}

async function resolveAccessToken(): Promise<string | null> {
  try {
    const { getAccessToken } = await import("../auth/authStore");
    return await getAccessToken();
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { refreshAccessToken } = await import("../auth/authStore");
    return await refreshAccessToken();
  } catch {
    return null;
  }
}

function isAuthError(e: unknown): boolean {
  return e instanceof SyncAuthError || (e as any)?.name === "SyncAuthError";
}
