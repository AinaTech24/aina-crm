/**
 * RTA historical-data diagnostics (Phase 3G) — READ ONLY.
 *
 * What existing CRM data (written by the earlier importers) would need review
 * before a firm moves to validate-first posting. Every query runs in a
 * READ ONLY transaction under the firm's RLS scope; nothing is written,
 * nothing is repaired. Output is aggregate counts plus at most three MASKED
 * examples per finding (folio ****1234, PAN ******123A, ids only — never a
 * name, phone, email or address).
 *
 *   npx tsx scripts/rta-historical-diagnostics.ts --tenant <uuid> [--json out.json]
 *
 * Findings (each with a proposed reversible repair in
 * docs/rta/PHASE3G_PRODUCTION_READINESS.md — none is executed here):
 *   minor_keys            old MINOR: identity keys; name-only cross-registrar links
 *   nopan_placeholders    NOPAN:FOLIO: placeholders and what hangs off them
 *   guardian_as_owner     a minor's registrar rows filed under an adult guardian
 *   folio_amc_duplicates  one folio number under several AMC codes / clients
 *   reference_collisions  registrar numbers reused across AMCs (the CRM's
 *                         tenant-wide unique order_id cannot hold both)
 *   line_keyed_refs       rows keyed <rta>_<line> by the pre-Phase-2 importer
 *   switch_stp            switch / STP classifications the registrar text contradicts
 *   amounts_dates         impossible or defaulted amounts and dates
 *   holdings_dates        holdings legs with no statement date / older than their scope
 *   duplicate_sips        the same SIP recorded more than once
 */
import { sql } from "drizzle-orm";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const maskFolio = (f: string | null) => (f ? `****${f.replace(/\s/g, "").slice(-4)}` : null);
const maskPan = (p: string | null) => (p && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p) ? `******${p.slice(-4)}` : p ? p.replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, (m) => `******${m.slice(-4)}`) : null);

export type Finding = { key: string; title: string; count: number; detail?: Record<string, number | string>; examples: Array<Record<string, unknown>>; risk: "high" | "medium" | "low"; repair: string };

