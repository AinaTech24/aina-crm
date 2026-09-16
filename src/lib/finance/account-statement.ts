/**
 * Client account statement — opening balance, transactions, closing balance,
 * per folio × scheme, for a date range. SERVER-ONLY.
 *
 * The classic client-facing deliverable, and the one report we could already
 * produce every number for but never assembled. Everything here comes from the
 * existing transaction ledger; nothing new is stored.
 *
 * The shape mirrors what a registrar statement looks like, because that is what
 * a client will compare it against:
 *
 *   ── HDFC Flexi Cap – Growth · folio 5904386/12 ──
 *   Opening balance                       120.450 units
 *   15 Jun 2026  SIP           ₹5,000     11.200 units   → 131.650
 *   10 Jul 2026  Redemption    ₹2,000     -4.400 units   → 127.250
 *   Closing balance                       127.250 units   @ ₹52.41 = ₹6,669
 *
 * Opening balance is computed from EVERY transaction before `from`, not from a
 * stored figure — there is no stored figure, and deriving it is the only way the
 * arithmetic closes: opening + movement must equal closing, or the statement is
 * worse than useless to a client checking it against the registrar's own.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { positionKey } from "./position-key";

export type StatementLine = {
  date: string;
  type: string;
  description: string;
  amount: number | null;
  units: number;
  nav: number | null;
  /** Running unit balance after this line. */
  balance: number;
};

export type StatementGroup = {
  folioNumber: string | null;
  schemeCode: string | null;
  schemeName: string;
  amcName: string | null;
  openingUnits: number;
  closingUnits: number;
  lines: StatementLine[];
  /** Latest NAV, when we could price the scheme. */
  nav: number | null;
  closingValue: number | null;
  navDate: string | null;
};

export type AccountStatement = {
  from: string;
  to: string;
  groups: StatementGroup[];
  totalClosingValue: number;
  /** Schemes we could not price — the statement says so rather than under-totalling. */
  unpricedSchemes: number;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Registrar-style label for a canonical type. */
const LABEL: Record<string, string> = {
  sip: "SIP instalment",
  lumpsum: "Purchase",
  purchase: "Purchase",
  redemption: "Redemption",
  switch: "Switch",
  stp: "STP",
  swp: "SWP",
  sip_stop: "SIP stopped",
  sip_pause: "SIP paused",
  dividend_payout: "Dividend payout",
  dividend_reinvest: "Dividend reinvested",
};

export async function loadAccountStatement(
  tx: Tx,
  investorId: string,
  from: string,
  to: string
): Promise<AccountStatement> {
  // One pass over the ledger up to `to`, tagged as opening (before `from`) or
  // in-period. Two queries would have to agree on the grouping key; one cannot
  // disagree with itself.
  const rows = (await tx.execute(sql`
    SELECT t.folio_id, t.folio_number, t.amc_code, t.scheme_code, t.scheme_name, t.amc_name,
           t.order_date, t.type, t.direction,
           t.amount::numeric  AS amount,
           t.units::numeric   AS units,
           t.nav::numeric     AS nav,
           (t.order_date < ${from}::date) AS is_opening,
           n.nav::numeric     AS live_nav, n.nav_date AS nav_date
      FROM transactions t
      LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
     WHERE t.investor_id = ${investorId}::uuid
       AND t.status IN ('processed', 'successful')
       AND t.order_date IS NOT NULL
       AND t.order_date <= ${to}::date
     ORDER BY t.folio_number NULLS LAST, t.scheme_name, t.order_date, t.id
  `)).rows as any[];

  type Acc = Omit<StatementGroup, "closingUnits" | "closingValue"> & { liveNav: number | null };
  const byKey = new Map<string, Acc>();

  for (const r of rows) {
    const folio = r.folio_number ?? null;
    const schemeName = r.scheme_name ?? "—";
    const key = positionKey(r);
    let g = byKey.get(key);
    if (!g) {
      g = {
        folioNumber: folio,
        schemeCode: r.scheme_code ?? null,
        schemeName,
        amcName: r.amc_name ?? null,
        openingUnits: 0,
        lines: [],
        nav: null,
        navDate: r.nav_date ? String(r.nav_date).slice(0, 10) : null,
        liveNav: r.live_nav != null ? num(r.live_nav) : null,
      };
      byKey.set(key, g);
    }

    // Signed units: an outflow removes them. `direction` is authoritative here —
    // it is what valuation nets on, so the statement must agree with the
    // portfolio page or a client will find the discrepancy for us.
    const signed = r.type === "dividend_payout" ? 0 : r.direction === "outflow" ? -Math.abs(num(r.units)) : Math.abs(num(r.units));

    if (r.is_opening) {
      g.openingUnits += signed;
      continue;
    }
    const prev = g.lines.length ? g.lines[g.lines.length - 1].balance : g.openingUnits;
    g.lines.push({
      date: String(r.order_date).slice(0, 10),
      type: String(r.type),
      description: LABEL[String(r.type)] ?? String(r.type).replace(/_/g, " "),
      amount: r.amount != null ? num(r.amount) : null,
      units: signed,
      nav: r.nav != null ? num(r.nav) : null,
      balance: Math.round((prev + signed) * 10000) / 10000,
    });
  }

  let totalClosingValue = 0;
  let unpricedSchemes = 0;
  const groups: StatementGroup[] = [];

  for (const g of byKey.values()) {
    const closingUnits = g.lines.length ? g.lines[g.lines.length - 1].balance : g.openingUnits;
    // Dust: the same 0.0005 threshold valuation uses, so a fully-redeemed
    // holding reads as closed on both screens rather than as a rounding crumb.
    const settled = Math.abs(closingUnits) <= 0.0005 ? 0 : closingUnits;
    // Drop a holding that was zero throughout AND had no movement — it belongs
    // to some other period and only pads the statement.
    if (settled === 0 && g.lines.length === 0) continue;

    const nav = g.liveNav;
    const closingValue = nav != null && settled > 0 ? Math.round(settled * nav * 100) / 100 : null;
    if (closingValue != null) totalClosingValue += closingValue;
    else if (settled > 0) unpricedSchemes++;

    groups.push({
      folioNumber: g.folioNumber,
      schemeCode: g.schemeCode,
      schemeName: g.schemeName,
      amcName: g.amcName,
      openingUnits: Math.round(g.openingUnits * 10000) / 10000,
      closingUnits: settled,
      lines: g.lines,
      nav,
      navDate: g.navDate,
      closingValue,
    });
  }

  groups.sort((a, b) => (b.closingValue ?? 0) - (a.closingValue ?? 0) || a.schemeName.localeCompare(b.schemeName));

  return { from, to, groups, totalClosingValue, unpricedSchemes };
}
