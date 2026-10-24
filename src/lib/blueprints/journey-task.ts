/**
 * Client onboarding journey → Tasks module.
 *
 * Every step of the client phase of the journey (Request Documents … Add in
 * Review Sheet) puts ONE task in the Tasks module, so the person who owns the
 * step sees it in their list and the client page's Open tasks. The task is never
 * closed by the journey: it stays open, moving on or not, until its assignee
 * completes it in the Tasks module. Called from `transitionTo`, so every way
 * of moving a step (buttons, auto-advance, Kanban, multi-hop) is covered.
 *
 * Idempotent: a stage keeps at most one open journey task per lead
 * (`meta.journeyStageKey`), so a retry or a re-entry never doubles it.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tasks } from "@/db/schema";
import { v4 as uuid } from "uuid";
import { createNotification } from "@/lib/notifications/create";
import { LEAD_PHASE_LAST_ORDER, LEAD_TO_CLIENT_STAGES } from "./lead_to_client";

const CODE_ORDER = new Map(LEAD_TO_CLIENT_STAGES.map((s) => [s.key, s.order] as const));

/** Is this step part of client onboarding (after the lead phase)? Decided by the
 *  step's place in the SOP in code, not by the firm's stored copy of the
 *  blueprint: a firm whose blueprint was copied before the SOP was renumbered
 *  would otherwise put these steps on the wrong side of the boundary and get no
 *  task. The stored order is the fallback for a step the code does not know. */
export function isOnboardingStage(stageKey: string, storedOrder: number | null | undefined): boolean {
  const order = CODE_ORDER.get(stageKey) ?? storedOrder ?? 0;
  return order > LEAD_PHASE_LAST_ORDER;
}

/** What creating the step's task came to — echoed to the screen so the person
 *  moving the step sees the task (or why there is none). */
export type JourneyTaskResult =
  | { status: "created"; id: string; title: string; assigneeName: string | null }
  | { status: "exists"; title: string | null }
  | { status: "skipped"; reason: string };

/** What the person moving the step chose in the pop-up (all optional). */
export interface JourneyTaskInput {
  assigneeId?: string;
  dueAt?: Date;
  title?: string;
  description?: string;
  type?: string;
  priority?: "low" | "normal" | "high" | "urgent";
}

const DAY = 86_400_000;

export async function createJourneyTask(
  tx: Tx,
  p: {
    tenantId: string;
    leadId: string;
    stageKey: string;
    stageName: string;
    ownerRole: string | null;
    slaDays: number | null;
    actorUserId?: string | null;
    input?: JourneyTaskInput;
  },
): Promise<JourneyTaskResult> {
  const open = await tx.execute(sql`
    SELECT title FROM tasks
    WHERE tenant_id = ${p.tenantId}::uuid AND deleted_at IS NULL
      AND status NOT IN ('completed', 'cancelled')
      AND meta->>'journeyLeadId' = ${p.leadId}
      AND meta->>'journeyStageKey' = ${p.stageKey}
    LIMIT 1
  `);
  if (open.rows.length) return { status: "exists", title: (open.rows[0] as { title?: string }).title ?? null };

  // The lead, and the client it became (the blueprint subject can also be a
  // client with no lead row).
  const lr = await tx.execute(sql`
    SELECT name, owner_id, converted_investor_id FROM leads
    WHERE id = ${p.leadId}::uuid AND tenant_id = ${p.tenantId}::uuid LIMIT 1
  `);
  const lead = lr.rows[0] as { name?: string; owner_id?: string; converted_investor_id?: string } | undefined;
  let investorId = lead?.converted_investor_id ?? null;
  let clientName = lead?.name ?? null;
  if (!lead) {
    const ir = await tx.execute(sql`
      SELECT id, name FROM investors WHERE id = ${p.leadId}::uuid AND tenant_id = ${p.tenantId}::uuid LIMIT 1
    `);
    const inv = ir.rows[0] as { id: string; name: string } | undefined;
    investorId = inv?.id ?? null;
    clientName = inv?.name ?? null;
  }

  // Assignee: the one chosen in the pop-up; else the step's owning role (the
  // active person with the fewest open tasks); else the lead's owner; else
  // whoever moved the step.
  let assigneeId = p.input?.assigneeId ?? null;
  if (!assigneeId && p.ownerRole && p.ownerRole !== "sales") {
    const r = await tx.execute(sql`
      SELECT u.id FROM users u
      WHERE u.tenant_id = ${p.tenantId}::uuid AND u.status = 'active' AND u.roles && ARRAY[${p.ownerRole}]::text[]
      ORDER BY (SELECT count(*) FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL
                  AND t.status NOT IN ('completed', 'cancelled')) ASC, u.created_at ASC
      LIMIT 1
    `);
    assigneeId = (r.rows[0] as { id?: string } | undefined)?.id ?? null;
  }
  assigneeId = assigneeId ?? lead?.owner_id ?? p.actorUserId ?? null;
  if (!assigneeId) return { status: "skipped", reason: "no one to assign it to" }; // never block the step

  const dept = await tx.execute(sql`SELECT department, name FROM users WHERE id = ${assigneeId}::uuid LIMIT 1`);
  const assignee = dept.rows[0] as { department?: string; name?: string } | undefined;
  const department = assignee?.department ?? null;

  const taskId = uuid();
  const title = p.input?.title ?? `Onboarding: ${p.stageName}${clientName ? ` — ${clientName}` : ""}`;
  await tx.insert(tasks).values({
    id: taskId,
    tenantId: p.tenantId,
    assigneeId,
    createdById: p.actorUserId ?? null,
    department,
    subjectType: investorId ? "investor" : "lead",
    subjectId: investorId ?? p.leadId,
    relatedInvestorId: investorId,
    relatedLeadId: lead ? p.leadId : null,
    type: p.input?.type ?? "onboarding",
    title,
    description: p.input?.description ?? `Client onboarding step "${p.stageName}".`,
    priority: p.input?.priority ?? "normal",
    status: "open",
    dueAt: p.input?.dueAt ?? new Date(Date.now() + Math.max(1, p.slaDays ?? 3) * DAY),
    meta: { journeyLeadId: p.leadId, journeyStageKey: p.stageKey },
  } as any);

  if (p.actorUserId && assigneeId !== p.actorUserId) {
    await createNotification(tx, {
      tenantId: p.tenantId,
      userId: assigneeId,
      kind: "task.assigned",
      title: `New task: ${p.input?.title ?? p.stageName}`,
      body: "A client onboarding step was assigned to you",
      linkUrl: "/dashboard/tasks?view=to_me",
      severity: "info",
      meta: { lead_id: p.leadId, stage: p.stageKey },
    });
  }

  return { status: "created", id: taskId, title, assigneeName: assignee?.name ?? null };
}
