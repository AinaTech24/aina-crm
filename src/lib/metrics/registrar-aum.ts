/**
 * Registrar-wise AUM (Phase 3E) — what the registrars' own holdings
 * statements say, per registrar × ARN, each with its date, beside the CRM's
 * live-NAV figure (`getAUM`). One definition for the Owner Dashboard card,
 * the client list drill-down and any report that needs it.
 *
 * The figures come from the dated `source*` keys a holdings import stamps on
 * each folio leg (lib/rta/import.ts). Revaluation never touches them, so this
 * is the statement as printed — never recomputed, never mixed with today's
 * NAV. Presentation rules are lib/rta/aum-view.ts:
 *   - one card per registrar × ARN, with as-of date, age, stale flag,
 *     full-book flag, zero and unvalued positions, and coverage gaps;
 *   - a firm total only when every required scope is full-book, fresh,
 *     gap-free and fully valued — otherwise null, with every reason.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, type MetricScope } from "./scope";
import { scopeView, type HoldingStatement } from "@/lib/rta/holdings-snapshot";
import { firmAumHeadline, registrarAumCards, DEFAULT_STALE_DAYS, type FirmAumHeadline, type FolioEvidence, type RegistrarAumCard } from "@/lib/rta/aum-view";

/**
 * Reports that are the FULL book of their ARN at their registrar. Only
 * MFSD203 is evidenced (2026-10-08: 1,792 folios incl. 329 zero positions,
 * every KFintech folio seen elsewhere bar 2). A CAMS all-folio R9 / WBR22 has
 * not been seen; until it is, CAMS statements count as partial.
 */
export const FULL_BOOK_REPORTS = new Set(["MFSD203"]);

export const normArn = (a: string | null | undefined) => {
  const d = (a ?? "").toUpperCase().replace(/^ARN[-\s]*/, "").replace(/[^0-9A-Z]/g, "");
  return d ? `ARN-${d}` : "";
};

export type RegistrarAum = {
  cards: RegistrarAumCard[];
  headline: FirmAumHeadline;
  /** Legs still standing on an OLDER statement than their scope's latest full book (not restated by it). */
  legsOnOlderStatements: number;
  /** Legs with no dated statement at all (written before Phase 3E, or by a report with no date). */
  undatedLegs: number;
  filtered: boolean;
};

const isFiltered = (s: MetricScope) =>
  [s.rmIds, s.branchIds, s.segments, s.categories, s.familyIds, s.tags, s.amcs, s.leadSources].some((x) => !!x?.length);

export async function getRegistrarAum(tx: Tx, scope: MetricScope, opts: { asOf?: string; staleDays?: number } = {}): Promise<RegistrarAum> {
  const asOf = opts.asOf ?? new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const legs = (await tx.execute(sql`
    SELECT f.rta::text AS rta, f.amc_code, f.folio_number, leg->>'schemeCode' AS scheme_code,
           leg->>'sourceReport' AS report, leg->>'sourceAsOf' AS as_of, leg->>'sourceArn' AS arn,
           leg->>'sourceUnits' AS units, leg->>'sourceValue' AS value
      FROM folios f
      JOIN investors i ON i.id = f.investor_id AND i.tenant_id = f.tenant_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS leg
     WHERE f.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}
  `)).rows as Array<{ rta: string; amc_code: string | null; folio_number: string; scheme_code: string | null; report: string | null; as_of: string | null; arn: string | null; units: string | null; value: string | null }>;

  const num = (v: string | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const statements = new Map<string, HoldingStatement>();
  let undatedLegs = 0;
  for (const l of legs) {
    if (!l.as_of || (l.rta !== "cams" && l.rta !== "kfintech")) { undatedLegs++; continue; }
    const arn = normArn(l.arn) || "ARN-unknown";
    const report = l.report ?? "unknown";
    const id = `${l.rta}|${arn}|${report}|${l.as_of}`;
    let st = statements.get(id);
    if (!st) {
      st = { id, rta: l.rta, arn, asOf: l.as_of.slice(0, 10), fullBook: FULL_BOOK_REPORTS.has(report), positions: [] };
      statements.set(id, st);
    }
    st.positions.push({ amcCode: l.amc_code ?? "", folioNumber: l.folio_number, schemeCode: l.scheme_code ?? "", units: num(l.units) ?? 0, value: num(l.value) });
  }
  const scopes = scopeView([...statements.values()]);
  const counted = scopes.reduce((s, v) => s + v.positions.length, 0);
  const legsOnOlderStatements = [...statements.values()].reduce((s, st) => s + st.positions.length, 0) - counted;

  // Evidence: folios of each registrar that processed transactions say the
  // firm held, with the date of the folio's latest transaction.
  const evidence = (await tx.execute(sql`
    SELECT f.rta::text AS rta, f.amc_code, f.folio_number, max(t.order_date)::text AS seen_on
      FROM folios f
      JOIN investors i ON i.id = f.investor_id AND i.tenant_id = f.tenant_id
      JOIN transactions t ON t.folio_id = f.id AND t.tenant_id = f.tenant_id AND t.status IN ('processed', 'successful')
     WHERE f.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}
     GROUP BY 1, 2, 3
  `)).rows as Array<{ rta: string; amc_code: string | null; folio_number: string; seen_on: string }>;
  const ev: FolioEvidence[] = evidence.map((e) => ({ rta: e.rta, amcCode: e.amc_code ?? "", folioNumber: e.folio_number, seenOn: e.seen_on, source: "transactions" }));

  const cards = registrarAumCards(scopes, ev, asOf, opts.staleDays ?? DEFAULT_STALE_DAYS);

  // Required: every registrar the firm holds folios with, under the firm's ARN.
  const t = (await tx.execute(sql`SELECT arn FROM tenants WHERE id = ${scope.tenantId}::uuid`)).rows[0] as { arn: string | null } | undefined;
  const rtas = (await tx.execute(sql`
    SELECT DISTINCT f.rta::text AS rta FROM folios f WHERE f.tenant_id = ${scope.tenantId}::uuid AND f.rta::text IN ('cams', 'kfintech')
  `)).rows as Array<{ rta: string }>;
  const firmArns = t?.arn ? [normArn(t.arn)] : [...new Set(cards.map((c) => c.arn))];
  const required = rtas.flatMap((r) => firmArns.map((arn) => ({ rta: r.rta, arn })));
  const headline = firmAumHeadline(cards, required);
  const filtered = isFiltered(scope);
  if (filtered) headline.reasons.unshift("a filtered view is part of the book, so it cannot stand for a registrar's full-book statement");
  if (filtered) headline.value = null;
  return { cards, headline, legsOnOlderStatements, undatedLegs, filtered };
}
