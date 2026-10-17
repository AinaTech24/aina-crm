/**
 * Client health — ONE score, the same in the Clients list, the preview drawer,
 * the client page and every dashboard.
 *
 * The scoring rules live in lib/investors/health.ts (`clientHealth`, pure).
 * This module is the only place that feeds them: the investor row PLUS
 * whether the client has a service request past its SLA. The stored columns
 * (`health_score`, `health_band`) are a cache of exactly that result.
 *
 * Why the list said 100 while the page said 57: the page scored live (with the
 * SR factor), while the stored score — which the list reads — was written
 * without the SR factor, only on some edits, and otherwise by a nightly job.
 * A client nobody had edited kept the column default of 100 forever.
 *
 * Now:
 *   - getClientHealth scores live AND writes the cache when it differs — the
 *     client page and the preview drawer both call it, so viewing a client
 *     fixes its row;
 *   - refreshClientHealth re-scores in bulk with the same inputs (nightly,
 *     and `staleOnly` on first use each day, because days-since-contact and
 *     review-overdue move with the calendar, not with edits);
 *   - logging a contact updates `last_contact_at` and re-scores that client.
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { investors } from "@/db/schema";
import { clientHealth, type HealthBreakdown, type InvestorForHealth } from "@/lib/investors/health";
import { withOwnRiskForMinor, withOwnRiskForMinors } from "@/lib/risk-profile/own-assessment";

/** The client has a service request past its resolution SLA (the SR page's `breached`). */
export function srBreachExistsSql(investorId: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM service_requests sr
    WHERE sr.investor_id = ${investorId} AND sr.status NOT IN ('resolved', 'closed')
      AND sr.sla_resolution_at < now())`;
}

async function breachedAmong(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = (await tx.execute(sql`
    SELECT DISTINCT sr.investor_id FROM service_requests sr
     WHERE sr.investor_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       AND sr.status NOT IN ('resolved', 'closed') AND sr.sla_resolution_at < now()
  `)).rows as Array<{ investor_id: string }>;
  return new Set(rows.map((r) => r.investor_id));
}

/** Score one client live and keep the stored score equal to it. Null when not found. */
export async function getClientHealth(
  tx: Tx, tenantId: string, clientId: string, now: Date = new Date(),
): Promise<HealthBreakdown | null> {
  const [found] = await tx.select().from(investors)
    .where(and(eq(investors.id, clientId), eq(investors.tenantId, tenantId))).limit(1);
  if (!found) return null;
  // A minor's risk is their own assessment, never the guardian's copy (G-1).
  const row = await withOwnRiskForMinor(tx, tenantId, found);
  const breach = await breachedAmong(tx, [clientId]);
  const health = clientHealth({ ...(row as InvestorForHealth), hasOpenSrBreach: breach.has(clientId) }, now);
  if ((row as { healthScore?: number | null }).healthScore !== health.score
    || (row as { healthBand?: string | null }).healthBand !== health.band) {
    await tx.update(investors)
      .set({ healthScore: health.score, healthBand: health.band, healthScoredAt: now } as never)
      .where(eq(investors.id, clientId));
  }
  return health;
}

export type HealthTally = { scored: number; green: number; amber: number; red: number };

/**
 * Re-score clients in bulk with exactly getClientHealth's inputs.
 *   tenantId      one firm (omit in system context to do every firm)
 *   investorIds   just these clients
 *   staleOnly     only rows not scored since the start of today (India)
 */
export async function refreshClientHealth(
  tx: Tx,
  opts: { tenantId?: string; investorIds?: string[]; staleOnly?: boolean; now?: Date; batchSize?: number } = {},
): Promise<HealthTally> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? 500;
  const tally: HealthTally = { scored: 0, green: 0, amber: 0, red: 0 };
  if (opts.investorIds && opts.investorIds.length === 0) return tally;
  let cursor: string | null = null;
  for (;;) {
    const conds: SQL[] = [];
    if (opts.tenantId) conds.push(sql`${investors.tenantId} = ${opts.tenantId}::uuid`);
    if (opts.investorIds?.length) conds.push(inArray(investors.id, opts.investorIds) as SQL);
    if (opts.staleOnly) {
      conds.push(sql`(${investors.healthScoredAt} IS NULL
        OR ${investors.healthScoredAt} < date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`);
    }
    if (cursor) conds.push(sql`${investors.id} > ${cursor}::uuid`);
    const raw = await tx.select().from(investors)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(investors.id).limit(batchSize);
    if (raw.length === 0) break;
    // A minor's risk is their own assessment, never the guardian's copy (G-1)
    // — per firm, since a system-context refresh spans firms.
    const page = (await Promise.all([...new Set(raw.map((r) => r.tenantId))].map((tn) =>
      withOwnRiskForMinors(tx, tn, raw.filter((r) => r.tenantId === tn))))).flat()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const breach = await breachedAmong(tx, page.map((r) => r.id));
    const rows: SQL[] = [];
    for (const row of page) {
      const { score, band } = clientHealth({ ...(row as InvestorForHealth), hasOpenSrBreach: breach.has(row.id) }, now);
      tally.scored++;
      tally[band]++;
      // staleOnly must also stamp unchanged rows, or they stay "stale" all day.
      if (opts.staleOnly || (row as { healthScore?: number | null }).healthScore !== score
        || (row as { healthBand?: string | null }).healthBand !== band) {
        rows.push(sql`(${row.id}::uuid, ${score}::int, ${band}::text)`);
      }
    }
    if (rows.length) {
      await tx.execute(sql`
        UPDATE investors i SET health_score = v.score, health_band = v.band, health_scored_at = ${now}
          FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, score, band)
         WHERE i.id = v.id
      `);
    }
    cursor = page[page.length - 1].id;
    if (page.length < batchSize) break;
  }
  return tally;
}

/** Re-score a firm's clients not yet scored today. Cheap after the first call of the day. */
export function ensureHealthFresh(tx: Tx, tenantId: string): Promise<HealthTally> {
  return refreshClientHealth(tx, { tenantId, staleOnly: true });
}

/** The health band of the stored score, in SQL — for counts that must match the list. */
export function healthBandSql(alias = "i"): SQL {
  const a = sql.raw(alias.replace(/[^a-zA-Z0-9_]/g, ""));
  return sql`CASE WHEN COALESCE(${a}.health_score, 100) >= 80 THEN 'green'
    WHEN COALESCE(${a}.health_score, 100) >= 60 THEN 'amber' ELSE 'red' END`;
}
