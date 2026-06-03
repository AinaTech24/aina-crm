/**
 * Portfolio valuation — turns raw transactions + live NAV into the numbers an
 * MFD and their client actually care about: current market value, net invested,
 * absolute gain, and XIRR (money-weighted annualised return).
 *
 * How it works:
 *   1. Pull every COMPLETED transaction for the investor, left-joined to the
 *      latest NAV (scheme_nav, keyed by AMFI scheme code).
 *   2. Net units per scheme = inflow units − outflow units; current value =
 *      net units × latest NAV. Schemes with no NAV match are flagged
 *      `priced:false` and excluded from value/XIRR (so a missing code never
 *      silently understates returns — the UI shows the coverage gap instead).
 *   3. Cashflows for XIRR: each buy is money out (−amount), each redemption /
 *      dividend payout is money in (+amount); the current market value is a
 *      final inflow dated today.
 *
 * Tenant scoping is the caller's responsibility — pass the `tx` from inside a
 * withTenant() block so RLS already scopes rows to the tenant.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { xirr, absoluteReturn, type CashFlow } from "./xirr";

export type SchemeHolding = {
  schemeCode: string | null;
  schemeName: string | null;
  amcName: string | null;
  netUnits: number;
  investedNet: number;
  latestNav: number | null;
  navDate: string | null;
  currentValue: number | null;
  gain: number | null;
  /** true when a live NAV was found for this scheme. */
  priced: boolean;
};

export type InvestorValuation = {
  /** Market value of all PRICED holdings (units × latest NAV). */
  currentValue: number;
  /** Net invested across ALL holdings (priced + unpriced). */
  investedNet: number;
  /** Net invested in PRICED holdings only — the basis for gain/return so a
   *  scheme we couldn't price never distorts the percentage. */
  pricedInvested: number;
  /** Net invested in schemes we couldn't price (coverage gap, ₹). */
  unpricedInvested: number;
  /** currentValue − pricedInvested. */
  gain: number;
  /** decimal, e.g. 0.18 = +18% absolute (over priced holdings) */
  absoluteReturn: number | null;
  /** decimal, e.g. 0.142 = 14.2% p.a. (priced holdings only) */
  xirr: number | null;
  asOf: string | null; // latest NAV date seen across holdings
  holdings: SchemeHolding[];
  /** schemes (with units) that had NO live NAV — valuation coverage gap. */
  unpricedSchemes: number;
};

type TxRow = {
  scheme_code: string | null;
  scheme_name: string | null;
  amc_name: string | null;
  direction: string | null;
  type: string | null;
  amount: string | null;
  units: string | null;
  order_date: string | null;
  latest_nav: string | null;
  latest_nav_date: string | null;
};

const COMPLETED = ["processed", "successful"];

/**
 * Value one investor's whole book. Returns zeroed totals (not null) when the
 * investor has no completed transactions, so callers can render confidently.
 */
export async function valueInvestor(
  tx: Tx,
  investorId: string
): Promise<InvestorValuation> {
  const res = await tx.execute(sql`
    SELECT t.scheme_code, t.scheme_name, t.amc_name,
           t.direction, t.type, t.amount, t.units, t.order_date,
           n.nav AS latest_nav, n.nav_date AS latest_nav_date
    FROM transactions t
    LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
    WHERE t.investor_id = ${investorId}
      AND t.status IN ('processed', 'successful')
      AND t.order_date IS NOT NULL
    ORDER BY t.order_date ASC
  `);
  const rows = res.rows as unknown as TxRow[];

  // Pass 1 — aggregate per scheme, and stash each transaction's cashflow
  // candidate tagged with its scheme key (so XIRR can later include only the
  // cashflows of schemes we can actually price).
  const bySchemeKey = new Map<string, SchemeHolding>();
  const flowCandidates: Array<{ key: string; date: Date; amount: number }> = [];
  let latestNavDate: string | null = null;

  for (const r of rows) {
    const key = r.scheme_code ?? r.scheme_name ?? "unknown";
    const amount = r.amount != null ? Number(r.amount) : 0;
    const units = r.units != null ? Number(r.units) : 0;
    const isInflow = r.direction === "inflow"; // money/units INTO the holding (buy)

    if (r.order_date && isFinite(amount) && amount !== 0) {
      // buy = money out (−), sell/payout = money in (+).
      flowCandidates.push({ key, date: new Date(r.order_date), amount: isInflow ? -amount : amount });
    }

    let h = bySchemeKey.get(key);
    if (!h) {
      const latestNav = r.latest_nav != null ? Number(r.latest_nav) : null;
      h = {
        schemeCode: r.scheme_code,
        schemeName: r.scheme_name,
        amcName: r.amc_name,
        netUnits: 0,
        investedNet: 0,
        latestNav: latestNav != null && isFinite(latestNav) ? latestNav : null,
        navDate: r.latest_nav_date ?? null,
        currentValue: null,
        gain: null,
        priced: false,
      };
      bySchemeKey.set(key, h);
    }
    h.netUnits += isInflow ? units : -units;
    h.investedNet += isInflow ? amount : -amount;
    if (r.latest_nav_date && (!latestNavDate || r.latest_nav_date > latestNavDate)) {
      latestNavDate = r.latest_nav_date;
    }
  }

  // Pass 2 — finalise per-scheme value + split totals into priced vs unpriced.
  let currentValue = 0;
  let investedNet = 0;
  let pricedInvested = 0;
  let unpricedInvested = 0;
  let unpricedSchemes = 0;
  const pricedKeys = new Set<string>();
  const holdings: SchemeHolding[] = [];

  for (const [key, h] of bySchemeKey.entries()) {
    if (Math.abs(h.netUnits) < 0.0005) h.netUnits = 0; // dust → fully redeemed
    investedNet += h.investedNet;

    if (h.latestNav != null && h.netUnits > 0) {
      h.priced = true;
      h.currentValue = h.netUnits * h.latestNav;
      h.gain = h.currentValue - h.investedNet;
      currentValue += h.currentValue;
      pricedInvested += h.investedNet;
      pricedKeys.add(key);
    } else if (h.netUnits > 0) {
      unpricedSchemes++;
      unpricedInvested += h.investedNet;
    }
    holdings.push(h);
  }

  // XIRR over PRICED holdings only: their dated cashflows + today's market value.
  const cashflows: CashFlow[] = flowCandidates
    .filter((f) => pricedKeys.has(f.key))
    .map((f) => ({ date: f.date, amount: f.amount }));
  if (currentValue > 0) cashflows.push({ date: new Date(), amount: currentValue });

  const irr = xirr(cashflows);
  const abs = absoluteReturn(pricedInvested, currentValue);

  return {
    currentValue,
    investedNet,
    pricedInvested,
    unpricedInvested,
    gain: currentValue - pricedInvested,
    absoluteReturn: abs,
    xirr: irr,
    asOf: latestNavDate,
    holdings: holdings.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
    unpricedSchemes,
  };
}
