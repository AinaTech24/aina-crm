/**
 * What reaching a journey step WRITES, in one place — so every way a person
 * moves a step (the guided button, a multi-step walk, a forced Kanban move, a
 * stage written from the lead form) does the same thing (audit L10 / C8).
 *
 *   KYC Validated      → the client's KYC status is verified (with evidence)
 *   UCC Activated      → the UCC is stored on the client
 *   Mandate Activated  → the mandate is stored on the client
 *   Mandate Rejected   → a "re-do the mandate" task
 *   a call-back loop   → a reminder task at the chosen time
 *
 * The subject is the lead (its converted client) or, for a journey whose
 * subject is a client directly, that client.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import { tasks } from "@/db/schema";

/** Stages whose transition schedules a next-touch reminder for the lead owner
 *  so parked leads never go silent. */
export const NEXT_TOUCH_STAGES = ["call_back_later", "call_not_connected", "contact_in_future"];

export interface StageSideEffectInput {
  callBackAt?: string;
  uccNumber?: string;
  mandate?: { bank?: string; ifsc?: string; masked?: string; amount?: number; ref?: string };
}

const clientOf = (tenantId: string, leadId: string) => sql`(
  id = (SELECT converted_investor_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid)
  OR id = ${leadId}::uuid)`;

export async function runStageSideEffects(
  tx: Tx,
  p: { tenantId: string; leadId: string; stageKey: string; actorUserId: string },
  input: StageSideEffectInput,
): Promise<void> {
  const { tenantId, leadId, stageKey, actorUserId } = p;
  if (NEXT_TOUCH_STAGES.includes(stageKey) && input.callBackAt) {
    await scheduleNextTouchReminder(tx, tenantId, leadId, actorUserId, input.callBackAt, stageKey);
  }
  if (stageKey === "ucc_activated" && input.uccNumber) {
    const v = input.uccNumber.trim();
    if (v) {
      await tx.execute(sql`
        UPDATE investors SET bse_ucc_code = ${v}, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND ${clientOf(tenantId, leadId)}
      `);
    }
  }
  if (stageKey === "kyc_validated") {
    // "KYC Validated" on the journey IS the KYC record: verified, stamped with
    // who and when. A client already verified keeps its original date. Never
    // over a KRA hold / rejection (kycValidationBlock refuses the move first).
    await tx.execute(sql`
      UPDATE investors SET
        kyc_status = 'verified',
        kyc_validated_at = COALESCE(kyc_validated_at, (now() AT TIME ZONE 'Asia/Kolkata')::date),
        kyc_last_updated_by = ${actorUserId}::uuid,
        updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
        AND kyc_status IS DISTINCT FROM 'verified'
        AND COALESCE(kyc_status, '') NOT IN ('hold', 'rejected')
        AND ${clientOf(tenantId, leadId)}
    `);
  }
  if (stageKey === "mandate_activated") {
    const m = input.mandate ?? {};
    await tx.execute(sql`
      UPDATE investors SET
        mandate_status = 'active',
        mandate_ref_no = COALESCE(${m.ref ?? null}, mandate_ref_no),
        mandate_amount = COALESCE(${m.amount ?? null}, mandate_amount),
        bank_name = COALESCE(${m.bank ?? null}, bank_name),
        bank_ifsc = COALESCE(${m.ifsc ?? null}, bank_ifsc),
        bank_account_masked = COALESCE(${m.masked ?? null}, bank_account_masked),
        updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND ${clientOf(tenantId, leadId)}
    `);
  }
  if (stageKey === "mandate_reject") {
    await createRedoMandateTask(tx, tenantId, leadId, actorUserId);
  }
}

/**
 * May the journey be marked "KYC Validated"? Needs evidence — the client's
 * KYC already verified, a KRA check that came back verified, or a KYC proof
 * (a document named / tagged KYC) on the client or the lead — and never over
 * a KRA hold or rejection. Returns the reason it may not, or null.
 */
