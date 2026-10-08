/**
 * Registrar scheme codes → the CRM Scheme Master (Phase 3H).
 *
 * The CRM has ONE scheme reference: the AMFI scheme code — the key of
 * scheme_nav (the daily AMFI feed, with the scheme's name, AMC, ISINs, NAV) and
 * the scheme_code of each firm's scheme_master. Registrar files name a scheme
 * their own way (CAMS amc_code + product code; KFintech Fund + Product Code).
 * scheme_rta_codes (migration 0238) records, per firm, which AMFI scheme a
 * registrar code IS, and the evidence:
 *
 *   resolved_isin  the registrar printed exactly one ISIN for the code across
 *                  every staged row, and exactly one AMFI scheme carries it
 *                  (growth/payout or reinvestment ISIN). An ISIN is specific
 *                  to AMC, plan (direct/regular) and option (growth/IDCW), so
 *                  the match distinguishes all three without reading a name.
 *   confirmed      a person chose the AMFI scheme (audited); used where the
 *                  registrar prints no ISIN — every CAMS core report. Checked
 *                  against ISIN evidence whenever some appears.
 *   unresolved     no evidence yet.
 *   conflict       two ISINs for one code, one ISIN on two AMFI schemes, or a
 *                  confirmation the ISIN contradicts.
 *
 * NEVER by name. 31 of the 227 KFintech codes in the real files print a
 * different scheme description in different files, and KFintech's "Plan"
 * column is a registrar code (gp, rg, ig, dp …), not direct/regular.
 *
 * Posting: with the scheme gate on (always under RTA_POSTING_MODE=controlled;
 * RTA_SCHEME_GATE=on in development) a transaction whose scheme is not
 * resolved_isin / confirmed is HELD before it is written — scheme_unresolved /
 * scheme_conflict, one exception per registrar code on the Held screen — and
 * re-evaluated when the code is confirmed or new evidence resolves it.
 * Resolved transactions are written with the canonical scheme_code, AMFI's
 * scheme and AMC names, and the registrar's code in rta_scheme_code.
 */
import { sql } from "drizzle-orm";
import { NAV_MAX_AGE_DAYS, navCutoffIso } from "@/lib/finance/nav-age";

/** AMFI's NAV for a scheme is current when dated within the window of the latest applied file's business date (no file applied → not judged). */
function navIsCurrent(navDate: string | null | undefined, feedDate: string | null | undefined): boolean {
  if (!feedDate) return true;
  if (!navDate) return false;
  return navDate >= new Date(Date.parse(`${feedDate}T00:00:00Z`) - NAV_MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
}
import { amcKey, decideScheme, isResolved, markerContradiction, markersOf, amfiMarkers, amfiCore, nameRank,
  type AmfiMatch, type GlobalMapping, type ReasonCode, type SchemeDecision, type SchemeStatus } from "./scheme-evidence";

export { decideScheme, isResolved, REASON_GROUP } from "./scheme-evidence";
export type { AmfiMatch, ReasonCode, SchemeDecision, SchemeStatus } from "./scheme-evidence";

type Tx = any;

export type SchemeKey = { rta: string; amcCode: string; schemeCode: string };

/** Is a scheme-dependent posting allowed only for a resolved scheme? */
export function schemeGateOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.RTA_POSTING_MODE ?? "") === "controlled" || (env.RTA_SCHEME_GATE ?? "").trim().toLowerCase() === "on";
}

const keyOf = (k: SchemeKey) => `${k.rta}|${k.amcCode}|${k.schemeCode}`;
/** A JS string array as ONE text[] parameter (a bare array would expand into a list). */
const textArray = (values: string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))::text[]`;

/**
 * Record every registrar scheme code a staged batch mentions (with any ISIN
 * the registrar printed and its description, for the person who confirms),
 * then re-decide those codes. Called after staging, before posting.
 */
export async function observeSchemeCodes(tx: Tx, tenantId: string, batchId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT b.rta, r.amc_code, r.scheme_code,
           array_remove(array_agg(DISTINCT upper(btrim(r.isin))), NULL) AS isins,
           max(COALESCE(r.attrs->>'schemeName', r.attrs->>'fundDescription')) AS name,
           b.report_code
      FROM rta_staging_rows r
      JOIN rta_staging_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
     WHERE r.tenant_id = ${tenantId}::uuid AND r.batch_id = ${batchId}::uuid
       AND r.amc_code IS NOT NULL AND r.scheme_code IS NOT NULL AND b.rta IN ('cams', 'kfintech')
     GROUP BY b.rta, r.amc_code, r.scheme_code, b.report_code`)).rows as Array<{ rta: string; amc_code: string; scheme_code: string; isins: string[] | null; name: string | null; report_code: string | null }>;
  for (const r of rows) {
    const isins = (r.isins ?? []).filter((i) => i && i.length >= 12);
    await tx.execute(sql`
      INSERT INTO scheme_rta_codes (tenant_id, rta, rta_amc_code, rta_scheme_code, observed_isins, observed_name, source_reports)
      VALUES (${tenantId}::uuid, ${r.rta}, ${r.amc_code}, ${r.scheme_code}, ${textArray(isins)}, ${r.name}, ${textArray(r.report_code ? [r.report_code] : [])})
      ON CONFLICT (tenant_id, rta, rta_amc_code, rta_scheme_code) DO UPDATE SET
        observed_isins = ARRAY(SELECT DISTINCT x FROM unnest(scheme_rta_codes.observed_isins || EXCLUDED.observed_isins) x ORDER BY x),
        observed_name = COALESCE(EXCLUDED.observed_name, scheme_rta_codes.observed_name),
        source_reports = ARRAY(SELECT DISTINCT x FROM unnest(scheme_rta_codes.source_reports || EXCLUDED.source_reports) x ORDER BY x),
        last_seen_at = now(), updated_at = now()`);
  }
  await redecideSchemeCodes(tx, tenantId, rows.map((r) => ({ rta: r.rta, amcCode: r.amc_code, schemeCode: r.scheme_code })));
  return rows.length;
}

/** A registrar AMC: (rta, amc code). */
const amcOf = (k: { rta: string; amcCode: string }) => `${k.rta}|${k.amcCode}`;

