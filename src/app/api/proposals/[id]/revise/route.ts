import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/proposals/[id]/revise → { id, version }
 *
 * Changes to a SENT proposal go into a new version, never over the top. The
 * sent version is the record of exactly what the client was shown — and
 * possibly approved — and an inspector asks for that record. Editing in place
 * destroyed it.
 *
 * The new version is a draft copy with the same proposal number and version
 * N+1, fresh validity, and a link back to the version it revises. The old one
 * becomes `superseded`, and any approval link still open on it is withdrawn, so
 * the client can't accept a version the RM has replaced. A change request the
 * new version answers has its task closed.
 *
 * An accepted (even partly) or executed proposal is not revised: its
 * acceptance is evidence. Make a new proposal for anything further.
 *
 * Idempotent: revising a version that already has a successor returns that
 * successor rather than forking a second one.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { proposals, shareTokens, tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

const REVISABLE = ["sent", "viewed", "changes_requested", "rejected", "expired"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [old] = await tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)))
        .for("update")
        .limit(1);
      if (!old || (!seesAll && old.preparedByUserId !== session.userId)) {
        throw Object.assign(new Error("not found"), { status: 404 });
      }
      if (old.supersededById) {
        const [next] = await tx.select({ id: proposals.id, version: proposals.version }).from(proposals).where(eq(proposals.id, old.supersededById)).limit(1);
        if (next) return { id: next.id, version: next.version, existing: true };
      }
      if (old.status === "draft" || old.status === "ready") {
        throw Object.assign(new Error("This proposal hasn't been sent yet — edit it directly."), { status: 409 });
      }
      if (!REVISABLE.includes(old.status)) {
        throw Object.assign(
          new Error(`A ${old.status.replace(/_/g, " ")} proposal is kept as the record of what the client agreed. Create a new proposal instead.`),
          { status: 409 }
        );
      }

      const now = new Date();
      const newId = uuid();
      const validUntil = new Date(now);
      validUntil.setDate(validUntil.getDate() + 30);
      const version = (old.version ?? 1) + 1;

      await tx.insert(proposals).values({
        id: newId,
        tenantId: session.tenantId,
        branchId: old.branchId,
        proposalNumber: old.proposalNumber,
        recipientType: old.recipientType,
        investorId: old.investorId,
        leadId: old.leadId,
        familyId: old.familyId,
        recipientName: old.recipientName,
        recipientEmail: old.recipientEmail,
        recipientPhone: old.recipientPhone,
        type: old.type,
        title: old.title,
        summary: old.summary,
        coverLetter: old.coverLetter,
        disclaimer: old.disclaimer,
        products: old.products,
        totalInvestment: old.totalInvestment,
        expectedCorpus: old.expectedCorpus,
        riskRating: old.riskRating,
        attachments: old.attachments,
        suitabilityNote: old.suitabilityNote,
        suitabilityOverrideReason: old.suitabilityOverrideReason,
        // The RM who owns the client keeps owning it, even if a manager revises.
        preparedByUserId: old.preparedByUserId ?? session.userId,
        preparedAt: now,
        status: "draft",
        validUntil,
        version,
        parentProposalId: old.id,
      } as any);

      await tx
        .update(proposals)
        .set({ status: "superseded" as any, supersededById: newId, updatedAt: now } as any)
        .where(eq(proposals.id, old.id));

      // The client must not be able to accept a version the RM has replaced.
      await tx
        .update(shareTokens)
        .set({ revokedAt: now } as any)
        .where(
          and(
            eq(shareTokens.kind, "proposal_approval" as any),
            eq(shareTokens.subjectId, old.id),
            isNull(shareTokens.usedAt),
            isNull(shareTokens.revokedAt)
          )
        );

      // A change request this version answers is done.
      await tx
        .update(tasks)
        .set({ status: "completed" as any, completedAt: now, updatedAt: now } as any)
        .where(
          and(
            eq(tasks.tenantId, session.tenantId),
            sql`${tasks.meta}->>'proposalId' = ${old.id}`,
            sql`${tasks.meta}->>'proposalEvent' = 'change_requested'`,
            sql`${tasks.status} NOT IN ('completed', 'cancelled')`
          )
        );

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.revise",
        entityType: "proposal",
        entityId: newId,
        before: { proposalId: old.id, version: old.version, status: old.status } as any,
        after: { proposalId: newId, version, proposalNumber: old.proposalNumber } as any,
        ...meta,
      });

      return { id: newId, version, existing: false };
    });

    return NextResponse.json(out, { status: out.existing ? 200 : 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
