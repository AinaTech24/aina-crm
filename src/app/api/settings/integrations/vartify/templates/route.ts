/**
 * The firm's required WhatsApp templates (utility + marketing).
 *
 *   GET  → where each one stands: not created / sent to Meta / approved / rejected
 *   POST → create anything missing and send everything unsent to Meta now
 *          (owner only; runs in the background, the panel polls GET)
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getTenantIntegrationStatus } from "@/lib/comms/integrations";
import { provisionWhatsappTemplates, whatsappTemplateStatuses } from "@/lib/templates/whatsapp-provision";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const connected = await withTenant(session.tenantId, async (tx) =>
      (await getTenantIntegrationStatus(tx, session.tenantId, "vartify")).connected
    );
    const templates = await whatsappTemplateStatuses(session.tenantId);
    return NextResponse.json({ connected, templates });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const session = await requireSession();
    if (!session.roles?.includes("owner")) {
      return NextResponse.json({ error: "forbidden: only the firm owner can submit WhatsApp templates" }, { status: 403 });
    }
    const connected = await withTenant(session.tenantId, async (tx) =>
      (await getTenantIntegrationStatus(tx, session.tenantId, "vartify")).connected
    );
    if (!connected) {
      return NextResponse.json({ error: "Connect your WhatsApp (Vartify) channel first." }, { status: 400 });
    }
    void provisionWhatsappTemplates({ tenantId: session.tenantId, userId: session.userId, retryFailedAfterMs: 0 }).catch((err) =>
      console.error("[vartify] template provisioning failed:", err)
    );
    return NextResponse.json({ ok: true, started: true }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}
