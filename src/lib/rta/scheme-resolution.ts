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

type Tx = any;

export type SchemeStatus = "resolved_isin" | "confirmed" | "unresolved" | "conflict";
export type SchemeKey = { rta: string; amcCode: string; schemeCode: string };
export type SchemeDecision = { status: SchemeStatus; amfiSchemeCode: string | null; reason: string };

export const isResolved = (s: SchemeStatus | string | null | undefined) => s === "resolved_isin" || s === "confirmed";

/** The pure rule. `amfiByIsin`: for each observed ISIN, the AMFI scheme codes that carry it. */
export function decideScheme(input: {
  observedIsins: string[];
  amfiByIsin: Record<string, string[]>;
  /** A person's confirmation, if any, and whether that AMFI scheme is in the feed. */
  confirmed: { amfiSchemeCode: string; existsInFeed: boolean } | null;
}): SchemeDecision {
  const isins = [...new Set(input.observedIsins.map((i) => i.trim().toUpperCase()).filter(Boolean))];
  if (isins.length > 1) {
    return { status: "conflict", amfiSchemeCode: null, reason: `the registrar printed ${isins.length} different ISINs for this code` };
  }
  if (isins.length === 1) {
    const matches = [...new Set(input.amfiByIsin[isins[0]] ?? [])];
    if (matches.length > 1) return { status: "conflict", amfiSchemeCode: null, reason: `the ISIN is on ${matches.length} AMFI schemes` };
    if (matches.length === 1) {
      if (input.confirmed && input.confirmed.amfiSchemeCode !== matches[0]) {
        return { status: "conflict", amfiSchemeCode: null, reason: `confirmed as AMFI ${input.confirmed.amfiSchemeCode}, but the registrar's ISIN is AMFI ${matches[0]}` };
      }
      return { status: "resolved_isin", amfiSchemeCode: matches[0], reason: "the registrar's ISIN identifies one AMFI scheme" };
    }
    // An ISIN the AMFI feed does not carry (yet): only a confirmation resolves it.
  }
  if (input.confirmed) {
    if (!input.confirmed.existsInFeed) return { status: "conflict", amfiSchemeCode: null, reason: `confirmed as AMFI ${input.confirmed.amfiSchemeCode}, which is not in the AMFI feed` };
    return { status: "confirmed", amfiSchemeCode: input.confirmed.amfiSchemeCode, reason: "confirmed by a person" };
  }
  return {
    status: "unresolved", amfiSchemeCode: null,
    reason: isins.length ? "the registrar's ISIN is not in the AMFI feed" : "the registrar printed no ISIN for this code — a person must confirm the AMFI scheme",
  };
}

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

