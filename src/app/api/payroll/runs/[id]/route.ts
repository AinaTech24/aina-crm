/**
 * PATCH  /api/payroll/runs/:id { action: "recalculate" | "approve" | "reopen" | "paid", paidOn? }
 * DELETE /api/payroll/runs/:id — a draft only.
 *
 * Approval is maker-checker (lib/payroll/run.ts); a paid run is locked.
 * Needs `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { calculateRun, fail, setRunStatus } from "@/lib/payroll/run";
import { actorOf } from "@/lib/payroll/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["recalculate", "approve", "reopen", "paid"]),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const actor = actorOf(session);
    await withTenant(session.tenantId, (tx) =>
      parse.data.action === "recalculate" ? calculateRun(tx, actor, id) : setRunStatus(tx, actor, id, parse.data.action as "approve" | "reopen" | "paid", parse.data.paidOn)
    );
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
      const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
      if (!run) throw fail("Pay run not found", 404);
      if (run.status !== "draft") throw fail("Only a draft pay run can be deleted.");
      await tx.delete(payRuns).where(eq(payRuns.id, id));
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.run_deleted", entityType: "pay_run", entityId: id, before: { period: run.period } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
