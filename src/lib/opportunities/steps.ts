/**
 * Step actions — what each step of an opportunity's journey asks for, as the
 * lead journey does (the firm's request of 2026-10-17: "when I click on any
 * stage it is not asking for anything — like schedule meeting, follow up").
 *
 * Every action records what it captured (`client_opportunities.step_details`,
 * by stage key; migration 0250), and then moves the journey through advanceOpportunity — so the compliance gates and the
 * automatic skips apply exactly as they do to "Move to". An action can also
 * set the next follow-up (setFollowUp: the follow-up IS a task).
 *
 *   identified        log_call (spoke → Discussion; no answer → stays, follow-up)
 *                     schedule_meeting (the meeting is created by the Meetings
 *                     API first; it is linked here and the journey moves on)
 *   discussion        meeting_done (completes the linked meeting), reschedule
 *                     (the meeting is moved by the Meetings API), log_call
 *   proposal          quote_shared (a quote given outside the CRM)
 *   accepted          record_acceptance
 *   mf_transaction    order_placed        (amount, date, order number) → review
 *   ins_*             form_submitted · underwriting_cleared · policy_issued
 *   gen_executed      executed
 *   back-office steps assign_ops: a task for an operations person, due on a
 *                     date; it closes when the step is done or the opportunity
 *                     closes (meta.opportunityStepOf — not the follow-up)
 *   any step          move: done on a date, then the next step
 *
 * No notes box on any of them (the firm's rule for journey pop-ups).
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientOpportunities, tasks, type ClientOpportunity } from "@/db/schema";
import { ensureInstanceFor } from "@/lib/blueprints/poly-engine";
import { recordAudit } from "@/lib/audit";
import { formatDate, formatMoney } from "@/lib/format";
import { productLabel } from "./products";
import { stageName } from "./stages";
import { advanceOpportunity, setFollowUp, type Actor, type Prerequisite } from "./journey";

export const STEP_ACTIONS = [
  "log_call", "schedule_meeting", "reschedule_meeting", "meeting_done", "quote_shared", "record_acceptance",
  "assign_ops", "order_placed",
  "form_submitted", "underwriting_cleared", "policy_issued", "executed", "move",
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export type StepInput = {
  action: StepAction;
  /** YYYY-MM-DD — when the thing happened (call, meeting held, accepted …). */
  on?: string | null;
  outcome?: "spoke" | "no_answer" | null;
  meetingId?: string | null;
  assigneeId?: string | null;
  dueOn?: string | null;
  amount?: number | null;
  orderNo?: string | null;
  formNo?: string | null;
  policyNo?: string | null;
  /** YYYY-MM-DD — the next follow-up, when the opportunity stays open. */
  followUpOn?: string | null;
};

export type StepResult =
  | { ok: true; stage: string; moved: boolean; skipped: string[] }
  | { ok: false; error: string; blocked?: Prerequisite[]; status: number };

/** Back-office steps whose work can be handed to an operations person. */
export const OPS_STEPS: Record<string, string> = {
  mf_transaction: "Place the order",
  ins_proposal_form: "Submit the proposal form",
  ins_underwriting: "Track underwriting / medicals",
  gen_executed: "Execute the investment",
};

