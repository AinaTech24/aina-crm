/**
 * The task Timeline: when a task was created and by whom, and every later edit —
 * which field, from what to what, when, by whom. The rows are written by the
 * `tasks_record_history` trigger (migration 0284); this reads them, puts names
 * to the ids in them, and shapes them for GET /api/tasks/[id]/history.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { describeAttachment, describeChanges, describeComment, type ChangeLine, type RawChange, type TimelineLookups } from "./history-format";

export type TimelineEntry = {
  id: string;
  /** ISO instant. */
  at: string;
  /** Null = a system change (a workflow, a scanner). */
  actorName: string | null;
  event: HistoryEvent;
  changes: ChangeLine[];
};

export type HistoryEvent =
  | "created" | "updated"
  | "comment_added" | "comment_edited" | "comment_deleted"
  | "attachment_added" | "attachment_removed";

export type TaskTimeline = {
  entries: TimelineEntry[];
  /** The task predates field-level history: edits made before it was switched on are not itemised. */
  earlierEditsNotItemised: boolean;
};

const ID_FIELDS_USERS = ["assignee_id", "approved_by"];
const ID_FIELDS_INVESTORS = ["related_investor_id"];
const ID_FIELDS_LEADS = ["related_lead_id"];
const ID_FIELDS_SR = ["related_service_request_id"];
const ID_FIELDS_TASKS = ["blocked_by_task_id"];

/**
 * Attribute the changes made in this transaction to a person. withTenant /
 * withIdempotentMutation already do it when given the user; a route that opens
 * a plain `withTenant(tenantId, …)` calls this first thing in its callback.
 */
export async function actAs(tx: Tx, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
}

type Row = { id: string; actor_user_id: string | null; event: HistoryEvent; changes: Record<string, RawChange> | null; at: string | Date };

const asIso = (v: string | Date) => (v instanceof Date ? v : new Date(v)).toISOString();

export async function loadTaskTimeline(tx: Tx, tenantId: string, taskId: string): Promise<TaskTimeline | null> {
  const taskRows = (await tx.execute(sql`
    SELECT created_at, updated_at, created_by_id FROM tasks WHERE id = ${taskId}::uuid AND tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ created_at: string | Date; updated_at: string | Date; created_by_id: string | null }>;
  const task = taskRows[0];
  if (!task) return null;

  const rows = (await tx.execute(sql`
    SELECT id, actor_user_id, event, changes, at
      FROM task_history
     WHERE tenant_id = ${tenantId}::uuid AND task_id = ${taskId}::uuid
     ORDER BY at DESC, id DESC
     LIMIT 500
  `)).rows as unknown as Row[];

  const userIds = new Set<string>();
  const ids = { investors: new Set<string>(), leads: new Set<string>(), sr: new Set<string>(), tasks: new Set<string>() };
  const take = (set: Set<string>, v: unknown) => { if (typeof v === "string" && v) set.add(v); };
  if (task.created_by_id) userIds.add(task.created_by_id);
  for (const r of rows) {
    if (r.actor_user_id) userIds.add(r.actor_user_id);
    for (const [field, c] of Object.entries(r.changes ?? {})) {
      for (const v of [c?.from, c?.to]) {
        if (ID_FIELDS_USERS.includes(field)) take(userIds, v);
        else if (ID_FIELDS_INVESTORS.includes(field)) take(ids.investors, v);
        else if (ID_FIELDS_LEADS.includes(field)) take(ids.leads, v);
        else if (ID_FIELDS_SR.includes(field)) take(ids.sr, v);
        else if (ID_FIELDS_TASKS.includes(field)) take(ids.tasks, v);
        else if (field === "collaborator_ids" && Array.isArray(v)) {
          for (const id of v) take(userIds, id);
        }
        else if (field === "checklist" && Array.isArray(v)) {
          for (const item of v as Array<{ assigneeId?: string | null }>) take(userIds, item?.assigneeId);
        }
      }
    }
  }

  const list = (set: Set<string>) => (set.size ? sql.join([...set].map((i) => sql`${i}::uuid`), sql`, `) : null);
  const names = async (table: "users" | "investors" | "leads" | "service_requests" | "tasks", col: string, set: Set<string>) => {
    const inList = list(set);
    if (!inList) return [] as Array<{ id: string; label: string }>;
    // table and col are fixed strings from this file, never input.
    const r = await tx.execute(sql`
      SELECT id::text AS id, ${sql.raw(col)} AS label FROM ${sql.raw(table)}
       WHERE tenant_id = ${tenantId}::uuid AND id IN (${inList})
    `);
    return r.rows as Array<{ id: string; label: string }>;
  };
  const [u, inv, ld, sr, tk] = await Promise.all([
    names("users", "name", userIds),
    names("investors", "name", ids.investors),
    names("leads", "name", ids.leads),
    names("service_requests", "ticket_no", ids.sr),
    names("tasks", "title", ids.tasks),
  ]);
  const lookups: TimelineLookups = {
    users: new Map(u.map((r) => [r.id, r.label])),
    records: new Map([...inv, ...ld, ...sr, ...tk].map((r) => [r.id, r.label])),
  };

  const entries: TimelineEntry[] = rows.map((r) => ({
    id: r.id,
    at: asIso(r.at),
    actorName: r.actor_user_id ? lookups.users.get(r.actor_user_id) ?? "A removed user" : null,
    event: r.event,
    changes:
      r.event === "created" ? []
      : r.event === "updated" ? describeChanges(r.changes, lookups)
      : r.event === "attachment_added" || r.event === "attachment_removed" ? describeAttachment(r.event, r.changes)
      : describeComment(r.event, r.changes),
  }))
    // An edit whose every change reads the same (two instants in one minute) says nothing.
    .filter((e) => e.event === "created" || e.changes.length > 0);

  // A task made before the history existed: its creation is on the task itself.
  const hasCreated = entries.some((e) => e.event === "created");
  if (!hasCreated) {
    entries.push({
      id: `created-${taskId}`,
      at: asIso(task.created_at),
      actorName: task.created_by_id ? lookups.users.get(task.created_by_id) ?? "A removed user" : null,
      event: "created",
      changes: [],
    });
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // …and if it has been edited since, those edits were not itemised.
  const editedSince = new Date(task.updated_at).getTime() - new Date(task.created_at).getTime() > 60_000;
  return { entries, earlierEditsNotItemised: !hasCreated && editedSince };
}
