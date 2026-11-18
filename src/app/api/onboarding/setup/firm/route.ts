/** POST /api/onboarding/setup/firm — setup step 1: the firm's details (validated PAN / GSTIN). Owner-only. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { parseFirmDetails, saveFirmDetails } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const parsed = parseFirmDetails(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: "Please check the highlighted fields.", errors: parsed.errors }, { status: 400 });
    const r = await saveFirmDetails(wizardActor(session, req), parsed.value);
    if (!r.ok) return NextResponse.json({ error: "Please check the highlighted fields.", errors: r.errors }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
