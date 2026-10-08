"use client";

/**
 * AutoRefresh — drop into any server-component page to make it self-update
 * without a manual reload. Calls router.refresh() on an interval (which re-runs
 * the server component and streams fresh data in), and also refreshes when the
 * tab regains focus if the last refresh is at least an interval old. Polling pauses while the tab is hidden so we
 * don't hammer the DB for background tabs.
 *
 * Used for near-realtime "live" panels (e.g. the super-admin tenant list updates
 * as new workspaces are created). Keep the interval generous on heavy pages.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const every = Math.max(4000, intervalMs);
    // A refresh re-renders the whole page on the server (a role dashboard is
    // ~30 loaders), so coming back to the tab refreshes only when the last one
    // is at least an interval old — alt-tabbing back and forth used to cost a
    // full dashboard render every time.
    let last = Date.now();
    const refresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      last = Date.now();
      router.refresh();
    };
    const id = setInterval(refresh, every);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= every) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
