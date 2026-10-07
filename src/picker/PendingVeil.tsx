import React from "react";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";

// ---- Focus veil shown over the product list while an item is pending in
// the hero ("being added to cart"): everything blurs and dims like a
// WhatsApp long-press, and the plain View on top swallows touches so no
// other article is selectable until the pending line commits or is
// cancelled. The hero card, search and cart pill stay sharp/live. ----
export function PendingVeil() {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, elevation: 40 }}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.55)" }]} />
    </View>
  );
}
