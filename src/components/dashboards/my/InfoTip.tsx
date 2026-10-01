"use client";

/**
 * The ⓘ beside a section title: its purpose and caveats, on hover or focus.
 *
 * Two layout rules, both learned on the Claims Dashboard, where a ⓘ near a
 * card's right edge made the whole page scroll sideways:
 *   - Closed, the popup is NOT rendered as a box (display: none). An
 *     `invisible` box still takes layout space, and a 288px one hanging past
 *     the right edge widened the scrollable page by that much.
 *   - Open, it opens towards whichever side has room, so it never spills past
 *     the window either.
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const POPUP_W = 288; // w-72
const GUTTER = 16;

export function InfoTip({ children, label = "What this shows" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    setAlignRight(r.left + POPUP_W > window.innerWidth - GUTTER);
  }, [open]);

  return (
    <span
      ref={anchor}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        className="inline-grid size-6 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "absolute top-full z-50 mt-1 w-72 rounded-lg border border-border bg-card p-3 text-2xs font-normal normal-case leading-relaxed tracking-normal text-muted-foreground shadow-lg",
          alignRight ? "right-0" : "left-0",
          open ? "block" : "hidden",
        )}
      >
        {children}
      </span>
    </span>
  );
}
