/**
 * Hard-delete a tenant's client book so an RTA re-import starts from nothing.
 *
 * Deleting clients in the UI is a SOFT delete — the row stays, with deleted_at
 * set. That is fine for the UI, but it breaks a re-import: the tombstone still
 * occupies the (tenant_id, pan) unique index, so the importer's upsert UPDATES
 * the dead row instead of creating a live one. Every file then reports success
 * while the clients stay invisible.
 *
 * Removes: investors, folios, transactions, sips, and families left empty.
 * KEEPS:   rta_file_imports (they hold the file_key needed to re-import) and
 *          rta_forward_addresses (the firm's mailbox wiring).
 *
 *   npx tsx scripts/reset-tenant-book.ts --tenant <uuid>            # dry run
 *   npx tsx scripts/reset-tenant-book.ts --tenant <uuid> --commit
 *
 * Connects as APP_DATABASE_URL (mfd_app) so RLS applies, names tenant_id in
 * every statement anyway, and asserts the session can see exactly one tenant
 * before writing — other firms share this database.
 */
import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import "dotenv/config";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const TENANT = process.argv.includes("--tenant") ? process.argv[process.argv.indexOf("--tenant") + 1] : null;

const n = (v: unknown) => Number(v ?? 0);
const rowCount = (r: unknown) => Number((r as { rowCount?: number | null }).rowCount ?? 0);

async function connect(): Promise<pg.Client> {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("neither APP_DATABASE_URL nor DATABASE_URL is set");
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 120_000 });
  await c.connect();
  return c;
}

async function step(c: pg.Client, label: string, sql: string, params: unknown[]): Promise<void> {
  const t = Date.now();
  const r = await c.query(sql, params);
  console.log(`  ${label.padEnd(30)} ${String(rowCount(r)).padStart(8)} rows  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/reset-tenant-book.ts --tenant <uuid> [--commit]");
    process.exit(1);
  }
  if (COMMIT) await refuseIfRtaWritesStopped(TENANT, "reset-tenant-book");
  console.log(COMMIT ? "MODE: COMMIT — rows will be deleted" : "MODE: DRY RUN");

  const c = await connect();
  let committed = false;
  try {
    const who = (
      await c.query(`SELECT current_user AS role, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`)
    ).rows[0];
    console.log(`role: ${who.role}  superuser=${who.rolsuper}  bypassrls=${who.rolbypassrls}`);
    if (who.rolsuper || who.rolbypassrls) {
      throw new Error(`connected as '${who.role}', which bypasses RLS — refusing to run a destructive script without it. Set APP_DATABASE_URL.`);
    }

    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await c.query("SET LOCAL statement_timeout = '30min'");

    const pre = (
      await c.query(
        `SELECT COUNT(*)::int AS rows,
                COUNT(*) FILTER (WHERE tenant_id <> $1::uuid)::int AS foreign_rows,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted
           FROM investors`,
        [TENANT]
      )
    ).rows[0];
    console.log(`\nBefore: ${n(pre.rows)} investors (${n(pre.soft_deleted)} soft-deleted), foreign rows visible: ${n(pre.foreign_rows)}`);
    if (n(pre.foreign_rows) > 0) {
      throw new Error(`containment FAILED: ${n(pre.foreign_rows)} rows from other tenants visible. Refusing to write.`);
    }
    if (n(pre.rows) === 0) {
      console.log("nothing to reset");
      await c.query("ROLLBACK");
      return;
    }

    if (!COMMIT) {
      const counts = (
        await c.query(
          `SELECT (SELECT COUNT(*)::int FROM folios WHERE tenant_id=$1::uuid)       AS folios,
                  (SELECT COUNT(*)::int FROM transactions WHERE tenant_id=$1::uuid) AS transactions,
                  (SELECT COUNT(*)::int FROM sips WHERE tenant_id=$1::uuid)         AS sips,
                  (SELECT COUNT(*)::int FROM families WHERE tenant_id=$1::uuid)     AS families`,
          [TENANT]
        )
      ).rows[0];
      console.log(`Would delete: ${n(pre.rows)} investors, ${n(counts.folios)} folios, ${n(counts.transactions)} transactions, ${n(counts.sips)} sips, up to ${n(counts.families)} families`);
      console.log("\nDry run only. Re-run with --commit to apply.\n");
      await c.query("ROLLBACK");
      return;
    }

    console.log("\nDeleting");
    // Children before parents. All of these are wholly owned by the tenant.
    await step(c, "transactions", `DELETE FROM transactions WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(c, "sips", `DELETE FROM sips WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(c, "folios", `DELETE FROM folios WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(c, "investors", `DELETE FROM investors WHERE tenant_id = $1::uuid`, [TENANT]);
    await step(
      c,
      "families (now empty)",
      `DELETE FROM families f WHERE f.tenant_id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.family_id = f.id)`,
      [TENANT]
    );

    const after = (
      await c.query(
        `SELECT (SELECT COUNT(*)::int FROM investors WHERE tenant_id=$1::uuid)    AS clients,
                (SELECT COUNT(*)::int FROM folios WHERE tenant_id=$1::uuid)       AS folios,
                (SELECT COUNT(*)::int FROM transactions WHERE tenant_id=$1::uuid) AS transactions,
                (SELECT COUNT(*)::int FROM sips WHERE tenant_id=$1::uuid)         AS sips,
                (SELECT COUNT(*)::int FROM rta_file_imports WHERE tenant_id=$1::uuid) AS import_records`,
        [TENANT]
      )
    ).rows[0];
    console.log(
      `\nAfter: clients=${n(after.clients)} folios=${n(after.folios)} transactions=${n(after.transactions)} sips=${n(after.sips)}` +
        `  (import records kept: ${n(after.import_records)})`
    );
    if (n(after.clients) !== 0) throw new Error(`post-check FAILED: ${n(after.clients)} clients remain. Rolling back.`);

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
