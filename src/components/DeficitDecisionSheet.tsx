// DeficitDecisionSheet (028) — the explicit end-of-report choice when cash is
// short. "Pran sou salè" appends a PERMANENT salary deficit row tied to the
// report (deducted at period close); "Neglijab" registers nothing.
// Dismissing without choosing registers nothing either — the decision can
// still be made from the confirmation side later.
import React from "react";
import { View, Text, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fmtG } from "../format";

export function DeficitDecisionSheet({ visible, amount, employeeName, subtitle, canTakeFromSalary, saving, onTakeFromSalary, onNegligible, onClose }: {
  visible: boolean;
  amount: number;
  employeeName?: string;
  subtitle?: string;
  /** Active employees only — an inactive target can never take a deficit. */
  canTakeFromSalary: boolean;
  saving?: boolean;
  onTakeFromSalary: () => void;
  onNegligible: () => void;
  onClose?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 24 + insets.bottom }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <Ionicons name="alert-circle" size={22} color="#FF453A" />
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff" }}>Defisi kach</Text>
          </View>
          <Text style={{ fontSize: 30, fontWeight: "800", color: "#fff", marginTop: 8 }}>{fmtG(Math.round(amount))}</Text>
          {(employeeName || subtitle) ? (
            <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>
              {employeeName ?? ""}{employeeName && subtitle ? " · " : ""}{subtitle ?? ""}
            </Text>
          ) : null}
          <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 10 }}>
            Kisa pou w fè ak defisi sa a? Chwa a pèmanan epi li parèt nan istwa salè a.
          </Text>

          <Pressable
            onPress={onTakeFromSalary}
            disabled={!canTakeFromSalary || !!saving}
            style={{ marginTop: 16, paddingVertical: 16, borderRadius: 14, backgroundColor: canTakeFromSalary ? "#FF453A" : "#2b2b2b", alignItems: "center" }}
          >
            <Text style={{ fontWeight: "800", fontSize: 15, color: canTakeFromSalary ? "#fff" : "#6e6e73" }}>Pran sou salè</Text>
          </Pressable>
          <Pressable
            onPress={onNegligible}
            disabled={!!saving}
            style={{ marginTop: 8, paddingVertical: 16, borderRadius: 14, backgroundColor: "#2b2b2b", alignItems: "center" }}
          >
            <Text style={{ fontWeight: "700", fontSize: 15, color: "#fff" }}>Neglijab — anyen anrejistre</Text>
          </Pressable>
          {!canTakeFromSalary ? (
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 10, textAlign: "center" }}>
              Anplwaye a inaktif — defisi a pa ka pran sou salè.
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
