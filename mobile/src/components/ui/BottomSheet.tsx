/**
 * BottomSheet — the app's modal surface for actions, pickers, filters and short
 * forms. Backdrop fade + sheet slide-up, tap-outside / swipe-down to dismiss.
 */

import React from "react";
import { Modal, View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { palette, radius, spacing } from "../../theme/tokens";
import { Text } from "./Text";

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={styles.backdrop} onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          exiting={SlideOutDown.duration(160)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.grabber} />
          {title ? (
            <Text variant="subtitle" style={{ marginBottom: spacing.md }}>
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: palette.overlay },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: palette.line, marginBottom: spacing.lg },
});
