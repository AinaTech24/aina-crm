/**
 * The escalation ladder for overdue tasks (CEO review S4, 2026-10-24).
 *
 * "Overdue work sits until I find it." A firm sets, per department / task
 * type / priority, how many hours overdue a task climbs to:
 *
 *   level 1   the assignee's reporting manager (users.reporting_manager_id)
 *   level 2   the branch head(s) of the assignee's branch
 *   level 3   the owner(s)
 *
 * The task reminder scanner (workers/task-reminder-scanner.ts) notifies each
 * level ONCE, records it on the task (meta.escalation) and in its change log
 * (audit `task.escalated`), and the Tasks list's "Escalated to me" filter
 * shows the receiver what reached them. While the ladder is on it replaces
 * the old instant "team follow-up overdue" ping to the branch head.
 *
 * The ladder is OFF until the firm switches it on (Settings → Escalation),
 * and it climbs only tasks that fell due after it was switched on
 * (`activeSince`) — switching it on never floods managers with a backlog.
 *
 * Stored in dashboard_settings.settings.escalationLadder (migration 0219's
 * per-firm settings row); the dashboard-thresholds save keeps this key.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";

export const LADDER_KEY = "escalationLadder";

const hours = z.union([z.coerce.number().int().min(1).max(24 * 60), z.null()]);

export const LadderRuleSchema = z.object({
  /** null = any. */
  department: z.string().max(40).nullable().default(null),
  type: z.string().max(60).nullable().default(null),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullable().default(null),
  l1Hours: hours.default(null),
  l2Hours: hours.default(null),
  l3Hours: hours.default(null),
});
export type LadderRule = z.infer<typeof LadderRuleSchema>;

export const LadderSchema = z.object({
  enabled: z.boolean().default(false),
  /** When the ladder was last switched on (ISO). Only tasks due after it climb. */
  activeSince: z.string().nullable().default(null),
  /** Applies when no specific rule matches. */
  fallback: LadderRuleSchema.default({ department: null, type: null, priority: null, l1Hours: 24, l2Hours: 48, l3Hours: 72 }),
  rules: z.array(LadderRuleSchema).max(50).default([]),
});
export type Ladder = z.infer<typeof LadderSchema>;

export const DEFAULT_LADDER: Ladder = LadderSchema.parse({});

export type Level = 1 | 2 | 3;

/** The most specific rule for this task: most fields matched wins, ties go to the first listed. */
export function ruleFor(ladder: Ladder, task: { department?: string | null; type?: string | null; priority?: string | null }): LadderRule {
  let best: LadderRule | null = null;
  let bestScore = -1;
  for (const r of ladder.rules) {
    if (r.department && r.department !== task.department) continue;
    if (r.type && r.type !== task.type) continue;
    if (r.priority && r.priority !== task.priority) continue;
    const score = (r.department ? 1 : 0) + (r.type ? 1 : 0) + (r.priority ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best ?? ladder.fallback;
}

/** The levels a task this many hours overdue has reached under the rule. */
export function levelsReached(rule: LadderRule, hoursOverdue: number): Level[] {
  const out: Level[] = [];
  if (rule.l1Hours != null && hoursOverdue >= rule.l1Hours) out.push(1);
  if (rule.l2Hours != null && hoursOverdue >= rule.l2Hours) out.push(2);
  if (rule.l3Hours != null && hoursOverdue >= rule.l3Hours) out.push(3);
  return out;
}

/** What meta.escalation holds: per level when and to whom, plus everyone it reached. */
export type EscalationState = {
  l1?: { at: string; to: string[] };
  l2?: { at: string; to: string[] };
  l3?: { at: string; to: string[] };
  to?: string[];
};

export function escalationState(meta: unknown): EscalationState {
  const e = (meta as { escalation?: unknown } | null)?.escalation;
  return e && typeof e === "object" ? (e as EscalationState) : {};
}

/** Was this task escalated to this person? (Lets a manager open a report's task.) */
export function escalatedTo(meta: unknown, userId: string): boolean {
  return (escalationState(meta).to ?? []).includes(userId);
}

/** SQL: the task (alias) was escalated to this user. */
export function escalatedToSql(alias: string, userId: string) {
  return sql`(${sql.raw(alias)}.meta -> 'escalation' -> 'to') ? ${userId}`;
}

/** The firm's ladder (defaults when none is saved). */
export async function loadLadder(tx: Tx, tenantId: string): Promise<Ladder> {
  const row = (await tx.execute(sql`
    SELECT settings -> ${LADDER_KEY} AS ladder FROM dashboard_settings WHERE tenant_id = ${tenantId}::uuid
  `)).rows[0] as { ladder: unknown } | undefined;
  const parsed = LadderSchema.safeParse(row?.ladder ?? {});
  return parsed.success ? parsed.data : DEFAULT_LADDER;
}

/** Save the ladder; switching it on stamps activeSince so only new overdue work climbs. */
export async function saveLadder(tx: Tx, tenantId: string, userId: string, next: Ladder): Promise<Ladder> {
  const prev = await loadLadder(tx, tenantId);
  const value: Ladder = {
    ...next,
    activeSince: next.enabled ? (prev.enabled && prev.activeSince ? prev.activeSince : new Date().toISOString()) : null,
  };
  await tx.execute(sql`
    INSERT INTO dashboard_settings (tenant_id, settings, updated_by, updated_at)
    VALUES (${tenantId}::uuid, jsonb_build_object(${LADDER_KEY}::text, ${JSON.stringify(value)}::jsonb), ${userId}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET settings = COALESCE(dashboard_settings.settings, '{}'::jsonb) || jsonb_build_object(${LADDER_KEY}::text, ${JSON.stringify(value)}::jsonb),
          updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
  return value;
}
