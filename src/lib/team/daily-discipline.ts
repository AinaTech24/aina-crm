/**
 * The daily discipline loop (CEO review S8, 2026-10-26). SERVER-ONLY.
 *
 *   · Who has filled in today's Daily Job Tracker, for the people a manager
 *     can see (resolveDataAccess: firm, branch, team, own) — teamDay().
 *   · One reminder, at a time the firm sets, to each person who has not —
 *     runTrackerReminders(), from the task reminder scanner. Off until the
 *     firm sets a time (Settings → Daily tracker). Never on a Sunday or a
 *     firm holiday; never twice for a person-day.
 *   · The weekly team-review pack per manager: done, on time, overdue,
 *     escalations, QA results, tracker days, meetings and follow-ups —
 *     weeklyPack(), the page /dashboard/tasks/weekly-pack.
 *
 * "Submitted" is lib/daily-tracker.ts's rule: the day's row holds a focus item
 * or a reflection. Days are India days. The tracker is for the team, so an
 * owner is not expected to fill one in (they may).
 */

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import type { DataAccess } from "@/lib/dashboards/system/access";
import { createNotification } from "@/lib/notifications/create";
import { istDay, todayIst } from "@/lib/daily-tracker";
import { QA_REVIEW_TYPE } from "@/lib/qa/sampling";

export const TRACKER_KEY = "dailyTracker";

export const TrackerSettingsSchema = z.object({
  /** "HH:MM" India time; null = no reminder. */
  remindAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
});
export type TrackerSettings = z.infer<typeof TrackerSettingsSchema>;

export async function loadTrackerSettings(tx: Tx, tenantId: string): Promise<TrackerSettings> {
  const row = (await tx.execute(sql`
    SELECT settings -> ${TRACKER_KEY} AS v FROM dashboard_settings WHERE tenant_id = ${tenantId}::uuid
  `)).rows[0] as { v: unknown } | undefined;
  const parsed = TrackerSettingsSchema.safeParse(row?.v ?? {});
  return parsed.success ? parsed.data : TrackerSettingsSchema.parse({});
}

