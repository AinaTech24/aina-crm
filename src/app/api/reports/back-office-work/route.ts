/**
 * GET /api/reports/back-office-work?branch=<uuid>&period=YYYY-MM
 *   → { branches, report } — back-office rectification work (Online/Offline ×
 *     Value/No) per particular for a branch.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadBackOfficeWork } from "@/lib/service/back-office-work";
import { listBranches } from "@/lib/business/rm-matrix";
import { reportBranchLock } from "@/lib/reports/scope";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-\d{2}$/;

function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const raw = req.nextUrl.searchParams.get("period") ?? "";
    const period = PERIOD_RE.test(raw) ? raw : defaultPeriod();
    const branchParam = req.nextUrl.searchParams.get("branch") ?? "";

    const data = await withTenant(session.tenantId, async (tx) => {
      // A branch-locked head sees only their own branch (lib/reports/scope.ts).
      const lock = reportBranchLock(session);
      const branchList = (await listBranches(tx)).filter((b) => !lock || b.id === lock);
      if (branchList.length === 0) return { branches: [], report: null };
      const branchId = branchParam && branchList.some((b) => b.id === branchParam) ? branchParam : branchList[0].id;
      const report = await loadBackOfficeWork(tx, branchId, period);
      return { branches: branchList, report };
    });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
