/**
 * CollapsibleSection — one card of a form. On a long form its title row folds
 * and unfolds it; folded, the row says what is in it ("3 of 5 filled"). A
 * short form passes `collapsible={false}` and gets the plain titled card.
 */

import React from "react";
import { View, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../ui/Text";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";

export function CollapsibleSection({
  title,
  summary,
  open,
  onToggle,
  collapsible = true,
  children,
  footer,
  style,
}: {
  title?: string;
  /** The folded line, e.g. "3 of 5 filled". */
  summary?: string;
  open: boolean;
  onToggle?: () => void;
  collapsible?: boolean;
  children: React.ReactNode;
  /** Shown under the card's body whether it is folded or not (e.g. a live notice). */
  footer?: React.ReactNode;
  style?: ViewStyle;
}) {
  const folds = collapsible && !!title && !!onToggle;
  const shown = !folds || open;
  return (
    <View style={[styles.section, style]}>
      {folds ? (
        <Pressable
          onPress={onToggle}
          style={[styles.head, shown && styles.headOpen]}
          accessibilityRole="button"
          accessibilityState={{ expanded: shown }}
          accessibilityLabel={shown ? title : `${title}${summary ? `, ${summary}` : ""}`}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{title!.toUpperCase()}</Text>
            {!shown && summary ? <Text variant="caption" tone="muted" numberOfLines={1}>{summary}</Text> : null}
          </View>
          <Feather name={shown ? "chevron-up" : "chevron-down"} size={18} color={palette.muted} />
        </Pressable>
      ) : title ? (
        <Text style={[styles.title, { marginBottom: spacing.md }]}>{title.toUpperCase()}</Text>
      ) : null}
      {shown ? children : null}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  // 44pt tall, reaching into the card's padding so the visual stays compact.
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, marginTop: -spacing.sm, marginBottom: -spacing.sm },
  headOpen: { marginBottom: spacing.xs },
  title: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    color: palette.muted,
  },
});
