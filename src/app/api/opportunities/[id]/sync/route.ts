/**
 * POST /api/opportunities/[id]/sync — re-check the journey against what is on
 * file now (a proposal sent, KYC verified, a transaction or policy recorded
 * since) and move past every stage that is already done.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { listOpportunities, syncOpportunity } from "@/lib/opportunities/journey";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await withTenant(session.tenantId, async (tx) => {
      await loadViewableOpportunity(tx, session, id);
      const r = await syncOpportunity(tx, { tenantId: session.tenantId, userId: session.userId }, id);
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { skipped: r?.skipped ?? [], view };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    return NextResponse.json({ ok: true, skipped: out.skipped, opportunity: out.view });
  } catch (err) {
    return handleApiError(err);
  }
}
