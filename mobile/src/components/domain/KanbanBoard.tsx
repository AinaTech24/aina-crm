/**
 * KanbanBoard — the phone version of the CRM's drag-and-drop boards (Tasks,
 * Meetings, Clients). One column per swipe: a column is the screen less a
 * peek of the next, and the board snaps column by column. A row of chips on
 * top (stage + count) jumps straight to a column. On a long board (more than
 * six columns — the 25 client stages) empty columns are hidden by default; the
 * last chip shows or hides them.
 *
 * Tap a card to open it, long-press (or its ⋯) to move it to another column —
 * the same change the web makes on a drop. Columns marked `noDrop` (e.g. a
 * reschedule, which needs a new date) are never offered as a destination; a
 * hidden empty column still is. A moved card shows in its new column at once
 * and goes back if the move fails (onMove rejects or the refreshed data
 * disagrees). When `onMove` returns a `KanbanMoveOutcome`, the board shows its
 * message, with Undo for ~5 s when it carries one — no confirmation first.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { toast } from "../../lib/toast";
import { CountChip, CountChipRow } from "../../features/lists/CountChips";
import {
  KANBAN_GAP, KANBAN_PAD, hideEmptyByDefault, kanbanColumnWidth, kanbanEndPadding, kanbanIndexAt, visibleKanbanColumns,
} from "../../features/lists/kanban";

export interface KanbanColumn { key: string; label: string; color: string; noDrop?: boolean }

/** What a move did. `undo` puts it back (the board shows the card in its old
 *  column at once and keeps it there until `undo` settles). */
export interface KanbanMoveOutcome { message: string; undo?: () => Promise<unknown> | void }

function isOutcome(v: unknown): v is KanbanMoveOutcome {
  return !!v && typeof v === "object" && typeof (v as KanbanMoveOutcome).message === "string";
}

