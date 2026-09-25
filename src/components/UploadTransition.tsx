// UploadTransition — reusable DB-upload monitor. Wraps any async write with an
// Apple-smooth overlay: eased loading (minimum duration so it never flashes),
// then a success/error status held long enough to read. Anytime we upload
// data, run it through here so the user always sees what's happening.
import React, { useEffect, useRef } from "react";
import { View, Text, Modal, Animated, Easing, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type UploadPhase = "loading" | "success" | "error";

export function UploadTransition({ visible, phase, title, detail }: {
  visible: boolean;
  phase: UploadPhase;
  title: string;
  detail?: string;
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [visible, fade]);
  useEffect(() => {
    if (!visible) return;
    if (phase === "loading") {
      pop.setValue(0);
      return;
    }
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 110, useNativeDriver: true }).start();
  }, [visible, phase, pop]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <Animated.View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", opacity: fade }}>
        <View style={{ marginTop: 110, alignItems: "center", paddingHorizontal: 24 }}>
          <Text style={{ fontWeight: "800", fontSize: 24, color: "#fff", textAlign: "center", letterSpacing: -0.3 }} numberOfLines={2}>{title}</Text>
          {!!detail ? <Text style={{ fontSize: 14, color: "#8E8E93", marginTop: 6, textAlign: "center" }}>{detail}</Text> : null}
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {phase === "loading" ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <Animated.View
              style={{
                transform: [{ scale: pop }],
                width: 84, height: 84, borderRadius: 42, borderWidth: 4,
                borderColor: phase === "success" ? "#30D158" : "#FF453A",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name={phase === "success" ? "checkmark" : "close"} size={42} color={phase === "success" ? "#30D158" : "#FF453A"} />
            </Animated.View>
          )}
          <Animated.Text style={{ fontWeight: "800", fontSize: 20, color: "#fff", marginTop: 18, opacity: phase === "loading" ? 1 : pop }}>
            {phase === "loading" ? "Ap voye…" : phase === "success" ? "Siksè" : "Echwe"}
          </Animated.Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

// Guarantees a minimum duration so the transition never flashes by.
export function minDelay<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.all([work, new Promise<void>(r => setTimeout(r, ms))]).then(([out]) => out);
}
