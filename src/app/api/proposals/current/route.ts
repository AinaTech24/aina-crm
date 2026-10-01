import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/proposals/current?leadId= | investorId=  → { proposal | null }
 *
 * The proposal a lead's or client's journey is on right now: the latest one
 * that hasn't been replaced by a newer version. Feeds the journey card, so the
 * RM sees what the client did without opening the Proposals module.
 *
 * Same visibility as the rest of the proposal API: managers see any proposal,
 * everyone else the ones they prepared.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { proposals } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    const leadId = req.nextUrl.searchParams.get("leadId");
    const investorId = req.nextUrl.searchParams.get("investorId");
    const subject = leadId && UUID.test(leadId) ? eq(proposals.leadId, leadId) : investorId && UUID.test(investorId) ? eq(proposals.investorId, investorId) : null;
    if (!subject) return NextResponse.json({ error: "leadId or investorId required" }, { status: 400 });

    const row = await withTenant(session.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.tenantId, session.tenantId),
            subject,
            ne(proposals.status, "superseded"),
            seesAll ? undefined : eq(proposals.preparedByUserId, session.userId)
          )
        )
        .orderBy(desc(proposals.createdAt))
        .limit(1);
      return p ?? null;
    });
    return NextResponse.json({ proposal: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
