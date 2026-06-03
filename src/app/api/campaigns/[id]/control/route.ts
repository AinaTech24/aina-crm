import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/campaigns/[id]/control  — body: { action: "pause" | "resume" | "cancel" }
 *
 * Lifecycle controls for an in-flight (or queued) broadcast:
 *   - pause   : sending → paused   (dispatcher only processes 'sending', so it stops)
 *   - resume  : paused  → sending  (resumes from where it left off — already-sent
 *               recipients have communications rows, so they're skipped)
 *   - cancel  : draft/scheduled/sending/paused → cancelled  (the kill switch)
 *
 * The dispatcher mid-send is safe to pause: each recipient is sent in its own
 * transaction, so pausing simply stops the next tick from picking up new ones.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { campaigns } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

/** Allowed source statuses per action. */
const ALLOWED: Record<string, string[]> = {
  pause: ["sending"],
  resume: ["paused"],
  cancel: ["draft", "scheduled", "sending", "paused"],
};
const NEXT: Record<string, string> = { pause: "paused", resume: "sending", cancel: "cancelled" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send");
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid action" }, { status: 400 });
    const { action } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return { kind: "not_found" as const };
      if (!ALLOWED[action].includes(before.status as string)) {
        return { kind: "bad_state" as const, status: before.status };
      }

      const next = NEXT[action];
      const patch: any = { status: next, updatedAt: new Date() };
      if (action === "resume") patch.startedAt = before.startedAt ?? new Date();
      if (action === "cancel") patch.completedAt = new Date();

      const [r] = await tx.update(campaigns).set(patch).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `campaign.${action}`,
        entityType: "campaign",
        entityId: id,
        before: { status: before.status },
        after: { status: next },
        ...meta,
      });
      return { kind: "ok" as const, campaign: r };
    });

    if (out.kind === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (out.kind === "bad_state") {
      return NextResponse.json({ error: `cannot ${action} a campaign in '${out.status}' status` }, { status: 409 });
    }
    return NextResponse.json(out.campaign);
  } catch (err: any) {
    return handleApiError(err);
  }
}
