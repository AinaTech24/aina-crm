/**
 * Investor blueprint endpoint.
 *
 *   GET /api/investors/[id]/blueprint
 *
 * Returns the StageView the same way /api/leads/[id]/blueprint does, plus
 * an `leadId` field on the response so the client-side bar can call into
 * the existing advance / sync endpoints.
 *
 * Two paths:
 *   1. If the investor was converted from a lead → return that lead's
 *      real blueprint instance (so client-phase stages reflect actual
 *      progress through Operations → Portal → Active).
 *   2. If the investor was added directly (imported, manual entry, etc.)
 *      → return a synthetic stage view marking them as `active_client`
 *      so the bar still renders on the page. The "Re-sync" button stays
 *      disabled in that mode (no real instance to advance).
 *
 * Why this matters: tenants who import their whole book on day one have
 * 0 leads. Without a fallback, the bar hides on every investor page —
 * which the user perceives as a bug ("the client blueprint isn't
 * showing"). The synthetic view fixes that without forcing every import
 * to create a phantom lead.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getStage } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

/** Synthetic stage view for an investor with no source lead. */
function syntheticClientStageView(investorId: string) {
  // The 3 client-phase stages — mirrors lead_to_client.ts order 13-15.
  const STAGES = [
    { key: "ops_in_progress", name: "Operations In Progress", order: 13 },
    { key: "portal_welcome_sent", name: "Portal Welcome Sent", order: 14 },
    { key: "active_client", name: "Active Client", order: 15 },
  ];
  // Direct-import investors are already past onboarding — mark them as
  // active client (the final stage).
  const currentIdx = 2;
  return {
    current: {
      key: STAGES[currentIdx].key,
      name: STAGES[currentIdx].name,
      description: "Imported directly — no lead-side onboarding journey on file.",
      ownerRole: "sales" as const,
      order: STAGES[currentIdx].order,
      slaDays: null,
      allowedActions: [] as string[],
      requiredFields: [] as string[],
      secondsInStage: 0,
      slaRemainingDays: null,
      isDelayed: false,
    },
    allStages: STAGES.map((s, i) => ({
      ...s,
      status: (i < currentIdx
        ? "done"
        : i === currentIdx
          ? "current"
          : "upcoming") as "done" | "current" | "upcoming",
      phase: "client" as const,
    })),
    history: [] as any[],
    leadId: null,
    synthetic: true,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: investorId } = await params;
    const data = await withTenant(session.tenantId, async (tx) => {
      const lead = await tx.execute(sql`
        SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid LIMIT 1
      `);
      const leadId = (lead.rows[0] as any)?.id as string | undefined;
      if (!leadId) {
        return syntheticClientStageView(investorId);
      }
      const view = await getStage(tx, session.tenantId, leadId);
      return { ...view, leadId, synthetic: false };
    });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
