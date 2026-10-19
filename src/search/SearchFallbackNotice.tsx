import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ht } from "../i18n";
import type { FallbackSearchStatus } from "./localFirstSearch";

/**
 * Quiet inline notice under a search box for the local-first fallback:
 * - "searching" — one-time server lookup in flight (spinner-free, muted text)
 * - "remote"    — results came from the server (not stored on this device)
 * - "unavailable" — offline and the row is older than the local window
 */
export function SearchFallbackNotice({ status }: { status: FallbackSearchStatus }) {
  if (status === "idle" || status === "local") return null;
  const tone =
    status === "unavailable"
      ? { icon: "cloud-offline-outline" as const, color: "#fbbf24", text: `${ht.searchOlderLocal} — ${ht.searchNeedsConnection}` }
      : status === "searching"
        ? { icon: "cloud-upload-outline" as const, color: "#94a3b8", text: ht.searchingOnline }
        : { icon: "cloud-outline" as const, color: "#93c5fd", text: `${ht.fromServer} — ${ht.searchOlderLocal}` };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
      <Ionicons name={tone.icon} size={13} color={tone.color} />
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: tone.color, flex: 1 }}>{tone.text}</Text>
    </View>
  );
}
