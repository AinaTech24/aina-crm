import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/practice/promise — the firm's service promise per tier (stored over
 *     the defaults), each in plain words.
 * PUT /api/practice/promise — { tier, items } replaces one tier's promise.
 *     A null cadence (or birthdayWish false) means "not promised".
 *
 * Reading needs the practice view; writing needs settings.users AND the
 * practice manage gate (owner, or someone granted settings.users).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { servicePromises } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import { SERVICE_TIERS } from "@/lib/practice/catalog";
import { describePromise, loadPromises } from "@/lib/practice/promise";

export const dynamic = "force-dynamic";

const forbidden = (msg: string) => Object.assign(new Error(msg), { status: 403 });

const days = (max: number) => z.number().int().min(1).max(max).nullable();

const Body = z.object({
  tier: z.enum(SERVICE_TIERS),
  items: z.object({
    reviewEveryDays: days(730),
    callEveryDays: days(365),
    statementEveryDays: days(365),
    birthdayWish: z.boolean(),
    querySlaHours: days(720),
  }).strict(),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!canViewPractice(session)) throw forbidden("forbidden: practice view");
    const { promises, stored, updatedAt } = await withTenant(
      session.tenantId,
      (tx) => loadPromises(tx, session.tenantId),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    return NextResponse.json({
      promises: SERVICE_TIERS.map((tier) => ({
        tier,
        items: promises[tier],
        description: describePromise(tier, promises[tier]),
        isDefault: !stored.has(tier),
        updatedAt: updatedAt[tier] ?? null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    if (!canManagePractice(session)) throw forbidden("forbidden: practice manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { tier, items } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await loadPromises(tx, session.tenantId)).promises[tier];
      await tx
        .insert(servicePromises)
        .values({ tenantId: session.tenantId, tier, items, updatedBy: session.userId })
        .onConflictDoUpdate({
          target: [servicePromises.tenantId, servicePromises.tier],
          set: { items, updatedBy: session.userId, updatedAt: new Date() },
        });
      const after = (await loadPromises(tx, session.tenantId)).promises[tier];
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "practice.service_promise.update",
        entityType: "service_promise",
        entityId: null,
        before: { tier, ...before },
        after: { tier, ...after },
        ...meta,
      });
      return after;
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });
    return NextResponse.json({ tier, items: result, description: describePromise(tier, result) });
  } catch (err) {
    return handleApiError(err);
  }
}
