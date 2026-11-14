/**
 * The width each shown card renders at. CLIENT-SAFE, no JSX (so the tests can
 * import it).
 *
 * Consecutive half-width (M) cards stand in two columns (flowSegments below),
 * so a run of any length from two up fills both. An M card ALONE — every
 * neighbour full width, a third-width card, or hidden for want of data —
 * becomes full width, so it never leaves a hole beside it.
 */

import type { WidgetSize } from "@/lib/dashboards/system/catalog";

export function effectiveSizes(sizes: WidgetSize[]): WidgetSize[] {
  return sizes.map((size, i) => (size === "M" && sizes[i - 1] !== "M" && sizes[i + 1] !== "M" ? "L" : size));
}

/**
 * How the shown cards flow (CardFlow.tsx). A run of half-width cards becomes
 * two columns — first card left, second right, and so on — in which each card
 * keeps its own height, so a short card no longer stretches to its taller
 * neighbour and leaves white space. Any other card sits on its own.
 */
export type FlowSegment =
  | { kind: "one"; index: number }
  | { kind: "columns"; left: number[]; right: number[] };

export function flowSegments(sizes: WidgetSize[]): FlowSegment[] {
  const out: FlowSegment[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: "columns", left: run.filter((_, k) => k % 2 === 0), right: run.filter((_, k) => k % 2 === 1) });
    else run.forEach((index) => out.push({ kind: "one", index }));
    run = [];
  };
  sizes.forEach((size, i) => {
    if (size === "M") run.push(i);
    else {
      flush();
      out.push({ kind: "one", index: i });
    }
  });
  flush();
  return out;
}
