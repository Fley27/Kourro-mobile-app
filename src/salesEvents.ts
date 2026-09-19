// Simple in-memory pub/sub for realtime sales updates — no native deps
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
