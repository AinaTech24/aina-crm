/**
 * One pass of the escalation ladder for a firm (lib/tasks/escalation-ladder.ts).
 * SERVER-ONLY. Called every few minutes by workers/task-reminder-scanner.ts.
 *
 * For each still-open task that fell due after the ladder was switched on:
 * work out its rule and how many hours it is overdue; for each level it has
 * reached and not yet been escalated to, notify that level's people once,
 * record it on the task (meta.escalation: when, to whom) and in its change
 * log (audit `task.escalated`). A task that has reached every level its rule
 * defines is marked done and not looked at again.
 *
 *   level 1  the assignee's reporting manager
 *   level 2  the branch head(s) of the assignee's branch
 *   level 3  the owner(s)
 *
 * A level with nobody to tell (no reporting manager, no branch) is recorded
 * with an empty list, so it is not retried every pass. The assignee is never
 * escalated to about their own task.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { escalationState, levelsReached, loadLadder, ruleFor, type EscalationState, type Ladder, type Level } from "@/lib/tasks/escalation-ladder";

const LEVEL_NAME: Record<Level, string> = { 1: "reporting manager", 2: "branch head", 3: "owner" };

/** The smallest number of hours any rule escalates at — tasks overdue by less are skipped in SQL. */
function minHours(ladder: Ladder): number | null {
  const all = [ladder.fallback, ...ladder.rules].flatMap((r) => [r.l1Hours, r.l2Hours, r.l3Hours]).filter((h): h is number => h != null);
  return all.length ? Math.min(...all) : null;
}

export async function runEscalationLadder(tx: Tx, tenantId: string): Promise<number> {
  const ladder = await loadLadder(tx, tenantId);
  if (!ladder.enabled || !ladder.activeSince) return 0;
  const floor = minHours(ladder);
  if (floor == null) return 0;

  const rows = (await tx.execute(sql`
    SELECT t.id, t.title, t.department, t.type, t.priority, t.meta, t.assignee_id,
           u.name AS assignee_name, u.reporting_manager_id, u.branch_id,
           EXTRACT(EPOCH FROM (now() - t.due_at)) / 3600.0 AS hours_overdue
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
     WHERE t.tenant_id = ${tenantId}::uuid
       AND t.deleted_at IS NULL
       AND t.status IN ('open', 'in_progress', 'blocked')
       AND t.due_at IS NOT NULL
       AND t.due_at >= ${ladder.activeSince}::timestamptz
       AND t.due_at < now() - make_interval(hours => ${floor}::int)
       AND COALESCE(t.meta -> 'escalation' ->> 'done', 'false') <> 'true'
     ORDER BY t.due_at ASC
     LIMIT 500
  `)).rows as Array<{
    id: string; title: string; department: string | null; type: string | null; priority: string | null; meta: unknown;
    assignee_id: string | null; assignee_name: string | null; reporting_manager_id: string | null; branch_id: string | null;
    hours_overdue: string | number;
  }>;
  if (!rows.length) return 0;

  // People per level, looked up once per pass.
  const owners = ((await tx.execute(sql`
    SELECT id::text AS id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND roles @> ARRAY['owner']::text[]
  `)).rows as Array<{ id: string }>).map((r) => r.id);
  const activeIds = new Set(((await tx.execute(sql`
    SELECT id::text AS id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
  `)).rows as Array<{ id: string }>).map((r) => r.id));
  const headsByBranch = new Map<string, string[]>();
  const branchHeads = async (branchId: string | null) => {
    if (!branchId) return [];
    if (!headsByBranch.has(branchId)) {
      headsByBranch.set(branchId, ((await tx.execute(sql`
        SELECT id::text AS id FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
           AND roles @> ARRAY['branch_head']::text[] AND branch_id = ${branchId}::uuid
      `)).rows as Array<{ id: string }>).map((r) => r.id));
    }
    return headsByBranch.get(branchId)!;
  };

  let notified = 0;
  for (const r of rows) {
    const h = Number(r.hours_overdue);
    const rule = ruleFor(ladder, r);
    const reached = levelsReached(rule, h);
    const state: EscalationState = { ...escalationState(r.meta) };
    const fresh = reached.filter((l) => !state[`l${l}` as const]);
    const defined = ([1, 2, 3] as Level[]).filter((l) => rule[`l${l}Hours` as const] != null);
    if (!fresh.length && defined.every((l) => state[`l${l}` as const])) {
      await tx.execute(sql`UPDATE tasks SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('escalation', ${JSON.stringify({ ...state, done: true })}::jsonb)
        WHERE id = ${r.id}::uuid AND tenant_id = ${tenantId}::uuid`);
      continue;
    }
    if (!fresh.length) continue;

    const at = new Date().toISOString();
    for (const level of fresh) {
      const people =
        level === 1 ? (r.reporting_manager_id && activeIds.has(r.reporting_manager_id) ? [r.reporting_manager_id] : [])
        : level === 2 ? await branchHeads(r.branch_id)
        : owners;
      const to = [...new Set(people)].filter((id) => id !== r.assignee_id);
      for (const userId of to) {
        await createNotification(tx, {
          tenantId,
          userId,
          kind: "task.escalated",
          severity: level === 3 ? "critical" : "warning",
          title: `Escalated to you: ${r.title}`,
          body: `${r.assignee_name ?? "Unassigned"} — ${Math.floor(h)} hours overdue (level ${level}, ${LEVEL_NAME[level]}).`,
          linkUrl: `/dashboard/tasks/${r.id}`,
          meta: { task_id: r.id, level },
        });
        notified++;
      }
      state[`l${level}` as const] = { at, to };
      state.to = [...new Set([...(state.to ?? []), ...to])];
      await recordAudit(tx, {
        tenantId,
        actorUserId: null,
        actorType: "system",
        action: "task.escalated",
        entityType: "task",
        entityId: r.id,
        after: { level, to, hoursOverdue: Math.floor(h), rule: { department: rule.department, type: rule.type, priority: rule.priority } },
      });
    }
    const done = defined.every((l) => state[`l${l}` as const]);
    await tx.execute(sql`UPDATE tasks SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('escalation', ${JSON.stringify({ ...state, ...(done ? { done: true } : {}) })}::jsonb)
      WHERE id = ${r.id}::uuid AND tenant_id = ${tenantId}::uuid`);
  }
  return notified;
}
