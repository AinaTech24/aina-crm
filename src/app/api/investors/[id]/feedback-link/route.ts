import { assertInvestorAccess } from "@/lib/investors/access";
/**
 * POST /api/investors/[id]/feedback-link
 *
 * Mints a public, single-use share-token link (/f/<token>) the RM can hand a
 * client so they can rate the firm (NPS) without logging in. The submission
 * files itself as a closed `feedback` service request with the CSAT fields
 * set, so the score lands in the CRM rather than an inbox.
 *
 * Mirrors ../risk-profile-link. Gated on `investor.view.*` rather than a
 * service-desk capability: asking your own client for feedback is part of
 * ordinary relationship work, and the link exposes nothing but a rating form.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { createShareToken } from "@/lib/share-tokens";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    await assertInvestorAccess(session, (await params).id);
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const inv = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: investors.id, name: investors.name, phone: investors.phone, email: investors.email })
        .from(investors)
        .where(eq(investors.id, id))
        .limit(1);
      return row ?? null;
    });
    if (!inv) return NextResponse.json({ error: "investor not found" }, { status: 404 });

    const { url, expiresAt } = await createShareToken({
      tenantId: session.tenantId,
      kind: "feedback",
      subjectType: "investor",
      subjectId: id,
      createdBy: session.userId,
      expiresInDays: 30,
    });

    return NextResponse.json({
      url,
      expiresAt,
      investorName: inv.name,
      phone: inv.phone ?? null,
      email: inv.email ?? null,
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? "failed" }, { status });
  }
}