type CodeRow = {
  id: string; rta: string; rta_amc_code: string; rta_scheme_code: string; observed_isins: string[] | null; observed_name: string | null;
  status: string; amfi_scheme_code: string | null; confirmed: boolean; status_reason: string | null; reason_code: string | null;
};
type NavFacts = { code: string; amc: string | null; name: string | null; plan: string | null; option: string | null; currentNav: boolean };

/**
 * Everything decideScheme needs about a firm's codes under some registrar
 * AMCs, read once: the codes, every AMFI scheme carrying their ISINs (both
 * columns, active or not), the unpriced ISINs of the latest AMFI feed, the
 * platform mappings, and the details of every AMFI scheme any of those name.
 */
async function loadDecisionContext(tx: Tx, tenantId: string, amcs: Array<{ rta: string; amcCode: string }> | null) {
  const amcFilter = amcs === null ? sql``
    : amcs.length ? sql`AND (c.rta, c.rta_amc_code) IN (${sql.join(amcs.map((k) => sql`(${k.rta}, ${k.amcCode})`), sql`, `)})`
    : sql`AND false`;
  const codes = (await tx.execute(sql`
    SELECT c.id, c.rta, c.rta_amc_code, c.rta_scheme_code, c.observed_isins, c.observed_name, c.status, c.amfi_scheme_code,
           c.confirmed_by IS NOT NULL AS confirmed, c.status_reason, c.reason_code
      FROM scheme_rta_codes c WHERE c.tenant_id = ${tenantId}::uuid ${amcFilter}`)).rows as CodeRow[];
  const gFilter = amcs === null ? sql`` : amcs.length ? sql`AND (g.rta, g.rta_amc_code) IN (${sql.join(amcs.map((k) => sql`(${k.rta}, ${k.amcCode})`), sql`, `)})` : sql`AND false`;
  const globals = (await tx.execute(sql`
    SELECT g.id, g.rta, g.rta_amc_code, g.rta_scheme_code, g.amfi_scheme_code, g.basis, g.evidence_isin
      FROM scheme_registrar_map g WHERE g.status <> 'revoked' ${gFilter}`)).rows as Array<{ id: string; rta: string; rta_amc_code: string; rta_scheme_code: string; amfi_scheme_code: string; basis: GlobalMapping["basis"]; evidence_isin: string | null }>;
  const latest = (await tx.execute(sql`
    SELECT id, feed_date::text AS feed_date FROM amfi_feed_imports WHERE status = 'applied' ORDER BY feed_date DESC NULLS LAST, imported_at DESC LIMIT 1`)).rows[0] as { id: string; feed_date: string } | undefined;
  // Current = AMFI's own NAV date is within the window of the file's business
  // date. Absence from one file is never inactivity (Phase 3I, real file).
  const activeSql = latest ? sql`(n.nav_date >= ${latest.feed_date}::date - ${NAV_MAX_AGE_DAYS}::int)` : sql`true`;

  const isins = [...new Set(codes.flatMap((c) => (c.observed_isins ?? []).map((i) => i.toUpperCase())))];
  const amfiByIsin: Record<string, AmfiMatch[]> = {};
  if (isins.length) {
    const list = sql.join(isins.map((i) => sql`${i}`), sql`, `);
    const hits = (await tx.execute(sql`
      SELECT x.isin, x.col, n.scheme_code, n.amc_name, n.scheme_name, n.plan, n.option_name, ${activeSql} AS current_nav
        FROM scheme_nav n,
             LATERAL (VALUES (upper(n.isin_payout_growth), 'payout_growth'), (upper(n.isin_reinvest), 'reinvest'),
                             -- rows written before the eight-column layout was kept: isin is the payout / growth ISIN
                             (CASE WHEN n.isin_payout_growth IS NULL AND n.isin IS DISTINCT FROM n.isin_reinvest THEN upper(n.isin) END, 'payout_growth')) AS x(isin, col)
       WHERE x.isin IN (${list})`)).rows as Array<{ isin: string; col: AmfiMatch["column"]; scheme_code: string; amc_name: string | null; scheme_name: string | null; plan: string | null; option_name: string | null; current_nav: boolean }>;
    for (const h of hits) {
      const arr = (amfiByIsin[h.isin] ??= []);
      if (!arr.some((m) => m.code === h.scheme_code && m.column === h.col)) {
        arr.push({ code: h.scheme_code, column: h.col, amc: h.amc_name, name: h.scheme_name, plan: h.plan, option: h.option_name, currentNav: !!h.current_nav });
      }
    }
  }
  let unpricedIsins: string[] = [];
  if (latest && isins.length) {
    unpricedIsins = ((await tx.execute(sql`
      SELECT DISTINCT upper(v) AS isin FROM amfi_feed_imports f, jsonb_array_elements(f.unpriced) e,
             LATERAL (VALUES (e->>'isinPayoutGrowth'), (e->>'isinReinvest')) AS u(v)
       WHERE f.id = ${latest.id}::uuid AND v IS NOT NULL`)).rows as Array<{ isin: string }>).map((r) => r.isin).filter((i) => isins.includes(i));
  }
  const named = [...new Set([...codes.map((c) => c.amfi_scheme_code), ...globals.map((g) => g.amfi_scheme_code)].filter(Boolean) as string[])];
  const nav = new Map<string, NavFacts>();
  if (named.length) {
    for (const r of (await tx.execute(sql`
      SELECT n.scheme_code, n.amc_name, n.scheme_name, n.plan, n.option_name, ${activeSql} AS current_nav
        FROM scheme_nav n WHERE n.scheme_code IN (${sql.join(named.map((c) => sql`${c}`), sql`, `)})`)).rows as any[]) {
      nav.set(r.scheme_code, { code: r.scheme_code, amc: r.amc_name, name: r.scheme_name, plan: r.plan, option: r.option_name, currentNav: !!r.current_nav });
    }
  }
  const globalByKey = new Map(globals.map((g) => [keyOf({ rta: g.rta, amcCode: g.rta_amc_code, schemeCode: g.rta_scheme_code }), g]));
  return { codes, globals, globalByKey, amfiByIsin, unpricedIsins, nav, latestFeedDate: latest?.feed_date ?? null };
}
type DecisionContext = Awaited<ReturnType<typeof loadDecisionContext>>;

