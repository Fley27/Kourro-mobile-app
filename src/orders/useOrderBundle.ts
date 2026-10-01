import { useCallback, useEffect, useState } from "react";
import { getOrderBundle } from "./store";
import type { ChangeRequest, Order, OrderLine } from "./types";

export type OrderBundle = { order: Order; lines: OrderLine[]; requests: ChangeRequest[] };

/**
 * Live view of one open order. Every writer in store.ts mutates the same
 * tables, so callers bump `tick` after an action (or from a LAN sync event)
 * and the bundle re-reads.
 */
export function useOrderBundle(orderId: string | null | undefined, tick = 0) {
  const [bundle, setBundle] = useState<OrderBundle | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!orderId) { setBundle(null); return; }
    setLoading(true);
    const b = await getOrderBundle(orderId);
    setBundle(b ? { order: b.order, lines: b.lines, requests: b.requests } : null);
    setLoading(false);
  }, [orderId]);

  useEffect(() => { reload(); }, [reload, tick]);

  return { bundle, loading, reload };
}
