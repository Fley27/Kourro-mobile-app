import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { TABLET_MIN } from "../responsive";

/**
 * Reusable bottom-sheet wrapper that ensures keyboard never hides inputs/buttons.
 * Use inside a <Modal transparent>.
 *
 * - iOS: behavior="padding" (pushes sheet up)
 * - Android: behavior="height" (works with softwareKeyboardLayoutMode="pan" or default)
 * - ScrollView with keyboardShouldPersistTaps="handled" lets button taps work while keyboard is open
 * - contentContainer paddingBottom ensures button is scrollable above keyboard
 */
export function KeyboardAwareSheet({
  children,
  sheetStyle,
}: {
  children: React.ReactNode;
  sheetStyle?: any;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      style={styles.kav}
    >
      <View style={styles.dim}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View
            style={[
              styles.sheet,
              isTablet && { width: "100%" as const, maxWidth: Math.min(640, width - 32), alignSelf: "center" as const },
              sheetStyle,
            ]}
          >
            {children}
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Variant for centered dialogs (e.g. verify code) - not bottom anchored
 */
export function KeyboardAwareDialog({
  children,
  sheetStyle,
}: {
  children: React.ReactNode;
  sheetStyle?: any;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      style={styles.kav}
    >
      <View style={styles.centerDim}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.centerContent}
        >
          <View
            style={[
              styles.dialog,
              isTablet && { width: "100%" as const, maxWidth: Math.min(480, width - 48), alignSelf: "center" as const },
              sheetStyle,
            ]}
          >
            {children}
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  centerDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  scrollContent: { flexGrow: 1, justifyContent: "flex-end" },
  centerContent: { flexGrow: 1, justifyContent: "center" },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
  },
  dialog: {
    backgroundColor: "white",
    borderRadius: 16,
    overflow: "hidden",
  },
});
