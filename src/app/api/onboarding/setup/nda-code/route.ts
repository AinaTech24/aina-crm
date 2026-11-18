/** POST /api/onboarding/setup/nda-code — email a one-time code to sign the NDA. Body: { documentId }. Owner-only; 5 per hour. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendNdaCode } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";
import { maskEmail } from "@/lib/public-otp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    if (!checkRateLimit("onboarding.nda-code", session.userId, { limit: 5, windowSec: 3600 }).ok) {
      return NextResponse.json({ error: "Too many codes requested — try again in an hour." }, { status: 429 });
    }
    const b = ((await req.json().catch(() => null)) ?? {}) as { documentId?: string };
    const r = await sendNdaCode(wizardActor(session, req), String(b.documentId ?? ""));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, sentTo: maskEmail(r.sentTo) });
  } catch (err) {
    return handleApiError(err);
  }
}
