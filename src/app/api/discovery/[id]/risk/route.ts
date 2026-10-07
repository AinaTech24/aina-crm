import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/discovery/:id/risk — save the fact-find's risk questionnaire as
 * the client's risk profile, PROVISIONAL until the client confirms it.
 *
 * Only for a client with no risk profile on record (the record always wins —
 * the fact-find does not ask again once there is one) and only when all ten
 * questions are answered. Provisional is the honest label: the RM keyed or the
 * client typed the answers on a fact-find, not the signed questionnaire, so
 * the profile does not open an MF proposal until the client confirms it
 * (same rule as the bulk age-suggested profiles, migration 0207).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { financialDiscoveries } from "@/db/schema";
import { assertCanEditSubject, discoveryScopeSql } from "@/lib/discovery/access";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import { toCanonicalCategory } from "@/lib/discovery/risk";
import { loadDiscoveryPrefill } from "@/lib/discovery/prefill";
import { applyRiskCategory } from "@/lib/risk-profile/apply";
import { clientMetaFromHeaders, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const out = await withTenant(session.tenantId, async (tx) => {
      const disc = (await tx.select().from(financialDiscoveries)
        .where(and(eq(financialDiscoveries.id, id), await discoveryScopeSql(tx, session))).limit(1))[0];
      if (!disc) return { status: 404, error: "not found" } as const;
      if (disc.subjectType !== "investor") {
        return { status: 400, error: "A risk profile is saved on a client. Convert the lead first." } as const;
      }
      await assertCanEditSubject(tx, session, disc.subjectType, disc.subjectId);

      const onRecord = (await tx.execute(sql`
        SELECT (i.risk_profile IS NOT NULL
                OR EXISTS (SELECT 1 FROM risk_profile_responses r
                            WHERE r.investor_id = i.id AND r.tenant_id = i.tenant_id)) AS has
          FROM investors i
         WHERE i.id = ${disc.subjectId}::uuid AND i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL
         LIMIT 1`)).rows[0] as { has: boolean } | undefined;
      if (!onRecord) return { status: 404, error: "client not found" } as const;
      if (onRecord.has) return { status: 409, error: "This client already has a risk profile on record." } as const;

      // Computed from the stored data, never from the request.
      const data = { ...((disc.data ?? {}) as DiscoveryData), recordedRisk: undefined };
      const risk = computeDiscovery(data).risk;
      if (!risk.complete || risk.score == null) {
        return { status: 400, error: `Answer every risk question first (${risk.missing.join(", ")}).` } as const;
      }
      const category = toCanonicalCategory(risk.bandId);
      await applyRiskCategory({
        tx,
        tenantId: session.tenantId,
        investorId: disc.subjectId,
        category,
        createdById: session.userId,
        provisional: true,
        basis: "fact_find",
        remarks: `Provisional — from the fact-find questionnaire (score ${risk.score}/${risk.max}, ${risk.bandLabel}); awaiting the client's confirmation.`,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.update",
        entityType: "investor",
        entityId: disc.subjectId,
        before: { riskProfile: null },
        after: { riskProfile: category, provisional: true },
        reason: "Provisional risk profile from the client's fact-find",
        meta: { discoveryId: id, score: risk.score, band: risk.bandId },
        ...clientMetaFromHeaders(req.headers),
      });
      // The fact-find now shows the profile on record. Only that field is
      // refreshed — a submitted fact-find is otherwise a record of what was said.
      const p = await loadDiscoveryPrefill(tx, session.tenantId, disc.subjectType, disc.subjectId);
      const next = { ...((disc.data ?? {}) as DiscoveryData), recordedRisk: p.recordedRisk ?? undefined };
      const computed = computeDiscovery(next);
      await tx.update(financialDiscoveries)
        .set({ data: next as any, computed: computed as any, healthScore: computed.healthScore, updatedAt: new Date() } as any)
        .where(eq(financialDiscoveries.id, id));
      return { status: 200, category, bandLabel: risk.bandLabel } as const;
    });

    if (out.status !== 200) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, category: out.category, bandLabel: out.bandLabel });
  } catch (err: any) {
    return handleApiError(err);
  }
}
