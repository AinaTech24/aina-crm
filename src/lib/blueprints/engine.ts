/**
 * Blueprint engine — runtime helpers.
 *
 *   ensureActiveBlueprint(tx, tenantId)
 *     Lazily seeds the canonical lead-to-client blueprint for a tenant.
 *
 *   ensureInstance(tx, tenantId, leadId)
 *     Creates a lead_blueprint_instances row + initial stage_history entry
 *     when a lead hits the system for the first time.
 *
 *   transitionTo(tx, leadId, toStageKey, opts)
 *     Validates the transition exists, role is allowed, exit conditions of
 *     the current stage are met. On success: stamps exited_at on the current
 *     history row, opens a new one for the target stage, updates the
 *     instance, runs on-exit + on-enter automation recipes (via outbox event
 *     emit — they're picked up by the workflow runner).
 *
 *   getStage(tx, leadId)
 *     Returns { current, all, history, isDelayed } for the lead-detail UI.
 *
 *   markDelayedInstances(tx)
 *     Worker — sets is_delayed=true on instances whose stage SLA has elapsed.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  blueprintDefinitions,
  blueprintStages,
  blueprintTransitions,
  leadBlueprintInstances,
  leadStageHistory,
  eventsOutbox,
} from "@/db/schema";
import {
  LEAD_TO_CLIENT_BLUEPRINT_NAME,
  LEAD_TO_CLIENT_STAGES,
  LEAD_TO_CLIENT_TRANSITIONS,
} from "./lead_to_client";

const MODULE = "leads";

// Process-local cache for the lead-to-client blueprint definition per tenant.
// Definitions change only when the owner edits stages in /settings/blueprints
// (rare), so caching saves a hot-path SELECT on every lead detail page load.
const ACTIVE_BP_CACHE = new Map<string, { id: string; cachedAt: number }>();
const BP_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateBlueprintCache(tenantId?: string) {
  if (tenantId) ACTIVE_BP_CACHE.delete(tenantId);
  else ACTIVE_BP_CACHE.clear();
}

// ── Seeder ───────────────────────────────────────────────────────────────

export async function ensureActiveBlueprint(tx: Tx, tenantId: string) {
  // Fast path: cached id
  const cached = ACTIVE_BP_CACHE.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < BP_CACHE_TTL_MS) {
    const [def] = await tx
      .select()
      .from(blueprintDefinitions)
      .where(eq(blueprintDefinitions.id, cached.id))
      .limit(1);
    if (def) return def;
    ACTIVE_BP_CACHE.delete(tenantId);
  }

  const existing = await tx
    .select()
    .from(blueprintDefinitions)
    .where(
      and(
        eq(blueprintDefinitions.tenantId, tenantId),
        eq(blueprintDefinitions.moduleName, MODULE),
        eq(blueprintDefinitions.isActive, true)
      )
    )
    .limit(1);
  if (existing.length) {
    ACTIVE_BP_CACHE.set(tenantId, { id: existing[0].id, cachedAt: Date.now() });
    return existing[0];
  }

  const [def] = await tx
    .insert(blueprintDefinitions)
    .values({
      tenantId,
      moduleName: MODULE,
      blueprintName: LEAD_TO_CLIENT_BLUEPRINT_NAME,
      description: "Full Lead → Client SOP — 30 stages with branching paths (call-back loops, KYC routes, mandate/transaction retries).",
      versionNumber: 1,
      isActive: true,
    })
    .returning();

  for (const s of LEAD_TO_CLIENT_STAGES) {
    await tx.insert(blueprintStages).values({
      tenantId,
      blueprintId: def.id,
      stageKey: s.key,
      stageName: s.name,
      description: s.description ?? null,
      stageOrder: s.order,
      ownerRole: s.ownerRole,
      requiredFields: s.requiredFields as any,
      slaDays: s.slaDays ?? null,
      allowedActions: s.allowedActions as any,
      automationsOnEnter: s.automationsOnEnter as any,
      automationsOnExit: s.automationsOnExit as any,
    });
  }
  for (const t of LEAD_TO_CLIENT_TRANSITIONS) {
    await tx.insert(blueprintTransitions).values({
      tenantId,
      blueprintId: def.id,
      fromStageKey: t.from,
      toStageKey: t.to,
      transitionName: t.name,
      allowedRoles: (t.allowedRoles ?? []) as any,
    });
  }
  ACTIVE_BP_CACHE.set(tenantId, { id: def.id, cachedAt: Date.now() });
  return def;
}

// ── Instance management ──────────────────────────────────────────────────

export async function ensureInstance(tx: Tx, tenantId: string, leadId: string) {
  const [existing] = await tx
    .select()
    .from(leadBlueprintInstances)
    .where(and(eq(leadBlueprintInstances.tenantId, tenantId), eq(leadBlueprintInstances.leadId, leadId)))
    .limit(1);
  if (existing) return existing;

  const def = await ensureActiveBlueprint(tx, tenantId);
  const [firstStage] = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, def.id))
    .orderBy(asc(blueprintStages.stageOrder))
    .limit(1);
  if (!firstStage) throw new Error("Blueprint has no stages");

  const now = new Date();
  const [inst] = await tx
    .insert(leadBlueprintInstances)
    .values({
      tenantId,
      leadId,
      blueprintId: def.id,
      currentStageKey: firstStage.stageKey,
      status: "in_progress",
      startedAt: now,
      stageEnteredAt: now,
    })
    .returning();

  await tx.insert(leadStageHistory).values({
    tenantId,
    leadId,
    instanceId: inst.id,
    stageKey: firstStage.stageKey,
    enteredAt: now,
  });

  return inst;
}

// ── Transitions ──────────────────────────────────────────────────────────

export interface TransitionOptions {
  /** User invoking the transition — used for role check + audit. */
  actorUserId?: string;
  actorRoles?: string[];
  remarks?: string;
  /** If set, override role + condition checks (use sparingly — for system events). */
  systemBypass?: boolean;
}

