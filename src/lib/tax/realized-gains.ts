/**
 * Realized capital-gains statement — FIFO lot accounting.
 *
 * The platform previously had only an UNREALISED LTCG harvesting estimate. This
 * computes REALISED short/long-term gains per redemption for a financial year
 * using First-In-First-Out lot matching against the transaction ledger — the
 * statement clients beg their MFD for at ITR time.
 *
 * Method (equity-MF rules, the common case for a distributor book):
 *   • Buys build FIFO lots {date, units, costPerUnit}.
 *   • Sells (redemption / switch-out / SWP) consume oldest lots first.
 *   • Gain = (sell NAV − buy NAV) × units. Holding > 12 months ⇒ LTCG, else STCG.
 *   • LTCG taxable = max(0, total LTCG − ₹1,25,000 exemption) (FY24-25 regime).
 *
 * Honest limits (shown as a disclaimer): grandfathering (NAV-as-on-31-Jan-2018)
 * and the equity-vs-debt distinction need data the CRM doesn't reliably hold, so
 * this is an indicative working — confirm against the AMC/RTA statement for ITR.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type RealizedRow = {
  schemeName: string | null;
  schemeCode: string | null;
  buyDate: string;
  sellDate: string;
  units: number;
  buyNav: number;
  sellNav: number;
  gain: number;
  term: "stcg" | "ltcg";
};

export type RealizedGains = {
  fyLabel: string;
  fyStart: string;
  fyEnd: string;
  stcg: number;
  ltcg: number;
  ltcgExemption: number;
  ltcgTaxable: number;
  totalProceeds: number;
  totalCost: number;
  rows: RealizedRow[];
};

const SELL_TYPES = new Set(["redemption", "switch", "swp", "stp", "redemption_payout"]);
const LTCG_EXEMPTION = 125000;

export type TxRow = {
  scheme_code: string | null;
  scheme_name: string | null;
  type: string | null;
  direction: string | null;
  units: string | null;
  nav: string | null;
  amount: string | null;
  order_date: string | null;
};

/** Current India FY start year (Apr–Mar). e.g. on 2026-06-03 → 2026. */
export function currentFyStartYear(now = new Date()): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function computeRealizedGains(
  tx: Tx,
  investorId: string,
  fyStartYear: number
): Promise<RealizedGains> {
  const res = await tx.execute(sql`
    SELECT scheme_code, scheme_name, type, direction, units, nav, amount, order_date
    FROM transactions
    WHERE investor_id = ${investorId}
      AND status IN ('processed','successful')
      AND order_date IS NOT NULL
    ORDER BY order_date ASC, id ASC
  `);
  return fifoRealizedGains(res.rows as unknown as TxRow[], fyStartYear);
}

/**
 * Pure FIFO realized-gains computation — separated from the DB query so it can
 * be unit-tested with synthetic transaction rows. Rows must be ordered by date.
 */
export function fifoRealizedGains(rows: TxRow[], fyStartYear: number): RealizedGains {
  const fyStart = `${fyStartYear}-04-01`;
  const fyEnd = `${fyStartYear + 1}-03-31`;
  const fyLabel = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;

  // Per-scheme FIFO lot queues.
  const lots = new Map<string, Array<{ date: string; units: number; nav: number }>>();
  const realized: RealizedRow[] = [];

  for (const r of rows) {
    const key = r.scheme_code ?? r.scheme_name ?? "unknown";
    const units = num(r.units);
    if (units <= 0) continue;
    const nav = navOf(r);
    const isSell = r.direction === "outflow" || SELL_TYPES.has(r.type ?? "");
    const isBuy = r.direction === "inflow" && !SELL_TYPES.has(r.type ?? "");

    if (isBuy) {
      const q = lots.get(key) ?? [];
      q.push({ date: r.order_date!, units, nav });
      lots.set(key, q);
    } else if (isSell) {
      const q = lots.get(key) ?? [];
      let toSell = units;
      while (toSell > 0.0005 && q.length > 0) {
        const lot = q[0];
        const matched = Math.min(lot.units, toSell);
        const gain = (nav - lot.nav) * matched;
        const term: "stcg" | "ltcg" = holdingDays(lot.date, r.order_date!) > 365 ? "ltcg" : "stcg";
        realized.push({
          schemeName: r.scheme_name,
          schemeCode: r.scheme_code,
          buyDate: lot.date,
          sellDate: r.order_date!,
          units: round4(matched),
          buyNav: round2(lot.nav),
          sellNav: round2(nav),
          gain: round2(gain),
          term,
        });
        lot.units -= matched;
        toSell -= matched;
        if (lot.units <= 0.0005) q.shift();
      }
      lots.set(key, q);
    }
  }

  // Keep only sells settled within the requested FY.
  const inFy = realized.filter((x) => x.sellDate >= fyStart && x.sellDate <= fyEnd);
  let stcg = 0;
  let ltcg = 0;
  let proceeds = 0;
  let cost = 0;
  for (const x of inFy) {
    if (x.term === "ltcg") ltcg += x.gain;
    else stcg += x.gain;
    proceeds += x.sellNav * x.units;
    cost += x.buyNav * x.units;
  }
  const ltcgTaxable = Math.max(0, ltcg - LTCG_EXEMPTION);

  return {
    fyLabel,
    fyStart,
    fyEnd,
    stcg: round2(stcg),
    ltcg: round2(ltcg),
    ltcgExemption: LTCG_EXEMPTION,
    ltcgTaxable: round2(ltcgTaxable),
    totalProceeds: round2(proceeds),
    totalCost: round2(cost),
    rows: inFy.sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1)),
  };
}

function num(s: string | null): number {
  const n = s != null ? Number(s) : 0;
  return isFinite(n) ? n : 0;
}
function navOf(r: TxRow): number {
  const nav = num(r.nav);
  if (nav > 0) return nav;
  const amt = num(r.amount);
  const u = num(r.units);
  return u > 0 ? amt / u : 0;
}
function holdingDays(buy: string, sell: string): number {
  return Math.round((new Date(sell).getTime() - new Date(buy).getTime()) / 86400000);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
