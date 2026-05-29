import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-package CRUD (AINA only).
 *
 *   GET    /api/super-admin/packages/[id]   — fetch one package
 *   PATCH  /api/super-admin/packages/[id]   — partial update (prices, modules, active flag)
 *
 * Active/Inactive toggle is part of PATCH (`{ isActive: boolean }`). When AINA
 * flips a package to inactive, existing tenant subscriptions keep working —
 * we just hide the package from public listings + tenant signup.
 *
 * Enabling/disabling modules per package: pass `enabledModules: string[]`.
 * Each module key must be in `ALL_MODULES`.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { packages } from "@/db/schema";
import { ALL_MODULES } from "@/lib/platform";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { PLATFORM_TENANT_ID } from "@/lib/platform";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  monthlyPricePaise: z.number().int().nonnegative().optional(),
  yearlyPricePaise: z.number().int().nonnegative().optional(),
  setupCostPaise: z.number().int().nonnegative().optional(),
  maxUsers: z.number().int().positive().optional(),
  maxInvestors: z.number().int().positive().optional(),
  storageLimitGb: z.number().int().positive().optional(),
  trialDays: z.number().int().nonnegative().optional(),
  enabledModules: z.array(z.enum(ALL_MODULES as any)).optional(),
  featureFlags: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  badge: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const row = await withPlatformAdmin(session.userId, async (tx) => {
      return (await tx.select().from(packages).where(eq(packages.id, id)).limit(1))[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const patch = parse.data;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const clientMeta = clientMetaFromHeaders(req.headers);
    const updated = await withPlatformAdmin(session.userId, async (tx) => {
      const before = (await tx.select().from(packages).where(eq(packages.id, id)).limit(1))[0];
      if (!before) throw Object.assign(new Error("not found"), { status: 404 });

      const r = await tx
        .update(packages)
        .set({ ...patch, updatedAt: new Date() } as any)
        .where(eq(packages.id, id))
        .returning();

      await recordAudit(tx, {
        // AINA actions are platform-scoped — log them against the platform tenant.
        tenantId: PLATFORM_TENANT_ID,
        actorUserId: session.userId,
        action: "package.update",
        entityType: "package",
        entityId: id,
        before: {
          name: before.name,
          isActive: before.isActive,
          monthlyPricePaise: before.monthlyPricePaise,
          yearlyPricePaise: before.yearlyPricePaise,
          enabledModulesCount: (before.enabledModules as string[] | null)?.length ?? 0,
        },
        after: {
          ...patch,
          enabledModulesCount: patch.enabledModules?.length,
        },
        ...clientMeta,
      });

      return r[0];
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return handleApiError(err);
  }
}
