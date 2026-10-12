/**
 * What the live AUM figure is made of (pilot preflight, 2026-10-09).
 *
 * `getAUM` adds every holding's current value. Not every value is today's
 * NAV: a holding whose scheme is not mapped to an AMFI scheme (every CAMS code
 * until it is approved) keeps the registrar's stated value from its statement
 * date, and a holding whose AMFI NAV is old is valued at that old NAV. A tile
 * that prints the sum as "units × today's NAV" misrepresents both. This splits
 * the same holdings three ways so every screen can say what it is showing:
 *
 *   live       valued at a current AMFI NAV of its mapped scheme (within
 *              NAV_MAX_AGE_DAYS) — dated by that NAV's own date, which is
 *              the last business day AMFI published, never "today"
 *   registrar  carried at the registrar's stated value (unmapped / held scheme,
 *              or never re-priced) — with the statement dates
 *   stale      valued at an AMFI NAV older than NAV_MAX_AGE_DAYS, or at a NAV
 *              that no longer matches the scheme's
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { navCutoffIso } from "@/lib/finance/nav-age";
import { clientWhere, type MetricScope } from "./scope";

export type AumPart = { value: number; holdings: number; oldest: string | null; newest: string | null };
export type AumComposition = {
  total: number;
  live: AumPart;
  registrar: AumPart;
  stale: AumPart;
  /** True only when every holding with a value is at a current AMFI NAV. */
  allLive: boolean;
};

const NUM = "^-?[0-9]+(\\.[0-9]+)?$";

export async function getAumComposition(tx: Tx, scope: MetricScope): Promise<AumComposition> {
  const cutoff = navCutoffIso();
  const rows = (await tx.execute(sql`
    WITH legs AS (
      SELECT leg FROM folios f JOIN investors i ON i.id = f.investor_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS leg
       WHERE f.tenant_id = ${scope.tenantId}::uuid AND ${clientWhere(scope, "i")}),
    c AS (
      SELECT CASE WHEN leg->>'value' ~ ${NUM} THEN (leg->>'value')::numeric ELSE 0 END AS v,
             CASE
               WHEN leg ? 'schemeStatus' AND leg->>'schemeStatus' NOT IN ('resolved_isin', 'confirmed') THEN 'registrar'
               WHEN n.scheme_code IS NOT NULL AND leg->>'nav' ~ ${NUM} AND (leg->>'nav')::numeric = n.nav AND n.nav_date >= ${cutoff}::date THEN 'live'
               WHEN leg ? 'sourceValue' AND leg->>'value' = leg->>'sourceValue' THEN 'registrar'
               ELSE 'stale'
             END AS kind,
             leg->>'sourceAsOf' AS source_as_of, n.nav_date::text AS nav_date
        FROM legs LEFT JOIN scheme_nav n ON n.scheme_code = leg->>'schemeCode'),
    d AS (
      SELECT v, kind, CASE kind WHEN 'live' THEN nav_date WHEN 'registrar' THEN source_as_of ELSE COALESCE(nav_date, source_as_of) END AS dated FROM c)
    SELECT kind, count(*)::int AS n, COALESCE(sum(v), 0)::float8 AS v, min(dated) AS oldest, max(dated) AS newest
      FROM d WHERE v <> 0 GROUP BY kind`)).rows as Array<{ kind: "live" | "registrar" | "stale"; n: number; v: number; oldest: string | null; newest: string | null }>;
  const part = (k: string): AumPart => {
    const r = rows.find((x) => x.kind === k);
    return { value: Math.round((r?.v ?? 0) * 100) / 100, holdings: r?.n ?? 0, oldest: r?.oldest ?? null, newest: r?.newest ?? null };
  };
  const live = part("live"), registrar = part("registrar"), stale = part("stale");
  return { total: Math.round((live.value + registrar.value + stale.value) * 100) / 100, live, registrar, stale, allLive: registrar.holdings === 0 && stale.holdings === 0 };
}

const spanOf = (p: AumPart, date: (d: string) => string) =>
  (p.oldest && p.newest && p.oldest !== p.newest ? `${date(p.oldest)}–${date(p.newest)}` : p.newest ? date(p.newest) : "undated");

/**
 * The tile's "as of" label. A valuation is labelled by the NAV dates it uses —
 * an AMFI NAV is published for a business day the evening after, so the
 * latest one is yesterday's (or Friday's) and a figure built on it is never
 * "Today". Mixed sources (registrar statement values, older NAVs) say so.
 */
export function aumValuationLabel(c: AumComposition, date: (d: string) => string): string {
  if (!c.live.holdings && !c.registrar.holdings && !c.stale.holdings) return "No holdings";
  if (!c.allLive) return "Mixed dates";
  return `NAV of ${spanOf(c.live, date)}`;
}

/** One honest line for a tile: what part is at a current AMFI NAV (with its date) and what is not. Null when everything is at a current NAV. */
export function aumCompositionNote(c: AumComposition, money: (n: number) => string, date: (d: string) => string): string | null {
  if (c.allLive) return null;
  const span = (p: AumPart) => spanOf(p, date);
  const parts = [`${money(c.live.value)} at AMFI NAV of ${c.live.holdings ? span(c.live) : "—"}`];
  if (c.registrar.holdings) parts.push(`${money(c.registrar.value)} at registrar statement value (${span(c.registrar)}; scheme not mapped or not re-priced)`);
  if (c.stale.holdings) parts.push(`${money(c.stale.value)} at an older NAV (${span(c.stale)})`);
  return parts.join(" · ");
}
