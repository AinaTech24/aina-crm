"use client";

/**
 * The top bar's "?" — a small menu rather than a link, so "What's new" can live
 * here instead of being a fifth round icon beside the bells.
 *
 * Unread release notes still get noticed: the trigger carries a dot while any
 * are unread, and the menu item carries the count. Opening /dashboard/whats-new
 * marks them read, so both clear on the next render.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HelpCircle, Sparkles, Compass, BookOpen } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { restartProductTour } from "@/components/layout/ProductTour";

export function HelpMenu({ whatsNewUnread = 0 }: { whatsNewUnread?: number }) {
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
      <Tooltip label="Help & glossary" hidden={open}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Help & glossary"
          aria-haspopup="menu"
          aria-expanded={open}
          className="relative size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
        >
          <HelpCircle className="size-4" />
          {whatsNewUnread > 0 && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-card" aria-hidden />
          )}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 z-40 rounded-lg border bg-card p-1.5 shadow-lg">
          <Link href="/dashboard/help" onClick={() => setOpen(false)} className={item}>
            <BookOpen className="size-4 text-muted-foreground" />
            <span className="flex-1">
              Help &amp; glossary
              <span className="block text-2xs font-normal text-muted-foreground">ARN, KYC, NAV and more, explained</span>
            </span>
          </Link>
          <a href="/knowledge-base" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={item}>
            <BookOpen className="size-4 text-muted-foreground" />
            <span className="flex-1">
              Knowledge Base
              <span className="block text-2xs font-normal text-muted-foreground">Step-by-step guides for every module</span>
            </span>
          </a>
          <Link href="/dashboard/whats-new" onClick={() => setOpen(false)} className={item}>
            <Sparkles className="size-4 text-muted-foreground" />
            <span className="flex-1">What&apos;s new</span>
            {whatsNewUnread > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-2xs font-bold leading-5 text-primary-foreground tabular-nums">
                {whatsNewUnread > 99 ? "99+" : whatsNewUnread}
              </span>
            )}
          </Link>
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
