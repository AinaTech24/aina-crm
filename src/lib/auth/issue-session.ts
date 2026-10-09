/**
 * Shared session-cookie issuance. Used by the password login route AND the
 * 2FA verify route so the cookie shape never drifts between the two entry
 * points into a logged-in session.
 *
 * Each issued session also records a `user_sessions` row (keyed by the JWT's
 * `sid`) so the user can see + individually log out their devices, and so
 * presence (last-seen) works. That recording is best-effort — a DB hiccup must
 * never block login.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { signSession, sessionCookieForRoles, SESSION_TTL_SECONDS } from "./jwt";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

/**
 * How a session was authenticated (migration 0244). Only the second-factor
 * methods make a session MFA-verified; every other way in — a password alone,
 * a password reset, sign-up, an invite, a re-issue of an existing session —
 * produces a session that can NOT authorize a privileged operator action
 * until its holder completes a TOTP step-up (/api/auth/2fa/step-up).
 */
export type AuthMethod =
  | "password" | "password_totp" | "password_backup_code" | "step_up_totp" | "step_up_backup_code"
  | "password_reset" | "signup" | "invite" | "reissue";
export const MFA_METHODS: ReadonlySet<AuthMethod> = new Set(["password_totp", "password_backup_code", "step_up_totp", "step_up_backup_code"]);

export type SessionUserInput = {
  userId: string;
  tenantId: string;
  branchId?: string | null;
  roles: string[] | null;
  email: string;
  name: string;
  permissions?: string[] | null;
  /** How this session was authenticated — required, so no issuer can forget to say. */
  auth: AuthMethod;
};

/** Best-effort human device label from a user-agent string. */
function deviceNameFromUA(ua: string): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Browser";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "device";
  return `${browser} on ${os}`;
}

/**
 * Record the session (device row, how it was authenticated, when its second
 * factor was verified) and an `auth.session.created` audit row, in one
 * transaction. The audit row names the method and the session ROW id — never
 * the session token, its id, a password or a code.
 */
async function recordSession(sid: string, user: SessionUserInput): Promise<void> {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
    const mfa = MFA_METHODS.has(user.auth);
    await withTenant(user.tenantId, async (tx) => {
      const row = (await tx.execute(sql`
        INSERT INTO user_sessions (tenant_id, user_id, session_id, device_name, user_agent, ip_address, auth_method, mfa_verified_at)
        VALUES (${user.tenantId}::uuid, ${user.userId}::uuid, ${sid}, ${deviceNameFromUA(ua)}, ${ua.slice(0, 500)}, ${ip},
                ${user.auth}, ${mfa ? sql`now()` : sql`NULL`})
        RETURNING id::text`)).rows[0] as { id: string };
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, ip_address, user_agent)
        VALUES (${user.tenantId}::uuid, ${user.userId}::uuid, 'user', 'auth.session.created', 'user_session', ${row.id}::uuid,
                ${JSON.stringify({ method: user.auth, mfaVerified: mfa })}::jsonb, ${ip}, ${ua.slice(0, 300)})`);
    });
}

/**
 * Sign a session JWT for `user` and return the raw token string.
 *
 * This is the credential the MOBILE app carries (in its keychain), sent as
 * `Authorization: Bearer <token>` on every API call. The web app uses the
 * httpOnly cookie instead (see attachSessionCookie) — same signed payload,
 * different transport. Keeping both paths on this one signer means the session
 * shape never drifts between web and mobile.
 */
export async function issueSessionToken(user: SessionUserInput): Promise<string> {
  const sid = crypto.randomUUID();
  const token = await signSession({
    userId: user.userId,
    tenantId: user.tenantId,
    branchId: user.branchId ?? undefined,
    roles: user.roles ?? [],
    email: user.email,
    name: user.name,
    permissions: user.permissions ?? [],
    sid,
    authTime: Math.floor(Date.now() / 1000),
  });
  await recordSession(sid, user);
  return token;
}

/** Sign a session JWT for `user` and attach it as the httpOnly cookie on `res`. */
export async function attachSessionCookie(
  res: NextResponse,
  user: SessionUserInput
): Promise<NextResponse> {
  const token = await issueSessionToken(user);
  // Platform-admin sessions go to a separate cookie so they don't clobber an
  // MFD session in the same browser (and vice versa).
  res.cookies.set(sessionCookieForRoles(user.roles), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
