import React from "react";
import { View, Text } from "react-native";

export function SyncBadge({ online, pending }: { online: boolean; pending: number }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: online ? "#dcfce7" : "#fef3c7" }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: online ? "#166534" : "#92400e" }}>
        {online ? `✓ Online` : `○ Offline`} {pending > 0 ? `• ${pending} ap tann` : ""}
      </Text>
    </View>
  );
}
