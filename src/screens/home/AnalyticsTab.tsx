import React from "react";
import { useResponsive } from "../../responsive";
import AnalyticsPhone from "./AnalyticsPhone";
import AnalyticsTablet from "./AnalyticsTablet";
import type { AnalyticsTabProps } from "./AnalyticsShared";

export type { AnalyticsTabProps };
export type Props = AnalyticsTabProps;

export default function AnalyticsTab(props: AnalyticsTabProps) {
  const { isTablet, isLandscape } = useResponsive();
  // Tablet dashboard shows in portrait; landscape tablets use phone stack.
  if (isTablet && !isLandscape) {
    return <AnalyticsTablet {...props} />;
  }
  return <AnalyticsPhone {...props} />;
}
