import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/subjects — the investor / lead / family lists the
 * Schedule-Meeting form needs for its subject pickers. Same query the
 * /dashboard/review-meetings/new page runs server-side, exposed so the
 * meeting form can be opened in a modal (e.g. from the lead blueprint) without
 * navigating away.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAny } from "@/lib/auth/rbac";
import { loadMeetingSubjects } from "@/lib/review-meetings/scope";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();

    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);

    // Fast path: when the form is locked to one preselected subject (e.g. the
    // lead-blueprint modal), fetch ONLY that row — skip the 300×3 lists so the
    // popup opens instantly. Every list goes through the viewer's client /
    // lead scope (lib/review-meetings/scope.ts).
    const leadId = req.nextUrl.searchParams.get("leadId");
    const investorId = req.nextUrl.searchParams.get("investorId");
    const only = leadId && UUID.test(leadId) ? { leadId }
      : investorId && UUID.test(investorId) ? { investorId } : undefined;
    const data = await withTenant(session.tenantId, (tx) => loadMeetingSubjects(tx, session, { only }));
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
