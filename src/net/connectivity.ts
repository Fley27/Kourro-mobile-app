// Shared connectivity signal. No native deps: a short fetch probe (works on
// Expo + web), refcounted so any number of consumers share one poller.
// Defaults to online — the app must never block on a probe.
import { useEffect, useState } from "react";

const PROBE_URL = "https://www.google.com/generate_204";
const TIMEOUT_MS = 6000;
const POLL_MS = 20000;

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    // `no-cors` matters on web: google.com sends no CORS headers, so a plain
    // cross-origin fetch always rejects there and the app would show
    // "no internet" forever. An opaque success has status 0 (handled below);
    // a real outage still rejects. Native fetches are not CORS-bound.
    const res = await fetch(PROBE_URL, { method: "GET", signal: ctrl.signal, mode: "no-cors" });
    clearTimeout(t);
    return res.ok || res.status === 204 || res.status === 0;
  } catch {
    return false;
  }
}

let online = true;
let probing = false;
const listeners = new Set<(v: boolean) => void>();

function setOnline(v: boolean): void {
  if (online === v) return;
  online = v;
  for (const l of [...listeners]) {
    try { l(v); } catch {}
  }
}

async function refresh(): Promise<void> {
  if (probing) return;
  probing = true;
  try { setOnline(await probe()); } finally { probing = false; }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function ensurePoller(): void {
  if (pollTimer) return;
  void refresh();
  pollTimer = setInterval(() => { void refresh(); }, POLL_MS);
}

function releasePoller(): void {
  if (listeners.size > 0 || !pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/** Latest known connectivity (no await). */
export function getOnline(): boolean {
  return online;
}

/** Force an immediate probe (e.g. after a sync failure). */
export function recheckOnline(): Promise<boolean> {
  return refresh().then(() => online);
}

/** Subscribe to connectivity changes. Returns an unsubscribe fn. */
export function onOnlineChange(cb: (online: boolean) => void): () => void {
  listeners.add(cb);
  ensurePoller();
  return () => {
    listeners.delete(cb);
    releasePoller();
  };
}

/** React hook form of onOnlineChange. Defaults to online until proven otherwise. */
export function useOnline(): boolean {
  const [v, setV] = useState(online);
  useEffect(() => onOnlineChange(setV), []);
  return v;
}