export async function saveTrackerSettings(tx: Tx, tenantId: string, userId: string, next: TrackerSettings): Promise<TrackerSettings> {
  const value = TrackerSettingsSchema.parse(next);
  await tx.execute(sql`
    INSERT INTO dashboard_settings (tenant_id, settings, updated_by, updated_at)
    VALUES (${tenantId}::uuid, jsonb_build_object(${TRACKER_KEY}::text, ${JSON.stringify(value)}::jsonb), ${userId}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET settings = COALESCE(dashboard_settings.settings, '{}'::jsonb) || jsonb_build_object(${TRACKER_KEY}::text, ${JSON.stringify(value)}::jsonb),
          updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
  return value;
}

/** The people expected to keep a tracker, within the viewer's access (alias u). */
function peopleScope(access: DataAccess): SQL {
  if (access.kind === "firm") return sql`TRUE`;
  if (access.kind === "branch") return sql`u.branch_id = ${access.branchId}::uuid`;
  if (access.kind === "team") return sql`u.id = ANY(${`{${access.memberIds.join(",")}}`}::uuid[])`;
  return sql`u.id = ${access.userId}::uuid`;
}

const EXPECTED = sql`u.status = 'active'
  AND NOT (COALESCE(u.roles, '{}'::text[]) && ARRAY['owner', 'platform_admin', 'platform_support']::text[])`;

/** "Submitted" for a daily_trackers row (alias d) — the SQL twin of trackerHasContent. */
const HAS_CONTENT = sql`(COALESCE(btrim(d.key_learning), '') <> '' OR COALESCE(btrim(d.breakdown), '') <> ''
  OR COALESCE(btrim(d.breakthrough), '') <> '' OR jsonb_array_length(COALESCE(d.today_focus, '[]'::jsonb)) > 0)`;

export type TeamDayRow = {
  id: string; name: string | null; submittedAt: string | null; focus: number;
  doneYesterday: number; overdueNow: number; meetingsYesterday: number; followUpsYesterday: number;
};

/** The team's tracker for one India day, not-submitted first. */
export async function teamDay(tx: Tx, tenantId: string, access: DataAccess, dateISO: string): Promise<TeamDayRow[]> {
  const start = istDay(dateISO);
  return (await tx.execute(sql`
    SELECT u.id::text AS id, u.name,
           CASE WHEN d.id IS NOT NULL AND ${HAS_CONTENT} THEN d.updated_at END AS "submittedAt",
           COALESCE(jsonb_array_length(d.today_focus), 0)::int AS focus,
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status = 'completed' AND t.completed_at >= ${start} - interval '1 day' AND t.completed_at < ${start}) AS "doneYesterday",
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status IN ('open', 'in_progress', 'blocked') AND t.due_at < ${start}) AS "overdueNow",
           (SELECT count(*)::int FROM review_meetings m WHERE m.tenant_id = u.tenant_id AND m.status = 'completed'
               AND (m.rm_id = u.id OR COALESCE(m.attendees, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('kind', 'user', 'refId', u.id::text)))
               AND m.meeting_date >= ${start} - interval '1 day' AND m.meeting_date < ${start}) AS "meetingsYesterday",
           (SELECT count(*)::int FROM activities a WHERE a.tenant_id = u.tenant_id AND a.owner_user_id = u.id
               AND a.occurred_at >= ${start} - interval '1 day' AND a.occurred_at < ${start}) AS "followUpsYesterday"
      FROM users u
      LEFT JOIN daily_trackers d ON d.tenant_id = u.tenant_id AND d.user_id = u.id AND d.tracker_date = ${dateISO}::date
     WHERE u.tenant_id = ${tenantId}::uuid AND ${EXPECTED} AND ${peopleScope(access)}
     ORDER BY (d.id IS NOT NULL AND ${HAS_CONTENT}), u.name
     LIMIT 500
  `)).rows as TeamDayRow[];
}

/** Minutes past midnight, India time. */
function istMinutes(now: Date): number {
  const [h, m] = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  return h * 60 + m;
}

/** Is a reminder due now? The firm's time has passed on a working day (not Sunday). */
export function reminderDue(remindAt: string | null, now: Date): boolean {
  if (!remindAt) return false;
  const weekday = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
  if (weekday === "Sun") return false;
  const [h, m] = remindAt.split(":").map(Number);
  return istMinutes(now) >= h * 60 + m;
}

/** One pass: remind, once each, the people who have not filled in today's tracker. */
export async function runTrackerReminders(tx: Tx, tenantId: string, now = new Date()): Promise<number> {
  const settings = await loadTrackerSettings(tx, tenantId);
  if (!reminderDue(settings.remindAt, now)) return 0;
  const today = todayIst(now);
  const holiday = (await tx.execute(sql`
    SELECT 1 FROM holidays WHERE tenant_id = ${tenantId}::uuid AND holiday_date = ${today}::date LIMIT 1
  `)).rows.length > 0;
  if (holiday) return 0;

  const due = (await tx.execute(sql`
    SELECT u.id::text AS id
      FROM users u
      LEFT JOIN daily_trackers d ON d.tenant_id = u.tenant_id AND d.user_id = u.id AND d.tracker_date = ${today}::date
     WHERE u.tenant_id = ${tenantId}::uuid AND ${EXPECTED}
       AND NOT (d.id IS NOT NULL AND ${HAS_CONTENT})
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.tenant_id = u.tenant_id AND n.user_id = u.id AND n.kind = 'djt.reminder' AND n.meta ->> 'date' = ${today}
       )
     LIMIT 1000
  `)).rows as Array<{ id: string }>;
  for (const p of due) {
    await createNotification(tx, {
      tenantId,
      userId: p.id,
      kind: "djt.reminder",
      title: "Fill in today's Daily Job Tracker",
      body: "Your completed work, meetings and follow-ups are already in — add today's focus.",
      linkUrl: "/dashboard/tasks/daily",
      meta: { date: today },
    });
  }
  return due.length;
}

/** The Monday (India) of the week holding `dateISO`, or of this week. */
export function mondayOf(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type PackRow = {
  id: string; name: string | null;
  done: number; doneWithDue: number; onTime: number; overdueNow: number;
  escalated: number; qaPassed: number; qaFailed: number;
  trackerDays: number; meetings: number; followUps: number;
};

/** The week (Monday to Monday, India) for each person the viewer can see. */
export async function weeklyPack(tx: Tx, tenantId: string, access: DataAccess, mondayISO: string): Promise<PackRow[]> {
  const from = istDay(mondayISO);
  const to = sql`${istDay(mondayISO)} + interval '7 days'`;
  return (await tx.execute(sql`
    SELECT u.id::text AS id, u.name,
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status = 'completed' AND t.completed_at >= ${from} AND t.completed_at < ${to}) AS done,
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status = 'completed' AND t.completed_at >= ${from} AND t.completed_at < ${to} AND t.due_at IS NOT NULL) AS "doneWithDue",
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status = 'completed' AND t.completed_at >= ${from} AND t.completed_at < ${to} AND t.due_at IS NOT NULL
               AND t.completed_at <= t.due_at) AS "onTime",
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND t.status IN ('open', 'in_progress', 'blocked') AND t.due_at < now()) AS "overdueNow",
           (SELECT count(*)::int FROM tasks t WHERE t.tenant_id = u.tenant_id AND t.assignee_id = u.id AND t.deleted_at IS NULL
               AND (t.meta -> 'escalation' -> 'l1' ->> 'at')::timestamptz >= ${from}
               AND (t.meta -> 'escalation' -> 'l1' ->> 'at')::timestamptz < ${to}) AS escalated,
           (SELECT count(*)::int FROM tasks q WHERE q.tenant_id = u.tenant_id AND q.type = ${QA_REVIEW_TYPE} AND q.deleted_at IS NULL
               AND q.meta ->> 'qaDoerId' = u.id::text AND q.meta -> 'qa' ->> 'result' = 'pass'
               AND (q.meta -> 'qa' ->> 'at')::timestamptz >= ${from} AND (q.meta -> 'qa' ->> 'at')::timestamptz < ${to}) AS "qaPassed",
           (SELECT count(*)::int FROM tasks q WHERE q.tenant_id = u.tenant_id AND q.type = ${QA_REVIEW_TYPE} AND q.deleted_at IS NULL
               AND q.meta ->> 'qaDoerId' = u.id::text AND q.meta -> 'qa' ->> 'result' = 'fail'
               AND (q.meta -> 'qa' ->> 'at')::timestamptz >= ${from} AND (q.meta -> 'qa' ->> 'at')::timestamptz < ${to}) AS "qaFailed",
           (SELECT count(*)::int FROM daily_trackers d WHERE d.tenant_id = u.tenant_id AND d.user_id = u.id
               AND d.tracker_date >= ${mondayISO}::date AND d.tracker_date < ${mondayISO}::date + 7 AND ${HAS_CONTENT}) AS "trackerDays",
           (SELECT count(*)::int FROM review_meetings m WHERE m.tenant_id = u.tenant_id AND m.status = 'completed'
               AND (m.rm_id = u.id OR COALESCE(m.attendees, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('kind', 'user', 'refId', u.id::text)))
               AND m.meeting_date >= ${from} AND m.meeting_date < ${to}) AS meetings,
           (SELECT count(*)::int FROM activities a WHERE a.tenant_id = u.tenant_id AND a.owner_user_id = u.id
               AND a.occurred_at >= ${from} AND a.occurred_at < ${to}) AS "followUps"
      FROM users u
     WHERE u.tenant_id = ${tenantId}::uuid AND ${EXPECTED} AND ${peopleScope(access)}
     ORDER BY u.name
     LIMIT 500
  `)).rows as PackRow[];
}

/** May the viewer open this person's tracker? Within their access, like every team view. */
export async function canSeePerson(tx: Tx, tenantId: string, access: DataAccess, userId: string): Promise<boolean> {
  if (access.kind === "firm") return true;
  const r = (await tx.execute(sql`
    SELECT 1 FROM users u WHERE u.tenant_id = ${tenantId}::uuid AND u.id = ${userId}::uuid AND ${peopleScope(access)} LIMIT 1
  `)).rows;
  return r.length > 0;
}
