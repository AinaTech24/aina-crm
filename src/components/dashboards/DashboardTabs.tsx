"use client";

/**
 * Dashboard tabs — Overview · Insights · Tracker.
 *
 * The cockpit had grown to roughly twenty stacked sections, so the numbers an
 * owner opens the page for sat above a very long scroll. Splitting it lets the
 * filter row, the headline figures and "what needs me today" share one screen.
 *
 * Deliberately a URL param, not local state and NOT css-hiding. `?tab=` means
 * the SERVER renders only the active tab, so the tracker's ~25 aggregate
 * queries do not run unless someone opens the tracker. The investor detail page
 * shows what the other approach costs: it hides sections with injected CSS, so
 * all 25 of its sections query on every load to display one.
 *
 * A URL also means a tab survives a refresh and can be linked to.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, LineChart, ListChecks } from "lucide-react";

import type { DashboardTab } from "@/lib/dashboard/tabs";

export type { DashboardTab };

const TABS: Array<{ key: DashboardTab; label: string; icon: typeof LayoutGrid; hint: string }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid, hint: "Headline numbers and what needs you today" },
  { key: "insights", label: "Insights", icon: LineChart, hint: "AUM mix, client mix, SIP business and flows" },
  { key: "tracker", label: "Tracker", icon: ListChecks, hint: "Every metric, grouped — leads to insurance" },
];

export function DashboardTabs({ current }: { current: DashboardTab }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(key: DashboardTab) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <nav className="inline-flex max-w-full rounded-xl border border-border/70 bg-secondary/70 p-1" aria-label="Dashboard sections">
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {TABS.map((t) => {
          const active = t.key === current;
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={hrefFor(t.key)}
              aria-current={active ? "page" : undefined}
              title={t.hint}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors ${
                active
                  ? "bg-card text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
