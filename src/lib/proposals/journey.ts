/**
 * What a proposal event does to the client journey — in one place.
 *
 * The design review (2026-10-01) set out the table this implements:
 *
 *   event              lead journey          also
 *   ─────────────────  ────────────────────  ──────────────────────────────
 *   draft saved        no move               —
 *   sent               → Proposal Sent       follow-up task (shared-task.ts)
 *   client opens link  stays                 Viewed; RM notified on first open
 *   accepted, all      → Won                 onboarding starts for a lead
 *   accepted, part     → Won                 only accepted lines go forward
 *   change requested   stays                 task for the RM with the note
 *   first transaction  (its own stage)       proposal Executed — execution.ts
 *
 * Every journey move here is FORWARD-ONLY. Proposals go to clients at every
 * point in the journey, including clients already mid-onboarding; a fresh
 * proposal must never pull them back. See lib/blueprints/auto-advance.ts.
 *
 * Existing clients' "another product" journey (lib/opportunities, built in
 * parallel) is moved by the same events through its own onProposalEvent.
 */

import { sql } from "drizzle-orm";
import { tasks } from "@/db/schema";
import type { Proposal } from "@/db/schema/proposals";
import { autoAdvance, resolveLeadIdForInvestor, type BlueprintEvent } from "@/lib/blueprints/auto-advance";
import { createNotification } from "@/lib/notifications/create";
import { proposalHref } from "./public-link";

type Tx = any;
type P = Pick<Proposal, "id" | "tenantId" | "leadId" | "investorId" | "proposalNumber" | "recipientName">;

/** The lead whose journey this proposal belongs to — direct, or the lead a
 *  client was converted from. Null for a client who never was a lead. */
export async function journeyLeadId(tx: Tx, p: P): Promise<string | null> {
  if (p.leadId) return p.leadId;
  if (p.investorId) return resolveLeadIdForInvestor(tx, p.investorId);
  return null;
}

/** Move the journey for a proposal event, forward only. Never throws. */
export async function advanceJourneyForProposal(
  tx: Tx,
  p: P,
  event: Extract<BlueprintEvent, "proposal.sent" | "proposal.accepted">,
  remarks: string
): Promise<string | null> {
  const leadId = await journeyLeadId(tx, p);
  if (!leadId) return null;
  await autoAdvance(tx, p.tenantId, leadId, event, { remarks, forwardOnly: true });
  return leadId;
}

/** The lead journey's current stage, after any move. */
export async function currentStage(tx: Tx, leadId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT current_stage_key FROM lead_blueprint_instances WHERE lead_id = ${leadId}::uuid LIMIT 1
  `);
  return ((r.rows[0] as any)?.current_stage_key as string | undefined) ?? null;
}

/**
 * A task for the RM about this proposal, attached to whoever it is about so it
 * appears on that client's or lead's page as well as in the RM's list.
 */
export async function createProposalTask(
  tx: Tx,
  p: P,
  t: {
    assigneeId: string | null;
    title: string;
    description?: string;
    priority?: "normal" | "high" | "urgent";
    dueInHours: number;
    kind: string;
  }
): Promise<void> {
  const aboutInvestor = !!p.investorId;
  await tx.insert(tasks).values({
    tenantId: p.tenantId,
    subjectType: aboutInvestor ? "investor" : "lead",
    subjectId: (aboutInvestor ? p.investorId : p.leadId) ?? null,
    relatedInvestorId: p.investorId ?? null,
    relatedLeadId: p.leadId ?? null,
    type: "follow_up",
    title: t.title,
    description: t.description ?? null,
    priority: t.priority ?? "normal",
    status: "open",
    assigneeId: t.assigneeId,
    dueAt: new Date(Date.now() + t.dueInHours * 3_600_000),
    meta: { proposalId: p.id, proposalEvent: t.kind },
  } as any);
}

/** In-app notification to the RM, linking to the proposal. */
export async function notifyProposalOwner(
  tx: Tx,
  p: P,
  ownerId: string | null,
  n: { kind: string; title: string; body?: string; severity?: "info" | "success" | "warning" }
): Promise<void> {
  if (!ownerId) return;
  await createNotification(tx, {
    tenantId: p.tenantId,
    userId: ownerId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    linkUrl: proposalHref(p),
    severity: n.severity ?? "info",
    meta: { proposalId: p.id },
  });
}

/**
 * Is the firm already running the "Proposal approved → request KYC documents"
 * workflow recipe? If so, that recipe sends the document link on acceptance
 * and the built-in send must stand aside, or the client gets two links.
 */
export async function firmRunsDocRecipe(tx: Tx, tenantId: string): Promise<boolean> {
  const r = await tx.execute(sql`
    SELECT 1
      FROM workflows w
      JOIN workflow_versions v ON v.id = w.current_version_id
     WHERE w.tenant_id = ${tenantId}::uuid
       AND w.recipe_key = 'proposal_approved_request_docs'
       AND w.enabled
       AND v.status = 'published'
     LIMIT 1
  `);
  return r.rows.length > 0;
}

/** First name, for messages to the RM ("Sunita opened your proposal"). */
export function firstName(full: string | null | undefined): string {
  return String(full ?? "").trim().split(/\s+/)[0] || "The client";
}
