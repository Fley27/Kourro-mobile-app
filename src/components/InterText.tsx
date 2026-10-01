// InterText — Text that always renders in the app's Inter family.
//
// App.tsx sets `Text.defaultProps.style = [{ fontFamily: "Inter_500Medium" }]`,
// but React only fills a default prop when the prop is UNDEFINED: any Text
// with its own `style` silently loses the family and falls back to the
// platform font (SF Pro / Roboto). Every styled Text therefore has to carry
// Inter itself. This wrapper derives the family from the style's weight
// (theme.fontForWeight, so 700/800 → Inter_700Bold) and puts the caller's
// style after it — an explicit fontFamily in a style still wins.
import React from "react";
import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from "react-native";
import { fontForWeight } from "../theme";

export function Text({ style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) as TextStyle | null | undefined;
  const family = flat?.fontFamily ?? fontForWeight(flat?.fontWeight ?? 500);
  return <RNText {...rest} style={[{ fontFamily: family }, style]} />;
}

export default Text;
