/**
 * SavedCopyBanner — says a screen is showing the copy saved on this phone
 * because the server can't be reached (no signal, a lift, a village branch).
 * The query cache is persisted for 24 h (api/queryPersist), so a client or lead
 * opened earlier still reads in full; this line keeps that honest: when it was
 * saved, and that changes wait for a connection.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { fmtDateTime } from "../lib/format";
import { palette, spacing, radius } from "../theme/tokens";

export function SavedCopyBanner({ savedAt, style }: { savedAt?: number | null; style?: object }) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="text">
      <Feather name="wifi-off" size={14} color={palette.warning} />
      <Text variant="caption" style={{ flex: 1, color: palette.ink }}>
        Offline · saved copy{savedAt ? ` from ${fmtDateTime(savedAt)}` : ""}. Changes need a connection.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.warningBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