export async function diagnose(tenantId: string): Promise<{ tenantId: string; at: string; findings: Finding[] }> {
  const { withTenant } = await import("@/db/client");
  return withTenant(tenantId, async (tx: any) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const q = async <T = any>(s: any) => (await tx.execute(s)).rows as T[];
    const one = async <T = any>(s: any) => (await q<T>(s))[0];
    const f: Finding[] = [];

    // 1. MINOR: keys.
    const mk = await one(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE pan ~ ':(CAMS|KFINTECH)$')::int AS registrar_scoped,
             count(*) FILTER (WHERE guardian_investor_id IS NULL)::int AS no_guardian_link,
             count(*) FILTER (WHERE (SELECT count(DISTINCT fo.rta) FROM folios fo WHERE fo.investor_id = i.id) > 1)::int AS both_registrars
        FROM investors i WHERE tenant_id = ${tenantId}::uuid AND pan LIKE 'MINOR:%' AND deleted_at IS NULL AND merged_into_id IS NULL`);
    const mkEx = await q(sql`
      SELECT i.id::text AS investor_id, (SELECT array_agg(DISTINCT fo.rta::text) FROM folios fo WHERE fo.investor_id = i.id) AS registrars
        FROM investors i WHERE i.tenant_id = ${tenantId}::uuid AND i.pan LIKE 'MINOR:%' AND i.pan !~ ':(CAMS|KFINTECH)$'
         AND (SELECT count(DISTINCT fo.rta) FROM folios fo WHERE fo.investor_id = i.id) > 1 LIMIT 3`);
    f.push({ key: "minor_keys", title: "Minor clients keyed MINOR:<guardian PAN>:<name>", count: mk.n, risk: mk.both_registrars ? "high" : "medium",
      detail: { registrarScoped: mk.registrar_scoped, withoutGuardianLink: mk.no_guardian_link, holdingFoliosAtBothRegistrars: mk.both_registrars },
      examples: mkEx,
      repair: "A key holding folios at both registrars was linked by guardian PAN + name only. Review each: if two children, split the folios of one registrar onto a new provisional client (MINOR:…:<RTA>) via an audited ownership change; if one child, record the link as reviewed. Reversible: the change is a folio move recorded in audit_log with before/after owner." });

    // 2. NOPAN:FOLIO: placeholders.
    const np = await one(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE (SELECT count(*) FROM folios fo WHERE fo.investor_id = i.id) > 1)::int AS multi_folio,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.investor_id = i.id))::int AS with_transactions,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sips s WHERE s.investor_id = i.id))::int AS with_sips,
             coalesce(sum(i.aum), 0)::text AS aum
        FROM investors i WHERE tenant_id = ${tenantId}::uuid AND rta_nopan_key IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL`);
    const npEx = await q(sql`SELECT i.id::text AS investor_id, i.rta_nopan_key AS key FROM investors i WHERE i.tenant_id = ${tenantId}::uuid AND i.rta_nopan_key IS NOT NULL AND i.deleted_at IS NULL LIMIT 3`);
    f.push({ key: "nopan_placeholders", title: "PAN-less placeholder clients (NOPAN:FOLIO:)", count: np.n, risk: np.n ? "medium" : "low",
      detail: { holdingMoreThanOneFolio: np.multi_folio, withTransactions: np.with_transactions, withSips: np.with_sips, aum: np.aum },
      examples: npEx.map((e) => ({ investor_id: e.investor_id, key: String(e.key).replace(/(FOLIO:)(.*)/, (_m: string, a: string, b: string) => a + maskFolio(b)) })),
      repair: "Merge each placeholder into the real client once a master names the owner (Merge Clients keeps the placeholder row merged_into the survivor; unmerge reverses it). A placeholder whose registrar row says MINOR is merged only into a minor record, never the guardian." });

    // 3. A minor's registrar rows filed under an adult guardian.
    const ga = await one(sql`
      SELECT count(*)::int AS n, count(DISTINCT t.investor_id)::int AS clients
        FROM transactions t JOIN investors i ON i.id = t.investor_id
       WHERE t.tenant_id = ${tenantId}::uuid AND i.is_minor IS NOT TRUE
         AND EXISTS (SELECT 1 FROM investors m WHERE m.tenant_id = i.tenant_id AND m.guardian_investor_id = i.id)
         AND (upper(coalesce(t.raw_feed_row->>'tax_status', t.raw_feed_row->>'taxStatus', t.raw_feed_row->>'Status', '')) LIKE '%MINOR%')`);
    const gaFolios = await one(sql`
      SELECT count(*)::int AS n FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${tenantId}::uuid AND i.is_minor IS NOT TRUE
         AND EXISTS (SELECT 1 FROM investors m WHERE m.tenant_id = i.tenant_id AND m.guardian_investor_id = i.id)
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(f.schemes, '[]'::jsonb)) leg WHERE upper(coalesce(leg->>'holderCategory', '')) = 'MINOR')`);
    // Staging (shadow / validate-first) knows each row's legal owner type even where the legacy row kept nothing.
    const gaStaged = await one(sql`
      SELECT count(DISTINCT (f.amc_code, f.folio_number))::int AS n FROM rta_staging_rows r
        JOIN folios f ON f.tenant_id = r.tenant_id AND f.amc_code = r.amc_code AND f.folio_number = r.folio_number
        JOIN investors i ON i.id = f.investor_id
       WHERE r.tenant_id = ${tenantId}::uuid AND r.attrs->'holder'->>'ownerType' = 'minor' AND i.is_minor IS NOT TRUE AND i.rta_nopan_key IS NULL`);
    f.push({ key: "guardian_as_owner", title: "Minor registrar rows filed under an adult who is a recorded guardian", count: ga.n + gaFolios.n + gaStaged.n, risk: ga.n + gaFolios.n + gaStaged.n ? "high" : "low",
      detail: { transactions: ga.n, guardians: ga.clients, foliosWithMinorLegs: gaFolios.n, foliosStagedAsMinorOnAdults: gaStaged.n, basis: "legacy processed rows keep no raw row; stage the historical files (shadow) for full coverage" },
      examples: [],
      repair: "Move the folio (and its transactions, SIPs) to the minor's record by an audited ownership change; reversible by moving it back from the audit_log before/after. Never automatic." });

    // 4. One folio number under several AMC codes or clients.
    const fd = await one(sql`
      SELECT count(*) FILTER (WHERE amcs > 1)::int AS multi_amc, count(*) FILTER (WHERE owners > 1)::int AS multi_owner,
             count(*) FILTER (WHERE has_blank_amc AND amcs > 1)::int AS blank_and_coded
        FROM (SELECT folio_number, count(DISTINCT coalesce(amc_code, '')) AS amcs, count(DISTINCT investor_id) AS owners, bool_or(coalesce(amc_code, '') = '') AS has_blank_amc
                FROM folios WHERE tenant_id = ${tenantId}::uuid GROUP BY folio_number) x`);
    const fdEx = await q(sql`
      SELECT folio_number, array_agg(DISTINCT coalesce(amc_code, '(none)')) AS amcs, count(DISTINCT investor_id)::int AS owners
        FROM folios WHERE tenant_id = ${tenantId}::uuid GROUP BY folio_number HAVING count(DISTINCT investor_id) > 1 LIMIT 3`);
    f.push({ key: "folio_amc_duplicates", title: "One folio number under several AMC codes or clients", count: fd.multi_amc + fd.multi_owner, risk: fd.blank_and_coded ? "high" : fd.multi_owner ? "medium" : "low",
      detail: { numbersUnderSeveralAmcCodes: fd.multi_amc, numbersUnderSeveralClients: fd.multi_owner, blankAndCodedAmc: fd.blank_and_coded },
      examples: fdEx.map((e) => ({ folio: maskFolio(e.folio_number), amcs: e.amcs, owners: e.owners })),
      repair: "Different AMCs = different folios (legitimate). A blank-AMC row duplicating a coded one is a legacy key: re-point its legs and transactions to the coded folio in one audited transaction (reversible: the old folio row is kept, emptied, and marked superseded)." });

    // 5. Registrar numbers reused across AMCs / registrars (cannot coexist under the tenant-wide unique order_id).
    const rc = await one(sql`
      WITH latest AS (SELECT DISTINCT ON (identity_key) identity_key, registrar_txn_no, rta, amc_code FROM rta_staging_economic_txns WHERE tenant_id = ${tenantId}::uuid ORDER BY identity_key, created_at DESC)
      SELECT count(*)::int AS n FROM (SELECT registrar_txn_no FROM latest GROUP BY 1 HAVING count(DISTINCT rta || ':' || coalesce(amc_code, '')) > 1) x`);
    const rcCrm = await one(sql`
      SELECT count(*)::int AS n FROM rta_staging_economic_txns e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_reason LIKE 'identity_conflict: the CRM holds a different transaction%'`);
    f.push({ key: "reference_collisions", title: "Registrar transaction numbers reused across AMCs / registrars", count: rc.n, risk: rc.n || rcCrm.n ? "high" : "low",
      detail: { stagedNumbersUnderSeveralAmcs: rc.n, heldBecauseTheCrmHoldsADifferentTransaction: rcCrm.n },
      examples: [],
      repair: "transactions.order_id is unique per firm, so a second AMC's transaction with the same number cannot be stored; validate-first holds it (never overwrites). Fix needs a schema change approved separately: a unique key on (tenant, registrar identity) instead of the bare number." });

    // 6. Line-keyed references from the pre-Phase-2 importer.
    const lk = await one(sql`SELECT count(*)::int AS n FROM transactions WHERE tenant_id = ${tenantId}::uuid AND order_id ~ '^(cams|kfintech|karvy)_[0-9]+$'`);
    f.push({ key: "line_keyed_refs", title: "Transactions keyed by file line (<rta>_<line>)", count: lk.n, risk: lk.n ? "high" : "low", examples: [],
      repair: "These may have overwritten each other across files. Re-import the original files validate-first into a review firm, match by registrar identity, and replace only rows whose identity is proved (keep the old rows soft-deleted for reversal)." });

    // 7. Switch / STP classifications the registrar's own words contradict (CAMS trxn_type_flag).
    const ss = await one(sql`
      SELECT count(*) FILTER (WHERE type = 'sip' AND upper(coalesce(raw_feed_row->>'trxn_type_flag', '')) ~ 'SWITCH')::int AS sip_but_switch,
             count(*) FILTER (WHERE type IN ('switch_in', 'switch_out', 'switch') AND upper(coalesce(raw_feed_row->>'trxn_nature', '')) LIKE 'SYSTEMATIC%' AND coalesce(raw_feed_row->>'siptrxnno', '') <> '')::int AS switch_but_stp,
             count(*) FILTER (WHERE type = 'stp' AND coalesce(raw_feed_row->>'siptrxnno', '') = '' AND raw_feed_row ? 'siptrxnno')::int AS stp_without_ref
        FROM transactions WHERE tenant_id = ${tenantId}::uuid AND status IN ('processed', 'successful')`);
    f.push({ key: "switch_stp", title: "Switch / STP classifications the registrar's text contradicts", count: ss.sip_but_switch + ss.switch_but_stp + ss.stp_without_ref, risk: ss.sip_but_switch + ss.switch_but_stp ? "medium" : "low",
      detail: { recordedSipButFlagSaysSwitch: ss.sip_but_switch, recordedSwitchButSystematicWithRef: ss.switch_but_stp, stpWithoutRegistrationRef: ss.stp_without_ref }, examples: [],
      repair: "Re-type only (type is not money): an audited UPDATE of transactions.type with the old value in audit_log; business figures re-run from the ledger. Reversible from the audit row." });

    // 8. Impossible or defaulted amounts and dates.
    const ad = await one(sql`
      SELECT count(*) FILTER (WHERE status IN ('processed', 'successful') AND coalesce(amount, 0) = 0 AND coalesce(units, 0) <> 0)::int AS zero_amount_with_units,
             count(*) FILTER (WHERE direction = 'inflow' AND amount < 0)::int AS negative_inflow,
             count(*) FILTER (WHERE order_date > (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS future_dated,
             count(*) FILTER (WHERE order_date = created_at::date AND source_feed IS DISTINCT FROM 'rta_validate_first' AND order_date > '2026-01-01')::int AS dated_on_import_day,
             count(*) FILTER (WHERE status IN ('processed', 'successful') AND type IN ('lumpsum', 'sip') AND nav > 0 AND units > 0 AND amount > 0
                              AND abs(units * nav - amount) > greatest(1, amount * 0.02))::int AS units_nav_amount_off
        FROM transactions WHERE tenant_id = ${tenantId}::uuid`);
    f.push({ key: "amounts_dates", title: "Impossible or defaulted amounts and dates", count: ad.zero_amount_with_units + ad.negative_inflow + ad.future_dated + ad.units_nav_amount_off, risk: ad.negative_inflow + ad.future_dated ? "high" : "medium",
      detail: { zeroAmountWithUnits: ad.zero_amount_with_units, negativeInflow: ad.negative_inflow, futureDated: ad.future_dated, datedOnImportDay: ad.dated_on_import_day, unitsTimesNavFarFromAmount: ad.units_nav_amount_off },
      examples: [],
      repair: "Never corrected in place from a guess: re-read the registrar row for the same identity (validate-first staging of the original file); replace the value only when the staged figure reconciles, with the old value in audit_log. 'Dated on import day' is a signal, not proof — some rows really are." });

    // 9. Holdings legs with no statement date, or older than their scope's newest statement.
    const hd = await one(sql`
      WITH legs AS (
        SELECT f.rta::text AS rta, leg->>'sourceAsOf' AS asof, leg->>'sourceArn' AS arn FROM folios f
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.schemes, '[]'::jsonb)) leg WHERE f.tenant_id = ${tenantId}::uuid)
      SELECT count(*) FILTER (WHERE asof IS NULL)::int AS undated,
             count(*) FILTER (WHERE asof IS NOT NULL AND asof < (SELECT max(l2.asof) FROM legs l2 WHERE l2.rta = legs.rta AND coalesce(l2.arn, '') = coalesce(legs.arn, '')))::int AS older_than_scope,
             count(*)::int AS legs
        FROM legs`);
    f.push({ key: "holdings_dates", title: "Holdings with no statement date, or older than their registrar's newest statement", count: hd.undated + hd.older_than_scope, risk: hd.undated ? "medium" : "low",
      detail: { legs: hd.legs, undated: hd.undated, olderThanScopeNewest: hd.older_than_scope }, examples: [],
      repair: "Import a current full-book statement per registrar × ARN (KFintech MFSD203; CAMS full-book holdings) — dated legs replace undated ones and an older statement never overwrites a newer one. No manual edit." });

    // 10. The same SIP recorded more than once.
    const ds = await one(sql`
      SELECT count(*)::int AS groups, coalesce(sum(n - 1), 0)::int AS extra
        FROM (SELECT count(*) AS n FROM sips WHERE tenant_id = ${tenantId}::uuid AND status IN ('active', 'pending', 'paused')
               GROUP BY investor_id, coalesce(folio_number, ''), coalesce(scheme_code, ''), amount, frequency HAVING count(*) > 1) x`);
    f.push({ key: "duplicate_sips", title: "The same live SIP recorded more than once", count: ds.groups, risk: ds.groups ? "medium" : "low",
      detail: { groups: ds.groups, extraRows: ds.extra }, examples: [],
      repair: "Two SIPs of the same amount and frequency in one scheme can be genuine. Mark duplicates only when a registrar registration (rta_sip_registrations) links one of them; stop the other with remarks (status change is audited and reversible)." });

    return { tenantId, at: new Date().toISOString(), findings: f.map((x) => ({ ...x, examples: x.examples.map((e) => JSON.parse(maskPan(JSON.stringify(e)) ?? "{}")) })) };
  });
}

async function main() {
  const tenant = arg("tenant");
  if (!tenant) { console.error("Usage: npx tsx scripts/rta-historical-diagnostics.ts --tenant <uuid> [--json out.json]"); process.exit(2); }
  const r = await diagnose(tenant);
  for (const x of r.findings) console.log(`${x.risk.toUpperCase().padEnd(6)} ${String(x.count).padStart(6)}  ${x.title}${x.detail ? `  ${JSON.stringify(x.detail)}` : ""}`);
  const out = arg("json");
  if (out) (await import("node:fs")).writeFileSync(out, JSON.stringify(r, null, 1));
  process.exit(0);
}
if (process.argv[1]?.endsWith("rta-historical-diagnostics.ts")) main().catch((e) => { console.error(String(e?.message ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>")); process.exit(1); });
