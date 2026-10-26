/**
 * QA sampling of completed work (CEO review S7, 2026-10-26). SERVER-ONLY.
 *
 * Every week, for each person, a firm-set share (default 5%) of the tasks they
 * completed the week before — of the task types the firm chose, or all — is
 * picked for a check by someone else:
 *
 *   checker = the person's reporting manager, else the branch head of their
 *             branch, else an owner (never the person themselves)
 *
 * A check IS a task (type `qa_review`, meta.qaOf = the task checked), so it
 * sits on the checker's desk, escalates and reports like any other. The
 * checker records Pass or Fail (+ reason, note) in the QA queue
 * (/dashboard/tasks/qa); that closes the check, stamps meta.qaResult on the
 * task checked, and on a Fail gives the doer a correction task
 * (`qa_correction`). Audited as `task.qa_reviewed`.
 *
 * Off until the firm switches it on (Settings → QA sampling). Stored in
 * dashboard_settings.settings.qaSampling, beside the escalation ladder.
 * The sample is deterministic per week (ordered by md5(task id || week)), and
 * a person already sampled for a week is never sampled twice.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";

export const QA_KEY = "qaSampling";
export const QA_REVIEW_TYPE = "qa_review";
export const QA_CORRECTION_TYPE = "qa_correction";

export const QaSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Share of each person's completed tasks to check, 1–100. */
  percent: z.coerce.number().int().min(1).max(100).default(5),
  /** Task types to sample; empty = every type. */
  types: z.array(z.string().max(60)).max(60).default([]),
});
export type QaSettings = z.infer<typeof QaSettingsSchema>;

export const QA_FAIL_REASONS = [
  "Steps skipped",
  "Wrong or missing document",
  "Data entered wrong",
  "Not done on time",
  "Client not kept informed",
  "Other",
] as const;

export async function loadQaSettings(tx: Tx, tenantId: string): Promise<QaSettings> {
  const row = (await tx.execute(sql`
    SELECT settings -> ${QA_KEY} AS qa FROM dashboard_settings WHERE tenant_id = ${tenantId}::uuid
  `)).rows[0] as { qa: unknown } | undefined;
  const parsed = QaSettingsSchema.safeParse(row?.qa ?? {});
  return parsed.success ? parsed.data : QaSettingsSchema.parse({});
}

