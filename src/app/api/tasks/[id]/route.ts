import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-task endpoints.
 *
 *   GET    /api/tasks/[id]   — fetch one task
 *   PATCH  /api/tasks/[id]   — update status, priority, due, assignee
 *   DELETE /api/tasks/[id]   — soft cancel (status='cancelled')
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

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
  remarks: z.string().max(1000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "task.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const patch: any = { ...parse.data, updatedAt: new Date() };
    if (parse.data.status === "completed" && !patch.completedAt) patch.completedAt = new Date();

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
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
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "task.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(eq(tasks.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.cancel",
        entityType: "task",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
