/**
 * "Later" on the server — park an opportunity until the client is ready,
 * bring it back, and escalate a reminder nobody acted on. Rules (lead days,
 * presets, limits) are later-core.ts.
 *
 *   parkOpportunity    the opportunity stays OPEN; its open tasks end, and
 *                      ONE reminder task replaces them, due reminderDay()
 *                      ahead of the revisit date. Waiting for MONEY ("when
 *                      my FD matures") records an expected inflow — the
 *                      firm's future-AUM pipeline — and its reminder task is
 *                      that reminder, so the RM never gets two. Parking a
 *                      parked one again is a snooze (park_count).
 *   resumeOpportunity  back to work now: the reminder ends, a follow-up task
 *                      takes its place. Moving the journey on by hand, or a
 *                      proposal being shared, resumes it too (journey.ts).
 *   escalateOverdueRevisits
 *                      a reminder ESCALATE_AFTER_DAYS overdue is sent to the
 *                      client's branch head (else the owner's manager) once.
 *                      Run by the task reminder scanner.
 *
 * Every reminder task carries meta.opportunityId — "follow-ups ARE tasks"
 * (journey.ts) — so the board's follow-up dates and overdue counts include it.
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { clientOpportunities, expectedInflows, tasks, type ClientOpportunity, INFLOW_SOURCE_LABELS, INFLOW_SOURCE_TYPES, type InflowSourceType } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { syncInflowReminder } from "@/lib/inflows/reminder";
import { formatDate, formatMoney } from "@/lib/format";
import { productLabel, type OpportunityPipeline } from "./products";
import { ESCALATE_AFTER_DAYS, REVISIT_LEAD_DAYS, istDay, reminderDay } from "./later-core";
import type { Actor } from "./journey";

const OPEN_TASK = sql`status IN ('open', 'in_progress', 'blocked')`;

export type ParkInput = {
  /** YYYY-MM-DD, after today. */
  revisitOn: string;
  /** What the client said. */
  reason: string;
  /** Waiting for money: where it comes from, and how much. */
  money?: { sourceType: InflowSourceType; amount?: number | null } | null;
};

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

async function clientName(tx: Tx, opp: ClientOpportunity) {
  const r = (await tx.execute(sql`SELECT name FROM investors WHERE id = ${opp.investorId}::uuid`)).rows[0] as { name: string } | undefined;
  return r?.name ?? "client";
}

/** End the opportunity's open tasks (its follow-ups, or the previous reminder). */
async function cancelOpenTasks(tx: Tx, opp: ClientOpportunity, onlyRevisit = false) {
  await tx.execute(sql`
    UPDATE tasks SET status = 'cancelled', updated_at = now()
     WHERE tenant_id = ${opp.tenantId}::uuid AND meta ->> 'opportunityId' = ${opp.id} AND ${OPEN_TASK}
       ${onlyRevisit ? sql`AND meta ->> 'revisit' = 'true'` : sql``}
       AND COALESCE(meta ->> 'rtaCheck', '') <> 'true'
  `);
}

