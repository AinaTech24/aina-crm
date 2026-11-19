/**
 * POST /api/payroll/incentives/plans — create a sales incentive plan
 * (lib/payroll/incentive-rules.ts). `payroll.manage`; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { incentivePlans } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { PlanSchema } from "@/lib/payroll/incentive-rules";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const parse = PlanSchema.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the plan" }, { status: 400 });
    const p = parse.data;
    const id = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .insert(incentivePlans)
        .values({
          tenantId: session.tenantId,
          name: p.name,
          measure: p.measure,
          periodKind: p.periodKind,
          slabOn: p.slabOn,
          payout: p.payout,
          slabs: [...p.slabs].sort((a, b) => a.from - b.from),
          cap: p.cap != null ? String(p.cap) : null,
          roles: p.roles,
          userIds: p.userIds,
          active: p.active,
          createdBy: session.userId,
        })
        .returning({ id: incentivePlans.id });
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.incentive_plan_created", entityType: "incentive_plan", entityId: row.id, after: p });
      return row.id;
    });
    return NextResponse.json({ id });
  } catch (err) {
    return handleApiError(err);
  }
}
