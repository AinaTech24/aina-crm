/**
 * AUM refresh — reprice every firm's folios at the latest NAV and save each
 * client's AUM.
 *
 * This used to be one step in the middle of the daily-ops scan, inside the same
 * per-firm transaction as ~40 unrelated sections (birthdays, expiries, goals,
 * proposals …). A single error anywhere in that transaction — before OR after
 * the AUM step — rolled the whole firm back, AUM included, and the nightly job
 * still looked like it had run. It also ran on its own clock, so after a worker
 * restart the scan could catch up before the NAV download and save yesterday's
 * prices.
 *
 * Now it is its own job, chained straight after the NAV download (index.ts), and
 * each firm's folios and clients commit in their own transactions: one firm
 * failing leaves the others saved, and a failed folio reprice still lets the
 * clients be saved.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant, type Tx } from "@/db/client";
import { recomputeCombinedAum, revalueAllFolios, type RevalueStats } from "@/lib/finance/aum-persist";

export type AumRefreshTotals = {
  foliosRevalued: number;
  legsUnpriced: number;
  legsUnpricedValue: number;
  aumRevalued: number;
  aumSkippedUnpriced: number;
};

export type AumRefreshResult = {
  tenants: number;
  totals: AumRefreshTotals;
  failedTenants: string[];
  durationMs: number;
};

/** The pieces a run needs, so the orchestration can be tested without a database. */
export type AumRefreshDeps = {
  listTenants: () => Promise<string[]>;
  revalueFolios: (tenantId: string) => Promise<RevalueStats>;
  recomputeAum: (tenantId: string) => Promise<{ updated: number; skippedUnpriced: number }>;
  concurrency?: number;
};

async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx: Tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

const defaultDeps: AumRefreshDeps = {
  listTenants: listActiveTenants,
  revalueFolios: (tenantId) => withTenant(tenantId, (tx) => revalueAllFolios(tx), { roles: ["system"] }),
  recomputeAum: (tenantId) => withTenant(tenantId, (tx) => recomputeCombinedAum(tx), { roles: ["system"] }),
};

let inFlight: Promise<AumRefreshResult> | null = null;

/** Resolves when a refresh that is running in this process has finished (at once if none is). */
export async function waitForAumRefresh(): Promise<void> {
  if (inFlight) await inFlight.catch(() => undefined);
}

/**
 * Refresh every active firm. Never throws for one firm's failure — those are
 * returned in `failedTenants`, which `describeRun` records as a `partial` run.
 */
export function runAumRefresh(deps: AumRefreshDeps = defaultDeps): Promise<AumRefreshResult> {
  if (deps === defaultDeps) {
    // One at a time: a second caller shares the run already in progress.
    if (inFlight) return inFlight;
    const p = refreshAll(deps).finally(() => {
      if (inFlight === p) inFlight = null;
    });
    inFlight = p;
    return p;
  }
  return refreshAll(deps);
}

async function refreshAll(deps: AumRefreshDeps): Promise<AumRefreshResult> {
  const startedAt = Date.now();
  const tenants = await deps.listTenants();
  const totals: AumRefreshTotals = {
    foliosRevalued: 0,
    legsUnpriced: 0,
    legsUnpricedValue: 0,
    aumRevalued: 0,
    aumSkippedUnpriced: 0,
  };
  const failed: string[] = [];
  const queue = [...tenants];
  // Batches inside a firm already hold a connection for minutes (Ahpal: ~74k
  // transactions); two firms at a time keeps the pool free for the web app.
  const concurrency = Math.max(1, deps.concurrency ?? (Number(process.env.AUM_REFRESH_CONCURRENCY ?? 2) || 2));

  const worker = async () => {
    for (;;) {
      const tenantId = queue.shift();
      if (!tenantId) return;
      let ok = true;

      // Folios first, so their repriced legs are there for the client totals —
      // but a failure here must not stop the clients being saved.
      try {
        const v = await deps.revalueFolios(tenantId);
        totals.foliosRevalued += v.folios;
        totals.legsUnpriced += v.unpriced;
        totals.legsUnpricedValue += v.unpricedValue;
        if (v.unpriced > 0) {
          console.warn(
            `[aum-refresh] tenant ${tenantId}: ${v.unpriced} holding(s) could not be priced ` +
              `(Rs ${Math.round(v.unpricedValue / 100000)} lakh); priced ${v.pricedByCode} by code, ${v.pricedByName} by name`
          );
        }
      } catch (err) {
        ok = false;
        console.error(`[aum-refresh] tenant ${tenantId}: folio reprice failed:`, (err as Error)?.message);
      }

      try {
        const a = await deps.recomputeAum(tenantId);
        totals.aumRevalued += a.updated;
        totals.aumSkippedUnpriced += a.skippedUnpriced;
      } catch (err) {
        ok = false;
        console.error(`[aum-refresh] tenant ${tenantId}: client AUM failed:`, (err as Error)?.message);
      }

      if (!ok) failed.push(tenantId);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  const durationMs = Date.now() - startedAt;
  console.log(`[aum-refresh] ${tenants.length} firm(s) in ${durationMs}ms, ${failed.length} failed`, totals);
  return { tenants: tenants.length, totals, failedTenants: failed, durationMs };
}
