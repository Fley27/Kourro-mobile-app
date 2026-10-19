import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { onSyncStatus, type SyncStatus } from "../sync/autoSync";
import { ht } from "../i18n";

/**
 * First-download banner: a new device starts with an empty database, so its
 * screens would otherwise look broken-blank while the initial download runs.
 * This slim full-width bar says data is on its way (with a live count) and
 * dismisses itself when the download lands. It never blocks touches outside
 * its own strip — the register stays fully usable mid-download. Reserved for
 * the initial download; stale catch-ups keep the quiet pill only.
 */
export function InitialDownloadBanner() {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  React.useEffect(() => onSyncStatus(setStatus), []);
  if (!status) return null;
  // Mid-download: live count. Failed/offline between retries: honest
  // "retrying" line instead of vanishing over an empty catalog.
  const running = status.phase === "initial";
  if (!running && !status.initialPending) return null;
  const count = running && status.records > 0 ? ` • ${status.records.toLocaleString()} ${ht.itemsDownloaded}` : "";
  const label = running ? `${ht.firstDownloadRunning}${count}` : ht.retryingDownload;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: "#0f172a",
        borderBottomWidth: 1,
        borderBottomColor: "rgba(147,197,253,0.25)",
      }}
    >
      <ActivityIndicator size="small" color="#93c5fd" />
      <Ionicons name="cloud-download-outline" size={16} color="#93c5fd" />
      <Text style={{ flex: 1, fontFamily: "Inter_500Medium", color: "#e2e8f0", fontSize: 13 }}>
        {label}
      </Text>
    </View>
  );
}
