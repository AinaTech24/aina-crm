"use client";

/**
 * A run of half-width dashboard cards in two columns that end level. The
 * server can't know a card's height, so the first paint alternates (first
 * card left, second right — flowSegments); once the cards can be measured,
 * each goes, in its original order, into whichever column is shorter. A card
 * keeps its height wherever it stands (both columns are the same width), so
 * moving one never changes the measurement and the layout settles at once.
 * It re-measures when a card's height changes (a chart drawing in, a filter).
 *
 * Below xl the columns dissolve (display: contents) and `order` puts every
 * card back in its original place in one column — the assignment is moot.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Tailwind's xl, where half-width cards stand side by side (WidgetCard SIZE_CLASS). */
const XL = "(min-width: 1280px)";
/** The gap between cards (gap-4). */
const GAP = 16;

// useLayoutEffect warns during server rendering; the effect only matters in the browser.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function BalancedColumns({ items }: { items: Array<{ key: string; order: number; node: ReactNode }> }) {
  const [cols, setCols] = useState<number[]>(() => items.map((_, k) => k % 2));
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const keys = items.map((it) => it.key).join("|");

  useIsoLayoutEffect(() => {
    const wide = window.matchMedia(XL);
    let frame = 0;
    const balance = () => {
      if (!wide.matches) return;
      const height = [0, 0];
      const next = items.map((_, k) => {
        const c = height[0] <= height[1] ? 0 : 1;
        height[c] += (refs.current[k]?.offsetHeight ?? 0) + GAP;
        return c;
      });
      setCols((prev) => (prev.length === next.length && prev.every((c, k) => c === next[k]) ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(balance);
    };
    balance();
    const ro = new ResizeObserver(schedule);
    refs.current.forEach((el) => el && ro.observe(el));
    wide.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      wide.removeEventListener("change", schedule);
    };
    // Re-run when the cards change or move (a moved card is a new element to observe).
  }, [keys, cols]);

  return (
    <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start">
      {[0, 1].map((c) => (
        <div key={c} className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          {items.map((it, k) =>
            (cols[k] ?? k % 2) === c ? (
              <div
                key={it.key}
                ref={(el) => {
                  refs.current[k] = el;
                }}
                className="min-w-0"
                style={{ order: it.order }}
              >
                {it.node}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}
