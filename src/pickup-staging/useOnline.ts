// Connectivity probe for receipt-by-email gating. No new native deps:
// a short fetch probe (works on Expo + web). Defaults to online.
import { useEffect, useState } from "react";

const PROBE_URL = "https://www.google.com/generate_204";
const TIMEOUT_MS = 6000;
const POLL_MS = 20000;

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(PROBE_URL, { method: "GET", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status === 204 || res.status === 0;
  } catch {
    return false;
  }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    probe().then(v => { if (alive) setOnline(v); }).catch(() => {});
    const id = setInterval(() => {
      probe().then(v => { if (alive) setOnline(v); }).catch(() => {});
    }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return online;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}
