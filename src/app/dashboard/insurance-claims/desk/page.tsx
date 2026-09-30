/**
 * /dashboard/insurance-claims/desk → the Claims Dashboard. The claims queue
 * lives in Dashboard now (a role dashboard picked from the dropdown); this
 * address is kept for old links and bookmarks, with their query string.
 */

import { requireSession } from "@/lib/auth/session";
import { openSystemDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export default async function ClaimsDeskRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return openSystemDashboard(await requireSession(), "claims", await searchParams);
}
