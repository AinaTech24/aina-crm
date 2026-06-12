/**
 * POST /api/integrations/zoho/disconnect — soft-disconnect the firm's Zoho
 * connection (keeps the row + sync history; stops pushing).
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { disconnectZoho } from "@/lib/integrations/zoho/credentials";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();
  await withTenant(session.tenantId, async (tx) => {
    await disconnectZoho(tx, session.tenantId);
  });
  return NextResponse.json({ ok: true });
}
