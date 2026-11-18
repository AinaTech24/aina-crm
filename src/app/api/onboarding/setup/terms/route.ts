/** POST /api/onboarding/setup/terms — accept the current Terms of Service. Body: { documentId, agree: true }. Owner-only. */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { acceptTerms } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const b = ((await req.json().catch(() => null)) ?? {}) as { documentId?: string; agree?: boolean };
    if (b.agree !== true) return NextResponse.json({ error: "Tick the box to accept the Terms." }, { status: 400 });
    const r = await acceptTerms(wizardActor(session, req), String(b.documentId ?? ""));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
