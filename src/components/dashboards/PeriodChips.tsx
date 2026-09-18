"use client";

/**
 * One-click period chips for the dashboard filter row.
 *
 * The period control was a dropdown, and deliberately so — it also carries the
 * richer pickers (a specific month, a specific quarter, "since <date>", and a
 * custom from–to range) that could never fit on a chip row. Those stay exactly
 * where they are. This adds the eight ranges people actually pick every day in
 * front of it, so the most-used control on the page costs one click instead of
 * two.
 *
 * Purely a URL-param writer, same contract as DashboardHeaderBar: it sets
 * `?period=` and clears the custom-range params that would otherwise win, and
 * the server cockpit resolves the actual dates.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import type { Period } from "@/lib/dashboard/period";

/**
 * Ordered the way a firm reads time. Six, not eight.
 *
 * All eight ranges still exist — "Last week" and "Last quarter" live in the
 * period dropdown immediately to the right, alongside the pickers chips could
 * never carry. Eight chips plus two dropdowns plus two page actions did not fit
 * one row at 1280px, so the toolbar silently wrapped onto two, which is the
 * kind of thing that reads as unfinished rather than as a decision.
 */
const CHIPS: Array<{ key: Period; label: string }> = [
  { key: "tw", label: "This week" },
  { key: "mtd", label: "This month" },
  { key: "lm", label: "Last month" },
  { key: "qtd", label: "This quarter" },
  { key: "fytd", label: "This FY" },
  { key: "ly", label: "Last FY" },
];

export function PeriodChips({ current }: { current: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(key: Period) {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("period", key);
    // A leftover custom range outranks `period` in resolvePeriodRange, so a
    // chip would silently do nothing if these were left behind.
    next.delete("pstart");
    next.delete("pfrom");
    next.delete("pto");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    /* A segmented control, not eight loose pills. One recessed track with the
       active segment raised out of it reads as a single control with one value
       — which is what it is — and is the difference between looking assembled
       and looking scattered. */
    <div
      className={`inline-flex items-center rounded-lg bg-secondary p-0.5 ${
        pending ? "opacity-60" : ""
      }`}
      role="group"
      aria-label="Date range"
    >
      {CHIPS.map((c) => {
        const active = c.key === current;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => pick(c.key)}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 text-2xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
