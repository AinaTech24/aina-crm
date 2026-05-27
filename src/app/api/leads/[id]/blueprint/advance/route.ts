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
import { require as requireCap } from "@/lib/auth/rbac";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

const Body = z.object({
  toStageKey: z.string().min(2).max(60),
  remarks: z.string().max(2000).optional(),
  /**
   * Admin-override move. When true, skip the SOP graph check and any
   * multi-hop walk — just stamp the lead at the target stage directly.
   * Set by the Kanban drag-drop (explicit user intent, no need for the
   * SOP to enforce a path). The guided action buttons leave it false so
   * the SOP prereq gates still run.
   */
  force: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.all");
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { toStageKey, remarks, force } = parsed.data;

    const res = await withTenant(session.tenantId, async (tx) => {
      // Force mode — admin override (e.g. Kanban drag). Skip the SOP graph
      // and just move directly. No walk, no intermediate history rows.
      if (force) {
        return await transitionTo(tx, session.tenantId, id, toStageKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: remarks ?? `Forced move via Kanban drag.`,
          systemBypass: true,
        });
      }

      // 1. Try the direct one-hop transition first — the cheap path.
      const first = await transitionTo(tx, session.tenantId, id, toStageKey, {
        actorUserId: session.userId,
        actorRoles: session.roles ?? [],
        remarks,
      });
      if (first.ok) return first;

      // 2. No direct transition. If the target stage is forward in the
      //    canonical order, walk hop-by-hop along the **happy path**
      //    (skipping dead-end branches like not_qualified, call-back
      //    loops, and retry stages) so multi-step jumps stay on the
      //    main SOP rail.
      const HAPPY_PATH = [
        "new",
        "call_done",
        "meeting_scheduled",
        "meeting_done",
        "won_lead",
        "request_documents",
        "documents_pending",
        "documents_received",
        "kyc_validated",
        "ucc_create",
        "ucc_activated",
        "mandate_create",
        "mandate_activated",
        "make_transaction",
        "transaction_successful",
        "family_mapping",
        "update_information",
        "add_in_review_sheet",
      ];
      const targetIdx = HAPPY_PATH.indexOf(toStageKey);
      if (targetIdx < 0) return first; // off-path target (e.g. kyc_pending) — keep original error

      // Look up the lead's current stage to compute distance.
      const cur = await tx.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid LIMIT 1
      `);
      const currentKey = (cur.rows[0] as any)?.current_stage_key as string | undefined;
      const currentIdx = currentKey ? HAPPY_PATH.indexOf(currentKey) : -1;
      if (currentIdx < 0 || targetIdx <= currentIdx) {
        // Current stage isn't on the happy path, or move is backwards/unchanged.
        // Return the original error — caller can retry with force=true.
        return first;
      }

      // Walk forward along the happy path. Each hop uses systemBypass so
      // the intermediate transitions don't need to be defined in the graph.
      let last = first;
      for (let i = currentIdx + 1; i <= targetIdx; i++) {
        const nextKey = HAPPY_PATH[i];
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
