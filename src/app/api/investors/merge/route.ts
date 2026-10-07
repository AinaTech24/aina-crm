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
import { allInMergeScope, mergeInvestors } from "@/lib/investors/merge";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  survivorId: z.string().uuid(),
  loserId: z.string().uuid(),
  /** Why these two are the same person — the matched key ("PAN", "Mobile") from
   *  the suggestion list, or an operator's note. Recorded on the loser so the
   *  merged-clients audit can explain each row instead of just listing it. */
  reason: z.string().max(300).optional(),
  /** Survivor fields to take from the loser where the two disagree. Without
   *  these a merge only fills fields the survivor left blank. */
  fieldOverrides: z.record(z.string(), z.boolean()).optional(),
  /** Explicit acknowledgement that the two records carry different PANs.
   *  Refused without it — see the guard in mergeInvestors. */
  allowPanMismatch: z.boolean().optional(),
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
      async (tx) => {
        // Data scope: both records must be in the viewer's book (and branch).
        if (!(await allInMergeScope(tx, session, [survivorId, loserId]))) return { error: "one or both clients not found" as const };
        return mergeInvestors(tx, {
          tenantId: session.tenantId,
          survivorId,
          loserId,
          byUserId: session.userId,
          source: "manual",
          reason: parse.data.reason,
          auditMeta: meta as any,
          fieldOverrides: parse.data.fieldOverrides as any,
          allowPanMismatch: parse.data.allowPanMismatch,
        });
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if ("error" in result) {
      // A PAN clash is a distinct, recoverable outcome: the caller may re-send
      // with allowPanMismatch once a human has confirmed. Give it its own code
      // and the two PANs so the UI can name them.
      if (result.error === "different PAN") {
        return NextResponse.json(
          {
            error: `These records have different PANs (${result.survivorPan} and ${result.loserPan}), so they are probably different people.`,
            code: "pan_mismatch",
            survivorPan: result.survivorPan,
            loserPan: result.loserPan,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: result.error }, { status: result.error.includes("not found") ? 404 : 409 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
