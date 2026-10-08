/** One folio-aware valuation contract for profile, portal, PDF and stored AUM. */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { xirr, type CashFlow } from "./xirr";
import { positionKey, type PositionIdentity } from "./position-key";
import { loadNavIndex, lookupNav, type NavIndex } from "./scheme-match";
import { schemeNameKey } from "./scheme-name-key";

export type SchemeHolding = {
  schemeCode: string | null; schemeName: string | null; amcName: string | null;
  folioNumber: string | null; folioNumbers: string[]; folioId: string | null;
  netUnits: number;
  /** Remaining average acquisition cost; null if history is incomplete. */
  investedNet: number | null;
  /**
   * When the history has MORE units than the statement (redemptions the feed
   * never sent), the cost of the units held at the history's average cost —
   * an estimate, shown as such. Null otherwise.
   */
  investedEstimate: number | null;
  latestNav: number | null; navDate: string | null; currentValue: number | null;
  /** Unrealised gain on remaining units. */
  gain: number | null; xirr: number | null;
  kind: "sip" | "lumpsum" | "mixed" | null; priced: boolean;
  startDate: string | null; avgDays: number | null;
  realisedGain: number | null; dividend: number | null; hasTxns: boolean;
  historyCoverage: "ledger" | "snapshot_only" | "incomplete";
  snapshotDate: string | null;
};
export type InvestorValuation = {
  currentValue: number;
  /** Lifetime purchases less redemptions/payouts; null if history is incomplete. */
  investedNet: number | null;
  pricedInvested: number | null; unpricedInvested: number;
  /**
   * Cost of the holdings held today, exact where the history is complete and
   * estimated where it is not (SchemeHolding.investedEstimate). Null when it
   * is exact anyway (see investedNet) or any open holding has neither.
   */
  investedEstimate: number | null;
  /** Lifetime account gain, including fully redeemed holdings. */
  gain: number | null; absoluteReturn: number | null; xirr: number | null;
  asOf: string | null; holdings: SchemeHolding[]; unpricedSchemes: number;
  dataQuality: {
    pricedHoldings: number; openHoldings: number; unknownCostHoldings: number;
    unknownCostValue: number; incompleteHistoryHoldings: number;
    undatedPrices: number; oldestNavDate: string | null;
    unmatchedRedemptionUnits: number; closedPositions: number;
  };
};
export type ValuationTransaction = PositionIdentity & {
  direction: string | null; type: string | null; amount: string | number | null;
  units: string | number | null; order_date: string | null;
  latest_nav: string | number | null; latest_nav_date: string | null;
  /** The NAV master's name for the scheme code, when it knows the code. */
  nav_scheme_name?: string | null;
  /** The AMFI scheme this row resolved to (by code, else by name). */
  amfi_code?: string | null;
};
type SnapshotScheme = {
  schemeCode?: string | null; schemeName?: string | null; units?: number | string;
  nav?: number | string; value?: number | string; navDate?: string | null;
  asOf?: string | null; snapshotDate?: string | null;
};
export type ValuationSnapshot = PositionIdentity & {
  scheme: SnapshotScheme; latest_nav?: number | string | null; latest_nav_date?: string | null;
  snapshot_date?: string | null; nav_scheme_name?: string | null;
  amfi_code?: string | null;
};
const finite = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown) => { const n = finite(v); return n != null && n > 0 ? n : null; };
const dateOnly = (v?: string | null) => v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
const DUST = 0.0005;

/**
 * A "name" that is really a code. KFintech's transaction feed stored its
 * 2-letter scheme column ("EQ", "FM") as the name until 2026-10-07, and a
 * folio master can leave the name blank. Such a name is never shown when a
 * real one is known for the same scheme code.
 */
