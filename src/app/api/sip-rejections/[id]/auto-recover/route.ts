import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { sipRejections, investors } from "@/db/schema";
import { autoRecoverRejection } from "@/lib/sip-rejections/auto-recover";
import { isClientVisible } from "@/lib/transactions/client-scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/sip-rejections/[id]/auto-recover
 *
 * Triggers the automated SIP Rejection & Mandate Bounce Recovery sequence:
 * See lib/sip-rejections/auto-recover.ts: raises the rejection event for the
 * "SIP rejection follow-up" automation, creates one high-priority RM task (48h)
 * and moves the rejection to 'client_contacted'.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);

    const { id } = await params;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [rej] = await tx
          .select()
          .from(sipRejections)
          .where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId)))
          .limit(1);

        // Viewer scope: a rejection on a client this viewer cannot see is not found.
        if (!rej || !(await isClientVisible(tx, session, rej.investorId))) {
          return { notFound: true };
        }

        const [inv] = await tx
          .select({
            id: investors.id,
            name: investors.name,
            phone: investors.phone,
            email: investors.email,
            rmId: investors.rmId,
          })
          .from(investors)
          .where(and(eq(investors.id, rej.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);

        await autoRecoverRejection(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
          rejection: rej,
          investor: inv ?? null,
        });

        return { success: true, investorName: inv?.name };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (result.notFound) {
      return NextResponse.json({ error: "SIP Rejection record not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: `Auto-recovery workflow triggered successfully for ${result.investorName || "investor"}.`,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
