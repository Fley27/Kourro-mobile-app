import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { onSyncStatus, type SyncStatus } from "../sync/autoSync";
import { ht } from "../i18n";

// Time a fresh alert stays on screen before auto-hiding. Keyed on the alert
// content: an identical persisting problem does NOT re-show every cycle (no
// nagging) — only a new or changed alert restarts the clock. A clean sync
// cycle clears the alert underneath immediately via the status bus.
const ALERT_TTL_MS = 30_000;

/**
 * Human-language sync alert banner (amber, under the header — the red slot
 * belongs to the auth banner). Raw server/database errors never reach the
 * screen: autoSync already mapped them to sentences in the user's language.
 * Never blocks touches; hides itself after 30s, on ✕, or on the next clean
 * cycle — whichever comes first.
 */
export function SyncIssueBanner() {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => onSyncStatus(setStatus), []);
  const key = status?.alert ? `${status.alert.title}|${status.alert.lines.join("|")}` : "";
  React.useEffect(() => {
    if (!key) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), ALERT_TTL_MS);
    return () => clearTimeout(t);
  }, [key]);
  if (!visible || !status?.alert) return null;
  const { title, lines } = status.alert;
  return (
    <View
      style={{
        backgroundColor: "#451a03",
        borderBottomWidth: 1,
        borderBottomColor: "rgba(251,191,36,0.35)",
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(251,191,36,0.15)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="warning-outline" size={15} color="#fbbf24" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Inter_700Bold", color: "#fde68a", fontSize: 12, letterSpacing: -0.1 }}>{title}</Text>
          {lines.map((l, i) => (
            <Text key={i} style={{ fontFamily: "Inter_400Regular", color: "#fcd34d", fontSize: 11, marginTop: i === 0 ? 2 : 3 }}>
              {l}
            </Text>
          ))}
        </View>
        <Pressable onPress={() => setVisible(false)} hitSlop={10} accessibilityLabel={ht.syncAlertClose}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#fbbf24" }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
