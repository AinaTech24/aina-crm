import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/sip-rejections/ids?<the SIP Rejections list's own filters> — the ids of every rejection the current search /
 * filters match ("Select all N matching"), so the page need not ship them all with every render.
 *
 * Uses the SAME filter as the page (lib/sip-rejections/list-filter), so the ids are exactly the N the page counts, within
 * the viewer's own scope. At most SIP_REJECTION_BULK_MAX are returned (the most a bulk action takes); `total` is the real
 * count. For people who may run the recovery actions — the ids are only for bulk changes.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { SIP_REJECTION_BULK_MAX, sipRejectionWhere } from "@/lib/sip-rejections/list-filter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());

    const out = await withTenant(session.tenantId, async (tx) => {
      const whereSql = await sipRejectionWhere(tx, session, sp);
      const r = await tx.execute(sql`
        SELECT r.id
          FROM sip_rejections r
          LEFT JOIN investors i ON i.id = r.investor_id
          ${whereSql}
         ORDER BY r.rejection_date DESC, r.created_at DESC
         LIMIT ${SIP_REJECTION_BULK_MAX + 1}
      `);
      const ids = (r.rows as Array<{ id: string }>).map((x) => String(x.id));
      if (ids.length <= SIP_REJECTION_BULK_MAX) return { ids, total: ids.length };
      // More than one action can take: the true total, and the first batch.
      const c = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM sip_rejections r LEFT JOIN investors i ON i.id = r.investor_id ${whereSql}
      `);
      return { ids: ids.slice(0, SIP_REJECTION_BULK_MAX), total: Number((c.rows[0] as { c?: number } | undefined)?.c ?? ids.length) };
    });

    return NextResponse.json({ ids: out.ids, total: out.total, max: SIP_REJECTION_BULK_MAX });
  } catch (err) {
    return handleApiError(err);
  }
}
