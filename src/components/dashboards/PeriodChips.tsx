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

/** Ordered the way a firm reads time: now first, then the step back. */
const CHIPS: Array<{ key: Period; label: string }> = [
  { key: "tw", label: "This week" },
  { key: "lw", label: "Last week" },
  { key: "mtd", label: "This month" },
  { key: "lm", label: "Last month" },
  { key: "qtd", label: "This quarter" },
  { key: "lq", label: "Last quarter" },
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
    <div
      className={`inline-flex flex-wrap items-center gap-1 ${pending ? "opacity-60" : ""}`}
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
            className={`rounded-md px-2.5 py-1 text-2xs font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
