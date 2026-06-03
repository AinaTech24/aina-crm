/**
 * LTCG tax-harvesting planner for equity mutual funds.
 *
 * India taxes long-term capital gains (units held > 12 months) on equity MFs at
 * 12.5%, but the FIRST ₹1,25,000 of LTCG each financial year is EXEMPT
 * (Budget 2024, FY 2024-25 onward — raised from ₹1,00,000). "Harvesting" =
 * deliberately redeeming long-term units to realise gains up to that exemption
 * (tax-free) and rebuying, which books tax-free profit and steps up the cost
 * basis — shrinking the taxable gain on the eventual real redemption. Done every
 * year it saves up to ₹15,625 of tax per client per year.
 *
 * This planner estimates, per client, the unrealised LONG-TERM gain on their
 * equity holdings and how much can be harvested within this year's exemption.
 *
 * It is an ESTIMATE for planning, not a tax filing: cost basis uses net invested
 * (a close proxy for the remaining lots' cost) rather than strict FIFO lot
 * tracking, and "long-term" is judged from the first purchase date of each
 * holding. The MFD confirms exact figures from the CAS before acting.
 *
 * Pure aggregation over a single SQL sweep — pass the tx from withTenant.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** This year's LTCG exemption on equity (₹). */
export const LTCG_EXEMPTION = 125_000;
/** LTCG rate above the exemption (12.5%). */
export const LTCG_RATE = 0.125;

/** Equity-taxed if the category/name looks like equity / ELSS / aggressive hybrid. */
function isEquityTaxed(category?: string | null, name?: string | null): boolean {
  const s = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  if (/debt|liquid|overnight|money.?market|gilt|bond|ultra.?short|low.?duration|banking.?psu|corporate.?bond/.test(s)) {
    return false;
  }
  return /equity|elss|tax.?saver|flexi.?cap|large.?cap|mid.?cap|small.?cap|multi.?cap|focused|value|contra|index|nifty|sensex|aggressive|hybrid|balanced.?advantage/.test(s);
}

export type HarvestHolding = {
  schemeName: string | null;
  longTermGain: number;
};

export type HarvestRow = {
  investorId: string;
  investorName: string;
  rmId: string | null;
  /** Total unrealised long-term equity gain (₹). */
  longTermGain: number;
  /** How much can be harvested tax-free this year (min of gain + remaining exemption). */
  harvestable: number;
  /** Tax saved by harvesting this year (harvestable × 12.5%). */
  taxSaved: number;
  holdings: HarvestHolding[];
};

export async function scanTaxHarvest(
  tx: Tx,
  opts: { limit?: number } = {}
): Promise<HarvestRow[]> {
  const res = await tx.execute(sql`
    SELECT
      t.investor_id, i.name AS investor_name, i.rm_id,
      t.scheme_code, t.scheme_name, t.scheme_category,
      SUM(CASE WHEN t.direction = 'inflow' THEN t.units::numeric ELSE -t.units::numeric END) AS net_units,
      SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END) AS net_invested,
      MIN(t.order_date) FILTER (WHERE t.direction = 'inflow') AS first_inflow,
      n.nav AS current_nav
    FROM transactions t
    JOIN investors i ON i.id = t.investor_id AND i.status = 'active'
    LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
    WHERE t.status IN ('processed', 'successful')
    GROUP BY t.investor_id, i.name, i.rm_id, t.scheme_code, t.scheme_name, t.scheme_category, n.nav
    HAVING SUM(CASE WHEN t.direction = 'inflow' THEN t.units::numeric ELSE -t.units::numeric END) > 0.0005
  `);

  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);

  // Aggregate the per-scheme long-term gains up to the investor level.
  const byInvestor = new Map<string, HarvestRow>();

  for (const r of res.rows as any[]) {
    const currentNav = r.current_nav != null ? Number(r.current_nav) : null;
    if (currentNav == null || !isFinite(currentNav)) continue; // unpriced — skip
    if (!isEquityTaxed(r.scheme_category, r.scheme_name)) continue; // only equity LTCG
    const firstInflow = r.first_inflow ? new Date(r.first_inflow) : null;
    if (!firstInflow || firstInflow > oneYearAgo) continue; // not long-term yet

    const netUnits = Number(r.net_units);
    const netInvested = Number(r.net_invested);
    const currentValue = netUnits * currentNav;
    const gain = currentValue - netInvested;
    if (gain <= 0) continue; // only positive gains are harvestable

    let row = byInvestor.get(r.investor_id);
    if (!row) {
      row = {
        investorId: r.investor_id,
        investorName: r.investor_name,
        rmId: r.rm_id,
        longTermGain: 0,
        harvestable: 0,
        taxSaved: 0,
        holdings: [],
      };
      byInvestor.set(r.investor_id, row);
    }
    row.longTermGain += gain;
    row.holdings.push({ schemeName: r.scheme_name, longTermGain: gain });
  }

  const rows = Array.from(byInvestor.values()).map((row) => {
    row.harvestable = Math.min(row.longTermGain, LTCG_EXEMPTION);
    row.taxSaved = row.harvestable * LTCG_RATE;
    row.holdings.sort((a, b) => b.longTermGain - a.longTermGain);
    return row;
  });

  rows.sort((a, b) => b.harvestable - a.harvestable);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}
