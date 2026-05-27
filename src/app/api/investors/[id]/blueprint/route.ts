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

/**
 * Synthetic stage view for an investor with no source lead.
 *
 * Returns the FULL 15-stage Lead → Client journey so the user sees the
 * whole picture, with stages 1-12 marked as `skipped` (this client never
 * went through them) and stages 13-15 as actually traversed. The UI
 * renders `skipped` with a greyed-out / dashed style so it's clearly
 * different from `done`.
 *
 * Final stage (Active Client) is `current` — the client lives there
 * indefinitely until churn.
 */
function syntheticClientStageView(_investorId: string) {
  const STAGES = [
    // ── Lead phase (skipped for direct-import) ────────────────────────
    { key: "new", name: "New Lead Created", order: 1, phase: "lead" as const },
    { key: "first_call_pending", name: "First Call Pending", order: 2, phase: "lead" as const },
    { key: "appointment_scheduled", name: "Appointment Scheduled", order: 3, phase: "lead" as const },
    { key: "meeting_done", name: "Meeting Completed", order: 4, phase: "lead" as const },
    { key: "post_meeting_qualified", name: "Post-Meeting Qualification", order: 5, phase: "lead" as const },
    { key: "risk_profile_sent", name: "Risk Profile Sent", order: 6, phase: "lead" as const },
    { key: "risk_profiled", name: "Risk Profile Completed", order: 7, phase: "lead" as const },
    { key: "proposal_drafted", name: "Proposal Drafted", order: 8, phase: "lead" as const },
    { key: "proposal_sent", name: "Proposal Sent", order: 9, phase: "lead" as const },
    { key: "proposal_approved", name: "Proposal Approved", order: 10, phase: "lead" as const },
    { key: "docs_requested", name: "Documents Requested", order: 11, phase: "lead" as const },
    { key: "docs_received", name: "Documents Received", order: 12, phase: "lead" as const },
    // ── Client phase ──────────────────────────────────────────────────
    { key: "ops_in_progress", name: "Operations In Progress", order: 13, phase: "client" as const },
    { key: "portal_welcome_sent", name: "Portal Welcome Sent", order: 14, phase: "client" as const },
    { key: "active_client", name: "Active Client", order: 15, phase: "client" as const },
  ];
  const currentIdx = 14; // active_client = stage 15 (index 14)
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
      // Lead-phase stages weren't traversed → "skipped" (distinct from "done").
      // Client-phase stages 13/14 were done implicitly; 15 is current.
      status: (s.phase === "lead"
        ? "skipped"
        : i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "upcoming") as "done" | "current" | "upcoming" | "skipped",
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
