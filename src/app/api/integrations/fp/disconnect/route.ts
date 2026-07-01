/**
 * POST /api/integrations/fp/disconnect — soft-disconnect the firm's FP
 * connection (keeps the encrypted row; stops syncing).
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { disconnectFp } from "@/lib/fp/credentials";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can change integrations." }, { status: 403 });
  }
  await withTenant(session.tenantId, async (tx) => {
    await disconnectFp(tx, session.tenantId);
  });
  return NextResponse.json({ ok: true });
}
