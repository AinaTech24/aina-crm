/**
 * PATCH /api/payroll/incentives/statements/:id { action, note? } —
 * approve (the next pay run pays it), reject (with a reason), or reopen an
 * approved one not yet on an approved pay run. `payroll.manage`; nobody
 * approves their own incentive. Audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { incentiveStatements, payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["approve", "reject", "reopen"]), note: z.string().trim().max(300).optional() });
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Check the details" }, { status: 400 });
    const b = parse.data;
    if (b.action === "reject" && !b.note) return NextResponse.json({ error: "Say why it is rejected" }, { status: 400 });
    await withTenant(session.tenantId, async (tx) => {
      const [s] = await tx.select().from(incentiveStatements).where(and(eq(incentiveStatements.tenantId, session.tenantId), eq(incentiveStatements.id, id)));
      if (!s) throw fail("Statement not found", 404);
      if (s.userId === session.userId) throw fail("Someone else must decide your own incentive.", 403);
      if (s.status === "paid") throw fail("This incentive has been paid.", 409);
      if (s.payRunId) {
        const [run] = await tx.select({ status: payRuns.status }).from(payRuns).where(eq(payRuns.id, s.payRunId));
        if (run && run.status !== "draft") throw fail("This incentive is on an approved pay run — reopen the run to change it.", 409);
      }
      const now = new Date();
      const set =
        b.action === "approve"
          ? { status: "approved", approvedBy: session.userId, approvedAt: now }
          : b.action === "reject"
            ? { status: "rejected", approvedBy: null, approvedAt: null, payRunId: null }
            : { status: "calculated", approvedBy: null, approvedAt: null, payRunId: null };
      if (b.action === "approve" && s.status !== "calculated") throw fail("Only a statement waiting for approval can be approved.", 409);
      await tx
        .update(incentiveStatements)
        .set({ ...set, working: b.note ? { ...(s.working ?? {}), decisionNote: b.note } : s.working, updatedAt: now })
        .where(eq(incentiveStatements.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: `payroll.incentive_${b.action}`,
        entityType: "incentive_statement", entityId: id, before: { status: s.status }, after: { status: set.status, amount: s.amount, note: b.note },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
