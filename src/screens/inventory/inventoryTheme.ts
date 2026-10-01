// Dark tokens for the Inventory batch wizard. Same palette the delivery list
// already uses — kept here so the wizard and the list can't drift apart.
import { catalogDark } from "../CatalogShared";
import { NAV_MENU_TEXT_SCALE, palette } from "../../theme";

export const inv = {
  ...catalogDark,
  green: "#4cae7f",
  greenBg: "rgba(76,174,127,0.12)",
  greenBd: "rgba(76,174,127,0.35)",
  red: "#e06c5b",
  redBg: "rgba(224,108,91,0.12)",
  redBd: "rgba(224,108,91,0.4)",
  blue: "#4B9BFF",
  amber: "#e0a83c",
  amberBg: "rgba(224,168,60,0.14)",
  amberBd: "rgba(224,168,60,0.4)",
} as const;

export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The app's paper-on-dark pill: the same fill the active catalog category chip
 * uses (CategoryStrip → "#F4F1EA" + radius.pill), exposed so every white-ish
 * button in Inventory is literally the same surface.
 */
export const paperPill = {
  bg: "#F4F1EA",
  ink: "#16130c",
  sub: "rgba(22,19,12,0.62)",
  chip: "rgba(0,0,0,0.08)",
  green: palette.success, // jewel-tone green that stays readable on paper
} as const;

/**
 * Font-size helper: every fontSize in the Inventory screen goes through here
 * so one constant tunes readability for the whole screen (+15%, same bump the
 * nav menu uses).
 */
export const fs = (n: number): number =>
  Math.round(n * NAV_MENU_TEXT_SCALE * 10) / 10;
