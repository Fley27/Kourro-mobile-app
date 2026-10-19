// Local-first search with a one-time online fallback.
//
// Contract (per product spec):
//   1. Always search local SQLite first — a hit is the final answer.
//   2. On a miss, fetch live from the server ONCE — results are held in a
//      session-memory cache only, never written into the synced SQLite and
//      never touching the pull cursor (not a permanent re-sync).
//   3. Offline + miss → a clear "connection needed" state. Never a crash,
//      never a hang: the fetch is gated on connectivity and hard-capped by an
//      AbortController timeout.
import React, { useEffect, useRef, useState } from "react";
import { getDb } from "../db";
import { middlewareUrl } from "../auth/supabase";
import { getOnline } from "../net/connectivity";

export type SearchKind = "customer" | "product" | "supplier" | "sale";

const KIND_TABLE: Record<SearchKind, string> = {
  customer: "customers",
  product: "products",
  supplier: "suppliers",
  sale: "sales",
};

// LIKE wildcards escaped for the local SQLite query.
const escapeLike = (q: string) => q.replace(/[\\%_]/g, m => `\\${m}`);

/** Local SQLite search — SQL LIKE, newest/limit-bounded. Throws never. */
export async function searchLocal(kind: SearchKind, q: string, limit = 50): Promise<any[]> {
  const needle = `%${escapeLike(q.trim())}%`;
  const db = await getDb();
  const notDeleted = "(is_deleted = 0 OR is_deleted IS NULL)";
  switch (kind) {
    case "customer":
      return (await db.getAllAsync(
        `SELECT * FROM customers WHERE ${notDeleted} AND (name LIKE ? OR phone LIKE ? OR id_card_number LIKE ?) ORDER BY name LIMIT ?`,
        [needle, needle, needle, limit]
      )) as any[];
    case "product":
      return (await db.getAllAsync(
        `SELECT * FROM products WHERE ${notDeleted} AND (name LIKE ? OR name_ht LIKE ? OR sku LIKE ? OR barcode LIKE ?) ORDER BY name LIMIT ?`,
        [needle, needle, needle, needle, limit]
      )) as any[];
    case "supplier":
      return (await db.getAllAsync(
        `SELECT * FROM suppliers WHERE ${notDeleted} AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT ?`,
        [needle, needle, limit]
      )) as any[];
    case "sale":
      return (await db.getAllAsync(
        `SELECT * FROM sales WHERE ${notDeleted} AND sale_number LIKE ? ORDER BY created_at DESC LIMIT ?`,
        [needle, limit]
      )) as any[];
  }
}

export type FallbackSearchStatus = "idle" | "local" | "searching" | "remote" | "unavailable";

export interface FallbackSearchState<T = any> {
  status: FallbackSearchStatus;
  rows: T[];
}

// Session-memory cache of one-time remote lookups: same query asked twice in
// one session doesn't hit the network again — but nothing is ever persisted.
const remoteCache = new Map<string, any[]>();
const REMOTE_CACHE_MAX = 200;

async function fetchAccessToken(): Promise<string | null> {
  try {
    const { getAccessToken } = await import("../auth/authStore");
    return await getAccessToken();
  } catch {
    return null;
  }
}

/** One-time server search. Returns [] on any failure — never throws. */
export async function searchRemote(
  kind: SearchKind,
  q: string,
  storeId: string,
  timeoutMs = 6000
): Promise<any[]> {
  const needle = q.trim();
  const cacheKey = `${kind}:${needle.toLowerCase()}`;
  const hit = remoteCache.get(cacheKey);
  if (hit) return hit;
  try {
    const token = await fetchAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(
      `${middlewareUrl}/api/search?q=${encodeURIComponent(needle)}&tables=${KIND_TABLE[kind]}&store_id=${encodeURIComponent(storeId)}`,
      {
        signal: ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    );
    clearTimeout(timer);
    if (!res.ok) return [];
    const payload = await res.json();
    const rows: any[] = Array.isArray(payload?.results) ? payload.results.map((r: any) => r.record) : [];
    if (rows.length) {
      if (remoteCache.size >= REMOTE_CACHE_MAX) remoteCache.clear();
      remoteCache.set(cacheKey, rows);
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Drop-in fallback for a screen whose local filter came up empty. `localHit`
 * is the screen's own in-memory filter result — when it has rows, this hook
 * stays idle (local is the source of truth). On a miss: online → one remote
 * lookup; offline → "unavailable" so the UI can say a connection is needed.
 */
export function useFallbackSearch<T = any>(opts: {
  kind: SearchKind;
  query: string;
  localHit: T[] | null;
  storeId: string | null;
}): FallbackSearchState<T> {
  const { kind, query, localHit, storeId } = opts;
  const [state, setState] = useState<FallbackSearchState<T>>({ status: "idle", rows: [] });
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const q = query.trim();
    if (localHit && localHit.length > 0) {
      setState({ status: "local", rows: [] });
      return;
    }
    if (q.length < 2 || !storeId) {
      setState({ status: "idle", rows: [] });
      return;
    }
    if (getOnline()) {
      setState({ status: "searching", rows: [] });
      void searchRemote(kind, q, storeId).then(rows => {
        if (seq.current !== id) return;
        setState(rows.length ? { status: "remote", rows: rows as T[] } : { status: "unavailable", rows: [] });
      });
    } else {
      // Offline and not in the local window: say so, don't hang or crash.
      setState({ status: "unavailable", rows: [] });
    }
    return () => {};
  }, [kind, query, localHit?.length ?? 0, storeId]);

  return state;
}
