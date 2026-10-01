/**
 * Bridge between the root-level OrdersFab and the orders data.
 * Count = not-yet-paid orders (open / ready / settling — the listOrders
 * default). Ownership: the root refreshes from the DB on mount/resume, and
 * OrdersScreen bumps it on every reload (create / ready / settle / close all
 * happen while that screen is mounted).
 */
type CountListener = (n: number) => void;

let count = 0;
const listeners = new Set<CountListener>();

export const ordersUI = {
  setCount(n: number) {
    const v = Math.max(0, n | 0);
    if (v === count) return;
    count = v;
    listeners.forEach(l => {
      try { l(v); } catch {}
    });
  },
  subscribeCount(l: CountListener) {
    listeners.add(l);
    try { l(count); } catch {}
    return () => { listeners.delete(l); };
  },
};
