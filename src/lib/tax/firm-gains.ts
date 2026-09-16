/**
 * Firm-wide tax reporting over the FIFO engine. SERVER-ONLY.
 *
 * The per-client capital-gains statement (src/lib/tax/realized-gains.ts) is
 * the engine; this module runs it across the whole book so an MFD can answer
 * the tax-season questions at firm level:
 *
 *   realisedByClient    who booked STCG / LTCG this FY, and how much is taxable
 *   notionalByClient    who is sitting on unrealised gains at today's NAV
 *   loadDividendsBy…    who received IDCW (taxed as income at slab)
 *   fyWiseByClient      inflows / redemptions / gains per FY, per client
 *
 * One transaction sweep per report (ordered by investor, then date) so the
 * FIFO lots are rebuilt exactly as the per-client statement does — the firm
 * total is always the sum of the statements, never a different number.
 *
 * Indicative, not a filing: grandfathering (31-Jan-2018 NAV) and the exact
 * equity/debt classification need data the CRM doesn't reliably hold. Every
 * page says so.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { fifoRealizedGains, fifoOpenLots, currentFyStartYear, type TxRow, type RealizedGains } from "@/lib/tax/realized-gains";
import { isEquityTaxed, LTCG_EXEMPTION } from "@/lib/tax/harvesting";

export type ClientRef = { investorId: string; name: string; pan: string | null; rmId: string | null };
export type TxGroup = ClientRef & {
  rows: TxRow[];
  /** scheme key → category/name, for the equity-vs-debt heuristic. */
  cats: Map<string, { category: string | null; name: string | null }>;
};

