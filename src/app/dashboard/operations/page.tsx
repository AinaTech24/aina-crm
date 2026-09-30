/**
 * /dashboard/operations → the Operations Dashboard. WORK › Operations in the
 * sidebar points here, and so do older links; the operations team's pending
 * work lives in Dashboard (a role dashboard picked from the dropdown). The
 * query string is kept — the dashboard translates the old period keys.
 */

import { requireSession } from "@/lib/auth/session";
import { openSystemDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export default async function OperationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return openSystemDashboard(await requireSession(), "operations", await searchParams);
}
