// PICKUP: toggle card, visible to every seller role.
// Delete with the pickup-staging folder (see flag.ts).
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { palette } from "../theme";
import { getPickupEnabled, setPickupEnabled } from "./flag";

export default function PickupToggleCard({ storeId, role }: { storeId: string; role?: string | null }) {
  void role; // every seller role has full access
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getPickupEnabled(storeId).then(v => setEnabled(v)).catch(() => {}).finally(() => setLoading(false));
  }, [storeId]);
  async function flip() {
    try {
      const next = !enabled;
      await setPickupEnabled(storeId, next);
      setEnabled(next);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Toggle echwe");
    }
  }
  return (
    <View style={{ backgroundColor: palette.warningBg, borderWidth: 1, borderColor: palette.warningBd, borderRadius: 14, padding: 12, marginTop: 12 }}>
      <Text style={{ fontWeight: "800", fontSize: 13, color: palette.warning }}>
        Partial Pickup{loading ? "…" : enabled ? " • ON" : " • OFF"}
      </Text>
      <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 4 }}>
        Disponib pou tout vandè sou aparèy sa a.
      </Text>
      <Pressable
        onPress={flip}
        style={{ marginTop: 10, backgroundColor: enabled ? palette.danger : palette.ink2, borderRadius: 10, paddingVertical: 11, alignItems: "center" }}
      >
        <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>
          {enabled ? "Etenn" : "Limon"}
        </Text>
      </Pressable>
    </View>
  );
}
