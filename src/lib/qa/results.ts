/**
 * QA checks: what is waiting for the viewer, and the results so far
 * (lib/qa/sampling.ts makes the checks). SERVER-ONLY.
 *
 * Results follow the dashboards' access rule (resolveDataAccess) over the
 * person whose work was checked: firm, their branch, their team, or their own.
 * The pass rate is passes ÷ checks with a result — a check still open, or
 * closed without a verdict, is not counted either way.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { DataAccess } from "@/lib/dashboards/system/access";
import { QA_CORRECTION_TYPE, QA_REVIEW_TYPE } from "./sampling";

export type OpenCheck = {
  id: string; dueAt: string | null; week: string | null;
  taskId: string; taskTitle: string; taskType: string; completedAt: string | null;
  doerName: string | null; clientName: string | null;
};

export async function openChecksFor(tx: Tx, tenantId: string, userId: string): Promise<OpenCheck[]> {
  return (await tx.execute(sql`
    SELECT q.id::text AS id, q.due_at AS "dueAt", q.meta ->> 'qaWeek' AS week,
           o.id::text AS "taskId", o.title AS "taskTitle", o.type AS "taskType", o.completed_at AS "completedAt",
           d.name AS "doerName", COALESCE(inv.name, l.name) AS "clientName"
      FROM tasks q
      JOIN tasks o ON o.id = (q.meta ->> 'qaOf')::uuid AND o.tenant_id = q.tenant_id
      LEFT JOIN users d ON d.id = (q.meta ->> 'qaDoerId')::uuid AND d.tenant_id = q.tenant_id
      LEFT JOIN investors inv ON inv.id = COALESCE(o.related_investor_id, CASE WHEN o.subject_type = 'investor' THEN o.subject_id END) AND inv.tenant_id = o.tenant_id
      LEFT JOIN leads l ON l.id = COALESCE(o.related_lead_id, CASE WHEN o.subject_type = 'lead' THEN o.subject_id END) AND l.tenant_id = o.tenant_id
     WHERE q.tenant_id = ${tenantId}::uuid AND q.type = ${QA_REVIEW_TYPE} AND q.deleted_at IS NULL
       AND q.assignee_id = ${userId}::uuid AND q.status IN ('open', 'in_progress', 'blocked')
     ORDER BY q.due_at NULLS LAST, q.created_at
     LIMIT 200
  `)).rows as OpenCheck[];
}

function doerScope(access: DataAccess): SQL {
  if (access.kind === "firm") return sql`TRUE`;
  if (access.kind === "branch") return sql`d.branch_id = ${access.branchId}::uuid`;
  if (access.kind === "team") return sql`d.id = ANY(${`{${access.memberIds.join(",")}}`}::uuid[])`;
  return sql`d.id = ${access.userId}::uuid`;
}

export type PersonResult = { doerId: string; doerName: string | null; checked: number; passed: number; failed: number; openCorrections: number };

/** Per person whose work was checked, over checks decided since `from`. */
export async function resultsByPerson(tx: Tx, tenantId: string, access: DataAccess, from: Date): Promise<PersonResult[]> {
  return (await tx.execute(sql`
    SELECT d.id::text AS "doerId", d.name AS "doerName",
           count(*)::int AS checked,
           count(*) FILTER (WHERE q.meta -> 'qa' ->> 'result' = 'pass')::int AS passed,
           count(*) FILTER (WHERE q.meta -> 'qa' ->> 'result' = 'fail')::int AS failed,
           (SELECT count(*)::int FROM tasks c
             WHERE c.tenant_id = ${tenantId}::uuid AND c.type = ${QA_CORRECTION_TYPE} AND c.deleted_at IS NULL
               AND c.assignee_id = d.id AND c.status IN ('open', 'in_progress', 'blocked')) AS "openCorrections"
      FROM tasks q
      JOIN users d ON d.id = (q.meta ->> 'qaDoerId')::uuid AND d.tenant_id = q.tenant_id
     WHERE q.tenant_id = ${tenantId}::uuid AND q.type = ${QA_REVIEW_TYPE} AND q.deleted_at IS NULL
       AND q.meta -> 'qa' ->> 'result' IN ('pass', 'fail')
       AND (q.meta -> 'qa' ->> 'at')::timestamptz >= ${from.toISOString()}::timestamptz
       AND ${doerScope(access)}
     GROUP BY d.id, d.name
     ORDER BY count(*) FILTER (WHERE q.meta -> 'qa' ->> 'result' = 'fail') DESC, d.name
  `)).rows as PersonResult[];
}

export type RecentFail = { taskId: string; taskTitle: string; doerName: string | null; reason: string | null; note: string | null; at: string; correctionId: string | null; correctionStatus: string | null };

export async function recentFails(tx: Tx, tenantId: string, access: DataAccess, from: Date, limit = 15): Promise<RecentFail[]> {
  return (await tx.execute(sql`
    SELECT o.id::text AS "taskId", o.title AS "taskTitle", d.name AS "doerName",
           q.meta -> 'qa' ->> 'reason' AS reason, q.meta -> 'qa' ->> 'note' AS note, q.meta -> 'qa' ->> 'at' AS at,
           c.id::text AS "correctionId", c.status AS "correctionStatus"
      FROM tasks q
      JOIN tasks o ON o.id = (q.meta ->> 'qaOf')::uuid AND o.tenant_id = q.tenant_id
      JOIN users d ON d.id = (q.meta ->> 'qaDoerId')::uuid AND d.tenant_id = q.tenant_id
      LEFT JOIN tasks c ON c.tenant_id = q.tenant_id AND c.type = ${QA_CORRECTION_TYPE} AND c.meta ->> 'qaReviewId' = q.id::text
     WHERE q.tenant_id = ${tenantId}::uuid AND q.type = ${QA_REVIEW_TYPE} AND q.deleted_at IS NULL
       AND q.meta -> 'qa' ->> 'result' = 'fail'
       AND (q.meta -> 'qa' ->> 'at')::timestamptz >= ${from.toISOString()}::timestamptz
       AND ${doerScope(access)}
     ORDER BY q.meta -> 'qa' ->> 'at' DESC
     LIMIT ${limit}
  `)).rows as RecentFail[];
}
