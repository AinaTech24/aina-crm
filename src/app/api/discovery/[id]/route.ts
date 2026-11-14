import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET   /api/discovery/:id   — load one discovery, as the web page opens it:
 *                              blanks filled and the risk profile refreshed
 *                              from the client / lead record, plus what a
 *                              submitted fact-find changed that the record
 *                              lacks (`diffs`) and whether the viewer may
 *                              apply it (`canEdit`)
 * PATCH /api/discovery/:id   — save fact-find data; recomputes the snapshot +
 *                              health score server-side and caches it.
 *
 * Gated to lead/client viewers and scoped to the discovery's subject
 * (lib/discovery/access). Tenant isolation via RLS. The body's data is
 * cleaned to the form's own sections (lib/discovery/validate); server-owned
 * fields keep their stored values.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import { assertCanEditSubject, discoveryScopeSql } from "@/lib/discovery/access";
import { syncDiscoveryPrefill } from "@/lib/discovery/prefill";
import { recordDiffs } from "@/lib/discovery/record-diff";
import { cleanSections, keepServerFields } from "@/lib/discovery/validate";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const PatchBody = z.object({
  data: z.unknown().optional(),
  status: z.enum(["draft", "shared", "submitted", "reviewed"]).optional(),
  reviewType: z.string().max(80).optional(),
  markReviewed: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const loaded = await withTenant(session.tenantId, async (tx) => {
      const d = (await tx.select().from(financialDiscoveries)
        .where(and(eq(financialDiscoveries.id, id), await discoveryScopeSql(tx, session))).limit(1))[0];
      if (!d) return null;
      // The same as the web page (dashboard/discovery/[id]) on every open.
      const data = await syncDiscoveryPrefill(tx, d as any);
      const diffs = d.status === "submitted" || d.status === "reviewed"
        ? await recordDiffs(tx, session.tenantId, d.subjectType, d.subjectId, data)
        : [];
      const canEdit = diffs.length
        ? await assertCanEditSubject(tx, session, d.subjectType, d.subjectId).then(() => true, () => false)
        : false;
      return { discovery: { ...d, data }, diffs, canEdit };
    });
    if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(loaded);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;

    const updated = await withTenant(session.tenantId, async (tx) => {
      const scope = await discoveryScopeSql(tx, session);
      const existing = (await tx.select().from(financialDiscoveries)
        .where(and(eq(financialDiscoveries.id, id), scope)).limit(1))[0];
      if (!existing) return null;

      const stored = (existing.data ?? {}) as DiscoveryData;
      const data = b.data !== undefined ? keepServerFields(stored, cleanSections(b.data)) : stored;
      const computed = computeDiscovery(data);
      const patch: Record<string, unknown> = {
        data: data as any,
        computed: computed as any,
        healthScore: computed.healthScore,
        title: String((data.identification as any)?.fullName ?? "").trim() || existing.title,
        updatedAt: new Date(),
      };
      if (b.reviewType !== undefined) patch.reviewType = b.reviewType;
      if (b.status) patch.status = b.status;
      if (b.markReviewed) {
        patch.status = "reviewed";
        patch.reviewedAt = new Date();
      }
      const [row] = await tx
        .update(financialDiscoveries)
        .set(patch as any)
        .where(and(eq(financialDiscoveries.id, id), eq(financialDiscoveries.tenantId, session.tenantId)))
        .returning();
      return row;
    });

    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ discovery: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}
