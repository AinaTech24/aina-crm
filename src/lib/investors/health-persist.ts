/**
 * Persist-side glue for the client-health scorecard. SERVER-ONLY — imports the
 * DB. The pure scoring logic lives in ./health (safe for client components);
 * this module reads/writes the persisted health_score/health_band columns.
 *
 *   recomputeInvestorHealth(tx, id)   — re-read one investor + persist its health
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
import { clientHealth, type InvestorForHealth } from "./health";

/**
 * Re-score a single investor by id within the given transaction and persist.
 * Returns the new score/band, or null if not found (RLS-scoped or deleted).
 */
export async function recomputeInvestorHealth(
  tx: Tx,
  investorId: string,
  now: Date = new Date()
): Promise<{ healthScore: number; healthBand: string } | null> {
  const row = (await tx.select().from(investors).where(eq(investors.id, investorId)).limit(1))[0];
  if (!row) return null;

  const { score, band } = clientHealth(row as InvestorForHealth, now);
  await tx
    .update(investors)
    .set({ healthScore: score, healthBand: band, healthScoredAt: now } as any)
    .where(eq(investors.id, investorId));

  return { healthScore: score, healthBand: band };
}

/**
 * Re-score EVERY investor visible in the current tenant context (RLS scopes
 * the read + writes). Pages through in batches so a 10K-client book stays
 * within a sane memory/round-trip budget. Returns counts by band.
 *
 * Used by the backfill script and the nightly daily-ops scanner.
 */
export async function recomputeAllHealth(
  tx: Tx,
  now: Date = new Date(),
  batchSize = 500
): Promise<{ scored: number; green: number; amber: number; red: number }> {
  let offset = 0;
  const tally = { scored: 0, green: 0, amber: 0, red: 0 };

  for (;;) {
    const page = await tx
      .select()
      .from(investors)
      .orderBy(investors.id)
      .limit(batchSize)
      .offset(offset);
    if (page.length === 0) break;

    // Build one CASE-based UPDATE per batch (a few hundred rows) rather than a
    // round-trip per investor.
    for (const row of page) {
      const { score, band } = clientHealth(row as InvestorForHealth, now);
      tally.scored++;
      (tally as any)[band]++;
      await tx
        .update(investors)
        .set({ healthScore: score, healthBand: band, healthScoredAt: now } as any)
        .where(eq(investors.id, row.id));
    }

    offset += batchSize;
  }

  return tally;
}
