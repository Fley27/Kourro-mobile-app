// Stable device identifier persisted in HARD memory (disk), not RAM.
//
// - Uses expo-secure-store (iOS Keychain / Android EncryptedSharedPreferences).
//   Survives JS rebundles, Fast Refresh, and full app restarts.
//   Only cleared on app uninstall / explicit reset.
// - Previously App.tsx generated `device-xxxx` with Math.random() on every JS
//   load, so suspended-sales attribution + sync device_id changed after each
//   rebundle. This helper generates once and reuses forever.
import * as SecureStore from "expo-secure-store";

const DEVICE_KEY = "jm_device_id";

let cached: string | null = null;

function randomId(): string {
  return (
    "device-" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {}
  const fresh = randomId();
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, fresh);
  } catch {}
  cached = fresh;
  return fresh;
}

// Synchronous fallback for first render (before async load resolves).
// Never use this as the source of truth — always hydrate via
// getOrCreateDeviceId() in a useEffect and pass the state down.
export function getCachedDeviceId(fallback = "device-pending"): string {
  return cached ?? fallback;
}
