/**
 * UndoToastHost — draws the one action toast (`toast.undo` / `toast.action`,
 * src/lib/toast.ts): the message and an Undo button, for ~5 s. Mounted by each
 * list that offers Undo (Tasks, Clients, Meetings); only the focused screen's
 * copy draws, so a screen left mounted underneath never doubles it. It sits
 * bottom-left beside the list's FAB. Tapping the message just closes it.
 */

import React, { useEffect } from "react";
import { View, Pressable, StyleSheet, AccessibilityInfo } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { Text } from "../../components/ui/Text";
import { useToastStore } from "../../lib/toast";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";

/** The list FAB: 56 wide, spacing.lg from the right edge. */
const FAB_ROOM = 56 + spacing.lg + spacing.md;

export function UndoToastHost() {
  const item = useToastStore((s) => s.action);
  const run = useToastStore((s) => s.runAction);
  const dismiss = useToastStore((s) => s.dismissAction);
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (item && focused) AccessibilityInfo.announceForAccessibility(`${item.message}. ${item.actionLabel} available.`);
  }, [item?.id, focused]);
  if (!focused) return null;
  // The wrapper stays mounted so the toast's exit animation can run.
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + spacing.lg }]}>
      {item ? (
        <Animated.View key={item.id} entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(160)} style={styles.toast}>
          <Pressable onPress={() => dismiss(item.id)} style={styles.msg} accessibilityRole="text">
            <Text style={{ color: palette.white, fontWeight: fontWeight.medium }} numberOfLines={2}>{item.message}</Text>
          </Pressable>
          <Pressable onPress={() => run(item.id)} hitSlop={6} style={styles.btn} accessibilityRole="button" accessibilityLabel={`${item.actionLabel}: ${item.message}`}>
            <Text style={{ color: palette.white, fontWeight: fontWeight.bold }}>{item.actionLabel}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.lg, right: FAB_ROOM },
  toast: { flexDirection: "row", alignItems: "center", minHeight: 52, borderRadius: radius.md, backgroundColor: palette.inverse, paddingLeft: spacing.md, shadowColor: palette.shadow, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  msg: { flex: 1, paddingVertical: spacing.sm, justifyContent: "center" },
  btn: { minWidth: 64, minHeight: 48, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.onBrandMuted, marginLeft: spacing.sm },
});
