/**
 * GET /api/settings/integrations/waina/verify
 *
 * Live connection check against the firm's connected WAina workspace. Returns the
 * WORKSPACE NAME + sender numbers (from WAina's /extension/status) so the firm can
 * confirm exactly which WAina account/workspace their saved key belongs to — i.e.
 * where they must create + approve their WhatsApp templates. Never returns the key.
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { whatsappProviderId } from "@/lib/comms/adapters/whatsapp";
import { wapiCheckConnection } from "@/lib/comms/adapters/waina";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const integ = await withTenant(session.tenantId, async (tx) =>
      getTenantIntegration(tx, session.tenantId, whatsappProviderId)
    );
    const apiKey = (integ?.config as any)?.apiKey as string | undefined;
    const baseUrl = (integ?.config as any)?.webhookUrl as string | undefined;
    if (!integ?.isActive || !apiKey) {
      return NextResponse.json({ ok: false, connected: false, error: "WhatsApp isn't connected." });
    }
    const result = await wapiCheckConnection(apiKey, baseUrl);
    return NextResponse.json({
      connected: true,
      ok: result.ok,
      workspaceName: result.workspaceName ?? null,
      numbers: result.numbers ?? [],
      error: result.error ?? null,
      httpStatus: result.httpStatus ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
