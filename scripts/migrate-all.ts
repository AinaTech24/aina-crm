/**
 * migrate:all — the single source of truth for applying the hand-written
 * SQL migrations under drizzle/migrations/*.sql.
 *
 * Why this exists: the repo accumulated ~30 numbered SQL files (RLS,
 * perf indexes, every feature table since 0001) that were applied
 * one-by-one via scripts/apply-migration.ts with NO record of what ran.
 * A fresh DB rebuild had no way to know the correct order or what was
 * already applied. This runner fixes that:
 *
 *   1. Ensures a `_applied_migrations` ledger table exists.
 *   2. Lists drizzle/migrations/*.sql sorted by filename (zero-padded
 *      numeric prefix → lexicographic == chronological).
 *   3. Applies each file NOT already in the ledger, inside its own
 *      transaction, then records { filename, checksum, applied_at }.
 *   4. If a file's checksum changed after it was applied, or an applied file
 *      is gone, it BLOCKS: nothing is applied and it exits 2 (Phase 3H — an
 *      applied migration is immutable; a correction is a NEW migration). The
 *      only exception is an exact (ledger, file) checksum pair listed in
 *      drizzle/migrations/drift-acknowledged.json, which goes through review.
 *   5. Every attempt is logged in `_migration_runs`; a `-- migrate:no-transaction`
 *      file whose attempt did not finish is reported as PARTIAL and blocks
 *      until an operator inspects it and re-runs with --resume <file>.
 *
 * Idempotent: re-running applies only new files. Safe in CI + prod.
 *
 * Usage:
 *   npm run migrate:all                apply all pending
 *   npm run migrate:all -- --dry       list pending without applying
 *   npm run migrate:all -- --check     release gate: report drift / missing /
 *                                      partial / pending; exit 2 on a blocker
 *   npm run migrate:all -- --until <f> apply pending files up to and including f
 *   npm run migrate:all -- --resume <f> allow a partly-applied no-transaction file to re-run
 *   npm run migrate:all -- --baseline  record pending files as applied WITHOUT
 *                                      running them — for adopting the ledger
 *                                      on a DB that was already migrated the
 *                                      old one-by-one way. Apply any genuinely
 *                                      new files first, then baseline.
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { splitStatements } from "./lib/sql-split";
import { migrationChecksum, planMigrations, type DriftAck, type RunRow } from "./lib/migration-plan";

// This runner applies schema/RLS migrations cross-tenant, so it legitimately
// needs system (RLS-bypassing) DB access. withSystem() is gated by this flag;
// default it on for the migrator unless the operator explicitly disabled it.
// (Read at call-time inside withSystem, so setting it here is sufficient.)
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

// NOTE: db/client.ts is imported DYNAMICALLY inside main() (not here), because
// it picks its connection string at module-load time and prefers
// APP_DATABASE_URL — the restricted runtime role that lacks DDL. Migrations
// need DDL, so we force the privileged DATABASE_URL first, then import.

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");
const DRY = process.argv.includes("--dry");
/**
 * --baseline: adopt the ledger on a DB that is ALREADY migrated. Records every
 * on-disk migration as applied WITHOUT executing it. Use this exactly once when
 * introducing the ledger on an existing database (ours already had 0001-00xx
 * applied the old one-by-one way, and several early files aren't idempotent so
 * re-running them would error). After baselining, plain `migrate:all` applies
 * only genuinely-new files.
 */
