/**
 * Persist live AUM. SERVER-ONLY (imports the DB).
 *
 * The headline finding of the platform audit: `investors.aum` (and the
 * `folios` rollup) were stored numbers populated at import and never
 * recomputed against live NAV — so firm AUM, RM scorecards, service-tiering,
 * the Excel export, the client review report and the commission "expected"
 * calc all drifted the moment NAV moved. These helpers close that gap by
 * revaluing against the live AMFI NAV feed (`scheme_nav`).
 *
 *   recomputeAllAum(tx)      — investors.aum = net units × latest NAV, set-based,
 *                              for every investor in the current tenant context
 *                              that has a transaction basis. Investors with NO
 *                              completed transactions are left untouched (we have
 *                              nothing better than their imported figure — never
 *                              zero a book we can't value).
 *   revalueAllFolios(tx)     — refresh folios.aum + each folios.schemes[].nav/value
 *                              by repricing the CAS-sourced units at live NAV
 *                              (units are authoritative from the feed; only NAV ×
 *                              value are refreshed). Powers the review report and
 *                              the commission reconciler's expected-AUM.
 *
 * Both run inside a withTenant() tx (RLS scopes the rows). They mirror the
 * exact valuation logic in src/lib/finance/valuation.ts (priced holdings only,
 * dust units treated as fully redeemed).
 */

import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { folios } from "@/db/schema";

/**
 * Recompute investors.aum from live valuation (Σ net units × latest NAV over
 * priced holdings), set-based. Only investors with a completed-transaction
 * basis are updated; returns how many rows actually changed plus the new firm
 * AUM total for metrics.
 */
export async function recomputeAllAum(
  tx: Tx
): Promise<{ updated: number; totalAum: number }> {
  const res = await tx.execute(sql`
    WITH holding AS (
      SELECT t.investor_id,
             COALESCE(t.scheme_code, t.scheme_name, 'unknown') AS skey,
             SUM(CASE WHEN t.direction = 'inflow' THEN t.units ELSE -t.units END) AS net_units,
             MAX(n.nav) AS nav
      FROM transactions t
      LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
      WHERE t.status IN ('processed', 'successful')
        AND t.order_date IS NOT NULL
      GROUP BY t.investor_id, COALESCE(t.scheme_code, t.scheme_name, 'unknown')
    ),
    val AS (
      SELECT investor_id,
             COALESCE(
               SUM(net_units * nav) FILTER (WHERE nav IS NOT NULL AND net_units > 0.0005),
               0
             ) AS current_value
      FROM holding
      GROUP BY investor_id
    )
    UPDATE investors i
       SET aum = ROUND(val.current_value::numeric, 2),
           updated_at = now()
      FROM val
     WHERE val.investor_id = i.id
       AND i.aum IS DISTINCT FROM ROUND(val.current_value::numeric, 2)
    RETURNING i.id
  `);
  const updated = (res.rows as any[]).length;

  const totalRes = await tx.execute(
    sql`SELECT COALESCE(SUM(aum), 0)::numeric AS total FROM investors`
  );
  const totalAum = Number((totalRes.rows[0] as any)?.total ?? 0);
  return { updated, totalAum };
}

type FolioScheme = {
  schemeCode: string;
  schemeName: string;
  category?: string;
  units?: number;
  nav?: number;
  value?: number;
};

/**
 * Reprice CAS-sourced folio holdings at live NAV. Units come from the feed and
 * are left as-is; only nav + value are refreshed and the folio aum re-summed. A
 * holding whose scheme has no live NAV keeps its prior value in the rollup (so
 * an un-priceable scheme never silently zeroes a folio).
 */
export async function revalueAllFolios(
  tx: Tx,
  batchSize = 500
): Promise<{ folios: number }> {
  // One pull of the (platform-shared) NAV master, indexed by scheme code.
  const navRes = await tx.execute(
    sql`SELECT scheme_code, nav FROM scheme_nav WHERE nav IS NOT NULL`
  );
  const navMap = new Map<string, number>();
  for (const r of navRes.rows as Array<{ scheme_code: string | null; nav: string | number }>) {
    if (r.scheme_code != null) {
      const nav = Number(r.nav);
      if (isFinite(nav) && nav > 0) navMap.set(String(r.scheme_code), nav);
    }
  }
  if (navMap.size === 0) return { folios: 0 };

  let offset = 0;
  let changedFolios = 0;

  for (;;) {
    const page = await tx
      .select()
      .from(folios)
      .orderBy(folios.id)
      .limit(batchSize)
      .offset(offset);
    if (page.length === 0) break;

    for (const f of page) {
      const schemes = (f.schemes ?? []) as FolioScheme[];
      if (!schemes.length) continue;

      let folioAum = 0;
      let changed = false;
      const next = schemes.map((s) => {
        const units = Number(s.units ?? 0);
        const liveNav = s.schemeCode ? navMap.get(String(s.schemeCode)) : undefined;
        if (liveNav != null && isFinite(units) && units > 0) {
          const value = Math.round(units * liveNav * 100) / 100;
          if (s.nav !== liveNav || s.value !== value) changed = true;
          folioAum += value;
          return { ...s, nav: liveNav, value };
        }
        // Un-priceable scheme — keep whatever value was there.
        folioAum += Number(s.value ?? 0);
        return s;
      });

      const roundedAum = Math.round(folioAum * 100) / 100;
      if (changed || Number(f.aum ?? 0) !== roundedAum) {
        await tx
          .update(folios)
          .set({ schemes: next as any, aum: String(roundedAum) } as any)
          .where(eq(folios.id, f.id));
        changedFolios++;
      }
    }

    offset += batchSize;
  }

  return { folios: changedFolios };
}
