import React, { useState } from "react";
import { View, Text, Pressable, Modal, TextInput, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive, sheetBox } from "../responsive";
import { ht } from "../i18n";

// ---- Shared scan sheet (identical checkout + Orders picker): a simulated
// camera scan that pends the target product, same copy on both screens.
// Checkout renders it as a native Modal; the Orders picker (inside the board
// window, where a nested Modal can mount under it on iOS) passes overlay and
// gets the same markup as an absolute overlay instead.
//
// Web/desktop: there is no camera — an external USB/Bluetooth scanner acts
// as a keyboard wedge, so the sheet shows an auto-focused code field instead.
// The scanner "types" the barcode and sends Enter; typed codes work too.
export function ScanSheet(props: {
  visible: boolean;
  onClose: () => void;
  onSimulate: () => void;
  productLabel: string;
  overlay?: boolean;
  /** Web only: receives a scanned/typed code (Enter or the green button). */
  onCode?: (code: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { visible, onClose, onSimulate, productLabel, overlay, onCode } = props;
  const { width, isTablet } = useResponsive();
  const isWeb = Platform.OS === "web";
  const [code, setCode] = useState("");

  function submitCode() {
    const t = code.trim();
    if (!t) {
      // Empty field + green button = the native "Simile Eskane" action.
      onSimulate();
      return;
    }
    onCode?.(t);
    setCode("");
  }

  const body = (
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
      <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 16 + insets.bottom, minHeight: 320 }}>
        <View style={{ width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
        <Text style={{ fontWeight: "900", fontSize: 18, textAlign: "center" }}>{isWeb ? "⌨" : "📷"} {ht.scan}</Text>
        {isWeb ? (
          <>
            <View style={{ height: 120, backgroundColor: "#0f172a", borderRadius: 24, marginTop: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#22c55e", borderStyle: "dashed", paddingHorizontal: 16 }}>
              <Text style={{ color: "#22c55e", fontSize: 32 }}>▮</Text>
              <Text style={{ color: "white", marginTop: 6, fontWeight: "700", textAlign: "center" }}>Scanner ap ekri kòd la la...</Text>
              <Text style={{ color: "#94a3b8", marginTop: 2, fontSize: 11.5, textAlign: "center" }}>USB / Bluetooth — oswa tape kòd la epi peze Antre</Text>
            </View>
            <TextInput
              value={code}
              onChangeText={setCode}
              onSubmitEditing={submitCode}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              blurOnSubmit={false}
              returnKeyType="done"
              placeholder="Eskane oswa tape kòd..."
              placeholderTextColor="#94a3b8"
              style={{ marginTop: 14, borderWidth: 2, borderColor: "#22c55e", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, fontWeight: "700", color: "#0f172a" }}
            />
            <Pressable onPress={submitCode} style={{ marginTop: 12, backgroundColor: "#22c55e", padding: 14, borderRadius: 24, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "800" }}>{code.trim() ? `Ajoute kòd "${code.trim()}"` : `Simile Eskane • Ajoute "${productLabel}"`}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 10, padding: 12, alignItems: "center" }}><Text style={{ color: "#64748b", fontWeight: "600" }}>Fèmen</Text></Pressable>
          </>
        ) : (
          <>
            <View style={{ height: 160, backgroundColor: "#0f172a", borderRadius: 24, marginTop: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#22c55e", borderStyle: "dashed" }}>
              <Text style={{ color: "#22c55e", fontSize: 40 }}>▢</Text>
              <Text style={{ color: "white", marginTop: 8, fontWeight: "700" }}>Kamera ap chèche kòd...</Text>
            </View>
            <Pressable onPress={onSimulate} style={{ marginTop: 16, backgroundColor: "#22c55e", padding: 14, borderRadius: 24, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "800" }}>Simile Eskane • Ajoute "{productLabel}"</Text></Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 10, padding: 12, alignItems: "center" }}><Text style={{ color: "#64748b", fontWeight: "600" }}>Fèmen</Text></Pressable>
          </>
        )}
      </View>
    </View>
  );
  if (overlay) {
    if (!visible) return null;
    return <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 80, elevation: 80 }}>{body}</View>;
  }
  return <Modal visible={visible} transparent animationType="slide">{body}</Modal>;
}
