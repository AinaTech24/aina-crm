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
  const repeat = cfg.repeat ?? false;

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
    if (event.recordAction === "edit") {
      await cancelScheduledJobsForSubjectAndRule(
        tx,
        rule.tenantId,
        rule.id,
        event.subjectType,
        event.subjectId,
        "Record no longer matches criteria"
      );
    }
    return { ruleId: rule.id, matched: false, reason: "criteria not met", instantOutcomes: [], scheduledQueued: 0 };
  }

  // Step 3.5 — repeat check (Zoho: Execute only once when criteria is first met)
  if (!repeat && event.recordAction === "edit" && event.before) {
    const metBefore = evaluateCriteria(
      (rule.criteriaRows ?? []) as CriteriaRow[],
      rule.criteriaPattern,
      event.before as Record<string, unknown>
    );
    if (metBefore) {
      return {
        ruleId: rule.id,
        matched: false,
        reason: "criteria already met in before state and repeat=false",
        instantOutcomes: [],
        scheduledQueued: 0,
      };
    }
  }

  // Step 3.6 — idempotency claim.
  // For event-sourced triggers, insert the execution row UP-FRONT keyed on
  // (rule_id, trigger_event_id). The partial unique index (migration 0058)
  // makes a re-delivery of the same outbox event a no-op insert, so instant
  // actions — which include external sends (email / WhatsApp / SMS) — never
  // fire twice for one event. Without this, an outbox poller crash between
  // "deliver" and "mark processed" would double-message clients.
  let executionId: string | null = null;
  if (event.eventId) {
    const claimed = await tx
      .insert(workflowRuleExecutions)
      .values({
        tenantId: rule.tenantId,
        ruleId: rule.id,
        triggeredBy: "event",
        triggerEventId: event.eventId,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        contextSnapshot: record,
        instantOutcomes: [],
        scheduledQueued: 0,
        status: "succeeded",
      })
      .onConflictDoNothing({
        // NB: onConflictDoNothing uses `where` for the partial-index predicate
        // (only onConflictDoUpdate has `targetWhere`). It must textually cover
        // the index predicate so Postgres can infer wre_rule_event_unique.
        target: [workflowRuleExecutions.ruleId, workflowRuleExecutions.triggerEventId],
        where: sql`trigger_event_id IS NOT NULL`,
      })
      .returning({ id: workflowRuleExecutions.id });
    if (claimed.length === 0) {
      // This (rule, event) pair was already processed — idempotent skip.
      return {
        ruleId: rule.id,
        matched: false,
        reason: "already processed (idempotent skip)",
        instantOutcomes: [],
        scheduledQueued: 0,
      };
    }
    executionId = claimed[0].id;
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

    // Reschedule existing pending job if it exists
    const existing = await tx
      .select()
      .from(workflowRuleScheduledJobs)
      .where(
        and(
          eq(workflowRuleScheduledJobs.tenantId, rule.tenantId),
          eq(workflowRuleScheduledJobs.ruleId, rule.id),
          eq(workflowRuleScheduledJobs.subjectType, event.subjectType),
          eq(workflowRuleScheduledJobs.subjectId, event.subjectId),
          eq(workflowRuleScheduledJobs.actionIndex, i),
          eq(workflowRuleScheduledJobs.status, "pending")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(workflowRuleScheduledJobs)
        .set({
          runAt,
          actionConfig: sa.config,
          updatedAt: new Date(),
        })
        .where(eq(workflowRuleScheduledJobs.id, existing[0].id));
    } else {
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

  if (executionId) {
    // Finalize the row we claimed in step 3.6 with the real outcomes.
    await tx
      .update(workflowRuleExecutions)
      .set({ instantOutcomes, scheduledQueued, status })
      .where(eq(workflowRuleExecutions.id, executionId));
  } else {
    // Manual / test trigger (no eventId) — nothing to claim, just log.
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
  }

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
    // Order-insensitive deep compare. JSON.stringify is key-order sensitive,
    // so two equal objects serialized in different orders would falsely read
    // as "changed" and fire watched-field rules spuriously.
    if (!deepEqual(b, a)) changed.push(k);
  }
  return changed;
}

/** Structural deep-equality that ignores object key order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;

  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : new Date(a as any).getTime();
    const bt = b instanceof Date ? b.getTime() : new Date(b as any).getTime();
    return at === bt;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  }
  return true;
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
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(workflowRuleScheduledJobs.tenantId, tenantId),
          eq(workflowRuleScheduledJobs.subjectType, subjectType),
          eq(workflowRuleScheduledJobs.subjectId, subjectId),
          eq(workflowRuleScheduledJobs.status, "pending")
        )
      );
  });
}

/**
 * Cancellation hook — cancel pending jobs for a specific rule and record.
 */
export async function cancelScheduledJobsForSubjectAndRule(
  tx: any,
  tenantId: string,
  ruleId: string,
  subjectType: string,
  subjectId: string,
  reason = "Criteria no longer met"
) {
  await tx
    .update(workflowRuleScheduledJobs)
    .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(workflowRuleScheduledJobs.tenantId, tenantId),
        eq(workflowRuleScheduledJobs.ruleId, ruleId),
        eq(workflowRuleScheduledJobs.subjectType, subjectType),
        eq(workflowRuleScheduledJobs.subjectId, subjectId),
        eq(workflowRuleScheduledJobs.status, "pending")
      )
    );
}
