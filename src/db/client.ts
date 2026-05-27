import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
  // 40 is a sane default — Next.js dev forks per-route, each forks a request
  // worker, and `withTenant` opens a transaction. Raise via PG_POOL_MAX if
  // you see "remaining connection slots" or "too many clients" errors.
  max: Number(process.env.PG_POOL_MAX ?? 40),
  idleTimeoutMillis: 30_000,
  // Wait up to 5s for a free slot instead of hanging the request forever.
  connectionTimeoutMillis: 5_000,
});

// Disable Drizzle SQL query logging unless explicitly opted-in — in dev it
// adds ~30-100ms per query and floods stdout. Set DB_LOG=1 to re-enable.
export const db = drizzle(pool, { schema, logger: process.env.DB_LOG === "1" });

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
