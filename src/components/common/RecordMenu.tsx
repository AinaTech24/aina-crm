"use client";

/**
 * RecordMenu — the "More" menu in a record's header (lead, client).
 *
 * A detail page has one primary action and two or three it needs beside it.
 * Everything else — history, a portal link, an AI brief, delete — lives here,
 * as one list of rows that all look the same (`MENU_ITEM` in
 * @/components/ui/menu-item-class).
 *
 * The rows are passed in as children and rendered by the server page, so each
 * keeps its own drawer or dialog. Two things follow from that:
 *
 *  · The panel is always mounted and hidden with CSS when closed. Unmounting it
 *    would destroy a drawer in the same tick its row opened it.
 *  · Nothing here closes the menu on a row click. A row that opens a list in
 *    place (macros, cadences) would lose it. Closing is outside-click or
 *    Escape — and a drawer is outside, so opening one closes the menu on the
 *    first click inside it.
 */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

export function RecordMenu({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClass("secondary", "md")}
      >
        <MoreHorizontal className="size-4" aria-hidden /> {label}
      </button>
      <div
        role="menu"
        aria-hidden={!open}
        className={`absolute right-0 top-full z-40 mt-2 w-64 flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 text-left shadow-lg ${
          open ? "flex" : "hidden"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** A hairline between groups of rows — actions, tools, then the destructive one. */
export function RecordMenuSeparator() {
  return <div role="separator" className="my-1 h-px shrink-0 bg-border" />;
}
