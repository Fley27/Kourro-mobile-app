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