const BASELINE = process.argv.includes("--baseline");
const CHECK = process.argv.includes("--check");
const argAfter = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? null : process.argv[i + 1] ?? null; };
const UNTIL = argAfter("--until");
const RESUME = process.argv.flatMap((a, i) => (a === "--resume" && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const ACKS_FILE = join(MIGRATIONS_DIR, "drift-acknowledged.json");

const checksum = migrationChecksum;
const isNoTx = (text: string) => /^--\s*migrate:no-transaction\s*$/m.test(text);

async function main() {
  // Migrations need DDL — always connect as the privileged role (DATABASE_URL),
  // even when APP_DATABASE_URL (the restricted runtime role) is also set. Point
  // the shared client at the master URL BEFORE importing it (it reads the
  // connection string at module load).
  if (process.env.DATABASE_URL) process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
  // Declared tooling (src/db/runtime-role.ts): the only process allowed the migration role.
  process.env.DB_TOOLING = "1";
  const { withSystem, pool } = await import("../src/db/client");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !UNTIL || f <= UNTIL)
    .sort(); // zero-padded numeric prefixes sort chronologically

  await withSystem(async (tx) => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS _applied_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Every attempt, so a no-transaction file that died half-way is visible.
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS _migration_runs (
        id bigserial PRIMARY KEY,
        filename text NOT NULL,
        checksum text NOT NULL,
        no_transaction boolean NOT NULL DEFAULT false,
        status text NOT NULL CHECK (status IN ('started', 'failed', 'done')),
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        error text
      )
    `);
  });

  const appliedRows = await withSystem(async (tx) =>
    (
      await tx.execute(sql`SELECT filename, checksum FROM _applied_migrations`)
    ).rows as Array<{ filename: string; checksum: string }>
  );

  const runs = await withSystem(async (tx) =>
    ((await tx.execute(sql`SELECT filename, checksum, status, no_transaction FROM _migration_runs ORDER BY id`)).rows as any[])
      .map((r): RunRow => ({ filename: r.filename, checksum: r.checksum, status: r.status, noTransaction: r.no_transaction }))
  );
  let acks: DriftAck[] = [];
  if (existsSync(ACKS_FILE)) acks = JSON.parse(readFileSync(ACKS_FILE, "utf8"));
  // With --until the files after it are simply not considered (an older database).
  const fileFacts = files.map((f) => {
    const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    return { filename: f, checksum: checksum(text), noTransaction: isNoTx(text) };
  });
  const ledgerInScope = UNTIL ? appliedRows.filter((r) => r.filename <= UNTIL) : appliedRows;
  const plan = planMigrations({ files: fileFacts, ledger: ledgerInScope, runs, acks, resume: RESUME });
  const pending = plan.pending;
  for (const d of plan.drift.filter((x) => x.acknowledged)) {
    console.warn(`[migrate] ${d.filename}: checksum ${d.ledgerChecksum} → ${d.fileChecksum} acknowledged in drift-acknowledged.json`);
  }
  for (const f of plan.rolledBack) console.warn(`[migrate] ${f}: a previous attempt failed and was rolled back — it is pending again`);
  if (plan.blockers.length) {
    console.error(`[migrate] ✗ BLOCKED — ${plan.blockers.length} problem(s); nothing was applied:`);
    for (const b of plan.blockers) console.error(`    ✗ ${b}`);
    process.exit(2);
  }
  if (CHECK) {
    console.log(`[migrate] check: ${appliedRows.length} applied, ${pending.length} pending, ${plan.drift.length} acknowledged drift, 0 blockers.`);
    for (const f of pending) console.log(`    + ${f}`);
    process.exit(0);
  }

  // Bootstrap gate. A file whose header carries
  //     -- migrate:skip-if-table-exists <table>
  // recreates schema that existing databases got from `drizzle-kit push`
  // (0000_base_schema.sql → tenants, 0044a_financial_plans.sql → financial_plans).
  // Where that table already exists (production, every dev DB) record the file
  // as applied WITHOUT executing it — the SQL is guarded anyway, but a later
  // migration may have dropped a constraint it would otherwise re-add. Only an
  // empty database actually runs it.
  for (const f of [...pending]) {
    const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const m = text.slice(0, 2000).match(/^--\s*migrate:skip-if-table-exists\s+([a-z_][a-z0-9_]*)\s*$/m);
    if (!m) continue;
    const table = m[1];
    const exists = await withSystem(async (tx) => {
      const r = await tx.execute(sql`SELECT to_regclass(${"public." + table}) IS NOT NULL AS ok`);
      return Boolean((r.rows[0] as { ok?: boolean } | undefined)?.ok);
    });
    if (!exists) continue;
    if (!DRY) {
      const cs = checksum(text);
      await withSystem(async (tx) => {
        await tx.execute(sql`
          INSERT INTO _applied_migrations (filename, checksum)
          VALUES (${f}, ${cs})
          ON CONFLICT (filename) DO NOTHING
        `);
      });
    }
    console.log(
      `[migrate] ${f}: ${table} already exists — ${DRY ? "would be" : ""} recorded as applied without executing.`
    );
    pending.splice(pending.indexOf(f), 1);
  }

  if (pending.length === 0) {
    console.log("[migrate] up to date — nothing to apply.");
    process.exit(0);
  }

  // --baseline: record pending files as applied WITHOUT running them. For
  // adopting the ledger on an already-migrated DB. (Apply any genuinely-new
  // files the normal way FIRST, then baseline — never baseline a file whose
  // SQL hasn't actually run against this database.)
  if (BASELINE) {
    console.log(`[migrate] --baseline: recording ${pending.length} file(s) as applied WITHOUT executing:`);
    for (const f of pending) {
      const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      const cs = checksum(text);
      await withSystem(async (tx) => {
        await tx.execute(sql`
          INSERT INTO _applied_migrations (filename, checksum)
          VALUES (${f}, ${cs})
          ON CONFLICT (filename) DO NOTHING
        `);
      });
      console.log(`    = ${f}`);
    }
    console.log(`[migrate] baseline complete — ledger now tracks ${pending.length} file(s).`);
    process.exit(0);
  }

  console.log(`[migrate] ${pending.length} pending:`);
  for (const f of pending) console.log(`    + ${f}`);

  if (DRY) {
    console.log("[migrate] --dry: not applying.");
    process.exit(0);
  }

  for (const f of pending) {
    const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const cs = checksum(text);
    process.stdout.write(`[migrate] applying ${f} … `);
    // Run the file on a RAW pg client, not through drizzle.
    //
    // drizzle's execute() goes down node-postgres' EXTENDED query protocol,
    // and that protocol permits exactly one statement per message — so a file
    // with two statements fails, whatever they are. Verified: even
    // "CREATE TABLE a (id int); CREATE TABLE b (id int);" is rejected. Every
    // migration here is multi-statement, which is why this runner has never
    // been able to apply one and why CI's "Migrate · RLS coverage" job has
    // never gone green. It went unnoticed because production's history was
    // adopted with --baseline (recorded, never executed).
    //
    // client.query(string) uses the SIMPLE protocol, which is what psql uses
    // and what multi-statement SQL requires. Errors also arrive intact instead
    // of being truncated into drizzle's "Failed query: …" wrapper.
    //
    // A file whose header carries
    //     -- migrate:no-transaction
    // is applied statement by statement with NO surrounding transaction. Some
    // statements simply cannot run inside one — `CREATE INDEX CONCURRENTLY`
    // being the case that forced this — and a multi-statement simple query is
    // itself an implicit transaction, so the statements must also be sent
    // separately. Such a file gives up all-or-nothing: it MUST be written so a
    // re-run after a partial failure is safe (IF NOT EXISTS, and clean up
    // anything a failed attempt leaves behind).
    // Scanned over the whole file, not just the header: the marker changes how
    // the file is APPLIED, so missing it because a header ran long would fail in
    // a way that reads like a SQL bug.
    const noTx = isNoTx(text);
    const client = await pool.connect();
    // Logged OUTSIDE the migration's transaction, so a failure or a killed
    // process still leaves the attempt on record.
    const runId = (await client.query(
      `INSERT INTO _migration_runs (filename, checksum, no_transaction, status) VALUES ($1, $2, $3, 'started') RETURNING id`,
      [f, cs, noTx]
    )).rows[0].id;
    try {
      if (noTx) {
        await client.query("SELECT set_config('app.is_platform_admin', 'true', false)");
        for (const stmt of splitStatements(text)) await client.query(stmt);
      } else {
        await client.query("BEGIN");
        // Mirror withSystem(): the platform-admin branch of every RLS policy.
        await client.query("SELECT set_config('app.is_platform_admin', 'true', true)");
        await client.query(text);
      }
      // A pending file is never in the ledger, so this never overwrites an
      // applied checksum (that would erase the evidence the plan relies on).
      await client.query(
        `INSERT INTO _applied_migrations (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [f, cs]
      );
      if (!noTx) await client.query("COMMIT");
      await client.query(`UPDATE _migration_runs SET status = 'done', finished_at = now() WHERE id = $1`, [runId]);
      console.log("ok");
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query(`UPDATE _migration_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
        [runId, String(err?.message ?? err).slice(0, 2000)]).catch(() => {});
      console.log("FAILED");
      // Postgres reports the position; surface it so the failing statement is
      // findable rather than guessed at.
      console.error(`  ${err?.message ?? err}`);
      if (err?.position) console.error(`  at character ${err.position}`);
      if (err?.detail) console.error(`  detail: ${err.detail}`);
      if (err?.hint) console.error(`  hint: ${err.hint}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  console.log(`[migrate] done — applied ${pending.length} migration(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] fatal:", err?.message ?? err);
  process.exit(1);
});
