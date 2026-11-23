import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/ids?<the Families list's own filters> — the ids of every
 * family the current search / filters match ("Select all N matching records"),
 * so the page does not have to ship them all with every render.
 *
 * Uses the SAME filter as the page (lib/families/list-filter), including the
 * default that hides families with no AUM, so the ids are exactly the N the page
 * counts. At most FAMILY_BULK_MAX are returned (the most a bulk update takes);
 * `total` is the real count. Only people who may edit families get it — the ids
 * are only for bulk changes.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { familyScopeSql, requireFamilyEdit } from "@/lib/families/access";
import { LIVE_MEMBER_JOIN } from "@/lib/families/live";
import { buildFamilyListFilter, parseFamilyListParams } from "@/lib/families/list-filter";
import { FAMILY_BULK_MAX } from "@/lib/families/bulk-fields";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireFamilyEdit(session);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = parseFamilyListParams(sp);

    const out = await withTenant(session.tenantId, async (tx) => {
      const scope = await familyScopeSql(tx, session, "f");
      const { whereSql, havingSql } = buildFamilyListFilter({ tenantId: session.tenantId, userId: session.userId, scope, parsed });
      const r = await tx.execute(sql`
        SELECT f.id FROM families f
          LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
          ${whereSql}
         GROUP BY f.id ${havingSql}
         ORDER BY f.id
         LIMIT ${FAMILY_BULK_MAX + 1}
      `);
      const ids = (r.rows as Array<{ id: string }>).map((x) => String(x.id));
      if (ids.length <= FAMILY_BULK_MAX) return { ids, total: ids.length };
      // More than one request can take: report the true total, hand back the first batch.
      const c = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM (
          SELECT f.id FROM families f LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
          ${whereSql} GROUP BY f.id ${havingSql}
        ) sub
      `);
      return { ids: ids.slice(0, FAMILY_BULK_MAX), total: Number((c.rows[0] as { c?: number } | undefined)?.c ?? ids.length) };
    });

    return NextResponse.json({ ids: out.ids, total: out.total, max: FAMILY_BULK_MAX });
  } catch (err) {
    return handleApiError(err);
  }
}
