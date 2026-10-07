/**
 * Notification deep-linking.
 *
 * Every local notification that points at a record carries a NotifRoute in its
 * payload (see notifyLocal in notifications.ts). Tapping it must land on the
 * screen that record lives on with it already open — never a generic hub the
 * user then has to search. There is no in-app notification list on mobile, so
 * this is the whole story: payload → route → screen.
 *
 * Flow mirrors src/tabsUI.ts:
 *  - App.tsx resolves the tap, switches tab / overlay, then calls
 *    notifUI.request(route).
 *  - The target screen registers a handler when it mounts. A request that
 *    arrives while the screen is unmounted stays parked until it mounts and
 *    drains it.
 * Handlers return true once they consumed the route (so the parked request is
 * cleared) and false to leave it for a later handler.
 */

export type NotifRoute =
  // A daily report → its drill-in (ShiftScreen's ShiftReportDetail).
  | { screen: "report"; id: string }
  // A shift/report queue row → Shift's supervisor team view on that tab,
  // expanded to the row when `id` names one (shift / report ids expand).
  | { screen: "queue"; tab: "pending" | "confirmed" | "disputed"; id?: string }
  // Nothing more specific — just open Shift (its own live view).
  | { screen: "shift" }
  // An open order → the Orders tab's board for that order.
  | { screen: "order"; id: string }
  // A sale → Transactions' sale detail.
  | { screen: "sale"; id: string };

type RouteHandler = (r: NotifRoute) => boolean;

let pending: NotifRoute | null = null;
const handlers = new Set<RouteHandler>();

function flush() {
  if (!pending) return;
  for (const fn of [...handlers]) {
    let ok = false;
    try { ok = fn(pending); } catch { ok = false; }
    if (ok) { pending = null; return; }
  }
}

export const notifUI = {
  // App.tsx calls this once the target screen has been asked to mount.
  request(r: NotifRoute) {
    pending = r;
    flush();
  },
  // Target screens call this once (a stable wrapper + a ref keeps them from
  // re-subscribing on every render). Drains anything parked meanwhile.
  register(fn: RouteHandler) {
    handlers.add(fn);
    flush();
    return () => { handlers.delete(fn); };
  },
};
