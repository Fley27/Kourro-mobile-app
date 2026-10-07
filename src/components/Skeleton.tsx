// Animated loading skeletons for every DB-backed list. One shared Animated
// value per block drives both effects: an opacity pulse and a shimmer sweep
// built from stepped translucent slices — pure JS, no native gradient module
// (react-native-linear-gradient's BVLinearGradient is absent from Expo Go and
// would crash with "RequireNativeComponent ... not found in the UIManager").
// Skeletons show on FIRST load only — callers keep their existing "Pa gen X"
// empty states for the loaded-but-empty case.
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";

export type SkeletonTone = "dark" | "light";

const TONE = {
  dark: {
    block: "#1C1C1E",
    card: "#141414",
    hair: "#2b2b2b",
    inner: "#17171a",
    peak: 0.16, // white shimmer peak alpha on dark blocks
  },
  light: {
    block: "#E7EAEF",
    card: "#FFFFFF",
    hair: "#E2E8F0",
    inner: "#EEF1F6",
    peak: 0.9, // white shimmer peak alpha on light blocks
  },
} as const;

/** Triangular alpha ramp across N slices — a gradient stand-in in plain Views. */
const SHIMMER_W = 130;
const SLICES = 7;
function shimmerAlphas(peak: number): number[] {
  const mid = (SLICES - 1) / 2;
  return Array.from({ length: SLICES }, (_, i) => Math.max(0, peak * (1 - Math.abs(i - mid) / (mid + 1))));
}

