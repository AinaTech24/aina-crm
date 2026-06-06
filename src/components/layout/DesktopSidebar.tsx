"use client";

/**
 * Desktop sidebar shell (lg+) with hover-expand + click-to-pin behaviour.
 *
 *   • Resting state is a slim icon rail.
 *   • Hovering the rail expands it to the full nav. The sidebar is IN-FLOW, so
 *     the page content shrinks to make room (nothing hides behind it) and the
 *     width change animates smoothly.
 *   • The edge handle pins the sidebar: click to keep it open, click again to
 *     keep it closed (icons only). The choice persists across reloads.
 *
 * The nav markup itself is server-rendered and passed in as `children`; this
 * wrapper only owns the open/closed/hover state and the collapsed styling hook
 * (`.sidebar-collapsed`, see globals.css). Mobile uses MobileNav instead.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "aina:sidebar-pinned";
const RAIL = "4rem"; // collapsed icon-rail width
const FULL = "16rem"; // expanded width (matches the old w-64)

export function DesktopSidebar({ children }: { children: React.ReactNode }) {
  // Persisted pin state. Default "closed" → icon rail, expands on hover.
  const [pinned, setPinned] = useState<"open" | "closed">("closed");
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "open" || saved === "closed") setPinned(saved);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  function toggle() {
    setPinned((prev) => {
      const next = prev === "open" ? "closed" : "open";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Expanded when pinned open, or while hovering a closed (rail) sidebar.
  const expanded = pinned === "open" || hovered;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: expanded ? FULL : RAIL }}
      className={[
        "hidden lg:flex relative z-30 flex-shrink-0 h-full flex-col",
        "bg-card border-r border-border/70 shadow-sm print:hidden",
        "transition-[width] duration-300 ease-in-out",
        expanded ? "" : "sidebar-collapsed",
      ].join(" ")}
    >
      {/* Edge handle — straddles the sidebar's right border, always visible, so
          there's an obvious affordance to open/close. Icon reflects the pinned
          state: ‹ collapses, › keeps it open. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={pinned === "open" ? "Collapse sidebar" : "Keep sidebar open"}
        title={pinned === "open" ? "Collapse sidebar" : "Keep sidebar open"}
        className="absolute top-1/2 -right-3 z-40 grid size-6 -translate-y-1/2 place-items-center
                   rounded-full border border-border bg-card text-foreground/70 shadow-md
                   hover:text-brand-cyan hover:border-brand-cyan/50 hover:shadow-lg
                   transition-all duration-150"
      >
        {pinned === "open" ? (
          <ChevronLeft className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>

      {children}
    </aside>
  );
}
