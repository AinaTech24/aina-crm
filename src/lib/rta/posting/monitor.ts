/**
 * Nightly reconciliation of the posting ledger for every firm that has posted
 * validate-first (Phase 3H). Each count must be zero (reconcilePosting); a
 * non-zero count is an ALERT:
 *   - a persisted ops alert (lib/ops/alerts.ts, migration 0244) that is
 *     retried until delivered and escalated until an operator acknowledges it,
 *   - the error monitor (captureError), and
 *   - the firm's audit log (rta.posting.reconcile_alert), its own history.
 * Read-only otherwise — it never repairs anything.
 *
 * When and how often it runs, and the record of every run, is
 * recon-schedule.ts (06:30 Asia/Kolkata, monitored).
 */
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { captureError } from "@/lib/observability/capture";
import { maskSensitive, raiseOpsAlert } from "@/lib/ops/alerts";
import { reconcilePosting } from "./reversal";

export type FirmReconciliation = { tenantId: string; ok: boolean; counts: Record<string, number>; error?: string };

export const listPostingFirms = () =>
  withSystem(async (tx) => ((await tx.execute(sql`SELECT DISTINCT tenant_id::text AS t FROM rta_posted_transactions ORDER BY 1`)).rows as Array<{ t: string }>).map((r) => r.t));

/** Reconcile one firm and raise its alerts. Never throws: a failure is a result (ok false, error). */
export async function reconcileFirm(tenantId: string, ctx: { runId?: string | null; check?: (tenantId: string) => Promise<Record<string, number>> } = {}): Promise<FirmReconciliation> {
  try {
    const counts = await (ctx.check ?? reconcilePosting)(tenantId);
    const ok = Object.values(counts).every((n) => n === 0);
    if (!ok) {
      captureError("[rta-posting] reconciliation alert", new Error("posting ledger, CRM and staging disagree"), { tenantId, counts });
      await withTenant(tenantId, (tx) => tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_type, action, entity_type, after, reason)
        VALUES (${tenantId}::uuid, 'system', 'rta.posting.reconcile_alert', 'rta_posting', ${JSON.stringify(counts)}::jsonb,
                'nightly reconciliation: every count must be 0 — halt the firm and investigate before the next import')`));
      await withSystem((tx) => raiseOpsAlert(tx, {
        kind: "rta.reconciliation.discrepancy", severity: "critical", dedupKey: `recon:discrepancy:${tenantId}`, firmId: tenantId,
        summary: "RTA posting reconciliation found a discrepancy: the posting ledger, the CRM and staging disagree. Halt the firm's posting and investigate before its next import.",
        details: { counts: nonZero(counts), runId: ctx.runId ?? null },
      }));
    }
    return { tenantId, ok, counts };
  } catch (e) {
    const error = maskSensitive(String((e as Error)?.message ?? e)).slice(0, 300);
    captureError("[rta-posting] reconciliation failed", e, { tenantId });
    await withSystem((tx) => raiseOpsAlert(tx, {
      kind: "rta.reconciliation.firm_failed", severity: "critical", dedupKey: `recon:firm_failed:${tenantId}`, firmId: tenantId,
      summary: "RTA posting reconciliation could not check a firm. Its ledger is unverified until a run completes.",
      details: { runId: ctx.runId ?? null, error },
    })).catch(() => {});
    return { tenantId, ok: false, counts: { error: 1 }, error };
  }
}

const nonZero = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([, n]) => n !== 0));

export async function reconcilePostingFirms(): Promise<FirmReconciliation[]> {
  const out: FirmReconciliation[] = [];
  for (const tenantId of await listPostingFirms()) out.push(await reconcileFirm(tenantId));
  return out;
}
