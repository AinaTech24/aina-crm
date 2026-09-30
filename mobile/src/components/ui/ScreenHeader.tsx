/**
 * ScreenHeader — the top bar for screens that render without the Tabs header.
 * Title + optional subtitle + optional right action, and:
 *
 *  - pushed on a stack  → back chevron.
 *  - mounted as a TAB    → no chevron (there is nothing to go back to — it used
 *    to show one on Clients/Leads/Activities), plus the global search / bell /
 *    avatar actions every other tab has.
 *
 * "Am I a tab?" is read from this screen's OWN navigator, not the global URL:
 * a tab stays mounted under pushed screens, and a URL check would flip it.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { HeaderActions } from "../HeaderActions";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, TOUCH_MIN } from "../../theme/tokens";
import { Text } from "./Text";

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isTabRoot = navigation.getState?.()?.type === "tab";
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }, isTabRoot && { paddingLeft: spacing.lg }]}>
      {isTabRoot ? null : (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ width: TOUCH_MIN, height: TOUCH_MIN, justifyContent: "center" }}
        >
          <Feather name="chevron-left" size={26} color={palette.ink} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
      {isTabRoot ? <HeaderActions /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
});
