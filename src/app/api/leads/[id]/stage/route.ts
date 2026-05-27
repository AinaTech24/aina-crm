/**
 * POST /api/leads/[id]/stage
 * Body: { stage: 'new'|'contacted'|'qualified'|'proposal_sent'|'converted'|'lost'|'cold' }
 *
 * Updates the lead's stage and emits a stage-change event so workflows can react.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leads, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  stage: z.enum([
    // Spec-canonical (8)
    "new", "contacted", "meeting_scheduled", "proposal_shared",
    "follow_up", "converted", "lost", "not_interested",
    // Legacy aliases
    "qualified", "proposal_sent", "cold",
  ]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => ["owner", "marketing", "rm", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
      if (!before) return null;
      const after = await tx
        .update(leads)
        .set({ stage: parse.data.stage, stageChangedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(leads.id, id))
        .returning();
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: `lead.stage.${parse.data.stage}`,
        entityType: "lead",
        entityId: id,
        before: { stage: before.stage } as any,
        after: { stage: parse.data.stage } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.stage_change",
        entityType: "lead",
        entityId: id,
        before: { stage: before.stage },
        after: { stage: parse.data.stage },
        ...clientMeta,
      });

      return after[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
