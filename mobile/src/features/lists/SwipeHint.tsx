/**
 * SwipeHint — the one-line, one-time note above the first swipeable row.
 * Tap it (or swipe any row) and it never comes back on this phone.
 */

import React from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { palette, spacing, radius } from "../../theme/tokens";

export function SwipeHint({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
      <Pressable onPress={onDismiss} style={styles.hint} accessibilityRole="button" accessibilityLabel={`${text}. Dismiss`}>
        <Feather name="chevrons-right" size={14} color={palette.muted} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={2}>{text}</Text>
        <Feather name="x" size={14} color={palette.muted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surfaceSunken },
});
