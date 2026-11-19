/**
 * PUT /api/payroll/incentives/plans/:id — change a plan (statements already
 * approved or paid keep the figures they were approved on).
 * DELETE — switch the plan off (kept for its history). `payroll.manage`; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { incentivePlans } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { PlanSchema } from "@/lib/payroll/incentive-rules";

export const dynamic = "force-dynamic";

const notFound = () => Object.assign(new Error("Plan not found"), { status: 404 });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    const parse = PlanSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the plan" }, { status: 400 });
    const p = parse.data;
    await withTenant(session.tenantId, async (tx) => {
      const done = await tx
        .update(incentivePlans)
        .set({
          name: p.name, measure: p.measure, periodKind: p.periodKind, slabOn: p.slabOn, payout: p.payout,
          slabs: [...p.slabs].sort((a, b) => a.from - b.from), cap: p.cap != null ? String(p.cap) : null,
          roles: p.roles, userIds: p.userIds, active: p.active, updatedAt: new Date(),
        })
        .where(and(eq(incentivePlans.tenantId, session.tenantId), eq(incentivePlans.id, id)))
        .returning({ id: incentivePlans.id });
      if (!done.length) throw notFound();
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.incentive_plan_changed", entityType: "incentive_plan", entityId: id, after: p });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    await withTenant(session.tenantId, async (tx) => {
      const done = await tx
        .update(incentivePlans)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(incentivePlans.tenantId, session.tenantId), eq(incentivePlans.id, id)))
        .returning({ id: incentivePlans.id });
      if (!done.length) throw notFound();
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.incentive_plan_off", entityType: "incentive_plan", entityId: id });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
