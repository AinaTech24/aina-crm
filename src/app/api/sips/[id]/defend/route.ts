import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sips/[id]/defend
 *
 * "Save-the-SIP" recovery action for a predicted at-risk SIP. Creates a
 * high-priority follow-up task for the SIP's RM (falls back to the acting
 * user) so the intervention is tracked and accountable. The at-risk queue
 * lives at /dashboard/sips/at-risk.
 *
 * Body (optional): { reasons?: string[], note?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { sips, tasks, investors } from "@/db/schema";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const Body = z.object({
  reasons: z.array(z.string()).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const reasons = parsed.success ? parsed.data.reasons ?? [] : [];
    const note = parsed.success ? parsed.data.note : undefined;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const sip = (
          await tx.select().from(sips).where(and(eq(sips.id, id), eq(sips.tenantId, session.tenantId))).limit(1)
        )[0];
        if (!sip) return { notFound: true as const };

        const investor = sip.investorId
          ? (await tx.select({ name: investors.name }).from(investors).where(eq(investors.id, sip.investorId)).limit(1))[0]
          : null;

        const reasonText = reasons.length ? ` (${reasons.join(", ")})` : "";
        const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // +2 days

        const inserted = await tx
          .insert(tasks)
          .values({
            tenantId: session.tenantId,
            subjectType: "investor",
            subjectId: sip.investorId,
            relatedInvestorId: sip.investorId,
            department: "sales",
            type: "follow_up",
            title: `Save SIP — ${sip.schemeName ?? "scheme"}${reasonText}`,
            description:
              `${investor?.name ?? "Client"}'s ${formatINR(Number(sip.amount))} ${sip.frequency} SIP is at risk` +
              `${reasonText}. Call the client, fix the mandate/bank issue, and reprocess before the next installment.` +
              (note ? `\n\nNote: ${note}` : ""),
            priority: "high",
            status: "open",
            assigneeId: (sip.rmId as string | null) ?? session.userId,
            createdById: session.userId,
            dueAt,
          } as any)
          .returning({ id: tasks.id });

        return { taskId: inserted[0]?.id ?? null };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if ("notFound" in result) return NextResponse.json({ error: "SIP not found" }, { status: 404 });
    return NextResponse.json({ ok: true, taskId: result.taskId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
