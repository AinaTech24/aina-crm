/** Node-only, fail-closed checks. Never cache a positive authorization: another
 * replica may revoke the account/device between two requests. */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

export async function isSessionRevoked(opts: {
  userId: string; tenantId: string; iatSeconds?: number;
}): Promise<boolean> {
  if (!opts.iatSeconds || !opts.userId || !opts.tenantId) return true;
  try {
    return await withTenant(opts.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT u.sessions_invalid_after, u.status, u.deleted_at, t.deleted_at AS tenant_deleted_at
        FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = ${opts.userId} AND u.tenant_id = ${opts.tenantId} LIMIT 1
      `);
      const row = r.rows[0] as {
        sessions_invalid_after: string | null; status: string;
        deleted_at: string | null; tenant_deleted_at: string | null;
      } | undefined;
      if (!row || row.status !== "active" || row.deleted_at || row.tenant_deleted_at) return true;
      return !!row.sessions_invalid_after && opts.iatSeconds! * 1000 < new Date(row.sessions_invalid_after).getTime();
    });
  } catch { return true; }
}

export async function isDeviceSessionRevoked(opts: {
  sid?: string; tenantId: string; userId?: string;
}): Promise<boolean> {
  if (!opts.sid || !opts.tenantId) return true;
  try {
    return await withTenant(opts.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT user_id, revoked_at FROM user_sessions
        WHERE session_id = ${opts.sid} AND tenant_id = ${opts.tenantId} LIMIT 1
      `);
      const row = r.rows[0] as { user_id: string; revoked_at: string | null } | undefined;
      if (!row || row.revoked_at || (opts.userId && row.user_id !== opts.userId)) return true;
      await tx.execute(sql`
        UPDATE user_sessions SET last_seen_at = now()
        WHERE session_id = ${opts.sid} AND revoked_at IS NULL
          AND last_seen_at < now() - interval '1 minute'
      `);
      return false;
    });
  } catch { return true; }
}

/**
 * Both checks above in ONE transaction and ONE query — what every request
 * runs (getSession). Same rules, fail-closed the same way: the account (user
 * active, not deleted, tenant not deleted, token issued after
 * sessions_invalid_after) AND the device session (exists, not revoked, same
 * user). The presence touch is sent only when last_seen_at is a minute old.
 * Separately they cost two transactions (~9 round trips) per request.
 */
export async function isSessionOrDeviceRevoked(opts: {
  userId: string; tenantId: string; iatSeconds?: number; sid?: string;
}): Promise<boolean> {
  if (!opts.iatSeconds || !opts.userId || !opts.tenantId || !opts.sid) return true;
  try {
    return await withTenant(opts.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT u.sessions_invalid_after, u.status, u.deleted_at, t.deleted_at AS tenant_deleted_at,
               s.user_id AS session_user_id, s.revoked_at AS session_revoked_at,
               (s.last_seen_at < now() - interval '1 minute') AS touch
        FROM users u JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN user_sessions s ON s.session_id = ${opts.sid} AND s.tenant_id = ${opts.tenantId}
        WHERE u.id = ${opts.userId} AND u.tenant_id = ${opts.tenantId} LIMIT 1
      `);
      const row = r.rows[0] as {
        sessions_invalid_after: string | null; status: string;
        deleted_at: string | null; tenant_deleted_at: string | null;
        session_user_id: string | null; session_revoked_at: string | null; touch: boolean | null;
      } | undefined;
      if (!row || row.status !== "active" || row.deleted_at || row.tenant_deleted_at) return true;
      if (row.sessions_invalid_after && opts.iatSeconds! * 1000 < new Date(row.sessions_invalid_after).getTime()) return true;
      if (!row.session_user_id || row.session_revoked_at || String(row.session_user_id) !== opts.userId) return true;
      if (row.touch) {
        await tx.execute(sql`
          UPDATE user_sessions SET last_seen_at = now()
          WHERE session_id = ${opts.sid} AND revoked_at IS NULL
            AND last_seen_at < now() - interval '1 minute'
        `);
      }
      return false;
    });
  } catch { return true; }
}

// Positive authorization is no longer cached across requests or replicas.
export function clearSessionRevocationCache(_userId?: string): void {}
export function clearDeviceSessionCache(_sid?: string): void {}
