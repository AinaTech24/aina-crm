import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

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
    // Wait up to 5s for a free slot instead of hanging the request forever.
    connectionTimeoutMillis: 5_000,
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
    await tx.execute(
      // SET LOCAL only persists for this transaction
      `SELECT set_config('app.tenant_id', '${escape(tenantId)}', true)` as any
    );
    if (opts?.userId) {
      await tx.execute(
        `SELECT set_config('app.user_id', '${escape(opts.userId)}', true)` as any
      );
    }
    if (opts?.branchId) {
      await tx.execute(
        `SELECT set_config('app.branch_id', '${escape(opts.branchId)}', true)` as any
      );
    }
    if (opts?.roles?.length) {
      await tx.execute(
        `SELECT set_config('app.roles', '${escape(opts.roles.join(","))}', true)` as any
      );
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
    await tx.execute(
      `SELECT set_config('app.is_platform_admin', 'true', true)` as any
    );
    await tx.execute(
      `SELECT set_config('app.user_id', '${escape(adminUserId)}', true)` as any
    );
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
    // We're connected as the postgres superuser already; just disable RLS
    // for the duration of this transaction by setting is_platform_admin.
    await tx.execute(`SELECT set_config('app.is_platform_admin', 'true', true)` as any);
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