export function codeLikeName(name: string | null | undefined, code?: string | null): boolean {
  const n = (name ?? "").trim();
  if (n.length <= 4) return true;
  if (!/\s/.test(n) && code && code.toUpperCase().includes(n.toUpperCase())) return true;
  return /^[0-9]+$/.test(n);
}
const nameKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The folio half of positionKey — two codes in one folio share it. */
const folioPart = (r: PositionIdentity) => JSON.stringify([
  r.investor_id ?? "",
  r.folio_id || [(r.amc_code || r.amc_name || "").trim().toLowerCase(), (r.folio_number ?? "").trim().toLowerCase()],
]);

/**
 * Two bulk reads for a batch, always inside the caller's withTenant transaction.
 *
 * Both name the clients' tenant explicitly. The indexes lead with tenant_id
 * ((tenant_id, investor_id, order_date) on transactions, (tenant_id,
 * investor_id) on folios), and the RLS policy alone — tenant OR platform
 * admin — cannot supply it as an index condition, so without it every page
 * view read the whole transactions table (production, 2026-10-08: ~5 s a call,
 * the CRM's most expensive query). The tenant comes from the investors
 * themselves, so a system-context caller works the same way.
 *
 * The folio is found by id, or — for a row imported without one — by
 * (investor, AMC, folio number), as two plain joins. One OR'ed join forced a
 * nested loop comparing every transaction with every folio.
 */
export async function loadValuationRows(tx: Tx, investorIds: string[]) {
  if (investorIds.length === 0) return { transactions: [], snapshots: [] };
  const ids = sql.join(investorIds.map((id) => sql`${id}::uuid`), sql`, `);
  const tenantRows = (await tx.execute(sql`
    SELECT DISTINCT tenant_id::text AS tenant_id FROM investors WHERE id IN (${ids})
  `)).rows as Array<{ tenant_id: string }>;
  if (tenantRows.length === 0) return { transactions: [], snapshots: [] };
  const tenants = sql.join(tenantRows.map((r) => sql`${r.tenant_id}::uuid`), sql`, `);
  // A transaction belongs to whoever holds its FOLIO, not to the client row
  // it was filed under: a feed row carries the investor's PAN (a guardian's,
  // for a minor's folio), and an import can move a folio without moving its
  // history. Read by the transaction's own client, the same holding was valued
  // twice — from the statement under the folio's owner and from the history
  // under the other client (8 Oct 2026: 76,614 such transactions at Ahpal,
  // 12,029 at Sandeep Garg). So: this batch's own transactions on folios it
  // holds (or on none), plus transactions filed elsewhere on folios it holds.
  const cols = sql`COALESCE(fi.investor_id, t.investor_id) AS investor_id,
           COALESCE(fi.id, fn.id, t.folio_id) AS folio_id,
           COALESCE(fi.folio_number, fn.folio_number, t.folio_number) AS folio_number,
           COALESCE(fi.amc_code, fn.amc_code, t.amc_code) AS amc_code,
           COALESCE(fi.amc_name, fn.amc_name, t.amc_name) AS amc_name,
           t.scheme_code, t.scheme_name, t.direction, t.type, t.amount, t.units,
           t.order_date, n.nav AS latest_nav, n.nav_date AS latest_nav_date, n.scheme_name AS nav_scheme_name,
           n.scheme_code AS amfi_code, t.id AS txn_id`;
  const joins = sql`LEFT JOIN folios fi ON fi.id = t.folio_id AND fi.tenant_id = t.tenant_id
    LEFT JOIN folios fn ON t.folio_id IS NULL AND fn.tenant_id = t.tenant_id
      AND fn.investor_id = t.investor_id AND fn.amc_code = t.amc_code AND fn.folio_number = t.folio_number
    LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code`;
  const live = sql`t.status IN ('processed', 'successful') AND t.order_date IS NOT NULL`;
  const transactions = (await tx.execute(sql`
    SELECT * FROM (
      SELECT ${cols} FROM transactions t ${joins}
       WHERE t.tenant_id IN (${tenants}) AND t.investor_id IN (${ids}) AND ${live}
         AND (fi.id IS NULL OR fi.investor_id IN (${ids}))
      UNION ALL
      SELECT ${cols} FROM transactions t ${joins}
       WHERE t.tenant_id IN (${tenants}) AND ${live}
         AND t.folio_id IN (SELECT f.id FROM folios f WHERE f.tenant_id IN (${tenants}) AND f.investor_id IN (${ids}))
         AND t.investor_id NOT IN (${ids})
    ) x
    ORDER BY x.order_date, x.txn_id
  `)).rows as unknown as ValuationTransaction[];
  const snapshots = (await tx.execute(sql`
    SELECT f.investor_id, f.id AS folio_id, f.folio_number, f.amc_code, f.amc_name,
           sc AS scheme, n.nav AS latest_nav, n.nav_date AS latest_nav_date, n.scheme_name AS nav_scheme_name,
           n.scheme_code AS amfi_code,
           COALESCE(sc->>'snapshotDate', f.details->>'holdingsAsOf') AS snapshot_date
    FROM folios f CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS sc
    LEFT JOIN scheme_nav n ON n.scheme_code = sc->>'schemeCode'
    WHERE f.tenant_id IN (${tenants}) AND f.investor_id IN (${ids})
  `)).rows as unknown as ValuationSnapshot[];
  await priceByName(tx, transactions, snapshots);
  return { transactions, snapshots };
}