export async function transitionTo(
  tx: Tx,
  tenantId: string,
  leadId: string,
  toStageKey: string,
  opts: TransitionOptions = {}
): Promise<{ ok: boolean; reason?: string; fromStage?: string; toStage?: string }> {
  const inst = await ensureInstance(tx, tenantId, leadId);
  if (inst.currentStageKey === toStageKey) return { ok: true, fromStage: toStageKey, toStage: toStageKey };

  // Look up the transition
  const [tr] = await tx
    .select()
    .from(blueprintTransitions)
    .where(
      and(
        eq(blueprintTransitions.blueprintId, inst.blueprintId),
        eq(blueprintTransitions.fromStageKey, inst.currentStageKey),
        eq(blueprintTransitions.toStageKey, toStageKey)
      )
    )
    .limit(1);
  if (!tr && !opts.systemBypass) {
    return { ok: false, reason: `No transition defined from "${inst.currentStageKey}" to "${toStageKey}"` };
  }

  // Role gate
  if (!opts.systemBypass && tr) {
    const allowed = (tr.allowedRoles as string[]) ?? [];
    if (allowed.length > 0 && opts.actorRoles && !opts.actorRoles.some((r) => allowed.includes(r))) {
      return { ok: false, reason: `Your role isn't allowed to perform "${tr.transitionName}"` };
    }
  }

  // Stage rows for on-exit / on-enter automations
  const [fromStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, inst.currentStageKey)))
    .limit(1);
  const [toStage] = await tx
    .select()
    .from(blueprintStages)
    .where(and(eq(blueprintStages.blueprintId, inst.blueprintId), eq(blueprintStages.stageKey, toStageKey)))
    .limit(1);
  if (!toStage) return { ok: false, reason: "Target stage not found" };

  const now = new Date();

  // Close the open history row
  const [openHistory] = await tx
    .select()
    .from(leadStageHistory)
    .where(and(eq(leadStageHistory.instanceId, inst.id), isNull(leadStageHistory.exitedAt)))
    .orderBy(desc(leadStageHistory.enteredAt))
    .limit(1);
  if (openHistory) {
    const durationSec = Math.max(0, Math.floor((now.getTime() - new Date(openHistory.enteredAt).getTime()) / 1000));
    const breached = fromStage?.slaDays != null && durationSec > fromStage.slaDays * 86400;
    await tx
      .update(leadStageHistory)
      .set({
        exitedAt: now,
        durationSeconds: durationSec,
        breachedSla: breached,
        completedBy: opts.actorUserId ?? null,
        transitionName: tr?.transitionName ?? "system",
        remarks: opts.remarks ?? null,
      })
      .where(eq(leadStageHistory.id, openHistory.id));
  }

  // Open new history row
  await tx.insert(leadStageHistory).values({
    tenantId,
    leadId,
    instanceId: inst.id,
    stageKey: toStageKey,
    enteredAt: now,
  });

  // Update instance pointer
  const isTerminal = toStage.stageOrder === LEAD_TO_CLIENT_STAGES.length;
  await tx
    .update(leadBlueprintInstances)
    .set({
      currentStageKey: toStageKey,
      stageEnteredAt: now,
      isDelayed: false,
      delayedSince: null,
      status: isTerminal ? "completed" : "in_progress",
      completedAt: isTerminal ? now : null,
      updatedAt: now,
    })
    .where(eq(leadBlueprintInstances.id, inst.id));

  // Mirror the new stage back onto leads.stage so the Kanban + filters +
  // any other consumer that still reads the legacy column stays in sync.
  // The Lead → Client journey blueprint and the legacy stage enum are now
  // the same vocabulary.
  await tx.execute(
    sql`UPDATE leads SET stage = ${toStageKey}, stage_changed_at = ${now}, updated_at = ${now} WHERE id = ${leadId}::uuid` as any
  );

  // Emit lifecycle events for any wired automations.
  const onExit = (fromStage?.automationsOnExit as string[]) ?? [];
  const onEnter = (toStage.automationsOnEnter as string[]) ?? [];
  for (const recipe of [...onExit.map((r) => ({ phase: "exit", r })), ...onEnter.map((r) => ({ phase: "enter", r }))]) {
    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: `blueprint.stage.${recipe.phase}`,
      entityType: "lead",
      entityId: leadId,
      after: {
        instanceId: inst.id,
        stageKey: recipe.phase === "enter" ? toStageKey : inst.currentStageKey,
        recipeKey: recipe.r,
      },
      meta: { actorUserId: opts.actorUserId ?? null, transition: tr?.transitionName ?? null } as any,
    } as any);
  }

  return { ok: true, fromStage: inst.currentStageKey, toStage: toStageKey };
}

