// Jesyon Magazen — Sales Site Brand Theme for Mobile
// Warm bone paper + deep ink + ember accent + gold nuance
// Mirrors sales-site/src/site.css and web-app/src/lib/theme.ts
// Usage: import { theme } from "./theme"
import { useColorScheme } from "react-native";

export const palette = {
  // ── Backgrounds (warm paper) ────────────────────────────────────
  bg: "#f6f1e4",
  bgWarm: "#efe7d2",

  // ── Surfaces (pressed paper, elevated) ──────────────────────────
  surface: "#ffffff",
  surface2: "#efe7d2",
  surfaceGrouped: "#e9dfc6",

  // ── Borders ─────────────────────────────────────────────────────
  hairline: "rgba(22,19,12,0.14)",
  hairlineStrong: "rgba(22,19,12,0.3)",
  separator: "#e2d8bd",
  separatorSoft: "#efe7d2",

  // ── Text (warm black on paper) ──────────────────────────────────
  ink: "#16130c",
  ink2: "#16130c", // ink surface — hero / sidebar
  inkSoft: "#4d473a",
  muted: "#837b69",
  muted2: "#6b6454",
  muted3: "#837b69",

  // ── Accent — signature ember ────────────────────────────────────
  accent: "#ff4d00",
  emberInk: "#fff6ee", // text on ember
  accentGold: "#c8a24a",
  accentGoldSoft: "rgba(200,162,74,0.16)",

  // ── Semantic (jewel tones — readable on paper) ──────────────────
  success: "#2f7d5b",
  successBg: "rgba(47,125,91,0.12)",
  successBd: "rgba(47,125,91,0.3)",
  successDot: "#2f7d5b",
  warning: "#a86e10",
  warningBg: "rgba(255,159,10,0.16)",
  warningBd: "rgba(200,162,74,0.4)",
  warningDot: "#c8a24a",
  danger: "#c0392b",
  dangerBg: "rgba(192,57,43,0.12)",
  dangerBd: "rgba(192,57,43,0.3)",
  dangerDot: "#c0392b",

  // Vibrant (for analytics)
  blue: "#0a6bb5",
  blueBg: "rgba(10,107,181,0.12)",
  blueBd: "rgba(10,107,181,0.3)",
  violet: "#7c3aed",
  violetBg: "rgba(124,58,237,0.12)",
  violetBd: "rgba(124,58,237,0.3)",
  emerald: "#2f7d5b",
  emeraldSoft: "rgba(47,125,91,0.12)",
} as const;

export const radius = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const shadow = {
  soft: {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  elevated: {
    shadowColor: "#000",
    shadowOpacity: 0.36,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 9,
  },
} as const;

// ── Typeface: Inter (single typeface for the entire app) ─────────────
// Loaded once in App.tsx via @expo-google-fonts/inter. Android cannot
// combine a custom fontFamily with fontWeight (it breaks rendering), so
// call sites must pick the family-per-weight token below instead of
// setting fontWeight alongside fontFamily.
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export type FontWeightName = "regular" | "medium" | "semibold" | "bold";

/** Map a numeric/text weight intent to its Inter family (no fontWeight). */
export function fontForWeight(weight?: number | string): string {
  const w = typeof weight === "string" ? parseInt(weight, 10) : (weight ?? 400);
  if (Number.isFinite(w)) {
    if (w >= 700) return fonts.bold;
    if (w >= 600) return fonts.semibold;
    if (w >= 500) return fonts.medium;
  }
  return fonts.regular;
}

export const typography = {
  // Inter tight tracking. No fontWeight alongside fontFamily (Android).
  heroTitle: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: -1.2, lineHeight: 32, color: palette.ink },
  heroTitleItalic: { fontFamily: "Inter_300Light", fontStyle: "italic" as const, color: palette.accentGold },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: -0.2, color: palette.ink },
  kpiValue: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.8, color: palette.ink },
  eyebrow: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1, textTransform: "uppercase" as const, color: palette.muted2 },
  body: { fontFamily: fonts.regular, fontSize: 13, color: palette.muted, lineHeight: 18 },
} as const;

