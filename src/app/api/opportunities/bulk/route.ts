/**
 * POST /api/opportunities/bulk — one action on many opportunities at once (the Opportunities list's
 * selection bar). Same contract as /api/business-entries/bulk: { ids, action }.
 *   action = "delete"   remove them for good (lib/opportunities/delete.ts)
 * Rows the viewer may not delete (not theirs, or a client outside their book) are left alone and
 * counted in `skipped`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { requireWorkOpportunities } from "@/lib/opportunities/access";
import { deleteOpportunities } from "@/lib/opportunities/delete";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.literal("delete"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(
      session.tenantId,
      (tx) => deleteOpportunities(tx, session, parsed.data.ids, meta),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    if (!result.deleted.length) {
      return NextResponse.json({ error: "None of these could be deleted — you can only delete opportunities you own or opened." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, count: result.deleted.length, skipped: result.skipped });
  } catch (err) {
    return handleApiError(err);
  }
}
