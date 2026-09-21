"use client";

/**
 * Global "+ Add" — spec §23.
 *
 * One button in the header that starts any record, from anywhere. Before this
 * the only way to create something was to navigate to its module first and find
 * that module's own Add button, which is several clicks from wherever you are
 * and assumes you know which module owns the thing you want.
 *
 * The caller decides what goes in it: the layout computes the allowed entries
 * server-side from the session's capabilities, so the capability matrix never
 * ships to the browser and a user is never shown an action that will 403.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

export type QuickAddItem = {
  label: string;
  href: string;
  /** Lucide icon name is resolved by the parent; we take rendered nodes. */
  icon?: React.ReactNode;
  /** Shown under the label — used where the destination isn't a plain form. */
  hint?: string;
};

export function QuickAdd({ items }: { items: QuickAddItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on navigation — otherwise the menu stays open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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

  if (!items.length) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-primary px-2.5 py-1.5 text-xs sm:px-3"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create a new record"
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">Add</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Create new"
          className="absolute right-0 top-full mt-2 z-50 w-60 card-surface shadow-lg p-1.5"
        >
          <p className="px-2.5 pt-1 pb-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
            Create new
          </p>
          <ul className="max-h-[70vh] overflow-y-auto">
            {items.map((it) => (
              <li key={it.href + it.label}>
                <Link
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-secondary transition-colors"
                >
                  {it.icon ? (
                    <span className="mt-0.5 text-muted-foreground shrink-0">{it.icon}</span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate">{it.label}</span>
                    {it.hint ? (
                      <span className="block text-2xs text-muted-foreground truncate">{it.hint}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
