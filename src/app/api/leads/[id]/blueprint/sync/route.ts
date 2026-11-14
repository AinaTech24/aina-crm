import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/blueprint/sync
 *
 * Re-syncs a journey with what is on record — through the SAME event map the
 * automatic moves use (lib/blueprints/auto-advance.ts), so a re-sync can
 * never disagree with them (audit C12):
 *
 *   lead phase    last contact → call logged · a completed meeting → meeting
 *                 completed · a proposal sent → Proposal Sent · a proposal
 *                 the client approved → Won
 *   client phase  (the lead was converted — read from the CLIENT record)
 *                 onboarding started · documents on file → Documents Received
 *                 · KYC verified → KYC Validated · a UCC → UCC Activated · an
 *                 active mandate → Mandate Activated · a processed
 *                 transaction → Transaction Successful
 *
 * The furthest fact wins and the journey moves ONCE to it (no step task is
 * opened for a step only passed through). Automatic, so forward-only: a
 * re-sync never moves a journey back, and never a client into a lead stage.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { autoAdvance, EVENT_TO_STAGE, type BlueprintEvent } from "@/lib/blueprints/auto-advance";
import { authorizeJourneyMove } from "@/lib/blueprints/journey-access";
import { journeyRank } from "@/lib/blueprints/journey-rules";

export const dynamic = "force-dynamic";

type Fact = { event: BlueprintEvent; reason: string };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["lead.edit.all", "lead.edit.assigned", "investor.edit.all", "investor.edit.assigned"],
      session.permissions,
    );
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = (await tx.execute(sql`
        SELECT id, last_contact_at, converted_investor_id FROM leads
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
      `)).rows[0] as { id: string; last_contact_at: string | null; converted_investor_id: string | null } | undefined;
      const investorId = lead ? lead.converted_investor_id : id;
      // Access: the lead's rule in the lead phase, the client's in the client phase.
      const subject = await authorizeJourneyMove(tx, session, id, investorId ? "request_documents" : "call_done");

      const facts: Fact[] = [];
      if (lead) {
        if (lead.last_contact_at) facts.push({ event: "call.logged", reason: "a contact is on record" });
        const m = await tx.execute(sql`
          SELECT 1 FROM review_meetings WHERE tenant_id = ${session.tenantId}::uuid AND lead_id = ${id}::uuid AND status = 'completed' LIMIT 1
        `);
        if (m.rows.length) facts.push({ event: "meeting.completed", reason: "a meeting was held" });
        const p = (await tx.execute(sql`
          SELECT bool_or(p.status IN ('sent', 'viewed', 'accepted', 'partially_approved', 'executed', 'changes_requested')) AS sent,
                 bool_or(p.status IN ('accepted', 'partially_approved', 'executed')
                         OR EXISTS (SELECT 1 FROM proposal_approvals pa WHERE pa.proposal_id = p.id)) AS accepted
            FROM proposals p WHERE p.tenant_id = ${session.tenantId}::uuid AND p.lead_id = ${id}::uuid
        `)).rows[0] as { sent: boolean | null; accepted: boolean | null } | undefined;
        if (p?.sent) facts.push({ event: "proposal.sent", reason: "a proposal was sent" });
        if (p?.accepted) facts.push({ event: "proposal.accepted", reason: "the client accepted a proposal" });
      }
      if (investorId) {
        facts.push({ event: "client.converted", reason: "the lead is a client" });
        const c = (await tx.execute(sql`
          SELECT i.kyc_status = 'verified' AS kyc,
                 (NULLIF(btrim(COALESCE(i.bse_ucc_code, '')), '') IS NOT NULL
                   OR jsonb_array_length(COALESCE(i.ucc_codes, '[]'::jsonb)) > 0) AS ucc,
                 i.mandate_status = 'active' AS mandate,
                 EXISTS (SELECT 1 FROM transactions t WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id
                           AND t.direction = 'inflow' AND t.status IN ('processed', 'successful')) AS invested,
                 EXISTS (SELECT 1 FROM compliance_documents d WHERE d.tenant_id = i.tenant_id
                           AND d.related_entity_id IN (i.id, ${id}::uuid) AND d.superseded_by_id IS NULL) AS docs
            FROM investors i WHERE i.id = ${investorId}::uuid AND i.tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as { kyc: boolean; ucc: boolean; mandate: boolean; invested: boolean; docs: boolean } | undefined;
        if (c?.docs) facts.push({ event: "docs.received", reason: "documents are on file" });
        if (c?.kyc) facts.push({ event: "kyc.validated", reason: "the client's KYC is verified" });
        if (c?.ucc) facts.push({ event: "ucc.activated", reason: "a UCC is on the client" });
        if (c?.mandate) facts.push({ event: "mandate.activated", reason: "a mandate is active" });
        if (c?.invested) facts.push({ event: "transaction.successful", reason: "a processed investment is on record" });
      }

      // Furthest fact first; the first one the journey accepts wins.
      const ranked = facts
        .filter((f) => EVENT_TO_STAGE[f.event])
        .sort((a, b) => journeyRank(EVENT_TO_STAGE[b.event]!) - journeyRank(EVENT_TO_STAGE[a.event]!));
      for (const f of ranked) {
        const r = await autoAdvance(tx, session.tenantId, id, f.event, { remarks: `Re-sync — ${f.reason}.` });
        if (r.moved) return { advancedTo: r.toStage, reason: `Re-sync — ${f.reason}.` };
      }
      return { advancedTo: subject.currentKey, reason: facts.length ? "Already at or beyond what the record shows — no change." : "No journey facts found yet." };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