export const fyLabel = (fy: number) => `FY ${fy}-${String(fy + 1).slice(-2)}`;
export const fyRange = (fy: number) => ({ start: `${fy}-04-01`, end: `${fy + 1}-03-31` });
export function fyChoices(cur = currentFyStartYear()): number[] {
  return [cur, cur - 1, cur - 2, cur - 3];
}
export function parseFy(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 2000 && n < 2100 ? n : currentFyStartYear();
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const holdingDays = (buy: string, sell: string) => Math.floor((Date.parse(sell) - Date.parse(buy)) / 86_400_000);

/**
 * Every settled transaction for the firm (or one RM's book / one client),
 * grouped per investor in FIFO order. Dormant and inactive clients are
 * INCLUDED — a client who redeemed everything last year still owes tax on it;
 * only deleted / merged-away records are excluded.
 */
export async function loadFirmTxGroups(
  tx: Tx,
  opts: { tenantId: string; rmId?: string; investorId?: string }
): Promise<Map<string, TxGroup>> {
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;
  const invScope = opts.investorId ? sql` AND i.id = ${opts.investorId}::uuid` : sql``;
  const res = await tx.execute(sql`
    SELECT t.investor_id, i.name AS investor_name, i.pan, i.rm_id,
           t.folio_id, t.folio_number, t.amc_code, t.amc_name, t.scheme_code, t.scheme_name, t.scheme_category, t.type, t.direction,
           t.units, t.nav, t.amount, t.order_date
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id
                      AND i.tenant_id = ${opts.tenantId}::uuid
                      AND i.deleted_at IS NULL AND i.merged_into_id IS NULL${rmScope}${invScope}
     WHERE t.tenant_id = ${opts.tenantId}::uuid
       AND t.status IN ('processed', 'successful') AND t.order_date IS NOT NULL
     ORDER BY t.investor_id, t.order_date ASC, t.id ASC
  `);
  const groups = new Map<string, TxGroup>();
  for (const r of res.rows as any[]) {
    const id = String(r.investor_id);
    let g = groups.get(id);
    if (!g) {
      g = { investorId: id, name: r.investor_name ?? "—", pan: r.pan ?? null, rmId: r.rm_id ? String(r.rm_id) : null, rows: [], cats: new Map() };
      groups.set(id, g);
    }
    g.rows.push({
      investor_id: id, folio_id: r.folio_id ?? null, folio_number: r.folio_number ?? null, amc_code: r.amc_code ?? null, amc_name: r.amc_name ?? null,
      scheme_code: r.scheme_code ?? null,
      scheme_name: r.scheme_name ?? null,
      type: r.type ?? null,
      direction: r.direction ?? null,
      units: r.units != null ? String(r.units) : null,
      nav: r.nav != null ? String(r.nav) : null,
      amount: r.amount != null ? String(r.amount) : null,
      order_date: r.order_date ? String(r.order_date).slice(0, 10) : null,
    });
    const sk = r.scheme_code ?? r.scheme_name ?? "unknown";
    if (!g.cats.has(sk)) g.cats.set(sk, { category: r.scheme_category ?? null, name: r.scheme_name ?? null });
  }
  return groups;
}

/** Latest NAV per scheme code from the AMFI feed table. */
export async function loadLatestNav(tx: Tx): Promise<Map<string, number>> {
  const res = await tx.execute(sql`SELECT scheme_code, nav FROM scheme_nav WHERE scheme_code IS NOT NULL AND nav IS NOT NULL`);
  const m = new Map<string, number>();
  for (const r of res.rows as any[]) m.set(String(r.scheme_code), num(r.nav));
  return m;
}

/* ───────────────────────── Realised ───────────────────────── */

export type RealisedClientRow = ClientRef & {
  sells: number;
  proceeds: number;
  cost: number;
  stcg: number;
  ltcg: number;
  ltcgTaxable: number;
  total: number;
};

export function realisedByClient(groups: Map<string, TxGroup>, fy: number): RealisedClientRow[] {
  const out: RealisedClientRow[] = [];
  for (const g of groups.values()) {
    const r: RealizedGains = fifoRealizedGains(g.rows, fy);
    if (r.rows.length === 0) continue;
    out.push({
      investorId: g.investorId, name: g.name, pan: g.pan, rmId: g.rmId,
      sells: r.rows.length,
      proceeds: r.totalProceeds,
      cost: r.totalCost,
      stcg: r.stcg,
      ltcg: r.ltcg,
      ltcgTaxable: r.ltcgTaxable,
      total: r2(r.stcg + r.ltcg),
    });
  }
  return out.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/* ───────────────────────── Notional ───────────────────────── */

export type NotionalLot = {
  scheme: string | null;
  schemeCode: string | null;
  date: string;
  units: number;
  costNav: number;
  nav: number | null;
  cost: number;
  value: number | null;
  gain: number | null;
  term: "lt" | "st";
  equity: boolean;
};

export type NotionalClientRow = ClientRef & {
  lots: number;
  unpriced: number;
  invested: number;
  current: number;
  unrealisedLt: number;
  unrealisedSt: number;
  unrealised: number;
  /** Long-term EQUITY gain still inside this year's exemption — the harvestable part. */
  ltcgHeadroom: number;
};

export function notionalLotsFor(g: TxGroup, nav: Map<string, number>, fy: number, today = new Date().toISOString().slice(0, 10)) {
  const { open, realizedLtcgThisFy } = fifoOpenLots(g.rows, fy);
  const lots: NotionalLot[] = open.map((lot) => {
    const sk = lot.schemeCode ?? lot.schemeName ?? "unknown";
    const meta = g.cats.get(sk);
    const price = lot.schemeCode != null ? nav.get(String(lot.schemeCode)) : undefined;
    const priced = price != null && Number.isFinite(price) && price > 0;
    const cost = lot.nav * lot.units;
    return {
      scheme: lot.schemeName, schemeCode: lot.schemeCode, date: lot.date, units: lot.units, costNav: lot.nav,
      nav: priced ? price! : null,
      cost,
      value: priced ? price! * lot.units : null,
      gain: priced ? (price! - lot.nav) * lot.units : null,
      term: holdingDays(lot.date, today) > 365 ? "lt" : "st",
      equity: isEquityTaxed(meta?.category, meta?.name ?? lot.schemeName),
    };
  });
  return { lots, realizedLtcgThisFy: Math.max(0, realizedLtcgThisFy) };
}

export function notionalByClient(groups: Map<string, TxGroup>, nav: Map<string, number>, fy: number): NotionalClientRow[] {
  const out: NotionalClientRow[] = [];
  for (const g of groups.values()) {
    const { lots, realizedLtcgThisFy } = notionalLotsFor(g, nav, fy);
    if (lots.length === 0) continue;
    let invested = 0, current = 0, lt = 0, st = 0, unpriced = 0, eqLt = 0;
    for (const l of lots) {
      invested += l.cost;
      if (l.value == null || l.gain == null) { unpriced++; continue; }
      current += l.value;
      if (l.term === "lt") lt += l.gain; else st += l.gain;
      if (l.equity && l.term === "lt" && l.gain > 0) eqLt += l.gain;
    }
    const headroom = Math.min(eqLt, Math.max(0, LTCG_EXEMPTION - realizedLtcgThisFy));
    out.push({
      investorId: g.investorId, name: g.name, pan: g.pan, rmId: g.rmId,
      lots: lots.length, unpriced,
      invested: r2(invested), current: r2(current),
      unrealisedLt: r2(lt), unrealisedSt: r2(st), unrealised: r2(lt + st),
      ltcgHeadroom: r2(headroom),
    });
  }
  return out.sort((a, b) => Math.abs(b.unrealised) - Math.abs(a.unrealised));
}

/* ───────────────────────── Dividends / IDCW ───────────────────────── */

export type DividendClientRow = ClientRef & { payout: number; reinvest: number; total: number; entries: number };

export async function loadDividendsByClient(
  tx: Tx,
  opts: { tenantId: string; fy: number; rmId?: string }
): Promise<DividendClientRow[]> {
  const { start, end } = fyRange(opts.fy);
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;
  const res = await tx.execute(sql`
    SELECT i.id AS investor_id, i.name, i.pan, i.rm_id,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'dividend_payout'), 0)::float8   AS payout,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'dividend_reinvest'), 0)::float8 AS reinvest,
           COUNT(*)::int AS entries
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id AND i.tenant_id = ${opts.tenantId}::uuid
                      AND i.deleted_at IS NULL AND i.merged_into_id IS NULL${rmScope}
     WHERE t.tenant_id = ${opts.tenantId}::uuid
       AND t.type IN ('dividend_payout', 'dividend_reinvest')
       AND t.status IN ('processed', 'successful')
       AND t.order_date BETWEEN ${start}::date AND ${end}::date
     GROUP BY i.id, i.name, i.pan, i.rm_id
     ORDER BY (COALESCE(SUM(t.amount), 0)) DESC
  `);
  return (res.rows as any[]).map((r) => ({
    investorId: String(r.investor_id), name: r.name ?? "—", pan: r.pan ?? null, rmId: r.rm_id ? String(r.rm_id) : null,
    payout: r2(num(r.payout)), reinvest: r2(num(r.reinvest)), total: r2(num(r.payout) + num(r.reinvest)), entries: num(r.entries),
  }));
}

export type DividendEntry = { date: string; scheme: string | null; type: "dividend_payout" | "dividend_reinvest"; amount: number };

export async function loadDividendDetail(tx: Tx, opts: { tenantId: string; investorId: string; fy: number }): Promise<DividendEntry[]> {
  const { start, end } = fyRange(opts.fy);
  const res = await tx.execute(sql`
    SELECT order_date, scheme_name, type, amount
      FROM transactions
     WHERE tenant_id = ${opts.tenantId}::uuid AND investor_id = ${opts.investorId}::uuid
       AND type IN ('dividend_payout', 'dividend_reinvest')
       AND status IN ('processed', 'successful')
       AND order_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY order_date ASC
  `);
  return (res.rows as any[]).map((r) => ({
    date: String(r.order_date).slice(0, 10), scheme: r.scheme_name ?? null, type: r.type, amount: r2(num(r.amount)),
  }));
}

/* ───────────────────────── FY-wise ───────────────────────── */

export type FyCell = { inflow: number; outflow: number; net: number; gain: number };
export type FyWiseRow = ClientRef & { byFy: Record<number, FyCell>; active: boolean };

/**
 * Per client, per FY: fresh money in (purchases / SIPs / switch-ins, NOT
 * dividend reinvestments — that isn't the investor's money), money out, and
 * the realised gain the engine attributes to that FY.
 */
export function fyWiseByClient(groups: Map<string, TxGroup>, fys: number[]): FyWiseRow[] {
  const out: FyWiseRow[] = [];
  for (const g of groups.values()) {
    const byFy: Record<number, FyCell> = {};
    let active = false;
    for (const fy of fys) {
      const { start, end } = fyRange(fy);
      let inflow = 0, outflow = 0;
      for (const r of g.rows) {
        if (!r.order_date || r.order_date < start || r.order_date > end) continue;
        const amt = num(r.amount);
        if (r.direction === "inflow" && r.type !== "dividend_reinvest") inflow += amt;
        else if (r.direction === "outflow") outflow += amt;
      }
      const gains = fifoRealizedGains(g.rows, fy);
      const gain = gains.stcg + gains.ltcg;
      if (inflow || outflow || gains.rows.length) active = true;
      byFy[fy] = { inflow: r2(inflow), outflow: r2(outflow), net: r2(inflow - outflow), gain: r2(gain) };
    }
    if (active) out.push({ investorId: g.investorId, name: g.name, pan: g.pan, rmId: g.rmId, byFy, active });
  }
  const latest = fys[0];
  return out.sort((a, b) => Math.abs(b.byFy[latest]?.net ?? 0) - Math.abs(a.byFy[latest]?.net ?? 0));
}

