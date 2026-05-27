/**
 * POST /api/leads/[id]/blueprint/advance
 *   Body: { toStageKey: string, remarks?: string }
 *
 * Drives the lead through the formal blueprint. Validates the transition
 * exists + caller's role is allowed. Writes stage_history + emits outbox
 * events for any wired automations.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

const Body = z.object({
  toStageKey: z.string().min(2).max(60),
  remarks: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

    const res = await withTenant(session.tenantId, async (tx) =>
      transitionTo(tx, session.tenantId, id, parsed.data.toStageKey, {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks: parsed.data.remarks,
      })
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 409 });
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
