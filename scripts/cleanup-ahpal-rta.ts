/**
 * One-off remediation for Ahpal Financial Services LLP.
 *
 * Wipes every client, folio, transaction and SIP the RTA imports created,
 * keeping ONLY the client master loaded on 2026-09-09 (8,568 rows: name,
 * address and RM on every one, no folios, zero AUM).
 *
 *   npx tsx scripts/cleanup-ahpal-rta.ts                  # dry run (default)
 *   npx tsx scripts/cleanup-ahpal-rta.ts --execute        # actually delete
 *
 * WHY: the CAMS monthly_aum_statement creates folios with a BLANK amc_code and
 * the folio-master upsert keys on (tenant, amc_code, folio_number), so every
 * folio landed twice under two different clients — 9,188 duplicated folios,
 * Rs 493.62 Cr double-counted. See scripts/diag-tenant-duplication.ts.
 *
 * DESIGN NOTES, all of them learned the hard way on this database:
 *
 *  · It connects as APP_DATABASE_URL (mfd_app), NOT DATABASE_URL (mfd_master).
 *    The master role has BYPASSRLS and sees all thirteen tenants; an earlier
 *    run connected as it and the containment assertion refused to proceed.
 *    The script now also hard-stops if the role can bypass RLS.
 *
 *  · Every statement names tenant_id explicitly. Five other firms share this
 *    database (46,801 folios, 217,856 transactions); RLS is the backstop, not
 *    the only guard.
 *
 *  · Timeouts are finite. An earlier version used statement_timeout = 0, hit a
 *    non-sargable predicate and left statements running 53 minutes server-side
 *    after their client had gone — three times, each needing a manual
 *    pg_terminate_backend.
 *
 *  · It is DELIBERATELY MINIMAL: ~10 statements. The previous version resolved
 *    every FK to investors and ran two EXISTS counts per table — ~60 queries
 *    before deleting anything — which never finished on this CPU-starved
 *    instance. The table list is fixed because it was measured, not guessed:
 *    only folios, sips and transactions hold rows for the delete set, and the
 *    keep set owns none of them.
 *
 * Requires APP_DATABASE_URL (preferred) or DATABASE_URL.
 */
import "dotenv/config";
import pg from "pg";

const TENANT = "47dcbd3c-a040-45a2-a1f1-3b98bab39117";
const TENANT_LABEL = "Ahpal Financial Services LLP";
/** Clients created on this UTC day are the client master and are KEPT. */
const KEEP_DAY = "2026-09-09";
const EXPECTED_KEEP = 8568;
const EXECUTE = process.argv.includes("--execute");

const n = (v: unknown) => Number(v ?? 0);
const cr = (v: unknown) => `${(n(v) / 1e7).toFixed(2)} Cr`;
const head = (t: string) => console.log(`\n${t}\n${"=".repeat(t.length)}`);