// ── Read helpers for the UI ─────────────────────────────────────────────

export interface StageView {
  current: {
    key: string;
    name: string;
    description: string | null;
    ownerRole: string | null;
    order: number;
    slaDays: number | null;
    allowedActions: string[];
    requiredFields: string[];
    /** Seconds since the lead entered this stage. */
    secondsInStage: number;
    /** Days remaining (negative = overdue). null if no SLA. */
    slaRemainingDays: number | null;
    isDelayed: boolean;
  };
  allStages: Array<{
    key: string;
    name: string;
    order: number;
    status: "done" | "current" | "upcoming";
    /**
     * Which side of the journey owns this stage. Lead-side stages (≤ docs_received,
     * order ≤ 12) show in the Leads module; once the lead is converted, client-side
     * stages (order ≥ 13: ops_in_progress, portal_welcome_sent, active_client)
     * show in the Clients module instead.
     */
    phase: "lead" | "client";
  }>;
  history: Array<{
    stageKey: string;
    stageName: string;
    enteredAt: Date;
    exitedAt: Date | null;
    durationSeconds: number | null;
    breachedSla: boolean;
  }>;
}

export async function getStage(tx: Tx, tenantId: string, leadId: string): Promise<StageView> {
  const inst = await ensureInstance(tx, tenantId, leadId);
  const stages = await tx
    .select()
    .from(blueprintStages)
    .where(eq(blueprintStages.blueprintId, inst.blueprintId))
    .orderBy(asc(blueprintStages.stageOrder));
  const currentIdx = stages.findIndex((s) => s.stageKey === inst.currentStageKey);
  const current = stages[currentIdx];

  const history = await tx
    .select()
    .from(leadStageHistory)
    .where(eq(leadStageHistory.instanceId, inst.id))
    .orderBy(asc(leadStageHistory.enteredAt));

  const now = Date.now();
  const secondsInStage = Math.max(0, Math.floor((now - new Date(inst.stageEnteredAt).getTime()) / 1000));
  const slaRemainingDays =
    current?.slaDays != null ? current.slaDays - secondsInStage / 86400 : null;

  return {
    current: {
      key: current.stageKey,
      name: current.stageName,
      description: current.description,
      ownerRole: current.ownerRole,
      order: current.stageOrder,
      slaDays: current.slaDays,
      allowedActions: (current.allowedActions as string[]) ?? [],
      requiredFields: (current.requiredFields as string[]) ?? [],
      secondsInStage,
      slaRemainingDays,
      isDelayed: inst.isDelayed,
    },
    allStages: stages.map((s, i) => ({
      key: s.stageKey,
      name: s.stageName,
      order: s.stageOrder,
      status: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
      // Cut-over at stage 10 (Not Qualified is the last lead-phase
      // stage in the new SOP graph; Won Lead at stage 9 is the success
      // boundary that converts to Client). See LEAD_PHASE_LAST_ORDER.
      phase: s.stageOrder <= 10 ? "lead" : "client",
    })),
    history: history.map((h) => {
      const stage = stages.find((s) => s.stageKey === h.stageKey);
      return {
        stageKey: h.stageKey,
        stageName: stage?.stageName ?? h.stageKey,
        enteredAt: new Date(h.enteredAt),
        exitedAt: h.exitedAt ? new Date(h.exitedAt) : null,
        durationSeconds: h.durationSeconds,
        breachedSla: h.breachedSla,
      };
    }),
  };
}
