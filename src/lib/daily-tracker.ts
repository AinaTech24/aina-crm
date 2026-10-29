/**
 * Daily Job Tracker (DJT) service.
 *
 * The DJT splits each day into "productive & completed" vs "non-productive &
 * incomplete" work, a key learning, today's plan, plus breakdown/breakthrough.
 * We DERIVE the two work lists from the user's tasks (completed yesterday vs
 * carried-over) and persist only the reflective + planning fields.
 *
 * Since 2026-10-26 (CEO review S8) the system also fills in the meetings the
 * person held and the follow-ups they logged the day before, so they add only
 * focus, learning and breakdown. Every "day" is the INDIA day (the server runs
 * on UTC): `istDay(date)` is that date's midnight in Asia/Kolkata. A tracker
 * is SUBMITTED once its row has a focus item or a reflection.
 */

import { sql } from "drizzle-orm";
import { attendeeIs } from "@/lib/review-meetings/attendees";

/** Midnight of an India date, as a timestamptz. */
export const istDay = (dateISO: string) => sql`(${dateISO}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`;

/** Today's date in India, YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type FocusItem = { text: string; taskId?: string; done?: boolean; forType?: "client" | "lead" | "other" };

export type DailyTrackerData = {
  date: string;
  keyLearning: string;
  breakdown: string;
  breakthrough: string;
  todayFocus: FocusItem[];
  completedYesterday: { id: string; title: string; for: string | null; at: string | null }[];
  incompleteCarried: { id: string; title: string; dueAt: string | null; priority: string }[];
  dueToday: { id: string; title: string; priority: string; for: string | null }[];
  /** Meetings the person held the day before (completed; as the RM or an attendee). */
  meetingsHeld: { id: string; title: string; for: string | null }[];
  /** Calls, notes and messages they logged the day before (activities). */
  followUpsLogged: { id: string; title: string; for: string | null }[];
  productivityPct: number;
  /** When the tracker was saved with something in it; null = not submitted. */
  submittedAt: string | null;
};

export async function loadDailyTracker(
  tx: Tx,
  tenantId: string,
  userId: string,
  dateISO: string
): Promise<DailyTrackerData> {
  const tr = await tx.execute(sql`
    SELECT key_learning, breakdown, breakthrough, today_focus, updated_at
    FROM daily_trackers
    WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND tracker_date = ${dateISO}::date
    LIMIT 1
  `);
  const saved = tr.rows[0] as any;

  // 1. Productive & completed — tasks the user finished the day before.
  const comp = await tx.execute(sql`
    SELECT t.id, t.title, t.completed_at, i.name AS investor_name, l.name AS lead_name
    FROM tasks t
    LEFT JOIN investors i ON i.id = t.related_investor_id
    LEFT JOIN leads l ON l.id = t.related_lead_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.assignee_id = ${userId}::uuid
      AND t.deleted_at IS NULL
      AND t.status = 'completed'
      AND t.completed_at >= ${istDay(dateISO)} - interval '1 day'
      AND t.completed_at <  ${istDay(dateISO)}
    ORDER BY t.completed_at DESC
    LIMIT 100
  `);

  // 2. Non-productive & incomplete — carried-over (overdue, still open).
  const inc = await tx.execute(sql`
    SELECT id, title, due_at, priority
    FROM tasks
    WHERE tenant_id = ${tenantId}::uuid AND assignee_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND status IN ('open','in_progress','blocked')
      AND due_at IS NOT NULL AND due_at < ${istDay(dateISO)}
    ORDER BY due_at ASC
    LIMIT 100
  `);

  // 4. Suggestions for "today's important work" — what's due today.
  const due = await tx.execute(sql`
    SELECT t.id, t.title, t.priority, i.name AS investor_name, l.name AS lead_name
    FROM tasks t
    LEFT JOIN investors i ON i.id = t.related_investor_id
    LEFT JOIN leads l ON l.id = t.related_lead_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.assignee_id = ${userId}::uuid
      AND t.deleted_at IS NULL
      AND t.status IN ('open','in_progress','blocked')
      AND t.due_at >= ${istDay(dateISO)} AND t.due_at < ${istDay(dateISO)} + interval '1 day'
    ORDER BY case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end
    LIMIT 100
  `);

  // Meetings held the day before — completed, with this person as the RM or an attendee.
  const meet = await tx.execute(sql`
    SELECT m.id, COALESCE(NULLIF(m.subject, ''), initcap(replace(m.meeting_type, '_', ' ')), 'Meeting') AS title, COALESCE(i.name, l.name) AS who
    FROM review_meetings m
    LEFT JOIN investors i ON i.id = m.investor_id
    LEFT JOIN leads l ON l.id = m.lead_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'completed'
      AND (m.rm_id = ${userId}::uuid OR ${attendeeIs("user", userId)})
      AND m.meeting_date >= ${istDay(dateISO)} - interval '1 day'
      AND m.meeting_date <  ${istDay(dateISO)}
    ORDER BY m.meeting_date
    LIMIT 100
  `);

  // Follow-ups logged the day before — calls, notes, messages (activities).
  const acts = await tx.execute(sql`
    SELECT a.id, a.kind, a.subject, a.subject_name
    FROM activities a
    WHERE a.tenant_id = ${tenantId}::uuid AND a.owner_user_id = ${userId}::uuid
      AND a.occurred_at >= ${istDay(dateISO)} - interval '1 day'
      AND a.occurred_at <  ${istDay(dateISO)}
    ORDER BY a.occurred_at
    LIMIT 100
  `);

  const completedYesterday = comp.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    for: r.investor_name ?? r.lead_name ?? null,
    at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  }));
  const incompleteCarried = inc.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    priority: r.priority,
  }));
  const dueToday = due.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    priority: r.priority,
    for: r.investor_name ?? r.lead_name ?? null,
  }));

  const meetingsHeld = meet.rows.map((r: any) => ({ id: String(r.id), title: r.title ?? "Meeting", for: r.who ?? null }));
  const followUpsLogged = acts.rows.map((r: any) => ({
    id: String(r.id),
    title: r.subject || `${String(r.kind ?? "note").replace(/_/g, " ")}`.replace(/^./, (c: string) => c.toUpperCase()),
    for: r.subject_name ?? null,
  }));

  const denom = completedYesterday.length + incompleteCarried.length;
  const productivityPct = denom > 0 ? Math.round((completedYesterday.length / denom) * 100) : 0;

  return {
    date: dateISO,
    keyLearning: saved?.key_learning ?? "",
    breakdown: saved?.breakdown ?? "",
    breakthrough: saved?.breakthrough ?? "",
    todayFocus: Array.isArray(saved?.today_focus) ? (saved.today_focus as FocusItem[]) : [],
    completedYesterday,
    incompleteCarried,
    dueToday,
    meetingsHeld,
    followUpsLogged,
    productivityPct,
    submittedAt: saved && trackerHasContent(saved) && saved.updated_at ? new Date(saved.updated_at).toISOString() : null,
  };
}

