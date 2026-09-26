"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { openCommandPalette } from "./CommandPalette";

/**
 * The top-bar search field. It is a trigger, not a second search: clicking it
 * opens the Ctrl/⌘-K CommandPalette, which finds clients, leads, families,
 * folios, policies, tasks, reports AND pages in one list.
 *
 * It used to be its own inline search with a results popover. That meant two
 * searches that disagreed — this one found records but not pages, the sidebar
 * filter found pages but not records — so neither could be trusted to be the
 * place to look. Now there is one.
 */
export function GlobalSearch() {
  // "⌘K" on a Mac, "Ctrl K" elsewhere. Decided after mount so the server
  // render (which cannot know) and the first client render agree.
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘K");
  }, []);

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-haspopup="dialog"
      aria-label={`Search clients, leads, folios and pages (${shortcut})`}
      className="flex w-full min-w-0 max-w-md items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-left
                 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/80
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 min-w-0 truncate">Search clients, leads, folios, pages…</span>
      <kbd className="hidden lg:inline-flex shrink-0 items-center rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
        {shortcut}
      </kbd>
    </button>
  );
}
