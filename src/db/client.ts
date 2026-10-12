import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

import { describeUrl, inspectRole, isBuildPhase, isProductionEnv, resolveDatabaseConnection, roleProblems, RuntimeDatabaseError, type RoleReport } from "./runtime-role";

// Which role the runtime connects as (final security patch — runtime-role.ts):
// APP_DATABASE_URL, the restricted application role. In production there is NO
// fallback to DATABASE_URL (the migration role): a missing APP_DATABASE_URL
// refuses to start, with a non-secret diagnostic. Migration tooling declares
// itself with DB_TOOLING=1 (scripts/migrate-all.ts). Outside production
// (development, CI, isolated rehearsal databases) the fallback stays, loudly.
// `||` not `??` in the policy: an EMPTY APP_DATABASE_URL means "not provided"
// (the DB-backed tests set it to "" to use DATABASE_URL).
const connection = resolveDatabaseConnection(process.env);
if (!connection.ok) {
  throw new RuntimeDatabaseError("database connection", [connection.reason], describeUrl(process.env.APP_DATABASE_URL || process.env.DATABASE_URL));
}
if (connection.warning && process.env.DB_QUIET !== "1") console.warn(`[db] ${connection.warning}`);
const connectionString = connection.url;
export const connectionSource = connection.source;

/**
 * HMR-safe singleton for the pg pool + drizzle client.
 *
 * Next.js dev mode reloads modules on every file change. Without this guard
 * a NEW Pool is created for every reload, the OLD pool keeps its sockets
 * open, and within a few HMR cycles the Node process is holding hundreds of
 * dangling connections — pool.connect() then waits for the timeout because
 * the OLD pool's slots are stuck.
 *
 * Stashing the pool on globalThis means HMR re-imports the same instance.
 * Only the very first module load creates a new pool; subsequent reloads
 * find it on `globalThis.__mfd_pg_pool` and reuse it.
 */
declare global {
  // eslint-disable-next-line no-var
  var __mfd_pg_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mfd_db: ReturnType<typeof drizzle<typeof schema>> | undefined;
  // eslint-disable-next-line no-var
  var __mfd_db_role_checked: boolean | undefined;
}

