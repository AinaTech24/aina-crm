/**
 * POST /api/auth/signup
 * Body: { firmName, arn, ownerName, ownerEmail, password }
 *
 * Creates a tenant + the owner user in a single transaction.
 * The owner is auto-granted [owner, rm, compliance] roles for solo MFDs.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { MASTER_SEEDS } from "@/lib/masters/seeds";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const firmName = String(body.firmName ?? "").trim();
  const arn = String(body.arn ?? "").trim();
  const ownerName = String(body.ownerName ?? "").trim();
  const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!firmName || !arn || !ownerName || !ownerEmail || password.length < 8) {
    return NextResponse.json(
      { error: "firmName, arn, ownerName, ownerEmail, password (min 8 chars) all required" },
      { status: 400 }
    );
  }

  const tenantId = uuid();
  const userId = uuid();
  const branchId = uuid();
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, created_at, updated_at)
        VALUES (${tenantId}, ${firmName}, ${firmName}, ${arn}, 'starter', 'trial', now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
        VALUES (${branchId}, ${tenantId}, 'Head Office', 'HQ', 'true', now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (
          ${userId}, ${tenantId}, ${branchId}, ${ownerEmail}, ${ownerName}, ${passwordHash},
          ARRAY['owner', 'rm', 'compliance']::text[], 'active', now(), now(), now()
        )
      `);

      // Seed the 15 master_values defaults for this tenant.
      for (const [masterType, rows] of Object.entries(MASTER_SEEDS)) {
        for (const r of rows) {
          await tx.execute(sql`
            INSERT INTO master_values (
              id, tenant_id, master_type, key, label, sort_order,
              is_active, is_system_default, meta, created_at, updated_at
            )
            VALUES (
              gen_random_uuid(), ${tenantId}, ${masterType}, ${r.key}, ${r.label},
              ${r.sortOrder ?? 0}, true, true,
              ${r.meta ? JSON.stringify(r.meta) : null}::jsonb,
              now(), now()
            )
            ON CONFLICT (tenant_id, master_type, key) DO NOTHING
          `);
        }
      }
    });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (msg.includes("tenants_arn_unique")) {
      return NextResponse.json({ error: "ARN already registered" }, { status: 409 });
    }
    if (msg.includes("users_tenant_email_unique")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    // Common dev-time failure modes — give actionable guidance.
    if (msg.includes("ECONNREFUSED") || msg.includes("getaddrinfo") || msg.includes("connect ETIMEDOUT")) {
      return NextResponse.json(
        {
          error: "Database not reachable. Is Postgres running and DATABASE_URL correct in .env?",
          detail: msg,
        },
        { status: 503 }
      );
    }
    if (msg.includes('relation "tenants" does not exist') || msg.includes('relation "branches" does not exist')) {
      return NextResponse.json(
        {
          error: "Schema not migrated. Run: npm run db:push (then `psql $DATABASE_URL -f drizzle/migrations/0001_rls_policies.sql` to enable RLS).",
          detail: msg,
        },
        { status: 503 }
      );
    }
    if (msg.includes("ALLOW_SYSTEM_TX") || msg.includes("withSystem disabled")) {
      return NextResponse.json(
        { error: "Server config: set ALLOW_SYSTEM_TX=1 in .env (required during signup before tenant exists) and restart `npm run dev`." },
        { status: 503 }
      );
    }
    console.error("[signup] failed", err);
    // In dev, surface the real error to speed up debugging. Never in production.
    return NextResponse.json(
      {
        error: "signup failed",
        detail: process.env.NODE_ENV !== "production" ? msg : undefined,
      },
      { status: 500 }
    );
  }

  const token = await signSession({
    userId,
    tenantId,
    branchId,
    roles: ["owner", "rm", "compliance"],
    email: ownerEmail,
    name: ownerName,
  });

  const res = NextResponse.json({ ok: true, tenantId, userId });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
