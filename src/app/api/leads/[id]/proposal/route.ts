import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/leads/[id]/proposal — the lead's current proposal, if any.
 *
 * Drives the lead journey's proposal buttons: Meeting Done offers "Create
 * Proposal" until one exists, then "Send Proposal" while it is a draft; at
 * Proposal Sent, "Proposal Approved" marks THIS proposal accepted (which makes
 * the lead Won and starts onboarding — lib/proposals/journey.ts).
 *
 * Current = the newest version that is not superseded and not deleted.
 * A viewer without proposal.view gets null rather than a link they can't open.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, ne, or, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { proposals } from "@/db/schema";
import { loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const proposal = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      if (!can(session.roles, "proposal.view", session.permissions)) return null;
      const [p] = await tx
        .select({
          id: proposals.id,
          number: proposals.proposalNumber,
          status: proposals.status,
          version: proposals.version,
        })
        .from(proposals)
        .where(
          and(
            eq(proposals.leadId, id),
            ne(proposals.status, "superseded" as any),
            // DELETE soft-deletes as rejected + reason 'deleted'.
            or(isNull(proposals.rejectionReason), sql`${proposals.rejectionReason} <> 'deleted'`),
          ),
        )
        .orderBy(desc(proposals.createdAt))
        .limit(1);
      return p ?? null;
    });
    return NextResponse.json({ proposal });
  } catch (err: any) {
    return handleApiError(err);
  }
}
