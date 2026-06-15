/**
 * Aina Admin → Razorpay billing keys. Read the current status (never the raw
 * secret — only the public key id + masked booleans) and update it. The secret
 * and webhook secret are encrypted (AES-256-GCM) before they touch the DB.
 * A blank secret keeps the previously-saved one. Platform-admin only.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getRazorpayStatusForAdmin, saveRazorpayConfig } from "@/lib/billing/razorpay-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    return NextResponse.json({ status: await getRazorpayStatusForAdmin() });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  keyId: z.string().trim().min(3).max(120),
  apiKeyOverride: z.string().optional(), // reserved
  keySecret: z.string().max(200).optional(), // blank → keep existing
  webhookSecret: z.string().max(200).optional(), // blank → keep existing
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const { keyId, keySecret, webhookSecret } = parsed.data;
    // Provenance lives on the row (updated_by + updated_at). The raw secret is
    // never logged — only the encrypted blob is persisted.
    await saveRazorpayConfig({ keyId, keySecret, webhookSecret }, session.userId);
    return NextResponse.json({ ok: true, status: await getRazorpayStatusForAdmin() });
  } catch (err) {
    return handleApiError(err);
  }
}
