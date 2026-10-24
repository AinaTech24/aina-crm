import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/practice/strategy — the primary aim, the strategic objective, its
 *     baseline and today's figures.
 * PUT /api/practice/strategy — { primaryAim, objectiveYear, targets,
 *     ownerHoursNow?, rebaseline? }. The first save captures today's figures
 *     as the baseline (lib/practice/strategy.ts saveStrategy).
 *
 * Reading needs the practice view; writing needs settings.users AND the
 * practice manage gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import { currentFigures, loadStrategy, saveStrategy } from "@/lib/practice/strategy";

export const dynamic = "force-dynamic";

const forbidden = (msg: string) => Object.assign(new Error(msg), { status: 403 });

const money = z.number().min(0).max(1e15).nullable().optional();
const count = (max: number) => z.number().int().min(0).max(max).nullable().optional();

function body() {
  const year = new Date().getFullYear();
  return z.object({
    primaryAim: z.string().trim().max(2000).nullable(),
    objectiveYear: z.number().int().min(year + 1, `The objective year is ${year + 1} or later`).max(year + 10, `The objective year is at most ${year + 10}`),
    targets: z.object({
      aum: money,
      clients: count(10_000_000),
      sipBook: money,
      revenue: money,
      teamSize: count(100_000),
      ownerHoursPerWeek: z.number().min(0).max(168).nullable().optional(),
    }).strict(),
    ownerHoursNow: z.number().min(0).max(168).nullable().optional(),
    rebaseline: z.boolean().optional(),
  });
}

const tenantOpts = (s: { userId: string; branchId?: string | null; roles: string[] }) => ({
  userId: s.userId, branchId: s.branchId ?? undefined, roles: s.roles,
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!canViewPractice(session)) throw forbidden("forbidden: practice view");
    const data = await withTenant(session.tenantId, async (tx) => ({
      strategy: await loadStrategy(tx, session.tenantId),
      current: await currentFigures(tx, session.tenantId),
    }), tenantOpts(session));
    return NextResponse.json(data);
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
    const parse = body().safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const strategy = await withTenant(session.tenantId, async (tx) => {
      const before = await loadStrategy(tx, session.tenantId);
      const saved = await saveStrategy(tx, session.tenantId, session.userId, {
        primaryAim: b.primaryAim,
        objectiveYear: b.objectiveYear,
        targets: b.targets,
        ownerHoursNow: b.ownerHoursNow ?? null,
        rebaseline: b.rebaseline,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "practice.strategy.update",
        entityType: "firm_strategy",
        entityId: null,
        before,
        after: saved,
        ...meta,
      });
      return saved;
    }, tenantOpts(session));
    return NextResponse.json({ strategy });
  } catch (err) {
    return handleApiError(err);
  }
}
