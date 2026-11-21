/**
 * StickyActionBar — the Save / Next bar at the foot of a form. Put it INSIDE
 * the screen's KeyboardAvoidingView (after the ScrollView) so it rides above
 * the keyboard; it clears the home indicator only while the keyboard is down
 * (above the keyboard that inset is just a gap).
 */

import React, { useEffect, useState } from "react";
import { View, Keyboard, Platform, StyleSheet, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, spacing } from "../../theme/tokens";

/** Whether the software keyboard is up. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const a = Keyboard.addListener(showEvt, () => setShown(true));
    const b = Keyboard.addListener(hideEvt, () => setShown(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return shown;
}

export function StickyActionBar({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  return <View style={[styles.bar, { paddingBottom: (keyboard ? 0 : insets.bottom) + spacing.md }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
});
