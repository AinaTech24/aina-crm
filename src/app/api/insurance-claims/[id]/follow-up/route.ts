/**
 * POST /api/insurance-claims/:id/follow-up — schedule a claim's next action
 * (§38): a task linked to the claim (meta.claimId), the claimant as its
 * related client, due on the date given and assigned to whoever will do it.
 *
 * The CRM has no next-action field on a claim; the Claims Control Centre
 * reads a claim's earliest open follow-up as its next action, and a claim
 * with none is an exception. Creating one follows the task rules exactly:
 * `task.edit.all` to assign someone else, a same-firm assignee, and a
 * notification when someone else is given the work. It also needs
 * `insurance.write`, as any other change to a claim does.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { can, require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { insuranceClaims, investors, tasks, users } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(2).max(300).optional(),
  /** YYYY-MM-DD — the day it is due (end of that day, India time). */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  note: z.string().trim().max(1000).optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Give the follow-up a due date.", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    const assigneeId = body.assigneeId ?? session.userId;
    if (!can(session.roles, "task.edit.all", session.permissions) && assigneeId !== session.userId) {
      return NextResponse.json({ error: "You can only schedule a follow-up for yourself." }, { status: 403 });
    }
    const meta = clientMetaFromHeaders(req.headers);

    const taskId = await withTenant(session.tenantId, async (tx) => {
      const [claim] = await tx
        .select({ id: insuranceClaims.id, investorId: insuranceClaims.investorId, proposer: insuranceClaims.proposerName })
        .from(insuranceClaims)
        .where(and(eq(insuranceClaims.id, id), eq(insuranceClaims.tenantId, session.tenantId)))
        .limit(1);
      if (!claim) return null;
      const [u] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, assigneeId), eq(users.tenantId, session.tenantId))).limit(1);
      if (!u) throw Object.assign(new Error("That person is not in this firm."), { status: 400 });
      const client = claim.investorId
        ? (await tx.select({ name: investors.name }).from(investors)
            .where(and(eq(investors.id, claim.investorId), eq(investors.tenantId, session.tenantId))).limit(1))[0]?.name ?? claim.proposer
        : claim.proposer;

      const newId = uuid();
      const title = body.title ?? `Claim follow-up — ${client}`;
      const dueAt = new Date(`${body.dueDate}T18:00:00+05:30`);
      await tx.insert(tasks).values({
        id: newId,
        tenantId: session.tenantId,
        subjectType: claim.investorId ? "investor" : "internal",
        subjectId: claim.investorId ?? null,
        relatedInvestorId: claim.investorId ?? null,
        department: "support",
        type: "claim_follow_up",
        title,
        description: body.note ?? null,
        priority: body.priority,
        status: "open",
        assigneeId,
        createdById: session.userId,
        dueAt,
        slaDueAt: dueAt,
        meta: { claimId: claim.id },
      } as typeof tasks.$inferInsert);
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId,
        action: "task.create", entityType: "task", entityId: newId,
        after: { title, type: "claim_follow_up", assigneeId, priority: body.priority, claimId: claim.id } as Record<string, unknown>,
        ...meta,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId,
        action: "insurance_claim.follow_up", entityType: "insurance_claim", entityId: claim.id,
        after: { taskId: newId, title, dueDate: body.dueDate, assigneeId } as Record<string, unknown>,
        ...meta,
      });
      if (assigneeId !== session.userId) {
        const actor = (await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1))[0];
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: assigneeId,
          kind: "task.assigned",
          title: `Claim follow-up: ${client}`,
          body: actor?.name ? `${actor.name} scheduled this for ${body.dueDate}` : `Due ${body.dueDate}`,
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: body.priority === "urgent" || body.priority === "high" ? "warning" : "info",
          meta: { task_id: newId, claim_id: claim.id, assigned_by: session.userId, priority: body.priority },
        });
      }
      return newId;
    });
    if (!taskId) return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    return NextResponse.json({ id: taskId }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
