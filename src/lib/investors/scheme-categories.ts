/**
 * Fill in the asset class of holdings that arrived without one. SERVER-ONLY.
 *
 * Equity exposure (lib/investors/asset-class) is worked out from each folio
 * leg's stored `category`. Many legs have none — an RTA file need not carry
 * it, and the registrar's product code does not say — so they counted as
 * "unclassified". Once three quarters of a book is unclassified the suitability
 * check gives up ("unknown"), and the suitability email printed an equity share
 * worked out from the small classified slice next to an empty scheme list.
 *
 * The AMFI master (`scheme_nav`, refreshed daily) carries the official
 * category for every scheme. A leg without a usable category takes it from
 * there, matched the way the nightly revaluation matches (lib/finance/
 * scheme-match.ts): scheme code, then ISIN, then the normalised name — and a
 * name two schemes share with DIFFERENT categories is left alone rather than
 * guessed.
 *
 * A registrar spells a scheme its own way ("WhiteOak Capital - Flexi Cap Fund -
 * Regular Plan Growth" for AMFI's "WhiteOak Capital Flexi Cap Fund - Regular Plan
 * - Growth"), so an exact code / ISIN / name match misses it. What is still
 * unplaced is then matched the way the valuation prices a holding — the NAV
 * resolver (lookupNav: plan-specific, refuses an ambiguous name) — and takes the
 * category of the AMFI scheme it lands on. A holding the valuation can price
 * therefore gets a category too. Nothing is guessed from the name's wording.
 *
 * Returns copies; the stored folios are not changed.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assetClassOf } from "@/lib/investors/asset-class";
import { loadNavIndex, lookupNav, normSchemeName } from "@/lib/finance/scheme-match";

type Leg = { schemeCode?: string | null; schemeName?: string | null; isin?: string | null; category?: string | null; [k: string]: unknown };
type FolioLike = { schemes?: Leg[] | null; [k: string]: unknown };

const needsCategory = (l: Leg) => assetClassOf(l.category ?? undefined) === "other";

export async function withSchemeCategories<F extends FolioLike>(tx: Tx, folios: F[]): Promise<F[]> {
  const legs = folios.flatMap((f) => (f.schemes ?? []).filter(needsCategory));
  if (!legs.length) return folios;

  const codes = [...new Set(legs.map((l) => String(l.schemeCode ?? "").trim()).filter(Boolean))];
  const isins = [...new Set(legs.map((l) => String(l.isin ?? "").trim().toUpperCase()).filter(Boolean))];
  const names = [...new Set(legs.map((l) => normSchemeName(l.schemeName)).filter(Boolean))];

  // Lists go in as JSON: drizzle expands a JS array into a tuple, which
  // cannot be cast to text[] (and an empty one is a syntax error).
  // Same normalisation as normSchemeName, in SQL: lower-case, every run of
  // non-alphanumerics to one space, trimmed.
  const res = await tx.execute(sql`
    SELECT scheme_code, upper(isin) AS isin, upper(isin_reinvest) AS isin_reinvest,
           btrim(regexp_replace(lower(scheme_name), '[^a-z0-9]+', ' ', 'g')) AS nname,
           COALESCE(NULLIF(scheme_category, ''), scheme_type) AS category
      FROM scheme_nav
     WHERE COALESCE(NULLIF(scheme_category, ''), scheme_type) IS NOT NULL
       AND (scheme_code IN (SELECT jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb))
            OR upper(isin) IN (SELECT jsonb_array_elements_text(${JSON.stringify(isins)}::jsonb))
            OR upper(isin_reinvest) IN (SELECT jsonb_array_elements_text(${JSON.stringify(isins)}::jsonb))
            OR btrim(regexp_replace(lower(scheme_name), '[^a-z0-9]+', ' ', 'g'))
               IN (SELECT jsonb_array_elements_text(${JSON.stringify(names)}::jsonb)))
  `);

  const byCode = new Map<string, string>();
  const byIsin = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const r of res.rows as any[]) {
    const cat = String(r.category);
    byCode.set(String(r.scheme_code), cat);
    if (r.isin) byIsin.set(String(r.isin), cat);
    if (r.isin_reinvest) byIsin.set(String(r.isin_reinvest), cat);
    const n = String(r.nname ?? "");
    if (!n) continue;
    // Two schemes sharing a name only matter when they disagree on the class.
    if (byName.has(n) && byName.get(n) !== null && assetClassOf(byName.get(n)!) !== assetClassOf(cat)) byName.set(n, null);
    else if (!byName.has(n)) byName.set(n, cat);
  }

  const resolve = (l: Leg): string | null =>
    byCode.get(String(l.schemeCode ?? "").trim()) ??
    byIsin.get(String(l.isin ?? "").trim().toUpperCase()) ??
    byName.get(normSchemeName(l.schemeName)) ??
    null;

  // What the exact lookups missed goes through the valuation's own matcher.
  const viaMatcher = new Map<Leg, string>();
  const unplaced = legs.filter((l) => !resolve(l));
  if (unplaced.length) {
    const index = await loadNavIndex(tx);
    const landed = new Map<Leg, string>();
    for (const l of unplaced) {
      const hit = lookupNav(index, String(l.schemeCode ?? "").trim() || null, l.schemeName, null, l.isin ?? null);
      if (hit) landed.set(l, hit.code);
    }
    if (landed.size) {
      const landedCodes = [...new Set(landed.values())];
      const cats = await tx.execute(sql`
        SELECT scheme_code, COALESCE(NULLIF(scheme_category, ''), scheme_type) AS category
          FROM scheme_nav
         WHERE COALESCE(NULLIF(scheme_category, ''), scheme_type) IS NOT NULL
           AND scheme_code IN (SELECT jsonb_array_elements_text(${JSON.stringify(landedCodes)}::jsonb))
      `);
      const byLanded = new Map((cats.rows as any[]).map((r) => [String(r.scheme_code), String(r.category)]));
      for (const [l, code] of landed) {
        const cat = byLanded.get(code);
        if (cat) viaMatcher.set(l, cat);
      }
    }
  }

  return folios.map((f) =>
    f.schemes?.some(needsCategory)
      ? {
          ...f,
          schemes: f.schemes.map((l) => {
            if (!needsCategory(l)) return l;
            const cat = resolve(l) ?? viaMatcher.get(l) ?? null;
            return cat ? { ...l, category: cat } : l;
          }),
        }
      : f
  );
}
