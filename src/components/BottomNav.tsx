import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, Easing, useWindowDimensions } from "react-native";
import { ht } from "../i18n";
import { palette, radius, shadow } from "../theme";

export type Tab = "home" | "stock" | "pos" | "credits" | "customers";

const tabs: { id: Tab; label: string }[] = [
  { id: "home", label: ht.home },
  { id: "stock", label: ht.stock },
  { id: "pos", label: ht.sale },
  { id: "credits", label: ht.credit },
  { id: "customers", label: "Kliyan" },
];

function NavIcon({ kind, active, isCenter }: { kind: Tab; active: boolean; isCenter?: boolean }) {
  // Luxury: inactive muted, active white on charcoal
  const color = isCenter ? "#fff" : active ? palette.ink : palette.muted2;
  const stroke = 1.6;
  switch (kind) {
    case "home":
      return (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ position: "absolute", top: 2, width: 12, height: 7, borderLeftWidth: stroke, borderRightWidth: stroke, borderTopWidth: stroke, borderColor: color, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
          <View style={{ width: 12, height: 8, borderWidth: stroke, borderColor: color, borderRadius: 2, marginTop: 5, backgroundColor: isCenter ? "white" : "transparent" }} />
          <View style={{ position: "absolute", bottom: 3, width: 4, height: 3, borderWidth: 1, borderColor: color, borderRadius: 1, backgroundColor: color, opacity: isCenter ? 1 : 0 }} />
        </View>
      );
    case "stock":
      return (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 12, height: 4, borderWidth: stroke, borderColor: color, borderRadius: 2, backgroundColor: isCenter ? color : "transparent", opacity: isCenter ? 0.15 : 1 }} />
          <View style={{ width: 14, height: 7, borderWidth: stroke, borderColor: color, borderRadius: 2, marginTop: -1, backgroundColor: isCenter ? "white" : "transparent" }} />
          <View style={{ width: 10, height: 2, backgroundColor: color, borderRadius: 1, marginTop: 1, opacity: 0.6 }} />
        </View>
      );
    case "pos":
      return (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 14, height: 9, borderWidth: stroke, borderColor: color, borderRadius: 3, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 1.5, paddingBottom: 1, paddingTop: 2 }}>
            <View style={{ width: 2, height: 5, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: 2, height: 7, backgroundColor: color, borderRadius: 1 }} />
            <View style={{ width: 2, height: 4, backgroundColor: color, borderRadius: 1 }} />
          </View>
          <View style={{ flexDirection: "row", gap: 3, marginTop: 1.5 }}>
            <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
            <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
          </View>
        </View>
      );
    case "credits":
      return (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 14, height: 9, borderWidth: stroke, borderColor: color, borderRadius: 3, padding: 2, gap: 1, backgroundColor: isCenter ? "white" : "transparent" }}>
            <View style={{ height: 2, backgroundColor: color, borderRadius: 1, width: "100%", opacity: 0.9 }} />
            <View style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
              <View style={{ width: 6, height: 4, borderRadius: 1, backgroundColor: color, opacity: 0.15, borderWidth: 0.8, borderColor: color }} />
              <View style={{ flex: 1, height: 1, backgroundColor: color, borderRadius: 1, opacity: 0.3, alignSelf: "center" }} />
            </View>
          </View>
        </View>
      );
    case "customers":
      return (
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ flexDirection: "row", gap: 1, alignItems: "flex-end" }}>
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, borderWidth: stroke, borderColor: color }} />
              <View style={{ width: 7, height: 4, borderWidth: stroke, borderColor: color, borderRadius: 2, marginTop: 1 }} />
            </View>
            <View style={{ alignItems: "center", marginBottom: 1 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.6, borderColor: color, backgroundColor: isCenter ? color : "transparent" }} />
              <View style={{ width: 8, height: 5, borderWidth: 1.6, borderColor: color, borderRadius: 3, marginTop: 1, backgroundColor: isCenter ? "white" : "transparent" }} />
            </View>
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, borderWidth: stroke, borderColor: color }} />
              <View style={{ width: 7, height: 4, borderWidth: stroke, borderColor: color, borderRadius: 2, marginTop: 1 }} />
            </View>
          </View>
        </View>
      );
    default:
      return <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: stroke, borderColor: color }} />;
  }
}

export function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;
  const scaleRefs = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(tabs.map(t => [t.id, new Animated.Value(1)])) as any
  ).current;

  const handlePress = (id: Tab) => {
    const v = scaleRefs[id];
    Animated.sequence([
      Animated.timing(v, { toValue: 0.92, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(v, { toValue: 1, tension: 320, friction: 14, useNativeDriver: true }),
    ]).start();
    onChange(id);
  };

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8, backgroundColor: palette.bg, alignItems: "center" }}>
      {/* Pill — luxury white, hairline, elevated */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: palette.surface,
          borderRadius: 26,
          paddingVertical: 8,
          paddingHorizontal: 6,
          borderWidth: 0.5,
          borderColor: palette.hairline,
          ...shadow.card,
          alignItems: "center",
          justifyContent: "space-between",
          overflow: "visible",
          width: "100%",
          maxWidth: isTablet ? 560 : undefined,
        }}
      >
        {/* Notch background — matches canvas */}
        {active && (
          <>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -10,
                left: `${tabs.findIndex(x => x.id === active) * 20 + 10}%` as any,
                marginLeft: -44,
                width: 88,
                height: 28,
                backgroundColor: palette.bg,
                borderBottomLeftRadius: 22,
                borderBottomRightRadius: 22,
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -8,
                left: `${tabs.findIndex(x => x.id === active) * 20 + 10}%` as any,
                marginLeft: -40,
                width: 80,
                height: 20,
                backgroundColor: palette.surface,
                borderRadius: 20,
                shadowColor: "#000",
                shadowOpacity: 0.03,
                shadowRadius: 8,
              }}
            />
          </>
        )}

        {tabs.map(t => {
          const isActive = active === t.id;
          if (isActive) {
            return (
              <Pressable key={t.id} onPress={() => handlePress(t.id)} style={{ flex: 1, alignItems: "center", justifyContent: "center", marginTop: -22, zIndex: 2 }}>
                <Animated.View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: palette.ink2, // charcoal luxury — not blue
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 3,
                    borderColor: palette.surface,
                    ...shadow.elevated,
                    transform: [{ scale: scaleRefs[t.id] }],
                  }}
                >
                  {/* subtle gold ring for elevated luxe */}
                  <View style={{ position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: 28, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.18)" }} pointerEvents="none" />
                  <NavIcon kind={t.id} active={true} isCenter />
                </Animated.View>
                <Text style={{ fontFamily: "Quicksand_700Bold", fontSize: 10, fontWeight: "700", color: palette.ink, marginTop: 6, letterSpacing: 0.2 }}>{t.label}</Text>
                <View style={{ position: "absolute", bottom: -2, width: 4, height: 4, borderRadius: 2, backgroundColor: palette.ink2 }} />
              </Pressable>
            );
          }
          return (
            <Pressable
              key={t.id}
              onPress={() => handlePress(t.id)}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 6,
                borderRadius: 16,
                gap: 3,
              }}
            >
              <Animated.View style={{ transform: [{ scale: scaleRefs[t.id] }] }}>
                <NavIcon kind={t.id} active={isActive} />
              </Animated.View>
              <Text style={{ fontFamily: "Quicksand_600SemiBold", fontSize: 10, fontWeight: isActive ? "600" : "500", color: isActive ? palette.ink : palette.muted2, letterSpacing: 0.1 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
