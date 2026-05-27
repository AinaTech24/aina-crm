/**
 * POST /api/leads/[id]/blueprint/sync
 *
 * Reconciles a lead's blueprint stage with its actual journey artefacts.
 * Looks at: risk_profile_responses, proposals + proposal_approvals,
 * compliance_documents (KYC type), and the lead's converted_investor_id —
 * then advances the blueprint instance to the furthest stage that's
 * actually been reached.
 *
 * This is the recovery path for leads created BEFORE the share-token /
 * public-form flows started transitioning the blueprint automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  leads,
  riskProfileResponses,
  proposals,
  proposalApprovals,
  complianceDocuments,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.all");
    const { id } = await params;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, id));
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });

      // 1. Already converted?
      if (lead.convertedInvestorId) {
        await transitionTo(tx, session.tenantId, id, "active_client", {
          systemBypass: true,
          remarks: "Backfill — lead already converted to client.",
        });
        return { advancedTo: "active_client", reason: "Lead already converted" };
      }

      // 2. Documents on file?
      const docs = await tx
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.relatedEntityType, "lead"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        );
      if (docs.length > 0) {
        await transitionTo(tx, session.tenantId, id, "docs_received", {
          systemBypass: true,
          remarks: `Backfill — ${docs.length} KYC doc(s) on file.`,
        });
        return { advancedTo: "docs_received", reason: `${docs.length} document(s) on file` };
      }

      // 3. Proposal approved?
      const [leadProposal] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.leadId, id))
        .orderBy(desc(proposals.createdAt))
        .limit(1);
      if (leadProposal) {
        const [approval] = await tx
          .select()
          .from(proposalApprovals)
          .where(eq(proposalApprovals.proposalId, leadProposal.id))
          .limit(1);
        if (approval) {
          await transitionTo(tx, session.tenantId, id, "proposal_approved", {
            systemBypass: true,
            remarks: "Backfill — proposal already approved.",
          });
          return { advancedTo: "proposal_approved", reason: "Proposal approved" };
        }
        if (leadProposal.status === "sent" || leadProposal.status === "viewed") {
          await transitionTo(tx, session.tenantId, id, "proposal_sent", {
            systemBypass: true,
            remarks: "Backfill — proposal already sent.",
          });
          return { advancedTo: "proposal_sent", reason: "Proposal sent" };
        }
        if (leadProposal.status === "draft" || leadProposal.status === "ready") {
          await transitionTo(tx, session.tenantId, id, "proposal_drafted", {
            systemBypass: true,
            remarks: "Backfill — proposal in draft.",
          });
          return { advancedTo: "proposal_drafted", reason: "Proposal drafted" };
        }
      }

      // 4. Risk profile on file?
      const [risk] = await tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt))
        .limit(1);
      if (risk) {
        await transitionTo(tx, session.tenantId, id, "risk_profiled", {
          systemBypass: true,
          remarks: `Backfill — risk profile on file (${risk.finalCategory}, ${risk.totalScore}).`,
        });
        return {
          advancedTo: "risk_profiled",
          reason: `Risk profile: ${risk.finalCategory} (${risk.totalScore})`,
        };
      }

      // 5. Just contacted?
      if (lead.lastContactAt) {
        await transitionTo(tx, session.tenantId, id, "first_call_pending", {
          systemBypass: true,
          remarks: "Backfill — last contact on file.",
        });
        return { advancedTo: "first_call_pending", reason: "Lead has been contacted" };
      }

      return { advancedTo: "new", reason: "No journey artefacts found yet" };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