/** Re-apply decideScheme to the firm's codes (all, or the ones given) against the AMFI feed as it is now. */
export async function redecideSchemeCodes(tx: Tx, tenantId: string, keys?: SchemeKey[]): Promise<Record<SchemeStatus, number>> {
  const filter = keys?.length
    ? sql`AND (c.rta, c.rta_amc_code, c.rta_scheme_code) IN (${sql.join(keys.map((k) => sql`(${k.rta}, ${k.amcCode}, ${k.schemeCode})`), sql`, `)})`
    : keys ? sql`AND false` : sql``;
  const codes = (await tx.execute(sql`
    SELECT c.id, c.observed_isins, c.status, c.amfi_scheme_code, c.confirmed_by IS NOT NULL AS confirmed,
           (SELECT array_agg(DISTINCT n.scheme_code) FROM scheme_nav n WHERE c.amfi_scheme_code IS NOT NULL AND n.scheme_code = c.amfi_scheme_code) AS confirmed_exists
      FROM scheme_rta_codes c WHERE c.tenant_id = ${tenantId}::uuid ${filter}`)).rows as Array<{ id: string; observed_isins: string[]; status: string; amfi_scheme_code: string | null; confirmed: boolean; confirmed_exists: string[] | null }>;
  const allIsins = [...new Set(codes.flatMap((c) => c.observed_isins ?? []))];
  const amfiByIsin: Record<string, string[]> = {};
  if (allIsins.length) {
    const hits = (await tx.execute(sql`
      SELECT upper(i) AS isin, n.scheme_code FROM scheme_nav n, unnest(ARRAY[n.isin, n.isin_reinvest]) AS u(i)
       WHERE upper(i) IN (${sql.join(allIsins.map((i) => sql`${i}`), sql`, `)})`)).rows as Array<{ isin: string; scheme_code: string }>;
    for (const h of hits) (amfiByIsin[h.isin] ??= []).push(h.scheme_code);
  }
  const tally: Record<SchemeStatus, number> = { resolved_isin: 0, confirmed: 0, unresolved: 0, conflict: 0 };
  for (const c of codes) {
    const d = decideScheme({
      observedIsins: c.observed_isins ?? [], amfiByIsin,
      confirmed: c.confirmed && c.amfi_scheme_code ? { amfiSchemeCode: c.amfi_scheme_code, existsInFeed: (c.confirmed_exists ?? []).length > 0 } : null,
    });
    tally[d.status]++;
    // A confirmation is kept even when the code is in conflict, so the person sees what they chose.
    const amfi = d.amfiSchemeCode ?? (c.confirmed ? c.amfi_scheme_code : null);
    await tx.execute(sql`
      UPDATE scheme_rta_codes SET status = ${d.status}, status_reason = ${d.reason}, amfi_scheme_code = ${amfi}, updated_at = now()
       WHERE id = ${c.id}::uuid AND (status IS DISTINCT FROM ${d.status} OR status_reason IS DISTINCT FROM ${d.reason} OR amfi_scheme_code IS DISTINCT FROM ${amfi})`);
  }
  return tally;
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

/**
 * A person confirms which AMFI scheme a registrar code is (the actionable
 * exception for a CAMS code, or a KFintech code without an ISIN). Refused when
 * the AMFI scheme is not in the feed, or when the registrar's own ISIN
 * evidence names a different scheme — evidence beats a choice. Audited.
 * Returns the code's new decision; the caller re-evaluates held transactions.
 */
export async function confirmSchemeCode(tx: Tx, tenantId: string, codeId: string, input: { amfiSchemeCode: string; note: string; by: string }): Promise<SchemeDecision> {
  const note = input.note?.trim() ?? "";
  if (note.length < 10) throw new SchemeMappingError("say why this is the scheme (at least 10 characters) — the note is kept with the mapping");
  const c = (await tx.execute(sql`SELECT * FROM scheme_rta_codes WHERE tenant_id = ${tenantId}::uuid AND id = ${codeId}::uuid FOR UPDATE`)).rows[0] as any;
  if (!c) throw Object.assign(new SchemeMappingError("registrar scheme code not found"), { status: 404 });
  const nav = (await tx.execute(sql`SELECT scheme_code, scheme_name, amc_name, isin, isin_reinvest FROM scheme_nav WHERE scheme_code = ${input.amfiSchemeCode}`)).rows[0] as any;
  if (!nav) throw new SchemeMappingError("that AMFI scheme code is not in the AMFI feed");
  const amfiByIsin: Record<string, string[]> = {};
  for (const i of (c.observed_isins ?? []) as string[]) {
    const hits = (await tx.execute(sql`SELECT scheme_code FROM scheme_nav WHERE upper(isin) = ${i} OR upper(isin_reinvest) = ${i}`)).rows as Array<{ scheme_code: string }>;
    amfiByIsin[i] = hits.map((h) => h.scheme_code);
  }
  const d = decideScheme({ observedIsins: c.observed_isins ?? [], amfiByIsin, confirmed: { amfiSchemeCode: input.amfiSchemeCode, existsInFeed: true } });
  if (d.status === "conflict") throw new SchemeMappingError(`not confirmed: ${d.reason}`);
  await tx.execute(sql`
    UPDATE scheme_rta_codes SET amfi_scheme_code = ${input.amfiSchemeCode}, status = ${d.status}, status_reason = ${d.reason},
           confirmed_by = ${input.by}::uuid, confirmed_at = now(), confirm_note = ${note}, updated_at = now()
     WHERE id = ${codeId}::uuid`);
  await tx.execute(sql`
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, reason)
    VALUES (${tenantId}::uuid, ${input.by}::uuid, 'user', 'rta.scheme.confirm', 'scheme_rta_code', ${codeId}::uuid,
            ${JSON.stringify({ status: c.status, amfiSchemeCode: c.amfi_scheme_code })}::jsonb,
            ${JSON.stringify({ status: d.status, amfiSchemeCode: input.amfiSchemeCode, rta: c.rta, rtaAmcCode: c.rta_amc_code, rtaSchemeCode: c.rta_scheme_code, amfiName: nav.scheme_name })}::jsonb, ${note})`);
  return d;
}

export type SchemeCodeRow = {
  id: string; rta: string; rtaAmcCode: string; rtaSchemeCode: string; observedName: string | null; observedIsins: string[];
  sourceReports: string[]; status: SchemeStatus; reason: string | null; amfiSchemeCode: string | null; amfiName: string | null;
  amfiAmc: string | null; confirmedAt: string | null; heldTransactions: number; lastSeenAt: string;
};

/** The firm's registrar codes for the Scheme codes screen, the ones needing a decision first. */
export async function loadSchemeCodes(tx: Tx, tenantId: string, opts: { status?: SchemeStatus } = {}): Promise<{ rows: SchemeCodeRow[]; counts: Record<SchemeStatus, number> }> {
  const counts: Record<SchemeStatus, number> = { resolved_isin: 0, confirmed: 0, unresolved: 0, conflict: 0 };
  for (const r of (await tx.execute(sql`SELECT status, count(*)::int AS n FROM scheme_rta_codes WHERE tenant_id = ${tenantId}::uuid GROUP BY 1`)).rows as Array<{ status: SchemeStatus; n: number }>) counts[r.status] = r.n;
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
    SELECT c.id, c.rta, c.rta_amc_code, c.rta_scheme_code, c.observed_name, c.observed_isins, c.source_reports, c.status, c.status_reason,
           c.amfi_scheme_code, n.scheme_name AS amfi_name, n.amc_name AS amfi_amc, c.confirmed_at::text AS confirmed_at, c.last_seen_at::text AS last_seen_at,
           COALESCE(h.n, 0) AS held
      FROM scheme_rta_codes c
      LEFT JOIN scheme_nav n ON n.scheme_code = c.amfi_scheme_code
      LEFT JOIN held h ON h.rta = c.rta AND h.amc_code = c.rta_amc_code AND h.scheme_code = c.rta_scheme_code
     WHERE c.tenant_id = ${tenantId}::uuid ${opts.status ? sql`AND c.status = ${opts.status}` : sql``}
     ORDER BY (c.status IN ('conflict', 'unresolved')) DESC, COALESCE(h.n, 0) DESC, c.rta, c.rta_amc_code, c.rta_scheme_code
     LIMIT 1000`)).rows as any[];
  return {
    counts,
    rows: rows.map((r) => ({
      id: r.id, rta: r.rta, rtaAmcCode: r.rta_amc_code, rtaSchemeCode: r.rta_scheme_code, observedName: r.observed_name, observedIsins: r.observed_isins ?? [],
      sourceReports: r.source_reports ?? [], status: r.status, reason: r.status_reason, amfiSchemeCode: r.amfi_scheme_code, amfiName: r.amfi_name,
      amfiAmc: r.amfi_amc, confirmedAt: r.confirmed_at, heldTransactions: Number(r.held), lastSeenAt: r.last_seen_at,
    })),
  };
}
