import { Dimensions, Platform, useWindowDimensions } from "react-native";
import { createContext, useContext } from "react";

export const TABLET_MIN = 700;
export const LARGE_TABLET_MIN = 1024;
// Rotation-independent device classification: the SHORT screen side decides,
// so a phone held landscape never masquerades as a tablet and a tablet held
// landscape never falls back to the phone layout.
const TABLET_SHORT_SIDE = 600;

/** Device-level tablet class (iPad / >=600pt short side). Stable across rotation. */
export const IS_TABLET_DEVICE: boolean =
  Platform.OS === "ios"
    ? !!Platform.isPad
    : Math.min(Dimensions.get("screen").width, Dimensions.get("screen").height) >= TABLET_SHORT_SIDE;

/** Collapsed menu width — the icon-rail footprint (also the safe default for
 *  screens rendered outside the provider, e.g. login, so their math matches
 *  the pre-menu app). */
export const SIDEBAR_RAIL = 88;
/** Expanded menu width — the full MoreScreen list (sections + labels). */
export const MENU_W_EXPANDED = 264;

// Current sidebar width — App provides it so every useResponsive() consumer
// follows the menu's collapse toggle in the same render pass (React context
// flows through native Modals, same as SafeAreaProvider — see App.tsx).
const SidebarWidth = createContext(SIDEBAR_RAIL);
export const SidebarWidthProvider = SidebarWidth.Provider;

export function useResponsive() {
  const { width: windowWidth, height } = useWindowDimensions();
  const sidebarW = useContext(SidebarWidth);
  // Device class — drives chrome (sidebar vs bottom nav) and pane layouts.
  const isTablet = IS_TABLET_DEVICE;
  // Content width — on tablets the menu sidebar claims its current width
  // (collapsed or expanded) of the window; panes, grids and centered boxes
  // all size against what remains.
  const width = isTablet ? Math.max(320, windowWidth - sidebarW) : windowWidth;
  // Width is a separate axis — drives density (columns, paddings) so a
  // tablet in a narrow split-screen window still lays out sensibly.
  const isWide = width >= TABLET_MIN;
  const isLargeTablet = width >= LARGE_TABLET_MIN;
  const isLandscape = windowWidth > height;
  const padH = isWide ? 24 : 16;
  const gutter = isWide ? 20 : 16;
  const contentMax = isWide ? Math.max(560, Math.min(880, width - 64)) : width;
  // Sensible column counts for card grids on wider screens.
  const gridCols = isLargeTablet ? 3 : isWide ? 2 : 1;
  // Right offset for floating buttons — content is full-bleed, so dock at the edge.
  const fabRight = 16;
  return { width, height, isTablet, isWide, isLargeTablet, isLandscape, padH, gutter, contentMax, gridCols, fabRight };
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
