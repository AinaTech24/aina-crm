/**
 * PATCH /api/privacy-requests/:id
 *   { action: "verify" }                                            — identity checked
 *   { action: "close", status: "completed" | "rejected", outcome }  — answered
 * Needs `compliance.edit`. Closing completes (or cancels) the request's task.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { privacyRequests } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { closePrivacyRequest, markIdentityVerified } from "@/lib/privacy/requests";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify") }),
  z.object({
    action: z.literal("close"),
    status: z.enum(["completed", "rejected"]),
    outcome: z.string().trim().min(5, "Write what was done, or why it was refused").max(4000),
  }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
    }
    const body = parse.data;
    const actor = { tenantId: session.tenantId, userId: session.userId };
    const res = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx.select({ status: privacyRequests.status }).from(privacyRequests)
        .where(and(eq(privacyRequests.tenantId, session.tenantId), eq(privacyRequests.id, id)));
      if (!r) return "missing" as const;
      if (r.status !== "open") return "closed" as const;
      if (body.action === "verify") await markIdentityVerified(tx, actor, id);
      else await closePrivacyRequest(tx, actor, id, body.status, body.outcome);
      return "ok" as const;
    });
    if (res === "missing") return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (res === "closed") return NextResponse.json({ error: "This request is already closed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
