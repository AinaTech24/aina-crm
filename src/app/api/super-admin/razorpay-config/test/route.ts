/**
 * Aina Admin → Razorpay "Test connection". Authenticates against the Razorpay
 * API with the given (or saved) keys and reports back ok/mode. Platform-admin
 * only. The secret is used only for this live probe — never echoed back.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { testRazorpayConnection } from "@/lib/billing/razorpay-config";

export const dynamic = "force-dynamic";

const Body = z.object({
  keyId: z.string().max(120).optional(),
  keySecret: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const result = await testRazorpayConnection(parsed.success ? parsed.data : {});
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
