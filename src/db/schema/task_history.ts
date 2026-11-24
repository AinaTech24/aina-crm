import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { tasks } from "./tasks";

/**
 * One row per creation or edit of a task, written by the `tasks_record_history`
 * trigger (migration 0284) — never by application code. `changes` maps each
 * tracked column that changed to its old and new value. Read with
 * `loadTaskTimeline` (lib/tasks/history.ts). Comments (migration 0286) write
 * their own rows: `comment_*` events with `changes.comment` = { from, to } text, and
 * attachments (migration 0287) `attachment_*` events with `changes.attachment` =
 * { from, to } where one side is { name, size, type } and the other null.
 */
export const taskHistory = pgTable(
  "task_history",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** Null = a system change (a workflow, a scanner). */
    actorUserId: uuid("actor_user_id"),
    event: text("event", { enum: ["created", "updated", "comment_added", "comment_edited", "comment_deleted", "attachment_added", "attachment_removed"] }).notNull(),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    taskIdx: index("task_history_task_idx").on(t.tenantId, t.taskId, t.at),
  })
);
