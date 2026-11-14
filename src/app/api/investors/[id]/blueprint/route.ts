import { assertInvestorAccess } from "@/lib/investors/access";
import { handleApiError } from "@/lib/api/error-handler";
/**
 * Investor blueprint endpoint.
 *
 *   GET /api/investors/[id]/blueprint
 *
 * Access: the client's own rule (assertInvestorAccess → loadViewableInvestor):
 * the current RM, the branch for a branch head, the firm for those who see
 * all clients. Not the lead owner. An id that is not a uuid is a 404.
 *
 * Two render paths:
 *
 *   1. Source lead exists (the client was converted from a lead) → that
 *      lead's real journey instance.
 *
 *   2. Added directly or imported → a read-only view built from FACTS on the
 *      client record, never a fake "all done" (audit C2): KYC Validated when
 *      the KYC is verified, UCC Activated when a UCC is on file, Mandate
 *      Activated when a mandate is active, Transaction Successful when a
 *      folio or a processed transaction exists, Family Mapping when the
 *      client is in a family. Failure / retry stages (Mandate Rejected,
 *      Transaction Failed, Rejected by RTA, Not Proceeded) and the lead phase
 *      are never shown, so never ticked. A step with no fact behind it is
 *      "unknown" — "Not recorded", not done.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { getStage } from "@/lib/blueprints/engine";
import type { Tx } from "@/db/client";
import { FACT_STEPS, factJourney } from "@/lib/blueprints/client-facts";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function factStageView(tx: Tx, tenantId: string, investorId: string) {
  const r = await tx.execute(sql`
    SELECT bs.stage_key, bs.stage_name, bs.stage_order, bs.owner_role
      FROM blueprint_stages bs
     WHERE bs.blueprint_id IN (
       SELECT id FROM blueprint_definitions WHERE tenant_id = ${tenantId}::uuid AND module_name = 'leads'
        ORDER BY is_active DESC LIMIT 1
     )
     ORDER BY bs.stage_order
  `);
  const byKey = new Map((r.rows as any[]).map((s) => [s.stage_key as string, s]));
  const f = (await tx.execute(sql`
    SELECT i.kyc_status = 'verified' AS kyc_verified,
           (NULLIF(btrim(COALESCE(i.bse_ucc_code, '')), '') IS NOT NULL
             OR jsonb_array_length(COALESCE(i.ucc_codes, '[]'::jsonb)) > 0) AS has_ucc,
           i.mandate_status = 'active' AS mandate_active,
           i.family_id IS NOT NULL AS in_family,
           COALESCE(i.status, 'active') IN ('active', 'redemption_risk') AS active,
           (EXISTS (SELECT 1 FROM folios fo WHERE fo.tenant_id = i.tenant_id AND fo.investor_id = i.id)
            OR EXISTS (SELECT 1 FROM transactions t WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id
                         AND COALESCE(t.status, '') NOT IN ('rejected', 'cancelled', 'failed'))) AS invested
      FROM investors i WHERE i.id = ${investorId}::uuid AND i.tenant_id = ${tenantId}::uuid
  `)).rows[0] as any;
  if (!f) return null;
  const facts = {
    kycVerified: !!f.kyc_verified,
    hasUcc: !!f.has_ucc,
    mandateActive: !!f.mandate_active,
    invested: !!f.invested,
    inFamily: !!f.in_family,
    active: !!f.active,
  };
  const status = factJourney(facts);
  const stages = FACT_STEPS.map((key, i) => {
    const row = byKey.get(key);
    return {
      key,
      name: (row?.stage_name as string) ?? key.replace(/_/g, " "),
      order: i + 1,
      status: status[key],
      phase: "client" as const,
      flavour: "default" as const,
    };
  });
  const cur = stages.find((s) => s.status === "current");
  const lastDone = [...stages].reverse().find((s) => s.status === "done");
  const shown = cur ?? lastDone ?? stages[0];
  return {
    current: {
      key: shown.key,
      name: shown.name,
      description: cur
        ? "Added directly — no lead journey on file. Placed from what the client record shows."
        : "Added directly — every onboarding fact is on the client record.",
      ownerRole: (byKey.get(shown.key)?.owner_role as string | null) ?? null,
      order: shown.order,
      slaDays: null,
      allowedActions: [] as string[],
      requiredFields: [] as string[],
      secondsInStage: 0,
      slaRemainingDays: null,
      isDelayed: false,
    },
    allStages: stages,
    facts,
    history: [] as any[],
    leadId: null,
    synthetic: true,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: investorId } = await params;
    if (!UUID_RE.test(investorId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Investor-data capability gate (marketing is excluded from investor.view.*).
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    // The client's own access rule — RM, branch, firm — not the lead owner's.
    await assertInvestorAccess(session, investorId);
    const data = await withTenant(session.tenantId, async (tx) => {
      // Path 1: real blueprint via source lead
      const lead = await tx.execute(sql`
        SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid AND tenant_id = ${session.tenantId}::uuid
        ORDER BY converted_at DESC NULLS LAST LIMIT 1
      `);
      const leadId = (lead.rows[0] as any)?.id as string | undefined;
      if (leadId) {
        const view = await getStage(tx, session.tenantId, leadId);
        return { ...view, leadId, synthetic: false };
      }

      // Path 2: placed from the client record's facts.
      return await factStageView(tx, session.tenantId, investorId);
    });

    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
