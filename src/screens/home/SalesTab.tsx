import React from "react";
import { useResponsive } from "../../responsive";
import SalesPhone from "./SalesPhone";
import SalesTablet from "./SalesTablet";
import type { SalesTabProps } from "./SalesShared";

export type { SalesTabProps };
export type Props = SalesTabProps;

export default function SalesTab(props: SalesTabProps) {
  const { isTablet, isLandscape } = useResponsive();
  // Tablet 2x2 grid shows in portrait; landscape tablets use phone stack.
  if (isTablet && !isLandscape) {
    return <SalesTablet {...props} />;
  }
  return <SalesPhone {...props} />;
}
