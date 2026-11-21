/**
 * Segmented control — a compact toggle (e.g. List / Board, or detail tabs).
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { palette, radius, spacing, colorScheme } from "../../theme/tokens";
import { Text } from "./Text";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.seg, active && styles.active]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <Text variant="label" dense style={{ color: active ? palette.ink : palette.muted }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: 3 },
  seg: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm },
  // Dark: the raised segment is a lighter step (a shadow can't lift on black).
  active: { backgroundColor: colorScheme === "dark" ? palette.line : palette.surface, shadowColor: palette.shadow, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
