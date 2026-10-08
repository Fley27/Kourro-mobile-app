import { useCallback, useEffect, useState } from "react";
import { getOrderBundle } from "./store";
import { useSalesEvents } from "../salesEvents";
import type { ChangeRequest, Order, OrderLine } from "./types";

export type OrderBundle = { order: Order; lines: OrderLine[]; requests: ChangeRequest[] };

/**
 * Live view of one open order. Every writer in store.ts mutates the same
 * tables, so callers bump `tick` after an action — and a pull that landed
 * from another register (autoSync → salesEvents) reloads it too, without
 * which the open Tab detail keeps showing the statuses it had on open.
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
  // Another register delivered a line / readied a tab → refresh this board.
  useSalesEvents(() => { reload().catch(() => {}); });

  return { bundle, loading, reload };
}