/**
 * The NAV join above is by scheme CODE, and the registrars' feeds carry their
 * own product codes ("HGFGPG", "K1155", "101EQGP") that the AMFI master does
 * not know — so a holding built from transactions showed what was invested and
 * no current value, and the client's AUM never moved. Rows the join could not
 * price are priced from the scheme NAME (lib/finance/scheme-match lookupNav:
 * exact name, then schemeNameKey, refusing anything ambiguous).
 */
let navIndexCache: { at: number; index: NavIndex } | null = null;
const NAV_INDEX_TTL_MS = 30 * 60_000;
async function navIndexFor(tx: Tx): Promise<NavIndex> {
  if (!navIndexCache || Date.now() - navIndexCache.at > NAV_INDEX_TTL_MS) {
    navIndexCache = { at: Date.now(), index: await loadNavIndex(tx) };
  }
  return navIndexCache.index;
}
async function priceByName(tx: Tx, transactions: ValuationTransaction[], snapshots: ValuationSnapshot[]) {
  const needT = transactions.filter((r) => positive(r.latest_nav) == null && r.scheme_name && !codeLikeName(r.scheme_name, r.scheme_code));
  const needS = snapshots.filter((r) => positive(r.latest_nav) == null && r.scheme?.schemeName);
  if (!needT.length && !needS.length) return;
  const index = await navIndexFor(tx);
  if (!index.size) return;
  const memo = new Map<string, ReturnType<typeof lookupNav>>();
  const hit = (name: string) => {
    if (!memo.has(name)) memo.set(name, lookupNav(index, null, name));
    return memo.get(name)!;
  };
  for (const r of needT) {
    const h = hit(String(r.scheme_name));
    if (h) { r.latest_nav = h.nav; r.latest_nav_date = h.navDate; r.amfi_code = h.code; }
  }
  for (const r of needS) {
    const h = hit(String(r.scheme.schemeName));
    if (h) { r.latest_nav = h.nav; r.latest_nav_date = h.navDate; r.amfi_code = h.code; }
  }
}
export async function valueInvestor(tx: Tx, investorId: string): Promise<InvestorValuation> {
  const rows = await loadValuationRows(tx, [investorId]);
  return computeInvestorValuation(rows.transactions, rows.snapshots);
}

