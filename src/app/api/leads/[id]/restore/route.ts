import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/restore — bring a deleted lead back (audit L20).
 *
 * The firm owner, a branch head (for a lead of their branch) or a lead
 * manager (lead.edit.all — whoever can delete in bulk) may restore. The lead
 * returns to the step its journey was on (lib/leads/lifecycle.ts), audited
 * as lead.restore.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { canRestoreLeads, loadEditableLead } from "@/lib/leads/access";
import { restoreLead } from "@/lib/leads/lifecycle";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    if (!canRestoreLeads(session)) {
      return NextResponse.json({ error: "Only the firm owner, a branch head or a lead manager can restore a deleted lead." }, { status: 403 });
    }
    const meta = clientMetaFromHeaders(req.headers);
    const stage = await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);
      return restoreLead(tx, { tenantId: session.tenantId, actorUserId: session.userId, leadId: id }, meta);
    });
    return NextResponse.json({ ok: true, stage });
  } catch (err) {
    return handleApiError(err);
  }
}