// Animation presets — Apple-like
export const motion = {
  spring: { tension: 280, friction: 22 }, // gentle iOS spring
  timingFast: 180,
  timingMedium: 240,
  timingSlow: 360,
} as const;

// Helper: hairline border
export const hairline = { borderWidth: 0.5, borderColor: palette.hairline };

// Shared card style — luxury
export const cardLuxury = {
  backgroundColor: palette.surface,
  borderRadius: radius.xl,
  borderWidth: 0.5,
  borderColor: palette.hairline,
  ...shadow.card,
} as const;

export const theme = { palette, radius, shadow, fonts, typography, motion, cardLuxury, hairline };
export default theme;

// ── Dark mode (warm charcoal — navbar + menu adapt via usePalette) ────
// System-driven: follows Appearance / useColorScheme. Same key shape as
// `palette` so call sites can swap `palette` → `usePalette()` with no
// other changes.
export const darkPalette = {
  // ── Backgrounds (warm black) ────────────────────────────────────
  bg: "#14110b",
  bgWarm: "#1a1610",

  // ── Surfaces (elevated warm charcoal) ───────────────────────────
  surface: "#211d14",
  surface2: "#262117",
  surfaceGrouped: "#2c2719",

  // ── Borders ─────────────────────────────────────────────────────
  hairline: "rgba(246,241,228,0.16)",
  hairlineStrong: "rgba(246,241,228,0.32)",
  separator: "#3a3423",
  separatorSoft: "#262117",

  // ── Text (warm paper on charcoal) ───────────────────────────────
  ink: "#f6f1e4",
  ink2: "#f6f1e4", // active nav pill — paper circle on dark
  inkSoft: "#d9d1ba",
  muted: "#a89f88",
  muted2: "#bdb39a",
  muted3: "#8d8471",

  // ── Accent — signature ember (unchanged) ────────────────────────
  accent: "#ff4d00",
  emberInk: "#fff6ee", // text on ember
  accentGold: "#c8a24a",
  accentGoldSoft: "rgba(200,162,74,0.22)",

  // ── Semantic (lifted opacity so Bg tints read on dark) ──────────
  success: "#4cae7f",
  successBg: "rgba(76,174,127,0.18)",
  successBd: "rgba(76,174,127,0.4)",
  successDot: "#4cae7f",
  warning: "#d99a2b",
  warningBg: "rgba(217,154,43,0.2)",
  warningBd: "rgba(200,162,74,0.5)",
  warningDot: "#d99a2b",
  danger: "#e06c5b",
  dangerBg: "rgba(224,108,91,0.2)",
  dangerBd: "rgba(224,108,91,0.45)",
  dangerDot: "#e06c5b",

  // Vibrant (for analytics)
  blue: "#4da3e0",
  blueBg: "rgba(77,163,224,0.2)",
  blueBd: "rgba(77,163,224,0.45)",
  violet: "#a78bfa",
  violetBg: "rgba(167,139,250,0.2)",
  violetBd: "rgba(167,139,250,0.45)",
  emerald: "#4cae7f",
  emeraldSoft: "rgba(76,174,127,0.2)",
} as const;

// Text scale applied to navbar + menu labels (+15% readability bump).
export const NAV_MENU_TEXT_SCALE = 1.15;

// Top-screen / modal icon buttons — gray circle + white icon (customer add
// button language). Secondary gray is one step lighter for hierarchy.
// Light variant is for white/bone sheets only.
export const topIconBtn = {
  size: 56,
  radius: 28,
  bg: "#2b2b2b",
  bgSecondary: "#3a3a3c",
  icon: "#fff",
  iconSize: 26,
} as const;

export const topIconBtnLight = {
  size: 56,
  radius: 28,
  bg: "#F2F2F7",
  icon: "#000",
  iconSize: 26,
} as const;

export type Palette = typeof palette;

export function usePalette(): Palette {
  const scheme = useColorScheme();
  return (scheme === "dark" ? (darkPalette as unknown as Palette) : palette);
}

export function isDarkScheme(scheme: string | null | undefined): boolean {
  return scheme === "dark";
}