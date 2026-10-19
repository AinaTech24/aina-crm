/**
 * POST /api/opportunities/[id]/transaction-review
 *   { decision: "approve", remarks? }   → client won; a "client won" task is created
 *   { decision: "reject", remarks }     → back to "Transaction placed"; reason required
 *
 * Only valid while the opportunity stands at "Approve / reject transaction".
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { decideTransaction, listOpportunities } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  remarks: z.string().max(1000).optional(),
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
      await loadViewableOpportunity(tx, session, id);
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
