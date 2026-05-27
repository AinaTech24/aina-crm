/**
 * POST /api/campaigns/[id]/launch
 *
 * Transitions a draft/scheduled campaign into 'sending'. The worker process
 * (campaign-dispatcher) picks it up, walks segment_memberships, and enqueues
 * one comms.dispatch job per recipient on the per-tenant channel queue
 * (so throttling + consent + compliance happens per-recipient via the
 * standard pipeline).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { campaigns } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send");
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(campaigns)
        .set({ status: "sending", startedAt: new Date() } as any)
        .where(eq(campaigns.id, id))
        .returning();
      if (!r[0]) return null;

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "campaign.launch",
        entityType: "campaign",
        entityId: id,
        after: { name: r[0].name, channel: r[0].channel, segmentId: r[0].segmentId },
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
