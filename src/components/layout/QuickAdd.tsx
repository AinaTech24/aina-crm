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
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { openLogActivity } from "@/lib/activities/contact-log";

export type QuickAddItem = {
  label: string;
  href: string;
  /** Lucide icon name is resolved by the parent; we take rendered nodes. */
  icon?: React.ReactNode;
  /** Shown under the label — used where the destination isn't a plain form. */
  hint?: string;
  /** Opens in place instead of navigating: "log-activity" is the Log activity drawer. */
  action?: "log-activity";
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
      <Button
        variant="primary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        icon={<Plus className="size-4" />}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create a new record"
      >
        <span className="hidden sm:inline">Add</span>
      </Button>

      {open && (
        <Card className="absolute right-0 top-full mt-2 z-50 w-60 shadow-lg p-1.5">
          <p className="px-2.5 pt-1 pb-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
            Create new
          </p>
          <ul role="menu" aria-label="Create new" className="max-h-[70vh] overflow-y-auto">
            {items.map((it) => (
              <li key={it.href + it.label}>
                {it.action === "log-activity" ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setOpen(false); openLogActivity("call"); }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-secondary transition-colors"
                  >
                    <ItemBody it={it} />
                  </button>
                ) : (
                  <Link
                    href={it.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-secondary transition-colors"
                  >
                    <ItemBody it={it} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ItemBody({ it }: { it: QuickAddItem }) {
  return (
    <>
      {it.icon ? <span className="mt-0.5 text-muted-foreground shrink-0">{it.icon}</span> : null}
      <span className="min-w-0">
        <span className="block truncate">{it.label}</span>
        {it.hint ? <span className="block text-2xs text-muted-foreground truncate">{it.hint}</span> : null}
      </span>
    </>
  );
}
