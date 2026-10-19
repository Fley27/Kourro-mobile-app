import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Full-width banner shown when the middleware rejects this device's token
 * (401/403). Without it a dead session just looks like an empty store — the
 * sync loop retries in the background and never tells anyone. Cleared by
 * autoSync on the next successful cycle.
 */
export function SyncErrorBanner({ message, onSignOut }: { message: string | null; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: "#b91c1c", borderBottomWidth: 0.5, borderColor: "rgba(0,0,0,0.3)", paddingHorizontal: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="cloud-offline-outline" size={15} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontSize: 12, letterSpacing: -0.1 }}>Sync pa mache</Text>
        <Text numberOfLines={1} style={{ fontFamily: "Inter_400Regular", color: "#fecaca", fontSize: 11, marginTop: 1 }}>{message}</Text>
      </View>
      <Pressable onPress={onSignOut} hitSlop={8}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>Konekte ankò →</Text>
      </Pressable>
    </View>
  );
}
