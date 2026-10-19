import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ht } from "../i18n";
import { fonts } from "../theme";

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

export const tabs: {
  id: Tab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "home", label: ht.home, icon: "bookmark-outline", activeIcon: "bookmark" },
  { id: "pos", label: ht.sale, icon: "cart-outline", activeIcon: "cart" },
  { id: "customers", label: "Kliyan", icon: "people-outline", activeIcon: "people" },
  { id: "orders", label: "Kòmand", icon: "reader-outline", activeIcon: "reader" },
  { id: "transactions", label: ht.transactions, icon: "card-outline", activeIcon: "card" },
  { id: "more", label: "Plis", icon: "ellipsis-horizontal", activeIcon: "ellipsis-horizontal" },
];

// Target look (phone): a near-black bar with rounded top corners and a faint
// hairline edge. Inactive tab = gray outline icon + gray semibold label.
// Active tab = white disc (filled black glyph) inside a thin outer ring, bold
// white label, and a small blue dot underneath. All four items share the same
// label baseline; only the active one gets the dot.
const CIRCLE = 46;
const RING = 56;
const CORNER = 24;
const INACTIVE = "#8E8E93";
const BAR_BG = "#0A0A0B";
const HAIRLINE = "rgba(255,255,255,0.10)";
const RING_BORDER = "#2E2E31";
const BUBBLE_ICON = "#0A0A0B";
const DOT = "#3B82F6";

// `visibleTabs` gates the bar by role — the Orders tab, for instance, never
// shows up on a kitchen device. Anything omitted falls back to all tabs.
export function BottomNav({ active, onChange, visibleTabs }: { active: Tab; onChange: (t: Tab) => void; visibleTabs?: Tab[] }) {
  // Bar sits flush on the screen edge; icons/labels lift above the iOS home
  // indicator / Android gesture zone via the bottom inset.
  const insets = useSafeAreaInsets();

  const shown = visibleTabs ? tabs.filter(t => visibleTabs.includes(t.id)) : tabs;
  const index = Math.max(0, shown.findIndex(t => t.id === active));
  const activeTab = shown[index] ?? shown[0];

  // Sliding selector: one Animated value driven by selected index with an
  // iOS-style spring — the white disc glides between items.
  const progress = useRef(new Animated.Value(index)).current;
  // Punch: disc pops (0.84 → 1) on every selection for the Apple feel.
  const punch = useRef(new Animated.Value(1)).current;
  // Press feedback per item.
  const pressRefs = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(shown.map(t => [t.id, new Animated.Value(1)])) as Record<string, Animated.Value>,
  ).current;

  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    Animated.spring(progress, { toValue: index, tension: 300, friction: 26, useNativeDriver: true }).start();
    punch.setValue(0.84);
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

  return (
    <View
      style={{
        backgroundColor: BAR_BG,
        borderTopLeftRadius: CORNER,
        borderTopRightRadius: CORNER,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: 0,
        borderColor: HAIRLINE,
        paddingTop: 8,
        paddingHorizontal: 10,
      }}
    >
      <View
        onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: "row", paddingBottom: insets.bottom + 6 }}
      >
        {/* Sliding disc + ring — carries the active icon as it glides */}
        {tabWidth > 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -(RING - CIRCLE) / 2,
                left: -(RING - CIRCLE) / 2,
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                borderWidth: 1,
                borderColor: RING_BORDER,
                transform: [{ translateX }],
                zIndex: 1,
              }}
            />
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: CIRCLE,
                height: CIRCLE,
                borderRadius: CIRCLE / 2,
                backgroundColor: "#FFFFFF",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.45,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 6,
                transform: [{ translateX }, { scale: punch }],
                zIndex: 2,
              }}
            >
              <Ionicons name={activeTab.activeIcon} size={24} color={BUBBLE_ICON} />
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
              style={{ flex: 1, alignItems: "center" }}
            >
              <Animated.View style={{ alignItems: "center", transform: [{ scale: pressRefs[t.id] }] }}>
                {/* Icon slot — empty when active (glyph lives in the disc) */}
                <View style={{ height: CIRCLE, alignItems: "center", justifyContent: "center" }}>
                  {!isActive && <Ionicons name={t.icon} size={27} color={INACTIVE} />}
                </View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{
                    fontFamily: isActive ? fonts.bold : fonts.semibold,
                    fontSize: 14,
                    lineHeight: 18,
                    letterSpacing: -0.2,
                    color: isActive ? "#FFFFFF" : INACTIVE,
                    marginTop: 2,
                    maxWidth: "100%",
                  }}
                >
                  {t.label}
                </Text>
                {/* Blue dot under the active label — reserved space avoids jump */}
                <View style={{ height: 9, marginTop: 1, alignItems: "center", justifyContent: "flex-start" }}>
                  {isActive && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: DOT }} />}
                </View>
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
