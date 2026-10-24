/**
 * PATCH /api/service-requests/website-form — manage the firm's service request link.
 *
 *   { action: "disable" }  the link answers "not taking requests right now"
 *   { action: "enable" }   it takes requests again
 *   { action: "replace" }  a new link; the old one stops working at once
 *
 * Needs service_request.manage: the link is sent to clients and may be printed
 * on the firm's website, so replacing it is a change to the firm's public face,
 * not a ticket action.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { ensureServiceFormLink, replaceServiceFormToken, setServiceFormEnabled } from "@/lib/service-requests/web-form";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["enable", "disable", "replace"]) });

/** The firm's link (made on first ask) and name, for the "Request form" pop-up on Service Requests. */
export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["service_request.view.all", "service_request.manage"], session.permissions);
    const out = await withTenant(session.tenantId, async (tx) => {
      const link = await ensureServiceFormLink(tx, session.tenantId);
      const [t] = (await tx.execute(sql`SELECT display_name FROM tenants WHERE id = ${session.tenantId}::uuid`)).rows as Array<{ display_name: string }>;
      return { ...link, firmName: t?.display_name ?? "" };
    });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action } = parsed.data;

    const link = await withTenant(session.tenantId, async (tx) => {
      const before = await ensureServiceFormLink(tx, session.tenantId);
      if (action === "replace") await replaceServiceFormToken(tx, session.tenantId);
      else await setServiceFormEnabled(tx, session.tenantId, action === "enable");
      const after = await ensureServiceFormLink(tx, session.tenantId);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "service_form.update",
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
