/**
 * Portfolio Intelligence — firm- / book-level analytics over the folio book.
 *
 * Sanchay's "Portfolio Details" is a stub (one record); an MFD lives on this.
 * We aggregate the real folio holdings into: asset-class allocation, AMC
 * concentration, top schemes, and concentration-risk warnings — the analytics
 * a generic CRM can't produce because it has no transactions/holdings.
 *
 * AMC + total come from folios.aum (always present); asset-class + top schemes
 * come from the folio `schemes` jsonb (scheme-level value), degrading
 * gracefully when scheme detail is sparse.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type Slice = { label: string; value: number; pct: number };
export type PortfolioIntel = {
  totalAum: number;
  folioCount: number;
  investorCount: number;
  byClass: Slice[];
  byAmc: Slice[];
  topSchemes: Array<{ scheme: string; amc: string | null; klass: string; value: number; pct: number }>;
  warnings: Array<{ level: "high" | "medium"; text: string }>;
};

// `category` lives inside each `folios.schemes` jsonb element (shape:
// { schemeCode, schemeName, category?, units?, nav?, value? }), NOT as a
// table column — so it must be read as `s->>'category'`. Both call sites
// below have `jsonb_array_elements(f.schemes) s` in scope. A missing key
// yields NULL → falls through to 'Other'.
const CAT = `(s->>'category')`;
const CLASS_CASE = `CASE
  WHEN ${CAT} ILIKE '%equity%' OR ${CAT} ILIKE '%elss%' OR ${CAT} ILIKE '%large%' OR ${CAT} ILIKE '%mid%' OR ${CAT} ILIKE '%small%' OR ${CAT} ILIKE '%flexi%' OR ${CAT} ILIKE '%focus%' OR ${CAT} ILIKE '%value%' OR ${CAT} ILIKE '%contra%' OR ${CAT} ILIKE '%index%' OR ${CAT} ILIKE '%multi%cap%' THEN 'Equity'
  WHEN ${CAT} ILIKE '%debt%' OR ${CAT} ILIKE '%bond%' OR ${CAT} ILIKE '%gilt%' OR ${CAT} ILIKE '%duration%' OR ${CAT} ILIKE '%income%' OR ${CAT} ILIKE '%credit%' OR ${CAT} ILIKE '%psu%' THEN 'Debt'
  WHEN ${CAT} ILIKE '%hybrid%' OR ${CAT} ILIKE '%balanced%' OR ${CAT} ILIKE '%advantage%' OR ${CAT} ILIKE '%multi%asset%' OR ${CAT} ILIKE '%arbitrage%' THEN 'Hybrid'
  WHEN ${CAT} ILIKE '%liquid%' OR ${CAT} ILIKE '%overnight%' OR ${CAT} ILIKE '%money%' OR ${CAT} ILIKE '%ultra%' THEN 'Liquid'
  WHEN ${CAT} ILIKE '%gold%' OR ${CAT} ILIKE '%silver%' OR ${CAT} ILIKE '%commodit%' THEN 'Commodity'
  WHEN ${CAT} ILIKE '%internat%' OR ${CAT} ILIKE '%global%' OR ${CAT} ILIKE '%us %' OR ${CAT} ILIKE '%overseas%' THEN 'International'
  ELSE 'Other'
END`;

export async function getPortfolioIntel(
  tx: Tx,
  opts: { tenantId: string; userId: string; firmWide: boolean }
): Promise<PortfolioIntel> {
  const scope = opts.firmWide ? sql`` : sql` AND i.rm_id = ${opts.userId}::uuid`;

  // Totals + AMC concentration from folio-level AUM.
  const totals = (await tx.execute(sql`
    SELECT COALESCE(SUM(f.aum::numeric),0)::numeric AS total,
           COUNT(*)::int AS folios,
           COUNT(DISTINCT f.investor_id)::int AS investors
    FROM folios f JOIN investors i ON i.id = f.investor_id
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
  `)).rows[0] as any;
  const totalAum = Number(totals?.total ?? 0);

  const amc = (await tx.execute(sql`
    SELECT f.amc_name AS label, COALESCE(SUM(f.aum::numeric),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
    GROUP BY f.amc_name ORDER BY value DESC LIMIT 12
  `)).rows as any[];

  // Asset class + top schemes from the scheme-level jsonb.
  const klass = (await tx.execute(sql`
    SELECT ${sql.raw(CLASS_CASE)} AS label, COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
    GROUP BY 1 ORDER BY value DESC
  `)).rows as any[];

  const top = (await tx.execute(sql`
    SELECT s->>'schemeName' AS scheme, f.amc_name AS amc, ${sql.raw(CLASS_CASE)} AS klass,
           COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
    WHERE f.tenant_id = ${opts.tenantId}::uuid AND (s->>'value') IS NOT NULL ${scope}
    GROUP BY s->>'schemeName', f.amc_name, 3 ORDER BY value DESC LIMIT 10
  `)).rows as any[];

  const pct = (v: number, base: number) => (base > 0 ? Math.round((v / base) * 1000) / 10 : 0);
  const classBase = klass.reduce((a, r) => a + Number(r.value || 0), 0);
  const schemeBase = top.reduce((a, r) => a + Number(r.value || 0), 0) || classBase;

  const byClass: Slice[] = klass.filter((r) => Number(r.value) > 0).map((r) => ({ label: r.label, value: Number(r.value), pct: pct(Number(r.value), classBase) }));
  const byAmc: Slice[] = amc.filter((r) => Number(r.value) > 0).map((r) => ({ label: r.label ?? "Unknown", value: Number(r.value), pct: pct(Number(r.value), totalAum) }));
  const topSchemes = top.filter((r) => Number(r.value) > 0).map((r) => ({ scheme: r.scheme ?? "—", amc: r.amc, klass: r.klass, value: Number(r.value), pct: pct(Number(r.value), schemeBase) }));

  // Concentration-risk warnings — the "intelligence" layer.
  const warnings: PortfolioIntel["warnings"] = [];
  const topAmc = byAmc[0];
  if (topAmc && topAmc.pct >= 30) warnings.push({ level: "high", text: `${topAmc.label} is ${topAmc.pct}% of the book — single-AMC concentration risk.` });
  else if (topAmc && topAmc.pct >= 20) warnings.push({ level: "medium", text: `${topAmc.label} is ${topAmc.pct}% of the book — watch AMC concentration.` });
  const equity = byClass.find((c) => c.label === "Equity");
  if (equity && equity.pct >= 85) warnings.push({ level: "high", text: `Equity is ${equity.pct}% of assets — heavy market-risk skew across the book.` });
  const liquidDebt = byClass.filter((c) => c.label === "Liquid" || c.label === "Debt").reduce((a, c) => a + c.pct, 0);
  if (classBase > 0 && liquidDebt < 5) warnings.push({ level: "medium", text: `Only ${liquidDebt.toFixed(1)}% in debt/liquid — limited downside cushion firm-wide.` });
  if (topSchemes[0] && topSchemes[0].pct >= 15) warnings.push({ level: "medium", text: `${topSchemes[0].scheme} alone is ${topSchemes[0].pct}% of measured holdings.` });

  return { totalAum, folioCount: Number(totals?.folios ?? 0), investorCount: Number(totals?.investors ?? 0), byClass, byAmc, topSchemes, warnings };
}
