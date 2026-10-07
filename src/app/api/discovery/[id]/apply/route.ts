import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/discovery/:id/apply — copy fields the client corrected in the
 * fact-find onto the client / lead record. Body: { fields: string[] }.
 *
 * The values come from the stored fact-find, never from the request
 * (lib/discovery/record-diff). Needs the right to EDIT the
 * client or lead (assertCanEditSubject). Audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { financialDiscoveries } from "@/db/schema";
import { assertCanEditSubject, discoveryScopeSql } from "@/lib/discovery/access";
import { applyRecordDiffs } from "@/lib/discovery/record-diff";
import { clientMetaFromHeaders, recordAudit } from "@/lib/audit";
import type { DiscoveryData } from "@/lib/discovery/calc";

export const dynamic = "force-dynamic";

const Body = z.object({ fields: z.array(z.string().max(40)).min(1).max(20) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const disc = (await tx.select().from(financialDiscoveries)
        .where(and(eq(financialDiscoveries.id, id), await discoveryScopeSql(tx, session))).limit(1))[0];
      if (!disc) return null;

      await assertCanEditSubject(tx, session, disc.subjectType, disc.subjectId);

      const applied = await applyRecordDiffs(tx, session.tenantId, disc.subjectType, disc.subjectId, (disc.data ?? {}) as DiscoveryData, parsed.data.fields);
      if (applied.length) {
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: disc.subjectType === "lead" ? "lead.update" : "investor.update",
          entityType: disc.subjectType === "lead" ? "lead" : "investor",
          entityId: disc.subjectId,
          before: Object.fromEntries(applied.map((d) => [d.field, d.record])),
          after: Object.fromEntries(applied.map((d) => [d.field, d.factFind])),
          reason: "Updated from the client's fact-find",
          meta: { discoveryId: id },
          ...clientMetaFromHeaders(req.headers),
        });
      }
      return applied;
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ applied: result.map((d) => d.field) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
