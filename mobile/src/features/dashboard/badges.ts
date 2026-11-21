/**
 * Tab-bar counts — the server's own numbers, never a count of a loaded page:
 *
 *  - Work: overdue tasks in the viewer's scope — GET /api/tasks/kpis → overdue
 *    (the same endpoint and scope as the Tasks list's stats ribbon).
 *  - Leads: leads with a follow-up due today — GET /api/leads?followup_today=1
 *    → total (the Leads list's own "Follow-up today" quick filter; limit=1, as
 *    only the total is read).
 *
 * Each is asked only when the viewer holds the capability its route checks, so
 * a role without leads never fires a 403. Refreshed every few minutes, when the
 * app comes back to the foreground and (when stale) as the user switches tabs.
 * `null` = not known (no capability, not loaded yet, or the request failed):
 * the tab shows no badge rather than a guessed or zero count.
 */

import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useMe, hasAnyCap } from "../../api/me";

const EVERY_MS = 3 * 60_000;
/** A tab switch refetches only when the count is older than this. */
const STALE_MS = 60_000;
/** A count restored from the phone's saved copy (or kept while offline) older
 *  than this is no longer shown — yesterday's overdue figure is not today's. */
const SHOW_MAX_AGE_MS = 30 * 60_000;

function count(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function useTabBadges(): { work: number | null; leads: number | null; refresh: () => void } {
  const caps = useMe().data?.capabilities;
  const canTasks = hasAnyCap(caps, ["task.view.all", "task.view.assigned"]);
  const canLeads = hasAnyCap(caps, ["lead.view.all", "lead.view.assigned"]);

  // Same key family as the Tasks list's ribbon, so a task completed anywhere
  // (which invalidates ["task-kpis"]) moves the badge too.
  const work = useQuery({
    queryKey: ["task-kpis", {}],
    enabled: canTasks,
    queryFn: () => api.get<{ overdue?: number }>("/api/tasks/kpis"),
    staleTime: STALE_MS,
    refetchInterval: EVERY_MS,
  });
  // Under ["leads"], so any lead save (which invalidates ["leads"]) refreshes it.
  const leads = useQuery({
    queryKey: ["leads", "badge", "followup_today"],
    enabled: canLeads,
    queryFn: () => api.get<{ total?: number }>("/api/leads", { followup_today: "1", limit: 1 }),
    staleTime: STALE_MS,
    refetchInterval: EVERY_MS,
  });

  const { refetch: refetchWork, dataUpdatedAt: workAt } = work;
  const { refetch: refetchLeads, dataUpdatedAt: leadsAt } = leads;
  const refresh = useCallback(() => {
    const now = Date.now();
    if (canTasks && now - workAt > STALE_MS) refetchWork();
    if (canLeads && now - leadsAt > STALE_MS) refetchLeads();
  }, [canTasks, canLeads, workAt, leadsAt, refetchWork, refetchLeads]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const fresh = (at: number) => at > 0 && Date.now() - at < SHOW_MAX_AGE_MS;
  return {
    work: canTasks && !work.isError && fresh(workAt) ? count(work.data?.overdue) : null,
    leads: canLeads && !leads.isError && fresh(leadsAt) ? count(leads.data?.total) : null,
    refresh,
  };
}

/** What a tab badge shows: nothing for 0 / unknown, "99+" past 99. */
export function badgeLabel(n: number | null): string | undefined {
  if (n == null || n <= 0) return undefined;
  return n > 99 ? "99+" : String(n);
}
