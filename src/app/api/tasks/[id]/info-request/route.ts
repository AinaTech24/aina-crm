import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/tasks/[id]/info-request — "Need information" on a task.
 *
 *   { action: "ask", question, askToId? }
 *       The assignee (or anyone working the task) asks a question. It goes to
 *       askToId, else whoever assigned the task. The task becomes `blocked`
 *       ("waiting for information"), the question is posted as a comment, and
 *       the person asked is notified — on their phone too.
 *   { action: "answer", answer }
 *       The person asked (or the task's creator / a manager) answers. The
 *       answer is posted as a comment, the task returns to the status it had,
 *       and whoever asked is notified.
 *
 * lib/tasks/info-request.ts holds the shape kept in tasks.meta.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, taskComments, users } from "@/db/schema";
import { openInfoRequest, type InfoRequest, type InfoRequestRecord } from "@/lib/tasks/info-request";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), question: z.string().trim().min(1).max(3000), askToId: z.string().uuid().optional() }),
  z.object({ action: z.literal("answer"), answer: z.string().trim().min(1).max(5000) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [task] = await tx
        .select({ title: tasks.title, status: tasks.status, meta: tasks.meta, assigneeId: tasks.assigneeId, createdById: tasks.createdById })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      const mine = task && (task.assigneeId === session.userId || task.createdById === session.userId
        || openInfoRequest(task.meta)?.askedToId === session.userId);
      if (!task || (!canViewAll && !mine)) return { status: 404, error: "not found" };
      if (task.status === "completed" || task.status === "cancelled") return { status: 400, error: "This task is already closed." };

      const nameOf = async (uid: string | null | undefined) =>
        uid ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, uid)).limit(1))[0]?.name ?? null : null;
      const me = await nameOf(session.userId);
      const open = openInfoRequest(task.meta);
      const taskLink = `/dashboard/tasks/${id}`;

      if (body.action === "ask") {
        if (open) return { status: 409, error: `Already waiting for ${open.askedToName ?? "an answer"} on this task.` };
        const askToId = body.askToId ?? task.createdById;
        if (!askToId) return { status: 400, error: "Choose who to ask." };
        if (askToId === session.userId) return { status: 400, error: "Choose someone other than yourself." };
        const [target] = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.id, askToId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!target) return { status: 400, error: "That person is not in your team." };

        const request: InfoRequest = {
          question: body.question,
          askedById: session.userId,
          askedByName: me,
          askedToId: target.id,
          askedToName: target.name,
          askedAt: new Date().toISOString(),
          prevStatus: task.status === "blocked" ? "in_progress" : task.status,
        };
        await tx.execute(sql`
          UPDATE tasks
             SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('infoRequest', ${JSON.stringify(request)}::jsonb),
                 status = 'blocked', updated_at = now()
           WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        `);
        await tx.insert(taskComments).values({
          tenantId: session.tenantId, taskId: id, authorId: session.userId,
          body: `Needs information from ${target.name}: ${body.question}`, mentions: [target.id],
        });
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: target.id,
          kind: "task.info_requested",
          title: `${me ?? "A teammate"} needs information: ${task.title}`,
          body: body.question.length > 140 ? `${body.question.slice(0, 140)}…` : body.question,
          linkUrl: taskLink,
          severity: "warning",
          meta: { task_id: id },
        });
        await recordAudit(tx, {
          tenantId: session.tenantId, actorUserId: session.userId, action: "task.info_requested",
          entityType: "task", entityId: id, after: { askedToId: target.id } as any, ...clientMeta,
        });
        return { status: 200, ok: true };
      }

      // answer
      if (!open) return { status: 409, error: "There is no open question on this task." };
      const mayAnswer = open.askedToId === session.userId || task.createdById === session.userId || canViewAll;
      if (!mayAnswer) return { status: 403, error: `Only ${open.askedToName ?? "the person asked"} can answer this.` };
      const record: InfoRequestRecord = {
        ...open, answer: body.answer, answeredById: session.userId, answeredAt: new Date().toISOString(),
      };
      await tx.execute(sql`
        UPDATE tasks
           SET meta = (COALESCE(meta, '{}'::jsonb) - 'infoRequest')
                      || jsonb_build_object('infoHistory', COALESCE(meta->'infoHistory', '[]'::jsonb) || ${JSON.stringify([record])}::jsonb),
               status = ${open.prevStatus || "in_progress"}, updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
      `);
      await tx.insert(taskComments).values({
        tenantId: session.tenantId, taskId: id, authorId: session.userId,
        body: `Answer: ${body.answer}`, mentions: [open.askedById],
      });
      if (open.askedById !== session.userId) {
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: open.askedById,
          kind: "task.info_answered",
          title: `${me ?? "A teammate"} answered your question: ${task.title}`,
          body: body.answer.length > 140 ? `${body.answer.slice(0, 140)}…` : body.answer,
          linkUrl: taskLink,
          severity: "info",
          meta: { task_id: id },
        });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "task.info_answered",
        entityType: "task", entityId: id, after: { askedById: open.askedById } as any, ...clientMeta,
      });
      return { status: 200, ok: true };
    });

    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
