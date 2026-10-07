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
 */
import { AppState, type AppStateStatus } from "react-native";
import { SyncManager } from "./syncManager";

const SYNC_INTERVAL_MS = 30_000;
// A checkout writes ~a dozen outbox rows back to back — batch them into one push.
const WRITE_DEBOUNCE_MS = 1_200;
const FAILURE_RETRY_MS = 8_000;

let storeId: string | null = null;
let deviceId: string | null = null;
let manager: SyncManager | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerDueAt = 0;
let running = false;
let pending = false;
let started = false;
let subscription: { remove(): void } | null = null;

const isPlaceholderId = (id?: string | null) => !id || id === "device-pending" || id === "device-unknown";

/** Point the loop at this device. A placeholder id never downgrades a real one. */
export function configureSync(nextStoreId?: string | null, nextDeviceId?: string | null): void {
  if (!nextStoreId || !nextDeviceId) return;
  if (isPlaceholderId(nextDeviceId) && manager) return;
  if (nextStoreId === storeId && nextDeviceId === deviceId && manager) return;
  storeId = nextStoreId;
  deviceId = nextDeviceId;
  manager = new SyncManager(nextStoreId, nextDeviceId);
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
    try {
      await manager.pushToCloud();
    } catch (e) {
      ok = false;
      if (!opts?.quiet) console.warn("[sync] push failed", e);
    }
    try {
      const received = await manager.pullFromCloud();
      // Only wake the screens when the pull actually brought something —
      // otherwise every list would re-query SQLite every 30s for nothing.
      if (received > 0) await emitPulled();
    } catch (e) {
      ok = false;
      if (!opts?.quiet) console.warn("[sync] pull failed", e);
    }
  } finally {
    running = false;
    if (pending) {
      pending = false;
      schedule(0);
    } else {
      schedule(ok ? SYNC_INTERVAL_MS : FAILURE_RETRY_MS);
    }
  }
  return ok;
}

/** Called after a local write: sync within ~a second, batching bursts. */
export function requestSync(delayMs: number = WRITE_DEBOUNCE_MS): void {
  if (!manager || !started) return;
  // A cycle is already running — it will pick the write up on the follow-up
  // pass rather than letting the finally-block swallow this request.
  if (running) {
    pending = true;
    return;
  }
  if (timer && timerDueAt <= Date.now() + delayMs) return;
  schedule(delayMs);
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
  try {
    subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") schedule(0);
    });
  } catch {}
  schedule(0);
}

export function stopAutoSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  timerDueAt = 0;
  if (subscription) {
    try { subscription.remove(); } catch {}
    subscription = null;
  }
  started = false;
  pending = false;
}
