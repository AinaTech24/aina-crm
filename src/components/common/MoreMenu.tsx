"use client";

/**
 * The "⋯" at the end of a page header: everything that is not the page's one
 * primary action or its one secondary action. Links only; items are plain data
 * so a server component can pass them.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { Tooltip } from "@/components/ui/Tooltip";

export type MoreMenuItem = {
  href: string;
  label: string;
  description?: string;
  /** Longer explanation, shown on hover. */
  tooltip?: string;
};

export function MoreMenu({
  items,
  label = "More actions",
  text,
}: {
  items: readonly MoreMenuItem[];
  label?: string;
  /** A labelled secondary button instead of the "⋯" icon — for a menu that IS an action. */
  text?: string;
}) {
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

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <Tooltip label={label} hidden={open || !!text}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={text ? undefined : label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={buttonClass("secondary", text ? "md" : "icon")}
        >
          {text ? <>{text} <ChevronDown className="size-3.5" aria-hidden /></> : <MoreHorizontal className="size-4" />}
        </button>
      </Tooltip>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border bg-card p-1.5 text-left shadow-lg">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              title={it.tooltip}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
            >
              {it.label}
              {it.description && <span className="block text-2xs font-normal text-muted-foreground">{it.description}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
