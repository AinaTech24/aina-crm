/**
 * GET  /api/auth/verify-email?token=...   — consume a verification token.
 *   Redirects to the dashboard (or login) with a status flag rather than
 *   returning JSON, since this URL is opened from an email in a browser.
 *
 * POST /api/auth/verify-email             — resend the verification email to
 *   the currently-signed-in user (rate-limited).
 */

import { NextRequest, NextResponse } from "next/server";
import { consumeEmailVerification, issueEmailVerification } from "@/lib/auth/email-verification";
import { getSession } from "@/lib/auth/session";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function appBase(): string {
  return process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const result = await consumeEmailVerification(token);
  const base = appBase();
  if (result.ok) {
    return NextResponse.redirect(`${base}/dashboard?verified=1`, { status: 303 });
  }
  return NextResponse.redirect(`${base}/login?verify_error=${result.reason}`, { status: 303 });
}

export async function POST(req: NextRequest) {
  const limited = enforce(req, "auth.verify_resend", { limit: 5, windowSec: 60 * 60 });
  if (limited) return limited;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const v = await issueEmailVerification({
    userId: session.userId,
    tenantId: session.tenantId,
    email: session.email,
    name: session.name,
  });
  return NextResponse.json({ ok: true, emailSent: v.emailSent });
}
