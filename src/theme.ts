// Jesyon Magazen — Sales Site Brand Theme for Mobile
// Warm bone paper + deep ink + ember accent + gold nuance
// Mirrors sales-site/src/site.css and web-app/src/lib/theme.ts
// Usage: import { theme } from "./theme"

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

export const typography = {
  // Inter / Quicksand tight tracking
  heroTitle: { fontFamily: "Quicksand_700Bold", fontSize: 28, fontWeight: "700" as const, letterSpacing: -1.2, lineHeight: 32, color: palette.ink },
  heroTitleItalic: { fontFamily: "Quicksand_300Light", fontStyle: "italic" as const, color: palette.accentGold },
  sectionTitle: { fontFamily: "Quicksand_700Bold", fontSize: 13, fontWeight: "700" as const, letterSpacing: -0.2, color: palette.ink },
  kpiValue: { fontFamily: "Quicksand_700Bold", fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.8, color: palette.ink },
  eyebrow: { fontFamily: "Quicksand_700Bold", fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.1, textTransform: "uppercase" as const, color: palette.muted2 },
  body: { fontFamily: "Roboto_400Regular", fontSize: 13, color: palette.muted, lineHeight: 18 },
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

export const theme = { palette, radius, shadow, typography, motion, cardLuxury, hairline };
export default theme;