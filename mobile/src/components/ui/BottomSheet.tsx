/**
 * BottomSheet — the app's modal surface for actions, pickers, filters and short
 * forms. Smooth slide-up on open AND slide-down on close (driven by a shared
 * value so the exit actually plays — RN Modal unmounts instantly otherwise).
 * Tap-outside to dismiss. Hugs its content; no dead space below.
 *
 * Keyboard-aware: when the keyboard covers the sheet (Android draws apps edge
 * to edge, so a modal is no longer resized for it) the sheet lifts by exactly
 * the part that is covered — a note's Save button was hidden behind the
 * keyboard. Measured, so a window the OS did resize is not lifted twice.
 *
 * `scroll`: a tall form (the after-call prompt, a ticket editor) scrolls
 * inside the sheet instead of running off a small screen. Opt-in, because a
 * sheet whose content is itself a list must not nest it in a ScrollView.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Pressable, ScrollView, StyleSheet, useWindowDimensions, Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from "react-native-reanimated";
import { palette, radius, spacing } from "../../theme/tokens";
import { Text } from "./Text";

const OPEN_MS = 260;
const CLOSE_MS = 200;

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  scroll = false,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0); // 0 = closed, 1 = open
  const rootRef = useRef<View>(null);
  const [kbOverlap, setKbOverlap] = useState(0);

  useEffect(() => {
    if (!mounted) return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const kbTop = e.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _w, h) => setKbOverlap(Math.max(0, Math.round(y + h - kbTop))));
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbOverlap(0));
    return () => { show.remove(); hide.remove(); };
  }, [mounted]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * height }] }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} ref={rootRef} collapsable={false}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + kbOverlap }, sheetStyle]}>
          <View style={styles.grabber} />
          {title ? (
            <Text variant="subtitle" style={{ marginBottom: spacing.md }}>
              {title}
            </Text>
          ) : null}
          {scroll ? (
            <ScrollView
              style={{ maxHeight: Math.max(240, height * 0.85 - kbOverlap - insets.top - 120) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : children}
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
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: palette.line, marginBottom: spacing.md },
});
