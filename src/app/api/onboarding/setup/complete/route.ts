/** POST /api/onboarding/setup/complete — finish setup: the firm is onboarded (once), Aina is told, the welcome email goes. Owner-only. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { completeOnboarding } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const r = await completeOnboarding(wizardActor(session, req));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    // The first completion lands on "Start here" (/dashboard/welcome).
    return NextResponse.json({ ok: true, next: r.first ? "/dashboard/welcome" : "/dashboard" });
  } catch (err) {
    return handleApiError(err);
  }
}
