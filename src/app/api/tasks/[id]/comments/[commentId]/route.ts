import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/tasks/[id]/comments/[commentId] — edit a comment's text. Only its
 *        author, and only while they can still open the task. Newly @mentioned
 *        teammates are notified; the task Timeline records old and new text
 *        (migration 0286).
 * DELETE /api/tasks/[id]/comments/[commentId] — soft-delete a task comment.
 *        Allowed for the comment's author or any task.edit.all user (owner).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, taskComments, users } from "@/db/schema";
import { taskInScope } from "@/lib/tasks/scope";
import { actAs } from "@/lib/tasks/history";
import { ownsTaskThread } from "@/lib/tasks/comment-access";

export const dynamic = "force-dynamic";

const EditBody = z.object({
  body: z.string().trim().min(1).max(5000),
  /** Everyone mentioned in the new text — filtered to real tenant users server-side. */
  mentions: z.array(z.string().uuid()).max(30).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const parse = EditBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Write the comment (up to 5,000 characters)." }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      await actAs(tx, session.userId); // the task timeline credits this person
      const [task] = await tx
        .select({ title: tasks.title, assigneeId: tasks.assigneeId, createdById: tasks.createdById, meta: tasks.meta })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!task) return "not_found" as const;
      if (!canViewAll && !ownsTaskThread(task, session.userId)) return "not_found" as const;
      if (!(await taskInScope(tx, session, id))) return "not_found" as const;

      const here = and(
        eq(taskComments.id, commentId),
        eq(taskComments.taskId, id),
        eq(taskComments.tenantId, session.tenantId),
        isNull(taskComments.deletedAt)
      );
      const [before] = await tx.select().from(taskComments).where(here).limit(1).for("update");
      if (!before) return "not_found" as const;
      // Nobody rewrites another person's words, task.edit.all included.
      if (before.authorId !== session.userId) return "forbidden" as const;
      // Saving the same text is not an edit, so it is not marked "edited".
      if (before.body === parse.data.body) return { comment: before };

      let mentions: string[] = [];
      if (parse.data.mentions?.length) {
        const valid = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, parse.data.mentions), eq(users.tenantId, session.tenantId)));
        mentions = valid.map((v) => v.id);
      }

      const [updated] = await tx
        .update(taskComments)
        .set({ body: parse.data.body, mentions, updatedAt: new Date() })
        .where(here)
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.comment.edit",
        entityType: "task",
        entityId: id,
        after: { commentId } as any,
        ...clientMeta,
      });

      const added = mentions.filter((uid) => uid !== session.userId && !before.mentions.includes(uid));
      if (added.length) {
        const actorName =
          (await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1))[0]?.name ??
          "A teammate";
        const preview = updated.body.length > 90 ? updated.body.slice(0, 90) + "…" : updated.body;
        for (const uid of added) {
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: uid,
            kind: "task.mention",
            title: `${actorName} mentioned you: ${task.title}`,
            body: preview,
            linkUrl: `/dashboard/tasks/${id}`,
            severity: "info",
            meta: { task_id: id, comment_id: commentId },
          });
        }
      }

      return { comment: updated };
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only edit your own comments" }, { status: 403 });
    return NextResponse.json(outcome);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { id, commentId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      await actAs(tx, session.userId); // the task timeline credits this person
      const [c] = await tx
        .select({ authorId: taskComments.authorId })
        .from(taskComments)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, id), eq(taskComments.tenantId, session.tenantId)))
        .limit(1);
      if (!c) return "not_found" as const;
      if (!canEditAll && c.authorId !== session.userId) return "forbidden" as const;
      if (!(await taskInScope(tx, session, id))) return "not_found" as const;
      await tx
        .update(taskComments)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.comment.delete",
        entityType: "task",
        entityId: id,
        after: { commentId } as any,
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only delete your own comments" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
