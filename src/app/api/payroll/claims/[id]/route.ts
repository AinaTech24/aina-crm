/**
 * PATCH /api/payroll/claims/:id { action: "approve" | "reject", note? } —
 * decide a reimbursement claim. Allowed for the claimant's reporting manager
 * or anyone with `payroll.manage`, never the claimant (lib/payroll/claims.ts);
 * anyone else gets 403. An approved claim the next pay run picks up; one on an
 * approved or paid run is final. Audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { payRuns, reimbursementClaims } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { canDecideClaim } from "@/lib/payroll/claims";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional() });
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Check the details" }, { status: 400 });
    const b = parse.data;
    if (b.action === "reject" && !b.note) return NextResponse.json({ error: "Say why the claim is rejected" }, { status: 400 });
    const manager = can(session.roles, "payroll.manage", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      const [c] = await tx.select().from(reimbursementClaims).where(and(eq(reimbursementClaims.tenantId, session.tenantId), eq(reimbursementClaims.id, id)));
      if (!c) throw fail("Claim not found", 404);
      if (!(await canDecideClaim(tx, session.tenantId, session.userId, c.userId, manager))) {
        throw fail(c.userId === session.userId ? "You cannot decide your own claim." : "Only the claimant's reporting manager or a payroll manager can decide this claim.", 403);
      }
      if (c.status === "paid" || c.status === "withdrawn") throw fail("This claim is closed.", 409);
      if (c.payRunId) {
        const [run] = await tx.select({ status: payRuns.status }).from(payRuns).where(eq(payRuns.id, c.payRunId));
        if (run && run.status !== "draft") throw fail("This claim is on an approved pay run — reopen the run to change it.", 409);
      }
      const status = b.action === "approve" ? "approved" : "rejected";
      await tx
        .update(reimbursementClaims)
        .set({ status, decidedBy: session.userId, decidedAt: new Date(), decisionNote: b.note || null, payRunId: status === "rejected" ? null : c.payRunId, updatedAt: new Date() })
        .where(eq(reimbursementClaims.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: `payroll.claim_${b.action}`,
        entityType: "reimbursement_claim", entityId: id, before: { status: c.status }, after: { status, amount: c.amount, note: b.note },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
