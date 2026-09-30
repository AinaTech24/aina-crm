/**
 * Meetings and client reviews.
 *
 * MEETINGS are STAFF facts: they follow the RM who holds them
 * (review_meetings.rm_id), dated by the meeting date (India). The sheet's four
 * kinds map onto what a meeting records:
 *
 *   New meeting          category 'new'
 *   Review meeting       category 'review'
 *   Follow-up meeting    category 'follow_up'
 *   On-call discussion   meeting mode 'phone' — any category. The CRM has no
 *                        "on call" category, so this row overlaps the three
 *                        above; the card says so.
 *
 * Status buckets: Planned (scheduled, confirmed, in progress), Completed,
 * Rescheduled, and Cancelled / no-show.
 *
 * REVIEWS DUE are CLIENT facts: a live client's next review date
 * (investors.next_review_at, India date) — the same column the "reviews
 * overdue" count in Needs attention reads (attention.ts).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientWhere, staffWhere, type MetricPeriod, type MetricScope } from "./scope";

export const MEETING_KINDS = [
  { key: "new", label: "New meetings" },
  { key: "review", label: "Review meetings" },
  { key: "follow_up", label: "Follow-up meetings" },
  { key: "on_call", label: "On-call discussions" },
] as const;

export const MEETING_BUCKETS = [
  { key: "planned", label: "Planned", statuses: ["scheduled", "confirmed", "in_progress"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
  { key: "rescheduled", label: "Rescheduled", statuses: ["rescheduled"] },
  { key: "missed", label: "Cancelled / no-show", statuses: ["cancelled", "no_show"] },
] as const;

export type MeetingBucketKey = (typeof MEETING_BUCKETS)[number]["key"];
export type MeetingRow = { key: string; label: string; total: number } & Record<MeetingBucketKey, number>;

const bucketSql = sql.raw(`CASE ${MEETING_BUCKETS.map((b) =>
  `WHEN m.status IN (${b.statuses.map((s) => `'${s}'`).join(", ")}) THEN '${b.key}'`).join(" ")} ELSE 'planned' END`);

/** Meetings in the period by kind × status bucket. */
export async function getMeetingSummary(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<MeetingRow[]> {
  const rows = (await tx.execute(sql`
    SELECT m.category, (m.meeting_mode = 'phone') AS on_call, ${bucketSql} AS bucket, COUNT(*)::int AS n
      FROM review_meetings m
     WHERE m.tenant_id = ${scope.tenantId}::uuid
       AND (m.meeting_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${p.from}::date AND ${p.to}::date
       AND ${staffWhere(scope, sql`m.rm_id`)}
     GROUP BY 1, 2, 3
  `)).rows as Array<{ category: string; on_call: boolean; bucket: MeetingBucketKey; n: number }>;
  return MEETING_KINDS.map((k) => {
    const mine = rows.filter((r) => (k.key === "on_call" ? r.on_call : r.category === k.key));
    const row = { key: k.key, label: k.label, total: 0, planned: 0, completed: 0, rescheduled: 0, missed: 0 } as MeetingRow;
    for (const r of mine) { row[r.bucket] += Number(r.n); row.total += Number(r.n); }
    return row;
  });
}

export type ReviewDueRow = { id: string; name: string; rmId: string | null; nextReview: string; overdue: boolean };
export type ReviewsDue = {
  /** Next review date before today. */
  overdue: number;
  /** Today to the end of this calendar month. */
  dueThisMonth: number;
  /** Today and the next 30 days. */
  due30: number;
  /** Live clients with no next review date at all — a record gap. */
  unscheduled: number;
  /** The most pressing: overdue first (oldest), then due soonest. */
  rows: ReviewDueRow[];
};

const today = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const nextReview = sql`(i.next_review_at AT TIME ZONE 'Asia/Kolkata')::date`;

export async function getReviewsDue(tx: Tx, scope: MetricScope, limit = 8): Promise<ReviewsDue> {
  const monthEnd = sql`(date_trunc('month', ${today}) + interval '1 month - 1 day')::date`;
  const c = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${nextReview} < ${today})::int AS overdue,
      COUNT(*) FILTER (WHERE ${nextReview} BETWEEN ${today} AND ${monthEnd})::int AS month,
      COUNT(*) FILTER (WHERE ${nextReview} BETWEEN ${today} AND ${today} + 30)::int AS d30,
      COUNT(*) FILTER (WHERE i.next_review_at IS NULL)::int AS unscheduled
      FROM investors i WHERE ${clientWhere(scope, "i")}
  `)).rows[0] as Record<string, number> | undefined;
  const rows = limit > 0 ? (await tx.execute(sql`
    SELECT i.id, i.name, i.rm_id, to_char(${nextReview}, 'YYYY-MM-DD') AS next_review, (${nextReview} < ${today}) AS overdue
      FROM investors i
     WHERE ${clientWhere(scope, "i")} AND i.next_review_at IS NOT NULL AND ${nextReview} <= ${today} + 30
     ORDER BY ${nextReview} ASC
     LIMIT ${limit}
  `)).rows as Array<{ id: string; name: string; rm_id: string | null; next_review: string; overdue: boolean }> : [];
  return {
    overdue: Number(c?.overdue ?? 0),
    dueThisMonth: Number(c?.month ?? 0),
    due30: Number(c?.d30 ?? 0),
    unscheduled: Number(c?.unscheduled ?? 0),
    rows: rows.map((r) => ({ id: r.id, name: r.name, rmId: r.rm_id, nextReview: r.next_review, overdue: !!r.overdue })),
  };
}
