/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Verifies the bcrypt-hashed password against the users table, signs a JWT,
 * and sets the httpOnly session cookie. The cookie is the credential —
 * never returned in the response body.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withSystem } from "@/db/client";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "email + password required" }, { status: 400 });
  }

  // Rate-limit by IP+email — 10 failed attempts in 15 min triggers 429.
  // Tight enough to stop credential stuffing, loose enough that a real
  // user with a sticky-keys typo doesn't get locked out.
  const limited = enforce(req, "auth.login", { limit: 10, windowSec: 15 * 60 }, email);
  if (limited) return limited;

  const userRow = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT u.id, u.tenant_id, u.branch_id, u.email, u.name, u.password_hash, u.roles, u.status, u.permissions
      FROM users u
      WHERE lower(u.email) = ${email}
      LIMIT 1
    `);
    return (r.rows[0] ?? null) as any;
  });

  if (!userRow || !userRow.password_hash) {
    // Generic message — don't leak which leg failed.
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  if (userRow.status === "suspended" || userRow.status === "offboarded") {
    return NextResponse.json({ error: "account inactive" }, { status: 403 });
  }

  const ok = await bcrypt.compare(password, userRow.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Update last_login_at — fire-and-forget, don't block on it.
  withSystem(async (tx) => {
    await tx.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${userRow.id}`);
  }).catch(() => {});

  const token = await signSession({
    userId: userRow.id,
    tenantId: userRow.tenant_id,
    branchId: userRow.branch_id ?? undefined,
    roles: userRow.roles ?? [],
    email: userRow.email,
    name: userRow.name,
    permissions: userRow.permissions ?? [],
  });

  const res = NextResponse.json({ ok: true, user: { id: userRow.id, name: userRow.name, email: userRow.email, roles: userRow.roles } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
