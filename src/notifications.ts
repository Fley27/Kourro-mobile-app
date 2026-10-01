import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

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

export async function notifyLocal(title: string, body: string): Promise<void> {
  try {
    const ok = await ensurePermitted();
    if (!ok) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: null,
    });
  } catch {
    // Notifications are best-effort; never break the underlying action
  }
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