/** A saved tracker counts as submitted once it holds a focus item or a reflection. */
export function trackerHasContent(row: { key_learning?: string | null; breakdown?: string | null; breakthrough?: string | null; today_focus?: unknown }): boolean {
  return !!(row.key_learning?.trim() || row.breakdown?.trim() || row.breakthrough?.trim() || (Array.isArray(row.today_focus) && row.today_focus.length));
}

export async function saveDailyTracker(
  tx: Tx,
  tenantId: string,
  userId: string,
  dateISO: string,
  data: { keyLearning: string; breakdown: string; breakthrough: string; todayFocus: FocusItem[] }
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO daily_trackers (tenant_id, user_id, tracker_date, key_learning, breakdown, breakthrough, today_focus)
    VALUES (${tenantId}::uuid, ${userId}::uuid, ${dateISO}::date, ${data.keyLearning || null}, ${data.breakdown || null}, ${data.breakthrough || null}, ${JSON.stringify(data.todayFocus ?? [])}::jsonb)
    ON CONFLICT (tenant_id, user_id, tracker_date)
    DO UPDATE SET
      key_learning = excluded.key_learning,
      breakdown = excluded.breakdown,
      breakthrough = excluded.breakthrough,
      today_focus = excluded.today_focus,
      updated_at = now()
  `);
}

/**
 * Today's focus, suggested from the top of the RM's worklist (overdue first,
 * then due today — the order loadWorklist already sorts by). An empty plan is
 * the hardest one to start, so the tracker offers these in one tap.
 */
export function suggestFocusFromWorklist(
  items: Array<{ action: string; client: string | null; clientId: string | null; leadId: string | null; taskId: string | null; bucket: string }>,
  n = 3,
): FocusItem[] {
  return items
    .filter((i) => i.bucket !== "tomorrow")
    .slice(0, n)
    .map((i) => ({
      text: i.client ? `${i.action} — ${i.client}` : i.action,
      ...(i.taskId ? { taskId: i.taskId } : {}),
      forType: i.clientId ? "client" : i.leadId ? "lead" : "other",
    }));
}
