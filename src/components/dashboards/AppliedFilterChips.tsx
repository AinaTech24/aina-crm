"use client";

/**
 * The filter receipt — what is actually narrowing the numbers on screen.
 *
 * The cockpit's filters live in the URL and are set from three separate
 * controls (period dropdown, member picker, branch picker). Once set, nothing
 * on the page said so: a director could read ₹4 Cr of net business without
 * noticing it was one branch, for one week. Every number above is scoped by
 * whatever this strip lists.
 *
 * Each chip removes its own filter; `Reset` clears all of them and returns the
 * page to the FY-to-date, whole-firm view. The period is deliberately NOT
 * removable — there is always a period — so it renders as a plain label.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { useEffect, useState } from "react";
import { X, RotateCcw, Filter } from "lucide-react";

export type AppliedFilter = {
  /** URL params this chip owns — removing the chip deletes all of them. */
  params: string[];
  label: string;
  value: string;
};

export function AppliedFilterChips({
  periodLabel,
  comparisonLabel,
  filters,
  lastRefreshed,
  resetHref,
  showReset,
}: {
  /** Always shown, never removable. */
  periodLabel: string;
  /** The previous corresponding period the deltas are measured against. */
  comparisonLabel?: string;
  filters: AppliedFilter[];
  /** ISO string — rendered as a local time so "is this stale?" is answerable. */
  lastRefreshed?: string;
  /**
   * Where Reset goes. Defaults to the bare path, which is right for the firm
   * cockpit and WRONG for a scoped view: it would strip `?scope=branch` and
   * drop the reader on a different dashboard.
   */
  resetHref?: string;
  /** Offer Reset even with no removable chip — e.g. a non-default period. */
  showReset?: boolean;
}) {
  const { pending, go } = useDashboardNav();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function drop(params: string[]) {
    const next = new URLSearchParams(searchParams.toString());
    params.forEach((k) => next.delete(k));
    const qs = next.toString();
    go(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  function reset() {
    go(resetHref ?? pathname);
  }

  const hasFilters = filters.length > 0 || !!showReset;

  // Nothing narrowing the numbers: say nothing. The period is already on the
  // period picker and the refresh time on the dashboard header, so a
  // permanent "Showing September 2026 vs 01 Aug – 29 Aug 26" line only
  // repeated them. The receipt appears the moment a filter or a non-default
  // period is set, which is when it has something to say.
  const quiet = !hasFilters;

  // Format the timestamp AFTER mount, never during SSR.
  //
  // The server formats with Node's ICU in the SERVER's timezone; the browser
  // then re-formats with its own. The two disagree often enough to throw a
  // hydration mismatch (thin spaces and am/pm casing differ between builds),
  // and even when they agree the director is shown the server's clock rather
  // than their own. Rendering it client-side fixes both.
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!lastRefreshed) return;
    setRefreshedAt(
      new Date(lastRefreshed).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }, [lastRefreshed]);

  // After every hook, so the hook order never changes between renders.
  if (quiet) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs ${pending ? "opacity-60" : ""}`}
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Filter className="size-3.5" aria-hidden />
        Showing
      </span>

      <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 font-semibold text-secondary-foreground">
        {periodLabel}
      </span>

      {comparisonLabel && (
        <span className="text-muted-foreground">
          vs <span className="font-medium text-foreground">{comparisonLabel}</span>
        </span>
      )}

      {filters.map((f) => (
        <span
          key={f.params.join("|")}
          className="inline-flex items-center gap-1 rounded-full bg-accent pl-2.5 pr-1 py-0.5 font-medium text-accent-foreground"
        >
          <span className="text-muted-foreground font-normal">{f.label}:</span>
          {f.value}
          <button
            type="button"
            onClick={() => drop(f.params)}
            aria-label={`Remove ${f.label} filter`}
            className="grid size-4 place-items-center rounded-full hover:bg-foreground/10"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      {hasFilters && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset
        </button>
      )}

      {lastRefreshed && (
        <span className="ml-auto text-muted-foreground tabular-nums">
          {/* `suppressHydrationWarning` because this span is INTENTIONALLY
              empty on the server and filled on the client. */}
          <span suppressHydrationWarning>
            {refreshedAt ? (
              <>
                Last refreshed <time dateTime={lastRefreshed}>{refreshedAt}</time>
              </>
            ) : null}
          </span>
        </span>
      )}
    </div>
  );
}
