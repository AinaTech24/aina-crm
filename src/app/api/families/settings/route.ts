import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET   /api/families/settings — household defaults for this firm.
 * PATCH /api/families/settings — change them.
 *
 * Stored on tenants.family_settings as a partial object; anything unset falls
 * back to the shipped defaults, so a firm only records what it actually chose.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";
import { loadFamilySettings } from "@/lib/families/master";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["family.view", "investor.view.all", "investor.view.assigned"],
      session.permissions
    );
    const settings = await withTenant(
      session.tenantId,
      (tx) => loadFamilySettings(tx, session.tenantId),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ settings });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Patch = z.object({
  defaultReviewFrequency: z
    .enum(["monthly", "quarterly", "half_yearly", "annual"])
    .nullable()
    .optional(),
  // {head} is the only token; keep it short enough for the 120-char family name.
  familyNamePattern: z.string().trim().min(1).max(80).optional(),
  requirePrimaryMember: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const settings = await withTenant(
      session.tenantId,
      async (tx) => {
        const current = (
          await tx.select({ s: tenants.familySettings }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
        )[0];
        const merged = { ...((current?.s as Record<string, unknown>) ?? {}), ...parse.data };
        await tx
          .update(tenants)
          .set({ familySettings: merged, updatedAt: new Date() })
          .where(eq(tenants.id, session.tenantId));
        return loadFamilySettings(tx, session.tenantId);
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ ok: true, settings });
  } catch (err: any) {
    return handleApiError(err);
  }
}
