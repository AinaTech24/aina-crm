"use client";

/**
 * The top bar's "?" — a small menu with two items: the Knowledge Base (this is
 * its ONLY door; the public site no longer links to it) and the product tour.
 * Help & glossary and What's new were removed from here at the firm's request
 * (2026-10-30); their pages still exist at /dashboard/help and /dashboard/whats-new.
 */

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Compass, BookOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { restartProductTour } from "@/components/layout/ProductTour";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors";

  return (
    <div className="relative" ref={ref}>
      <Tooltip label="Help" hidden={open}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Help"
          aria-haspopup="menu"
          aria-expanded={open}
          className="relative size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
        >
          <HelpCircle className="size-4" />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 z-40 rounded-lg border bg-card p-1.5 shadow-lg">
          <a href="/knowledge-base" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={item}>
            <BookOpen className="size-4 text-muted-foreground" />
            <span className="flex-1">
              Knowledge Base
              <span className="block text-2xs font-normal text-muted-foreground">Step-by-step guides for every module</span>
            </span>
          </a>
          <button
            type="button"
            onClick={() => { setOpen(false); restartProductTour(); }}
            className={`${item} w-full text-left`}
          >
            <Compass className="size-4 text-muted-foreground" />
            Take a tour
          </button>
        </div>
      )}
    </div>
  );
}
