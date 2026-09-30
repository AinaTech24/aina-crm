/**
 * /dashboard/reports/practice-health → the Owner Dashboard. SIP health, AUM
 * mix, client mix and automation are cards on the Owner Dashboard now; this
 * address is kept for old links and bookmarks.
 */

import { requireSession } from "@/lib/auth/session";
import { openSystemDashboard } from "@/lib/dashboards/open-system";

export const dynamic = "force-dynamic";

export default async function PracticeHealthRedirect() {
  return openSystemDashboard(await requireSession(), "owner", {});
}
