/**
 * Nightly reconciliation of the posting ledger for every firm that has posted
 * validate-first (Phase 3H). Each count must be zero (reconcilePosting); a
 * non-zero count is an ALERT: captured to the error monitor and written to the
 * firm's audit log as rta.posting.reconcile_alert, so it reaches both the
 * on-call channel and the firm's history. Read-only otherwise — it never
 * repairs anything.
 */
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { captureError } from "@/lib/observability/capture";
import { reconcilePosting } from "./reversal";

export type FirmReconciliation = { tenantId: string; ok: boolean; counts: Record<string, number> };

export async function reconcilePostingFirms(): Promise<FirmReconciliation[]> {
  const firms = await withSystem(async (tx) => ((await tx.execute(sql`SELECT DISTINCT tenant_id::text AS t FROM rta_posted_transactions`)).rows as Array<{ t: string }>).map((r) => r.t));
  const out: FirmReconciliation[] = [];
  for (const tenantId of firms) {
    try {
      const counts = await reconcilePosting(tenantId);
      const ok = Object.values(counts).every((n) => n === 0);
      out.push({ tenantId, ok, counts });
      if (!ok) {
        captureError("[rta-posting] reconciliation alert", new Error("posting ledger, CRM and staging disagree"), { tenantId, counts });
        await withTenant(tenantId, (tx) => tx.execute(sql`
          INSERT INTO audit_log (tenant_id, actor_type, action, entity_type, after, reason)
          VALUES (${tenantId}::uuid, 'system', 'rta.posting.reconcile_alert', 'rta_posting', ${JSON.stringify(counts)}::jsonb,
                  'nightly reconciliation: every count must be 0 — halt the firm and investigate before the next import')`));
      }
    } catch (e) {
      captureError("[rta-posting] reconciliation failed", e, { tenantId });
      out.push({ tenantId, ok: false, counts: { error: 1 } });
    }
  }
  return out;
}
