import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-proposal endpoints.
 *   GET    /api/proposals/[id]
 *   PATCH  /api/proposals/[id]
 *   DELETE /api/proposals/[id]   (soft = status='rejected', rejection_reason='deleted')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { proposals } from "@/db/schema";
import { proposalTotals } from "@/lib/proposals/projections";
import { advanceJourneyForProposal, startOnboarding, currentStage, journeyLeadId, notifyOpportunity } from "@/lib/proposals/journey";
import { proposalOwnerId } from "@/lib/proposals/public-link";
import { loadViewableProposal } from "@/lib/proposals/access";

/**
 * Fields that ARE the proposal's content. Once it has been sent these are
 * frozen: the sent version is the record of exactly what the client saw (and
 * may have approved), so a change goes into a new version — Revise — instead
 * of being written over the top. Status, validity and suitability notes stay
 * editable; they describe the proposal's life, not its content.
 */
const CONTENT_FIELDS = ["title", "summary", "coverLetter", "disclaimer", "type", "products", "totalInvestment", "expectedCorpus", "riskRating", "attachments"] as const;
const EDITABLE_STATUSES = ["draft", "ready"];

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    title: z.string().min(2).max(200).optional(),
    summary: z.string().max(1000).optional(),
    coverLetter: z.string().max(4000).optional(),
    disclaimer: z.string().max(2000).optional(),
    type: z
      .enum(["comprehensive", "mutual_fund", "insurance", "pms", "aif", "mixed"])
      .optional(),
    products: z.array(z.any()).optional(),
    totalInvestment: z.number().optional(),
    expectedCorpus: z.number().optional(),
    riskRating: z.enum(["conservative", "moderate", "aggressive", "mixed"]).optional(),
    // `superseded` is set only by Revise; an RM can record a client's change
    // request taken by phone as `changes_requested`.
    status: z
      .enum(["draft", "ready", "sent", "viewed", "accepted", "partially_approved", "rejected", "expired", "executed", "changes_requested"])
      .optional(),
    validUntil: z.string().optional(),
    rejectionReason: z.string().max(500).optional(),
    attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
    suitabilityNote: z.string().max(2000).nullable().optional(),
    suitabilityOverrideReason: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    // Own-proposals rule + the recipient's scope (404 when not visible).
    const row = await withTenant(session.tenantId, async (tx) => loadViewableProposal(tx, session, id));
    // Non-managers only see proposals they prepared (mirrors the collection GET).
    if (!row || (!seesAll && row.preparedByUserId !== session.userId)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);
    // Same rule as GET: managers edit any proposal, everyone else their own.
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    // Filled inside the transaction, acted on after it commits.
    const journey: { onboard: null | { ownerId: string | null; leadId: string | null; stage: string | null } } = { onboard: null };
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = await loadViewableProposal(tx, session, id);
      if (!before) return null;
      if (!seesAll && before.preparedByUserId !== session.userId) return null;
      if (before.status === "superseded") {
        throw Object.assign(new Error("This is an older version — a newer one replaced it. Open the latest version instead."), { status: 409 });
      }
      const changesContent = CONTENT_FIELDS.some((f) => (parse.data as any)[f] !== undefined);
      if (changesContent && !EDITABLE_STATUSES.includes(before.status)) {
        throw Object.assign(
          new Error(`This proposal has been sent, so it is kept as the client saw it. Revise it to create version ${(before.version ?? 1) + 1}.`),
          { status: 409 }
        );
      }

      const patch: any = { ...parse.data, updatedAt: new Date() };

      // Stamp status-transition timestamps when status flips
      if (patch.status && patch.status !== before.status) {
        const now = new Date();
        if (patch.status === "sent" && !before.sentAt) patch.sentAt = now;
        if (patch.status === "viewed" && !before.viewedAt) patch.viewedAt = now;
        if ((patch.status === "accepted" || patch.status === "partially_approved") && !before.acceptedAt) patch.acceptedAt = now;
        // Marked accepted in the CRM (in person, by phone): all lines unless
        // the client already chose some through their link.
        if (patch.status === "accepted" && !before.acceptedItems) {
          patch.acceptedItems = (Array.isArray(before.products) ? before.products : []).map((_: unknown, i: number) => i);
        }
        if (patch.status === "rejected" && !before.rejectedAt) patch.rejectedAt = now;
      }

      // Coerce dates / numerics for storage
      if (patch.validUntil) patch.validUntil = new Date(patch.validUntil);

      // If products are updated, compute the new totals.
      if (patch.products) {
        const totals = proposalTotals(patch.products);
        patch.totalInvestment = totals.totalInvestment != null ? String(totals.totalInvestment) : null;
        patch.expectedCorpus = totals.expectedCorpus != null ? String(totals.expectedCorpus) : null;
      } else {
        if (patch.totalInvestment != null) patch.totalInvestment = String(patch.totalInvestment);
        if (patch.expectedCorpus != null) patch.expectedCorpus = String(patch.expectedCorpus);
      }

      const r = await tx
        .update(proposals)
        .set(patch)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)))
        .returning();

      // Spec 13: sharing a proposal raises a follow-up for its owner. Only on
      // the FIRST share (before.sentAt unset) — the helper is idempotent too,
      // so a resend can't stack duplicates. Never fatal: failing to raise a
      // reminder must not fail the status change the user actually asked for.
      if (patch.status === "sent" && before.status !== "sent" && !before.sentAt) {
        try {
          const { createProposalSharedTask } = await import("@/lib/proposals/shared-task");
          await createProposalSharedTask(tx, {
            tenantId: session.tenantId,
            proposalId: id,
            proposalNumber: before.proposalNumber,
            investorId: before.investorId,
            leadId: before.leadId,
            preparedByUserId: (before as any).preparedByUserId,
            actorUserId: session.userId,
            proposalCreatedAt: (before as any).createdAt,
          });
        } catch (e) {
          console.warn("[proposals] shared follow-up task skipped:", (e as Error)?.message);
        }
      }

      // ── The journey moves the same way whoever records the step ──────
      // A proposal marked sent or accepted here (given in person, accepted
      // over the phone) used to move nothing; only the client's own link did.
      if (patch.status && patch.status !== before.status) {
        const after = { ...before, ...patch };
        if (patch.status === "sent") {
          await advanceJourneyForProposal(tx, after, "proposal.sent", `Proposal ${before.proposalNumber} marked sent.`, session.userId);
        } else if (patch.status === "accepted" || patch.status === "partially_approved") {
          const leadId = await advanceJourneyForProposal(tx, after, "proposal.accepted", `Proposal ${before.proposalNumber} marked ${patch.status === "accepted" ? "accepted" : "partly accepted"} by ${session.userId === before.preparedByUserId ? "its RM" : "a colleague"}.`, session.userId);
          journey.onboard = {
            ownerId: (await proposalOwnerId(tx, after)) ?? session.userId,
            leadId: leadId ?? (await journeyLeadId(tx, after)),
            stage: leadId ? await currentStage(tx, leadId) : null,
          };
        } else if (patch.status === "rejected") {
          // A decline (not the client's "ask for a change", which is
          // changes_requested): the opportunity's owner gets a revise-or-close task.
          await notifyOpportunity(tx, session.tenantId, id, "declined", session.userId);
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.update",
        entityType: "proposal",
        entityId: id,
        before: { status: before.status, title: before.title } as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Acceptance starts a lead's onboarding — after the commit, because it
    // sends email and WhatsApp (see lib/proposals/journey.ts startOnboarding).
    if (journey.onboard) {
      await startOnboarding(session.tenantId, result as any, journey.onboard).catch((e) =>
        console.error("[proposals] onboarding start failed:", e?.message ?? e)
      );
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const found = await withTenant(session.tenantId, async (tx) => {
      // Same rule as GET / PATCH: only a proposal the caller may see — their
      // own unless they see all, and its client / lead / family in scope.
      const before = await loadViewableProposal(tx, session, id);
      if (!before) return false;
      await tx
        .update(proposals)
        .set({
          status: "rejected",
          rejectionReason: before.rejectionReason ?? "deleted",
          rejectedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.delete",
        entityType: "proposal",
        entityId: id,
        before: { proposalNumber: before.proposalNumber, status: before.status },
        ...clientMeta,
      });
      return true;
    });
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
