import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native";
import { tabsUI } from "../tabsUI";
import { TABLET_MIN } from "../responsive";

const R = 68;
const M = 8;
const RED_HOT = "#CE1126";
const RED_IDLE = "#7A1F28";
const RED_DEEP = "#8F0B1A";

/**
 * Round draggable "Vant an Atann" FAB. Rendered once at the app root so it
 * floats above every element, including the top menu. Docks mid-right by
 * default (clear of header and cart bar), parks anywhere on drag, tap opens
 * the tabs sheet. Visible whenever there is at least one open suspended sale
 * (count > 0) no matter which tab is on screen; hidden when none.
 */
export function TabsFab({ onOpen }: { onOpen?: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [count, setCount] = useState(0);
  const hot = count > 0;
  useEffect(() => tabsUI.subscribeCount(setCount), []);
  useEffect(() => {
    if (!hot) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hot]);
  const xy = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const off = useRef({ x: 0, y: 0 });

  const { width: W, height: H } = useWindowDimensions();
  const isTablet = W >= TABLET_MIN;
  // Keep the FAB docked near centered tablet content instead of the far edge.
  const dockRight = isTablet ? Math.max(16, (W - 880) / 2 + 24) : 16;
  const baseLeft = W - dockRight - R;
  const baseTop = Math.round(H * 0.36);

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
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  return (
    <Animated.View
      style={{ position: "absolute", top: Math.round(H * 0.36), right: dockRight, zIndex: 999, elevation: 999, transform: xy.getTranslateTransform() }}
      {...pan.panHandlers}
    >
      {hot && (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, width: R, height: R, borderRadius: R / 2, backgroundColor: RED_HOT, transform: [{ scale: haloScale }], opacity: haloOpacity }}
        />
      )}
      <Pressable
        onPress={() => {
          if (onOpen) onOpen();
          else tabsUI.requestOpen(() => {});
        }}
        accessibilityLabel="Vant an atann"
        style={{
          width: R, height: R, borderRadius: R / 2,
          backgroundColor: hot ? RED_HOT : RED_IDLE, borderWidth: 2,
          borderColor: "rgba(255,255,255,0.9)",
          alignItems: "center", justifyContent: "center",
          opacity: hot ? 1 : 0.8,
          shadowColor: RED_DEEP, shadowOpacity: 0.4, shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 }, elevation: 12,
        }}
      >
        <Text style={{ fontWeight: "900", color: "#fff", fontSize: 22, lineHeight: 24 }}>{count}</Text>
        <Text style={{ color: "rgba(255,255,255,0.92)", fontWeight: "800", fontSize: 8, letterSpacing: 1.5, marginTop: 1 }}>ATANN</Text>
        <View style={{ position: "absolute", top: 9, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: hot ? "#fff" : "rgba(255,255,255,0.5)" }} />
      </Pressable>
    </Animated.View>
  );
}
