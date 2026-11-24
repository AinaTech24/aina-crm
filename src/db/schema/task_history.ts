import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { tasks } from "./tasks";

/**
 * One row per creation or edit of a task, written by the `tasks_record_history`
 * trigger (migration 0284) — never by application code. `changes` maps each
 * tracked column that changed to its old and new value. Read with
 * `loadTaskTimeline` (lib/tasks/history.ts).
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
    event: text("event", { enum: ["created", "updated"] }).notNull(),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    taskIdx: index("task_history_task_idx").on(t.tenantId, t.taskId, t.at),
  })
);
