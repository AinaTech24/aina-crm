"use client";

/**
 * One "Filters" button in place of a wall of dropdowns.
 *
 * Every role dashboard opened on its filters: 7 controls on the RM desk, 11 on
 * Insurance, 13 on Claims, wrapping over up to four rows before the first
 * number. Most people never change most of them, and to someone new to the
 * CRM a page that opens on thirteen "Any …" dropdowns reads as a form to fill
 * in before they are allowed to see anything.
 *
 * This keeps each dashboard's own filter component exactly as it was — same
 * controls, same URL params — and only decides when it is on screen: folded
 * away by default, behind a button that says how many are applied. What IS
 * applied stays visible as chips (AppliedFilterChips), so folding the controls
 * never hides the fact that the numbers are narrowed.
 *
 * `keys` are the URL params the wrapped filters write; the badge counts the
 * ones that are set. `leading` sits on the same row as the button (the period
 * picker), so the whole header is one line until someone asks for more.
 */

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/lib/utils";

export function FilterDisclosure({
  keys,
  start,
  leading,
  children,
  className,
}: {
  keys: readonly string[];
  /** Left end of the row — the page's actions. */
  start?: ReactNode;
  /** Right end, before the Filters button — the period picker. */
  leading?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const params = useSearchParams();
  const active = keys.filter((k) => (params?.get(k) ?? "") !== "").length;
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{start}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
        {leading}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          // Always secondary: one primary button per screen, and that is the
          // page's main action, not the filter toggle. The count carries the colour.
          className={buttonClass("secondary", "sm")}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          Filters
          {active > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-2xs font-semibold tabular-nums text-primary-foreground">
              {active}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        </div>
      </div>
      {open &&<div className="rounded-lg border border-border bg-card p-3">{children}</div>}
    </div>
  );
}
