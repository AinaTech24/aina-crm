import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/bulk — apply one action to many clients at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"   value = rmId (uuid) | null      → reassign RM
 *          = "review"   value = ISO date string         → set next review date
 *          = "tier"     value = "A" | "B" | "C"          → set service tier
 *          = "segment"  value = segment tag              → set segment
 *
 * Tenant isolation is enforced by RLS (withTenant sets app.tenant_id) — we
 * scope by id only, exactly like the single-investor and leads/bulk routes.
 * Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { investors } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["assign", "review", "tier", "segment"]),
  value: z.string().nullable().optional(),
});

const TIERS = new Set(["A", "B", "C"]);
const SEGMENTS = new Set(["HNI", "Affluent", "Retail", "NRI", "Corporate"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk reassign/retier/segment the book is a privileged mutation — gate it
    // exactly like the single-investor PATCH (investor.edit.all) instead of
    // letting any authenticated session through.
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        patch.rmId = value && value.length > 0 ? value : null;
        break;
      case "review":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.nextReviewAt = new Date(value);
        break;
      case "tier":
        if (!value || !TIERS.has(value)) {
          return NextResponse.json({ error: "value must be A, B or C" }, { status: 400 });
        }
        patch.serviceTier = value;
        break;
      case "segment":
        if (!value || !SEGMENTS.has(value)) {
          return NextResponse.json({ error: "invalid segment" }, { status: 400 });
        }
        patch.segmentTag = value;
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      const updated = await tx
        .update(investors)
        .set(patch as any)
        .where(inArray(investors.id, ids))
        .returning({ id: investors.id });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `investor.bulk_${action}`,
        entityType: "investor",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
