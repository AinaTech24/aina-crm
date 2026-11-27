/**
 * The SQL twins of ./due.ts. A task is overdue when `due_at < ${TASK_TODAY_START}` — its due date
 * has ended in India. Written as a plain comparison on the column so the due-date index still serves it.
 */

import { sql, type SQL } from "drizzle-orm";
import { WORKING_HOUR } from "./due";

/** Midnight at the start of today, India time. */
export const TASK_TODAY_START: SQL = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;

/**
 * What the overdue ALERT compares against: the same day boundary, but a date counts as ended only
 * from WORKING_HOUR the next morning — nobody is alerted at midnight.
 */
export const TASK_OVERDUE_ALERT_BEFORE: SQL = sql`(date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata') - make_interval(hours => ${sql.raw(String(WORKING_HOUR))})) AT TIME ZONE 'Asia/Kolkata')`;

/** The moment a task's due date ends in India — what "hours overdue" counts from. */
export function dueEndSql(column: SQL): SQL {
  return sql`((date_trunc('day', ${column} AT TIME ZONE 'Asia/Kolkata') + interval '1 day') AT TIME ZONE 'Asia/Kolkata')`;
}
