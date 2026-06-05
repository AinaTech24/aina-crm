import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes?q=<text>&limit=<n>
 *
 * Search the platform-shared Mutual Fund scheme catalog (mf_schemes, synced
 * daily from mfapi.in), falling back to scheme_nav (AMFI feed) for NAV / AMC.
 * This is the single source the app uses wherever a scheme or AMC is picked.
 * Any authenticated tenant user may read it (RLS: catalog is read-all).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ");
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    if (q.length < 2) return NextResponse.json({ schemes: [] });
    const pat = `%${q}%`;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT m.scheme_code AS code,
               m.scheme_name AS name,
               COALESCE(m.fund_house, sn.amc_name) AS amc,
               m.scheme_category AS category,
               COALESCE(m.nav, sn.nav)::numeric AS nav,
               COALESCE(m.nav_date, sn.nav_date) AS nav_date
        FROM mf_schemes m
        LEFT JOIN scheme_nav sn ON sn.scheme_code = m.scheme_code
        WHERE m.is_active
          AND (m.scheme_name ILIKE ${pat} OR COALESCE(m.fund_house, sn.amc_name) ILIKE ${pat})
        ORDER BY length(m.scheme_name) ASC, m.scheme_name ASC
        LIMIT ${limit}
      `);
      return r.rows as Array<{
        code: string; name: string; amc: string | null;
        category: string | null; nav: string | null; nav_date: string | null;
      }>;
    });

    return NextResponse.json({
      schemes: rows.map((r) => ({
        schemeCode: r.code,
        schemeName: r.name,
        amc: r.amc,
        category: r.category,
        nav: r.nav != null ? Number(r.nav) : null,
        navDate: r.nav_date,
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
