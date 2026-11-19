/**
 * POST /api/payroll/loans — give a team member a salary loan or advance,
 * recovered by EMI from the pay run of `startMonth` onwards
 * (lib/payroll/inputs.ts). Needs `payroll.manage`; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { payrollLoans, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    userId: z.string().uuid(),
    kind: z.enum(["loan", "advance"]),
    principal: z.number().positive("Enter the amount").max(10_000_000),
    emi: z.number().positive("Enter the monthly instalment").max(10_000_000),
    startMonth: z.string().regex(/^\d{4}-\d{2}$/, "Pick the first month to recover"),
    interestRate: z.number().min(0).max(30).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.emi <= b.principal, { message: "The instalment cannot be more than the amount", path: ["emi"] });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const b = parse.data;
    const id = await withTenant(session.tenantId, async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, session.tenantId), eq(users.id, b.userId)));
      if (!u) throw Object.assign(new Error("Team member not found"), { status: 404 });
      const [row] = await tx
        .insert(payrollLoans)
        .values({
          tenantId: session.tenantId,
          userId: b.userId,
          kind: b.kind,
          principal: String(b.principal),
          emi: String(b.emi),
          startPeriod: `${b.startMonth}-01`,
          interestRate: String(b.interestRate ?? 0),
          note: b.note || null,
          createdBy: session.userId,
        })
        .returning({ id: payrollLoans.id });
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.loan_created",
        entityType: "payroll_loan", entityId: row.id, after: { userId: b.userId, kind: b.kind, principal: b.principal, emi: b.emi, startMonth: b.startMonth },
      });
      return row.id;
    });
    return NextResponse.json({ id });
  } catch (err) {
    return handleApiError(err);
  }
}
