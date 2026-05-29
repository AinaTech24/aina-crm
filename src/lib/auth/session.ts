/**
 * Lightweight JWT session via signed httpOnly cookie. Chose this over NextAuth
 * v5 beta because the beta peer-deps conflict with the rest of the stack and
 * because our session shape is small + opinionated (tenant_id is sacred).
 *
 * Cookie name: `mfd_session`
 * Algorithm:   HS256 over the NEXTAUTH_SECRET env var
 * Payload:     { userId, tenantId, branchId?, roles[], email, name, exp }
 * TTL:         8 hours sliding (refreshed on every request via middleware)
 *
 * The middleware in `src/middleware.ts` reads this cookie, validates the JWT,
 * and stashes the decoded session on request headers so server components and
 * API routes can pull it via `getSession()` without re-verifying.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";

export const SESSION_COOKIE = "mfd_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionUser = {
  userId: string;
  tenantId: string;
  branchId?: string;
  roles: string[];
  email: string;
  name: string;
  /** AINA platform staff. When true, this user bypasses tenant isolation and
   *  is routed to /super-admin instead of /dashboard on login. */
  isPlatformAdmin?: boolean;
  permissions?: string[];
};

function secretKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.userId || !payload.tenantId) return null;
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    const permissions = Array.isArray(payload.permissions) ? payload.permissions.map(String) : [];
    return {
      userId: String(payload.userId),
      tenantId: String(payload.tenantId),
      branchId: payload.branchId ? String(payload.branchId) : undefined,
      roles,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      isPlatformAdmin: roles.includes("platform_admin") || roles.includes("platform_support"),
      permissions,
    };
  } catch {
    return null;
  }
}

/**
 * Server-side session read. Use from server components, server actions, API
 * route handlers, and worker code (workers must pass tenantId explicitly —
 * this function will throw because there's no request context).
 *
 * Returns null if no session — caller decides whether that's an error.
 */
export async function getSession(): Promise<SessionUser | null> {
  // Prefer middleware-decoded header (cheap), fall back to cookie verify.
  try {
    const h = await headers();
    const headerPayload = h.get("x-mfd-session");
    if (headerPayload) {
      return JSON.parse(headerPayload) as SessionUser;
    }
  } catch {
    // headers() throws outside request context — fall through to cookie path
  }
  try {
    const c = await cookies();
    const token = c.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return await verifySession(token);
  } catch {
    return null;
  }
}

/**
 * Server-side helper that throws if no session. Use in API routes that
 * absolutely require auth — turns a missing session into a clean 401.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("not authenticated", 401);
  return session;
}

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

/**
 * Demo helper: returns a fake session for development when NO_AUTH=1.
 * NEVER use this in production — it bypasses tenant isolation. The guard
 * below makes the function throw rather than return a fake session if it's
 * ever invoked from a production build, so an accidentally-set NO_AUTH env
 * var can't hand any visitor an owner+rm+compliance session.
 */
export function devSession(): SessionUser {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "devSession() called in production — this would bypass tenant isolation"
    );
  }
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000001",
    branchId: "00000000-0000-0000-0000-000000000002",
    roles: ["owner", "rm", "compliance"],
    email: "owner@demo.local",
    name: "Demo Owner",
  };
}