export function KanbanBoard<T>({ columns, items, columnOf, keyOf, renderCard, onOpen, onMove, canMove, emptyText = "Nothing here", hideEmpty: hideEmptyProp }: {
  columns: KanbanColumn[];
  items: T[];
  columnOf: (item: T) => string;
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onOpen: (item: T) => void;
  /** Move a card; omit to make the board read-only. Settle once the data is refreshed. */
  onMove?: (item: T, toColumn: string) => void | KanbanMoveOutcome | Promise<unknown>;
  canMove?: (item: T) => boolean;
  emptyText?: string;
  /** Start with empty columns hidden. Default: when there are more than six. */
  hideEmpty?: boolean;
}) {
  const [moving, setMoving] = useState<T | null>(null);
  // Cards moved but not yet confirmed by fresh data: key → column.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [hideEmpty, setHideEmpty] = useState(hideEmptyProp ?? hideEmptyByDefault(columns.length));
  // Each column scrolls on its own, so it needs a real height: the board's,
  // less the room kept clear for the FAB. Its width sets the column width.
  const [board, setBoard] = useState({ w: 0, h: 0 });
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const boardRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const chipX = useRef<Record<string, number>>({});

  const colOf = (it: T) => pending[keyOf(it)] ?? columnOf(it);
  const byColumn = new Map<string, T[]>(columns.map((c) => [c.key, []]));
  for (const it of items) byColumn.get(colOf(it))?.push(it);
  const counts: Record<string, number> = {};
  for (const c of columns) counts[c.key] = byColumn.get(c.key)?.length ?? 0;
  const visible = visibleKanbanColumns(columns, counts, hideEmpty);
  const emptyHidden = columns.length - visible.length;
  const showToggle = hideEmpty ? emptyHidden > 0 : columns.some((c) => counts[c.key] === 0);

  const colW = kanbanColumnWidth(board.w);
  const interval = colW + KANBAN_GAP;
  const endPad = board.w > 0 ? kanbanEndPadding(board.w, colW) : KANBAN_PAD;
  // The chosen column, or — when it just emptied and hid — the one now in its place.
  const lastIndex = useRef(0);
  const found = visible.findIndex((c) => c.key === currentKey);
  const currentIndex = found >= 0 ? found : Math.max(0, Math.min(lastIndex.current, visible.length - 1));
  lastIndex.current = currentIndex;
  const visibleSig = visible.map((c) => c.key).join("|");

  // The column set changed (empties shown / hidden, a column emptied): stay on
  // the same column if it is still there.
  useEffect(() => {
    if (!board.w) return;
    boardRef.current?.scrollTo({ x: currentIndex * interval, animated: false });
  }, [visibleSig, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the chosen chip in view.
  useEffect(() => {
    const key = visible[currentIndex]?.key;
    const x = key ? chipX.current[key] : undefined;
    if (x != null) chipsRef.current?.scrollTo({ x: Math.max(0, x - KANBAN_PAD), animated: true });
  }, [currentIndex, visibleSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = kanbanIndexAt(e.nativeEvent.contentOffset.x, interval, visible.length);
    const key = visible[i]?.key ?? null;
    if (key !== currentKey) setCurrentKey(key);
  };
  const jumpTo = (i: number) => {
    setCurrentKey(visible[i]?.key ?? null);
    boardRef.current?.scrollTo({ x: i * interval, animated: true });
  };

  const movable = (it: T) => !!onMove && (canMove ? canMove(it) : true);
  const startMove = (it: T) => {
    if (!movable(it)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMoving(it);
  };
  const from = moving ? colOf(moving) : null;
  const unpend = (k: string) =>
    setPending((p) => {
      const { [k]: _, ...rest } = p;
      return rest;
    });
  const putBack = (k: string, to: string, undo: () => Promise<unknown> | void) => {
    setPending((p) => ({ ...p, [k]: to }));
    new Promise<unknown>((resolve) => resolve(undo())).catch(() => {}).finally(() => unpend(k));
  };
  const move = (it: T, to: string) => {
    const k = keyOf(it);
    const was = colOf(it);
    setPending((p) => ({ ...p, [k]: to }));
    new Promise<unknown>((resolve) => resolve(onMove?.(it, to)))
      .then((out) => {
        if (!isOutcome(out)) return;
        const undo = out.undo;
        if (undo) toast.undo(out.message, () => putBack(k, was, undo));
        else toast.success(out.message);
      })
      .catch(() => {})
      .finally(() => unpend(k));
  };

  return (
    <>
      <View style={{ flex: 1 }}>
        <CountChipRow ref={chipsRef} style={styles.chips} contentStyle={styles.chipsContent}>
          {visible.map((col, i) => (
            <CountChip
              key={col.key}
              label={col.label}
              value={counts[col.key]}
              dotColor={col.color}
              selected={i === currentIndex}
              clearable={false}
              onPress={() => jumpTo(i)}
              accessibilityLabel={`${col.label}: ${counts[col.key]}`}
              onLayout={(e) => { chipX.current[col.key] = e.nativeEvent.layout.x; }}
            />
          ))}
          {showToggle ? (
            <CountChip
              label={hideEmpty ? `+${emptyHidden} empty` : "Hide empty"}
              icon={hideEmpty ? "eye" : "eye-off"}
              clearable={false}
              onPress={() => setHideEmpty((v) => !v)}
              accessibilityLabel={hideEmpty ? `Show ${emptyHidden} empty columns` : "Hide empty columns"}
            />
          ) : null}
        </CountChipRow>
        <ScrollView
          ref={boardRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.board, { paddingRight: endPad }]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width !== board.w || height !== board.h) setBoard({ w: width, h: height });
          }}
          snapToInterval={interval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onMomentumScrollEnd={settle}
          onScrollEndDrag={settle}
        >
          {visible.map((col) => {
            const list = byColumn.get(col.key) ?? [];
            return (
              <View key={col.key} style={[styles.column, { width: colW }, board.h > 0 && { maxHeight: board.h - BOTTOM_CLEAR }]}>
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{col.label}</Text>
                  <View style={styles.countBadge}><Text variant="caption" tone="muted">{list.length}</Text></View>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                  {list.length === 0 ? <Text variant="caption" tone="faint" style={styles.empty}>{emptyText}</Text> : list.map((it) => (
                    <Pressable
                      key={keyOf(it)}
                      onPress={() => onOpen(it)}
                      onLongPress={() => startMove(it)}
                      delayLongPress={300}
                      accessibilityRole="button"
                      accessibilityHint={movable(it) ? "Long-press to move" : undefined}
                      accessibilityActions={movable(it) ? [{ name: "move", label: "Move" }] : undefined}
                      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "move") startMove(it); }}
                    >
                      <View style={styles.card}>
                        <View style={{ flex: 1 }}>{renderCard(it)}</View>
                        {movable(it) ? (
                          <Pressable onPress={() => startMove(it)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move" style={styles.moveBtn}>
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
      </View>
      <BottomSheet visible={!!moving} onClose={() => setMoving(null)} title="Move to">
        {columns.filter((c) => c.key !== from && !c.noDrop).map((c) => (
          <Pressable key={c.key} style={styles.option} onPress={() => { const it = moving!; setMoving(null); move(it, c.key); }} accessibilityRole="button">
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
  chips: { flexGrow: 0, marginBottom: spacing.sm },
  chipsContent: { paddingHorizontal: KANBAN_PAD },
  board: { paddingLeft: KANBAN_PAD, paddingBottom: BOTTOM_CLEAR, gap: KANBAN_GAP, alignItems: "flex-start" },
  column: { backgroundColor: palette.surfaceSunken, borderRadius: 14, padding: spacing.sm },
  colHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  countBadge: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, padding: spacing.md, marginBottom: spacing.sm },
  moveBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginTop: -6, marginRight: -6 },
  empty: { textAlign: "center", paddingVertical: spacing.lg },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
