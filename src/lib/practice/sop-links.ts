/**
 * SOPs where the work happens (The E-Myth Revisited: the operations manual
 * lives INSIDE the work, not in a library nobody opens).
 *
 * An SOP is attached to a target through `sop_links` (migration 0234). A
 * target is a (kind, key) pair:
 *
 *   task_type        key = tasks.type                    e.g. "kyc_renewal"
 *   task_template    key = task_templates.id (uuid)      — tasks record it in meta.templateId
 *   process          key = PRACTICE_PROCESSES key        e.g. "sip_rejection"
 *   position         key = practice_positions.id (uuid)
 *   blueprint_stage  key = "<subjectType>:<stageKey>"    e.g. "lead:call_done"
 *                    (subjectType is a blueprint_instances.subject_type —
 *                    lead | service_request | complaint | sip_rejection |
 *                    investor | opportunity; stageKey a blueprint stage key.
 *                    Build it with `blueprintStageKey`, read it with
 *                    `parseBlueprintStageKey`.)
 *   sr_type          key = service_requests.type         e.g. "bank_update"
 *
 * A task reaches its SOPs through (`sopsForTask`):
 *   - its type (task_type) and the template it was created from (task_template);
 *   - every core process whose `taskTypes` include its type (process), and the
 *     process of a service request it is linked to (srTypes);
 *   - (the positions its assignee holds are NOT used for tasks — see
 *     sopsForTask; they drive the person's own manual instead);
 *   - the journey stage it belongs to (blueprint_stage): meta.blueprintSubject +
 *     meta.stageKey (or meta.blueprintStage = "lead:call_done"), else the
 *     current stage of the lead / service request the task is about;
 *   - the type of the service request it is linked to (sr_type).
 *
 * The pure helpers (target derivation, labels) are tested in
 * tests/practice-sop-links.test.ts; the DB helpers take a tenant tx.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { SOP_LINK_KINDS, type SopLinkKind } from "@/db/schema/practice";
import { PRACTICE_PROCESSES, PROCESS_BY_KEY, DEFAULT_POSITIONS } from "./catalog";
import { REQUEST_TYPE_BY_KEY, REQUEST_TYPES } from "@/lib/tasks/request-types";
import { BLUEPRINT_CATALOG } from "@/lib/blueprints/catalog";
import { MASTER_SEEDS } from "@/lib/masters/seeds";

export type SopTarget = { kind: SopLinkKind; key: string };

export type LinkedSop = {
  sopId: string;
  key: string;
  title: string;
  category: string | null;
  versionId: string;
  versionNumber: string;
  markdown: string;
  /** Every target this SOP was reached through. */
  matched: SopTarget[];
};

// ── Pure helpers ────────────────────────────────────────────────────────

export function isSopLinkKind(k: unknown): k is SopLinkKind {
  return typeof k === "string" && (SOP_LINK_KINDS as readonly string[]).includes(k);
}

export const BLUEPRINT_SUBJECTS = ["lead", "service_request", "complaint", "sip_rejection", "investor", "opportunity"] as const;
export type BlueprintSubject = (typeof BLUEPRINT_SUBJECTS)[number];

/** "<subjectType>:<stageKey>" — the blueprint_stage target key. */
export function blueprintStageKey(subjectType: string, stageKey: string): string {
  return `${subjectType}:${stageKey}`;
}

export function parseBlueprintStageKey(key: string): { subjectType: BlueprintSubject; stageKey: string } | null {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) return null;
  const subjectType = key.slice(0, i);
  const stageKey = key.slice(i + 1);
  if (!(BLUEPRINT_SUBJECTS as readonly string[]).includes(subjectType)) return null;
  if (!/^[a-z0-9_]+$/.test(stageKey)) return null;
  return { subjectType: subjectType as BlueprintSubject, stageKey };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

/** The task template a task was created from (meta.templateId), if any. */
export function templateIdFromMeta(meta: unknown): string | null {
  const v = metaOf(meta).templateId;
  return isUuid(v) ? v : null;
}

