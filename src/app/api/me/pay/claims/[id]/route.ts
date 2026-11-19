/**
 * PATCH /api/me/pay/claims/:id { action: "withdraw" } — take back one's own
 * claim before it is decided. Self-service (session.userId only) — listed in
 * scripts/check-require-cap.mjs.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { reimbursementClaims } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "withdraw") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const done = await withTenant(session.tenantId, (tx) =>
      tx
        .update(reimbursementClaims)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(and(eq(reimbursementClaims.tenantId, session.tenantId), eq(reimbursementClaims.id, id), eq(reimbursementClaims.userId, session.userId), eq(reimbursementClaims.status, "submitted")))
        .returning({ id: reimbursementClaims.id })
    );
    if (!done.length) return NextResponse.json({ error: "Only a claim still waiting for approval can be withdrawn." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
