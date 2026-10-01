import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/send-doc-checklist
 *
 * One-click: mint a secure document-collection link and send it to the client by
 * BOTH email (the firm's connected mailbox / Resend — NOT the global system
 * sender) and WhatsApp (the comms pipeline → Vartify). Reports the REAL per-channel
 * outcome and always returns a wa.me fallback so the advisor can send from their
 * own WhatsApp when a proactive platform send can't be delivered (Meta's 24h
 * rule for non-template messages).
 *
 * The flow itself lives in lib/onboarding/send-doc-checklist.ts so a client
 * accepting a proposal triggers exactly the same send.
 *
 * Body: { clientType?: ClientType } → { ok, url, summary, emailed, whatsapp, waMeUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { CLIENT_TYPES, sendDocChecklist } from "@/lib/onboarding/send-doc-checklist";
import type { ClientType } from "@/lib/onboarding/doc-checklists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.assigned", session.permissions);

    const body = await req.json().catch(() => ({}));
    const clientType = ((CLIENT_TYPES as readonly string[]).includes(body?.clientType)
      ? body.clientType
      : "individual") as ClientType;

    const result = await sendDocChecklist({
      tenantId: session.tenantId,
      leadId: id,
      actorUserId: session.userId,
      clientType,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
