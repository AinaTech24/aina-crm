"use client";

/**
 * One "updating" state per dashboard — the fix for "I apply a filter and
 * nothing changes".
 *
 * Changing a filter re-renders the dashboard on the server. Until the new
 * figures arrive React keeps the old page on screen — two to ten seconds on a
 * busy dev server — so a click looked ignored. Every control that changes a
 * dashboard's URL (the filter bar, the full dashboards' branch / RM pickers,
 * period menus, client filters and chips) navigates through
 * `useDashboardNav().go`; while that is in flight the dashboard dims
 * (`DashboardBody`) and the header says "Updating…" (`DashboardStatus`).
 */

import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type Nav = { pending: boolean; go: (href: string) => void };

const NavContext = createContext<Nav | null>(null);

export function DashboardNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = useCallback((href: string) => start(() => router.push(href, { scroll: false })), [router]);
  const value = useMemo(() => ({ pending, go }), [pending, go]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** Navigate inside a dashboard so the whole page shows it is updating; outside one, a plain push. */
export function useDashboardNav(): Nav {
  const ctx = useContext(NavContext);
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = useCallback((href: string) => start(() => router.push(href, { scroll: false })), [router]);
  return ctx ?? { pending, go };
}

/** The dashboard's content: dimmed, and not clickable twice, while a change loads. */
export function DashboardBody({ children }: { children: ReactNode }) {
  const pending = !!useContext(NavContext)?.pending;
  return (
    <div aria-busy={pending} className={cn("space-y-4 transition-opacity duration-150", pending && "pointer-events-none opacity-50")}>
      {children}
    </div>
  );
}

/** "Updated 9:21 AM" — or "Updating…" while a change loads. */
export function DashboardStatus({ updated }: { updated: string }) {
  const pending = !!useContext(NavContext)?.pending;
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {pending ? <span className="font-medium text-primary">Updating…</span> : <>Updated {updated}</>}
    </p>
  );
}