/** One pulsing + shimmering rectangle. Width defaults to stretch (parent-driven). */
export function SkeletonRect(props: {
  w?: number | `${number}%`;
  h: number;
  radius?: number;
  tone?: SkeletonTone;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { w, h, radius = 8, tone = "dark", color, style } = props;
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const opacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.85, 0.5] });
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHIMMER_W - 10, (width || 360) + 10],
  });

  return (
    <Animated.View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={[
        { width: (w ?? "100%") as any, height: h, borderRadius: radius, backgroundColor: color ?? TONE[tone].block, overflow: "hidden" },
        { opacity },
        style,
      ]}
    >
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: SHIMMER_W, flexDirection: "row", transform: [{ translateX }] }}>
        {shimmerAlphas(TONE[tone].peak).map((a, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${a})` }} />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

/** Stack of rects with a gap — the generic list-column placeholder. */
export function SkeletonStack(props: { count: number; gap?: number; children: React.ReactNode }) {
  const { count, gap = 12, children } = props;
  return (
    <View style={{ gap }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>{children}</View>
      ))}
    </View>
  );
}

/** Three group cards — the POS picker's first-load placeholder. */
export function SkeletonGroupStack(props: { gap?: number }) {
  return (
    <View style={{ gap: props.gap ?? 8 }}>
      <SkeletonGroupCard />
      <SkeletonGroupCard />
      <SkeletonGroupCard />
    </View>
  );
}

// ── POS picker group card (mirrors VariantGroupCard geometry) ─────────────
export function SkeletonGroupCard(props: { tone?: SkeletonTone }) {
  const tone = props.tone ?? "dark";
  const t = TONE[tone];
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 18, borderWidth: 1, borderColor: t.hair, overflow: "hidden" }}>
      {/* Header — monogram tile + title/subtitle + right chips */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 12 }}>
        <SkeletonRect w={40} h={40} radius={12} color={t.inner} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <SkeletonRect w="72%" h={14} radius={7} color={t.inner} />
          <SkeletonRect w="44%" h={8} radius={4} color={t.inner} />
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <SkeletonRect w={54} h={16} radius={9} color={t.inner} />
            <SkeletonRect w={46} h={16} radius={9} color={t.inner} />
          </View>
          <SkeletonRect w={78} h={8} radius={4} color={t.inner} />
        </View>
      </View>
      {/* Gold rule */}
      <View style={{ height: 1, backgroundColor: tone === "dark" ? "#1f1f1f" : t.hair }} />
      {/* Variant stations */}
      <View style={{ paddingTop: 6, paddingBottom: 6 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11, paddingRight: 10, paddingLeft: 36, marginLeft: 6, marginRight: 6, marginBottom: 2, borderRadius: 12 }}>
            <SkeletonRect w={46} h={38} radius={10} color={t.inner} />
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <SkeletonRect w={`${55 + i * 8}%`} h={13} radius={6} color={t.inner} />
              <SkeletonRect w="34%" h={8} radius={4} color={t.inner} />
            </View>
            <View style={{ alignItems: "flex-end", gap: 5 }}>
              <SkeletonRect w={58} h={13} radius={6} color={t.inner} />
              <SkeletonRect w={72} h={14} radius={9} color={t.inner} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Orders card (mirrors OrderCard geometry) ──────────────────────────────
export function SkeletonOrderCard(props: { tone?: SkeletonTone }) {
  const tone = props.tone ?? "dark";
  const t = TONE[tone];
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 16, borderWidth: 1, borderColor: t.hair, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <SkeletonRect w={42} h={42} radius={13} color={t.inner} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <SkeletonRect w="52%" h={14} radius={7} color={t.inner} />
          <SkeletonRect w="36%" h={9} radius={4} color={t.inner} />
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <SkeletonRect w={64} h={13} radius={6} color={t.inner} />
          <SkeletonRect w={54} h={16} radius={9} color={t.inner} />
        </View>
      </View>
    </View>
  );
}

// ── Avatar list row (Customers / Suppliers phone + tablet master list) ────
export function SkeletonListRow(props: { tone?: SkeletonTone; padH?: number; divider?: boolean }) {
  const tone = props.tone ?? "dark";
  const t = TONE[tone];
  const padH = props.padH ?? 16;
  return (
    <View style={{ backgroundColor: tone === "dark" ? "#000" : "transparent" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingVertical: 14 }}>
        <SkeletonRect w={52} h={52} radius={12} color={t.inner} />
        <View style={{ flex: 1, marginLeft: 12, gap: 7 }}>
          <SkeletonRect w="58%" h={15} radius={7} color={t.inner} />
          <SkeletonRect w="40%" h={12} radius={6} color={t.inner} />
        </View>
        <SkeletonRect w={18} h={18} radius={9} color={t.inner} />
      </View>
      {props.divider !== false && <View style={{ height: 1, backgroundColor: tone === "dark" ? "#262626" : t.hair, marginLeft: padH + 64 }} />}
    </View>
  );
}

// ── Bordered icon card (Pickups + Transactions rows) ──────────────────────
export function SkeletonCardRow(props: { tone?: SkeletonTone }) {
  const tone = props.tone ?? "dark";
  const t = TONE[tone];
  return (
    <View style={{ borderWidth: 1, borderColor: t.hair, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: tone === "dark" ? "transparent" : t.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <SkeletonRect w={44} h={44} radius={12} color={t.inner} />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <SkeletonRect w="48%" h={15} radius={7} color={t.inner} />
          <SkeletonRect w="66%" h={12} radius={6} color={t.inner} />
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <SkeletonRect w={56} h={15} radius={7} color={t.inner} />
          <SkeletonRect w={30} h={10} radius={5} color={t.inner} />
        </View>
        <SkeletonRect w={18} h={18} radius={6} color={t.inner} />
      </View>
    </View>
  );
}

// ── Catalog product card (mirrors ProductCard geometry) ───────────────────
export function SkeletonProductCard(props: { tone?: SkeletonTone }) {
  const tone = props.tone ?? "dark";
  const t = TONE[tone];
  return (
    <View style={{ backgroundColor: tone === "dark" ? "#232327" : t.card, borderWidth: 1, borderColor: t.hair, borderRadius: 20, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <SkeletonRect w={52} h={52} radius={14} color={t.inner} />
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SkeletonRect w="58%" h={15} radius={7} color={t.inner} />
            <SkeletonRect w={64} h={18} radius={9} color={t.inner} />
          </View>
          <SkeletonRect w="46%" h={11} radius={5} color={t.inner} />
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <SkeletonRect w={52} h={14} radius={6} color={t.inner} />
          <SkeletonRect w={44} h={11} radius={5} color={t.inner} />
        </View>
      </View>
    </View>
  );
}
