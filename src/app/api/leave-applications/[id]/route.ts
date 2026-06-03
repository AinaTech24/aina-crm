import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single leave application.
 *
 *   PATCH  /api/leave-applications/[id]   — { action: approve | reject | cancel, decisionNotes? }
 *
 * approve/reject: managers only (owner / branch_head). cancel: the applicant or
 * a manager. Decisions notify the applicant + are audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leaveApplications, notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  decisionNotes: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action, decisionNotes } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(leaveApplications).where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return { notFound: true as const };

      if (action === "approve" || action === "reject") {
        if (!isManager) return { forbidden: "Only a manager can approve or reject leave." };
        if (before.status !== "requested") return { badState: `Cannot ${action} a ${before.status} request.` };
        const next = action === "approve" ? "approved" : "rejected";
        await tx
          .update(leaveApplications)
          .set({ status: next, approverUserId: session.userId, decidedAt: new Date(), decisionNotes: decisionNotes ?? null, updatedAt: new Date() } as any)
          .where(eq(leaveApplications.id, id));
        // Notify the applicant.
        await tx.insert(notifications).values({
          id: uuid(),
          tenantId: session.tenantId,
          userId: before.employeeUserId,
          kind: "leave.decided",
          title: `Leave ${next}`,
          body: `Your ${before.leaveType.replace(/_/g, " ")} leave (${before.fromDate}${before.toDate !== before.fromDate ? `–${before.toDate}` : ""}) was ${next}.${decisionNotes ? ` Note: ${decisionNotes}` : ""}`,
          linkUrl: "/dashboard/leave-applications?mine=1",
          severity: next === "approved" ? "success" : "warning",
          meta: { leave_id: id } as any,
        } as any);
      } else {
        // cancel — applicant or manager; only while not already decided-final.
        if (before.employeeUserId !== session.userId && !isManager) {
          return { forbidden: "You can only cancel your own leave." };
        }
        if (before.status === "rejected" || before.status === "cancelled") {
          return { badState: `Request is already ${before.status}.` };
        }
        await tx
          .update(leaveApplications)
          .set({ status: "cancelled", updatedAt: new Date() } as any)
          .where(eq(leaveApplications.id, id));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `leave.${action}`,
        entityType: "leave_application",
        entityId: id,
        before: { status: before.status } as any,
        after: { action, decisionNotes } as any,
        ...clientMeta,
      });
      return { ok: true as const };
    });

    if ((result as any).notFound) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ((result as any).forbidden) return NextResponse.json({ error: (result as any).forbidden }, { status: 403 });
    if ((result as any).badState) return NextResponse.json({ error: (result as any).badState }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