/** Which stage each action belongs to (`move` and `assign_ops` are checked apart). */
const ACTION_STAGES: Record<Exclude<StepAction, "move" | "assign_ops">, string[]> = {
  log_call: ["identified", "discussion"],
  schedule_meeting: ["identified", "discussion"],
  reschedule_meeting: ["discussion"],
  meeting_done: ["discussion"],
  quote_shared: ["proposal"],
  record_acceptance: ["accepted"],
  order_placed: ["mf_transaction"],
  form_submitted: ["ins_proposal_form"],
  underwriting_cleared: ["ins_underwriting"],
  policy_issued: ["ins_issued"],
  executed: ["gen_executed"],
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const istToday = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const fail = (error: string, status = 400): StepResult => ({ ok: false, error, status });

async function loadOpp(tx: Tx, tenantId: string, id: string): Promise<ClientOpportunity | null> {
  const [opp] = await tx.select().from(clientOpportunities)
    .where(and(eq(clientOpportunities.tenantId, tenantId), eq(clientOpportunities.id, id))).limit(1);
  return opp ?? null;
}

/** Keep what a step recorded, under its stage key. */
async function remember(tx: Tx, opp: ClientOpportunity, stage: string, details: Record<string, unknown>, actor: Actor) {
  const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  await tx.execute(sql`
    UPDATE client_opportunities
       SET step_details = COALESCE(step_details, '{}'::jsonb)
             || jsonb_build_object(${stage}::text,
                  COALESCE(step_details -> ${stage}, '{}'::jsonb) || ${JSON.stringify({ ...clean, by: actor.userId, at: new Date().toISOString() })}::jsonb),
           updated_at = now()
     WHERE id = ${opp.id}::uuid AND tenant_id = ${opp.tenantId}::uuid
  `);
}

/** The step's hand-off tasks end when the step is done. */
async function closeStepTasks(tx: Tx, opp: ClientOpportunity, stage: string) {
  await tx.execute(sql`
    UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE tenant_id = ${opp.tenantId}::uuid AND meta ->> 'opportunityStepOf' = ${opp.id}
       AND meta ->> 'opportunityStep' = ${stage} AND status IN ('open', 'in_progress', 'blocked')
  `);
}

export async function runStepAction(tx: Tx, actor: Actor, id: string, input: StepInput): Promise<StepResult> {
  const opp = await loadOpp(tx, actor.tenantId, id);
  if (!opp) return fail("Opportunity not found", 404);
  if (opp.status !== "open") return fail(`This opportunity is already ${opp.status}.`, 409);
  const inst = await ensureInstanceFor(tx, actor.tenantId, "opportunity", opp.id);
  const stage = inst.currentStageKey;

  const on = input.on && DAY.test(input.on) ? input.on : istToday();
  if (on > istToday() && input.action !== "assign_ops") return fail("That date is in the future.");
  if (input.followUpOn && (!DAY.test(input.followUpOn) || input.followUpOn < istToday())) {
    return fail("Pick a follow-up date from today on.");
  }
  if (input.action === "assign_ops") {
    if (!OPS_STEPS[stage]) return fail(`"${stageName(stage)}" is not a step to hand to operations.`, 409);
  } else if (input.action !== "move" && !ACTION_STAGES[input.action].includes(stage)) {
    return fail(`That is not something to do at "${stageName(stage)}".`, 409);
  }

  const client = ((await tx.execute(sql`
    SELECT name FROM investors WHERE id = ${opp.investorId}::uuid AND tenant_id = ${opp.tenantId}::uuid
  `)).rows[0] as { name: string } | undefined)?.name ?? "client";
  const product = productLabel(opp.product);

  /** Move on with a history remark; then the follow-up, when it stays open. */
  const move = async (remarks: string, details: Record<string, unknown> = {}, followUpOn = input.followUpOn): Promise<StepResult> => {
    await remember(tx, opp, stage, { action: input.action, on, ...details }, actor);
    const r = await advanceOpportunity(tx, actor, opp.id, { remarks });
    if (!r.ok) return r;
    await closeStepTasks(tx, opp, stage);
    if (followUpOn && r.stage !== "won" && r.stage !== "lost") {
      const fresh = await loadOpp(tx, actor.tenantId, opp.id);
      if (fresh && fresh.status === "open") await setFollowUp(tx, actor, fresh, followUpOn);
    }
    return { ok: true, stage: r.stage, moved: true, skipped: r.skipped };
  };
  /** Stay on the step: record it, and set the follow-up. */
  const stay = async (details: Record<string, unknown>, audit: string, followUpOn = input.followUpOn): Promise<StepResult> => {
    await remember(tx, opp, stage, { action: input.action, ...details }, actor);
    if (followUpOn) await setFollowUp(tx, actor, opp, followUpOn);
    await recordAudit(tx, {
      tenantId: opp.tenantId, actorUserId: actor.userId, action: `opportunity.${audit}`,
      entityType: "opportunity", entityId: opp.id, after: { stage, ...details, followUpOn: followUpOn ?? null },
    } as any);
    return { ok: true, stage, moved: false, skipped: [] };
  };

  switch (input.action) {
    case "log_call": {
      if (input.outcome === "no_answer") {
        if (!input.followUpOn) return fail("Pick when to try again.");
        return stay({ on, outcome: "no_answer" }, "call_no_answer");
      }
      if (stage === "discussion") return stay({ on, outcome: "spoke" }, "call_logged");
      return move(`Spoke to the client on the call, ${formatDate(on)}`, { outcome: "spoke" });
    }

    case "schedule_meeting":
    case "reschedule_meeting": {
      if (!input.meetingId) return fail("Schedule the meeting first.");
      const m = (await tx.execute(sql`
        SELECT id, meeting_date, investor_id FROM review_meetings
         WHERE id = ${input.meetingId}::uuid AND tenant_id = ${opp.tenantId}::uuid
      `)).rows[0] as { id: string; meeting_date: string | Date; investor_id: string | null } | undefined;
      if (!m || m.investor_id !== opp.investorId) return fail("That meeting is not with this client.", 404);
      const when = new Date(m.meeting_date);
      const day = new Date(when.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);
      await tx.update(clientOpportunities).set({ meetingId: m.id, updatedAt: new Date() } as any)
        .where(eq(clientOpportunities.id, opp.id));
      // The meeting day is the next follow-up unless one was picked.
      const followUpOn = input.followUpOn ?? (day >= istToday() ? day : null);
      const at = `${formatDate(when)} ${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(when)}`;
      if (stage === "identified") {
        return move(`Meeting scheduled for ${at}`, { meetingId: m.id, meetingAt: when.toISOString() }, followUpOn);
      }
      return stay({ meetingId: m.id, meetingAt: when.toISOString() },
        input.action === "schedule_meeting" ? "meeting_scheduled" : "meeting_rescheduled", followUpOn);
    }

    case "meeting_done": {
      if (opp.meetingId) {
        await tx.execute(sql`
          UPDATE review_meetings SET status = 'completed', updated_at = now()
           WHERE id = ${opp.meetingId}::uuid AND tenant_id = ${opp.tenantId}::uuid
             AND status IN ('scheduled', 'confirmed', 'in_progress', 'rescheduled')
        `);
      }
      return move(`Meeting held on ${formatDate(on)}`, { meetingId: opp.meetingId ?? null });
    }

    case "quote_shared":
      return move(`Quote shared with the client on ${formatDate(on)}, outside the CRM`);

    case "record_acceptance":
      return move(`Client accepted on ${formatDate(on)}`);

    case "assign_ops": {
      if (!input.assigneeId) return fail("Pick who does it.");
      if (!input.dueOn || !DAY.test(input.dueOn) || input.dueOn < istToday()) return fail("Pick a due date from today on.");
      const who = (await tx.execute(sql`
        SELECT name FROM users WHERE id = ${input.assigneeId}::uuid AND tenant_id = ${opp.tenantId}::uuid AND status = 'active'
      `)).rows[0] as { name: string } | undefined;
      if (!who) return fail("That person is not an active team member.");
      await tx.insert(tasks).values({
        tenantId: opp.tenantId, subjectType: "investor", subjectId: opp.investorId, relatedInvestorId: opp.investorId,
        type: "follow_up", title: `${OPS_STEPS[stage]} — ${client} (${product})`,
        priority: "high", status: "open", assigneeId: input.assigneeId, department: "operations",
        dueAt: new Date(`${input.dueOn}T18:00:00+05:30`), createdById: actor.userId,
        meta: { opportunityStepOf: opp.id, opportunityStep: stage },
      } as any);
      return stay({ assigneeId: input.assigneeId, assigneeName: who.name, dueOn: input.dueOn }, "step_assigned");
    }

    case "order_placed": {
      if (!(input.amount != null && input.amount > 0)) return fail("Enter the amount.");
      const no = (input.orderNo ?? "").trim();
      return move(`Order placed on ${formatDate(on)}: ${formatMoney(input.amount)}${no ? `, order no. ${no}` : ""}`,
        { amount: input.amount, orderNo: no || null });
    }

    case "form_submitted": {
      const no = (input.formNo ?? "").trim();
      return move(`Proposal form submitted on ${formatDate(on)}${no ? `, no. ${no}` : ""}`, { formNo: no || null });
    }

    case "underwriting_cleared":
      return move(`Underwriting cleared on ${formatDate(on)}`);

    case "policy_issued": {
      const no = (input.policyNo ?? "").trim();
      if (!no) return fail("Enter the policy number.");
      return move(`Policy ${no} issued on ${formatDate(on)}`, { policyNo: no });
    }

    case "executed":
      return move(`Executed on ${formatDate(on)}`);

    case "move":
      return move(`Done on ${formatDate(on)}`);
  }
}

/**
 * The Meetings module marked a meeting completed: an open opportunity whose
 * meeting it is, still at "Discussion / meeting", moves on — the same as its
 * "Meeting done" button. A no-op for any other meeting.
 */
export async function onOpportunityMeetingCompleted(tx: Tx, actor: Actor, meetingId: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT id FROM client_opportunities
     WHERE tenant_id = ${actor.tenantId}::uuid AND meeting_id = ${meetingId}::uuid AND status = 'open'
  `)).rows as Array<{ id: string }>;
  for (const r of rows) {
    const inst = await ensureInstanceFor(tx, actor.tenantId, "opportunity", r.id);
    if (inst.currentStageKey !== "discussion") continue;
    await advanceOpportunity(tx, actor, r.id, { remarks: `Meeting completed in Meetings, ${formatDate(istToday())}` });
  }
}
