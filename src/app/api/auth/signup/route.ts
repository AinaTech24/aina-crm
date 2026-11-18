import { issueSessionToken } from "@/lib/auth/issue-session";
/**
 * POST /api/auth/signup
 * Body: { firmName, arn, ownerName, ownerEmail, password }
 *
 * Creates a tenant + the owner user (lib/onboarding/create-firm.ts — the same
 * code the online purchase uses). The owner is auto-granted [owner, rm,
 * compliance] roles for solo MFDs. New firms normally start from /pricing;
 * this endpoint stays closed unless ALLOW_SELF_SIGNUP=1.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { issueEmailVerification } from "@/lib/auth/email-verification";
import { enforce } from "@/lib/rate-limit";
import { createFirmAccount, emailInUse, FirmCreateError } from "@/lib/onboarding/create-firm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Self-serve sign-up is closed (the firm's call, 2026-10-19): workspaces are
  // created by Aina or bought from /pricing. The rest stays for when it reopens.
  if (process.env.ALLOW_SELF_SIGNUP !== "1") {
    return NextResponse.json({ error: "Sign-up is not available. Please contact Aina to get a workspace." }, { status: 403 });
  }
  // 5 tenant creations per IP per hour — stops drive-by spam of fake tenants.
  const limited = enforce(req, "auth.signup", { limit: 5, windowSec: 60 * 60 });
  if (limited) return limited;

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
  // One sign-in per email across the platform — otherwise login is ambiguous.
  if (await emailInUse(ownerEmail)) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  let firm;
  try {
    firm = await createFirmAccount({ firmName, arn, ownerName, ownerEmail, password });
  } catch (err) {
    if (err instanceof FirmCreateError) {
      if (err.code === "arn_taken") return NextResponse.json({ error: "ARN already registered" }, { status: 409 });
      if (err.code === "email_taken") return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      return NextResponse.json(
        { error: "Signups are temporarily unavailable (no billing plan is configured). Please contact support." },
        { status: 503 }
      );
    }
    console.error("[signup] failed", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "signup failed", detail: process.env.NODE_ENV !== "production" ? msg : undefined },
      { status: 500 }
    );
  }

  // Email verification (best-effort). The owner is signed in straight away;
  // the unverified state gates abuse-prone actions (inviting a team).
  let emailSent = false;
  try {
    const v = await issueEmailVerification({ userId: firm.userId, tenantId: firm.tenantId, email: ownerEmail, name: ownerName, firmName });
    emailSent = v.emailSent;
  } catch (err) {
    console.error("[signup] email-verification issue failed:", err);
  }

  const token = await issueSessionToken({
    userId: firm.userId,
    tenantId: firm.tenantId,
    branchId: firm.branchId,
    roles: ["owner", "rm", "compliance"],
    email: ownerEmail,
    name: ownerName,
  });

  const res = NextResponse.json({ ok: true, tenantId: firm.tenantId, userId: firm.userId, verificationEmailSent: emailSent });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
