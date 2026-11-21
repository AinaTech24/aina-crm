/**
 * Phone Kanban geometry and column visibility — pure, so it is tested without
 * a scroll view. One column per swipe: a column is the board's width less a
 * peek of the next one; the board snaps at column + gap.
 */

export const KANBAN_GAP = 12;
export const KANBAN_PAD = 16;
export const KANBAN_PEEK = 40;
const MIN_COL = 220;
const MAX_COL = 380;
const FALLBACK_COL = 260;

/** Column width for a board this wide (before the first layout: a safe default). */
export function kanbanColumnWidth(boardWidth: number): number {
  if (!(boardWidth > 0)) return FALLBACK_COL;
  return Math.round(Math.min(MAX_COL, Math.max(MIN_COL, boardWidth - KANBAN_PAD * 2 - KANBAN_PEEK)));
}

/** Room after the last column so it can snap to the left edge like the others. */
export function kanbanEndPadding(boardWidth: number, columnWidth: number): number {
  return Math.max(KANBAN_PAD, Math.round(boardWidth - KANBAN_PAD - columnWidth));
}

/** Which column a resting scroll offset shows. */
export function kanbanIndexAt(x: number, interval: number, count: number): number {
  if (count <= 0 || !(interval > 0)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(x / interval)));
}

/** Hide empty columns by default only on a long board (the 25 client stages). */
export function hideEmptyByDefault(columnCount: number): boolean {
  return columnCount > 6;
}

/**
 * The columns to draw. Hiding empties never leaves a blank board: when every
 * column is empty, all of them show (each says it is empty).
 */
export function visibleKanbanColumns<C extends { key: string }>(columns: C[], counts: Record<string, number>, hideEmpty: boolean): C[] {
  if (!hideEmpty) return columns;
  const withCards = columns.filter((c) => (counts[c.key] ?? 0) > 0);
  return withCards.length ? withCards : columns;
}