export const pool: Pool =
  globalThis.__mfd_pg_pool ??
  new Pool({
    connectionString,
    // 20 is plenty for a single-tenant dev box. Production scales horizontally
    // via more app replicas, not bigger pools. Raise via PG_POOL_MAX if you
    // legitimately need more (and have the Postgres slots to back it).
    max: Number(process.env.PG_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    // Wait up to 12s for a free slot before failing — 5s was too tight under
    // transient contention (e.g. an RTA import running while the dialog polls
    // status), which surfaced as a 500 "Connection terminated" on upload.
    //
    // Raise via PG_CONNECT_TIMEOUT_MS for maintenance scripts run against a
    // CPU-throttled instance, where even the TLS handshake can exceed 12s and
    // the script dies at connect rather than doing any work.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 12_000),
    // If a connection sits with an open transaction for > 30s, kill it —
    // protects against zombie connections from crashed routes.
    statement_timeout: 30_000,
  });

if (!globalThis.__mfd_pg_pool) {
  globalThis.__mfd_pg_pool = pool;
  // Surface pool errors so a runaway query doesn't silently exhaust the pool.
  pool.on("error", (err) => {
    console.error("[pg pool] idle client error:", err.message);
  });
}

// Disable Drizzle SQL query logging unless explicitly opted-in — in dev it
// adds ~30-100ms per query and floods stdout. Set DB_LOG=1 to re-enable.
export const db: ReturnType<typeof drizzle<typeof schema>> =
  globalThis.__mfd_db ?? drizzle(pool, { schema, logger: process.env.DB_LOG === "1" });

if (!globalThis.__mfd_db) {
  globalThis.__mfd_db = db;
}

export type DbClient = typeof db;

/**
 * SECURITY: the role this process is connected as, and whether the runtime may
 * use it (runtime-role.ts roleProblems): no superuser, BYPASSRLS, CREATEROLE,
 * ownership (direct or through membership), privileged membership, trigger-
 * skipping or dangerous table privilege.
 *
 * `assertRuntimeDatabase(kind)` is AWAITED by the web server (instrumentation)
 * and the worker before they serve anything. In production a problem — or
 * DB_TOOLING set on a runtime process — throws RuntimeDatabaseError (the
 * caller exits non-zero with the diagnostics); outside production it warns.
 * There is no override in production (ALLOW_SUPERUSER_DB is ignored there).
 */
export async function assertRuntimeDatabase(kind: "web" | "worker", env: NodeJS.ProcessEnv = process.env): Promise<RoleReport> {
  const target = describeUrl(connectionString);
  const problems: string[] = [];
  if (env.DB_TOOLING === "1") problems.push("DB_TOOLING=1 is set: tooling credentials are for migrations, never for the web or worker process");
  if (connectionSource === "development_fallback") problems.push("APP_DATABASE_URL is not set (connected with DATABASE_URL)");
  const report = await inspectRole((text, params) => pool.query(text, params));
  problems.push(...roleProblems(report));
  if (!problems.length) return report;
  const production = isProductionEnv(env) && !isBuildPhase(env);
  if (production) throw new RuntimeDatabaseError(kind, problems, target);
  if (env.ALLOW_SUPERUSER_DB !== "1" && env.DB_QUIET !== "1") {
    console.warn(`[db] SECURITY (${kind}, development only — production refuses this): connected to ${target}:\n  - ${problems.join("\n  - ")}`);
  }
  return report;
}

/** Fire-and-forget check for any other entry point (scripts, routes loaded before instrumentation). */
async function checkRoleOnLoad(): Promise<void> {
  if (connectionSource === "tooling") return; // migrations: privileged by design
  try {
    const report = await inspectRole((text, params) => pool.query(text, params));
    const problems = roleProblems(report);
    if (!problems.length) return;
    const msg = `[db] SECURITY: connected to ${describeUrl(connectionString)}:\n  - ${problems.join("\n  - ")}`;
    if (isProductionEnv(process.env) && !isBuildPhase(process.env)) {
      console.error(msg + "\nRefusing to run in production.");
      process.exit(1);
    } else if (process.env.ALLOW_SUPERUSER_DB !== "1" && process.env.DB_QUIET !== "1") {
      console.warn(msg);
    }
  } catch {
    // The awaited startup checks (instrumentation, worker) are the gate; this one never breaks a script.
  }
}

if (!globalThis.__mfd_db_role_checked) {
  globalThis.__mfd_db_role_checked = true;
  void checkRoleOnLoad();
}

/**
 * Run `fn` inside a transaction with the tenant_id (and optional user/branch)
 * set as Postgres session variables. Every RLS policy reads
 * `current_setting('app.tenant_id')` to scope rows.
 *
 * Use this from API routes, server actions, and worker jobs. Never call
 * `db.transaction(...)` directly outside a system-context (admin) path —
 * RLS will block your queries with NO informative error.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  opts?: { userId?: string; branchId?: string; roles?: string[] }
): Promise<T> {
  return db.transaction(async (tx) => {
    // Parameterized set_config (transaction-LOCAL). MUST use a drizzle `sql`
    // object — a raw string passed to tx.execute() is NOT reliably executed
    // under the bundled runtime, which silently leaves the RLS context unset.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    if (opts?.userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${opts.userId}, true)`);
    }
    if (opts?.branchId) {
      await tx.execute(sql`SELECT set_config('app.branch_id', ${opts.branchId}, true)`);
    }
    if (opts?.roles?.length) {
      await tx.execute(sql`SELECT set_config('app.roles', ${opts.roles.join(",")}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Platform admin transaction — sets `app.is_platform_admin = true` so RLS
 * policies grant cross-tenant access. Used by AINA super admins to manage
 * all MFD tenants from the /super-admin section.
 *
 * adminUserId is the AINA staff user id; recorded in audit_log for every
 * cross-tenant write.
 */
export async function withPlatformAdmin<T>(
  adminUserId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'true', true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${adminUserId}, true)`);
    return fn(tx);
  });
}

/**
 * System-level transaction that bypasses RLS — only for cross-tenant maintenance,
 * background reconciliation, and admin tooling. Guarded by env flag.
 */
export async function withSystem<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (process.env.ALLOW_SYSTEM_TX !== "1") {
    throw new Error("withSystem disabled — set ALLOW_SYSTEM_TX=1 to enable");
  }
  return db.transaction(async (tx) => {
    // Grant cross-tenant access for this transaction via the platform-admin
    // branch of every RLS policy (works whether or not the connecting role is
    // a superuser).
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'true', true)`);
    return fn(tx);
  });
}

// Prevent SQL injection via tenant id (uuid only, but defense in depth).
function escape(v: string): string {
  if (!/^[0-9a-zA-Z_,\-]+$/.test(v)) {
    throw new Error(`Invalid session value: ${v}`);
  }
  return v;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
