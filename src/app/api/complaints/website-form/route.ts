/**
 * PATCH /api/complaints/website-form — manage the firm's public complaint link.
 *
 *   { action: "disable" }  the link answers "not taking complaints right now"
 *   { action: "enable" }   it takes complaints again
 *   { action: "replace" }  a new link; the old one stops working at once
 *
 * The owner and compliance only: the link is printed on the firm's website, so
 * replacing it is a change to the firm's public face, not a ticket action.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import {
  ensureComplaintFormLink,
  replaceComplaintFormToken,
  setComplaintFormEnabled,
} from "@/lib/complaints/web-form";

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
      const before = await ensureComplaintFormLink(tx, session.tenantId);
      if (action === "replace") await replaceComplaintFormToken(tx, session.tenantId);
      else await setComplaintFormEnabled(tx, session.tenantId, action === "enable");
      const after = await ensureComplaintFormLink(tx, session.tenantId);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "complaint_form.update",
        entityType: "tenant",
        entityId: session.tenantId,
        // Never the token itself — the audit trail is readable by more people
        // than should be able to post to the link.
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
