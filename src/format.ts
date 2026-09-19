import { Platform, type TextStyle } from "react-native";

/**
 * French/Haitian number style: narrow no-break space thousands,
 * comma decimals — "1 234 567" instead of "1,234,567".
 * Implemented manually (no Intl dependency) so output is identical
 * on Hermes (iOS/Android), including Expo Go.
 */
const GROUP_SEP = " ";
const DECIMAL_SEP = ",";

export function fmt(n: number | string | null | undefined, decimals = 0): string {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  const fixed = safe.toFixed(Math.max(0, decimals));
  const neg = fixed.startsWith("-");
  const unsigned = neg ? fixed.slice(1) : fixed;
  const [intPart, decPart] = unsigned.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);
  const head = neg ? `-${grouped}` : grouped;
  if (decimals > 0) return `${head}${DECIMAL_SEP}${(decPart ?? "").padEnd(decimals, "0")}`;
  return head;
}

/** Whole-number HTG amount: "12 500 HTG". */
export function fmtHTG(n: number | string | null | undefined, decimals = 0): string {
  return `${fmt(n, decimals)} HTG`;
}

/**
 * Monospace stack for price columns so digits/decimals line up.
 * Spread onto price <Text> styles together with textAlign: "right".
 */
export const monoStyle: TextStyle = {
  fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  fontVariant: ["tabular-nums"],
};
