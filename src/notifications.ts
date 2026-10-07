import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { NotifRoute } from "./notifRoute";

let handlerConfigured = false;

function configure() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermitted(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  configure();
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Post a local notification. `route` is the record that triggered it — it
 * rides along in `content.data` so a tap can reopen that exact record
 * (see notifRoute.ts). Callers that fire without one are plain status
 * banners with nowhere to go.
 */
export async function notifyLocal(title: string, body: string, route?: NotifRoute): Promise<void> {
  try {
    const ok = await ensurePermitted();
    if (!ok) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: route ? { route } : undefined },
      trigger: null,
    });
  } catch {
    // Notifications are best-effort; never break the underlying action
  }
}

type RouteHandler = (route: NotifRoute) => void;

/**
 * Wire taps (and the cold-start tap that launched the app) to `onRoute`.
 * The listener fires once per response; `lastKey` drops the replay that
 * `getLastNotificationResponseAsync` would otherwise hand us for a response
 * we already acted on. Returns a disposer — App.tsx registers exactly once,
 * so there is no shared subscription state to manage.
 */
export function initNotifRouting(onRoute: RouteHandler): () => void {
  if (Platform.OS === "web") return () => {};
  configure();

  let lastKey: string | null = null;
  const handle = (resp: Notifications.NotificationResponse | null | undefined) => {
    const req = resp?.notification?.request;
    if (!req) return;
    const route = (req.content?.data as { route?: NotifRoute } | undefined)?.route;
    if (!route || typeof route.screen !== "string") return;
    const key = `${req.identifier ?? ""}|${req.content?.title ?? ""}`;
    if (key === lastKey) return;
    lastKey = key;
    console.log("[notif] tap →", JSON.stringify(route));
    try { onRoute(route); } catch { /* a bad route must never break a tap */ }
  };

  let sub: { remove: () => void } | null = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener(handle);
  } catch { /* listener is best-effort */ }
  // Cold start: the app was launched straight from the notification tap, so
  // no live response ever reaches the listener above.
  try {
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  } catch { /* best-effort */ }

  return () => { try { sub?.remove(); } catch { /* ignore */ } };
}

// One stable identifier so re-scheduling replaces the existing reminder
// instead of stacking a new one every time a draft is saved.
const DRAFT_REMINDER_ID = "batch-draft-daily";

/**
 * While at least one batch draft exists, remind once a day. Cancelling a
 * scheduled notification that was never scheduled is a no-op, so this is
 * safe to call unconditionally.
 */
export async function notifyDraftReminder(on: boolean): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    configure();
    if (!on) {
      await Notifications.cancelScheduledNotificationAsync(DRAFT_REMINDER_ID);
      return;
    }
    const ok = await ensurePermitted();
    if (!ok) return;
    await Notifications.scheduleNotificationAsync({
      identifier: DRAFT_REMINDER_ID,
      content: {
        title: "Ou gen yon livrezon ki pa fini",
        body: "Retounen nan Envantè pou fini kowazon an.",
        sound: "default",
      },
      trigger: { hour: 9, minute: 0, repeats: true },
    });
  } catch {
    // Best-effort, same as notifyLocal.
  }
}

// Business Guard: one stable identifier so every reschedule replaces the
// previous Monday review instead of stacking copies.
const DEFICIT_REVIEW_ID = "guard-deficit-weekly-review";

/**
 * Every Monday at 7:00 AM, surface the past week's new deficits for review.
 * The body carries the live count of deficits logged last week, so opening
 * Business Guard (which reschedules) keeps the reminder honest. Count 0 →
 * cancel: there is nothing to review.
 */
export async function notifyWeeklyDeficitReview(newLastWeek: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    configure();
    if (newLastWeek <= 0) {
      await Notifications.cancelScheduledNotificationAsync(DEFICIT_REVIEW_ID);
      return;
    }
    const ok = await ensurePermitted();
    if (!ok) return;
    await Notifications.scheduleNotificationAsync({
      identifier: DEFICIT_REVIEW_ID,
      content: {
        title: `${newLastWeek} new deficit${newLastWeek === 1 ? "" : "s"} to review`,
        body: "Open Reports → Business Guard for the weekly action queue.",
        sound: "default",
      },
      // expo-notifications: weekday 1 = Sunday … 7 = Saturday → Monday = 2
      trigger: { weekday: 2, hour: 7, minute: 0, repeats: true },
    });
  } catch {
    // Best-effort, same as notifyLocal.
  }
}