/** The journey stage a task's meta records, as a blueprint_stage key. */
export function blueprintStageFromMeta(meta: unknown): string | null {
  const m = metaOf(meta);
  if (typeof m.blueprintStage === "string" && parseBlueprintStageKey(m.blueprintStage)) return m.blueprintStage;
  if (typeof m.blueprintSubject === "string" && typeof m.stageKey === "string") {
    const k = blueprintStageKey(m.blueprintSubject, m.stageKey);
    if (parseBlueprintStageKey(k)) return k;
  }
  return null;
}

export type TaskLike = {
  type: string;
  assigneeId?: string | null;
  meta?: unknown;
  subjectType?: string | null;
  subjectId?: string | null;
  relatedLeadId?: string | null;
  relatedServiceRequestId?: string | null;
};

/**
 * The targets a task reaches, given what the DB knows about it (the positions
 * its assignee holds, the stage of the journey it is about, the type of the
 * service request it is linked to). Pure.
 */
export function taskTargets(
  task: Pick<TaskLike, "type" | "meta">,
  ctx: { positionIds?: string[]; blueprintStage?: string | null; srType?: string | null } = {}
): SopTarget[] {
  const out: SopTarget[] = [];
  const seen = new Set<string>();
  const add = (kind: SopLinkKind, key: string | null | undefined) => {
    if (!key) return;
    const id = `${kind}\u0000${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, key });
  };
  add("task_type", task.type);
  add("task_template", templateIdFromMeta(task.meta));
  for (const p of PRACTICE_PROCESSES) {
    if (task.type && p.taskTypes?.includes(task.type)) add("process", p.key);
    if (ctx.srType && p.srTypes?.includes(ctx.srType)) add("process", p.key);
  }
  for (const id of ctx.positionIds ?? []) add("position", id);
  add("blueprint_stage", blueprintStageFromMeta(task.meta) ?? ctx.blueprintStage ?? null);
  add("sr_type", ctx.srType ?? null);
  return out;
}

export const SOP_LINK_KIND_LABEL: Record<SopLinkKind, string> = {
  process: "Process",
  task_type: "Task type",
  task_template: "Task template",
  position: "Position",
  blueprint_stage: "Journey stage",
  sr_type: "Service request",
};

const SUBJECT_STAGE_LABEL: Record<BlueprintSubject, string> = {
  lead: "Lead stage",
  service_request: "Service request stage",
  complaint: "Complaint stage",
  sip_rejection: "SIP rejection stage",
  investor: "Review stage",
  opportunity: "Opportunity stage",
};

const BASE_TASK_TYPE_LABEL: Record<string, string> = {
  follow_up: "Follow-up",
  review_meeting: "Review meeting",
  collect_document: "Collect document",
  kyc_renewal: "KYC renewal",
  custom: "Custom",
};

const SR_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  (MASTER_SEEDS.service_request_type ?? []).map((r) => [r.key, r.label])
);

export function humaniseKey(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export function taskTypeLabel(type: string): string {
  return BASE_TASK_TYPE_LABEL[type] ?? REQUEST_TYPE_BY_KEY[type]?.label ?? humaniseKey(type);
}

export function srTypeLabel(type: string, names?: Map<string, string>): string {
  return names?.get(type) ?? SR_TYPE_LABEL[type] ?? humaniseKey(type);
}

export function blueprintStageLabel(key: string): string {
  const p = parseBlueprintStageKey(key);
  if (!p) return humaniseKey(key);
  const entry = BLUEPRINT_CATALOG.find((b) => b.subjectType === p.subjectType);
  const stage = entry?.stages.find((s) => s.key === p.stageKey);
  return `${SUBJECT_STAGE_LABEL[p.subjectType]}: ${stage?.name ?? humaniseKey(p.stageKey)}`;
}

export type LinkLabelNames = {
  positions?: Map<string, string>;
  templates?: Map<string, string>;
  srTypes?: Map<string, string>;
};

/** A link in words: "Process: SIP rejection recovery", "Lead stage: Call done". */
export function linkTargetLabel(kind: SopLinkKind, key: string, names: LinkLabelNames = {}): string {
  switch (kind) {
    case "process":
      return `Process: ${PROCESS_BY_KEY.get(key)?.name ?? humaniseKey(key)}`;
    case "task_type":
      return `Task type: ${taskTypeLabel(key)}`;
    case "task_template":
      return `Task template: ${names.templates?.get(key) ?? "a deleted template"}`;
    case "position":
      return `Position: ${names.positions?.get(key) ?? "a removed position"}`;
    case "blueprint_stage":
      return blueprintStageLabel(key);
    case "sr_type":
      return `Service request: ${srTypeLabel(key, names.srTypes)}`;
  }
}

/** Task types a link can name: the general types plus every request type. */
export function taskTypeOptions(): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [
    { key: "follow_up", label: BASE_TASK_TYPE_LABEL.follow_up },
    { key: "review_meeting", label: BASE_TASK_TYPE_LABEL.review_meeting },
  ];
  for (const r of REQUEST_TYPES) if (!out.some((o) => o.key === r.key)) out.push({ key: r.key, label: r.label });
  return out;
}

/** Journey stages a link can name, grouped by journey. */
export function blueprintStageOptions(): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (const b of BLUEPRINT_CATALOG) {
    for (const s of b.stages) {
      const key = blueprintStageKey(b.subjectType, s.key);
      if (!out.some((o) => o.key === key)) out.push({ key, label: `${SUBJECT_STAGE_LABEL[b.subjectType]}: ${s.name}` });
    }
  }
  return out;
}

export function processOptions(): Array<{ key: string; label: string }> {
  return PRACTICE_PROCESSES.map((p) => ({ key: p.key, label: p.name }));
}

// ── DB helpers ──────────────────────────────────────────────────────────

/** Distinct live SOPs (not deleted, with a current version) linked to any target. */
export async function linkedSopsFor(tx: Tx, tenantId: string, targets: SopTarget[]): Promise<LinkedSop[]> {
  const valid = targets.filter((t) => isSopLinkKind(t.kind) && t.key);
  if (!valid.length) return [];
  const pairs = sql.join(
    valid.map((t) => sql`(${t.kind}::text, ${t.key}::text)`),
    sql`, `
  );
  const r = await tx.execute(sql`
    SELECT l.target_kind, l.target_key, s.id AS sop_id, s.key, s.title, s.category,
           v.id AS version_id, v.version_number, COALESCE(v.body->>'markdown', '') AS markdown
      FROM sop_links l
      JOIN sops s ON s.id = l.sop_id AND s.tenant_id = l.tenant_id
      JOIN sop_versions v ON v.id = s.current_version_id AND v.tenant_id = s.tenant_id
     WHERE l.tenant_id = ${tenantId}::uuid
       AND s.deleted_at IS NULL
       AND (l.target_kind, l.target_key) IN (${pairs})
     ORDER BY s.title
  `);
  const bySop = new Map<string, LinkedSop>();
  for (const row of r.rows as any[]) {
    let s = bySop.get(row.sop_id);
    if (!s) {
      s = {
        sopId: row.sop_id,
        key: row.key,
        title: row.title,
        category: row.category ?? null,
        versionId: row.version_id,
        versionNumber: String(row.version_number),
        markdown: row.markdown ?? "",
        matched: [],
      };
      bySop.set(row.sop_id, s);
    }
    s.matched.push({ kind: row.target_kind, key: row.target_key });
  }
  return [...bySop.values()];
}

/** Names for the uuid-keyed targets (positions, templates) and the firm's SR types. */
export async function loadLinkLabelNames(tx: Tx, tenantId: string): Promise<LinkLabelNames> {
  const [pos, tpl, sr] = [
    await tx.execute(sql`SELECT id, title FROM practice_positions WHERE tenant_id = ${tenantId}::uuid`),
    await tx.execute(sql`SELECT id, name FROM task_templates WHERE tenant_id = ${tenantId}::uuid`),
    await tx.execute(sql`SELECT key, label FROM master_values WHERE tenant_id = ${tenantId}::uuid AND master_type = 'service_request_type'`),
  ];
  return {
    positions: new Map((pos.rows as any[]).map((r) => [String(r.id), String(r.title)])),
    templates: new Map((tpl.rows as any[]).map((r) => [String(r.id), String(r.name)])),
    srTypes: new Map((sr.rows as any[]).map((r) => [String(r.key), String(r.label)])),
  };
}

/** Position ids a user holds. */
export async function positionIdsOf(tx: Tx, tenantId: string, userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const r = await tx.execute(sql`
    SELECT position_id FROM practice_position_holders
     WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
  `);
  return (r.rows as any[]).map((x) => x.position_id as string);
}

/** The current stage of the journey a task is about (lead / service request / its subject). */
async function currentStageForTask(tx: Tx, tenantId: string, task: TaskLike): Promise<string | null> {
  const subjects: Array<[string, string]> = [];
  if (task.subjectType && isUuid(task.subjectId) && (BLUEPRINT_SUBJECTS as readonly string[]).includes(task.subjectType)) {
    subjects.push([task.subjectType, task.subjectId]);
  }
  if (isUuid(task.relatedLeadId)) subjects.push(["lead", task.relatedLeadId]);
  if (isUuid(task.relatedServiceRequestId)) subjects.push(["service_request", task.relatedServiceRequestId]);
  if (!subjects.length) return null;
  const r = await tx.execute(sql`
    SELECT subject_type, current_stage_key FROM blueprint_instances
     WHERE tenant_id = ${tenantId}::uuid AND status = 'in_progress'
       AND (subject_type, subject_id) IN (${sql.join(subjects.map(([t, id]) => sql`(${t}::text, ${id}::uuid)`), sql`, `)})
     LIMIT 1
  `);
  const row = (r.rows as any[])[0];
  return row ? blueprintStageKey(row.subject_type, row.current_stage_key) : null;
}

async function srTypeForTask(tx: Tx, tenantId: string, task: TaskLike): Promise<string | null> {
  const srId = isUuid(task.relatedServiceRequestId)
    ? task.relatedServiceRequestId
    : task.subjectType === "service_request" && isUuid(task.subjectId)
      ? task.subjectId
      : null;
  if (!srId) return null;
  const r = await tx.execute(sql`
    SELECT type FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND id = ${srId}::uuid LIMIT 1
  `);
  return ((r.rows as any[])[0]?.type as string | undefined) ?? null;
}

/**
 * The SOPs that say how to do this task — the MOST SPECIFIC ones only. A task
 * reaches many SOPs (its process covers a whole journey, the assignee's
 * position a whole job), and "How we do this" listing twenty of them helps
 * nobody. So: the SOPs linked to the task itself (template, type, journey
 * stage, request type); failing that, its process's; never the position's —
 * those belong in the person's own manual (/dashboard/practice/manual).
 */
export async function sopsForTask(tx: Tx, tenantId: string, task: TaskLike): Promise<LinkedSop[]> {
  const [srType, stage] = [
    await srTypeForTask(tx, tenantId, task),
    blueprintStageFromMeta(task.meta) ? null : await currentStageForTask(tx, tenantId, task),
  ];
  const targets = taskTargets(task, { srType, blueprintStage: stage });
  const specific = await linkedSopsFor(tx, tenantId, targets.filter((t) => t.kind !== "process"));
  if (specific.length) return specific;
  return linkedSopsFor(tx, tenantId, targets.filter((t) => t.kind === "process"));
}

/**
 * Processes owned by any of these positions: the firm's setting where one
 * exists, else the process's default owner (matched to the firm's position
 * with that key).
 */
export async function processesOwnedBy(
  tx: Tx,
  tenantId: string,
  positions: Array<{ id: string; key: string }>
): Promise<string[]> {
  if (!positions.length) return [];
  const r = await tx.execute(sql`
    SELECT process_key, owner_position_id FROM practice_process_settings WHERE tenant_id = ${tenantId}::uuid
  `);
  const setting = new Map<string, string | null>((r.rows as any[]).map((x) => [x.process_key, x.owner_position_id ?? null]));
  const ids = new Set(positions.map((p) => p.id));
  const keys = new Set(positions.map((p) => p.key));
  return PRACTICE_PROCESSES.filter((p) => {
    if (setting.has(p.key)) {
      const owner = setting.get(p.key);
      return !!owner && ids.has(owner);
    }
    return keys.has(p.defaultOwner) && DEFAULT_POSITIONS.some((d) => d.key === p.defaultOwner);
  }).map((p) => p.key);
}
