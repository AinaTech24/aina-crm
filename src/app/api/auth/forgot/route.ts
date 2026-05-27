/**
 * POST /api/auth/forgot  Body: { email }
 *
 * Generates a one-time token, stores its hash, returns the reset URL.
 *
 * IMPORTANT: response is the same shape whether the email exists or not
 * (to prevent enumeration). The link is only sent for real users.
 *
 * Email send is stubbed — we surface the URL in the dev response and via
 * server log. In production replace with the comms pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db/client";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return NextResponse.json({ ok: true }); // shape-stable
  const email = parse.data.email.toLowerCase();

  try {
    const { resetUrl } = await withSystem(async (tx) => {
      const userRows = await tx.execute(sql`
        SELECT id, tenant_id, name FROM users WHERE lower(email) = ${email} LIMIT 1
      `);
      const user = (userRows.rows[0] as any) ?? null;

      // Always return 200 to avoid leaking which emails exist
      if (!user) return { resetUrl: null };

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await tx.execute(sql`
        INSERT INTO password_resets (id, user_id, tenant_id, email, token_hash, expires_at,
                                     request_ip, request_user_agent, created_at, updated_at)
        VALUES (${uuid()}, ${user.id}, ${user.tenant_id}, ${email}, ${tokenHash}, ${expiresAt},
                ${req.headers.get("x-forwarded-for") ?? ""},
                ${req.headers.get("user-agent") ?? ""},
                now(), now())
      `);

      const base = process.env.APP_URL ?? "http://localhost:3000";
      const url = `${base}/reset-password?token=${token}`;

      // TODO: send via comms pipeline. For now log it.
      console.log(`[forgot-password] for ${email}: ${url}`);
      return { resetUrl: url };
    });

    // In dev, surface the link for testing. Never in prod.
    if (process.env.NODE_ENV !== "production" && resetUrl) {
      return NextResponse.json({ ok: true, devResetUrl: resetUrl });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ ok: true }); // never leak
  }
}
