/**
 * POST /api/opportunities/[id]/manage — a supervisor undoes a journey move.
 *   { action: "back", reason }     the open journey goes back one step
 *   { action: "reopen", reason }   a won / lost opportunity opens again at the
 *                                   step it closed from
 *
 * Needs the opportunity.reopen capability (branch heads by default, the firm
 * owner implicitly; grantable) and a client the viewer can see. Both are
 * audited (opportunity.moved_back / opportunity.reopened) with the reason,
 * which also goes on the stage history. lib/opportunities/journey.ts does the work.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity } from "@/lib/opportunities/access";
import { listOpportunities, moveOpportunityBack, reopenOpportunity, REOPEN_CAP } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["back", "reopen"]),
  reason: z.string().trim().min(1, "Say why").max(500),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!can(session.roles, REOPEN_CAP, session.permissions)) {
      return NextResponse.json({ error: "Only an owner or branch head can move an opportunity back or reopen it." }, { status: 403 });
    }
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const actor = { tenantId: session.tenantId, userId: session.userId };
    const out = await withTenant(session.tenantId, async (tx) => {
      await loadViewableOpportunity(tx, session, id);
      const r = parsed.data.action === "back"
        ? await moveOpportunityBack(tx, actor, id, parsed.data.reason)
        : await reopenOpportunity(tx, actor, id, parsed.data.reason);
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { r, view };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    if (!out.r.ok) return NextResponse.json({ error: out.r.error, opportunity: out.view }, { status: out.r.status });
    return NextResponse.json({ ok: true, stage: out.r.stage, opportunity: out.view });
  } catch (err) {
    return handleApiError(err);
  }
}