/**
 * The AMFI AMC each registrar code points to on its own evidence (one ISIN
 * on one AMFI scheme, a platform mapping, or a confirmation) — the input to
 * the AMC identity check of its siblings.
 */
function pointsTo(ctx: DecisionContext, c: CodeRow): string | null {
  const g = ctx.globalByKey.get(keyOf({ rta: c.rta, amcCode: c.rta_amc_code, schemeCode: c.rta_scheme_code }));
  if (g) return ctx.nav.get(g.amfi_scheme_code)?.amc ?? null;
  const isins = [...new Set((c.observed_isins ?? []).map((i) => i.toUpperCase()))];
  if (isins.length === 1) {
    const codes = [...new Set((ctx.amfiByIsin[isins[0]] ?? []).map((m) => m.code))];
    if (codes.length === 1) return ctx.amfiByIsin[isins[0]][0].amc;
  }
  if (c.confirmed && c.amfi_scheme_code) return ctx.nav.get(c.amfi_scheme_code)?.amc ?? null;
  return null;
}

/** The registrar AMC's identity as its OTHER codes (the firm's and the platform's) establish it. */
function siblingAmcs(ctx: DecisionContext, self: SchemeKey): string[] {
  const seen = new Map<string, string | null>();
  for (const c of ctx.codes) {
    if (c.rta !== self.rta || c.rta_amc_code !== self.amcCode || c.rta_scheme_code === self.schemeCode) continue;
    seen.set(c.rta_scheme_code, pointsTo(ctx, c));
  }
  for (const g of ctx.globals) {
    if (g.rta !== self.rta || g.rta_amc_code !== self.amcCode || g.rta_scheme_code === self.schemeCode) continue;
    seen.set(g.rta_scheme_code, ctx.nav.get(g.amfi_scheme_code)?.amc ?? null);
  }
  return [...new Set([...seen.values()].filter(Boolean) as string[])];
}

function decideFor(ctx: DecisionContext, c: CodeRow, override?: { confirmedCode: string } | null): SchemeDecision {
  const key = { rta: c.rta, amcCode: c.rta_amc_code, schemeCode: c.rta_scheme_code };
  const g = ctx.globalByKey.get(keyOf(key));
  const confirmedCode = override ? override.confirmedCode : c.confirmed ? c.amfi_scheme_code : null;
  const cn = confirmedCode ? ctx.nav.get(confirmedCode) : undefined;
  return decideScheme({
    observedIsins: c.observed_isins ?? [], amfiByIsin: ctx.amfiByIsin, observedText: c.observed_name,
    registrarAmc: siblingAmcs(ctx, key), unpricedIsins: ctx.unpricedIsins,
    global: g ? { amfiSchemeCode: g.amfi_scheme_code, basis: g.basis, evidenceIsin: g.evidence_isin, amc: ctx.nav.get(g.amfi_scheme_code)?.amc ?? null } : null,
    confirmed: confirmedCode ? { amfiSchemeCode: confirmedCode, existsInFeed: !!cn, amc: cn?.amc, name: cn?.name, plan: cn?.plan, option: cn?.option } : null,
  });
}

/**
 * A registrar code the firm's own file proved by ISIN — with every check
 * passed — becomes a platform mapping (basis isin, status verified) for every
 * firm: registrar codes are the registrar's. Never overwrites a live mapping.
 */
async function promoteVerified(tx: Tx, c: CodeRow, d: SchemeDecision): Promise<boolean> {
  if (d.reasonCode !== "isin_verified" && d.reasonCode !== "isin_verified_historical") return false;
  const ins = (await tx.execute(sql`
    INSERT INTO scheme_registrar_map (rta, rta_amc_code, rta_scheme_code, amfi_scheme_code, basis, evidence_isin, isin_column, status)
    VALUES (${c.rta}, ${c.rta_amc_code}, ${c.rta_scheme_code}, ${d.amfiSchemeCode}, 'isin', ${d.evidenceIsin}, ${d.isinColumn}, 'verified')
    ON CONFLICT (rta, rta_amc_code, rta_scheme_code) WHERE status <> 'revoked' DO NOTHING
    RETURNING id`)).rows[0] as { id: string } | undefined;
  if (!ins) return false;
  await tx.execute(sql`
    INSERT INTO scheme_registrar_map_events (map_id, action, after, reason)
    VALUES (${ins.id}::uuid, 'verify', ${JSON.stringify({ amfiSchemeCode: d.amfiSchemeCode, evidenceIsin: d.evidenceIsin, isinColumn: d.isinColumn })}::jsonb,
            'the registrar printed this ISIN for the code and it identifies one AMFI scheme')`);
  return true;
}

/**
 * Re-apply decideScheme to the firm's codes (all, or the ones given — with
 * their sibling codes under the same registrar AMC, whose identity checks
 * depend on each other) against the AMFI feed and the platform mappings as
 * they are now.
 */
export async function redecideSchemeCodes(tx: Tx, tenantId: string, keys?: SchemeKey[]): Promise<Record<SchemeStatus, number> & { promoted: number; legsRestamped: number; byReason: Partial<Record<ReasonCode, number>> }> {
  const amcs = keys ? [...new Map(keys.map((k) => [amcOf(k), { rta: k.rta, amcCode: k.amcCode }])).values()] : null;
  const ctx = await loadDecisionContext(tx, tenantId, amcs);
  const tally = { resolved_isin: 0, confirmed: 0, unresolved: 0, conflict: 0, promoted: 0, legsRestamped: 0, byReason: {} as Partial<Record<ReasonCode, number>> };
  for (const c of ctx.codes) {
    const d = decideFor(ctx, c);
    tally[d.status]++;
    tally.byReason[d.reasonCode] = (tally.byReason[d.reasonCode] ?? 0) + 1;
    // A confirmation is kept even when the code is in conflict, so the person sees what they chose.
    const amfi = d.amfiSchemeCode ?? (c.confirmed ? c.amfi_scheme_code : null);
    await tx.execute(sql`
      UPDATE scheme_rta_codes SET status = ${d.status}, status_reason = ${d.reason}, reason_code = ${d.reasonCode}, amfi_scheme_code = ${amfi},
             evidence_source = CASE WHEN ${d.reasonCode} IN ('isin_verified', 'isin_verified_historical', 'global_isin') THEN 'registrar_isin'
                                    WHEN ${d.reasonCode} = 'platform_approved' THEN 'platform_approval' ELSE evidence_source END,
             updated_at = now()
       WHERE id = ${c.id}::uuid AND (status IS DISTINCT FROM ${d.status} OR status_reason IS DISTINCT FROM ${d.reason}
             OR reason_code IS DISTINCT FROM ${d.reasonCode} OR amfi_scheme_code IS DISTINCT FROM ${amfi})`);
    if (await promoteVerified(tx, c, d)) tally.promoted++;
    const wasCode = isResolved(c.status) ? c.amfi_scheme_code : null;
    if (c.status !== d.status || wasCode !== d.amfiSchemeCode) {
      tally.legsRestamped += await restampLegs(tx, tenantId, c, d);
    }
  }
  return tally;
}