/** Pure accounting engine; rows from the loader are in stable chronological order. */
export function computeInvestorValuation(rows: ValuationTransaction[], snapshots: ValuationSnapshot[], now = new Date()): InvestorValuation {
  type Ledger = { holding: SchemeHolding; flows: CashFlow[]; rows: ValuationTransaction[];
    bought: number; net: number; cost: number; costUnits: number; missing: number; sip: boolean; lump: boolean };
  const positions = new Map<string, Ledger>();

  // ── One scheme, one row ─────────────────────────────────────────────────
  // A real name for every scheme code, from whichever source has one: the
  // holdings file, the NAV master, then the transactions.
  const nameByCode = new Map<string, string>();
  const learn = (code: string | null | undefined, name: string | null | undefined) => {
    if (!code || !name || codeLikeName(name, code) || nameByCode.has(code)) return;
    nameByCode.set(code, name.trim());
  };
  for (const r of snapshots) learn(r.scheme?.schemeCode, r.scheme?.schemeName);
  for (const r of snapshots) learn(r.scheme?.schemeCode, r.nav_scheme_name);
  for (const r of rows) learn(r.scheme_code, r.nav_scheme_name);
  for (const r of rows) learn(r.scheme_code, r.scheme_name);
  const bestName = (code: string | null | undefined, own: string | null | undefined): string | null =>
    (own && !codeLikeName(own, code) ? own.trim() : null) ?? (code ? nameByCode.get(code) : undefined) ?? (own?.trim() || null);
  // The same holding can reach us under two codes in one folio — the RTA's own
  // product code ("D157") from one file, the AMFI code ("105989") from another —
  // and was shown, and valued, twice. Within a folio one scheme NAME is one
  // holding: every code for it maps to the first key seen (a ledger's, when
  // there is one, since transactions are read first).
  // A transaction with no folio — the reconciliation "opening balance" posted
  // one for units a folio already held — belongs to the one folio that holds
  // that scheme; posted beside it, it doubled the holding.
  //
  // "One scheme" is the AMFI scheme a row resolves to, else its schemeNameKey —
  // never the exact name alone. The registrar and the holdings file write one
  // scheme differently ("HDFC Childrens Fund - Regular Plan" / "HDFC Children's
  // Fund - Regular Plan - Growth Option"); once both sides could be priced
  // (8 Oct 2026) the exact-name rule counted such a holding twice — Ahpal's
  // book read Rs 800.89 Cr against a Rs 735.74 Cr folio register.
  const hasFolio = (r: PositionIdentity) => !!(r.folio_id || r.folio_number);
  type Ident = PositionIdentity & { amfi_code?: string | null };
  // Every identity a row can be known by: its AMFI scheme and its name key.
  // Two rows in one folio sharing EITHER are one holding.
  const groupsOf = (identity: Ident): string[] => {
    const out: string[] = [];
    if (identity.amfi_code) out.push(`amfi:${identity.amfi_code}`);
    const nm = bestName(identity.scheme_code, identity.scheme_name);
    if (nm && !codeLikeName(nm, identity.scheme_code)) {
      const k = schemeNameKey(nm);
      out.push(k ? `key:${k.tokens}|${k.direct ? "d" : "r"}` : nameKey(nm));
    }
    return out;
  };
  const foliosByName = new Map<string, Set<string>>();
  const noteFolio = (identity: Ident) => {
    if (!hasFolio(identity)) return;
    for (const g of groupsOf(identity)) {
      const k = `${identity.investor_id ?? ""}|${g}`;
      const set = foliosByName.get(k) ?? new Set<string>();
      set.add(folioPart(identity));
      foliosByName.set(k, set);
    }
  };
  for (const r of rows) noteFolio(r);
  for (const r of snapshots) noteFolio({ ...r, scheme_code: r.scheme?.schemeCode, scheme_name: r.scheme?.schemeName });
  const canonical = new Map<string, string>();
  const alias = new Map<string, string>();
  const keyFolio = new Map<string, string>();
  const canonFor = (identity: Ident) => {
    const key = positionKey(identity);
    const cached = alias.get(key);
    if (cached) return cached;
    const groups = groupsOf(identity);
    let fp = folioPart(identity);
    if (groups.length && !hasFolio(identity)) {
      for (const g of groups) {
        const homes = foliosByName.get(`${identity.investor_id ?? ""}|${g}`);
        if (homes?.size === 1) { fp = [...homes][0]; break; }
      }
    }
    let canon = key;
    for (const g of groups) {
      const seen = canonical.get(fp + "|" + g);
      if (seen) { canon = seen; break; }
    }
    for (const g of groups) if (!canonical.has(fp + "|" + g)) canonical.set(fp + "|" + g, canon);
    alias.set(key, canon);
    if (!keyFolio.has(canon)) keyFolio.set(canon, fp);
    return canon;
  };
  const makeHolding = (r: PositionIdentity): SchemeHolding => ({
    schemeCode: r.scheme_code ?? null, schemeName: r.scheme_name ?? null, amcName: r.amc_name ?? null,
    folioNumber: r.folio_number ?? null, folioNumbers: r.folio_number ? [r.folio_number] : [], folioId: r.folio_id ?? null,
    netUnits: 0, investedNet: null, investedEstimate: null, latestNav: null, navDate: null, currentValue: null,
    gain: null, xirr: null, kind: null, priced: false, startDate: null, avgDays: null,
    realisedGain: null, dividend: null, hasTxns: false, historyCoverage: "snapshot_only", snapshotDate: null,
  });
  for (const r of rows) {
    const key = canonFor(r);
    let p = positions.get(key);
    if (!p) {
      const h = makeHolding(r); h.hasTxns = true; h.historyCoverage = "ledger"; h.realisedGain = 0; h.dividend = 0;
      p = { holding: h, flows: [], rows: [], bought: 0, net: 0, cost: 0, costUnits: 0, missing: 0, sip: false, lump: false };
      positions.set(key, p);
    }
    p.rows.push(r);
    const h = p.holding;
    const amount = Math.abs(finite(r.amount) ?? 0), units = Math.abs(finite(r.units) ?? 0);
    const buy = r.direction === "inflow", dividend = r.type === "dividend_payout";
    if (!buy && r.direction !== "outflow") h.historyCoverage = "incomplete";
    const date = dateOnly(r.order_date);
    if (date && amount > 0) p.flows.push({ date: new Date(date), amount: buy ? -amount : amount });
    p.net += buy ? amount : -amount;
    if (dividend) h.dividend = (h.dividend ?? 0) + amount;
    else if (buy) {
      p.bought += amount; p.cost += amount; p.costUnits += units; h.netUnits += units;
      if (units > 0 && amount <= 0) h.historyCoverage = "incomplete";
      if (!h.startDate) h.startDate = date;
      if (r.type === "sip") p.sip = true; else p.lump = true;
    } else {
      const matched = Math.min(units, p.costUnits), avg = p.costUnits > 0 ? p.cost / p.costUnits : 0;
      h.realisedGain = (h.realisedGain ?? 0) + (units > 0 ? amount * matched / units : 0) - avg * matched;
      p.cost -= avg * matched; p.costUnits -= matched; h.netUnits -= units;
      p.missing += units - matched;
      if (units - matched > DUST) h.historyCoverage = "incomplete";
    }
    if (positive(r.latest_nav) != null) { h.latestNav = positive(r.latest_nav); h.navDate = dateOnly(r.latest_nav_date); }
    h.kind = p.sip && p.lump ? "mixed" : p.sip ? "sip" : p.lump ? "lumpsum" : null;
  }
  // Sum ARN legs within their own folio and scheme. Another folio never suppresses them.
  type Snap = { holding: SchemeHolding; value: number; units: number; hasValue: boolean; navFromMaster: boolean };
  const snapshotParts = new Map<string, Map<string, Snap>>();
  // Statements that say, in so many words, 0 units (a blank is not a zero).
  const zeroKeys = new Set<string>();
  // Folios a holdings STATEMENT has valued (a leg that states its units — a
  // master file's legs carry none). Such a statement lists the folio's
  // holdings, so a scheme the history holds but the statement does not was
  // sold, its redemption never fed in: Ahpal's book read Rs 1,018 Cr against
  // a Rs 736 Cr register on 8 Oct 2026 once those history-only holdings
  // could be priced.
  //
  // The same for a folio a registrar MASTER lists (schemes without units): the
  // registrar knows the folio, so the history alone is not evidence of a
  // holding there. Counting those history-only holdings put Ahpal at Rs 827 Cr
  // against the firm's own Rs 726 Cr; without them the book is the registrar
  // statements' Rs 733 Cr. History values a folio only when no registrar file
  // mentions that folio at all.
  const statedFolios = new Set<string>();
  for (const r of snapshots) statedFolios.add(folioPart(r));
  // And a client the registrar values at all is valued from the registrar:
  // a history-only holding in a folio with no legs is not in any statement
  // either (Nimesh C Shah, 8 Oct 2026: 645 such holdings, Rs 40.07 Cr, over a
  // statement-backed Rs 130.48 Cr against the firm's Rs 130.56 Cr). History
  // values holdings only for a client no registrar statement covers.
  const registrarValued = snapshots.some((r) => finite(r.scheme?.units) != null);
  for (const r of snapshots) {
    const sc = r.scheme ?? {}, identity = { ...r, scheme_code: sc.schemeCode, scheme_name: sc.schemeName };
    if (!sc.schemeCode && !sc.schemeName) continue;
    const own = positionKey(identity), key = canonFor(identity), units = finite(sc.units) ?? 0;
    const nav = positive(r.latest_nav) ?? positive(sc.nav);
    const value = nav != null && finite(sc.units) != null ? units * nav : finite(sc.value);
    if (finite(sc.units) === 0) zeroKeys.add(key);
    if (units < 0 || (units <= DUST && (value ?? 0) <= 0)) continue;
    let parts = snapshotParts.get(key);
    if (!parts) { parts = new Map(); snapshotParts.set(key, parts); }
    // ARN legs of ONE code add up; a second code for the same holding does not.
    let s = parts.get(own);
    if (!s) { s = { holding: makeHolding(identity), value: 0, units: 0, hasValue: true, navFromMaster: false }; parts.set(own, s); }
    s.units += units; s.value += value ?? 0; s.hasValue &&= value != null;
    s.holding.latestNav = nav;
    s.navFromMaster = positive(r.latest_nav) != null;
    s.holding.navDate = s.navFromMaster ? dateOnly(r.latest_nav_date) : dateOnly(sc.navDate ?? sc.asOf);
    s.holding.snapshotDate = dateOnly(r.snapshot_date ?? sc.snapshotDate);
  }
  // Two codes for one holding: the newer statement wins, then the one the NAV
  // master prices, then the newer NAV, then the larger.
  const snapshotByKey = new Map<string, Snap>();
  const rank = (s: Snap): Array<string | number> => [s.holding.snapshotDate ?? "", s.navFromMaster ? 1 : 0, s.holding.navDate ?? "", s.units];
  for (const [key, parts] of snapshotParts) {
    let best: Snap | null = null;
    for (const s of parts.values()) {
      if (!best) { best = s; continue; }
      const a = rank(s), b = rank(best);
      for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) continue; if (a[i] > b[i]) best = s; break; }
    }
    if (best) snapshotByKey.set(key, best);
  }
  // A KFintech feed code ("189FXRG", named "FX") and the holdings file's AMFI
  // code ("151898") for one scheme cannot be matched by name. In one folio, a
  // ledger with no statement and a statement with no ledger that hold EXACTLY
  // the same units are the same holding.
  for (const [pk, p] of positions) {
    if (snapshotByKey.has(pk) || p.holding.netUnits <= DUST) continue;
    const fp = keyFolio.get(pk);
    if (!fp) continue;
    const twins = [...snapshotByKey].filter(([sk, sn]) =>
      !positions.has(sk) && keyFolio.get(sk) === fp && Math.abs(sn.units - p.holding.netUnits) <= DUST);
    if (twins.length === 1) { snapshotByKey.set(pk, twins[0][1]); snapshotByKey.delete(twins[0][0]); }
  }
  const holdings: SchemeHolding[] = [];
  const quality: InvestorValuation["dataQuality"] = { pricedHoldings: 0, openHoldings: 0, unknownCostHoldings: 0,
    unknownCostValue: 0, incompleteHistoryHoldings: 0, undatedPrices: 0, oldestNavDate: null,
    unmatchedRedemptionUnits: 0, closedPositions: 0 };
  let currentValue = 0, unpricedSchemes = 0, unpricedInvested = 0, net = 0, pricedNet = 0, bought = 0, latest: string | null = null;
  let complete = true;
  // Cost of today's holdings, exact or estimated (see investedEstimate).
  let costHeld = 0, costHeldKnown = true, costHeldEstimated = false;
  const flows: CashFlow[] = [];
  for (const key of new Set([...positions.keys(), ...snapshotByKey.keys()])) {
    const p = positions.get(key), s = snapshotByKey.get(key), h = p?.holding ?? s!.holding;
    let snapshotUnits = s?.units ?? 0;
    // Dated snapshots establish an opening balance; later ledger movements advance it.
    if (s?.holding.snapshotDate) for (const r of p?.rows ?? []) {
      if (r.order_date && r.order_date > s.holding.snapshotDate && r.type !== "dividend_payout") {
        snapshotUnits += (r.direction === "inflow" ? 1 : -1) * Math.abs(finite(r.units) ?? 0);
      }
    }
    const snapshotWins = !!s && (!p || Math.abs(h.netUnits - snapshotUnits) > DUST);
    const ledgerUnits = h.netUnits;
    if (s) h.snapshotDate = s.holding.snapshotDate;
    // The statement says 0 units for a holding the history still shows open:
    // its redemptions never reached the feed. It is closed, cost unknown.
    const statementZero = !s && !!p && h.netUnits > DUST
      && (zeroKeys.has(key) || registrarValued || statedFolios.has(keyFolio.get(key) ?? ""));
    if (statementZero) {
      h.netUnits = 0; h.currentValue = 0; h.historyCoverage = "incomplete";
    } else if (snapshotWins && s) {
      h.netUnits = snapshotUnits; h.latestNav = s.holding.latestNav; h.navDate = s.holding.navDate;
      h.currentValue = h.latestNav != null ? Math.max(0, snapshotUnits) * h.latestNav : s.hasValue ? s.value : null;
      h.historyCoverage = p ? "incomplete" : "snapshot_only";
    } else {
      if (Math.abs(h.netUnits) <= DUST) h.netUnits = 0;
      // The NAV master may not know an RTA product code ("101EQGP"); the
      // holdings statement for the same units still carries a NAV.
      if (h.latestNav == null && s?.holding.latestNav != null) { h.latestNav = s.holding.latestNav; h.navDate = s.holding.navDate; }
      h.currentValue = h.netUnits === 0 ? 0 : h.latestNav != null && h.netUnits > 0 ? h.netUnits * h.latestNav : null;
    }
    if (h.netUnits < -DUST) h.historyCoverage = "incomplete";
    const known = h.historyCoverage === "ledger";
    h.investedNet = known && p ? Math.max(0, p.cost) : null;
    h.gain = known && h.currentValue != null ? h.currentValue - (h.investedNet ?? 0) : null;
    // History with more units than the statement: redemptions are missing, so
    // what is held was bought at the history's average cost — an estimate.
    // Fewer units means purchases are missing, and their cost is unknowable.
    h.investedEstimate = !known && p && s && snapshotWins && p.costUnits > DUST && snapshotUnits > DUST
      && ledgerUnits >= snapshotUnits - DUST
      ? (p.cost / p.costUnits) * snapshotUnits : null;
    if (!known) { h.realisedGain = null; quality.unknownCostHoldings++; quality.unknownCostValue += h.currentValue ?? 0; complete = false; }
    if (h.historyCoverage === "incomplete") quality.incompleteHistoryHoldings++;
    quality.unmatchedRedemptionUnits += p?.missing ?? 0;
    h.priced = h.currentValue != null && (h.netUnits > DUST || h.currentValue > 0);
    if (h.netUnits > DUST || (h.currentValue ?? 0) > 0) {
      quality.openHoldings++;
      if (h.investedNet != null) costHeld += h.investedNet;
      else if (h.investedEstimate != null) { costHeld += h.investedEstimate; costHeldEstimated = true; }
      else costHeldKnown = false;
      if (h.priced) {
        quality.pricedHoldings++;
        if (!h.navDate) quality.undatedPrices++;
        else { if (!latest || h.navDate > latest) latest = h.navDate; if (!quality.oldestNavDate || h.navDate < quality.oldestNavDate) quality.oldestNavDate = h.navDate; }
      } else { unpricedSchemes++; unpricedInvested += h.investedNet ?? 0; complete = false; }
    } else if (p) quality.closedPositions++;
    currentValue += h.currentValue ?? 0;
    if (known && p) {
      net += p.net;
      if (h.currentValue != null) {
        pricedNet += p.net; bought += p.bought; flows.push(...p.flows);
        h.xirr = xirr([...p.flows, ...(h.currentValue > 0 ? [{ date: now, amount: h.currentValue }] : [])]);
      }
    }
    const ownName = bestName(h.schemeCode, h.schemeName);
    const statementName = s ? bestName(s.holding.schemeCode, s.holding.schemeName) : null;
    h.schemeName = ownName && !codeLikeName(ownName, h.schemeCode) ? ownName : statementName ?? ownName;
    if (!h.amcName && s?.holding.amcName) h.amcName = s.holding.amcName;
    if (!h.folioNumber && s?.holding.folioNumber) { h.folioNumber = s.holding.folioNumber; h.folioNumbers = s.holding.folioNumbers; h.folioId = s.holding.folioId; }
    holdings.push(h);
  }
  const gain = complete ? currentValue - pricedNet : null;
  return { currentValue, investedNet: complete ? net : null, pricedInvested: complete ? pricedNet : null,
    unpricedInvested, investedEstimate: !complete && costHeldKnown && costHeldEstimated ? costHeld : null,
    gain, absoluteReturn: gain != null && bought > 0 ? gain / bought : null,
    xirr: complete ? xirr([...flows, ...(currentValue > 0 ? [{ date: now, amount: currentValue }] : [])]) : null,
    asOf: latest, holdings: holdings.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)), unpricedSchemes, dataQuality: quality };
}
const valuationCache = new Map<string, { at: number; data: InvestorValuation }>();
const VALUATION_TTL = Number(process.env.VALUATION_CACHE_TTL_MS ?? 600_000);
export function invalidateInvestorValuation(investorId: string) { valuationCache.delete(investorId); }
export async function valueInvestorCached(tx: Tx, investorId: string, now = Date.now()): Promise<InvestorValuation> {
  if (VALUATION_TTL <= 0) return valueInvestor(tx, investorId);
  const hit = valuationCache.get(investorId);
  if (hit && now - hit.at < VALUATION_TTL) return hit.data;
  const data = await valueInvestor(tx, investorId);
  valuationCache.set(investorId, { at: now, data });
  if (valuationCache.size > 5000) { const oldest = valuationCache.keys().next().value; if (oldest) valuationCache.delete(oldest); }
  return data;
}
