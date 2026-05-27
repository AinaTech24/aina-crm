/**
 * GET /api/leads/[id]/blueprint/can-advance?to=<stageKey>
 *
 * Returns the prerequisite checklist for advancing a lead to the
 * requested target stage. Shape:
 *
 *   {
 *     ok: boolean,
 *     items: Array<{
 *       label: string,
 *       satisfied: boolean,
 *       hint?: string,
 *       cta?: { href: string; label: string },
 *     }>
 *   }
 *
 * Drives the guided action UI: when the user clicks a stage button
 * (e.g. "Call Done"), the UI calls this first. If `ok` → fire the
 * actual advance. If not → render the unsatisfied items inline with
 * direct CTAs so the user knows what to do.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { checkPrerequisites } from "@/lib/blueprints/prerequisites";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const target = req.nextUrl.searchParams.get("to");
    if (!target) {
      return NextResponse.json({ error: "missing ?to=<stageKey>" }, { status: 400 });
    }
    const data = await withTenant(session.tenantId, async (tx) =>
      checkPrerequisites(tx, session.tenantId, id, target)
    );
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