/**
 * Holdings legs carry the status their code had when the statement was
 * imported. When a code's decision changes (a person confirmed it, a platform
 * mapping was approved or revoked, the AMFI feed moved) the legs on that code
 * follow: a resolved leg takes the AMFI code; an unresolved one goes back to
 * its registrar code and the registrar's own stated value and NAV, so a value
 * priced under the old decision is never kept. The folio's AUM is re-summed.
 * Only legs the validate-first path stamped (schemeStatus present) are touched.
 */
async function restampLegs(tx: Tx, tenantId: string, c: CodeRow, d: SchemeDecision): Promise<number> {
  const resolved = isResolved(d.status) && d.amfiSchemeCode;
  const res = await tx.execute(sql`
    UPDATE folios f SET schemes = (
        SELECT jsonb_agg(CASE WHEN x.s->>'rtaSchemeCode' = ${c.rta_scheme_code} AND x.s ? 'schemeStatus'
                              THEN x.s || jsonb_build_object('schemeStatus', ${d.status}::text, 'schemeCode', ${resolved ? d.amfiSchemeCode : c.rta_scheme_code}::text)
                                   || CASE WHEN ${resolved ? "1" : "0"} = '0' AND x.s ? 'sourceValue'
                                           THEN jsonb_build_object('value', x.s->'sourceValue', 'nav', COALESCE(x.s->'sourceNav', x.s->'nav')) ELSE '{}'::jsonb END
                              ELSE x.s END ORDER BY x.o)
          FROM jsonb_array_elements(f.schemes) WITH ORDINALITY AS x(s, o)),
        updated_at = now()
     WHERE f.tenant_id = ${tenantId}::uuid AND f.rta = ${c.rta} AND f.amc_code = ${c.rta_amc_code}
       AND f.schemes @> ${JSON.stringify([{ rtaSchemeCode: c.rta_scheme_code }])}::jsonb
    RETURNING f.id`);
  const ids = (res.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length) {
    await tx.execute(sql`
      UPDATE folios f SET aum = COALESCE((SELECT round(sum(COALESCE((s->>'value')::numeric, 0)), 2) FROM jsonb_array_elements(f.schemes) s), 0)
       WHERE f.tenant_id = ${tenantId}::uuid AND f.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }
  return ids.length;
}

/**
 * Re-decide a registrar AMC's codes in EVERY firm that has them — after the
 * AMFI feed changed or a platform mapping was approved or revoked. System
 * context (cross-firm by design: registrar codes are the registrar's).
 */
export async function redecideEverywhere(systemTx: Tx, keys?: Array<{ rta: string; amcCode: string }>): Promise<{ firms: number; tenantIds: string[]; promoted: number }> {
  const filter = keys?.length ? sql`WHERE (rta, rta_amc_code) IN (${sql.join(keys.map((k) => sql`(${k.rta}, ${k.amcCode})`), sql`, `)})` : sql``;
  const firms = (await systemTx.execute(sql`SELECT DISTINCT tenant_id::text AS t FROM scheme_rta_codes ${filter}`)).rows as Array<{ t: string }>;
  let promoted = 0;
  for (const f of firms) {
    const r = await redecideSchemeCodes(systemTx, f.t, keys?.map((k) => ({ ...k, schemeCode: "" })));
    promoted += r.promoted;
  }
  return { firms: firms.length, tenantIds: firms.map((f) => f.t), promoted };
}

export type SchemeResolution = {
  status: SchemeStatus;
  reason: string;
  amfiSchemeCode: string | null;
  schemeName: string | null;
  amcName: string | null;
};

/** The current resolution of registrar codes, with AMFI's name and AMC for the resolved ones. */
export async function loadSchemeResolutions(tx: Tx, tenantId: string, keys: SchemeKey[]): Promise<Map<string, SchemeResolution>> {
  const out = new Map<string, SchemeResolution>();
  const uniq = [...new Map(keys.filter((k) => k.amcCode && k.schemeCode).map((k) => [keyOf(k), k])).values()];
  if (!uniq.length) return out;
  const rows = (await tx.execute(sql`
    SELECT c.rta, c.rta_amc_code, c.rta_scheme_code, c.status, c.status_reason, c.amfi_scheme_code, n.scheme_name, n.amc_name
      FROM scheme_rta_codes c
      LEFT JOIN scheme_nav n ON n.scheme_code = c.amfi_scheme_code
     WHERE c.tenant_id = ${tenantId}::uuid
       AND (c.rta, c.rta_amc_code, c.rta_scheme_code) IN (${sql.join(uniq.map((k) => sql`(${k.rta}, ${k.amcCode}, ${k.schemeCode})`), sql`, `)})`)).rows as any[];
  for (const r of rows) {
    out.set(keyOf({ rta: r.rta, amcCode: r.rta_amc_code, schemeCode: r.rta_scheme_code }), {
      status: r.status, reason: r.status_reason ?? "", amfiSchemeCode: isResolved(r.status) ? r.amfi_scheme_code : null,
      schemeName: isResolved(r.status) ? r.scheme_name : null, amcName: isResolved(r.status) ? r.amc_name : null,
    });
  }
  return out;
}

export async function schemeFor(tx: Tx, tenantId: string, k: SchemeKey): Promise<SchemeResolution> {
  const m = await loadSchemeResolutions(tx, tenantId, [k]);
  return m.get(keyOf(k)) ?? { status: "unresolved", reason: "the registrar code has not been observed in a staged file", amfiSchemeCode: null, schemeName: null, amcName: null };
}

export class SchemeMappingError extends Error {
  status = 409;
}

/** Where a person's confirmation comes from — recorded with the mapping. */
export const EVIDENCE_SOURCES = {
  amc_scheme_list: "The AMC's own scheme / plan list",
  registrar_statement: "A registrar statement or confirmation naming the scheme",
  account_statement: "The client's account statement (CAS) with the ISIN",
  amc_factsheet: "The AMC's factsheet or SID with the plan and option",
  other_document: "Another document (described in the note)",
} as const;
export type EvidenceSource = keyof typeof EVIDENCE_SOURCES;

async function lockCode(tx: Tx, tenantId: string, codeId: string): Promise<CodeRow> {
  const c = (await tx.execute(sql`
    SELECT id, rta, rta_amc_code, rta_scheme_code, observed_isins, observed_name, status, amfi_scheme_code, confirmed_by IS NOT NULL AS confirmed,
           status_reason, reason_code, rejected_candidates
      FROM scheme_rta_codes WHERE tenant_id = ${tenantId}::uuid AND id = ${codeId}::uuid FOR UPDATE`)).rows[0] as (CodeRow & { rejected_candidates: string[] }) | undefined;
  if (!c) throw Object.assign(new SchemeMappingError("registrar scheme code not found"), { status: 404 });
  return c;
}

async function audit(tx: Tx, tenantId: string, by: string, action: string, codeId: string, before: unknown, after: unknown, reason: string) {
  await tx.execute(sql`
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, reason)
    VALUES (${tenantId}::uuid, ${by}::uuid, 'user', ${action}, 'scheme_rta_code', ${codeId}::uuid, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${reason})`);
}

/**
 * A person confirms which AMFI scheme a registrar code is (the actionable
 * exception for a CAMS code, or a KFintech code without an ISIN), citing the
 * evidence. Refused when the AMFI scheme is not in the feed; when the
 * registrar's own ISIN, a platform mapping, the registrar AMC's established
 * identity, or plan / option words the registrar printed contradict it; or
 * when the person rejected that candidate before. Audited. Returns the code's
 * new decision; the caller re-evaluates held transactions.
 */
export async function confirmSchemeCode(tx: Tx, tenantId: string, codeId: string,
  input: { amfiSchemeCode: string; note: string; by: string; evidenceSource?: EvidenceSource }): Promise<SchemeDecision & { warnings: string[] }> {
  const note = input.note?.trim() ?? "";
  if (note.length < 10) throw new SchemeMappingError("say why this is the scheme (at least 10 characters) — the note is kept with the mapping");
  const source = input.evidenceSource ?? "other_document";
  if (!(source in EVIDENCE_SOURCES)) throw new SchemeMappingError("choose where the evidence comes from");
  const c = await lockCode(tx, tenantId, codeId) as CodeRow & { rejected_candidates: string[] };
  if ((c.rejected_candidates ?? []).includes(input.amfiSchemeCode)) throw new SchemeMappingError("that AMFI scheme was rejected for this code before — clear the rejection first if it was a mistake");
  const ctx = await loadDecisionContext(tx, tenantId, [{ rta: c.rta, amcCode: c.rta_amc_code }]);
  if (!ctx.nav.has(input.amfiSchemeCode)) {
    const n = (await tx.execute(sql`SELECT scheme_code, amc_name, scheme_name, plan, option_name, nav_date::text AS nd FROM scheme_nav WHERE scheme_code = ${input.amfiSchemeCode}`)).rows[0] as any;
    if (!n) throw new SchemeMappingError("that AMFI scheme code is not in the AMFI feed");
    ctx.nav.set(n.scheme_code, { code: n.scheme_code, amc: n.amc_name, name: n.scheme_name, plan: n.plan, option: n.option_name, currentNav: navIsCurrent(n.nd, ctx.latestFeedDate) });
  }
  const d = decideFor(ctx, c, { confirmedCode: input.amfiSchemeCode });
  if (d.status === "conflict") throw new SchemeMappingError(`not confirmed: ${d.reason}`);
  const warnings: string[] = [];
  const target = ctx.nav.get(input.amfiSchemeCode)!;
  if (!target.currentNav) warnings.push("AMFI's last NAV for this scheme is historical (closed, matured or merged) — its NAV is not current");
  const dup = (await tx.execute(sql`
    SELECT rta, rta_amc_code, rta_scheme_code FROM scheme_rta_codes
     WHERE tenant_id = ${tenantId}::uuid AND id <> ${codeId}::uuid AND rta = ${c.rta} AND amfi_scheme_code = ${input.amfiSchemeCode} AND status IN ('resolved_isin', 'confirmed')`)).rows as any[];
  if (dup.length) warnings.push(`registrar code ${dup.map((x) => `${x.rta_amc_code}/${x.rta_scheme_code}`).join(", ")} already maps to this AMFI scheme`);
  await tx.execute(sql`
    UPDATE scheme_rta_codes SET amfi_scheme_code = ${input.amfiSchemeCode}, status = ${d.status}, status_reason = ${d.reason}, reason_code = ${d.reasonCode},
           confirmed_by = ${input.by}::uuid, confirmed_at = now(), confirm_note = ${note}, evidence_source = ${d.reasonCode === "firm_confirmed" ? source : d.reasonCode === "platform_approved" ? "platform_approval" : "registrar_isin"},
           review_state = NULL, review_note = NULL, reviewed_by = ${input.by}::uuid, reviewed_at = now(), updated_at = now()
     WHERE id = ${codeId}::uuid`);
  await restampLegs(tx, tenantId, c, d);
  await audit(tx, tenantId, input.by, "rta.scheme.confirm", codeId,
    { status: c.status, amfiSchemeCode: c.amfi_scheme_code },
    { status: d.status, reasonCode: d.reasonCode, amfiSchemeCode: input.amfiSchemeCode, rta: c.rta, rtaAmcCode: c.rta_amc_code, rtaSchemeCode: c.rta_scheme_code, amfiName: target.name, evidenceSource: source, warnings }, note);
  return { ...d, warnings };
}

/** A person says a proposed AMFI scheme is NOT this code. It is never proposed again for it. Audited. */
export async function rejectSchemeCandidate(tx: Tx, tenantId: string, codeId: string, input: { amfiSchemeCode: string; note: string; by: string }) {
  const note = input.note?.trim() ?? "";
  if (note.length < 10) throw new SchemeMappingError("say why it is not this scheme (at least 10 characters)");
  const c = await lockCode(tx, tenantId, codeId);
  if (c.confirmed && c.amfi_scheme_code === input.amfiSchemeCode) throw new SchemeMappingError("that is the confirmed scheme — it cannot also be rejected");
  await tx.execute(sql`
    UPDATE scheme_rta_codes SET rejected_candidates = ARRAY(SELECT DISTINCT x FROM unnest(rejected_candidates || ARRAY[${input.amfiSchemeCode}::text]) x ORDER BY x),
           reviewed_by = ${input.by}::uuid, reviewed_at = now(), updated_at = now()
     WHERE id = ${codeId}::uuid`);
  await audit(tx, tenantId, input.by, "rta.scheme.reject_candidate", codeId, null, { amfiSchemeCode: input.amfiSchemeCode, rta: c.rta, rtaAmcCode: c.rta_amc_code, rtaSchemeCode: c.rta_scheme_code }, note);
}

/** Defer (or take back) a decision: the code stays unresolved and its transactions stay held; the screen shows why. Audited. */
export async function deferSchemeCode(tx: Tx, tenantId: string, codeId: string, input: { defer: boolean; note: string; by: string }) {
  const note = input.note?.trim() ?? "";
  if (input.defer && note.length < 10) throw new SchemeMappingError("say what is awaited (at least 10 characters)");
  const c = await lockCode(tx, tenantId, codeId);
  await tx.execute(sql`
    UPDATE scheme_rta_codes SET review_state = ${input.defer ? "deferred" : null}, review_note = ${input.defer ? note : null},
           reviewed_by = ${input.by}::uuid, reviewed_at = now(), updated_at = now()
     WHERE id = ${codeId}::uuid`);
  await audit(tx, tenantId, input.by, input.defer ? "rta.scheme.defer" : "rta.scheme.undefer", codeId, null, { rta: c.rta, rtaAmcCode: c.rta_amc_code, rtaSchemeCode: c.rta_scheme_code }, note || "deferral taken back");
}

export type SchemeCandidate = {
  amfiSchemeCode: string; name: string | null; amc: string | null; plan: string | null; option: string | null;
  nav: number | null; navDate: string | null; active: boolean; isins: string[];
  /** Why it is shown. Only 'platform' and 'isin' are evidence; 'name' is ranking for a person. */
  basis: "platform" | "isin" | "name";
  nameScore: number; warnings: string[];
};

/**
 * Candidates for a person to approve, evidence first: a platform mapping,
 * then AMFI schemes carrying the registrar's ISIN, then — for a person to
 * check against a document, never applied — AMFI schemes of the registrar
 * AMC's established AMC, ranked by name and filtered by any explicit plan /
 * option words the registrar printed. Rejected candidates are left out.
 */
export async function schemeCandidates(tx: Tx, tenantId: string, codeId: string, limit = 8): Promise<{ registrarAmc: string[]; amcEstablished: boolean; markers: ReturnType<typeof markersOf>; candidates: SchemeCandidate[] }> {
  const c = (await tx.execute(sql`
    SELECT id, rta, rta_amc_code, rta_scheme_code, observed_isins, observed_name, status, amfi_scheme_code, confirmed_by IS NOT NULL AS confirmed, status_reason, reason_code, rejected_candidates
      FROM scheme_rta_codes WHERE tenant_id = ${tenantId}::uuid AND id = ${codeId}::uuid`)).rows[0] as (CodeRow & { rejected_candidates: string[] }) | undefined;
  if (!c) throw Object.assign(new SchemeMappingError("registrar scheme code not found"), { status: 404 });
  const ctx = await loadDecisionContext(tx, tenantId, [{ rta: c.rta, amcCode: c.rta_amc_code }]);
  const key = { rta: c.rta, amcCode: c.rta_amc_code, schemeCode: c.rta_scheme_code };
  const sib = siblingAmcs(ctx, key);
  const sibKeys = [...new Set(sib.map(amcKey).filter(Boolean))] as string[];
  const rejected = new Set(c.rejected_candidates ?? []);
  const registrarMarkers = markersOf(c.observed_name);
  const picked = new Map<string, SchemeCandidate>();
  const add = (code: string, basis: SchemeCandidate["basis"]) => { if (!rejected.has(code) && !picked.has(code)) picked.set(code, { amfiSchemeCode: code, basis } as SchemeCandidate); };
  const g = ctx.globalByKey.get(keyOf(key));
  if (g) add(g.amfi_scheme_code, "platform");
  for (const i of c.observed_isins ?? []) for (const m of ctx.amfiByIsin[i.toUpperCase()] ?? []) add(m.code, "isin");
  // Name suggestions — for a person to check against a document, never applied.
  // Inside the registrar AMC's established AMC when there is one; across every
  // AMC when none is established yet (every CAMS AMC until its first code is
  // decided), each then warned "the registrar AMC is not established". None
  // when the registrar AMC's codes contradict each other.
  if (sibKeys.length <= 1 && c.observed_name) {
    const pool = (await tx.execute(sql`SELECT scheme_code, scheme_name, amc_name, plan, option_name FROM scheme_nav WHERE amc_name IS NOT NULL`)).rows as any[];
    const ranked = pool
      .filter((n) => (sibKeys.length === 0 || amcKey(n.amc_name) === sibKeys[0]) && !rejected.has(n.scheme_code))
      .filter((n) => !markerContradiction(markersOf(c.observed_name, amfiCore(n.scheme_name)), amfiMarkers({ name: n.scheme_name, plan: n.plan, option: n.option_name })))
      .map((n) => ({ code: n.scheme_code as string, score: nameRank(c.observed_name, n.scheme_name) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || x.code.localeCompare(y.code))
      .slice(0, limit);
    for (const r of ranked) add(r.code, "name");
  }
  const codes = [...picked.keys()];
  if (!codes.length) return { registrarAmc: sib, amcEstablished: sibKeys.length === 1, markers: registrarMarkers, candidates: [] };
  const details = (await tx.execute(sql`
    SELECT n.scheme_code, n.scheme_name, n.amc_name, n.plan, n.option_name, n.nav::float8 AS nav, n.nav_date::text AS nav_date,
           array_remove(ARRAY[n.isin_payout_growth, n.isin_reinvest, CASE WHEN n.isin_payout_growth IS NULL THEN n.isin END], NULL) AS isins,
           (SELECT array_agg(o.rta_amc_code || '/' || o.rta_scheme_code) FROM scheme_rta_codes o
             WHERE o.tenant_id = ${tenantId}::uuid AND o.rta = ${c.rta} AND o.id <> ${codeId}::uuid AND o.amfi_scheme_code = n.scheme_code AND o.status IN ('resolved_isin', 'confirmed')) AS taken
      FROM scheme_nav n WHERE n.scheme_code IN (${sql.join(codes.map((x) => sql`${x}`), sql`, `)})`)).rows as any[];
  const byCode = new Map(details.map((d) => [d.scheme_code, d]));
  const candidates = codes.flatMap((code) => {
    const d = byCode.get(code);
    if (!d) return [];
    const base = picked.get(code)!;
    const warnings: string[] = [];
    const active = navIsCurrent(d.nav_date, ctx.latestFeedDate);
    if (!active) warnings.push(`AMFI's last NAV is dated ${d.nav_date ?? "—"} — historical (closed, matured or merged)`);
    if (sibKeys.length === 1 && amcKey(d.amc_name) !== sibKeys[0]) warnings.push(`AMC differs from the registrar AMC's other codes (${sib[0]})`);
    if (sibKeys.length > 1) warnings.push("the registrar AMC's other codes point to more than one AMFI AMC");
    if (!sibKeys.length) warnings.push("the registrar AMC is not established yet — check the AMC on the document");
    const po = markerContradiction(markersOf(c.observed_name, amfiCore(d.scheme_name)), amfiMarkers({ name: d.scheme_name, plan: d.plan, option: d.option_name }));
    if (po) warnings.push(`plan / option: ${po}`);
    if (d.taken?.length) warnings.push(`already mapped from registrar code ${d.taken.join(", ")}`);
    if (d.nav_date && d.nav_date < navCutoffIso()) warnings.push(`NAV dated ${d.nav_date} — not current`);
    return [{ ...base, name: d.scheme_name, amc: d.amc_name, plan: d.plan, option: d.option_name, nav: d.nav, navDate: d.nav_date, active,
      isins: d.isins ?? [], nameScore: Math.round(nameRank(c.observed_name, d.scheme_name) * 100) / 100, warnings }];
  });
  return { registrarAmc: sib, amcEstablished: sibKeys.length === 1, markers: registrarMarkers, candidates };
}

