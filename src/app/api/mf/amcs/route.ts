import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/amcs[?q=<text>]
 *
 * The AMCs every AMC field in the CRM picks from: the firm's own AMC master
 * (amc_master, filled by Scheme Master → Sync from AMFI), active rows only.
 * `code` is what scheme_master.amc_code holds, so a picked AMC narrows the
 * scheme picker (/api/mf/schemes?amc=<code>). `masterEmpty` says the firm has
 * not synced yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ");
    const out = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT a.code, a.name,
               (SELECT count(*)::int FROM scheme_master s
                 WHERE s.tenant_id = a.tenant_id AND s.amc_code = a.code AND s.is_active) AS schemes
          FROM amc_master a
         WHERE a.tenant_id = ${session.tenantId}::uuid AND a.is_active
           ${q ? sql`AND (a.name ILIKE ${`%${q}%`} OR a.code ILIKE ${`%${q}%`})` : sql``}
         ORDER BY a.name
         LIMIT 200
      `);
      let masterEmpty = false;
      if (!q && r.rows.length === 0) masterEmpty = true;
      return { rows: r.rows as Array<{ code: string; name: string; schemes: number }>, masterEmpty };
    });
    return NextResponse.json({ amcs: out.rows, masterEmpty: out.masterEmpty });
  } catch (err: any) {
    return handleApiError(err);
  }
}
