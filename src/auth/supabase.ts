// Mobile Supabase client with SecureStore-backed session persistence.
import { createClient, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key";
export const middlewareUrl = process.env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000";

// `supabase start` binds Kong to 54321 on a private/loopback host — and it is
// often pointed at the machine's LAN IP (192.168.x.x) so a physical phone can
// reach it. A literal `includes("localhost")` test called that "live", which
// hid the demo role picker and swapped the whole sign-in path for real Supabase
// auth on what is still a local dev stack. Only a public host is hosted: the
// private/loopback case is the local one, on Kong's own port.
function isHostedSupabaseUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0") return false;
  if (host === "127.0.0.1" || host === "::1") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return true; // a real hostname (supabase.co, intranet DNS name, …)
  const a = Number(m[1]);
  const b = Number(m[2]);
  const privateNet = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  return !(privateNet && u.port === "54321");
}

export const isLiveSupabase =
  (isHostedSupabaseUrl(supabaseUrl) || process.env.EXPO_PUBLIC_FORCE_LIVE_AUTH === "1") &&
  supabaseAnonKey !== "anon-key";

const SB_SESSION_KEY = "jm_supabase_session";

async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(SB_SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch { return null; }
}
async function writeStoredSession(session: Session | null) {
  try {
    if (session) await SecureStore.setItemAsync(SB_SESSION_KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(SB_SESSION_KEY);
  } catch {}
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: {
      getItem: (k) => readStoredSession().then(s => (s ? JSON.stringify(s) : null)),
      setItem: (k, v) => writeStoredSession(v ? (JSON.parse(v) as Session) : null),
      removeItem: (k) => writeStoredSession(null),
    },
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});