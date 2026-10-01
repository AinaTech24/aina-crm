/**
 * POST /api/opportunities/[id]/advance
 *   {}                                         → the next step of the product's path
 *   { to: "lost", lostReason, revisitOn? }     → close as lost (revisit date → a follow-up task)
 *   { remarks? }                               → kept on the stage history
 *
 * 409 with `blocked` when a compliance gate is not met (risk profile, needs
 * analysis, KYC / UCC / mandate) — the checklist says what to do.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { advanceOpportunity, listOpportunities } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

const Body = z.object({
  to: z.string().max(40).optional(),
  remarks: z.string().max(1000).optional(),
  lostReason: z.string().max(500).optional(),
  revisitOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
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
      const r = await advanceOpportunity(tx, { tenantId: session.tenantId, userId: session.userId }, id, parsed.data);
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { r, view };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    if (!out.r.ok) {
      return NextResponse.json({ error: out.r.error, blocked: out.r.blocked ?? null, opportunity: out.view }, { status: out.r.status });
    }
    return NextResponse.json({ ok: true, stage: out.r.stage, skipped: out.r.skipped, opportunity: out.view });
  } catch (err) {
    return handleApiError(err);
  }
}
