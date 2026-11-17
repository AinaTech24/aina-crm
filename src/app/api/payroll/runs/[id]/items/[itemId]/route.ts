/**
 * PATCH /api/payroll/runs/:id/items/:itemId — one person's inputs on a DRAFT
 * run: days without pay (by hand, with a reason; `clearLop` goes back to the
 * attendance figure), one-time earnings and deductions, salary on hold. The
 * run is recalculated after. Needs `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { calculateRun, fail } from "@/lib/payroll/run";
import { actorOf } from "@/lib/payroll/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  lopDays: z.number().min(0).max(31).optional(),
  lopReason: z.string().trim().min(3, "Say why the days without pay changed").max(200).optional(),
  clearLop: z.boolean().optional(),
  adjustments: z
    .array(z.object({ label: z.string().trim().min(2).max(60), amount: z.number().min(0).max(10_000_000), kind: z.enum(["earning", "deduction"]), taxable: z.boolean() }))
    .max(20)
    .optional(),
  onHold: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id, itemId } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const b = parse.data;
    if (b.lopDays !== undefined && !b.lopReason) return NextResponse.json({ error: "Say why the days without pay changed" }, { status: 400 });

    await withTenant(session.tenantId, async (tx) => {
      const [run] = await tx.select({ status: payRuns.status }).from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
      if (!run) throw fail("Pay run not found", 404);
      if (run.status !== "draft") throw fail("This pay run is approved — reopen it to change anything.");
      const set: Partial<typeof payRunItems.$inferInsert> = { updatedAt: new Date() };
      if (b.clearLop) Object.assign(set, { lopOverride: false, lopReason: null });
      else if (b.lopDays !== undefined) Object.assign(set, { lopDays: String(b.lopDays), lopOverride: true, lopReason: b.lopReason });
      if (b.adjustments) set.adjustments = b.adjustments;
      if (b.onHold !== undefined) set.onHold = b.onHold;
      const upd = await tx.update(payRunItems).set(set)
        .where(and(eq(payRunItems.tenantId, session.tenantId), eq(payRunItems.payRunId, id), eq(payRunItems.id, itemId)))
        .returning({ userId: payRunItems.userId });
      if (!upd.length) throw fail("Not on this pay run", 404);
      await calculateRun(tx, actorOf(session), id);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.item_changed",
        entityType: "pay_run", entityId: id, after: { userId: upd[0].userId, fields: Object.keys(b) },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
