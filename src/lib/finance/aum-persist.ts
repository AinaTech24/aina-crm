/** Persist the same folio-aware valuation used by the client profile and PDFs. */
import { sql } from "drizzle-orm";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";
import type { Tx } from "@/db/client";
import { folios } from "@/db/schema";
import { computeInvestorValuation, loadValuationRows, invalidateInvestorValuation } from "./valuation";
import { loadNavIndex, lookupNav } from "./scheme-match";

type BatchStats = { updated: number; skippedUnpriced: number; skippedNoHoldings: number };

async function persistBatch(tx: Tx, investorIds: string[]): Promise<BatchStats> {
  const { transactions, snapshots } = await loadValuationRows(tx, investorIds);
  const cachedRows = (await tx.execute(sql`
    SELECT id, COALESCE(aum, 0)::numeric AS aum FROM investors
     WHERE id IN (${sql.join(investorIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)).rows as Array<{ id: string; aum: string }>;
  const cached = new Map(cachedRows.map((r) => [String(r.id), Number(r.aum)]));
  const byInvestor = <T extends { investor_id?: string | null }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) { if (!row.investor_id) continue; const group = groups.get(row.investor_id) ?? []; group.push(row); groups.set(row.investor_id, group); }
    return groups;
  };
  const txns = byInvestor(transactions), folioRows = byInvestor(snapshots);
  const updates: ReturnType<typeof sql>[] = [];
  let skippedUnpriced = 0;
  let skippedNoHoldings = 0;
  for (const id of investorIds) {
    const value = computeInvestorValuation(txns.get(id) ?? [], folioRows.get(id) ?? []);
    // No basis, or an unpriced position: preserve the last cached total instead
    // of overwriting it with a deceptively complete zero/partial valuation.
    //
    // The skip is right, but it used to be SILENT, and a silent skip is how a
    // book goes stale without anyone noticing. Count both reasons so the caller
    // can report them.
    if (!value.holdings.length) { skippedNoHoldings++; continue; }
    // An unpriced holding makes the total a FLOOR, not wrong: everything else
    // is valued. Keeping the cache whenever one holding was unpriced froze the
    // client at whatever it last said — Rs 0 for the 2,075 Ahpal clients whose
    // folios came back on 8 Oct 2026, so Rs 161 Cr of folios counted nowhere.
    // Write the floor when it is above the cache; never lower a figure on it.
    if (value.unpricedSchemes > 0) {
      skippedUnpriced++;
      if (!(value.currentValue > (cached.get(id) ?? 0) + 0.5)) continue;
    }
    updates.push(sql`(${id}::uuid, ${value.currentValue}::numeric)`);
    invalidateInvestorValuation(id);
  }
  if (!updates.length) return { updated: 0, skippedUnpriced, skippedNoHoldings };
  const result = await tx.execute(sql`
    UPDATE investors i SET aum = round(v.aum, 2), updated_at = now()
    FROM (VALUES ${sql.join(updates, sql`, `)}) AS v(id, aum)
    WHERE i.id = v.id AND i.aum IS DISTINCT FROM round(v.aum, 2) RETURNING i.id
  `);
  return { updated: result.rows.length, skippedUnpriced, skippedNoHoldings };
}

export async function recomputeCombinedAum(
  tx: Tx
): Promise<{ updated: number; totalAum: number; skippedUnpriced: number; skippedNoHoldings: number }> {
  let cursor: string | null = null, updated = 0, skippedUnpriced = 0, skippedNoHoldings = 0;
  for (;;) {
    const batch = (await tx.execute(sql`
      SELECT id FROM investors WHERE deleted_at IS NULL AND merged_into_id IS NULL
      ${cursor ? sql`AND id > ${cursor}::uuid` : sql``} ORDER BY id LIMIT 250
    `)).rows as Array<{ id: string }>;
    if (!batch.length) break;
    const stats = await persistBatch(tx, batch.map((row) => row.id));
    updated += stats.updated;
    skippedUnpriced += stats.skippedUnpriced;
    skippedNoHoldings += stats.skippedNoHoldings;
    cursor = batch[batch.length - 1].id;
  }
  const totals = (await tx.execute(sql`SELECT COALESCE(SUM(aum), 0)::numeric AS total FROM investors WHERE deleted_at IS NULL AND merged_into_id IS NULL`)).rows as Array<{ total: string }>;
  return { updated, totalAum: Number(totals[0]?.total ?? 0), skippedUnpriced, skippedNoHoldings };
}
export const recomputeAllAum = recomputeCombinedAum;

export async function recomputeInvestorAum(tx: Tx, investorId: string): Promise<void> {
  await persistBatch(tx, [investorId]);
  await refreshActiveSipAmount(tx, { investorIds: [investorId] });
}

/** {@link recomputeInvestorAum} for many clients, 250 at a time. */
export async function recomputeInvestorsAum(tx: Tx, investorIds: string[]): Promise<void> {
  const unique = [...new Set(investorIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 250) {
    const part = unique.slice(i, i + 250);
    await persistBatch(tx, part);
    await refreshActiveSipAmount(tx, { investorIds: part });
  }
}
type FolioScheme = {
  schemeCode: string;
  schemeName: string;
  category?: string;
  units?: number;
  nav?: number;
  value?: number;
};

export type RevalueStats = {
  folios: number;
  /** Legs seen, and how each was priced — the numbers that make a code
   *  mismatch visible instead of silent. */
  legs: number;
  pricedByCode: number;
  pricedByName: number;
  unpriced: number;
  /** Rupee value sitting in legs that could not be priced by either key. */
  unpricedValue: number;
};

/**
 * Reprice CAS-sourced folio holdings at live NAV. Units come from the feed and
 * are left as-is; only nav + value are refreshed and the folio aum re-summed. A
 * holding whose scheme has no live NAV keeps its prior value in the rollup (so
 * an un-priceable scheme never silently zeroes a folio).
 *
 * Matching is by AMFI scheme code, then by canonical scheme NAME. The name pass
 * is not a nicety: the holdings importer stores the REGISTRAR's product code
 * (`Y1035`, `FTI047`), which is not AMFI's, so a code-only lookup missed 87% of
 * one firm's book by value and left it frozen at its last imported price. See
 * `./scheme-match.ts` for the measurement.
 *
 * The returned counts exist so that failure can never be silent again: a run
 * that prices nothing by code and everything by name still looks "fine" from
 * the folio count alone.
 */
export async function revalueAllFolios(
  tx: Tx,
  batchSize = 500
): Promise<RevalueStats> {
  const navIndex = await loadNavIndex(tx);
  const stats: RevalueStats = {
    folios: 0, legs: 0, pricedByCode: 0, pricedByName: 0, unpriced: 0, unpricedValue: 0,
  };
  if (navIndex.size === 0) return stats;

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
        stats.legs++;
        const hit = lookupNav(navIndex, s.schemeCode, s.schemeName);
        if (hit && isFinite(units) && units > 0) {
          if (hit.via === "code") stats.pricedByCode++;
          else stats.pricedByName++;
          const value = Math.round(units * hit.nav * 100) / 100;
          if (s.nav !== hit.nav || s.value !== value) changed = true;
          folioAum += value;
          return { ...s, nav: hit.nav, value };
        }
        // Un-priceable scheme — keep whatever value was there, and account for
        // it, because this is exactly the case that hid a stale book.
        stats.unpriced++;
        stats.unpricedValue += Number(s.value ?? 0);
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

  stats.folios = changedFolios;
  return stats;
}

