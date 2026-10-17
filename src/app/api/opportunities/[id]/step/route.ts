/**
 * POST /api/opportunities/[id]/step — one of the current step's actions
 * (lib/opportunities/steps.ts): log a call, link a scheduled meeting, meeting
 * done, record acceptance, KYC / UCC / mandate done, order placed, hand the
 * step to operations … each with what it asks for and an optional next
 * follow-up date.
 *
 * 409 with `blocked` when the move it makes meets a compliance gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { listOpportunities } from "@/lib/opportunities/journey";
import { runStepAction, STEP_ACTIONS } from "@/lib/opportunities/steps";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  action: z.enum(STEP_ACTIONS),
  on: day.nullish(),
  outcome: z.enum(["spoke", "no_answer"]).nullish(),
  meetingId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
  dueOn: day.nullish(),
  uccCode: z.string().trim().max(40).nullish(),
  mandateRef: z.string().trim().max(60).nullish(),
  mandateAmount: z.coerce.number().nonnegative().max(1e12).nullish(),
  amount: z.coerce.number().nonnegative().max(1e12).nullish(),
  orderNo: z.string().trim().max(60).nullish(),
  formNo: z.string().trim().max(60).nullish(),
  policyNo: z.string().trim().max(60).nullish(),
  followUpOn: day.nullish(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      await loadViewableOpportunity(tx, session, id);
      const r = await runStepAction(tx, { tenantId: session.tenantId, userId: session.userId }, id, parsed.data);
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { r, view };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    if (!out.r.ok) {
      return NextResponse.json({ error: out.r.error, blocked: out.r.blocked ?? null, opportunity: out.view }, { status: out.r.status });
    }
    return NextResponse.json({ ok: true, stage: out.r.stage, moved: out.r.moved, skipped: out.r.skipped, opportunity: out.view });
  } catch (err) {
    return handleApiError(err);
  }
}