export async function parkOpportunity(tx: Tx, actor: Actor, opp: ClientOpportunity, input: ParkInput) {
  if (opp.status !== "open") throw fail(`This opportunity is already ${opp.status}.`, 409);
  const today = istDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.revisitOn) || input.revisitOn <= today) {
    throw fail("Pick a revisit date after today.");
  }
  const moneyLabel = input.money ? INFLOW_SOURCE_LABELS[input.money.sourceType] ?? "Money" : null;
  const reason = input.reason.trim().slice(0, 300)
    || (moneyLabel ? `When the ${moneyLabel} comes in` : "Client asked to revisit later");
  const pipeline = opp.pipeline as OpportunityPipeline;
  const name = await clientName(tx, opp);
  const product = productLabel(opp.product);
  const owner = opp.ownerId ?? actor.userId;
  const remindOn = reminderDay(input.revisitOn, pipeline, today);
  const snooze = !!opp.parkedAt;

  // Whatever was open — the follow-up, or the reminder of an earlier "later" —
  // ends; one reminder replaces it.
  await cancelOpenTasks(tx, opp);

  let inflowId: string | null = null;
  let taskId: string | null = null;
  if (input.money) {
    const amount = input.money.amount ?? (opp.expectedValue == null ? null : Number(opp.expectedValue));
    const fields = {
      sourceType: input.money.sourceType,
      expectedAmount: amount == null ? null : String(amount),
      expectedOn: input.revisitOn,
      remindDaysBefore: REVISIT_LEAD_DAYS[pipeline],
      ownerId: owner,
      notes: `${product} — ${reason}`,
      updatedAt: new Date(),
    };
    // A snooze moves the inflow it already waits for; otherwise a new one.
    const [prev] = opp.expectedInflowId
      ? await tx.select().from(expectedInflows).where(eq(expectedInflows.id, opp.expectedInflowId)).limit(1)
      : [];
    const [row] = prev && ["expected", "confirmed"].includes(prev.status)
      ? await tx.update(expectedInflows).set(fields as any).where(eq(expectedInflows.id, prev.id)).returning()
      : await tx.insert(expectedInflows).values({
          ...fields, tenantId: opp.tenantId, investorId: opp.investorId, status: "expected", createdBy: actor.userId,
        } as any).returning();
    inflowId = row.id;
    taskId = await syncInflowReminder(tx, opp.tenantId, actor.userId, {
      id: row.id, investorId: row.investorId, ownerId: row.ownerId, sourceType: row.sourceType as InflowSourceType,
      expectedAmount: row.expectedAmount, expectedOn: row.expectedOn, remindDaysBefore: row.remindDaysBefore,
      reminderTaskId: row.reminderTaskId, status: row.status,
    });
    if (taskId && taskId !== row.reminderTaskId) {
      await tx.update(expectedInflows).set({ reminderTaskId: taskId } as any).where(eq(expectedInflows.id, row.id));
    }
    if (taskId) {
      // The inflow's reminder IS the opportunity's: tag it, and say what the money is for.
      await tx.update(tasks).set({
        title: `${product} — ${name}: ${moneyLabel}${amount ? ` ${formatMoney(amount)}` : ""} due ${formatDate(input.revisitOn)}`,
        description:
          `${name} said: "${reason}". They will take ${product} once this money comes in, around ${formatDate(input.revisitOn)}.\n\n` +
          `Call before the date and ask whether it has arrived. When it has, open the opportunity and press "Resume now"; ` +
          `if it hasn't, give it a new date; if their plans changed, close it as lost.`,
        meta: sql`COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ opportunityId: opp.id, revisit: true })}::jsonb`,
      } as any).where(eq(tasks.id, taskId));
    }
  } else {
    const [t] = await tx.insert(tasks).values({
      tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
      type: "follow_up",
      title: `Revisit ${product} — ${name}: “${reason}”`,
      description:
        `${name} wanted ${product}${opp.expectedValue ? ` (${formatMoney(Number(opp.expectedValue))})` : ""} but asked to wait: "${reason}". ` +
        `They expected to go ahead around ${formatDate(input.revisitOn)}.\n\n` +
        `Call now, before that date, while the money is still uncommitted. ` +
        `Then open the opportunity: "Resume now" if they are ready, a new date if not, or close it as lost.`,
      priority: "normal", status: "open", assigneeId: owner,
      dueAt: new Date(`${remindOn}T10:00:00+05:30`), remindAt: new Date(`${remindOn}T10:00:00+05:30`),
      createdById: actor.userId,
      meta: { opportunityId: opp.id, revisit: true },
    } as any).returning({ id: tasks.id });
    taskId = t?.id ?? null;
    // A date this time: it no longer waits for the money it waited for before.
    inflowId = null;
  }

  await tx.update(clientOpportunities).set({
    parkedAt: new Date(),
    revisitOn: input.revisitOn,
    parkedReason: reason,
    parkCount: (opp.parkCount ?? 0) + 1,
    expectedInflowId: inflowId,
    updatedAt: new Date(),
  } as any).where(eq(clientOpportunities.id, opp.id));

  await recordAudit(tx, {
    tenantId: opp.tenantId, actorUserId: actor.userId, action: snooze ? "opportunity.snooze" : "opportunity.park",
    entityType: "opportunity", entityId: opp.id,
    before: { parkedAt: opp.parkedAt, revisitOn: opp.revisitOn, parkedReason: opp.parkedReason },
    after: { revisitOn: input.revisitOn, reason, remindOn, inflowId, money: input.money ?? null },
  } as any);
  return { remindOn, taskId, inflowId };
}

/**
 * Back to work. `followUpOn` (YYYY-MM-DD) is when the owner talks to the
 * client next — default tomorrow. With `quiet`, no follow-up task is created
 * (the journey moved on by itself; its next step is already the next action).
 */
