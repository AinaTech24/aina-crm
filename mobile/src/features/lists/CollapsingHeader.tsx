/**
 * A list header (counts, search, filters) that slides away as you scroll down
 * and comes back as soon as you scroll up — so the list gets the screen, and
 * search is one flick away. The header floats over the list; the list keeps a
 * spacer of the same height at its top. When to hide is `nextCollapse`
 * (collapse.ts); the slide runs on the UI thread.
 *
 *   const ch = useCollapsingHeader();
 *   <View style={{ flex: 1, overflow: "hidden" }}>
 *     <FlashList {...ch.listProps} ListHeaderComponent={ch.spacer} … />
 *     <CollapsingHeader controller={ch}>{header}</CollapsingHeader>
 *   </View>
 *
 * Pull-to-refresh keeps working: on iOS the header rides down with the pull so
 * the spinner shows above it; on Android `progressViewOffset` drops the
 * spinner below it.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, StyleSheet, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { palette } from "../../theme/tokens";
import { COLLAPSE_START, nextCollapse, type CollapseState } from "./collapse";

export interface CollapsingHeaderController {
  height: number;
  onLayout: (e: LayoutChangeEvent) => void;
  style: ReturnType<typeof useAnimatedStyle>;
  /** Spread on the list: onScroll, scrollEventThrottle, progressViewOffset. */
  listProps: {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onContentSizeChange: (w: number, h: number) => void;
    scrollEventThrottle: number;
    progressViewOffset: number;
  };
  /** The list's ListHeaderComponent: room for the floating header. */
  spacer: React.ReactElement;
  /** Bring the header back (e.g. after the filters change). */
  show: () => void;
}

const SLIDE = { duration: 220, easing: Easing.out(Easing.cubic) };

export function useCollapsingHeader(): CollapsingHeaderController {
  const [height, setHeight] = useState(0);
  const heightRef = useRef(0);
  const h = useSharedValue(0);
  const hidden = useSharedValue(0);
  const pull = useSharedValue(0);
  const state = useRef<CollapseState>(COLLAPSE_START);
  const viewportH = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (next === heightRef.current) return;
    heightRef.current = next;
    h.value = next;
    setHeight(next);
  }, [h]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    viewportH.current = layoutMeasurement.height;
    // iOS pull-to-refresh: ride down with the content so the spinner shows.
    pull.value = y < 0 ? -y : 0;
    const next = nextCollapse(state.current, y, { headerHeight: heightRef.current, maxY: contentSize.height - layoutMeasurement.height });
    if (next.hidden !== state.current.hidden) hidden.value = withTiming(next.hidden ? 1 : 0, SLIDE);
    state.current = next;
  }, [hidden, pull]);

  const show = useCallback(() => {
    if (!state.current.hidden) return;
    state.current = { hidden: false, anchor: state.current.anchor };
    hidden.value = withTiming(0, SLIDE);
  }, [hidden]);

  // The list shrank (new filter, fewer rows) and can no longer scroll: bring
  // the header back, or nothing would.
  const onContentSizeChange = useCallback((_w: number, contentH: number) => {
    if (state.current.hidden && contentH - viewportH.current <= heightRef.current) show();
  }, [show]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value - h.value * hidden.value }] }));
  const spacer = useMemo(() => <View style={{ height }} />, [height]);
  const listProps = useMemo(() => ({ onScroll, onContentSizeChange, scrollEventThrottle: 16, progressViewOffset: height }), [onScroll, onContentSizeChange, height]);

  return { height, onLayout, style, listProps, spacer, show };
}

/** The floating header. Gaps between its controls pass touches to the list. */
export function CollapsingHeader({ controller, children, style }: { controller: CollapsingHeaderController; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View pointerEvents="box-none" onLayout={controller.onLayout} style={[styles.wrap, style, controller.style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: palette.surfaceAlt },
});
