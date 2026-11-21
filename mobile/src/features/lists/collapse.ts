/**
 * When a list's header (counts, search, filters) slides away and comes back.
 * Pure, so it is tested without a scroll view: hide after scrolling DOWN a
 * little past the header, show again after scrolling UP a little, and always
 * show near the top. The iOS bounce at either end never toggles it.
 */

export interface CollapseState {
  hidden: boolean;
  /** The turning point: lowest offset seen while shown, highest while hidden. */
  anchor: number;
}

export const COLLAPSE_START: CollapseState = { hidden: false, anchor: 0 };

export function nextCollapse(
  s: CollapseState,
  y: number,
  opts: { headerHeight: number; maxY: number; hideAfter?: number; showAfter?: number },
): CollapseState {
  const { headerHeight, hideAfter = 32, showAfter = 16 } = opts;
  const maxY = Math.max(0, opts.maxY);
  const yc = Math.min(Math.max(0, y), maxY);
  // Near the top: shown, and the distance to hide counts from the header's end.
  if (yc <= headerHeight) return { hidden: false, anchor: headerHeight };
  if (!s.hidden) {
    const anchor = Math.min(s.anchor, yc);
    return yc - anchor > hideAfter ? { hidden: true, anchor: yc } : { hidden: false, anchor };
  }
  const anchor = Math.max(s.anchor, yc);
  return anchor - yc > showAfter ? { hidden: false, anchor: yc } : { hidden: true, anchor };
}