// ── Platform mappings (two operators) ─────────────────────────────────────

/**
 * Two platform operators approve a registrar code → AMFI scheme for every
 * firm (the CAMS route: CAMS prints no ISIN). The requester and approver must
 * differ (also a database constraint), the note says what evidence was read,
 * the AMFI scheme must be in the feed, and a live mapping to a DIFFERENT
 * scheme must be revoked first. Every firm holding the code is re-decided.
 */
export async function approvePlatformMapping(systemTx: Tx, input: { rta: "cams" | "kfintech"; amcCode: string; schemeCode: string; amfiSchemeCode: string; note: string; requestedBy: string; approvedBy: string }) {
  if (input.requestedBy === input.approvedBy) throw new SchemeMappingError("the requester and the approver must be different operators");
  if ((input.note ?? "").trim().length < 10) throw new SchemeMappingError("say what evidence was read (at least 10 characters)");
  const nav = (await systemTx.execute(sql`SELECT scheme_code FROM scheme_nav WHERE scheme_code = ${input.amfiSchemeCode}`)).rows[0];
  if (!nav) throw new SchemeMappingError("that AMFI scheme code is not in the AMFI feed");
  const live = (await systemTx.execute(sql`
    SELECT id, amfi_scheme_code, basis, status FROM scheme_registrar_map
     WHERE rta = ${input.rta} AND rta_amc_code = ${input.amcCode} AND rta_scheme_code = ${input.schemeCode} AND status <> 'revoked' FOR UPDATE`)).rows[0] as any;
  if (live && live.amfi_scheme_code !== input.amfiSchemeCode) throw new SchemeMappingError(`a live mapping says AMFI ${live.amfi_scheme_code} — revoke it first`);
  if (live) return { id: live.id as string, unchanged: true, firmsRedecided: 0, tenantIds: [] as string[], key: null };
  const row = (await systemTx.execute(sql`
    INSERT INTO scheme_registrar_map (rta, rta_amc_code, rta_scheme_code, amfi_scheme_code, basis, status, evidence_note, requested_by, approved_by)
    VALUES (${input.rta}, ${input.amcCode}, ${input.schemeCode}, ${input.amfiSchemeCode}, 'platform_approval', 'approved', ${input.note.trim()}, ${input.requestedBy}::uuid, ${input.approvedBy}::uuid)
    RETURNING id`)).rows[0] as { id: string };
  await systemTx.execute(sql`
    INSERT INTO scheme_registrar_map_events (map_id, action, after, actor, second_actor, reason)
    VALUES (${row.id}::uuid, 'approve', ${JSON.stringify({ amfiSchemeCode: input.amfiSchemeCode })}::jsonb, ${input.approvedBy}::uuid, ${input.requestedBy}::uuid, ${input.note.trim()})`);
  const re = await redecideEverywhere(systemTx, [{ rta: input.rta, amcCode: input.amcCode }]);
  return { id: row.id, unchanged: false, firmsRedecided: re.firms, tenantIds: re.tenantIds, key: { rta: input.rta, amcCode: input.amcCode, schemeCode: input.schemeCode } };
}

