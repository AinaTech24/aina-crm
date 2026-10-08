/**
 * A Business entry moves the client's onboarding journey.
 *
 * "Make First Investment" sends the RM to book a Business entry, so booking one
 * is what places the first order: a mutual-fund entry for a client whose
 * journey is ready to transact (UCC active onwards) moves it to Make
 * Transaction, and the entry being confirmed (by Operations, or by completing
 * the task that booked it) moves it to Transaction Successful.
 *
 * Forward only, and only from the transaction steps: an entry booked for a
 * client still mid-KYC never skips their KYC, UCC or mandate, and a client
 * already past the first investment is never pulled back. Best-effort, like
 * every auto-advance — it never fails the save. SERVER-ONLY.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";

/** The steps from which booking business means "the first order is placed". */
const READY_TO_TRANSACT = new Set([
  "ucc_activated", "mandate_create", "mandate_activated", "mandate_reject",
  "make_transaction", "transaction_failed",
]);

export async function syncJourneyWithEntry(
  tx: Tx,
  tenantId: string,
  entry: { investorId: string | null | undefined; productType: string | null | undefined; status: string | null | undefined },
): Promise<void> {
  if (!entry.investorId || entry.productType !== "mutual_fund" || !entry.status || entry.status === "cancelled") return;
  const investorId = entry.investorId;
  const status = entry.status;
  try {
    // A savepoint: a database error here rolls back only this, never the entry.
    await tx.transaction(async (sp) => advance(sp as unknown as Tx, tenantId, investorId, status));
  } catch (err) {
    console.warn(`[business-journey] could not advance the journey for client ${investorId}:`, (err as Error)?.message);
  }
}

async function advance(tx: Tx, tenantId: string, investorId: string, status: string): Promise<void> {
  const leadId = await resolveLeadIdForInvestor(tx, investorId);
  if (!leadId) return;
  const r = await tx.execute(sql`
    SELECT current_stage_key FROM lead_blueprint_instances
     WHERE lead_id = ${leadId}::uuid AND tenant_id = ${tenantId}::uuid
     LIMIT 1
  `);
  const stage = (r.rows[0] as { current_stage_key?: string } | undefined)?.current_stage_key;
  if (!stage || !READY_TO_TRANSACT.has(stage)) return;

  const counted = status === "confirmed" || status === "emailed";
  if (counted) {
    await autoAdvance(tx, tenantId, leadId, "transaction.successful", {
      forwardOnly: true,
      remarks: "Auto: first investment confirmed in Business entries.",
    });
  } else if (stage !== "make_transaction") {
    await autoAdvance(tx, tenantId, leadId, "transaction.placed", {
      // A failed order re-booked goes back to Make Transaction (a retry), so
      // only that step may move "backwards".
      forwardOnly: stage !== "transaction_failed",
      remarks: "Auto: first investment booked in Business entries.",
    });
  }
}
