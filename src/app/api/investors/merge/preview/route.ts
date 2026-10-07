import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/merge/preview — what a merge WOULD do, without doing it.
 *
 * Body: { survivorId, loserIds[] }
 *
 * Returns the child rows that move, the ones deliberately left on the retired
 * record, the fields where the records disagree, and whether the PANs clash.
 * The counting runs the same table discovery and denylist as the merge itself
 * (src/lib/investors/merge.ts), so the preview cannot promise something the
 * merge won't do.
 *
 * Read-only, but gated to the same roles as the merge: it enumerates another
 * client's record counts, which is not something a non-manager should browse.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { allInMergeScope, previewMerge } from "@/lib/investors/merge";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  survivorId: z.string().uuid(),
  loserIds: z.array(z.string().uuid()).min(1).max(25),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) {
      return NextResponse.json({ error: "only owners / branch heads can merge records" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        // Data scope: every record must be in the viewer's book (and branch).
        if (!(await allInMergeScope(tx, session, [parse.data.survivorId, ...parse.data.loserIds]))) {
          return { error: "one or both clients not found" as const };
        }
        return previewMerge(tx, {
          tenantId: session.tenantId,
          survivorId: parse.data.survivorId,
          loserIds: parse.data.loserIds,
        });
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
