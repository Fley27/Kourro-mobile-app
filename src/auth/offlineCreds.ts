// Per-user offline login credentials.
//
// When a user logs in ONLINE (live Supabase), their identity + a salted
// PBKDF2-SHA256 hash of the password are cached in SecureStore (Keychain /
// Keystore), keyed by their user id. On a device with no internet, a login
// attempt is verified against this cache instead of Supabase.
//
// The offline window is 30 days SINCE THE LAST SUCCESSFUL ONLINE LOGIN, and it
// is PER USER — one shared tablet can hold several staff members, each with
// their own independent window. Sign-out never deletes these records: the
// whole point is to log in and out repeatedly while offline.
//
// The password itself is never stored. SecureStore already encrypts at rest;
// the hash only adds a second line of defense if the app sandbox is breached.
import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Role } from "../users";
import type { SubscriptionSnapshot } from "../subscription/types";

export const OFFLINE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const CRED_PREFIX = "jm_offline_cred_";
const INDEX_KEY = "jm_offline_cred_index";
// 100k iterations is a login-only cost (~sub-second on modern devices) and
// gives the offline cache real brute-force resistance if extracted.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type OfflineCredRecord = {
  v: 1;
  userId: string;
  email: string;
  name: string;
  role: Role;
  store: string;
  orgId: string | null;
  password: { alg: "pbkdf2-sha256"; salt: string; iterations: number; hash: string } | null;
  /** ISO time of the last successful ONLINE authentication for this user. */
  lastOnlineAuthAt: string;
  subscription: SubscriptionSnapshot | null;
  updatedAt: string;
};

export type OfflineCredSummary = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  store: string;
  lastOnlineAuthAt: string;
};

export type OfflineVerifyResult =
  | { ok: true; record: OfflineCredRecord; remainingMs: number }
  | { ok: false; reason: "unknown" | "expired" | "bad_password"; record?: OfflineCredRecord };

const credKey = (userId: string) => `${CRED_PREFIX}${userId}`;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try { await SecureStore.setItemAsync(key, JSON.stringify(value)); } catch {}
}

async function readIndex(): Promise<string[]> {
  const raw = await readJson<string[]>(INDEX_KEY);
  return Array.isArray(raw) ? raw.filter(id => typeof id === "string") : [];
}

async function writeIndex(ids: string[]): Promise<void> {
  await writeJson(INDEX_KEY, [...new Set(ids)]);
}

export function hashPassword(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): string {
  return bytesToHex(
    pbkdf2(sha256, utf8ToBytes(password), hexToBytes(saltHex), { c: iterations, dkLen: HASH_BYTES })
  );
}

/** Constant-time-ish string compare (no early exit on the first mismatch). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function getOfflineCred(userId: string): Promise<OfflineCredRecord | null> {
  const rec = await readJson<OfflineCredRecord>(credKey(userId));
  return rec && rec.v === 1 ? rec : null;
}

export async function getOfflineCredByEmail(email: string): Promise<OfflineCredRecord | null> {
  const key = email.trim().toLowerCase();
  const ids = await readIndex();
  for (const id of ids) {
    const rec = await getOfflineCred(id);
    if (rec && rec.email.toLowerCase() === key) return rec;
  }
  return null;
}

/** Cached users on this device (login picker), newest login first. */
export async function listOfflineCredSummaries(): Promise<OfflineCredSummary[]> {
  const ids = await readIndex();
  const out: OfflineCredSummary[] = [];
  for (const id of ids) {
    const rec = await getOfflineCred(id);
    if (!rec) continue;
    out.push({
      userId: rec.userId,
      email: rec.email,
      name: rec.name,
      role: rec.role,
      store: rec.store,
      lastOnlineAuthAt: rec.lastOnlineAuthAt,
    });
  }
  out.sort((a, b) => String(b.lastOnlineAuthAt).localeCompare(String(a.lastOnlineAuthAt)));
  return out;
}

/**
 * Cache (or refresh) the credentials of a user after a SUCCESSFUL ONLINE
 * login. Passing `password` re-hashes it; omitting it keeps the existing hash
 * (boot-restore refresh of `lastOnlineAuthAt` / subscription snapshot).
 */
export async function saveOfflineCredential(input: {
  userId: string;
  email: string;
  name: string;
  role: Role;
  store: string;
  orgId: string | null;
  password?: string;
  subscription?: SubscriptionSnapshot | null;
  /** Set only when this call results from a Supabase-authenticated session. */
  onlineAuthAt?: string;
  /** Keep the existing hash if no password is given but no record exists yet. */
}): Promise<OfflineCredRecord | null> {
  const existing = await getOfflineCred(input.userId);
  let password = existing?.password ?? null;
  if (input.password) {
    const salt = bytesToHex(getRandomBytes(SALT_BYTES));
    password = {
      alg: "pbkdf2-sha256",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: hashPassword(input.password, salt, PBKDF2_ITERATIONS),
    };
  }
  // Without a cached password hash there is nothing to verify offline — a
  // record with only profile data would show in the picker and always fail.
  if (!password) return null;
  const now = new Date().toISOString();
  const rec: OfflineCredRecord = {
    v: 1,
    userId: input.userId,
    email: input.email,
    name: input.name,
    role: input.role,
    store: input.store,
    orgId: input.orgId,
    password,
    lastOnlineAuthAt: input.onlineAuthAt ?? existing?.lastOnlineAuthAt ?? now,
    subscription: input.subscription !== undefined ? input.subscription : (existing?.subscription ?? null),
    updatedAt: now,
  };
  await writeJson(credKey(rec.userId), rec);
  const ids = await readIndex();
  if (!ids.includes(rec.userId)) {
    ids.push(rec.userId);
    await writeIndex(ids);
  }
  return rec;
}

/** Patch a cached record (subscription snapshot / online-auth refresh). */
export async function touchOfflineCredential(
  userId: string,
  patch: Partial<Pick<OfflineCredRecord, "subscription" | "lastOnlineAuthAt" | "store" | "role" | "name" | "orgId">>
): Promise<void> {
  const rec = await getOfflineCred(userId);
  if (!rec) return;
  const next: OfflineCredRecord = { ...rec, ...patch, updatedAt: new Date().toISOString() };
  await writeJson(credKey(userId), next);
}

export async function removeOfflineCredential(userId: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(credKey(userId)); } catch {}
  const ids = await readIndex();
  await writeIndex(ids.filter(id => id !== userId));
}

export function offlineCredWithinWindow(rec: OfflineCredRecord, now: number = Date.now()): boolean {
  const t = Date.parse(rec.lastOnlineAuthAt);
  if (isNaN(t)) return false;
  return now - t <= OFFLINE_WINDOW_MS;
}

/**
 * Verify an offline login: cached record for the email, within its own 30-day
 * window, and the password matching the cached hash.
 */
export async function verifyOfflinePassword(email: string, password: string): Promise<OfflineVerifyResult> {
  const rec = await getOfflineCredByEmail(email);
  if (!rec || !rec.password) return { ok: false, reason: "unknown" };
  const now = Date.now();
  if (!offlineCredWithinWindow(rec, now)) return { ok: false, reason: "expired", record: rec };
  const candidate = hashPassword(password, rec.password.salt, rec.password.iterations);
  if (!safeEqual(candidate, rec.password.hash)) return { ok: false, reason: "bad_password", record: rec };
  return { ok: true, record: rec, remainingMs: OFFLINE_WINDOW_MS - (now - Date.parse(rec.lastOnlineAuthAt)) };
}
