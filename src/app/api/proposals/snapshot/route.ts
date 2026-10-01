import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/proposals/snapshot?investorId= | familyId= | leadId=
 *
 * What the CRM already knows about a proposal's recipient — risk profile,
 * holdings, equity share against the profile's band, goals — so the builder
 * starts from it (lib/proposals/snapshot.ts).
 *
 * Access follows the record: a client through the per-firm data wall
 * (loadViewableInvestor), a lead through the lead scope. An RM cannot read the
 * book of a client they could not open.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { families, leads } from "@/db/schema";
import { loadViewableInvestor } from "@/lib/investors/access";
import { leadScopeCondition } from "@/lib/leads/access";
import { loadProposalSnapshot } from "@/lib/proposals/snapshot";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);

    const q = req.nextUrl.searchParams;
    const pick = (k: string) => {
      const v = q.get(k);
      return v && UUID.test(v) ? v : null;
    };
    const investorId = pick("investorId");
    const familyId = pick("familyId");
    const leadId = pick("leadId");
    if (!investorId && !familyId && !leadId) {
      return NextResponse.json({ error: "investorId, familyId or leadId required" }, { status: 400 });
    }

    const snap = await withTenant(session.tenantId, async (tx) => {
      // Authorise the subject before reading anything about it.
      let subjectInvestor = investorId;
      if (!subjectInvestor && familyId) {
        const [f] = await tx
          .select({ primary: families.primaryInvestorId })
          .from(families)
          .where(and(eq(families.id, familyId), eq(families.tenantId, session.tenantId)))
          .limit(1);
        subjectInvestor = f?.primary ?? null;
      }
      if (subjectInvestor) {
        const ok = await loadViewableInvestor(tx as any, session, subjectInvestor);
        if (!ok) return null;
      } else if (leadId) {
        const [l] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.id, leadId), eq(leads.tenantId, session.tenantId), leadScopeCondition(session)))
          .limit(1);
        if (!l) return null;
      }
      return loadProposalSnapshot(tx, session.tenantId, { investorId: subjectInvestor, familyId, leadId });
    });

    if (!snap) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(snap);
  } catch (err: any) {
    return handleApiError(err);
  }
}
