/**
 * The shape of the book — the figures behind the dashboards' newer charts.
 * SERVER-ONLY. Same rules as every file here: an explicit tenant predicate,
 * the scope's client spine, and a figure never recorded is null, not zero.
 *
 *   getAumBridge            AUM at the start of the period → money in → market → now
 *   getSipBridge            SIP book at the start → added → stopped → other → now
 *   getAssetClassMix        folio AUM by asset class › AMFI category
 *   getClientConcentration  share of AUM held by the top x% of clients
 *   getSipRetentionByStart  SIPs started each month, and how many still run
 *   getAgeBands             clients and AUM by age band (people only)
 *   getClientGeography      clients and AUM by state and city
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { DOB_TYPES } from "@/lib/investors/type-rules";
import { cityKey, cityLabel, knownCity, mapShapesForState, stateKey } from "@/lib/geo/india-places";
import { clientRecordWhere, clientWhere, textList, type MetricPeriod, type MetricScope } from "./scope";
import { getStockOn } from "./history";
import { getAUM } from "./clients";
import { getSipBook } from "./sip";
import { getNetBusiness } from "./business";
import { getEntrySipFlow } from "./entries";
import { classifyScheme, ASSET_CLASSES, type AssetClass } from "./asset-class";
import { inOrder } from "./in-order";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const istToday = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/* ─────────────────────────────── bridges ─────────────────────────────── */

export type BridgeStep = { key: string; label: string; value: number; hint: string };
export type Bridge = {
  opening: number;
  openingDate: string;
  closing: number;
  closingDate: string;
  steps: BridgeStep[];
};

/** The period's closing balance: today's live figure, or the snapshot at its end. */
async function closingStock(tx: Tx, scope: MetricScope, period: MetricPeriod, live: () => Promise<number>, pick: "aum" | "sip") {
  const today = istToday();
  if (period.to >= today) return { value: await live(), date: today };
  const s = await getStockOn(tx, scope, period.to);
  return s ? { value: s[pick], date: s.date } : null;
}

/**
 * Where the period's AUM change came from. Opening = AUM recorded the day
 * before the period; net money in = purchases minus redemptions as the
 * REGISTRAR processed them (AUM is the registrar's valuation, so its money-in
 * must be too — booked entries run days ahead of it); the market move is
 * what is left. Null when the opening was not recorded or the imported ledger
 * does not cover the period.
 */
