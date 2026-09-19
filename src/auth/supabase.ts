// Mobile Supabase client with SecureStore-backed session persistence.
import { createClient, type Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key";
export const middlewareUrl = process.env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000";

export const isLiveSupabase = !supabaseUrl.includes("localhost") && supabaseAnonKey !== "anon-key";

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