/** One operator may revoke (stopping is never two-person). Every firm holding the code is re-decided — its transactions are held again where nothing else resolves it. */
export async function revokePlatformMapping(systemTx: Tx, input: { id: string; by: string; reason: string }) {
  if ((input.reason ?? "").trim().length < 10) throw new SchemeMappingError("say why (at least 10 characters)");
  const before = (await systemTx.execute(sql`SELECT * FROM scheme_registrar_map WHERE id = ${input.id}::uuid FOR UPDATE`)).rows[0] as any;
  if (!before) throw Object.assign(new SchemeMappingError("mapping not found"), { status: 404 });
  if (before.status === "revoked") return { unchanged: true };
  await systemTx.execute(sql`
    UPDATE scheme_registrar_map SET status = 'revoked', revoked_at = now(), revoked_by = ${input.by}::uuid, revoke_reason = ${input.reason.trim()}, updated_at = now()
     WHERE id = ${input.id}::uuid`);
  await systemTx.execute(sql`
    INSERT INTO scheme_registrar_map_events (map_id, action, before, actor, reason)
    VALUES (${input.id}::uuid, 'revoke', ${JSON.stringify({ amfiSchemeCode: before.amfi_scheme_code, basis: before.basis, status: before.status })}::jsonb, ${input.by}::uuid, ${input.reason.trim()})`);
  const re = await redecideEverywhere(systemTx, [{ rta: before.rta, amcCode: before.rta_amc_code }]);
  return { unchanged: false, firmsRedecided: re.firms };
}

