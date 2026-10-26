/**
 * MSG91 SMS — the firm's own DLT-registered sender (one-time setup).
 *
 * In India every SMS goes out under a DLT entity, sender ID (header) and
 * template the FIRM registered with TRAI, so a firm sends from its own MSG91
 * account. Until it saves one here, SMS falls back to the platform's shared
 * key and sender (lib/comms/adapters/msg91.ts). Only an owner manages keys.
 *
 *   GET    → status (masked key, sender ID; never the secret)
 *   POST   → save / update { apiKey, senderId }
 *   DELETE → disconnect (soft-disable)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { disableTenantIntegration, getTenantIntegration, upsertTenantIntegration } from "@/lib/comms/integrations";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

function requireOwner(roles: string[] | undefined) {
  if (!roles?.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can manage integration keys." }, { status: 403 });
  }
  return null;
}

async function status(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const row = await getTenantIntegration(tx, tenantId, "msg91");
    if (!row) return { connected: false as const };
    const key = String(row.config.apiKey ?? "");
    return { connected: true as const, keyHint: key ? `••••${key.slice(-4)}` : undefined, senderId: row.senderConfig?.senderId ?? null };
  });
}

export async function GET() {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    return NextResponse.json(await status(session.tenantId));
  } catch (err) {
    return handleApiError(err);
  }
}

const SaveSchema = z.object({
  apiKey: z.string().trim().min(10, "Paste the MSG91 auth key").max(200),
  /** The DLT header: six letters (or six digits for a promotional header). */
  senderId: z.string().trim().toUpperCase().regex(/^[A-Z]{6}$|^\d{6}$/, "The sender ID is the 6-character DLT header, e.g. AINAMF"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    }
    await withTenant(session.tenantId, async (tx) => {
      await upsertTenantIntegration(tx, session.tenantId, "msg91", { apiKey: parsed.data.apiKey }, { senderId: parsed.data.senderId });
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "integration.msg91_saved",
        entityType: "tenant", entityId: session.tenantId, after: { senderId: parsed.data.senderId },
      });
    });
    return NextResponse.json({ ok: true, ...(await status(session.tenantId)) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;
    await withTenant(session.tenantId, async (tx) => {
      await disableTenantIntegration(tx, session.tenantId, "msg91");
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "integration.msg91_disconnected",
        entityType: "tenant", entityId: session.tenantId,
      });
    });
    return NextResponse.json({ ok: true, connected: false });
  } catch (err) {
    return handleApiError(err);
  }
}
