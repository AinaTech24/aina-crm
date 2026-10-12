/**
 * READ-ONLY audit (Phase 3I): duplicates in each firm's Scheme Master left by
 * an AMC rename. scheme_master is unique on (tenant, amc_code, scheme_code)
 * and the Sync from AMFI route fills amc_code with AMFI's AMC NAME — so when
 * AMFI renames an AMC, the next sync adds a second row for the same AMFI scheme
 * code under the new name instead of updating the old one.
 *
 * This prints, per firm, every scheme code with more than one row, which row
 * matches AMFI's current AMC name (the proposed survivor), and what the other
 * rows carry that a cleanup would have to keep (shortlist, IC scorecard,
 * hand-set category / plan). It WRITES NOTHING: a cleanup is a reviewed,
 * separate change. Rows are never combined by a similar NAME — only by the
 * identical AMFI scheme code.
 *
 *   ALLOW_SYSTEM_TX=1 npx tsx scripts/scheme-master-duplicates.ts [--tenant <uuid>] [--json]
 */
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";

async function main() {
  const args = process.argv.slice(2);
  const tIdx = args.indexOf("--tenant");
  const tenant = tIdx >= 0 ? args[tIdx + 1] : null;
  if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) { console.error("--tenant must be a firm id"); process.exit(1); }
  const rows = await withSystem(async (tx) => (await tx.execute(sql`
    WITH d AS (
      SELECT tenant_id, scheme_code FROM scheme_master
       WHERE (${tenant}::uuid IS NULL OR tenant_id = ${tenant}::uuid)
       GROUP BY 1, 2 HAVING count(*) > 1)
    SELECT m.tenant_id::text AS tenant_id, m.scheme_code, m.id::text AS id, m.amc_code, m.scheme_name, n.amc_name AS amfi_amc, n.last_seen_feed::text AS amfi_last_seen,
           (m.amc_code = n.amc_name) AS matches_amfi, m.is_shortlisted, (m.evaluation IS NOT NULL) AS has_scorecard, m.updated_at::text AS updated_at
      FROM scheme_master m JOIN d USING (tenant_id, scheme_code)
      LEFT JOIN scheme_nav n ON n.scheme_code = m.scheme_code
     ORDER BY 1, 2, matches_amfi DESC, m.updated_at DESC`)).rows as any[]);
  const groups = new Map<string, any[]>();
  for (const r of rows) (groups.get(`${r.tenant_id}|${r.scheme_code}`) ?? groups.set(`${r.tenant_id}|${r.scheme_code}`, []).get(`${r.tenant_id}|${r.scheme_code}`)!).push(r);
  const proposals = [...groups.values()].map((g) => {
    const survivor = g.find((r) => r.matches_amfi) ?? null;
    return {
      tenantId: g[0].tenant_id, schemeCode: g[0].scheme_code, amfiAmc: g[0].amfi_amc, rows: g.length,
      proposedSurvivor: survivor?.id ?? null,
      reason: survivor ? "its AMC name is AMFI's current one" : "no row carries AMFI's current AMC name — review by hand",
      carryOver: g.filter((r) => r !== survivor && (r.is_shortlisted || r.has_scorecard)).map((r) => ({ id: r.id, amc: r.amc_code, shortlisted: r.is_shortlisted, scorecard: r.has_scorecard })),
    };
  });
  const byFirm = new Map<string, number>();
  for (const p of proposals) byFirm.set(p.tenantId, (byFirm.get(p.tenantId) ?? 0) + 1);
  if (args.includes("--json")) { console.log(JSON.stringify({ firms: Object.fromEntries(byFirm), proposals }, null, 2)); return; }
  console.log(`Scheme codes with more than one Scheme Master row: ${proposals.length} across ${byFirm.size} firm(s). Nothing was changed.`);
  for (const [t, n] of byFirm) console.log(`  firm ${t}: ${n}`);
  console.log(`  no row on AMFI's current AMC name (review by hand): ${proposals.filter((p) => !p.proposedSurvivor).length}`);
  console.log(`  groups where a non-survivor carries a shortlist or IC scorecard: ${proposals.filter((p) => p.carryOver.length).length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
