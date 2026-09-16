/** Shared, atomic pre-password reservations. Failed/crashed attempts consume the
 * budget; a verified password releases its own reservation. No IP header can
 * bypass the account budget, which applies across web/mobile and app replicas. */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

const WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 15;

export async function reserveLoginAttempt(email: string): Promise<
  { allowed: false; response: Response } | { allowed: true; succeeded: () => Promise<void> }
> {
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const admitted = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      INSERT INTO auth_login_limits (bucket_key, attempts, resets_at)
      VALUES (${key}, 1, now() + ${WINDOW_SECONDS} * interval '1 second')
      ON CONFLICT (bucket_key) DO UPDATE
      SET attempts = CASE WHEN auth_login_limits.resets_at <= now() THEN 1 ELSE auth_login_limits.attempts + 1 END,
          resets_at = CASE WHEN auth_login_limits.resets_at <= now() THEN EXCLUDED.resets_at ELSE auth_login_limits.resets_at END
      WHERE auth_login_limits.resets_at <= now() OR auth_login_limits.attempts < ${ACCOUNT_LIMIT}
      RETURNING resets_at
    `);
    return r.rows[0] as { resets_at: string } | undefined;
  });
  if (!admitted) return {
    allowed: false,
    response: Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." },
      { status: 429, headers: { "Retry-After": String(WINDOW_SECONDS) } }),
  };
  let released = false;
  return { allowed: true, succeeded: async () => {
    if (released) return;
    released = true;
    await withSystem(async (tx) => {
      await tx.execute(sql`
        UPDATE auth_login_limits SET attempts = greatest(0, attempts - 1)
        WHERE bucket_key = ${key} AND resets_at = ${admitted.resets_at}::timestamptz
      `);
    });
  } };
}
