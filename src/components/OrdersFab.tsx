import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ordersUI } from "../ordersUI";
import { TABLET_MIN } from "../responsive";

const R = 72;
const M = 8;
const GOLD = "#F0B429";
const GOLD_LIGHT = "#FBBF24";
const INK = "#0B0B0F";

/**
 * Premium round draggable orders shortcut. Rendered once at the app root so
 * it floats above every element (sibling of TabsFab, docked lower). Shows a
 * detached gold badge with the not-yet-paid count and is visible only while
 * that count is > 0 — cashiers/manager/admin/owner with an open shift tap it
 * to jump straight to Kòmand. Parks anywhere on drag, same as TabsFab.
 */
export function OrdersFab({ onOpen }: { onOpen?: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [count, setCount] = useState(0);
  const hot = count > 0;
  useEffect(() => ordersUI.subscribeCount(setCount), []);
  useEffect(() => {
    if (!hot) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hot]);

  const xy = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const off = useRef({ x: 0, y: 0 });

  const { width: W, height: H } = useWindowDimensions();
  const isTablet = W >= TABLET_MIN;
  // Same docking column as TabsFab, parked lower so the two never collide.
  const dockRight = isTablet ? Math.max(16, (W - 880) / 2 + 24) : 16;
  const baseLeft = W - dockRight - R;
  const baseTop = Math.round(H * 0.62);

  function clamp(nx: number, ny: number) {
    return {
      x: Math.min(Math.max(nx, M - baseLeft), W - M - baseLeft - R),
      y: Math.min(Math.max(ny, M - baseTop), H - M - baseTop - R),
    };
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
    onPanResponderGrant: () => {
      xy.setOffset({ x: off.current.x, y: off.current.y });
      xy.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_e, g) => {
      const c = clamp(off.current.x + g.dx, off.current.y + g.dy);
      xy.setValue({ x: c.x - off.current.x, y: c.y - off.current.y });
    },
    onPanResponderRelease: (_e, g) => {
      const c = clamp(off.current.x + g.dx, off.current.y + g.dy);
      off.current.x = c.x; off.current.y = c.y;
      xy.flattenOffset();
    },
    onPanResponderTerminate: () => { xy.flattenOffset(); },
  })).current;

  if (!hot) return null;
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });
  return (
    <Animated.View
      style={{ position: "absolute", top: baseTop, right: dockRight, zIndex: 998, elevation: 998, transform: xy.getTranslateTransform() }}
      {...pan.panHandlers}
    >
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, width: R, height: R, borderRadius: R / 2, backgroundColor: GOLD, transform: [{ scale: haloScale }], opacity: haloOpacity }}
      />
      <Pressable
        onPress={() => onOpen?.()}
        accessibilityLabel="Kòmand ki pa peye"
        style={{
          width: R, height: R, borderRadius: R / 2,
          backgroundColor: INK, borderWidth: 1.5, borderColor: "rgba(240,180,41,0.65)",
          alignItems: "center", justifyContent: "center",
          shadowColor: GOLD, shadowOpacity: 0.5, shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 }, elevation: 16,
        }}
      >
        {/* Inner depth ring — the frosted premium edge. */}
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 5, left: 5, right: 5, bottom: 5, borderRadius: R / 2 - 5, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
        />
        <Ionicons name="receipt-outline" size={24} color={GOLD_LIGHT} />
        <Text style={{ color: "rgba(240,180,41,0.85)", fontWeight: "800", fontSize: 7, letterSpacing: 1.8, marginTop: 2 }}>KÒMAND</Text>
        {/* Detached badge — the not-yet-paid count, knockout-ringed. */}
        <View
          style={{
            position: "absolute", top: -4, right: -4,
            minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5,
            backgroundColor: GOLD, borderWidth: 2, borderColor: INK,
            alignItems: "center", justifyContent: "center",
            shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 6,
            shadowOffset: { width: 0, height: 3 }, elevation: 8,
          }}
        >
          <Text style={{ color: "#1a1200", fontWeight: "900", fontSize: count > 99 ? 10 : 12 }}>{count > 99 ? "99+" : count}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
