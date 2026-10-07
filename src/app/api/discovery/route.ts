import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/discovery            — list discoveries (newest first)
 * POST /api/discovery            — create a draft for a lead/investor, prefilled
 *                                  from the subject's record (identity, goals,
 *                                  insurance, holdings, risk profile on record)
 *
 * Gated to anyone who can see leads or clients, and scoped to the subjects the
 * viewer can see (lib/discovery/access). Tenant isolation via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { loadDiscoveryPrefill, mergeDiscoveryPrefill } from "@/lib/discovery/prefill";
import { computeDiscovery } from "@/lib/discovery/calc";
import { discoveryScopeSql, subjectVisible } from "@/lib/discovery/access";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const PostBody = z.object({
  subjectType: z.enum(["lead", "investor"]),
  subjectId: z.string().uuid(),
  reviewType: z.string().max(80).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          id: financialDiscoveries.id,
          subjectType: financialDiscoveries.subjectType,
          subjectId: financialDiscoveries.subjectId,
          title: financialDiscoveries.title,
          status: financialDiscoveries.status,
          reviewType: financialDiscoveries.reviewType,
          healthScore: financialDiscoveries.healthScore,
          updatedAt: financialDiscoveries.updatedAt,
          submittedAt: financialDiscoveries.submittedAt,
        })
        .from(financialDiscoveries)
        .where(await discoveryScopeSql(tx, session))
        .orderBy(desc(financialDiscoveries.updatedAt))
        .limit(300)
    );
    return NextResponse.json({ discoveries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { subjectType, subjectId, reviewType } = parsed.data;

    const created = await withTenant(session.tenantId, async (tx) => {
      // Only for a client / lead the viewer can see — the draft is prefilled
      // with the record's PAN, nominee and holdings.
      const subj = await subjectVisible(tx, session, subjectType, subjectId);
      if (!subj) return null;

      // One open fact-find per person. Starting another while one is still in
      // draft, shared or awaiting review left two half-filled copies; open the
      // existing one instead. A reviewed fact-find does not block a new one.
      const [open] = await tx
        .select({ id: financialDiscoveries.id })
        .from(financialDiscoveries)
        .where(and(
          eq(financialDiscoveries.subjectType, subjectType),
          eq(financialDiscoveries.subjectId, subjectId),
          inArray(financialDiscoveries.status, ["draft", "shared", "submitted"]),
        ))
        .orderBy(desc(financialDiscoveries.updatedAt))
        .limit(1);
      if (open) return { id: open.id, existing: true };

      // Start from everything the CRM already holds on this person, so the
      // client only fills what is genuinely new.
      const prefill = await loadDiscoveryPrefill(tx, session.tenantId, subjectType, subjectId);
      const { data } = mergeDiscoveryPrefill({}, prefill);
      const computed = computeDiscovery(data);

      const [row] = await tx
        .insert(financialDiscoveries)
        .values({
          tenantId: session.tenantId,
          subjectType,
          subjectId,
          title: subj.name ?? null,
          reviewType: reviewType ?? null,
          status: "draft",
          data: data as any,
          computed: computed as any,
          healthScore: computed.healthScore,
          assignedRmId: session.userId,
          createdBy: session.userId,
        } as any)
        .returning({ id: financialDiscoveries.id });
      return { id: row.id, existing: false };
    });

    if (!created) return NextResponse.json({ error: "Client or lead not found" }, { status: 404 });
    return NextResponse.json(created);
  } catch (err: any) {
    return handleApiError(err);
  }
}

