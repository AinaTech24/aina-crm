/**
 * Bottlenecks (CEO review S10, 2026-10-24) — where work waits. SERVER-ONLY.
 *
 * Two journeys keep a stage history today:
 *   · Lead → client (lead_stage_history) — the sales SOP AND the client's
 *     onboarding (KYC, UCC, mandate, first transaction)
 *   · Opportunities (blueprint_stage_history, subject_type 'opportunity')
 * A stay is one time a case entered a stage; lib/reports/bottlenecks-core.ts
 * turns the stays into medians, 90th percentiles and the cases stuck longest.
 *
 * Person = the case's owner (leads.owner_id, client_opportunities.owner_id);
 * branch = the lead's branch, or the opportunity's client's branch. What the
 * viewer sees follows the dashboards' rule (resolveDataAccess): firm, branch,
 * their team, or their own.
 *
 * Tasks are the third view: for each task type, how long a task takes from
 * creation to done, how often it is finished late, and what is open now —
 * by the assignee.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { DataAccess } from "@/lib/dashboards/system/access";
import { median, percentile, type Stay } from "./bottlenecks-core";

export const JOURNEYS = {
  leads: { label: "Lead to client", href: (id: string) => `/dashboard/leads/${id}` },
  opportunities: { label: "Opportunities", href: (id: string) => `/dashboard/opportunities/${id}` },
} as const;
export type JourneyKey = keyof typeof JOURNEYS;

/** The scope over an owner column and a branch column. */
function ownerScope(access: DataAccess, ownerCol: string, branchCol: string): SQL {
  if (access.kind === "firm") return sql`TRUE`;
  if (access.kind === "branch") return sql`${sql.raw(branchCol)} = ${access.branchId}::uuid`;
  if (access.kind === "team") return sql`${sql.raw(ownerCol)} = ANY(${`{${access.memberIds.join(",")}}`}::uuid[])`;
  return sql`${sql.raw(ownerCol)} = ${access.userId}::uuid`;
}

type StayRow = {
  stage_key: string; stage_name: string | null; stage_order: number | null; sla_days: number | null;
  subject_id: string; subject_name: string | null; branch_id: string | null; branch_name: string | null;
  person_id: string | null; person_name: string | null; entered_at: string; exited_at: string | null;
};

const toStay = (journey: JourneyKey) => (r: StayRow): Stay => ({
  journey,
  stageKey: r.stage_key,
  stageName: r.stage_name ?? r.stage_key.replace(/_/g, " "),
  stageOrder: r.stage_order ?? 999,
  slaDays: r.sla_days,
  subjectId: r.subject_id,
  subjectName: r.subject_name,
  branchId: r.branch_id,
  branchName: r.branch_name,
  personId: r.person_id,
  personName: r.person_name,
  enteredAt: new Date(r.entered_at),
  exitedAt: r.exited_at ? new Date(r.exited_at) : null,
});

/**
 * Every stay that ended on or after `from`, plus every stay a still-running
 * case is in now. A case that has finished (won, lost, closed), or sits in a
 * stage with no way onward, is never "waiting" there. (A WON lead is: its
 * onboarding is the way onward, and a won lead whose onboarding never
 * started is exactly the kind of wait this report is for.)
 */
