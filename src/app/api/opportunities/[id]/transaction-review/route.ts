/**
 * POST /api/opportunities/[id]/transaction-review
 *   { decision: "approve", remarks?, assigneeId?, dueOn? }
 *                                       → moves to "RTA data check"; a task is created to check the RTA data,
 *                                         for assigneeId (default the opportunity's owner), due dueOn (YYYY-MM-DD)
 *   { decision: "reject", remarks }     → back to "Transaction placed"; reason required
 *
 * Only valid while the opportunity stands at "Approve / reject transaction".
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { assertAssignable } from "@/lib/opportunities/assignees";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { decideTransaction, listOpportunities } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  remarks: z.string().max(1000).optional(),
  assigneeId: z.string().uuid().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      const opp = await loadViewableOpportunity(tx, session, id);
      if (parsed.data.decision === "approve" && parsed.data.assigneeId) {
        await assertAssignable(tx, session, opp.investorId, parsed.data.assigneeId);
      }
      const r = await decideTransaction(tx, { tenantId: session.tenantId, userId: session.userId }, id, parsed.data);
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { r, view };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    if (!out.r.ok) return NextResponse.json({ error: out.r.error, opportunity: out.view }, { status: out.r.status });
    return NextResponse.json({ ok: true, stage: out.r.stage, opportunity: out.view });
  } catch (err) {
    return handleApiError(err);
  }
}
