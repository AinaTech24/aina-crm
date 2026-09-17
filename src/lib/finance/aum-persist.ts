/** Persist the same folio-aware valuation used by the client profile and PDFs. */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { folios } from "@/db/schema";
import { computeInvestorValuation, loadValuationRows, invalidateInvestorValuation } from "./valuation";

async function persistBatch(tx: Tx, investorIds: string[]): Promise<number> {
  const { transactions, snapshots } = await loadValuationRows(tx, investorIds);
  const byInvestor = <T extends { investor_id?: string | null }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) { if (!row.investor_id) continue; const group = groups.get(row.investor_id) ?? []; group.push(row); groups.set(row.investor_id, group); }
    return groups;
  };
  const txns = byInvestor(transactions), folioRows = byInvestor(snapshots);
  const updates: ReturnType<typeof sql>[] = [];
  for (const id of investorIds) {
    const value = computeInvestorValuation(txns.get(id) ?? [], folioRows.get(id) ?? []);
    // No basis, or an unpriced position: preserve the last cached total instead
    // of overwriting it with a deceptively complete zero/partial valuation.
    if (!value.holdings.length || value.unpricedSchemes > 0) continue;
    updates.push(sql`(${id}::uuid, ${value.currentValue}::numeric)`);
    invalidateInvestorValuation(id);
  }
  if (!updates.length) return 0;
  const result = await tx.execute(sql`
    UPDATE investors i SET aum = round(v.aum, 2), updated_at = now()
    FROM (VALUES ${sql.join(updates, sql`, `)}) AS v(id, aum)
    WHERE i.id = v.id AND i.aum IS DISTINCT FROM round(v.aum, 2) RETURNING i.id
  `);
  return result.rows.length;
}

export async function recomputeCombinedAum(tx: Tx): Promise<{ updated: number; totalAum: number }> {
  let cursor: string | null = null, updated = 0;
  for (;;) {
    const batch = (await tx.execute(sql`
      SELECT id FROM investors WHERE deleted_at IS NULL AND merged_into_id IS NULL
      ${cursor ? sql`AND id > ${cursor}::uuid` : sql``} ORDER BY id LIMIT 250
    `)).rows as Array<{ id: string }>;
    if (!batch.length) break;
    updated += await persistBatch(tx, batch.map((row) => row.id));
    cursor = batch[batch.length - 1].id;
  }
  const totals = (await tx.execute(sql`SELECT COALESCE(SUM(aum), 0)::numeric AS total FROM investors WHERE deleted_at IS NULL AND merged_into_id IS NULL`)).rows as Array<{ total: string }>;
  return { updated, totalAum: Number(totals[0]?.total ?? 0) };
}
export const recomputeAllAum = recomputeCombinedAum;

export async function recomputeInvestorAum(tx: Tx, investorId: string): Promise<void> {
  await persistBatch(tx, [investorId]);
  await tx.execute(sql`
    UPDATE investors i SET active_sip_amount = COALESCE((
      SELECT SUM(s.amount::numeric) FROM sips s WHERE s.investor_id = i.id AND s.status = 'active'
    ), 0), updated_at = now() WHERE i.id = ${investorId}::uuid
  `);
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

    // Reprice every folio in the page in memory, then flush all the changed
    // rows in ONE set-based UPDATE ... FROM (VALUES ...) per page. The earlier
    // implementation issued one UPDATE round-trip per folio (10k folios ≈ 10k
    // round-trips ≈ 7s/tenant); batching collapses that to ~batchSize/page
    // statements and brings a 10k-folio tenant well under a second.
    const updates: Array<ReturnType<typeof sql>> = [];
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
        updates.push(
          sql`(${f.id}::uuid, ${JSON.stringify(next)}::jsonb, ${roundedAum}::numeric)`
        );
        changedFolios++;
      }
    }

    if (updates.length > 0) {
      await tx.execute(sql`
        UPDATE folios f
           SET schemes = v.schemes,
               aum = v.aum,
               updated_at = now()
          FROM (VALUES ${sql.join(updates, sql`, `)}) AS v(id, schemes, aum)
         WHERE f.id = v.id
      `);
    }

    offset += batchSize;
  }

  return { folios: changedFolios };
}