export type SchemeCodeRow = {
  id: string; rta: string; rtaAmcCode: string; rtaSchemeCode: string; observedName: string | null; observedIsins: string[];
  sourceReports: string[]; status: SchemeStatus; reason: string | null; reasonCode: ReasonCode | null; amfiSchemeCode: string | null; amfiName: string | null;
  amfiAmc: string | null; amfiNavDate: string | null; amfiActive: boolean | null; confirmedAt: string | null; confirmNote: string | null; evidenceSource: string | null;
  reviewState: "deferred" | null; reviewNote: string | null; rejectedCandidates: string[]; heldTransactions: number; lastSeenAt: string;
};

/** The firm's registrar codes for the Scheme codes screen, the ones needing a decision first. */
export async function loadSchemeCodes(tx: Tx, tenantId: string, opts: { status?: SchemeStatus } = {}): Promise<{ rows: SchemeCodeRow[]; counts: Record<SchemeStatus, number> }> {
  const counts: Record<SchemeStatus, number> = { resolved_isin: 0, confirmed: 0, unresolved: 0, conflict: 0 };
  for (const r of (await tx.execute(sql`SELECT status, count(*)::int AS n FROM scheme_rta_codes WHERE tenant_id = ${tenantId}::uuid GROUP BY 1`)).rows as Array<{ status: SchemeStatus; n: number }>) counts[r.status] = r.n;
  const latest = (await tx.execute(sql`SELECT max(feed_date)::text AS d FROM amfi_feed_imports WHERE status = 'applied'`)).rows[0] as { d: string | null };
  const rows = (await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (e.identity_key) e.identity_key, e.rta, e.amc_code, e.scheme_code, e.posting_outcome, e.posting_reason
        FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IS NOT NULL
       ORDER BY e.identity_key, e.created_at DESC),
    held AS (
      SELECT l.rta, l.amc_code, l.scheme_code, count(*)::int AS n FROM latest l
       WHERE l.posting_outcome = 'quarantined' AND l.posting_reason ~ '^scheme_(unresolved|conflict)'
         AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = ${tenantId}::uuid AND p.identity_key = l.identity_key)
       GROUP BY 1, 2, 3)
    SELECT c.id, c.rta, c.rta_amc_code, c.rta_scheme_code, c.observed_name, c.observed_isins, c.source_reports, c.status, c.status_reason, c.reason_code,
           c.amfi_scheme_code, n.scheme_name AS amfi_name, n.amc_name AS amfi_amc, n.nav_date::text AS amfi_nav_date,
           c.confirmed_at::text AS confirmed_at, c.confirm_note, c.evidence_source, c.review_state, c.review_note, c.rejected_candidates,
           c.last_seen_at::text AS last_seen_at, COALESCE(h.n, 0) AS held
      FROM scheme_rta_codes c
      LEFT JOIN scheme_nav n ON n.scheme_code = c.amfi_scheme_code
      LEFT JOIN held h ON h.rta = c.rta AND h.amc_code = c.rta_amc_code AND h.scheme_code = c.rta_scheme_code
     WHERE c.tenant_id = ${tenantId}::uuid ${opts.status ? sql`AND c.status = ${opts.status}` : sql``}
     ORDER BY (c.status IN ('conflict', 'unresolved')) DESC, (c.review_state IS NULL) DESC, COALESCE(h.n, 0) DESC, c.rta, c.rta_amc_code, c.rta_scheme_code
     LIMIT 1000`)).rows as any[];
  return {
    counts,
    rows: rows.map((r) => ({
      id: r.id, rta: r.rta, rtaAmcCode: r.rta_amc_code, rtaSchemeCode: r.rta_scheme_code, observedName: r.observed_name, observedIsins: r.observed_isins ?? [],
      sourceReports: r.source_reports ?? [], status: r.status, reason: r.status_reason, reasonCode: r.reason_code, amfiSchemeCode: r.amfi_scheme_code, amfiName: r.amfi_name,
      amfiAmc: r.amfi_amc, amfiNavDate: r.amfi_nav_date, amfiActive: r.amfi_scheme_code ? navIsCurrent(r.amfi_nav_date, latest.d) : null,
      confirmedAt: r.confirmed_at, confirmNote: r.confirm_note, evidenceSource: r.evidence_source,
      reviewState: r.review_state, reviewNote: r.review_note, rejectedCandidates: r.rejected_candidates ?? [], heldTransactions: Number(r.held), lastSeenAt: r.last_seen_at,
    })),
  };
}
