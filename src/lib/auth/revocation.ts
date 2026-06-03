/**
 * Session revocation — the server-side teeth behind logout-everywhere,
 * offboarding, and forced password resets.
 *
 * Our sessions are stateless JWTs (8h TTL). That's great for the hot path
 * (the Edge middleware verifies them with zero I/O) but it means a token
 * stays valid for up to 8 hours even after the user is terminated. The
 * `users.sessions_invalid_after` timestamp is the revocation epoch: any token
 * whose `iat` (issued-at) predates it is dead. Offboarding / password reset
 * stamp it to now(); this check enforces it.
 *
 * Edge constraint: this touches Postgres, so it is NODE-ONLY. It must never be
 * imported by `src/middleware.ts` (which imports the Edge-safe primitives from
 * `./jwt`). It is called from `getSession()` in `./session.ts`, which only runs
 * in route handlers / server components / workers.
 *
 * Cost control: a per-process Map caches each user's revocation epoch for a
 * short TTL, so a logged-in user costs at most one indexed PK lookup every
 * REVOCATION_CACHE_TTL_MS regardless of request volume. Revocation therefore
 * propagates within that window (seconds), not the 8h token TTL.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

const REVOCATION_CACHE_TTL_MS = 30_000;

type CacheEntry = { invalidAfterMs: number; cachedAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Returns true if a token issued at `iatSeconds` for this user has been
 * revoked (i.e. issued before users.sessions_invalid_after).
 *
 * Fails OPEN: if we can't read the DB (outage), we do NOT lock everyone out —
 * the middleware + RLS remain the primary boundary and this is defense in
 * depth. A revoked user slipping through during a DB blip is an acceptable
 * trade vs. logging out the entire tenant base on a transient error.
 */
export async function isSessionRevoked(opts: {
  userId: string;
  tenantId: string;
  iatSeconds?: number;
}): Promise<boolean> {
  const { userId, tenantId, iatSeconds } = opts;
  // No iat (legacy token signed before this field existed) → can't evaluate.
  if (!iatSeconds || !userId || !tenantId) return false;

  const now = Date.now();
  let entry = cache.get(userId);
  if (!entry || now - entry.cachedAt > REVOCATION_CACHE_TTL_MS) {
    try {
      const invalidAfterMs = await withTenant(tenantId, async (tx) => {
        const r = await tx.execute(
          sql`SELECT sessions_invalid_after FROM users WHERE id = ${userId} LIMIT 1`
        );
        const row = (r.rows as Array<{ sessions_invalid_after: string | null }>)[0];
        const v = row?.sessions_invalid_after;
        return v ? new Date(v).getTime() : 0;
      });
      entry = { invalidAfterMs, cachedAt: now };
      cache.set(userId, entry);
    } catch {
      return false; // fail open — see docstring
    }
  }

  if (!entry.invalidAfterMs) return false;
  // iat is in seconds; compare in ms. A token issued AT or AFTER the epoch is valid.
  return iatSeconds * 1000 < entry.invalidAfterMs;
}

/**
 * Drop the cached revocation epoch for a user (or all users) so the next
 * check re-reads from the DB immediately. Call this right after stamping
 * sessions_invalid_after (offboarding, password reset) so revocation takes
 * effect on the very next request in THIS process rather than after the TTL.
 */
export function clearSessionRevocationCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
