import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Universal safe-area primitives.
 *
 * The app must never draw content under the iOS notch / Dynamic Island, the
 * Android status bar, or the bottom gesture / home-indicator zones — on any
 * screen, phone or tablet, including inside native Modals.
 *
 * Use this (not react-native-safe-area-context's SafeAreaView) as a Modal
 * root: that component looks for an RNCSafeAreaProvider up its *native*
 * superview chain, a Modal's children live in the modal's own view controller
 * where there is none, so it finds none and pads zero — header under the
 * notch, close button under the status bar. useSafeAreaInsets() reads React
 * context instead, which does flow through a Modal's children.
 *
 * - SafeScreen: full-screen frame that pads children out of all four insets.
 *   The View keeps its backgroundColor full-bleed (padding only insets the
 *   children), so screens stay edge-to-edge dark behind the status bar.
 * - useTopInset / useBottomInset: scalars for the hard-coded
 *   `paddingTop: 60`-style modal paddings this app used to carry.
 */

export function SafeScreen({
  children,
  style,
  backgroundColor = "transparent",
  /** Bottom chrome (bottom nav / sheet footer) applies its own inset. */
  flushBottom = false,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  flushBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor },
        style,
        {
          paddingTop: insets.top,
          paddingBottom: flushBottom ? 0 : insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

/** Top padding that clears the status bar / notch / Dynamic Island (+ extra). */
export function useTopInset(extra = 12): number {
  const insets = useSafeAreaInsets();
  return insets.top + extra;
}

/** Bottom padding that clears the gesture / home-indicator zone (+ extra). */
export function useBottomInset(extra = 0): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + extra;
}

export { useSafeAreaInsets };
