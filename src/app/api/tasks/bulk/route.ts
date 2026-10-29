import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/tasks/bulk — apply one action to many tasks at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "status"    value = open|in_progress|blocked|completed|cancelled
 *          = "priority"  value = low|normal|high|urgent
 *          = "assign"    value = userId (uuid)
 *          = "cancel"    (no value) → status = cancelled
 *
 * RBAC: task.edit.all updates any task in the tenant; task.edit.assigned users
 * may only bulk-edit tasks they own (assignee or creator) — enforced in the
 * WHERE clause so it can never touch someone else's task. Audited once.
 *
 * Each task gets what the single PATCH / DELETE give it: a status change keeps
 * its Business entry in step (syncTaskBusinessEntry), a requires-approval task
 * the caller may not sign off is sent for approval instead of completing, and
 * a reassigned task notifies its new assignee (task.assigned), and a status
 * change tells the creator and the watchers (task.status_changed).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { spawnNextOccurrence } from "@/lib/tasks/recurrence";
import { createNotification } from "@/lib/notifications/create";
import { syncTaskBusinessEntry } from "@/lib/business/create-entry";
import { notifyWatchers } from "@/lib/tasks/watchers";
import { tasks, users } from "@/db/schema";
import { taskInScopeSql } from "@/lib/tasks/scope";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "priority", "assign", "cancel", "delete", "reschedule"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    // Build the column patch from the requested action.
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (action === "cancel") {
      patch.status = "cancelled";
    } else if (action === "status") {
      const ok = ["open", "in_progress", "blocked", "completed", "cancelled"];
      if (!value || !ok.includes(value)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
      patch.status = value;
      if (value === "completed") patch.completedAt = new Date();
    } else if (action === "priority") {
      const ok = ["low", "normal", "high", "urgent"];
      if (!value || !ok.includes(value)) return NextResponse.json({ error: "invalid priority" }, { status: 400 });
      patch.priority = value;
    } else if (action === "reschedule") {
      const d = value ? new Date(value) : null;
      if (!d || isNaN(d.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });
      patch.dueAt = d;
      // A rescheduled task should re-arm its overdue alert.
      patch.overdueNotifiedAt = null;
    } else if (action === "assign") {
      if (!value) return NextResponse.json({ error: "value (userId) required" }, { status: 400 });
      if (!UUID_RE.test(value)) return NextResponse.json({ error: "value must be a user id" }, { status: 400 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // A reassignment target must be a user in THIS tenant.
      if (action === "assign") {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, value!), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("assignee not found in this firm"), { status: 400 });
        patch.assigneeId = value;
      }

      // Exclude already-trashed tasks from every bulk action.
      const conds: any[] = [eq(tasks.tenantId, session.tenantId), inArray(tasks.id, ids), isNull(tasks.deletedAt)];
      // Assigned-only editors can only touch their own tasks.
      if (!canEditAll) {
        conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
      } else {
        // edit.all reaches only tasks whose client / lead is in scope.
        conds.push(await taskInScopeSql(tx, session, "tasks"));
      }

      // Every task as it was, for the per-task follow-ups below.
      const beforeRows = await tx.select().from(tasks).where(and(...conds));
      const beforeById = new Map(beforeRows.map((t) => [t.id, t]));
      const entryCtx = { tenantId: session.tenantId, userId: session.userId, clientMeta: meta };
      const actorName = async () =>
        (await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1))[0]?.name ??
        "A teammate";

      // Bulk delete — soft-delete to Trash (recoverable), matching the single
      // delete. Permanent removal happens from the Trash bin.
      if (action === "delete") {
        const removed = await tx
          .update(tasks)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(and(...conds))
          .returning({ id: tasks.id });
        // Trashing a task cancels the Business entry it booked.
        for (const r of removed) {
          const before = beforeById.get(r.id);
          if (before) await syncTaskBusinessEntry(tx, entryCtx, before, "cancelled");
        }
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "task.bulk_delete",
          entityType: "task",
          entityId: session.tenantId,
          after: { count: removed.length, ids } as any,
          ...meta,
        });
        return { updated: removed.length, sentForApproval: 0 };
      }

      // The approval gate (single PATCH): only the task's creator or an
      // edit.all user may complete a requires-approval task that is not yet
      // approved. Anyone else's "done" submits it for approval instead.
      const gated =
        patch.status === "completed"
          ? beforeRows.filter(
              (t) => t.requiresApproval && t.approvalStatus !== "approved" && !(canEditAll || t.createdById === session.userId),
            )
          : [];
      if (gated.length > 0) {
        const gatedIds = gated.map((t) => t.id);
        await tx
          .update(tasks)
          .set({ approvalStatus: "pending", submittedAt: new Date(), updatedAt: new Date() } as any)
          .where(and(eq(tasks.tenantId, session.tenantId), inArray(tasks.id, gatedIds)));
        conds.push(notInArray(tasks.id, gatedIds));
        const by = await actorName();
        for (const t of gated) {
          if (!t.createdById || t.createdById === session.userId) continue;
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: t.createdById,
            kind: "task.approval_requested",
            title: `Approval needed: ${t.title}`,
            body: `${by} submitted this task for your approval`,
            severity: "info",
            linkUrl: "/dashboard/tasks?approval=mine",
            meta: { task_id: t.id },
          });
        }
      }

      // Recurring chain-on-completion: capture the in-scope recurring tasks that
      // are about to transition INTO completed (before the update erases their
      // prior status) so we can spawn each next occurrence — matching the
      // single-task PATCH. Without this, bulk-completing a recurring task
      // silently ended the series.
      const toChain =
        action === "status" && patch.status === "completed"
          ? await tx
              .select()
              .from(tasks)
              .where(and(...conds, sql`recurrence is not null`, sql`status <> 'completed'`))
          : [];

      const updated = await tx
        .update(tasks)
        .set(patch as any)
        .where(and(...conds))
        .returning({ id: tasks.id });

      for (const t of toChain) {
        await spawnNextOccurrence(tx, t as any, session.userId, meta);
      }

      // A task that booked a Business entry keeps it in step, as on the single
      // PATCH: completed → confirmed, cancelled → cancelled, reopened → draft.
      if (patch.status) {
        for (const u of updated) {
          const before = beforeById.get(u.id);
          if (!before || before.status === patch.status) continue;
          if (patch.status === "completed") await syncTaskBusinessEntry(tx, entryCtx, before, "completed");
          else if (patch.status === "cancelled") await syncTaskBusinessEntry(tx, entryCtx, before, "cancelled");
          else if (before.status === "cancelled" || before.status === "completed")
            await syncTaskBusinessEntry(tx, entryCtx, before, "reopened");
        }

        // The creator (when someone else moved it) and the watchers hear of the
        // change, as on the single PATCH.
        const human = (st: string) => st.replace(/_/g, " ");
        const to = patch.status as string;
        let by: string | null = null;
        for (const u of updated) {
          const before = beforeById.get(u.id);
          if (!before || before.status === to) continue;
          by ??= await actorName();
          if (before.createdById && before.createdById !== session.userId) {
            await createNotification(tx, {
              tenantId: session.tenantId,
              userId: before.createdById,
              kind: "task.status_changed",
              title: `Task ${human(to)}: ${before.title}`,
              body: `${by} moved it from “${human(before.status)}” to “${human(to)}”`,
              linkUrl: "/dashboard/tasks?view=assigned_by_me",
              severity: to === "completed" ? "success" : to === "blocked" ? "warning" : "info",
              meta: { task_id: before.id, changed_by: session.userId, from_status: before.status, to_status: to },
            });
          }
          await notifyWatchers(tx, {
            tenantId: session.tenantId,
            taskId: before.id,
            exclude: new Set([session.userId, before.createdById ?? "", before.assigneeId ?? ""]),
            kind: "task.status_changed",
            title: `Task ${human(to)}: ${before.title}`,
            body: `${by} moved it to “${human(to)}”`,
            severity: to === "completed" ? "success" : "info",
          });
        }
      }

      // Reassigned → tell the new assignee, as the single PATCH does.
      if (action === "assign" && value !== session.userId) {
        const by = await actorName();
        for (const u of updated) {
          const before = beforeById.get(u.id);
          if (!before || before.assigneeId === value) continue;
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: value!,
            kind: "task.assigned",
            title: `Task assigned: ${before.title}`,
            body: `${by} assigned this task to you`,
            linkUrl: "/dashboard/tasks?view=assigned_to_me",
            severity: "info",
            meta: { task_id: before.id, assigned_by: session.userId, from_assignee: before.assigneeId },
          });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `task.bulk_${action}`,
        entityType: "task",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, sentForApproval: gated.length, ids } as any,
        ...meta,
      });
      return { updated: updated.length, sentForApproval: gated.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
