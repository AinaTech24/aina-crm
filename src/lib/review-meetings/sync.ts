/**
 * What a meeting save does to the rest of the CRM, beyond its own row:
 *
 *   · attendees  — a looked-up attendee must be a real client / lead / team
 *                  member of this firm; anything else is kept as a guest. A
 *                  team member newly added hears about it (in-app).
 *   · action items — each one IS a task (Task module), created on the first
 *                  save rather than only when the meeting is completed. The row
 *                  carries the task id; editing the row edits the task,
 *                  removing it cancels the task. A finished task is never
 *                  reopened or rewritten from here.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { tasks } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { formatDate } from "@/lib/format";
import { roleForKind, type MeetingAttendee } from "./attendees";

type Tx = any;

export type ActionItemIn = { title: string; assigneeId?: string; dueAt?: string; taskId?: string };

const DONE = ["completed", "cancelled"];

/** Drop references that are not this firm's records; fill role / isExternal from the kind. */
export async function cleanAttendees(tx: Tx, tenantId: string, list: MeetingAttendee[]): Promise<MeetingAttendee[]> {
  const ids = (kind: string) => [...new Set(list.filter((a) => a.kind === kind && a.refId).map((a) => a.refId!))];
  const known = async (table: "users" | "investors" | "leads", want: string[]) => {
    if (want.length === 0) return new Set<string>();
    const r = await tx.execute(sql`
      SELECT id::text AS id FROM ${sql.raw(table)}
       WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(want.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
    return new Set((r.rows as Array<{ id: string }>).map((x) => x.id));
  };
  const [users, clients, leads] = await Promise.all([
    known("users", ids("user")), known("investors", ids("client")), known("leads", ids("lead")),
  ]);
  const ok = (a: MeetingAttendee) =>
    (a.kind === "user" && users.has(a.refId!)) || (a.kind === "client" && clients.has(a.refId!)) || (a.kind === "lead" && leads.has(a.refId!));
  const seen = new Set<string>();
  const out: MeetingAttendee[] = [];
  for (const a of list) {
    const name = a.name.trim();
    if (!name) continue;
    if (a.kind && a.kind !== "guest" && a.refId && ok(a)) {
      const key = `${a.kind}:${a.refId}`;
      if (seen.has(key)) continue; // the same person twice
      seen.add(key);
      out.push({ ...a, name, role: roleForKind(a.kind), isExternal: a.kind !== "user" });
    } else {
      // A typed guest, or a reference that does not resolve: keep the name only.
      const { refId: _drop, ...rest } = a;
      out.push({ ...rest, name, kind: "guest", role: a.role ?? "other", isExternal: true });
    }
  }
  return out;
}

/** Tell team members who were not on the meeting before that they now are. */
export async function notifyAddedTeam(tx: Tx, args: {
  tenantId: string; meetingId: string; actorId: string; title: string; when: Date;
  before: unknown; after: MeetingAttendee[];
}) {
  const had = new Set(
    (Array.isArray(args.before) ? (args.before as MeetingAttendee[]) : [])
      .filter((a) => a.kind === "user" && a.refId).map((a) => a.refId!),
  );
  for (const a of args.after) {
    if (a.kind !== "user" || !a.refId || had.has(a.refId) || a.refId === args.actorId) continue;
    await createNotification(tx, {
      tenantId: args.tenantId,
      userId: a.refId,
      kind: "meeting.attendee_added",
      title: `You're attending: ${args.title}`,
      body: formatDate(args.when, "dateTime"),
      linkUrl: `/dashboard/review-meetings/${args.meetingId}`,
      severity: "info",
      meta: { meeting_id: args.meetingId, added_by: args.actorId },
    });
  }
}

/**
 * Make the Task module match the meeting's action items. Returns the items
 * with every row carrying its task id — the caller stores that list.
 */
