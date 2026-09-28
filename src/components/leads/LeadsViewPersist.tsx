"use client";

/**
 * Remembers the Leads view (kanban / list).
 *
 * With no `view` in the URL the page renders the saved choice, or — when there
 * is none — List for more than 30 leads and Kanban otherwise. The toggle links
 * always carry an explicit `?view=`; this records it in a cookie the server
 * reads next time, so the sidebar's param-less "Leads" link opens the view the
 * user last chose, with no redirect and no flash of the other one.
 *
 * It used to keep the choice in localStorage and bounce to ?view=table after
 * load. A choice saved that way is carried over once, then the old key goes.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LEADS_VIEW_COOKIE, parseLeadsView } from "@/lib/leads/view-pref";

const LEGACY_KEY = "leads:view";
const ONE_YEAR = 60 * 60 * 24 * 365;

function saveCookie(view: string) {
  document.cookie = `${LEADS_VIEW_COOKIE}=${view}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function LeadsViewPersist({ explicitView }: { explicitView: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const explicit = parseLeadsView(explicitView);
    if (explicit) {
      saveCookie(explicit);
      return;
    }
    const hasCookie = document.cookie.split("; ").some((c) => c.startsWith(`${LEADS_VIEW_COOKIE}=`));
    if (hasCookie) return;
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* storage unavailable (private mode) — nothing to carry over */
    }
    const saved = parseLeadsView(legacy);
    if (saved) {
      saveCookie(saved);
      router.replace(`/dashboard/leads?view=${saved}`);
    }
  }, [explicitView, router]);
  return null;
}
