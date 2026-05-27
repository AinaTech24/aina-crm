/**
 * Action handlers for Workflow Rules.
 *
 * Each handler is a small function: (action.config, ctx) → ActionResult.
 * We deliberately keep the handlers thin and reuse existing infrastructure:
 *   - send_email / send_whatsapp / send_sms — `dispatch()` from comms/pipeline
 *   - create_task — direct insert into `tasks`
 *   - update_field — UPDATE against the module's table
 *   - create_notification — insert into `notifications` table
 *   - webhook — outbound HTTP via fetch
 *   - schedule_meeting — insert into review_meetings
 *   - schedule_call — task with type='call'
 *   - convert_lead — re-uses /api/leads/[id]/convert flow
 *   - create_record — generic insert into another module's table
 *   - custom_function — runs a server-saved function (stub for now)
 *   - add_tag / remove_tag — appends/removes from a `tags` jsonb array
 */

import { sql } from "drizzle-orm";
import { getModule } from "./modules";
import type { Action } from "./types";
import { tasks, notifications, reviewMeetings } from "@/db/schema";

export interface ActionContext {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  record: Record<string, unknown>;
  tx: any;
}

export interface ActionResult {
  type: string;
  status: "succeeded" | "failed" | "skipped";
  detail?: string;
  externalId?: string;
  error?: string;
}

export async function executeAction(action: Action, ctx: ActionContext): Promise<ActionResult> {
  switch (action.type) {
    case "send_email":
      return runSendEmail(action.config, ctx);
    case "send_whatsapp":
      return runSendWhatsApp(action.config, ctx);
    case "send_sms":
      return runSendSms(action.config, ctx);
    case "create_task":
      return runCreateTask(action.config, ctx);
    case "schedule_meeting":
      return runScheduleMeeting(action.config, ctx);
    case "schedule_call":
      return runScheduleCall(action.config, ctx);
    case "update_field":
      return runUpdateField(action.config, ctx);
    case "add_tag":
      return runTagOp("add", action.config, ctx);
    case "remove_tag":
      return runTagOp("remove", action.config, ctx);
    case "webhook":
      return runWebhook(action.config, ctx);
    case "custom_function":
      return runCustomFunction(action.config, ctx);
    case "create_record":
      return runCreateRecord(action.config, ctx);
    case "convert_lead":
      return runConvertLead(action.config, ctx);
    case "create_notification":
      return runCreateNotification(action.config, ctx);
    default:
      return { type: action.type, status: "skipped", detail: "unknown action type" };
  }
}

// ---------------------------------------------------------------------------
// Comms (delegate to existing comms pipeline via dynamic import)
// ---------------------------------------------------------------------------

async function runSendEmail(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "email",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: { source: "subject", subjectType: ctx.subjectType, subjectId: ctx.subjectId } as any,
      variables: (config.variables ?? {}) as Record<string, string>,
      category: (config.category ?? "transactional") as any,
    } as any);
    return { type: "send_email", status: "succeeded", externalId: (res as any)?.id };
  } catch (e: any) {
    return { type: "send_email", status: "failed", error: e?.message ?? String(e) };
  }
}

async function runSendWhatsApp(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "whatsapp",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: { source: "subject", subjectType: ctx.subjectType, subjectId: ctx.subjectId } as any,
      variables: (config.variables ?? {}) as Record<string, string>,
      category: (config.category ?? "transactional") as any,
    } as any);
    return { type: "send_whatsapp", status: "succeeded", externalId: (res as any)?.id };
  } catch (e: any) {
    return { type: "send_whatsapp", status: "failed", error: e?.message ?? String(e) };
  }
}

