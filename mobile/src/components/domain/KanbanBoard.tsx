/**
 * KanbanBoard — the phone version of the CRM's drag-and-drop boards (Tasks,
 * Meetings, Clients). Columns scroll sideways, each with its cards; tap a
 * card to open it, long-press (or its ⋯) to move it to another column — the
 * same change the web makes on a drop. Columns marked `noDrop` (e.g. a
 * reschedule, which needs a new date) are never offered as a destination.
 */

import React, { useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";

export interface KanbanColumn { key: string; label: string; color: string; noDrop?: boolean }

export function KanbanBoard<T>({ columns, items, columnOf, keyOf, renderCard, onOpen, onMove, canMove, emptyText = "Nothing here" }: {
  columns: KanbanColumn[];
  items: T[];
  columnOf: (item: T) => string;
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onOpen: (item: T) => void;
  /** Move a card; omit to make the board read-only. */
  onMove?: (item: T, toColumn: string) => void;
  canMove?: (item: T) => boolean;
  emptyText?: string;
}) {
  const [moving, setMoving] = useState<T | null>(null);
  // Each column scrolls on its own, so it needs a real height: the board's,
  // less the room kept clear for the FAB.
  const [boardH, setBoardH] = useState(0);
  const byColumn = new Map<string, T[]>(columns.map((c) => [c.key, []]));
  for (const it of items) byColumn.get(columnOf(it))?.push(it);
  const movable = (it: T) => !!onMove && (canMove ? canMove(it) : true);
  const startMove = (it: T) => {
    if (!movable(it)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMoving(it);
  };
  const from = moving ? columnOf(moving) : null;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.board} onLayout={(e) => setBoardH(e.nativeEvent.layout.height)}>
        {columns.map((col) => {
          const list = byColumn.get(col.key) ?? [];
          return (
            <View key={col.key} style={[styles.column, boardH > 0 && { maxHeight: boardH - BOTTOM_CLEAR }]}>
              <View style={styles.colHeader}>
                <View style={[styles.colDot, { backgroundColor: col.color }]} />
                <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{col.label}</Text>
                <View style={styles.countBadge}><Text variant="caption" tone="muted">{list.length}</Text></View>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {list.length === 0 ? <Text variant="caption" tone="faint" style={styles.empty}>{emptyText}</Text> : list.map((it) => (
                  <Pressable key={keyOf(it)} onPress={() => onOpen(it)} onLongPress={() => startMove(it)} delayLongPress={300} accessibilityRole="button" accessibilityHint={movable(it) ? "Long-press to move" : undefined}>
                    <View style={styles.card}>
                      <View style={{ flex: 1 }}>{renderCard(it)}</View>
                      {movable(it) ? (
                        <Pressable onPress={() => startMove(it)} hitSlop={10} accessibilityLabel="Move" style={styles.moveBtn}>
                          <Feather name="more-vertical" size={16} color={palette.faint} />
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
      <BottomSheet visible={!!moving} onClose={() => setMoving(null)} title="Move to">
        {columns.filter((c) => c.key !== from && !c.noDrop).map((c) => (
          <Pressable key={c.key} style={styles.option} onPress={() => { const it = moving!; setMoving(null); onMove?.(it, c.key); }} accessibilityRole="button">
            <View style={[styles.colDot, { backgroundColor: c.color }]} />
            <Text style={{ flex: 1, fontWeight: fontWeight.medium }}>{c.label}</Text>
            <Feather name="chevron-right" size={16} color={palette.faint} />
          </Pressable>
        ))}
      </BottomSheet>
    </>
  );
}

const BOTTOM_CLEAR = 96;

const styles = StyleSheet.create({
  board: { paddingHorizontal: spacing.lg, paddingBottom: BOTTOM_CLEAR, alignItems: "flex-start" },
  column: { width: 260, backgroundColor: palette.surfaceSunken, borderRadius: 14, padding: spacing.sm, marginRight: spacing.md },
  colHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  countBadge: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, padding: spacing.md, marginBottom: spacing.sm },
  moveBtn: { paddingTop: 2 },
  empty: { textAlign: "center", paddingVertical: spacing.lg },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
