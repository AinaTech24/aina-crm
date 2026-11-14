/**
 * Smart blueprint auto-advance.
 *
 * Every action a user takes in the CRM has a logical "next stage" in the
 * lead-to-client journey. Rather than asking the user to manually click
 * "Advance" after each step, this module maps event → target stage and
 * fires the existing `transitionTo()` engine with `systemBypass: true` so
 * the user sees the lead/client progress in real-time without extra clicks.
 *
 * Wired into the *create* / *complete* / *send* endpoints across the app
 * (target stages are the 30-stage SOP keys in lead_to_client.ts):
 *   - POST /api/review-meetings (lead-side)            → meeting_scheduled
 *   - PATCH /api/review-meetings/[id] status=completed → meeting_done
 *   - POST /api/leads/[id]/call-outcome                → call_done
 *   - POST /api/leads/[id]/convert                     → request_documents (client phase)
 *   - POST /api/public/docs/submit                     → documents_received
 *   - POST /api/investors/[id]/kyc/verify (verified)   → kyc_validated
 *   - POST /api/proposals/[id]/send                    → proposal_sent
 *   - POST /api/public/proposals/accept                → won_lead
 *   - a mutual-fund Business entry booked / confirmed  → make_transaction /
 *     transaction_successful (lib/business/journey.ts)
 *
 * Direction: every move made here is AUTOMATIC (`transitionTo` with
 * `automatic: true`), so it is forward-only, never puts a converted lead / a
 * client-phase journey back into a lead stage (Lost included), never changes
 * onboarding branch or route, and never touches a deleted lead — the rules in
 * journey-rules.ts, enforced by the engine. A refused move is a silent no-op.
 * Failures are swallowed so a blueprint hiccup doesn't break the main flow
 * (proposal save, meeting schedule, etc.).
 */

import { sql } from "drizzle-orm";
import { transitionTo } from "@/lib/blueprints/engine";
import { INSURANCE_ENTRY_STAGE } from "@/lib/blueprints/lead_to_client";
import type { Tx } from "@/db/client";

export type BlueprintEvent =
  | "call.logged"
  | "call.completed"
  | "meeting.scheduled.lead"
  | "meeting.scheduled.client"
  | "meeting.completed"
  | "lead.won"
  | "lead.not_qualified"
  | "client.converted"
  | "docs.requested"
  | "docs.received"
  | "kyc.validated"
  | "ucc.activated"
  | "mandate.activated"
  | "mandate.rejected"
  | "transaction.placed"
  | "transaction.successful"
  | "transaction.failed"
  | "proposal.created"
  | "proposal.sent"
  | "proposal.accepted"
  // Legacy events from the previous 15-stage blueprint — kept for
  // back-compat but remapped to the closest new SOP stage.
  | "risk_profile.sent"
  | "risk_profile.submitted"
  | "call.completed.positive";

/** Mapping table — event → target stage key (new 30-stage SOP). */
const EVENT_TO_STAGE: Record<BlueprintEvent, string | null> = {
  // ── Lead phase ──
  "call.logged": "call_done",                  // a call activity was logged
  "call.completed": "call_done",
  "meeting.scheduled.lead": "meeting_scheduled",
  "meeting.scheduled.client": null,
  "meeting.completed": "meeting_done",
  "lead.won": "won_lead",
  "lead.not_qualified": "not_qualified",
  // ── Boundary ──
  "client.converted": "request_documents",
  // ── Client phase ──
  "docs.requested": "documents_pending",
  "docs.received": "documents_received",
  "kyc.validated": "kyc_validated",
  "ucc.activated": "ucc_activated",
  "mandate.activated": "mandate_activated",
  "mandate.rejected": "mandate_reject",
  "transaction.placed": "make_transaction",
  "transaction.successful": "transaction_successful",
  "transaction.failed": "transaction_failed",
  // ── Proposals ──
  // These all used to map to won_lead, so a lead was "won" the moment an RM
  // opened a blank draft — before the client had seen anything — and every
  // conversion rate counted drafts as wins. The Proposal Sent stage (migration
  // 0222) was never entered. A draft now moves nothing; sending reaches
  // Proposal Sent; only the CLIENT'S acceptance makes the lead Won.
  "proposal.created": null,
  "proposal.sent": "proposal_sent",
  "proposal.accepted": "won_lead",
  // ── Legacy back-compat ──
  // The SOP has no risk-profile stage, and sending or answering a risk
  // profile does not make a lead Won (only the client's acceptance does), so
  // these move nothing.
  "risk_profile.sent": null,
  "risk_profile.submitted": null,
  "call.completed.positive": "call_done",
};

