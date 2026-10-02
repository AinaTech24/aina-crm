/**
 * Mapping a client to a family completes the onboarding journey's
 * "Map Family" step (Transaction Successful → Family Mapping).
 *
 * The step's button used to send the user to "New family" and nothing moved
 * the journey afterwards, so the client stayed on Transaction Successful
 * however the family was mapped. Every route that puts a client in a family
 * calls this — a new family with the client as head (POST /api/families) and
 * adding the client to an existing one (POST /api/families/[id]/members) —
 * so the step completes whichever way it was done.
 *
 * Only a journey waiting at the Map Family step moves; a client mapped earlier
 * or later in the journey is never jumped forward or pulled back. Best-effort
 * inside a SAVEPOINT, like lib/blueprints/auto-advance: a blueprint hiccup
 * never fails the family write.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { transitionTo } from "@/lib/blueprints/engine";
import { resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";

const MAP_FAMILY_STEP = "transaction_successful";
const FAMILY_MAPPED = "family_mapping";

export async function onClientFamilyMapped(tx: Tx, tenantId: string, investorId: string): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const t = sp as unknown as Tx;
      const leadId = await resolveLeadIdForInvestor(t, investorId);
      if (!leadId) return;
      const r = await t.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances
         WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid
         LIMIT 1
      `);
      if ((r.rows[0] as { current_stage_key?: string } | undefined)?.current_stage_key !== MAP_FAMILY_STEP) return;
      await transitionTo(t, tenantId, leadId, FAMILY_MAPPED, {
        systemBypass: true,
        remarks: "Auto: client mapped to a family.",
      });
    });
  } catch (err) {
    console.warn(`[families] journey advance after family mapping failed for ${investorId}:`, (err as Error)?.message);
  }
}