export async function getAumBridge(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<Bridge | null> {
  const opening = await getStockOn(tx, scope, dayBefore(period.from));
  if (!opening) return null;
  const [closing, flows] = await inOrder(
    () => closingStock(tx, scope, period, async () => (await getAUM(tx, scope)).aum, "aum"),
    () => getNetBusiness(tx, scope, period),
  );
  if (!closing || !flows.hasData || !flows.current) return null;
  const net = flows.current.net;
  return {
    opening: opening.aum, openingDate: opening.date, closing: closing.value, closingDate: closing.date,
    steps: [
      { key: "net", label: "Net money in", value: net, hint: "Purchases minus redemptions, as the registrar processed them." },
      { key: "market", label: "Market move", value: closing.value - opening.aum - net, hint: "The rest of the change: the market's effect on what clients held, and valuation updates." },
    ],
  };
}

/**
 * The SIP book's movement over the period: opening (recorded the day before),
 * SIPs and top-ups BOOKED, SIP stops BOOKED (Business Entries, as every
 * dashboard's SIP figures), and the rest — SIPs that ended, registrations
 * rejected, registrar updates. Null without an opening or any booked entry.
 */
export async function getSipBridge(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<Bridge | null> {
  const opening = await getStockOn(tx, scope, dayBefore(period.from));
  if (!opening) return null;
  const [closing, booked] = await inOrder(
    () => closingStock(tx, scope, period, async () => (await getSipBook(tx, scope)).monthly, "sip"),
    () => getEntrySipFlow(tx, scope, period),
  );
  if (!closing || !booked.everRecorded) return null;
  return {
    opening: opening.sip, openingDate: opening.date, closing: closing.value, closingDate: closing.date,
    steps: [
      { key: "added", label: "New & top-ups", value: booked.added, hint: "SIPs and top-ups booked in Business Entries, a month's worth." },
      { key: "stopped", label: "Stopped", value: -booked.stopped, hint: "SIP stops booked in Business Entries." },
      {
        key: "other", label: "Other", value: closing.value - opening.sip - booked.added + booked.stopped,
        hint: "SIPs that ended or were rejected, and registrar updates not booked as entries.",
      },
    ],
  };
}

/* ──────────────────────────── asset class mix ──────────────────────────── */

export type AssetClassMix = {
  groups: Array<{ assetClass: AssetClass; aum: number; categories: Array<{ name: string; aum: number }> }>;
  /** Σ of the scheme holdings read (the treemap's whole). */
  total: number;
  /** Of it, the share whose category is known. */
  classifiedPct: number;
};

/**
 * Folio AUM by asset class › category. Each holding's category is the AMFI
 * one (scheme_nav, by ISIN, else by scheme code), else the text the registrar
 * file carried, else "Category not recorded".
 */
export async function getAssetClassMix(tx: Tx, scope: MetricScope, perClass = 6): Promise<AssetClassMix> {
  const rows = (await tx.execute(sql`
    SELECT cat, SUM(v)::numeric AS aum FROM (
      SELECT COALESCE(n1.scheme_category, n2.scheme_category, NULLIF(btrim(s.e->>'category'), '')) AS cat,
             CASE WHEN (s.e->>'value') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (s.e->>'value')::numeric ELSE 0 END AS v
        FROM folios f
        JOIN investors i ON i.id = f.investor_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.schemes) = 'array' THEN f.schemes ELSE '[]'::jsonb END) AS s(e)
        LEFT JOIN LATERAL (
          SELECT n.scheme_category FROM scheme_nav n
           WHERE n.isin = upper(btrim(s.e->>'isin')) AND n.scheme_category IS NOT NULL LIMIT 1
        ) n1 ON COALESCE(s.e->>'isin', '') <> ''
        LEFT JOIN LATERAL (
          SELECT n.scheme_category FROM scheme_nav n
           WHERE n.scheme_code = btrim(s.e->>'schemeCode') AND n.scheme_category IS NOT NULL LIMIT 1
        ) n2 ON n1.scheme_category IS NULL
       WHERE f.tenant_id = ${scope.tenantId}::uuid AND f.aum > 0 AND ${clientWhere(scope, "i")}
         ${scope.amcs?.length ? sql`AND f.amc_name IN (${textList(scope.amcs)})` : sql``}
    ) x
     WHERE v > 0
     GROUP BY 1
  `)).rows as Array<{ cat: string | null; aum: unknown }>;
  const byClass = new Map<AssetClass, Map<string, number>>();
  let total = 0;
  let classified = 0;
  for (const r of rows) {
    const aum = num(r.aum);
    const c = classifyScheme(r.cat);
    total += aum;
    if (c.assetClass !== "Category not recorded") classified += aum;
    const m = byClass.get(c.assetClass) ?? new Map<string, number>();
    m.set(c.category, (m.get(c.category) ?? 0) + aum);
    byClass.set(c.assetClass, m);
  }
  const groups = ASSET_CLASSES.filter((k) => byClass.has(k)).map((assetClass) => {
    const cats = [...byClass.get(assetClass)!.entries()].map(([name, aum]) => ({ name, aum })).sort((a, b) => b.aum - a.aum);
    const head = cats.slice(0, perClass);
    const rest = cats.slice(perClass);
    if (rest.length) head.push({ name: `${rest.length} more`, aum: rest.reduce((a, c) => a + c.aum, 0) });
    return { assetClass, aum: cats.reduce((a, c) => a + c.aum, 0), categories: head };
  });
  return { groups, total, classifiedPct: total > 0 ? (classified / total) * 100 : 0 };
}

/* ─────────────────────────── client concentration ─────────────────────────── */

export type Concentration = { clients: number; points: Array<{ clientsPct: number; aumPct: number }> };

const CUTS = [1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * Clients holding money, largest first: the share of AUM held by the top 1%,
 * 2%, 5%, 10% … of them. Null under ten clients — a curve of a handful of
 * people says nothing.
 */
export async function getClientConcentration(tx: Tx, scope: MetricScope): Promise<Concentration | null> {
  const amount = scope.amcs?.length
    ? sql`(SELECT COALESCE(SUM(f.aum), 0) FROM folios f WHERE f.tenant_id = ${scope.tenantId}::uuid AND f.investor_id = i.id AND f.amc_name IN (${textList(scope.amcs)}))`
    : sql`COALESCE(i.aum, 0)`;
  const rows = (await tx.execute(sql`
    WITH c AS (
      SELECT ${amount}::numeric AS a FROM investors i WHERE ${clientWhere(scope, "i")}
    ), r AS (
      SELECT row_number() OVER (ORDER BY a DESC) AS rn, COUNT(*) OVER () AS n, SUM(a) OVER () AS tot,
             SUM(a) OVER (ORDER BY a DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
        FROM c WHERE a > 0
    )
    SELECT p.pct, r.n, (r.cum / NULLIF(r.tot, 0) * 100)::numeric AS share
      FROM unnest(ARRAY[${sql.join(CUTS.map((c) => sql`${c}`), sql`, `)}]::int[]) AS p(pct)
      JOIN r ON r.rn = GREATEST(1, ceil(r.n * p.pct / 100.0))::int
     ORDER BY p.pct
  `)).rows as Array<{ pct: unknown; n: unknown; share: unknown }>;
  const n = rows.length ? num(rows[0].n) : 0;
  if (n < 10) return null;
  return { clients: n, points: [{ clientsPct: 0, aumPct: 0 }, ...rows.map((r) => ({ clientsPct: num(r.pct), aumPct: num(r.share) }))] };
}

/* ─────────────────────────── SIP retention by start ─────────────────────────── */

export type SipCohort = { month: string; started: number; active: number };

/**
 * SIPs that started in each of the last `months` whole months, and how many
 * are still active today. The registrar's stop date is not kept, so this is
 * "still running today", not a month-by-month survival curve.
 */
export async function getSipRetentionByStart(tx: Tx, scope: MetricScope, months = 12): Promise<SipCohort[]> {
  const rows = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', s.start_date), 'YYYY-MM') AS m,
           COUNT(*)::int AS started, COUNT(*) FILTER (WHERE s.status = 'active')::int AS active
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}
       AND s.status <> 'rejected'
       AND s.start_date >= (date_trunc('month', current_date) - make_interval(months => ${months}::int))::date
       AND s.start_date < date_trunc('month', current_date)::date
       ${scope.amcs?.length ? sql`AND s.amc_name IN (${textList(scope.amcs)})` : sql``}
     GROUP BY 1 ORDER BY 1
  `)).rows as Array<{ m: string; started: unknown; active: unknown }>;
  return rows.map((r) => ({ month: r.m, started: num(r.started), active: num(r.active) }));
}

/* ─────────────────────────────── age bands ─────────────────────────────── */

export const AGE_BANDS = [
  { key: "u18", label: "Under 18", lo: 0, hi: 17 },
  { key: "18", label: "18–24", lo: 18, hi: 24 },
  { key: "25", label: "25–34", lo: 25, hi: 34 },
  { key: "35", label: "35–44", lo: 35, hi: 44 },
  { key: "45", label: "45–54", lo: 45, hi: 54 },
  { key: "55", label: "55–64", lo: 55, hi: 64 },
  { key: "65", label: "65 and over", lo: 65, hi: 200 },
] as const;

export type AgeBand = { key: string; label: string; clients: number; aum: number; gap?: boolean };

/**
 * Live clients who have a date of birth to record (a person or a minor —
 * an HUF or a company has none) by age today, with their AUM. Those with no
 * date recorded are their own band: a record gap, not an age.
 */
export async function getAgeBands(tx: Tx, scope: MetricScope): Promise<AgeBand[]> {
  const rows = (await tx.execute(sql`
    SELECT CASE WHEN i.dob IS NULL THEN NULL
                ELSE date_part('year', age((now() AT TIME ZONE 'Asia/Kolkata')::date, i.dob))::int END AS age,
           COUNT(*)::int AS n, COALESCE(SUM(i.aum), 0)::numeric AS aum
      FROM investors i
     WHERE ${clientWhere(scope, "i")}
       AND COALESCE(i.investor_category, 'individual') IN (${textList([...DOB_TYPES])})
     GROUP BY 1
  `)).rows as Array<{ age: number | null; n: unknown; aum: unknown }>;
  const out: AgeBand[] = AGE_BANDS.map((b) => ({ key: b.key, label: b.label, clients: 0, aum: 0 }));
  const gap: AgeBand = { key: "none", label: "No date of birth", clients: 0, aum: 0, gap: true };
  for (const r of rows) {
    const band = r.age == null ? null : AGE_BANDS.findIndex((b) => r.age! >= b.lo && r.age! <= b.hi);
    const target = band == null || band < 0 ? gap : out[band];
    target.clients += num(r.n);
    target.aum += num(r.aum);
  }
  return [...out, gap];
}

/* ─────────────────────────────── geography ─────────────────────────────── */

export type ClientGeography = {
  states: Array<{ state: string; shapes: string[]; clients: number; aum: number }>;
  cities: Array<{ key: string; name: string; clients: number; aum: number; lat?: number; lon?: number }>;
  /** No state we can place (and no known city to infer it from). */
  unplaced: { clients: number; aum: number };
  noCity: { clients: number; aum: number };
  clients: number;
};

/**
 * Live clients and their AUM by the state and city on their address. A blank
 * state is filled from a known city ("Mumbai" → Maharashtra); spellings fold
 * through lib/geo (Bombay → Mumbai, "maharashtra" → Maharashtra).
 */
export async function getClientGeography(tx: Tx, scope: MetricScope): Promise<ClientGeography> {
  const rows = (await tx.execute(sql`
    SELECT lower(btrim(COALESCE(i.address->>'state', ''))) AS st,
           lower(btrim(COALESCE(i.address->>'city', ''))) AS ci,
           COUNT(*)::int AS n, COALESCE(SUM(i.aum), 0)::numeric AS aum
      FROM investors i
     WHERE ${clientWhere(scope, "i")} AND jsonb_typeof(COALESCE(i.address, '{}'::jsonb)) = 'object'
     GROUP BY 1, 2
    UNION ALL
    SELECT '', '', COUNT(*)::int, COALESCE(SUM(i.aum), 0)::numeric
      FROM investors i
     WHERE ${clientWhere(scope, "i")} AND jsonb_typeof(COALESCE(i.address, '{}'::jsonb)) <> 'object'
  `)).rows as Array<{ st: string; ci: string; n: unknown; aum: unknown }>;
  const states = new Map<string, { clients: number; aum: number }>();
  const cities = new Map<string, { clients: number; aum: number }>();
  const unplaced = { clients: 0, aum: 0 };
  const noCity = { clients: 0, aum: 0 };
  let clients = 0;
  for (const r of rows) {
    const n = num(r.n);
    const aum = num(r.aum);
    if (!n) continue;
    clients += n;
    const ck = cityKey(r.ci);
    const st = stateKey(r.st) ?? knownCity(ck)?.state ?? null;
    if (st) {
      const s = states.get(st) ?? { clients: 0, aum: 0 };
      s.clients += n; s.aum += aum;
      states.set(st, s);
    } else {
      unplaced.clients += n; unplaced.aum += aum;
    }
    if (ck) {
      const c = cities.get(ck) ?? { clients: 0, aum: 0 };
      c.clients += n; c.aum += aum;
      cities.set(ck, c);
    } else {
      noCity.clients += n; noCity.aum += aum;
    }
  }
  return {
    states: [...states.entries()].map(([state, v]) => ({ state, shapes: mapShapesForState(state), ...v })).sort((a, b) => b.clients - a.clients),
    cities: [...cities.entries()]
      .map(([key, v]) => {
        const k = knownCity(key);
        return { key, name: cityLabel(key), ...v, ...(k ? { lat: k.lat, lon: k.lon } : {}) };
      })
      .sort((a, b) => b.clients - a.clients)
      .slice(0, 80),
    unplaced,
    noCity,
    clients,
  };
}
