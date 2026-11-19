/**
 * POST /api/payroll/incentives/calculate { planId, month: "yyyy-mm" } — work
 * out the plan's statements for the month or quarter `month` falls in
 * (lib/payroll/incentives.ts). Approved and paid statements are left alone.
 * `payroll.manage`; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { calculatePlan } from "@/lib/payroll/incentives";

export const dynamic = "force-dynamic";

const Body = z.object({ planId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Pick a plan and a month" }, { status: 400 });
    const out = await withTenant(session.tenantId, async (tx) => {
      const r = await calculatePlan(tx, session.tenantId, parse.data.planId, parse.data.month);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.incentives_calculated",
        entityType: "incentive_plan", entityId: parse.data.planId, after: r,
      });
      return r;
    });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
