// UserProfileSheet — the tablet rail's profile card. Opens from the header's
// person-circle-outline button, sits beside the collapse chevron. Read-only
// identity (avatar, name, role, active store) plus the same logout the footer
// row already exposes — no account/store management lives here.
import React from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive, sheetBox } from "../responsive";

export default function UserProfileSheet({ visible, onClose, userName, roleLabel, storeName, onLogout }: {
  visible: boolean;
  onClose: () => void;
  userName: string;
  roleLabel: string;
  storeName: string;
  onLogout: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  // First name only — a full name runs too wide in the card's title line.
  const firstName = userName.trim().split(/\s+/)[0] || userName;

  const detail = (label: string, value: string, icon: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}>
      <View style={{ width: 24, alignItems: "center" }}>
        <Ionicons name={icon as any} size={17} color="#8e8e93" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 10, color: "#6e6e73", letterSpacing: 0.4 }}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "700", color: "#fff", marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
          <View style={{ ...sheetBox(isTablet, width, 420), width: "100%", backgroundColor: "#1C1C1E", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 0.5, borderColor: "#2b2b2b", padding: 16, paddingBottom: 24 + insets.bottom }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person-circle-outline" size={34} color="#8e8e93" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontWeight: "800", fontSize: 17, color: "#fff", letterSpacing: -0.3 }}>{firstName}</Text>
                <Text numberOfLines={1} style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{roleLabel}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fèmen" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={16} color="#fff" />
              </Pressable>
            </View>

            <View style={{ marginTop: 14, backgroundColor: "#2b2b2b", borderRadius: 12, paddingHorizontal: 12, borderWidth: 0.5, borderColor: "#3a3a3c" }}>
              {detail("Ròl", roleLabel, "shield-outline")}
              <View style={{ height: 1, backgroundColor: "#3a3a3c" }} />
              {detail("Magazen", storeName, "storefront-outline")}
            </View>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, backgroundColor: "transparent", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#3a3a3c" }}>
                <Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>Kite</Text>
              </Pressable>
              <Pressable
                onPress={() => { onClose(); onLogout(); }}
                style={{ flex: 1, paddingVertical: 14, backgroundColor: "rgba(255,69,58,0.14)", borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "#FF453A" }}
                accessibilityRole="button"
                accessibilityLabel="Dekonekte"
              >
                <Text style={{ fontWeight: "800", color: "#FF453A", fontSize: 14 }}>Dekonekte</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
