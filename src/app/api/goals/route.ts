import { handleApiError } from "@/lib/api/error-handler";
/**
 * Goals collection.
 *
 *   GET  /api/goals                 — list with joined investor + computed status
 *   POST /api/goals                 — create new goal, auto-computes SIP requirements
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals, investors } from "@/db/schema";
import { computeGoal, monthsBetween } from "@/lib/goal-planning/calc";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  name: z.string().min(2).max(120),
  category: z.enum([
    "retirement", "child_education", "child_marriage", "house", "car",
    "vacation", "emergency_fund", "wealth_creation", "other",
    "education", "vehicle", "emergency", "wedding", "wealth", // legacy aliases
  ]),
  targetAmount: z.number().positive(),
  targetDate: z.string(), // ISO date
  currentValue: z.number().nonnegative().default(0),
  existingMonthlySip: z.number().nonnegative().default(0),
  expectedReturnPct: z.number().min(1).max(30).default(12),
  remarks: z.string().optional(),
  nextReviewAt: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select({ goal: goals, investorName: investors.name })
        .from(goals)
        .leftJoin(investors, eq(investors.id, goals.investorId))
        .orderBy(goals.targetDate)
        .limit(500);
    });
    return NextResponse.json({ goals: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const id = uuid();
    const now = new Date();
    const target = new Date(body.targetDate);
    const monthsLeft = monthsBetween(now, target);
    const calc = computeGoal({
      targetAmount: body.targetAmount,
      currentValue: body.currentValue,
      existingMonthlySip: body.existingMonthlySip,
      monthsLeft,
      expectedReturnPct: body.expectedReturnPct,
    });

    await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      await tx.insert(goals).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId,
        name: body.name,
        category: body.category as any,
        targetAmount: body.targetAmount.toString(),
        targetDate: body.targetDate.slice(0, 10),
        startedOn: now.toISOString().slice(0, 10),
        monthlyContribution: body.existingMonthlySip.toString(),
        expectedReturn: body.expectedReturnPct.toString(),
        currentValue: body.currentValue.toString(),
        progressPct: (body.targetAmount > 0
          ? Math.min(100, (body.currentValue / body.targetAmount) * 100)
          : 0
        ).toFixed(2),
        requiredMonthlySip: calc.requiredMonthlySipTotal.toFixed(2),
        existingMonthlySip: body.existingMonthlySip.toString(),
        gapAmount: calc.gapAmount.toFixed(2),
        status: calc.status as any,
        nextReviewAt: body.nextReviewAt ? new Date(body.nextReviewAt) : null,
        remarks: body.remarks ?? null,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "goal.create",
        entityType: "goal",
        entityId: id,
        after: {
          name: body.name,
          category: body.category,
          targetAmount: body.targetAmount,
          status: calc.status,
        } as any,
        ...clientMeta,
      });
    });

    return NextResponse.json(
      {
        id,
        status: calc.status,
        requiredMonthlySipTotal: calc.requiredMonthlySipTotal,
        additionalMonthlySipNeeded: calc.additionalMonthlySipNeeded,
        gapAmount: calc.gapAmount,
        projectedTotalFV: calc.projectedTotalFV,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return handleApiError(err);
  }
}
