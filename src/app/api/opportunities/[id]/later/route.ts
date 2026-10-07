/**
 * POST /api/opportunities/[id]/later — the client wants it, but not yet.
 *   { action: "park", revisitOn, reason, money? }   put it off until revisitOn
 *       (again on a parked one = a new date). money { sourceType, amount? }:
 *       it waits for that money — recorded as an expected inflow.
 *   { action: "resume", followUpOn? }               back to work now
 *
 * lib/opportunities/later.ts does the work; the response is the refreshed view.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableOpportunity, requireWorkOpportunities } from "@/lib/opportunities/access";
import { listOpportunities } from "@/lib/opportunities/journey";
import { LaterBody, parkOpportunity, resumeOpportunity } from "@/lib/opportunities/later";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  LaterBody.extend({ action: z.literal("park") }),
  z.object({ action: z.literal("resume"), followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const b = parsed.data;
    const actor = { tenantId: session.tenantId, userId: session.userId };

    const out = await withTenant(session.tenantId, async (tx) => {
      const opp = await loadViewableOpportunity(tx, session, id);
      if (opp.status !== "open") throw Object.assign(new Error(`This opportunity is already ${opp.status}.`), { status: 409 });
      let remindOn: string | null = null;
      if (b.action === "park") {
        remindOn = (await parkOpportunity(tx, actor, opp, b)).remindOn;
      } else {
        if (!opp.parkedAt) throw Object.assign(new Error("It is not waiting — nothing to resume."), { status: 409 });
        await resumeOpportunity(tx, actor, opp, { followUpOn: b.followUpOn ?? null });
      }
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [id] });
      return { opportunity: view, remindOn };
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
