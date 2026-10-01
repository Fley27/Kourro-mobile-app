// Shared overlay back button — black pill, white arrow + label.
// Used by every full-screen overlay header so "back" looks the same app-wide.
import React from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function DarkBackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#0B0B0D", borderWidth: 1, borderColor: "#3a3a3c" }}>
      <Ionicons name="chevron-back" size={20} color="#fff" />
    </Pressable>
  );
}
