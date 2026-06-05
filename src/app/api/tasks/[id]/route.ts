import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-task endpoints.
 *
 *   GET    /api/tasks/[id]   — fetch one task
 *   PATCH  /api/tasks/[id]   — update status, priority, due, assignee
 *   DELETE /api/tasks/[id]   — soft cancel (status='cancelled')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, users } from "@/db/schema";

export const dynamic = "force-dynamic";

/** A view.assigned/edit.assigned user may only touch tasks they own. */
function ownsTask(task: { assigneeId: string | null; createdById: string | null }, userId: string): boolean {
  return task.assigneeId === userId || task.createdById === userId;
}

/** Advance a date by one recurrence cadence. */
function advanceDue(base: Date, freq: string): Date {
  const d = new Date(base);
  switch (freq) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

const Patch = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  slaDueAt: z.string().nullable().optional(),
  // Module 18 — explicit related entity + department + remarks
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z
    .enum([
      "sales",
      "operations",
      "back_office",
      "compliance",
      "marketing",
      "advisory",
      "support",
      "leadership",
      "other",
    ])
    .optional(),
  remarks: z.string().max(20000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Assigned-only viewers can't read other people's tasks.
    if (!canViewAll && !ownsTask(row, session.userId)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);

    const patch: any = { ...parse.data, updatedAt: new Date() };
    if (parse.data.status === "completed" && !patch.completedAt) patch.completedAt = new Date();
    // Drizzle timestamp columns require Date objects — coerce the ISO strings
    // the client sends (passing a raw string makes Drizzle call .toISOString()
    // on it and throw a 500). An invalid string clears the value.
    for (const k of ["dueAt", "slaDueAt"] as const) {
      const v = patch[k];
      if (typeof v === "string") {
        const d = new Date(v);
        if (isNaN(d.getTime())) {
          if (k === "slaDueAt") patch[k] = null;
          else delete patch[k];
        } else {
          patch[k] = d;
        }
      }
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0];
      if (!before) return null;
      // Assigned-only editors may only touch their own tasks.
      if (!canEditAll && !ownsTask(before, session.userId)) {
        return { forbidden: true as const };
      }
      // A reassignment target must be a user in this tenant.
      if (parse.data.assigneeId !== undefined) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.assigneeId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return { badAssignee: true as const };
      }
      const after = await tx
        .update(tasks)
        .set(patch)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.update",
        entityType: "task",
        entityId: id,
        before: { status: before.status, assigneeId: before.assigneeId } as any,
        after: parse.data as any,
        ...clientMeta,
      });

      // ── Notifications ─────────────────────────────────────────────────
      // Look up the actor's name once if we'll emit anything.
      const willReassign =
        parse.data.assigneeId !== undefined &&
        parse.data.assigneeId !== before.assigneeId &&
        parse.data.assigneeId !== session.userId;
      const willNotifyCreator =
        parse.data.status !== undefined &&
        parse.data.status !== before.status &&
        !!before.createdById &&
        before.createdById !== session.userId;
      if (willReassign || willNotifyCreator) {
        const actor = (
          await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1)
        )[0];
        const actorName = actor?.name ?? "A teammate";

        // (1) Reassigned → notify the NEW assignee.
        if (willReassign) {
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: parse.data.assigneeId!,
            kind: "task.assigned",
            title: `Task assigned: ${before.title}`,
            body: `${actorName} assigned this task to you`,
            linkUrl: "/dashboard/tasks?view=assigned_to_me",
            severity: "info",
            meta: { task_id: id, assigned_by: session.userId, from_assignee: before.assigneeId },
          });
        }

        // (2) Status changed by someone other than the creator → notify the creator.
        if (willNotifyCreator) {
          const human = (s: string) => s.replace(/_/g, " ");
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: before.createdById!,
            kind: "task.status_changed",
            title: `Task ${human(parse.data.status!)}: ${before.title}`,
            body: `${actorName} moved it from “${human(before.status)}” to “${human(parse.data.status!)}”`,
            linkUrl: "/dashboard/tasks?view=assigned_by_me",
            severity: parse.data.status === "completed" ? "success" : parse.data.status === "blocked" ? "warning" : "info",
            meta: { task_id: id, changed_by: session.userId, from_status: before.status, to_status: parse.data.status },
          });
        }
      }

      // ── Recurring tasks: chain-on-completion ──────────────────────────
      // When a recurring task is marked completed (and wasn't already), spawn
      // the next occurrence with its due date advanced — unless we've passed
      // the optional recurrence end date.
      let spawnedId: string | null = null;
      if (
        parse.data.status === "completed" &&
        before.status !== "completed" &&
        before.recurrence
      ) {
        const baseDue = before.dueAt ? new Date(before.dueAt as any) : new Date();
        const nextDue = advanceDue(baseDue, before.recurrence);
        const until = before.recurrenceUntil ? new Date(before.recurrenceUntil as any) : null;
        if (!until || nextDue <= until) {
          spawnedId = uuid();
          await tx.insert(tasks).values({
            id: spawnedId,
            tenantId: session.tenantId,
            subjectType: before.subjectType,
            subjectId: before.subjectId,
            relatedInvestorId: before.relatedInvestorId,
            relatedLeadId: before.relatedLeadId,
            relatedServiceRequestId: before.relatedServiceRequestId,
            relatedMeetingId: before.relatedMeetingId,
            department: before.department,
            type: before.type,
            title: before.title,
            description: before.description,
            priority: before.priority,
            status: "open",
            assigneeId: before.assigneeId,
            createdById: session.userId,
            dueAt: nextDue,
            recurrence: before.recurrence,
            recurrenceUntil: before.recurrenceUntil,
            recurrenceParentId: before.recurrenceParentId ?? before.id,
          } as any);
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "task.recurrence_spawn",
            entityType: "task",
            entityId: spawnedId,
            after: { from: id, dueAt: nextDue.toISOString(), recurrence: before.recurrence } as any,
            ...clientMeta,
          });
        }
      }

      return { ...after[0], spawnedNextId: spawnedId } as any;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "you can only edit tasks assigned to you" }, { status: 403 });
    if ("badAssignee" in result) return NextResponse.json({ error: "assignee not found in this firm" }, { status: 400 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1))[0];
      if (!before) return "not_found" as const;
      if (!canEditAll && !ownsTask(before, session.userId)) return "forbidden" as const;
      await tx
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.cancel",
        entityType: "task",
        entityId: id,
        ...clientMeta,
      });
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only cancel tasks assigned to you" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
