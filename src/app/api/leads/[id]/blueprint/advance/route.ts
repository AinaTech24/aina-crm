/**
 * POST /api/leads/[id]/blueprint/advance
 *   Body: { toStageKey: string, remarks?: string }
 *
 * Drives the lead through the formal blueprint.
 *
 * Multi-hop forward jumps: the canonical transition graph only defines
 * adjacent transitions (stage N → N+1). If the user picks a stage that
 * is several steps ahead, we walk through each intermediate transition
 * automatically — each hop writes its own stage_history row so the audit
 * trail records the full path. Side-effect: smart-advance auto-fires for
 * every intermediate stage's on-enter recipes too.
 *
 * Backwards moves and sideways branches are still subject to the
 * transition graph (and the role gate).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { transitionTo } from "@/lib/blueprints/engine";
import { LEAD_TO_CLIENT_STAGES } from "@/lib/blueprints/lead_to_client";

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
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { toStageKey, remarks } = parsed.data;

    const res = await withTenant(session.tenantId, async (tx) => {
      // 1. Try the direct one-hop transition first — the cheap path.
      const first = await transitionTo(tx, session.tenantId, id, toStageKey, {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks,
      });
      if (first.ok) return first;

      // 2. No direct transition. If the target stage is forward in the
      //    canonical order, walk hop-by-hop so the user effectively
      //    "skips ahead" while we still write every intermediate row.
      const targetIdx = LEAD_TO_CLIENT_STAGES.findIndex((s) => s.key === toStageKey);
      if (targetIdx < 0) return first; // unknown stage — return original error

      // Look up the lead's current stage to compute distance.
      const cur = await tx.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid LIMIT 1
      `);
      const currentKey = (cur.rows[0] as any)?.current_stage_key as string | undefined;
      const currentIdx = currentKey
        ? LEAD_TO_CLIENT_STAGES.findIndex((s) => s.key === currentKey)
        : -1;
      if (currentIdx < 0 || targetIdx <= currentIdx) {
        // Backwards or unchanged → keep the original error so the user knows.
        return first;
      }

      // Walk forward stage by stage. Each hop uses systemBypass so the
      // intermediate transition isn't blocked by the user's role gate
      // (this is the explicit "skip ahead" semantic).
      let last = first;
      for (let i = currentIdx + 1; i <= targetIdx; i++) {
        const nextKey = LEAD_TO_CLIENT_STAGES[i].key;
        last = await transitionTo(tx, session.tenantId, id, nextKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: i === targetIdx ? remarks : `Auto-skipped en route to ${toStageKey}`,
          systemBypass: true,
        });
        if (!last.ok) return last;
      }
      return last;
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.reason }, { status: 409 });
    }
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
