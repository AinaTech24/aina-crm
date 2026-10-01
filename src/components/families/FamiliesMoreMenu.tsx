"use client";

/**
 * The Families header's "⋯ More": the two household tools that are useful but
 * not the page's main job, under names that say what they do.
 *
 *   Suggest family links  (was "AI pairing")     — a dialog of unlinked clients
 *                                                  who look like they belong to
 *                                                  an existing household
 *   Next generation view  (was "Next-gen pulse") — /dashboard/families/at-risk
 *
 * Suggestions load when the dialog opens. They used to be fetched on every
 * visit to the Families list just to print a count here — a whole-book scan on
 * each page load.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { FamilySuggestionsPanel } from "@/components/families/FamilySuggestionsPanel";
import { buttonClass } from "@/components/ui/button-class";
import { Tooltip } from "@/components/ui/Tooltip";

const SUGGEST_TIP =
  "Clients not in any family who look like they belong to one: the same mobile, email or address as a household member, or the family head named on their RTA record.";
const NEXT_GEN_TIP =
  "Families over ₹50 L whose head is 60+ or who have no member under 35 — and whether the next generation already invests with you.";

export function FamiliesMoreMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Identity-stable so the panel's reporting effect doesn't re-run every render.
  const handleCountChange = useCallback((n: number) => setCount(n), []);

  const item = "block w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground";

  return (
    <div className="relative" ref={ref}>
      <Tooltip label="More family tools" hidden={menuOpen}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="More family tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={buttonClass("secondary", "icon")}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </Tooltip>

      {menuOpen && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border bg-card p-1.5 shadow-lg">
          <button
            type="button"
            role="menuitem"
            title={SUGGEST_TIP}
            onClick={() => { setMenuOpen(false); setDialogOpen(true); }}
            className={item}
          >
            <span className="flex items-center gap-2">
              Suggest family links
              {count !== null && count > 0 && (
                <span className="rounded-full bg-secondary px-1.5 text-2xs font-semibold leading-5 tabular-nums text-foreground/70">{count}</span>
              )}
            </span>
            <span className="block text-2xs font-normal text-muted-foreground">Unlinked clients who look like family members</span>
          </button>
          <Link
            href="/dashboard/families/at-risk"
            role="menuitem"
            title={NEXT_GEN_TIP}
            onClick={() => setMenuOpen(false)}
            className={item}
          >
            Next generation view
            <span className="block text-2xs font-normal text-muted-foreground">Heirs and dependents to bring in before wealth moves</span>
          </Link>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              Suggest family links
              {count !== null && count > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-foreground/70 font-medium">
                  {count} {count === 1 ? "match" : "matches"}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Unlinked clients that look like they belong to a household — the same mobile, email or address as a member,
              or the family head named on their RTA record.
            </DialogDescription>
          </DialogHeader>
          {dialogOpen && <FamilySuggestionsPanel onCountChange={handleCountChange} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
