import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/share-tokens
 *   Body: { kind, subjectType, subjectId, payload?, expiresInDays? }
 *   Returns: { token, url, expiresAt }   ← token is plaintext, ONE TIME.
 *
 * RM uses this to mint risk-profile / docs / proposal-approval / onboarding-progress public links.
 * Also moves the journey forward where the link means a real step: a
 * document link → Documents Pending, a proposal link → Proposal Sent. A risk
 * profile link moves nothing (the SOP has no such stage). Automatic, so
 * forward-only (lib/blueprints/journey-rules.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { createShareToken } from "@/lib/share-tokens";
import { autoAdvance, resolveLeadIdForInvestor, type BlueprintEvent } from "@/lib/blueprints/auto-advance";
import { eq } from "drizzle-orm";
import { proposals } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["risk_profile", "document_collection", "proposal_approval", "onboarding_progress"]),
  subjectType: z.enum(["lead", "investor", "proposal"]),
  subjectId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

/** Share-token kind → the journey event it is. Every key is a real SOP stage
 *  through EVENT_TO_STAGE (tests/journey-forward-only.test.ts). */
const KIND_TO_EVENT: Record<string, BlueprintEvent> = {
  risk_profile: "risk_profile.sent",
  document_collection: "docs.requested",
  proposal_approval: "proposal.sent",
};

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.assigned", session.permissions);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const res = await createShareToken({
      tenantId: session.tenantId,
      kind: parsed.data.kind,
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
      payload: parsed.data.payload,
      expiresInDays: parsed.data.expiresInDays,
      createdBy: session.userId,
    });

    // Move the journey for the link just shared — to the lead's own journey,
    // or the journey of the lead a client was converted from.
    const event = KIND_TO_EVENT[parsed.data.kind];
    if (event) {
      await withTenant(session.tenantId, async (tx) => {
        let leadId: string | null = null;
        if (parsed.data.subjectType === "lead") {
          leadId = parsed.data.subjectId;
        } else if (parsed.data.subjectType === "investor") {
          leadId = await resolveLeadIdForInvestor(tx, parsed.data.subjectId);
        } else if (parsed.data.subjectType === "proposal") {
          // For proposal_approval the subjectId is the proposal id.
          const [p] = await tx.select().from(proposals).where(eq(proposals.id, parsed.data.subjectId));
          leadId = (p as any)?.leadId ?? ((p as any)?.investorId ? await resolveLeadIdForInvestor(tx, (p as any).investorId) : null);
        }
        if (!leadId) return;
        await autoAdvance(tx, session.tenantId, leadId, event, {
          remarks: `Shared ${parsed.data.kind.replace(/_/g, " ")} link with client.`,
        });
      });
    }

    return NextResponse.json(res, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
