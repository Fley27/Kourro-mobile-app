import { useWindowDimensions } from "react-native";

export const TABLET_MIN = 700;
export const LARGE_TABLET_MIN = 1024;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN;
  const isLargeTablet = width >= LARGE_TABLET_MIN;
  const isLandscape = width > height;
  const padH = isTablet ? 24 : 16;
  const gutter = isTablet ? 20 : 16;
  const contentMax = isTablet ? Math.max(560, Math.min(880, width - 64)) : width;
  // Sensible column counts for card grids on wider screens.
  const gridCols = isLargeTablet ? 3 : isTablet ? 2 : 1;
  // Right offset for floating buttons — content is full-bleed, so dock at the edge.
  const fabRight = 16;
  return { width, height, isTablet, isLargeTablet, isLandscape, padH, gutter, contentMax, gridCols, fabRight };
}

export type Responsive = ReturnType<typeof useResponsive>;

// Constrain a full-width block to a centered max-width column on tablets.
export function centerBox(isTablet: boolean, width: number, maxW = 880) {
  return {
    width: "100%" as const,
    alignSelf: isTablet ? ("center" as const) : ("stretch" as const),
    maxWidth: isTablet ? Math.min(maxW, width - 32) : undefined,
  };
}

// Same idea but for bottom-sheet cards (narrower than page content).
export function sheetBox(isTablet: boolean, width: number, maxW = 640) {
  return centerBox(isTablet, width, maxW);
}

// Centered small dialog (verify codes, confirmations) — narrower than sheets.
export function dialogBox(isTablet: boolean, width: number, maxW = 480) {
  return centerBox(isTablet, width, maxW);
}