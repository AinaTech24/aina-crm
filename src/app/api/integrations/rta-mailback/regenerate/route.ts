/**
 * POST /api/integrations/rta-mailback/regenerate
 *
 * Rotate the firm's forwarding address (e.g. the old one leaked). Deactivates
 * the old row and mints a fresh unguessable address. The MFD must repoint their
 * auto-forward rule afterwards. Owner-only.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { regenerateForwardAddress } from "@/lib/rta/mailback-config";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can configure integrations." }, { status: 403 });
  }
  const minted = await withTenant(session.tenantId, async (tx) => regenerateForwardAddress(tx, session.tenantId));
  return NextResponse.json({ ok: true, address: minted.address });
}