async function connect(): Promise<pg.Client> {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("neither APP_DATABASE_URL nor DATABASE_URL is set");
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 180_000 });
    const t = Date.now();
    try {
      await c.connect();
      console.log(`connected in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      return c;
    } catch (e) {
      try { await c.end(); } catch {}
      if (i >= 5) throw e;
      console.log(`  connect failed after ${((Date.now() - t) / 1000).toFixed(1)}s (${(e as Error).message}) — retry ${i}/4 in 10s`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

/** Run one statement, reporting how long it took — this instance is slow. */
async function step(c: pg.Client, label: string, sql: string, params: unknown[] = []): Promise<number> {
  const t = Date.now();
  const r = await c.query(sql, params);
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`  ${label.padEnd(38)} ${String(r.rowCount ?? 0).padStart(8)} rows  (${secs}s)`);
  return r.rowCount ?? 0;
}

async function main() {
  console.log(`\n${TENANT_LABEL}  [${TENANT}]`);
  console.log(EXECUTE ? "MODE: EXECUTE — rows will be deleted" : "MODE: DRY RUN — nothing will be written");

  const c = await connect();
  let committed = false;
  try {
    const who = (
      await c.query(`SELECT current_user AS role, r.rolsuper, r.rolbypassrls
                       FROM pg_roles r WHERE r.rolname = current_user`)
    ).rows[0];
    console.log(`role: ${who.role}  superuser=${who.rolsuper}  bypassrls=${who.rolbypassrls}`);
    if (who.rolsuper || who.rolbypassrls) {
      throw new Error(
        `connected as '${who.role}', which bypasses RLS — refusing to run a destructive script ` +
          `without RLS as a backstop. Set APP_DATABASE_URL to the mfd_app role and re-run.`
      );
    }

    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await c.query("SET LOCAL statement_timeout = '30min'");

    // ── Containment + keep-set assertions ────────────────────────────────
    const pre = (
      await c.query(
        `SELECT COUNT(*)::int                                                        AS total,
                COUNT(*) FILTER (WHERE tenant_id <> $1::uuid)::int                   AS foreign_rows,
                COUNT(*) FILTER (WHERE date_trunc('day', created_at)::date = $2::date)::int AS keep,
                COUNT(*) FILTER (WHERE date_trunc('day', created_at)::date <> $2::date)::int AS del,
                COALESCE(SUM(aum::numeric), 0)                                       AS aum
           FROM investors`,
        [TENANT, KEEP_DAY]
      )
    ).rows[0];

    head("Before");
    console.log(`  investors visible to this session   ${n(pre.total)}   (rows belonging to other tenants: ${n(pre.foreign_rows)})`);
    console.log(`  keep  — created ${KEEP_DAY}          ${n(pre.keep)}`);
    console.log(`  delete — every other day             ${n(pre.del)}   holding ${cr(pre.aum)}`);

    if (n(pre.foreign_rows) > 0) {
      throw new Error(`containment FAILED: ${n(pre.foreign_rows)} rows from other tenants are visible. Refusing to write.`);
    }
    if (n(pre.keep) !== EXPECTED_KEEP) {
      throw new Error(
        `keep set is ${n(pre.keep)}, expected ${EXPECTED_KEEP}. The data moved since this was planned — ` +
          `re-diagnose before running.`
      );
    }
    if (n(pre.del) === 0) throw new Error("nothing to delete — already clean?");
    console.log(`\n  assertions passed: no foreign rows, keep set is exactly ${EXPECTED_KEEP}`);

    if (!EXECUTE) {
      console.log("\nDry run only. Re-run with --execute to apply.\n");
      await c.query("ROLLBACK");
      return;
    }

    // ── Delete ───────────────────────────────────────────────────────────
    head("Deleting");

    // Stop new files landing first: deleting rta_file_imports also drops the
    // file_checksum dedup, so the poller would re-import what we just removed.
    await step(c, "pause mailback ingestion",
      `UPDATE rta_forward_addresses SET is_active = false, updated_at = now()
        WHERE tenant_id = $1::uuid AND is_active = true`, [TENANT]);

    // Children before parents. The keep set owns no rows in any of these
    // (measured), so they go wholesale for this tenant.
    await step(c, "transactions", `DELETE FROM transactions WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(c, "sips",         `DELETE FROM sips         WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(c, "folios",       `DELETE FROM folios       WHERE tenant_id = $1::uuid`, [TENANT]);

    await step(c, "investors (all but the keep set)",
      `DELETE FROM investors
        WHERE tenant_id = $1::uuid AND date_trunc('day', created_at)::date <> $2::date`, [TENANT, KEEP_DAY]);

    await step(c, "families left empty",
      `DELETE FROM families f
        WHERE f.tenant_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.family_id = f.id)`, [TENANT]);

    await step(c, "rta_file_imports", `DELETE FROM rta_file_imports WHERE tenant_id = $1::uuid`, [TENANT]);

    await step(c, "zero any residual AUM/SIP",
      `UPDATE investors SET aum = 0, active_sip_amount = 0, updated_at = now()
        WHERE tenant_id = $1::uuid
          AND (COALESCE(aum::numeric, 0) <> 0 OR COALESCE(active_sip_amount::numeric, 0) <> 0)`, [TENANT]);

    const after = (
      await c.query(
        `SELECT (SELECT COUNT(*)::int FROM investors WHERE tenant_id = $1::uuid)                  AS clients,
                (SELECT COALESCE(SUM(aum::numeric),0) FROM investors WHERE tenant_id = $1::uuid)  AS aum,
                (SELECT COUNT(*)::int FROM folios WHERE tenant_id = $1::uuid)                     AS folios,
                (SELECT COUNT(*)::int FROM transactions WHERE tenant_id = $1::uuid)               AS transactions,
                (SELECT COUNT(*)::int FROM sips WHERE tenant_id = $1::uuid)                       AS sips,
                (SELECT COUNT(*)::int FROM families WHERE tenant_id = $1::uuid)                   AS families`,
        [TENANT]
      )
    ).rows[0];
    head("After");
    console.log(`  clients=${n(after.clients)}  aum=${cr(after.aum)}  folios=${n(after.folios)}  transactions=${n(after.transactions)}  sips=${n(after.sips)}  families=${n(after.families)}`);

    if (n(after.clients) !== EXPECTED_KEEP) {
      throw new Error(`post-check FAILED: ${n(after.clients)} clients remain, expected ${EXPECTED_KEEP}. Rolling back.`);
    }

    await c.query("COMMIT");
    committed = true;
    console.log("\nCOMMITTED.\n");
  } catch (e) {
    if (!committed) {
      try { await c.query("ROLLBACK"); } catch {}
    }
    throw e;
  } finally {
    try { await c.end(); } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nfailed:", e?.message ?? e);
    process.exit(1);
  });
