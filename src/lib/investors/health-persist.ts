/**
 * Persist-side glue for the client-health scorecard. SERVER-ONLY — imports the
 * DB. The pure scoring logic lives in ./health (safe for client components);
 * the ONE place that feeds it — the investor row plus the open-SR-breach flag —
 * is lib/metrics/health.ts. These two names are kept for existing callers.
 *
 *   recomputeInvestorHealth(tx, id)   — re-score one investor + persist
 *   recomputeAllHealth(tx)            — re-score every investor in the current
 *                                       tenant context (backfill + nightly)
 *
 * Health has time-based factors (days-since-contact, review overdue), so it
 * goes stale even when the row doesn't change — that's why a nightly
 * recompute-all exists in addition to write-time recompute.
 */

import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { investors } from "@/db/schema";
import { getClientHealth, refreshClientHealth } from "@/lib/metrics/health";

/**
 * Re-score a single investor by id within the given transaction and persist.
 * Returns the new score/band, or null if not found (RLS-scoped or deleted).
 */
export async function recomputeInvestorHealth(
  tx: Tx,
  investorId: string,
  now: Date = new Date()
): Promise<{ healthScore: number; healthBand: string } | null> {
  const [row] = await tx.select({ tenantId: investors.tenantId }).from(investors)
    .where(eq(investors.id, investorId)).limit(1);
  if (!row) return null;
  const h = await getClientHealth(tx, row.tenantId, investorId, now);
  return h ? { healthScore: h.score, healthBand: h.band } : null;
}

/**
 * Re-score EVERY investor visible in the current context — pass `tenantId`
 * to scope it explicitly (the nightly scanner does). Returns counts by band.
 */
export async function recomputeAllHealth(
  tx: Tx,
  now: Date = new Date(),
  batchSize = 500,
  tenantId?: string
): Promise<{ scored: number; green: number; amber: number; red: number }> {
  return refreshClientHealth(tx, { tenantId, now, batchSize });
}