export async function syncActionItemTasks(tx: Tx, args: {
  tenantId: string;
  actorId: string;
  meeting: { id: string; rmId: string | null; investorId: string | null; leadId: string | null; actionItems: unknown };
  items: ActionItemIn[];
  meetingLabel: string;
}): Promise<ActionItemIn[]> {
  const { tenantId, actorId, meeting } = args;
  const prev = (Array.isArray(meeting.actionItems) ? meeting.actionItems : []) as ActionItemIn[];

  // Only active team members of this firm can be given a task.
  const wanted = [...new Set(args.items.map((i) => i.assigneeId).filter(Boolean) as string[])];
  const validAssignees = new Set<string>();
  if (wanted.length) {
    const r = await tx.execute(sql`
      SELECT id::text AS id FROM users
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
         AND NOT ('platform_admin' = ANY(roles))
         AND id IN (${sql.join(wanted.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
    for (const row of r.rows as Array<{ id: string }>) validAssignees.add(row.id);
  }
  const fallback = meeting.rmId ?? actorId;
  const assigneeOf = (i: ActionItemIn) => (i.assigneeId && validAssignees.has(i.assigneeId) ? i.assigneeId : fallback);
  const dueOf = (i: ActionItemIn) => (i.dueAt ? new Date(i.dueAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  // Rows removed from the meeting: their still-open tasks are cancelled.
  const kept = new Set(args.items.map((i) => i.taskId).filter(Boolean) as string[]);
  const dropped = prev.map((p) => p.taskId).filter((t): t is string => !!t && !kept.has(t));
  if (dropped.length) {
    await tx.execute(sql`
      UPDATE tasks SET status = 'cancelled', updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND related_meeting_id = ${meeting.id}::uuid
         AND id IN (${sql.join(dropped.map((t) => sql`${t}::uuid`), sql`, `)})
         AND status NOT IN (${sql.join(DONE.map((s) => sql`${s}`), sql`, `)})
    `);
  }

  const subjectType: "investor" | "lead" = meeting.leadId ? "lead" : "investor";
  const subjectId = meeting.leadId ?? meeting.investorId;
  const prevById = new Map(prev.filter((p) => p.taskId).map((p) => [p.taskId!, p]));
  const out: ActionItemIn[] = [];
  const notify: Array<{ userId: string; title: string; taskId: string }> = [];

  for (const it of args.items) {
    const title = it.title.trim();
    const assigneeId = assigneeOf(it);
    if (it.taskId && prevById.has(it.taskId)) {
      // Edit the task only while it is still open, and only the three things
      // this row controls. related_meeting_id pins it to THIS meeting's tasks.
      await tx.execute(sql`
        UPDATE tasks SET title = ${title}, assignee_id = ${assigneeId}::uuid, due_at = ${dueOf(it)}, updated_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND id = ${it.taskId}::uuid AND related_meeting_id = ${meeting.id}::uuid
           AND status NOT IN (${sql.join(DONE.map((s) => sql`${s}`), sql`, `)})
      `);
      if (prevById.get(it.taskId)!.assigneeId !== it.assigneeId && assigneeId !== actorId) {
        notify.push({ userId: assigneeId, title, taskId: it.taskId });
      }
      out.push({ ...it, title, assigneeId });
      continue;
    }
    const taskId = uuid();
    await tx.insert(tasks).values({
      id: taskId,
      tenantId,
      assigneeId,
      subjectType,
      subjectId,
      relatedInvestorId: meeting.investorId ?? null,
      relatedLeadId: meeting.leadId ?? null,
      relatedMeetingId: meeting.id,
      type: "review_action_item",
      title,
      description: `Action item from ${args.meetingLabel}.`,
      priority: "normal",
      status: "open",
      dueAt: dueOf(it),
      createdById: actorId,
    } as any);
    if (assigneeId !== actorId) notify.push({ userId: assigneeId, title, taskId });
    out.push({ ...it, title, assigneeId, taskId });
  }

  for (const n of notify) {
    await createNotification(tx, {
      tenantId,
      userId: n.userId,
      kind: "task.assigned",
      title: `New task: ${n.title}`,
      body: `From ${args.meetingLabel}`,
      linkUrl: "/dashboard/tasks?view=assigned_to_me",
      severity: "info",
      meta: { task_id: n.taskId, assigned_by: actorId, meeting_id: meeting.id },
    });
  }
  return out;
}
