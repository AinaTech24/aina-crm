import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/communications/actions
 *   Body: { action: "cancel" | "retry" | "flag" | "unflag", ids: string[] }
 *
 * Bulk row actions for the communications list:
 *   cancel  — a scheduled send → status 'cancelled' (only if still 'scheduled')
 *   retry   — a failed Compose email → re-send through the gate
 *   flag    — star a row (flagged_at = now)
 *   unflag  — clear the star
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { communications } from "@/db/schema";
import { retryEmail } from "@/lib/comms/compose";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["cancel", "retry", "flag", "unflag"]),
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send");
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { action, ids } = parsed.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      let affected = 0;

      // Every mutation is tenant-scoped explicitly — withTenant alone doesn't
      // protect under the superuser/RLS-bypass model, so without these
      // predicates one tenant could cancel/flag/retry another tenant's rows by id.
      const tenantPred = eq(communications.tenantId, session.tenantId);

      if (action === "cancel") {
        const r = await tx
          .update(communications)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(tenantPred, inArray(communications.id, ids), eq(communications.status, "scheduled")))
          .returning({ id: communications.id });
        affected = r.length;
      } else if (action === "flag" || action === "unflag") {
        const r = await tx
          .update(communications)
          .set({ flaggedAt: action === "flag" ? new Date() : null, updatedAt: new Date() })
          .where(and(tenantPred, inArray(communications.id, ids)))
          .returning({ id: communications.id });
        affected = r.length;
      } else if (action === "retry") {
        // Re-send each failed Compose row through the gate, one at a time.
        // retryEmail is tenant-scoped so a foreign id is a no-op.
        for (const id of ids) {
          const res = await retryEmail(tx, id, session.tenantId);
          if (res.status === "sent" || res.status === "queued") affected++;
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `communication.${action}`,
        entityType: "communication",
        entityId: ids[0],
        after: { action, count: affected, ids: ids.slice(0, 50) },
        ...clientMeta,
      });

      return { affected };
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