export async function saveQaSettings(tx: Tx, tenantId: string, userId: string, next: QaSettings): Promise<QaSettings> {
  const value = QaSettingsSchema.parse(next);
  await tx.execute(sql`
    INSERT INTO dashboard_settings (tenant_id, settings, updated_by, updated_at)
    VALUES (${tenantId}::uuid, jsonb_build_object(${QA_KEY}::text, ${JSON.stringify(value)}::jsonb), ${userId}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET settings = COALESCE(dashboard_settings.settings, '{}'::jsonb) || jsonb_build_object(${QA_KEY}::text, ${JSON.stringify(value)}::jsonb),
          updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
  return value;
}

/** How many of n completed tasks to check at this share: rounded up, so one task still gets a check. */
export function sampleSize(n: number, percent: number): number {
  return n <= 0 ? 0 : Math.min(n, Math.ceil((n * percent) / 100));
}

/**
 * The India week before `now`: Monday 00:00 IST to the next Monday, and its
 * key ("2026-W43", ISO numbering).
 */
export function previousWeek(now: Date): { from: Date; to: Date; key: string } {
  const IST = 5.5 * 3600_000;
  const local = new Date(now.getTime() + IST);
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  const from = new Date(thisMonday - 7 * 86_400_000 - IST);
  const to = new Date(thisMonday - IST);
  // ISO week of that Monday: the week holding its Thursday.
  const thu = new Date(thisMonday - 7 * 86_400_000 + 3 * 86_400_000);
  const jan4 = Date.UTC(thu.getUTCFullYear(), 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  const week = Math.floor((thu.getTime() - week1Monday) / (7 * 86_400_000)) + 1;
  return { from, to, key: `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

/** Tomorrow-ish IST deadline: `days` from now at 18:00 India time. */
function dueInDays(days: number): Date {
  const IST = 5.5 * 3600_000;
  const local = new Date(Date.now() + IST + days * 86_400_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 18, 0) - IST);
}

/** One pass: sample last week's work for every person not yet sampled for it. Returns checks created. */
export async function runQaSampling(tx: Tx, tenantId: string, now = new Date()): Promise<number> {
  const qa = await loadQaSettings(tx, tenantId);
  if (!qa.enabled) return 0;
  const week = previousWeek(now);
  const typeFilter = qa.types.length ? sql`AND t.type = ANY(${`{${qa.types.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`}::text[])` : sql``;

  const doers = (await tx.execute(sql`
    SELECT t.assignee_id::text AS doer_id, u.name AS doer_name, u.reporting_manager_id::text AS manager_id, u.branch_id::text AS branch_id,
           array_agg(t.id::text ORDER BY md5(t.id::text || ${week.key})) AS task_ids
      FROM tasks t
      JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
     WHERE t.tenant_id = ${tenantId}::uuid
       AND t.deleted_at IS NULL
       AND t.status = 'completed'
       AND t.completed_at >= ${week.from.toISOString()}::timestamptz
       AND t.completed_at < ${week.to.toISOString()}::timestamptz
       AND t.type NOT IN (${QA_REVIEW_TYPE}, ${QA_CORRECTION_TYPE})
       AND NOT (COALESCE(t.meta, '{}'::jsonb) ? 'qaOf')
       ${typeFilter}
       AND NOT EXISTS (
         SELECT 1 FROM tasks q
          WHERE q.tenant_id = t.tenant_id AND q.type = ${QA_REVIEW_TYPE}
            AND q.meta ->> 'qaWeek' = ${week.key} AND q.meta ->> 'qaDoerId' = t.assignee_id::text
       )
     GROUP BY t.assignee_id, u.name, u.reporting_manager_id, u.branch_id
     LIMIT 500
  `)).rows as Array<{ doer_id: string; doer_name: string | null; manager_id: string | null; branch_id: string | null; task_ids: string[] }>;
  if (!doers.length) return 0;

  const active = new Map(((await tx.execute(sql`
    SELECT id::text AS id, roles, branch_id::text AS branch_id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
  `)).rows as Array<{ id: string; roles: string[] | null; branch_id: string | null }>).map((u) => [u.id, u]));
  const withRole = (role: string, branchId?: string | null) =>
    [...active.values()].filter((u) => (u.roles ?? []).includes(role) && (branchId === undefined || u.branch_id === branchId)).map((u) => u.id);

  let created = 0;
  for (const d of doers) {
    const checker =
      (d.manager_id && d.manager_id !== d.doer_id && active.has(d.manager_id) ? d.manager_id : null) ??
      withRole("branch_head", d.branch_id).find((id) => id !== d.doer_id) ??
      withRole("owner").find((id) => id !== d.doer_id) ??
      null;
    if (!checker) continue;
    const picked = d.task_ids.slice(0, sampleSize(d.task_ids.length, qa.percent));
    const originals = (await tx.execute(sql`
      SELECT id::text AS id, title, subject_type, subject_id::text AS subject_id,
             related_investor_id::text AS related_investor_id, related_lead_id::text AS related_lead_id,
             department, completed_at
        FROM tasks WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${`{${picked.join(",")}}`}::uuid[])
    `)).rows as Array<{ id: string; title: string; subject_type: string; subject_id: string; related_investor_id: string | null; related_lead_id: string | null; department: string | null; completed_at: string }>;
    for (const o of originals) {
      await tx.execute(sql`
        INSERT INTO tasks (tenant_id, subject_type, subject_id, related_investor_id, related_lead_id, department,
                           type, title, description, priority, status, assignee_id, due_at, meta)
        VALUES (${tenantId}::uuid, ${o.subject_type}, ${o.subject_id}::uuid, ${o.related_investor_id}::uuid, ${o.related_lead_id}::uuid, ${o.department},
                ${QA_REVIEW_TYPE}, ${`QA check: ${o.title}`.slice(0, 500)},
                ${`Check ${d.doer_name ?? "this"}'s work on "${o.title}". Record Pass or Fail in the QA queue (Tasks → QA queue).`},
                'normal', 'open', ${checker}::uuid, ${dueInDays(3).toISOString()}::timestamptz,
                ${JSON.stringify({ qaOf: o.id, qaDoerId: d.doer_id, qaWeek: week.key })}::jsonb)
      `);
      await tx.execute(sql`
        UPDATE tasks SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('qaSampledWeek', ${week.key}::text)
         WHERE id = ${o.id}::uuid AND tenant_id = ${tenantId}::uuid
      `);
      created++;
    }
    if (originals.length) {
      await createNotification(tx, {
        tenantId,
        userId: checker,
        kind: "task.qa_sampled",
        title: `${originals.length} QA check${originals.length === 1 ? "" : "s"}: ${d.doer_name ?? "a team member"}'s work`,
        body: `From last week (${week.key}). Record Pass or Fail for each.`,
        linkUrl: "/dashboard/tasks/qa",
        meta: { qaDoerId: d.doer_id, qaWeek: week.key },
      });
    }
  }
  return created;
}

export type QaResultInput = { result: "pass" | "fail"; reason?: string | null; note?: string | null };

/**
 * The checker's verdict. Closes the check, stamps the task checked, and on a
 * Fail gives the doer a correction task. Returns the correction task's id.
 */
export async function recordQaResult(
  tx: Tx,
  actor: { tenantId: string; userId: string; roles: string[] },
  reviewTaskId: string,
  input: QaResultInput,
): Promise<{ ok: true; correctionTaskId: string | null } | { error: string; status: number }> {
  const review = (await tx.execute(sql`
    SELECT id::text AS id, assignee_id::text AS assignee_id, status, meta FROM tasks
     WHERE id = ${reviewTaskId}::uuid AND tenant_id = ${actor.tenantId}::uuid AND type = ${QA_REVIEW_TYPE} AND deleted_at IS NULL
  `)).rows[0] as { id: string; assignee_id: string | null; status: string; meta: { qaOf?: string; qaDoerId?: string } | null } | undefined;
  if (!review?.meta?.qaOf) return { error: "QA check not found", status: 404 };
  if (review.assignee_id !== actor.userId && !actor.roles.includes("owner")) return { error: "Only the checker can record this result.", status: 403 };
  if (review.status === "completed" || review.status === "cancelled") return { error: "This check already has a result.", status: 409 };
  if (input.result === "fail" && !input.reason) return { error: "Pick a reason for the fail.", status: 400 };

  const original = (await tx.execute(sql`
    SELECT id::text AS id, title, assignee_id::text AS assignee_id, subject_type, subject_id::text AS subject_id,
           related_investor_id::text AS related_investor_id, related_lead_id::text AS related_lead_id, department
      FROM tasks WHERE id = ${review.meta.qaOf}::uuid AND tenant_id = ${actor.tenantId}::uuid
  `)).rows[0] as { id: string; title: string; assignee_id: string | null; subject_type: string; subject_id: string; related_investor_id: string | null; related_lead_id: string | null; department: string | null } | undefined;
  if (!original) return { error: "The task checked no longer exists.", status: 404 };

  const at = new Date().toISOString();
  const verdict = { result: input.result, reason: input.reason ?? null, note: input.note?.trim() || null, by: actor.userId, at };
  await tx.execute(sql`
    UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now(),
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('qa', ${JSON.stringify(verdict)}::jsonb)
     WHERE id = ${review.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
  `);
  await tx.execute(sql`
    UPDATE tasks SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('qaResult', ${JSON.stringify({ ...verdict, reviewTaskId: review.id })}::jsonb)
     WHERE id = ${original.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
  `);

  let correctionTaskId: string | null = null;
  const doer = review.meta.qaDoerId ?? original.assignee_id;
  if (input.result === "fail" && doer) {
    const row = (await tx.execute(sql`
      INSERT INTO tasks (tenant_id, subject_type, subject_id, related_investor_id, related_lead_id, department,
                         type, title, description, priority, status, assignee_id, created_by_id, due_at, meta)
      VALUES (${actor.tenantId}::uuid, ${original.subject_type}, ${original.subject_id}::uuid, ${original.related_investor_id}::uuid, ${original.related_lead_id}::uuid, ${original.department},
              ${QA_CORRECTION_TYPE}, ${`Correct: ${original.title}`.slice(0, 500)},
              ${`QA check failed — ${input.reason}.${verdict.note ? `\n\n${verdict.note}` : ""}`},
              'high', 'open', ${doer}::uuid, ${actor.userId}::uuid, ${dueInDays(2).toISOString()}::timestamptz,
              ${JSON.stringify({ qaOf: original.id, qaReviewId: review.id })}::jsonb)
      RETURNING id::text AS id
    `)).rows[0] as { id: string };
    correctionTaskId = row.id;
    await createNotification(tx, {
      tenantId: actor.tenantId,
      userId: doer,
      kind: "task.assigned",
      severity: "warning",
      title: `QA check failed: ${original.title}`,
      body: `${input.reason}. A correction task is on your list.`,
      linkUrl: `/dashboard/tasks/${row.id}`,
      meta: { task_id: row.id },
    });
  }

  await recordAudit(tx, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "task.qa_reviewed",
    entityType: "task",
    entityId: original.id,
    after: { ...verdict, reviewTaskId: review.id, correctionTaskId },
  });
  return { ok: true, correctionTaskId };
}
