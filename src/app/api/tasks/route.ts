import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, users } from "@/db/schema";

export const dynamic = "force-dynamic";

const DEPARTMENTS = [
  "sales",
  "operations",
  "back_office",
  "compliance",
  "marketing",
  "advisory",
  "support",
  "leadership",
  "other",
] as const;

const Body = z.object({
  title: z.string().min(2).max(300),
  description: z.string().optional(),
  type: z.string().default("follow_up"),
  subjectType: z
    .enum(["investor", "lead", "folio", "transaction", "family", "service_request", "compliance", "internal"])
    .default("internal"),
  subjectId: z.string().uuid().optional(),
  /** Module 18 — explicit related-entity ids (any combination). */
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  remarks: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** Initial status — lets the Kanban quick-add drop a card straight into a
   *  column. Defaults to 'open' for the normal create flow. */
  status: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).default("open"),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  /** Recurrence — null/omitted = one-off. */
  recurrence: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
  recurrenceUntil: z.string().optional(), // YYYY-MM-DD
  /** Action points (checklist) — optional at creation; stored in meta.checklist. */
  checklist: z
    .array(z.object({ id: z.string().max(64), text: z.string().min(1).max(500), done: z.boolean() }))
    .max(100)
    .optional(),
  /** Back-office classification (Finowise MIS) — stored in meta for the
   *  Back-Office Work report. */
  boParticular: z
    .enum(["purchase_rectified", "sip_rectified", "nj_redemption", "nj_wecare_switch", "pms"])
    .optional(),
  boChannel: z.enum(["online", "offline"]).optional(),
  boValue: z.number().min(0).max(1e12).optional(),
});

/**
 * Default SLA window by priority (hours from creation). The SLA stat + badges
 * were dead because nothing set slaDueAt on manual tasks — this gives every task
 * an internal response target so "SLA at risk" / breach surfacing actually works.
 * A workflow or the editor can still override slaDueAt explicitly.
 */
const SLA_HOURS_BY_PRIORITY: Record<string, number> = { urgent: 4, high: 24, normal: 72, low: 168 };

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      // Tenant predicate is mandatory (RLS-bypass); view.assigned users see
      // only their own (assignee/creator) tasks.
      const conds: any[] = [eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)];
      if (!canViewAll) {
        conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
      }
      return tx.select().from(tasks).where(and(...conds)).orderBy(desc(tasks.createdAt)).limit(200);
    });
    return NextResponse.json({ tasks: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    // Users without task.edit.all may only create tasks assigned to themselves.
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const assigneeId = body.assigneeId ?? session.userId;
    if (!canEditAll && assigneeId !== session.userId) {
      return NextResponse.json({ error: "you can only assign tasks to yourself" }, { status: 403 });
    }

    const id = uuid();
    // Derive subjectType/subjectId from the first related entity if the caller
    // didn't set one explicitly — keeps legacy queries working.
    let derivedType = body.subjectType;
    let derivedId = body.subjectId ?? null;
    if (!body.subjectId) {
      if (body.relatedInvestorId) {
        derivedType = "investor";
        derivedId = body.relatedInvestorId;
      } else if (body.relatedLeadId) {
        derivedType = "lead";
        derivedId = body.relatedLeadId;
      } else if (body.relatedServiceRequestId) {
        derivedType = "service_request";
        derivedId = body.relatedServiceRequestId;
      } else if (body.relatedMeetingId) {
        derivedType = "internal";
        derivedId = body.relatedMeetingId;
      }
    }

    await withTenant(session.tenantId, async (tx) => {
      // Assignee must be a user in THIS tenant (the FK allows any tenant's user).
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, assigneeId), eq(users.tenantId, session.tenantId)))
        .limit(1);
      if (!u) throw Object.assign(new Error("assignee not found in this firm"), { status: 400 });

      // Internal SLA target derived from priority (overridable later in the editor).
      const slaHours = SLA_HOURS_BY_PRIORITY[body.priority] ?? 72;
      const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);

      await tx.insert(tasks).values({
        id,
        tenantId: session.tenantId,
        subjectType: derivedType,
        subjectId: derivedId,
        relatedInvestorId: body.relatedInvestorId ?? null,
        relatedLeadId: body.relatedLeadId ?? null,
        relatedServiceRequestId: body.relatedServiceRequestId ?? null,
        relatedMeetingId: body.relatedMeetingId ?? null,
        department: body.department ?? null,
        type: body.type,
        title: body.title,
        description: body.description,
        remarks: body.remarks,
        priority: body.priority,
        status: body.status,
        assigneeId,
        createdById: session.userId,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        slaDueAt,
        recurrence: body.recurrence ?? null,
        recurrenceUntil: body.recurrenceUntil ?? null,
        // Chain root = this task itself when recurring.
        recurrenceParentId: body.recurrence ? id : null,
        meta: (() => {
          const m: Record<string, unknown> = {};
          if (body.checklist?.length) m.checklist = body.checklist.map((c) => ({ ...c, done: false }));
          if (body.boParticular) m.boParticular = body.boParticular;
          if (body.boChannel) m.boChannel = body.boChannel;
          if (body.boValue != null) m.boValue = body.boValue;
          return Object.keys(m).length ? m : undefined;
        })(),
      } as any);

      // NOTE: tasks intentionally emit NO events_outbox row (task.created/updated).
      // Tasks are an OUTPUT of automations (the create_task workflow action), not a
      // trigger — wiring task.* into the outbox would risk automation loops
      // (a rule that creates a task firing a rule that reacts to tasks). The
      // workflow-rules `tasks` module catalog exists for future use, but is
      // deliberately dormant. Revisit only with explicit loop guards.
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.create",
        entityType: "task",
        entityId: id,
        after: { title: body.title, type: body.type, assigneeId, priority: body.priority } as any,
        ...meta,
      });

      // Notify the assignee when someone *else* assigns them a task (no self-ping).
      if (assigneeId !== session.userId) {
        const actor = (
          await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1)
        )[0];
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: assigneeId,
          kind: "task.assigned",
          title: `New task: ${body.title}`,
          body: actor?.name ? `${actor.name} assigned this task to you` : "A task was assigned to you",
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: body.priority === "urgent" || body.priority === "high" ? "warning" : "info",
          meta: { task_id: id, assigned_by: session.userId, priority: body.priority },
        });
      }
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
