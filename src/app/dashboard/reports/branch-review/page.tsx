/**
 * /dashboard/reports/branch-review → the Branch Head Dashboard. The branch
 * view lives in Dashboard now (a role dashboard picked from the dropdown);
 * this address is kept for old links and bookmarks, with their query string.
 */

import { requireSession } from "@/lib/auth/session";
import { openSystemDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export default async function BranchReviewRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return openSystemDashboard(await requireSession(), "branch_head", await searchParams);
}
