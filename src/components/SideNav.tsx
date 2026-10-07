import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabs, type Tab } from "./BottomNav";
import { tabsUI } from "../tabsUI";
import { ordersUI } from "../ordersUI";
import { SIDEBAR_RAIL } from "../responsive";

// Left sidebar rail — the tablet's navigation chrome. Same tab set, labels and
// dark language as BottomNav (phones keep the bottom bar); the two floating
// FABs fold into this rail as badges: red count on Vant (open suspended sales,
// tap opens the tabs sheet) and gold count on Kòmand (not-yet-paid orders).
const RAIL = SIDEBAR_RAIL;
const INACTIVE = "#8E8E93";
const ACTIVE_BG = "rgba(255,255,255,0.10)";
const DOT = "#4B9BFF";

export function SideNav({
  active,
  onChange,
  visibleTabs,
  onPosOpen,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  visibleTabs?: Tab[];
  onPosOpen?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [suspended, setSuspended] = useState(0);
  const [unpaid, setUnpaid] = useState(0);
  useEffect(() => tabsUI.subscribeCount(setSuspended), []);
  useEffect(() => ordersUI.subscribeCount(setUnpaid), []);

  const shown = visibleTabs ? tabs.filter(t => visibleTabs.includes(t.id)) : tabs;

  const press = (id: Tab) => {
    // Vant badge/label: with open suspended sales, jump to POS and raise the
    // tabs sheet (App's onTabFABOpen does both); otherwise plain navigation.
    if (id === "pos" && suspended > 0 && onPosOpen) {
      onPosOpen();
      return;
    }
    onChange(id);
  };

  return (
    <View
      style={{
        width: RAIL,
        paddingTop: insets.top + 14,
        paddingBottom: insets.bottom + 14,
        backgroundColor: "#0B0B0D",
        borderRightWidth: 0.5,
        borderRightColor: "#262626",
        alignItems: "center",
        gap: 4,
      }}
    >
      {shown.map(t => {
        const isActive = t.id === active;
        const badge = t.id === "pos" ? suspended : t.id === "orders" ? unpaid : 0;
        return (
          <Pressable
            key={t.id}
            onPress={() => press(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={{
              width: RAIL - 14,
              borderRadius: 16,
              paddingVertical: 11,
              alignItems: "center",
              backgroundColor: isActive ? ACTIVE_BG : "transparent",
            }}
          >
            <View>
              <Ionicons name={t.icon} size={23} color={isActive ? "#FFFFFF" : INACTIVE} />
              {badge > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -10,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    backgroundColor: t.id === "pos" ? "#CE1126" : "#F0B429",
                    borderWidth: 2,
                    borderColor: "#0B0B0D",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: "900",
                      color: t.id === "pos" ? "#fff" : "#1a1200",
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 10,
                marginTop: 4,
                letterSpacing: 0.1,
                color: isActive ? "#FFFFFF" : INACTIVE,
                fontFamily: isActive ? "Inter_700Bold" : "Inter_500Medium",
              }}
            >
              {t.label}
            </Text>
            {/* Blue dot under the active label — reserved space avoids jump */}
            <View style={{ height: 6, marginTop: 2, alignItems: "center" }}>
              {isActive && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: DOT }} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
