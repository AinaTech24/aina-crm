import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/[id]/full — bundled family detail for the mobile app.
 *
 * The same loader as the web family page (lib/families/detail), so the two
 * agree on who is a member, who is the head, the combined AUM and the goals.
 * Response shape is unchanged for the app: family · members · rm · primary ·
 * familyGoals · totals · nextGen.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireFamilyView } from "@/lib/families/access";
import { loadFamilyDetail } from "@/lib/families/detail";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireFamilyView(session);

    const data = await withTenant(session.tenantId, (tx) => loadFamilyDetail(tx, session, id), {
      userId: session.userId,
      branchId: session.branchId,
      roles: session.roles,
    });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

    const pick = (m: any) => ({
      id: m.id, name: m.name, pan: m.pan, familyRole: m.familyRole, segmentTag: m.segmentTag,
      aum: m.aum, activeSipAmount: m.activeSipAmount, nomineeName: m.nomineeName, isMinor: m.isMinor,
      dob: m.dob, kycStatus: m.kycStatus, status: m.status,
    });

    return NextResponse.json({
      family: data.family,
      members: data.members.map(pick),
      rm: data.rm,
      primary: data.head ? pick(data.head) : null,
      familyGoals: data.goals,
      totals: data.totals,
      nextGen: data.nextGen.map(pick),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