export async function resumeOpportunity(
  tx: Tx, actor: Actor, opp: ClientOpportunity, opts: { followUpOn?: string | null; quiet?: boolean } = {},
) {
  if (!opp.parkedAt) return;
  await cancelOpenTasks(tx, opp, true);
  await tx.update(clientOpportunities).set({
    parkedAt: null, revisitOn: null, parkedReason: null, updatedAt: new Date(),
  } as any).where(eq(clientOpportunities.id, opp.id));
  if (!opts.quiet) {
    const day = opts.followUpOn && opts.followUpOn >= istDay() ? opts.followUpOn : istDay(1);
    const name = await clientName(tx, opp);
    await tx.insert(tasks).values({
      tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
      type: "follow_up", title: `${productLabel(opp.product)} — talk to ${name} (back from Later)`,
      description: opp.parkedReason ? `They had asked to wait: "${opp.parkedReason}".` : null,
      priority: "normal", status: "open", assigneeId: opp.ownerId ?? actor.userId,
      dueAt: new Date(`${day}T10:00:00+05:30`), createdById: actor.userId,
      meta: { opportunityId: opp.id },
    } as any);
  }
  await recordAudit(tx, {
    tenantId: opp.tenantId, actorUserId: actor.userId, action: "opportunity.resume",
    entityType: "opportunity", entityId: opp.id,
    before: { revisitOn: opp.revisitOn, parkedReason: opp.parkedReason }, after: { quiet: !!opts.quiet },
  } as any);
}

/**
 * Reminders of parked opportunities more than ESCALATE_AFTER_DAYS overdue:
 * tell the client's branch head (else the owner's reporting manager) once.
 * Returns how many were escalated.
 */
export async function escalateOverdueRevisits(tx: Tx, tenantId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT t.id AS task_id, t.due_at, t.assignee_id, o.id AS opp_id, o.product, o.parked_reason,
           i.name AS client_name, i.branch_id, a.name AS assignee_name, a.reporting_manager_id
      FROM tasks t
      JOIN client_opportunities o ON o.id::text = t.meta ->> 'opportunityId' AND o.tenant_id = t.tenant_id
      JOIN investors i ON i.id = o.investor_id
      LEFT JOIN users a ON a.id = t.assignee_id
     WHERE t.tenant_id = ${tenantId}::uuid AND t.deleted_at IS NULL
       AND t.status IN ('open', 'in_progress', 'blocked')
       AND t.meta ->> 'revisit' = 'true' AND NOT (t.meta ? 'escalatedAt')
       AND o.status = 'open' AND o.parked_at IS NOT NULL
       AND t.due_at < now() - make_interval(days => ${ESCALATE_AFTER_DAYS}::int)
     LIMIT 200
  `)).rows as Array<{
    task_id: string; due_at: string; assignee_id: string | null; opp_id: string; product: string; parked_reason: string | null;
    client_name: string; branch_id: string | null; assignee_name: string | null; reporting_manager_id: string | null;
  }>;

  let n = 0;
  for (const r of rows) {
    const heads = r.branch_id
      ? ((await tx.execute(sql`
          SELECT id FROM users
           WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND branch_id = ${r.branch_id}::uuid
             AND roles @> ARRAY['branch_head']::text[]
        `)).rows as Array<{ id: string }>).map((u) => u.id)
      : [];
    const to = [...new Set((heads.length ? heads : [r.reporting_manager_id]).filter((u): u is string => !!u && u !== r.assignee_id))];
    for (const userId of to) {
      await createNotification(tx, {
        tenantId, userId, kind: "opportunity.revisit_overdue", severity: "warning",
        title: `${r.client_name}: ${productLabel(r.product)} revisit not followed up`,
        body: `${r.assignee_name ?? "The owner"} was due to call by ${formatDate(r.due_at)}${r.parked_reason ? ` (client said: ${r.parked_reason})` : ""}.`,
        linkUrl: `/dashboard/opportunities/${r.opp_id}`,
      });
    }
    // Marked even with nobody to tell, so it is not re-examined every sweep.
    await tx.execute(sql`
      UPDATE tasks SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('escalatedAt', now()::text, 'escalatedTo', ${JSON.stringify(to)}::jsonb)
       WHERE id = ${r.task_id}::uuid
    `);
    n++;
  }
  return n;
}

/** The request shape of "Later", shared by the create and the later routes. */
export const LaterBody = z.object({
  revisitOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a revisit date"),
  reason: z.string().max(300).default(""),
  money: z.object({
    sourceType: z.enum(INFLOW_SOURCE_TYPES),
    amount: z.coerce.number().positive().max(1e12).nullish(),
  }).nullish(),
});
