/**
 * Shared session-cookie issuance. Used by the password login route AND the
 * 2FA verify route so the cookie shape never drifts between the two entry
 * points into a logged-in session.
 */

import { NextResponse } from "next/server";
import { signSession, sessionCookieForRoles, SESSION_TTL_SECONDS } from "./jwt";

export type SessionUserInput = {
  userId: string;
  tenantId: string;
  branchId?: string | null;
  roles: string[] | null;
  email: string;
  name: string;
  permissions?: string[] | null;
};

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
  return signSession({
    userId: user.userId,
    tenantId: user.tenantId,
    branchId: user.branchId ?? undefined,
    roles: user.roles ?? [],
    email: user.email,
    name: user.name,
    permissions: user.permissions ?? [],
  });
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
