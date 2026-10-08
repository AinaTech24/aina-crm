/**
 * The physical route's RTA step settles itself from the registrar's feed.
 *
 * A client at "Submitted to RTA" (forms with CAMS / KFintech / the AMC) moves
 * to "Processed by RTA" once the imported transaction ledger shows a processed
 * purchase / lumpsum / SIP for them dated on or after the submission (less a
 * few days: a cheque deposited before the forms reached the RTA still counts),
 * and to "Rejected by RTA" when the only such rows are rejected — with the
 * RTA's reason in the journey's history. Ops can still mark either by hand.
 *
 * Runs after every RTA import (rta-import-worker) and nightly
 * (daily-ops-scanner). Best effort: a failure never fails the import.
 */

import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { transitionTo } from "./engine";

const GRACE_DAYS = 3;

export async function syncRtaJourneys(tx: Tx, tenantId: string): Promise<{ processed: number; rejected: number }> {
  const waiting = (await tx.execute(sql`
    SELECT l.id AS lead_id, l.converted_investor_id AS investor_id,
           COALESCE(NULLIF(l.rta_submission->>'submittedOn', ''), to_char(i.stage_entered_at, 'YYYY-MM-DD')) AS submitted_on
      FROM leads l
      JOIN lead_blueprint_instances i ON i.lead_id = l.id AND i.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId}::uuid
       AND i.current_stage_key = 'rta_submitted'
       AND l.converted_investor_id IS NOT NULL
  `)).rows as Array<{ lead_id: string; investor_id: string; submitted_on: string }>;

  let processed = 0;
  let rejected = 0;
  for (const w of waiting) {
    const rows = (await tx.execute(sql`
      SELECT status, folio_number, scheme_name, reason_description
        FROM transactions
       WHERE tenant_id = ${tenantId}::uuid
         AND investor_id = ${w.investor_id}::uuid
         AND direction = 'inflow'
         AND type IN ('purchase', 'lumpsum', 'sip')
         AND order_date >= ${w.submitted_on}::date - ${GRACE_DAYS}::int
       ORDER BY order_date, created_at
    `)).rows as Array<{ status: string; folio_number: string | null; scheme_name: string | null; reason_description: string | null }>;

    const ok = rows.find((r) => r.status === "processed" || r.status === "successful");
    const bad = rows.find((r) => r.status === "rejected" || r.status === "failed");
    if (ok) {
      const r = await transitionTo(tx, tenantId, w.lead_id, "rta_processed", {
        systemBypass: true,
        remarks: `Auto: the RTA feed shows it processed${ok.scheme_name ? ` — ${ok.scheme_name}` : ""}${ok.folio_number ? `, folio ${ok.folio_number}` : ""}.`,
      });
      if (r.ok) processed++;
    } else if (bad) {
      const r = await transitionTo(tx, tenantId, w.lead_id, "rta_rejected", {
        systemBypass: true,
        remarks: `Auto: the RTA feed shows it rejected${bad.reason_description ? ` — ${bad.reason_description}` : ""}.`,
      });
      if (r.ok) rejected++;
    }
  }
  return { processed, rejected };
}

/** After an RTA import: settle this firm's waiting submissions. Never throws. */
export async function syncRtaJourneysAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    await withTenant(tenantId, (tx) => syncRtaJourneys(tx, tenantId), { roles: ["system"] });
  } catch (err) {
    console.warn(`[rta-route] settling physical submissions failed for ${tenantId}:`, (err as Error)?.message);
  }
}
