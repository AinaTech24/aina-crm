/**
 * PATCH /api/payroll/loans/:id — change the instalment, or stop recovering
 * (`cancel`: written off or repaid outside payroll; `close`: settled). What
 * approved or paid runs already recovered stays recovered. `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { payrollLoans } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["cancel", "close", "reopen"]).optional(),
  emi: z.number().positive().max(10_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const b = parse.data;
    await withTenant(session.tenantId, async (tx) => {
      const [loan] = await tx.select().from(payrollLoans).where(and(eq(payrollLoans.tenantId, session.tenantId), eq(payrollLoans.id, id)));
      if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });
      const set: Partial<typeof payrollLoans.$inferInsert> = { updatedAt: new Date() };
      if (b.action === "cancel") set.status = "cancelled";
      if (b.action === "close") set.status = "closed";
      if (b.action === "reopen") set.status = "active";
      if (b.emi !== undefined) {
        if (b.emi > Number(loan.principal)) throw Object.assign(new Error("The instalment cannot be more than the amount"), { status: 400 });
        set.emi = String(b.emi);
      }
      if (b.note !== undefined) set.note = b.note || null;
      await tx.update(payrollLoans).set(set).where(eq(payrollLoans.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: `payroll.loan_${b.action ?? "changed"}`,
        entityType: "payroll_loan", entityId: id, before: { status: loan.status, emi: loan.emi }, after: { status: set.status ?? loan.status, emi: set.emi ?? loan.emi },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
