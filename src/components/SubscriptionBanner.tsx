import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSubscriptionStore } from "../subscription/subscription";

/**
 * Persistent read-only banner: shown whenever the org's subscription is
 * expired/paused/cancelled (or unknown). Reads stay available; write actions
 * are blocked by guardWrite()/UI gates, and the server refuses them anyway.
 * Never dismissible — it reflects live state, not an alert.
 */
export function SubscriptionBanner() {
  const writable = useSubscriptionStore(s => s.writable);
  const ready = useSubscriptionStore(s => s.ready);
  const reason = useSubscriptionStore(s => s.reason);
  if (!ready || writable) return null;
  return (
    <View
      style={{
        backgroundColor: "#450a0a",
        borderBottomWidth: 1,
        borderBottomColor: "rgba(248,113,113,0.35)",
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(248,113,113,0.15)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed-outline" size={15} color="#f87171" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Inter_700Bold", color: "#fecaca", fontSize: 12, letterSpacing: -0.1 }}>
            Mòd li sèlman — abònman an pa aktif
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", color: "#fca5a5", fontSize: 11, marginTop: 2 }}>
            {reason ?? "Kontakte pwopriyetè a pou renouvle abònman an."} Gade done yo rete disponib.
          </Text>
        </View>
      </View>
    </View>
  );
}
