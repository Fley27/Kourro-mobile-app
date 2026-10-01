import React from "react";
import { View, Text, Pressable, Modal } from "react-native";
import { useResponsive, sheetBox } from "../responsive";
import { ht } from "../i18n";

// ---- Shared scan sheet (identical checkout + Orders picker): a simulated
// camera scan that pends the target product, same copy on both screens.
// Checkout renders it as a native Modal; the Orders picker (inside the board
// window, where a nested Modal can mount under it on iOS) passes overlay and
// gets the same markup as an absolute overlay instead. ----
export function ScanSheet(props: {
  visible: boolean;
  onClose: () => void;
  onSimulate: () => void;
  productLabel: string;
  overlay?: boolean;
}) {
  const { visible, onClose, onSimulate, productLabel, overlay } = props;
  const { width, isTablet } = useResponsive();
  const body = (
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
      <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, minHeight: 320 }}>
        <View style={{ width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
        <Text style={{ fontWeight: "900", fontSize: 18, textAlign: "center" }}>📷 {ht.scan}</Text>
        <View style={{ height: 160, backgroundColor: "#0f172a", borderRadius: 24, marginTop: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#22c55e", borderStyle: "dashed" }}>
          <Text style={{ color: "#22c55e", fontSize: 40 }}>▢</Text>
          <Text style={{ color: "white", marginTop: 8, fontWeight: "700" }}>Kamera ap chèche kòd...</Text>
        </View>
        <Pressable onPress={onSimulate} style={{ marginTop: 16, backgroundColor: "#22c55e", padding: 14, borderRadius: 24, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "800" }}>Simile Eskane • Ajoute "{productLabel}"</Text></Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 10, padding: 12, alignItems: "center" }}><Text style={{ color: "#64748b", fontWeight: "600" }}>Fèmen</Text></Pressable>
      </View>
    </View>
  );
  if (overlay) {
    if (!visible) return null;
    return <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 80, elevation: 80 }}>{body}</View>;
  }
  return <Modal visible={visible} transparent animationType="slide">{body}</Modal>;
}
