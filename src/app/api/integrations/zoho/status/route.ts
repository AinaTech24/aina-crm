/**
 * GET /api/integrations/zoho/status — non-secret connection + sync status for
 * the Settings UI.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getZohoConnection } from "@/lib/integrations/zoho/credentials";
import { zohoAppCredentials } from "@/lib/integrations/zoho/client";
import { zohoSyncLinks } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const conn = await getZohoConnection(tx, session.tenantId);
    const counts = await tx
      .select({ status: zohoSyncLinks.status, n: sql<number>`count(*)::int` })
      .from(zohoSyncLinks)
      .where(eq(zohoSyncLinks.tenantId, session.tenantId))
      .groupBy(zohoSyncLinks.status);
    return { conn, counts };
  });
  const byStatus: Record<string, number> = {};
  for (const c of data.counts as any[]) byStatus[c.status] = Number(c.n);
  return NextResponse.json({
    serverConfigured: !!zohoAppCredentials(),
    connected: !!data.conn,
    dataCenter: data.conn?.dataCenter ?? null,
    grantedBy: data.conn?.grantedBy ?? null,
    counts: { synced: byStatus.synced ?? 0, error: byStatus.error ?? 0, pending: byStatus.pending ?? 0 },
  });
}
