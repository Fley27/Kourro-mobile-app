// Simple in-memory pub/sub for realtime sales updates — no native deps
import { useEffect, useRef } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

export const salesEvents = {
  emit() {
    // notify all listeners synchronously — Home/Analytics reload instantly without polling delay
    for (const l of Array.from(listeners)) {
      try { l(); } catch {}
    }
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/**
 * Keep a screen in sync with salesEvents for as long as it is mounted: a local
 * commit and — through autoSync — a pull that brought records from another
 * register both emit. Only the latest callback is invoked, so it is safe to
 * close over fresh state without re-subscribing on every render.
 *
 *   useSalesEvents(() => { load().catch(() => {}); });
 */
export function useSalesEvents(fn: Listener): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const unsub = salesEvents.subscribe(() => {
      try { ref.current(); } catch {}
    });
    return () => { unsub(); };
  }, []);
}
