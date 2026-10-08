/**
 * PATCH /api/feedback/website-form — manage the firm's public feedback link.
 *
 *   { action: "disable" }  the link answers "not taking feedback right now"
 *   { action: "enable" }   it takes feedback again
 *   { action: "replace" }  a new link; the old one stops working at once
 *
 * The owner and compliance only, as for the complaint link: the link is
 * printed on the firm's website and in its email signatures.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { ensureFeedbackFormLink, replaceFeedbackFormToken, setFeedbackFormEnabled } from "@/lib/feedback/web-form";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["enable", "disable", "replace"]) });

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.view", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action } = parsed.data;

    const link = await withTenant(session.tenantId, async (tx) => {
      const before = await ensureFeedbackFormLink(tx, session.tenantId);
      if (action === "replace") await replaceFeedbackFormToken(tx, session.tenantId);
      else await setFeedbackFormEnabled(tx, session.tenantId, action === "enable");
      const after = await ensureFeedbackFormLink(tx, session.tenantId);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "feedback_form.update",
        entityType: "tenant",
        entityId: session.tenantId,
        // Never the token itself.
        before: { enabled: before.enabled },
        after: { enabled: after.enabled, replaced: action === "replace" },
      });
      return after;
    });

    return NextResponse.json(link);
  } catch (err) {
    return handleApiError(err);
  }
}