async function runSendSms(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "sms",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: { source: "subject", subjectType: ctx.subjectType, subjectId: ctx.subjectId } as any,
      variables: (config.variables ?? {}) as Record<string, string>,
    } as any);
    return { type: "send_sms", status: "succeeded", externalId: (res as any)?.id };
  } catch (e: any) {
    return { type: "send_sms", status: "failed", error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Task / Meeting / Call
// ---------------------------------------------------------------------------

async function runCreateTask(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const dueOffset = (config.dueOffset as { amount?: number; unit?: string } | undefined) ?? undefined;
  const dueAt = dueOffset ? offsetDate(dueOffset.amount ?? 1, (dueOffset.unit as any) ?? "day") : undefined;
  const assigneeId = resolveAssignee(config.assignee, ctx.record);

  const inserted = await ctx.tx
    .insert(tasks)
    .values({
      tenantId: ctx.tenantId,
      title: String(config.title ?? "Workflow task"),
      description: String(config.description ?? ""),
      type: String(config.taskType ?? "follow_up"),
      priority: (config.priority as any) ?? "normal",
      status: "open",
      assigneeId: assigneeId,
      department: (config.department as any) ?? "operations",
      dueAt,
      relatedInvestorId: ctx.subjectType === "investor" ? ctx.subjectId : undefined,
      relatedLeadId: ctx.subjectType === "lead" ? ctx.subjectId : undefined,
      relatedServiceRequestId: ctx.subjectType === "service_request" ? ctx.subjectId : undefined,
    })
    .returning({ id: tasks.id });
  return { type: "create_task", status: "succeeded", externalId: inserted[0]?.id };
}

async function runScheduleMeeting(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const dateOffset = (config.dateOffset as { amount?: number; unit?: string } | undefined) ?? undefined;
  const meetingDate = dateOffset
    ? offsetDate(dateOffset.amount ?? 3, (dateOffset.unit as any) ?? "day")
    : offsetDate(3, "day");

  if (ctx.subjectType !== "investor") {
    return { type: "schedule_meeting", status: "skipped", detail: "subject is not an investor" };
  }

  const inserted = await ctx.tx
    .insert(reviewMeetings)
    .values({
      tenantId: ctx.tenantId,
      investorId: ctx.subjectId,
      category: (config.category as any) ?? "review",
      meetingType: (config.meetingType as any) ?? "portfolio_review",
      meetingDate,
      durationMinutes: Number(config.durationMinutes ?? 30),
      meetingMode: (config.mode as any) ?? "online",
      status: "scheduled",
    })
    .returning({ id: reviewMeetings.id });
  return { type: "schedule_meeting", status: "succeeded", externalId: inserted[0]?.id };
}

async function runScheduleCall(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  return runCreateTask({ ...config, taskType: "call", title: config.title ?? "Call client" }, ctx);
}

// ---------------------------------------------------------------------------
// Field update
// ---------------------------------------------------------------------------

async function runUpdateField(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const updates = (config.updates as Record<string, unknown> | undefined) ?? {};
  if (!Object.keys(updates).length) {
    return { type: "update_field", status: "skipped", detail: "no updates" };
  }

  // Determine table from subjectType
  const moduleKey = subjectTypeToModule(ctx.subjectType);
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  if (!mod) {
    return { type: "update_field", status: "failed", error: `unknown module for ${ctx.subjectType}` };
  }

  // Build SET clause safely from catalog-defined writable fields
  const setParts: any[] = [];
  for (const [k, v] of Object.entries(updates)) {
    const field = mod.fields.find((f) => f.key === k);
    if (!field?.writable) continue;
    setParts.push(sql`${sql.identifier(k)} = ${v}`);
  }
  if (!setParts.length) {
    return { type: "update_field", status: "skipped", detail: "no writable fields in updates" };
  }
  setParts.push(sql`updated_at = now()`);

  await ctx.tx.execute(
    sql`UPDATE ${sql.identifier(mod.table)} SET ${sql.join(setParts, sql`, `)} WHERE id = ${ctx.subjectId}`
  );
  return { type: "update_field", status: "succeeded" };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function runTagOp(op: "add" | "remove", config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const tag = String(config.tag ?? "").trim();
  if (!tag) return { type: `${op}_tag`, status: "skipped", detail: "no tag provided" };

  const moduleKey = subjectTypeToModule(ctx.subjectType);
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  if (!mod) return { type: `${op}_tag`, status: "failed", error: `unknown module for ${ctx.subjectType}` };

  const tagsExpr =
    op === "add"
      ? sql`COALESCE(tags, '[]'::jsonb) || ${JSON.stringify([tag])}::jsonb`
      : sql`COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(tags) elem WHERE elem <> ${tag}), '[]'::jsonb)`;

  try {
    await ctx.tx.execute(
      sql`UPDATE ${sql.identifier(mod.table)} SET tags = ${tagsExpr}, updated_at = now() WHERE id = ${ctx.subjectId}`
    );
    return { type: `${op}_tag`, status: "succeeded" };
  } catch (e: any) {
    return { type: `${op}_tag`, status: "failed", error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

async function runWebhook(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const url = String(config.url ?? "");
  if (!url) return { type: "webhook", status: "skipped", detail: "no url" };
  const method = String(config.method ?? "POST");
  const headers = (config.headers as Record<string, string>) ?? {};
  const body = {
    tenantId: ctx.tenantId,
    subjectType: ctx.subjectType,
    subjectId: ctx.subjectId,
    record: ctx.record,
    extra: config.body ?? null,
  };
  try {
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    return { type: "webhook", status: r.ok ? "succeeded" : "failed", detail: `HTTP ${r.status}` };
  } catch (e: any) {
    return { type: "webhook", status: "failed", error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Custom function (stub — Phase 2 will be a sandboxed Deluge-like runtime)
// ---------------------------------------------------------------------------

async function runCustomFunction(_config: Record<string, unknown>, _ctx: ActionContext): Promise<ActionResult> {
  return {
    type: "custom_function",
    status: "skipped",
    detail: "Custom functions require an admin to publish a function first. Use Webhook for now.",
  };
}

// ---------------------------------------------------------------------------
// Record creation / lead conversion
// ---------------------------------------------------------------------------

async function runCreateRecord(_config: Record<string, unknown>, _ctx: ActionContext): Promise<ActionResult> {
  return {
    type: "create_record",
    status: "skipped",
    detail: "create_record handler is Phase 2 — use webhook + UI for now.",
  };
}

async function runConvertLead(_config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  if (ctx.subjectType !== "lead") {
    return { type: "convert_lead", status: "skipped", detail: "subject is not a lead" };
  }
  // Defer to existing /api/leads/[id]/convert handler — but that requires a session.
  // For now, just flag the lead as 'converted' — the existing convert flow can be
  // re-used via a follow-up task action.
  return {
    type: "convert_lead",
    status: "skipped",
    detail: "convert_lead currently runs via the leads UI — wire to /api/leads/<id>/convert in a follow-up.",
  };
}

// ---------------------------------------------------------------------------
// In-app notification
// ---------------------------------------------------------------------------

async function runCreateNotification(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  // Audience: { users: string[], roles: string[], subjectRm: boolean }
  const aud = (config.audience as { users?: string[]; roles?: string[]; subjectRm?: boolean }) ?? {};
  const userIds = aud.users ?? [];

  // If subjectRm — pull rm_id from the record
  if (aud.subjectRm && ctx.record.rm_id) userIds.push(String(ctx.record.rm_id));

  if (!userIds.length) {
    return { type: "create_notification", status: "skipped", detail: "no recipients" };
  }

  const rows = userIds.map((uid) => ({
    tenantId: ctx.tenantId,
    userId: uid,
    kind: String(config.kind ?? "workflow.rule"),
    title: String(config.title ?? "Workflow rule alert"),
    body: String(config.body ?? ""),
    linkUrl: String(config.linkUrl ?? ""),
    severity: (config.severity as any) ?? "info",
  }));
  await ctx.tx.insert(notifications).values(rows);
  return { type: "create_notification", status: "succeeded" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function offsetDate(amount: number, unit: "minute" | "hour" | "day" | "week"): Date {
  const ms =
    unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : unit === "day" ? 86_400_000 : 604_800_000;
  return new Date(Date.now() + amount * ms);
}

function resolveAssignee(spec: unknown, record: Record<string, unknown>): string | undefined {
  if (!spec) return undefined;
  const s = String(spec);
  if (s.startsWith("fixed:")) return s.slice(6);
  if (s === "subject.rm_id" || s === "subject.owner_id") {
    return (record.rm_id as string) ?? (record.owner_id as string) ?? undefined;
  }
  return undefined;
}

function subjectTypeToModule(subjectType: string): string | undefined {
  const map: Record<string, string> = {
    investor: "investors",
    lead: "leads",
    task: "tasks",
    family: "families",
    transaction: "transactions",
    sip: "sips",
    sip_rejection: "sip_rejections",
    service_request: "service_requests",
    complaint: "complaints",
    review_meeting: "review_meetings",
    proposal: "proposals",
    insurance_policy: "insurance",
    content_post: "content_posts",
    campaign: "campaigns",
    goal: "goals",
    onboarding: "onboarding",
    risk_profile: "risk_profiles",
  };
  return map[subjectType];
}
