/**
 * POST /api/onboarding/setup/nda-sign — sign the current NDA.
 * Body: { documentId, signerName, designation, code, agree }. Owner-only.
 * The emailed code is checked (expiry, 5 tries) before the immutable acceptance
 * and its signed PDF are recorded.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { signNda } from "@/lib/onboarding/wizard";
import { wizardActor } from "@/lib/onboarding/actor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.billing", session.permissions);
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const r = await signNda(wizardActor(session, req), {
      documentId: String(b.documentId ?? ""),
      signerName: String(b.signerName ?? ""),
      designation: String(b.designation ?? ""),
      code: String(b.code ?? ""),
      agree: b.agree === true,
    });
    if (!r.ok) return NextResponse.json({ error: r.error, field: r.field ?? null }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
