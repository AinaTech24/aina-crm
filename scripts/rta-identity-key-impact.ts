/**
 * READ-ONLY historical-impact report for the two legacy identity-key formats
 * (Phase 3E, Task D). It changes nothing: the whole run is one READ ONLY
 * transaction, and it prints counts only — no PAN, name, folio or client id.
 *
 *   MINOR:<guardian PAN>:<NAME>   a minor keyed on its guardian's PAN + name
 *   NOPAN:FOLIO:<folio>           a placeholder keyed on the folio number
 *                                 alone, without the AMC
 *
 * What each key would need before a reviewed migration to the owner rules
 * (folio-keyed provisional identity `FOLIO:<rta>:<amc>:<folio>`):
 *   - how many clients, folios, transactions, SIPs and SIP rejections hang
 *     off each format;
 *   - MINOR keys with no guardian link, or whose guardian PAN is not a client;
 *   - MINOR keys whose folios span registrars (one name key, several sources);
 *   - NOPAN placeholders whose folio number exists at more than one AMC
 *     (the key cannot tell those folios apart), or under another client.
 *
 *   tsx scripts/rta-identity-key-impact.ts [--tenant <uuid>]
 */
import pg from "pg";

async function main() {
  const url = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ti = process.argv.indexOf("--tenant");
  const tenant = ti > 0 ? process.argv[ti + 1] : null;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL app.is_platform_admin = 'true'");
    const t = tenant ? "AND i.tenant_id = $1::uuid" : "";
    const args = tenant ? [tenant] : [];
    const one = async (q: string) => (await client.query(q, args)).rows[0];
    const minor = await one(`
      WITH k AS (
        SELECT i.* FROM investors i WHERE i.pan LIKE 'MINOR:%' ${t}
      )
      SELECT
        count(*)::int AS clients,
        count(*) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL)::int AS live,
        count(*) FILTER (WHERE merged_into_id IS NOT NULL)::int AS merged,
        count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS in_trash,
        count(*) FILTER (WHERE guardian_investor_id IS NULL)::int AS no_guardian_link,
        count(*) FILTER (WHERE pan ~ '^MINOR:[A-Z]{5}[0-9]{4}[A-Z]:' AND NOT EXISTS (
          SELECT 1 FROM investors g WHERE g.tenant_id = k.tenant_id AND g.pan = split_part(k.pan, ':', 2)))::int AS guardian_pan_not_a_client,
        count(*) FILTER (WHERE pan !~ '^MINOR:[A-Z]{5}[0-9]{4}[A-Z]:')::int AS key_without_guardian_pan,
        (SELECT count(*) FROM folios f JOIN k ON k.id = f.investor_id)::int AS folios,
        (SELECT count(*) FROM (SELECT f.investor_id FROM folios f JOIN k ON k.id = f.investor_id GROUP BY 1 HAVING count(DISTINCT f.rta) > 1) x)::int AS clients_spanning_registrars,
        (SELECT count(*) FROM transactions x JOIN k ON k.id = x.investor_id)::int AS transactions,
        (SELECT count(*) FROM sips x JOIN k ON k.id = x.investor_id)::int AS sips,
        (SELECT count(*) FROM sip_rejections x JOIN k ON k.id = x.investor_id)::int AS sip_rejections
      FROM k`);
    const nopan = await one(`
      WITH k AS (
        SELECT i.* FROM investors i WHERE i.rta_nopan_key LIKE 'NOPAN:FOLIO:%' ${t}
      ), kf AS (
        SELECT k.id, k.tenant_id, substr(k.rta_nopan_key, 13) AS folio_number FROM k
      )
      SELECT
        count(*)::int AS clients,
        count(*) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL)::int AS live,
        count(*) FILTER (WHERE merged_into_id IS NOT NULL)::int AS merged,
        count(*) FILTER (WHERE pan IS NOT NULL)::int AS with_pan_now,
        (SELECT count(*) FROM folios f JOIN k ON k.id = f.investor_id)::int AS folios,
        (SELECT count(*) FROM kf WHERE (SELECT count(DISTINCT f.amc_code) FROM folios f WHERE f.tenant_id = kf.tenant_id AND f.folio_number = kf.folio_number) > 1)::int AS folio_number_at_several_amcs,
        (SELECT count(*) FROM kf WHERE EXISTS (SELECT 1 FROM folios f WHERE f.tenant_id = kf.tenant_id AND f.folio_number = kf.folio_number AND f.investor_id <> kf.id))::int AS folio_number_also_under_another_client,
        (SELECT count(*) FROM folios f JOIN k ON k.id = f.investor_id WHERE COALESCE(f.amc_code, '') = '')::int AS folios_without_amc,
        (SELECT count(*) FROM transactions x JOIN k ON k.id = x.investor_id)::int AS transactions,
        (SELECT count(*) FROM sips x JOIN k ON k.id = x.investor_id)::int AS sips,
        (SELECT count(*) FROM sip_rejections x JOIN k ON k.id = x.investor_id)::int AS sip_rejections
      FROM k`);
    console.log(JSON.stringify({ scope: tenant ? "one tenant" : "all tenants", readOnly: true, minorKeys: minor, nopanFolioKeys: nopan }, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>"));
  process.exit(1);
});
