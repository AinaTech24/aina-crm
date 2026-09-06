import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/merge  — merge a duplicate client into a survivor.
 *
 * Body: { survivorId, loserId, reason? }. Reassigns every child row that
 * references the loser to the survivor, fills the survivor's blank contact
 * fields from the loser, then marks the loser status='inactive' +
 * merged_into_id=survivor. Owner / branch-head only. One transaction, fully
 * audited, reversible via /api/investors/unmerge.
 *
 * The mechanics live in src/lib/investors/merge.ts and are shared with the
 * system auto-merge (/api/investors/merge/auto) so both paths move exactly the
 * same rows — and both are undone by the same un-merge.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { clientMetaFromHeaders } from "@/lib/audit";
import { mergeInvestors } from "@/lib/investors/merge";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  survivorId: z.string().uuid(),
  loserId: z.string().uuid(),
  /** Why these two are the same person — the matched key ("PAN", "Mobile") from
   *  the suggestion list, or an operator's note. Recorded on the loser so the
   *  merged-clients audit can explain each row instead of just listing it. */
  reason: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can merge records" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { survivorId, loserId } = parse.data;
    if (survivorId === loserId) return NextResponse.json({ error: "survivor and loser must differ" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      (tx) =>
        mergeInvestors(tx, {
          tenantId: session.tenantId,
          survivorId,
          loserId,
          byUserId: session.userId,
          source: "manual",
          reason: parse.data.reason,
          auditMeta: meta as any,
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: errMsg.includes("not found") ? 404 : 409 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