export async function loadStays(tx: Tx, tenantId: string, access: DataAccess, journey: JourneyKey, from: Date): Promise<Stay[]> {
  const fromIso = from.toISOString();
  if (journey === "leads") {
    const rows = (await tx.execute(sql`
      SELECT h.stage_key, st.stage_name, st.stage_order, st.sla_days,
             l.id::text AS subject_id, l.name AS subject_name,
             b.id::text AS branch_id, b.name AS branch_name,
             u.id::text AS person_id, u.name AS person_name,
             h.entered_at, h.exited_at
        FROM lead_stage_history h
        JOIN lead_blueprint_instances i ON i.id = h.instance_id AND i.tenant_id = h.tenant_id
        JOIN leads l ON l.id = h.lead_id AND l.tenant_id = h.tenant_id
        LEFT JOIN blueprint_stages st ON st.blueprint_id = i.blueprint_id AND st.stage_key = h.stage_key
        LEFT JOIN users u ON u.id = l.owner_id AND u.tenant_id = l.tenant_id
        LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = l.tenant_id
       WHERE h.tenant_id = ${tenantId}::uuid
         AND COALESCE(l.lost_reason, '') <> '__deleted__'
         AND (h.exited_at >= ${fromIso}::timestamptz
              OR (h.exited_at IS NULL AND i.status = 'in_progress' AND i.current_stage_key = h.stage_key
                  AND EXISTS (SELECT 1 FROM blueprint_transitions bt
                               WHERE bt.blueprint_id = i.blueprint_id AND bt.from_stage_key = h.stage_key)))
         AND ${ownerScope(access, "l.owner_id", "l.branch_id")}
       LIMIT 50000
    `)).rows as StayRow[];
    return rows.map(toStay("leads"));
  }
  const rows = (await tx.execute(sql`
    SELECT h.stage_key, st.stage_name, st.stage_order, st.sla_days,
           o.id::text AS subject_id, concat_ws(' — ', inv.name, replace(o.product, '_', ' ')) AS subject_name,
           b.id::text AS branch_id, b.name AS branch_name,
           u.id::text AS person_id, u.name AS person_name,
           h.entered_at, h.exited_at
      FROM blueprint_stage_history h
      JOIN blueprint_instances i ON i.id = h.instance_id AND i.tenant_id = h.tenant_id
      JOIN client_opportunities o ON o.id = h.subject_id AND o.tenant_id = h.tenant_id
      JOIN investors inv ON inv.id = o.investor_id AND inv.tenant_id = o.tenant_id
      LEFT JOIN blueprint_stages st ON st.blueprint_id = i.blueprint_id AND st.stage_key = h.stage_key
      LEFT JOIN users u ON u.id = o.owner_id AND u.tenant_id = o.tenant_id
      LEFT JOIN branches b ON b.id = inv.branch_id AND b.tenant_id = inv.tenant_id
     WHERE h.tenant_id = ${tenantId}::uuid
       AND h.subject_type = 'opportunity'
       AND inv.deleted_at IS NULL
       AND (h.exited_at >= ${fromIso}::timestamptz
            OR (h.exited_at IS NULL AND i.status = 'in_progress' AND i.current_stage_key = h.stage_key
                  AND EXISTS (SELECT 1 FROM blueprint_transitions bt
                               WHERE bt.blueprint_id = i.blueprint_id AND bt.from_stage_key = h.stage_key)))
       AND ${ownerScope(access, "o.owner_id", "inv.branch_id")}
     LIMIT 50000
  `)).rows as StayRow[];
  return rows.map(toStay("opportunities"));
}

export type TaskTypeStat = {
  type: string;
  done: number;
  medianDays: number | null;
  p90Days: number | null;
  /** Of the finished tasks that had a due date, how many finished after it. */
  late: number;
  withDue: number;
  open: number;
  overdue: number;
};

/** Per task type: time from creation to done, late finishes, and what is open now. */
export async function loadTaskTurnaround(tx: Tx, tenantId: string, access: DataAccess, from: Date): Promise<TaskTypeStat[]> {
  const rows = (await tx.execute(sql`
    SELECT t.type, t.status, t.created_at, t.completed_at, t.due_at
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
     WHERE t.tenant_id = ${tenantId}::uuid
       AND t.deleted_at IS NULL
       AND ((t.status = 'completed' AND t.completed_at >= ${from.toISOString()}::timestamptz)
            OR t.status IN ('open', 'in_progress', 'blocked'))
       AND ${ownerScope(access, "t.assignee_id", "u.branch_id")}
     LIMIT 100000
  `)).rows as Array<{ type: string; status: string; created_at: string; completed_at: string | null; due_at: string | null }>;

  const now = Date.now();
  const by = new Map<string, { took: number[]; late: number; withDue: number; open: number; overdue: number }>();
  for (const r of rows) {
    const g = by.get(r.type) ?? { took: [], late: 0, withDue: 0, open: 0, overdue: 0 };
    by.set(r.type, g);
    if (r.status === "completed" && r.completed_at) {
      const done = new Date(r.completed_at).getTime();
      g.took.push(Math.max(0, (done - new Date(r.created_at).getTime()) / 86_400_000));
      if (r.due_at) {
        g.withDue++;
        if (done > new Date(r.due_at).getTime()) g.late++;
      }
    } else {
      g.open++;
      if (r.due_at && new Date(r.due_at).getTime() < now) g.overdue++;
    }
  }
  return [...by.entries()]
    .map(([type, g]) => ({
      type, done: g.took.length, medianDays: median(g.took), p90Days: percentile(g.took, 90),
      late: g.late, withDue: g.withDue, open: g.open, overdue: g.overdue,
    }))
    .sort((a, b) => (b.medianDays ?? -1) - (a.medianDays ?? -1) || b.overdue - a.overdue);
}
