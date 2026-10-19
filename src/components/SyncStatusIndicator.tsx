import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { onSyncStatus, type SyncStatus } from "../sync/autoSync";
import { ht } from "../i18n";

/**
 * Quiet, unobtrusive indicator while the device is catching up (initial
 * download or stale sweep). Never blocks the user — sync runs in the
 * background and the cashier keeps working. Hidden when idle: a normal
 * online pull is silent by design; push rejections and pull failures surface
 * as the human-language SyncIssueBanner instead.
 */
export function SyncStatusIndicator() {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  React.useEffect(() => onSyncStatus(setStatus), []);
  if (!status || status.phase === "idle") return null;
  const label =
    status.phase === "initial"
      ? `${ht.initialDownload}… ${status.records > 0 ? status.records.toLocaleString() : ""}`.trim()
      : ht.catchupSync;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 88, alignItems: "center" }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: "rgba(15,23,42,0.88)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Ionicons name="cloud-download-outline" size={14} color="#93c5fd" />
        <Text style={{ fontFamily: "Inter_500Medium", color: "#e2e8f0", fontSize: 12, letterSpacing: -0.1 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}