/**
 * Best-effort blueprint advance for a lead. Never throws — if the transition
 * isn't defined or the lead has no blueprint, returns silently.
 *
 * Use the `remarks` field to leave a breadcrumb in `lead_stage_history`
 * (e.g. "Auto: meeting scheduled via Meetings module").
 */
export async function autoAdvance(
  tx: Tx,
  tenantId: string,
  leadId: string,
  event: BlueprintEvent,
  opts: {
    remarks?: string;
    /** @deprecated Every automatic move is forward-only now; kept so older
     *  callers compile. */
    forwardOnly?: boolean;
  } = {}
): Promise<{ moved: boolean; toStage: string | null; reason?: string }> {
  let targetStage = EVENT_TO_STAGE[event];
  if (!targetStage) return { moved: false, toStage: null };
  try {
    // A converted lead starts the onboarding of its product: insurance clients
    // the insurance branch, everyone else MF / general onboarding.
    if (event === "client.converted") targetStage = await conversionEntryStage(tx, tenantId, leadId);
    // Run inside a SAVEPOINT (Drizzle nested transaction) so a DB-level error
    // — deadlock, constraint, statement timeout — rolls back ONLY the blueprint
    // advance, not the parent transaction. Without this, a thrown SQL error
    // here aborts the whole Postgres tx; the catch below would swallow the JS
    // error but the parent's COMMIT would then fail and roll back EVERYTHING
    // (e.g. the entire lead → client conversion). The savepoint keeps the
    // "additive, never fails the parent" promise true even for DB errors.
    const res = await tx.transaction(async (sp) =>
      transitionTo(sp as unknown as Tx, tenantId, leadId, targetStage!, {
        systemBypass: true,
        automatic: true,
        remarks:
          opts.remarks ??
          `Auto-advanced by CRM after ${event.replace(/\./g, " ")} event.`,
      })
    );
    return { moved: !!res.ok && res.fromStage !== res.toStage, toStage: targetStage, reason: res.reason };
  } catch (err) {
    // Blueprint advance is *additive* — never fail the parent transaction
    // because the smart progression couldn't compute a path. The audit log
    // and the main side-effect (meeting created, proposal saved, etc.) are
    // far more important.
    console.warn(
      `[autoAdvance] failed to advance lead ${leadId} on ${event}:`,
      (err as Error)?.message
    );
    return { moved: false, toStage: targetStage, reason: (err as Error)?.message };
  }
}

/** First onboarding stage for a converted lead, by its product pipeline. */
export async function conversionEntryStage(tx: Tx, tenantId: string, leadId: string): Promise<string> {
  const r = await tx.execute(sql`
    SELECT pipeline FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `);
  const pipeline = (r.rows[0] as { pipeline?: string } | undefined)?.pipeline;
  return pipeline === "insurance" ? INSURANCE_ENTRY_STAGE : "request_documents";
}

/**
 * Resolve a lead's blueprint context starting from either a leadId or an
 * investorId (= the converted lead). Used by APIs that act on the
 * investor side (post-conversion meetings, fresh proposals against a
 * converted client) but want to keep advancing the same blueprint
 * instance.
 *
 * Returns the leadId of the source lead, or null if the investor wasn't
 * born from a converted lead.
 */
export async function resolveLeadIdForInvestor(
  tx: Tx,
  investorId: string
): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid
    ORDER BY converted_at DESC NULLS LAST LIMIT 1
  `);
  return ((r.rows[0] as any)?.id as string | undefined) ?? null;
}
