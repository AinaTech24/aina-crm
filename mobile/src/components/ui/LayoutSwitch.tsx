/**
 * LayoutSwitch — the web's List / Kanban toggle (?layout=kanban), kept apart
 * from a list's own scope tabs so the board can be filtered the same way.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "./Text";
import { useBrand } from "../../theme/brand";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";

export type Layout = "list" | "kanban";

export function LayoutSwitch({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  // The firm's colour, as a selected Chip uses.
  const { brand } = useBrand();
  return (
    <View style={styles.wrap}>
      {(["list", "kanban"] as const).map((k) => {
        const on = value === k;
        return (
          <Pressable key={k} onPress={() => onChange(k)} style={[styles.btn, on && { backgroundColor: brand }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={k === "list" ? "List" : "Kanban"}>
            <Feather name={k === "list" ? "list" : "columns"} size={15} color={on ? palette.white : palette.ink} />
            <Text variant="caption" style={{ color: on ? palette.white : palette.ink, fontWeight: fontWeight.semibold }}>{k === "list" ? "List" : "Kanban"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, overflow: "hidden", marginLeft: "auto" },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: palette.surface },
});
