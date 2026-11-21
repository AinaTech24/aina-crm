/**
 * CountChips — a list's headline counts as one thin row of chips ("Overdue 4",
 * "Reviews due 12") instead of a row of tall tiles, so the first row of the
 * list sits near the top. A chip that filters is tappable; the chosen one is
 * outlined in the firm's colour and shows × (tap again to clear). Colour is a
 * signal: counts are ink, a zero is grey, red only for overdue work, and an
 * unknown count is "—", never 0.
 */

import React from "react";
import { ScrollView, Pressable, View, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Text } from "../../components/ui/Text";
import { useBrand } from "../../theme/brand";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export interface CountChipProps {
  label: string;
  /** undefined → no number; null → "—" (unknown, not zero). */
  value?: string | number | null;
  selected?: boolean;
  /** A selected chip shows × — tapping it clears the filter. */
  clearable?: boolean;
  /** "danger": the number is red when above zero (overdue only). */
  tone?: "default" | "danger";
  dotColor?: string;
  icon?: FeatherName;
  onPress?: () => void;
  accessibilityLabel?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}

function isZero(v: CountChipProps["value"]): boolean {
  return v === 0 || v === "0";
}

export function CountChip({ label, value, selected, clearable = true, tone = "default", dotColor, icon, onPress, accessibilityLabel, onLayout }: CountChipProps) {
  const { brand, brandLight } = useBrand();
  const shown = value === undefined ? null : value === null ? "—" : typeof value === "number" ? value.toLocaleString("en-IN") : value;
  const valueColor = selected ? brand : value == null || isZero(value) ? palette.muted : tone === "danger" ? palette.danger : palette.ink;
  const body = (
    <View style={[styles.chip, selected && { borderColor: brand, backgroundColor: brandLight }]}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      {icon ? <Feather name={icon} size={13} color={selected ? brand : palette.muted} /> : null}
      <Text variant="caption" style={{ color: selected ? brand : palette.muted }} numberOfLines={1}>{label}</Text>
      {shown != null ? <Text variant="caption" style={{ color: valueColor, fontWeight: fontWeight.bold }} numberOfLines={1}>{shown}</Text> : null}
      {selected && clearable && onPress ? <Feather name="x" size={12} color={brand} /> : null}
    </View>
  );
  if (!onPress) {
    return <View onLayout={onLayout} accessible accessibilityLabel={accessibilityLabel ?? `${label}${shown != null ? `: ${shown}` : ""}`}>{body}</View>;
  }
  return (
    <Pressable
      onLayout={onLayout}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? `${label}${shown != null ? `: ${shown}` : ""}`}
    >
      {body}
    </Pressable>
  );
}

/** A horizontally scrolling row of chips. */
export const CountChipRow = React.forwardRef<ScrollView, { children: React.ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }>(function CountChipRow({ children, style, contentStyle }, ref) {
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={[styles.row, contentStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { gap: spacing.sm, alignItems: "center", paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
