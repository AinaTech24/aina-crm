import IORedis from "ioredis";
import { sql } from "drizzle-orm";
import { withTenant, withSystem } from "@/db/client";
import { workersHealthy, type WorkerHeartbeat } from "./worker-health";

export async function probeDatabaseIsolation(tenantId: string): Promise<boolean | null> {
  try {
    return await withTenant(tenantId, async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '3s'`);
      const role = (await tx.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
      if (!role || role.rolsuper || role.rolbypassrls) return false;
      const coverage = (await tx.execute(sql`SELECT count(*)::int AS unsafe FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`)).rows[0];
      const scope = (await tx.execute(sql`SELECT current_setting('app.tenant_id', true) AS tenant,
        EXISTS(SELECT 1 FROM investors WHERE tenant_id <> ${tenantId}::uuid) AS leaked`)).rows[0];
      return Number(coverage?.unsafe) === 0 && scope?.tenant === tenantId && scope.leaked === false;
    });
  } catch { return null; }
}
export async function probeRedis(): Promise<boolean | null> {
  if (!process.env.REDIS_URL) return false;
  const connection = new IORedis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000, commandTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false });
  connection.on("error", () => {});
  try { await connection.connect(); return await connection.ping() === "PONG"; }
  catch { return false; }
  finally { connection.disconnect(); }
}
export async function probeWorkers(): Promise<boolean | null> {
  try {
    return await withSystem(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '3s'`);
      const rows = await tx.execute(sql`SELECT job_name, last_run_status, last_heartbeat_at FROM scheduler_state WHERE job_name LIKE 'worker:%'`);
      return workersHealthy(rows.rows as WorkerHeartbeat[]);
    });
  } catch { return null; }
}
