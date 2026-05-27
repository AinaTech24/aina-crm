/**
 * Rule runner — the core engine that turns events into actions.
 *
 * For an incoming event (from events_outbox or a manual test):
 *   1. Find matching rules for (module, triggerType)
 *   2. For record_action triggers: check `when` matches event kind, check
 *      `fields[]` (if specified) actually changed
 *   3. Evaluate criteria against the "after" snapshot
 *   4. Execute each instantAction via the action handler
 *   5. Queue each scheduledAction into workflow_rule_scheduled_jobs
 *   6. Write a workflow_rule_executions row for the audit log
 */

import { withTenant } from "@/db/client";
import { workflowRules, workflowRuleExecutions, workflowRuleScheduledJobs } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getModule, type ModuleKey } from "./modules";
import { evaluateCriteria } from "./criteria";
import { executeAction, type ActionResult } from "./actions";
import type { CriteriaRow, Action, ScheduledAction } from "./types";

export interface RuleEvent {
  tenantId: string;
  module: ModuleKey;
  /** Matches Zoho's "Execute Based on Record Action" semantics. */
  recordAction: "create" | "edit" | "delete" | "field_update";
  subjectType: string;
  subjectId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  eventId?: string;
}

export interface RunResult {
  ruleId: string;
  matched: boolean;
  reason?: string;
  instantOutcomes: ActionResult[];
  scheduledQueued: number;
}

/**
 * Public entry-point — call this from the outbox poller or any API that
 * mutates a domain record.
 */
export async function runRulesForEvent(event: RuleEvent): Promise<RunResult[]> {
  const mod = getModule(event.module);
  if (!mod) return [];

  return withTenant(event.tenantId, async (tx) => {
    // Find rules: module + record_action trigger + enabled
    const rules = await tx
      .select()
      .from(workflowRules)
      .where(
        and(
          eq(workflowRules.module, event.module as any),
          eq(workflowRules.triggerType, "record_action"),
          eq(workflowRules.enabled, true)
        )
      )
      .orderBy(workflowRules.executionOrder);

    const results: RunResult[] = [];
    for (const rule of rules) {
      const result = await runOneRule(tx, rule as any, event);
      results.push(result);
    }
    return results;
  });
}

async function runOneRule(tx: any, rule: any, event: RuleEvent): Promise<RunResult> {
  const cfg = (rule.triggerConfig ?? {}) as { when?: string; fields?: string[]; repeat?: boolean };
  const when = cfg.when ?? "create_or_edit";

  // Step 1 — does the event's recordAction match the rule's `when`?
  const matchedAction =
    when === "create_or_edit"
      ? event.recordAction === "create" || event.recordAction === "edit"
      : when === "field_update"
        ? event.recordAction === "edit"
        : when === event.recordAction;
  if (!matchedAction) {
    return { ruleId: rule.id, matched: false, reason: "trigger.when mismatch", instantOutcomes: [], scheduledQueued: 0 };
  }

  // Step 2 — for "edit" with specific fields, check they changed
  if ((when === "edit" || when === "field_update") && (cfg.fields?.length ?? 0) > 0) {
    const changedFields = diffChangedFields(event.before, event.after);
    const anyMatch = cfg.fields!.some((f) => changedFields.includes(f));
    if (!anyMatch) {
      return { ruleId: rule.id, matched: false, reason: "no watched field changed", instantOutcomes: [], scheduledQueued: 0 };
    }
  }

  // Step 3 — evaluate criteria
  const record = (event.after ?? event.before ?? {}) as Record<string, unknown>;
  const matchesCriteria = evaluateCriteria(
    (rule.criteriaRows ?? []) as CriteriaRow[],
    rule.criteriaPattern,
    record
  );
  if (!matchesCriteria) {
    return { ruleId: rule.id, matched: false, reason: "criteria not met", instantOutcomes: [], scheduledQueued: 0 };
  }

  // Step 4 — execute instant actions
  const instantOutcomes: ActionResult[] = [];
  for (const action of (rule.instantActions ?? []) as Action[]) {
    try {
      const out = await executeAction(action, {
        tenantId: rule.tenantId,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        record,
        tx,
      });
      instantOutcomes.push(out);
    } catch (e: any) {
      instantOutcomes.push({
        type: action.type,
        status: "failed",
        error: e?.message ?? String(e),
      });
    }
  }

  // Step 5 — queue scheduled actions
  let scheduledQueued = 0;
  for (let i = 0; i < (rule.scheduledActions ?? []).length; i++) {
    const sa = (rule.scheduledActions as ScheduledAction[])[i];
    const runAt = computeRunAt(sa, record);
    if (!runAt) continue;
    await tx.insert(workflowRuleScheduledJobs).values({
      tenantId: rule.tenantId,
      ruleId: rule.id,
      actionIndex: i,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      actionType: sa.type,
      actionConfig: sa.config,
      runAt,
    });
    scheduledQueued++;
  }

  // Step 6 — write execution log + bump counters
  const status =
    instantOutcomes.length === 0
      ? "succeeded"
      : instantOutcomes.every((o) => o.status === "succeeded")
        ? "succeeded"
        : instantOutcomes.every((o) => o.status === "failed")
          ? "failed"
          : "partial";

  await tx.insert(workflowRuleExecutions).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    triggeredBy: "event",
    triggerEventId: event.eventId ?? null,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    contextSnapshot: record,
    instantOutcomes,
    scheduledQueued,
    status,
  });

  await tx
    .update(workflowRules)
    .set({
      executionCount: sql`${workflowRules.executionCount} + 1`,
      lastExecutedAt: new Date(),
    })
    .where(eq(workflowRules.id, rule.id));

  return { ruleId: rule.id, matched: true, instantOutcomes, scheduledQueued };
}

function diffChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  if (!before || !after) return [];
  const changed: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = (before as any)[k];
    const a = (after as any)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push(k);
  }
  return changed;
}

function computeRunAt(sa: ScheduledAction, record: Record<string, unknown>): Date | null {
  const now = new Date();
  let anchor = now;

  if (sa.delay.anchor === "date_field" && sa.delay.anchorField) {
    const v = record[sa.delay.anchorField] ?? record[sa.delay.anchorField.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    if (!v) return null;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return null;
    anchor = d;
  }

  const ms = unitToMs(sa.delay.unit) * sa.delay.amount;
  return new Date(anchor.getTime() + ms);
}

function unitToMs(unit: "minute" | "hour" | "day" | "week"): number {
  switch (unit) {
    case "minute":
      return 60 * 1000;
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Cancellation hook — call when a record is deleted to clean up pending jobs.
 */
export async function cancelScheduledJobsForSubject(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  reason = "Subject deleted"
) {
  return withTenant(tenantId, async (tx) => {
    await tx
      .update(workflowRuleScheduledJobs)
      .set({ status: "cancelled", cancelReason: reason })
      .where(
        and(
          eq(workflowRuleScheduledJobs.subjectType, subjectType),
          eq(workflowRuleScheduledJobs.subjectId, subjectId),
          eq(workflowRuleScheduledJobs.status, "pending")
        )
      );
  });
}