export async function kycValidationBlock(tx: Tx, tenantId: string, leadId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    WITH c AS (
      SELECT id, kyc_status FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND ${clientOf(tenantId, leadId)}
       LIMIT 1
    )
    SELECT (SELECT kyc_status FROM c) AS kyc_status,
           EXISTS (SELECT 1 FROM kyc_checks k WHERE k.tenant_id = ${tenantId}::uuid
                     AND k.investor_id = (SELECT id FROM c) AND k.status_after = 'verified') AS kra_verified,
           EXISTS (SELECT 1 FROM compliance_documents d
                    WHERE d.tenant_id = ${tenantId}::uuid AND d.superseded_by_id IS NULL
                      AND (d.related_entity_id = ${leadId}::uuid OR d.related_entity_id = (SELECT id FROM c))
                      AND (d.name ILIKE '%kyc%' OR d.category = 'kyd' OR COALESCE(d.tags, '[]'::jsonb)::text ILIKE '%kyc%')) AS kyc_doc
  `);
  const row = r.rows[0] as { kyc_status: string | null; kra_verified: boolean; kyc_doc: boolean } | undefined;
  const status = row?.kyc_status ?? null;
  if (status === "hold" || status === "rejected") {
    return `The KRA has this client's KYC on ${status === "hold" ? "hold" : "rejected"}. Resolve it with the KRA (and re-run the KYC check) before marking KYC Validated.`;
  }
  if (status === "verified" || row?.kra_verified || row?.kyc_doc) return null;
  return "KYC Validated needs evidence: run the KYC check on the client (a verified KRA result), or upload the KYC proof to the client's documents.";
}

async function scheduleNextTouchReminder(
  tx: Tx, tenantId: string, leadId: string, fallbackAssigneeId: string, callBackAt: string, stageKey: string,
): Promise<void> {
  const due = new Date(callBackAt);
  if (isNaN(due.getTime())) return; // ignore an unparseable date rather than fail the move
  const lr = await tx.execute(
    sql`SELECT name, owner_id FROM leads WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
  );
  const lead = lr.rows[0] as { name?: string; owner_id?: string } | undefined;
  const title =
    stageKey === "contact_in_future" ? `Re-engage lead: ${lead?.name ?? "lead"}` : `Call back: ${lead?.name ?? "lead"}`;
  // One open reminder per lead: a loop re-entered moves the existing one
  // instead of adding another (audit L14).
  const moved = await tx.execute(sql`
    UPDATE tasks SET due_at = ${due.toISOString()}::timestamptz, title = ${title}, updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled')
       AND type = 'follow_up' AND related_lead_id = ${leadId}::uuid
       AND COALESCE(meta, '{}'::jsonb) ->> 'nextTouch' = 'true'
    RETURNING id
  `);
  if (!moved.rows.length) {
    await tx.insert(tasks).values({
      id: uuid(),
      tenantId,
      assigneeId: lead?.owner_id ?? fallbackAssigneeId,
      subjectType: "lead",
      subjectId: leadId,
      relatedLeadId: leadId,
      type: "follow_up",
      title,
      priority: "normal",
      status: "open",
      dueAt: due,
      meta: { nextTouch: true },
    } as any);
  }
  await tx.execute(sql`
    UPDATE leads SET next_follow_up_at = ${due.toISOString()}::timestamptz, updated_at = now()
     WHERE id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
  `);
}

async function createRedoMandateTask(tx: Tx, tenantId: string, leadId: string, fallbackAssigneeId: string): Promise<void> {
  const lr = await tx.execute(sql`
    SELECT l.name, COALESCE(i.rm_id, l.owner_id) AS assignee, l.converted_investor_id
      FROM leads l LEFT JOIN investors i ON i.id = l.converted_investor_id
     WHERE l.id = ${leadId}::uuid AND l.tenant_id = ${tenantId}::uuid LIMIT 1
  `);
  const lead = lr.rows[0] as { name?: string; assignee?: string; converted_investor_id?: string | null } | undefined;
  await tx.insert(tasks).values({
    id: uuid(),
    tenantId,
    assigneeId: lead?.assignee ?? fallbackAssigneeId,
    subjectType: lead?.converted_investor_id ? "investor" : "lead",
    subjectId: lead?.converted_investor_id ?? leadId,
    relatedLeadId: lead ? leadId : null,
    relatedInvestorId: lead?.converted_investor_id ?? null,
    type: "follow_up",
    title: `Re-do SIP mandate — bank rejected: ${lead?.name ?? "client"}`,
    description: "The bank rejected the mandate. Resolve the issue and re-register the NACH / e-mandate.",
    priority: "high",
    status: "open",
  } as any);
}
