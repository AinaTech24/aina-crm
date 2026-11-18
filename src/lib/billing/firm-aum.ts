/**
 * The firm's AUM for pricing a renewal (owner's rule B, 2026-11-18): the same
 * firm-wide AUM the Owner Dashboard shows.
 *
 *  1. the latest nightly firm snapshot (firm_snapshots, the recorded balance),
 *     when it is recent (within 10 days) and above zero;
 *  2. else the live figure from lib/metrics (getAUM — Σ investors.aum of live
 *     clients), when above zero;
 *  3. else NO DATA — the declared AUM is kept and the caller says so. A firm
 *     whose CRM shows ₹0 has not imported its book; that is never priced as a
 *     ₹0-AUM firm.
 * Run inside withTenant(tenantId) (or withSystem).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { getAUM } from "@/lib/metrics/clients";

export type FirmAum = {
  aumCrore: number;
  source: "crm_snapshot" | "crm_live" | "declared";
  /** India date the figure is from; null for a declared figure. */
  asOf: string | null;
};

const CRORE = 10_000_000;
const SNAPSHOT_MAX_AGE_DAYS = 10;

export async function firmAumForPricing(tx: Tx, tenantId: string, declaredCrore: number): Promise<FirmAum> {
  const snap = (await tx.execute(sql`
    SELECT snapshot_date::text AS d, total_aum
      FROM firm_snapshots
     WHERE tenant_id = ${tenantId}::uuid
       AND snapshot_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - ${SNAPSHOT_MAX_AGE_DAYS}::int
     ORDER BY snapshot_date DESC
     LIMIT 1
  `)).rows[0] as { d: string; total_aum: string } | undefined;
  if (snap && Number(snap.total_aum) > 0) {
    return { aumCrore: Math.round((Number(snap.total_aum) / CRORE) * 100) / 100, source: "crm_snapshot", asOf: snap.d };
  }
  try {
    const live = await tx.transaction(async (sp) => getAUM(sp, { tenantId }));
    if (live.aum > 0) {
      const today = (await tx.execute(sql`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0] as { d: string };
      return { aumCrore: Math.round((live.aum / CRORE) * 100) / 100, source: "crm_live", asOf: today.d };
    }
  } catch (err) {
    console.error("[firm-aum] live AUM read failed:", (err as Error)?.message);
  }
  return { aumCrore: declaredCrore, source: "declared", asOf: null };
}
