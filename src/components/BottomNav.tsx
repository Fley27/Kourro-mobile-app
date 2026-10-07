import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ht } from "../i18n";
import { shadow, motion } from "../theme";

export type Tab = "home" | "pos" | "customers" | "orders" | "transactions" | "more";

// Role → the tab set the nav chrome shows (bottom bar on phones; sidebar
// gating on tablets). Extracted from App so both navs can't drift.
//  • associate: floor work only — Kliyan + Kòmand + Plis, no checkout.
//  • owner/admin/manager/cashier: Kay, Vant, Tranzaksyon, Plis.
//  • cook: also sees Kliyan (kitchen display).
export function visibleTabsFor(role: string): Tab[] {
  return role === "associate"
    ? ["customers", "orders", "more"]
    : (["owner", "admin", "manager", "cashier"] as string[]).includes(role)
      ? ["home", "pos", "transactions", "more"]
      : ["home", "pos", "customers", "transactions", "more"];
}

export const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "home", label: ht.home, icon: "bookmark-outline" },
  { id: "pos", label: ht.sale, icon: "cart-outline" },
  { id: "customers", label: "Kliyan", icon: "people-outline" },
  { id: "orders", label: "Kòmand", icon: "reader-outline" },
  { id: "transactions", label: ht.transactions, icon: "card-outline" },
  { id: "more", label: "Plis", icon: "ellipsis-horizontal" },
];

// Target look: black bar, inactive = system gray, active = white circle
// with a thin outer ring, overhanging the bar's top edge + white bold
// label + blue dot.
const CIRCLE = 64;
const RING = CIRCLE + 14;
const OVERHANG = 24; // room above the bar so the full bubble stays visible
const BOTTOM_PAD = 0; // flush to screen edge — no space under the bar
const INACTIVE = "#8E8E93";
const BUBBLE_ICON = "#111114";
const DOT = "#4B9BFF";

const LABEL_SIZE = 13;
const ACTIVE_LABEL_SIZE = 15;

// `visibleTabs` gates the bar by role — the Orders tab, for instance, never
// shows up on a kitchen device. Anything omitted falls back to all tabs.
export function BottomNav({ active, onChange, visibleTabs }: { active: Tab; onChange: (t: Tab) => void; visibleTabs?: Tab[] }) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  // Bar background stays flush to the screen edge, but the icons/labels lift
  // out of the iOS home-indicator / Android gesture zone via the bottom inset.
  const insets = useSafeAreaInsets();
  // Near-black bar in both schemes (inherently dark-mode ready).
  const BAR_BG = isDark ? "#191920" : "#0B0B0D";

  const shown = visibleTabs ? tabs.filter(t => visibleTabs.includes(t.id)) : tabs;
  const index = Math.max(0, shown.findIndex(t => t.id === active));
  const activeTab = shown[index];

  // Sliding selector: one Animated value driven by selected index with an
  // iOS-style spring — the white circle glides between items.
  const progress = useRef(new Animated.Value(index)).current;
  // Punch: bubble pops (0.82 → 1) on every selection for the Apple feel.
  const punch = useRef(new Animated.Value(1)).current;
  // Press feedback per item.
  const pressRefs = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(shown.map(t => [t.id, new Animated.Value(1)])) as Record<string, Animated.Value>,
  ).current;

  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    Animated.spring(progress, { toValue: index, ...motion.spring, useNativeDriver: true }).start();
    punch.setValue(0.82);
    Animated.spring(punch, { toValue: 1, tension: 380, friction: 12, useNativeDriver: true }).start();
  }, [index, progress, punch]);

  const tabWidth = barWidth > 0 ? barWidth / shown.length : 0;
  const leftFirst = tabWidth ? (tabWidth - CIRCLE) / 2 : 0;
  const leftLast = tabWidth ? barWidth - (tabWidth + CIRCLE) / 2 : 0;
  const translateX = progress.interpolate({ inputRange: [0, Math.max(1, shown.length - 1)], outputRange: [leftFirst, leftLast] });

  const handlePress = (id: Tab) => {
    const v = pressRefs[id];
    Animated.sequence([
      Animated.timing(v, { toValue: 0.9, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(v, { toValue: 1, tension: 380, friction: 14, useNativeDriver: true }),
    ]).start();
    // Always fire — App handles re-press (Plis re-press bumps moreKey back to the hub).
    onChange(id);
  };

  // No cropping: the full bubble stays visible, and the whole menu block
  // sits ~10% lower via the top margin.
  return (
    <View style={{ backgroundColor: BAR_BG, marginTop: 8, paddingTop: OVERHANG, overflow: "visible" }}>
      <View
        onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
        style={{
          backgroundColor: BAR_BG,
          flexDirection: "row",
          overflow: "visible",
          paddingBottom: BOTTOM_PAD + insets.bottom,
        }}
      >
        {/* Sliding white selector — carries the active icon with it */}
        {tabWidth > 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -CIRCLE / 2 + 8 - (RING - CIRCLE) / 2,
                left: -(RING - CIRCLE) / 2,
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                borderWidth: 1.5,
                borderColor: "#3a3a3c",
                transform: [{ translateX }],
                zIndex: 1,
              }}
            />
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -CIRCLE / 2 + 8,
                left: 0,
                width: CIRCLE,
                height: CIRCLE,
                borderRadius: CIRCLE / 2,
                backgroundColor: "#FFFFFF",
                alignItems: "center",
                justifyContent: "center",
                ...shadow.elevated,
                transform: [{ translateX }, { scale: punch }],
                zIndex: 2,
              }}
            >
              <Ionicons name={activeTab.icon} size={29} color={BUBBLE_ICON} />
            </Animated.View>
          </>
        )}

        {shown.map(t => {
          const isActive = t.id === active;
          return (
            <Pressable
              key={t.id}
              onPress={() => handlePress(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={{ flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 10 }}
            >
              <Animated.View style={{ alignItems: "center", transform: [{ scale: pressRefs[t.id] }] }}>
                {/* Icon slot — empty when active (icon lives in the bubble) */}
                <View style={{ height: 30, alignItems: "center", justifyContent: "center" }}>
                  {!isActive && <Ionicons name={t.icon} size={27} color={INACTIVE} />}
                </View>
                <Text
                  numberOfLines={1}
                  style={
                    isActive
                      ? { fontFamily: "Inter_700Bold", fontSize: ACTIVE_LABEL_SIZE, color: "#FFFFFF", marginTop: 5, letterSpacing: 0.2 }
                      : { fontFamily: "Inter_500Medium", fontSize: LABEL_SIZE, color: INACTIVE, marginTop: 5, letterSpacing: 0.1 }
                  }
                >
                  {t.label}
                </Text>
                {/* Blue dot under the active label — reserved space avoids jump */}
                <View style={{ height: 8, marginTop: 2, alignItems: "center", justifyContent: "flex-start" }}>
                  {isActive && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: DOT }} />}
                </View>
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
