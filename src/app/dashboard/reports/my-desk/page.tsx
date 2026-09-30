/**
 * /dashboard/reports/my-desk → the Relationship Manager Dashboard. The RM
 * desk lives in Dashboard now (a role dashboard picked from the dropdown);
 * this address is kept for old links and bookmarks, with their query string.
 */

import { requireSession } from "@/lib/auth/session";
import { openSystemDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export default async function MyDeskRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return openSystemDashboard(await requireSession(), "rm", await searchParams);
}
