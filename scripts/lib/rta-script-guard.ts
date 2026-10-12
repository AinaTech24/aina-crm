/**
 * Operator scripts that rewrite RTA-derived records (Phase 3H). A script holds
 * DB credentials, so it bypasses every route-level check; this applies the
 * same rule as lib/rta/write-guard.ts before a script WRITES:
 *
 *   refuseIfRtaWritesStopped(tenantId)  one firm: exits 1 when an emergency,
 *                                       a firm halt or a pause is on, or the
 *                                       firm is validate-first (its records
 *                                       change only through the pipeline,
 *                                       the reviewed resolution, or reversal).
 *   rtaGovernedTenants()                for all-firm scripts: the firms to
 *                                       skip (any activation history or a firm
 *                                       halt), and whether an emergency is on.
 *
 * Dry runs are never refused — they read only.
 */
import { sql } from "drizzle-orm";

export async function refuseIfRtaWritesStopped(tenantId: string, script: string): Promise<void> {
  const { withTenant } = await import("../../src/db/client");
  const { rtaWriteDenial } = await import("../../src/lib/rta/write-guard");
  const d = await withTenant(tenantId, (tx) => rtaWriteDenial(tx, tenantId, "bypass"));
  if (d) {
    console.error(`[${script}] refused for firm ${tenantId}: ${d.reason}`);
    process.exit(1);
  }
}

export async function rtaGovernedTenants(): Promise<{ emergency: string | null; skip: Set<string> }> {
  process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";
  const { withSystem } = await import("../../src/db/client");
  return withSystem(async (tx) => {
    const e = (await tx.execute(sql`SELECT reason FROM rta_posting_controls WHERE scope = 'emergency' AND posting_halted`)).rows[0] as { reason: string } | undefined;
    const rows = (await tx.execute(sql`
      SELECT DISTINCT tenant_id::text AS t FROM rta_pipeline_activations
      UNION SELECT scope FROM rta_posting_controls WHERE posting_halted AND scope NOT IN ('global', 'emergency')`)).rows as Array<{ t: string }>;
    return { emergency: e?.reason ?? null, skip: new Set(rows.map((r) => r.t)) };
  });
}
