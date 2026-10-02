import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes?q=<text>&limit=<n>[&amc=<amc code>][&source=master|universe]
 *
 * The scheme search behind every scheme picker (SchemeAutocomplete).
 *
 *   source=master (the default) — the firm's own Scheme Master
 *     (scheme_master: active, not closed), the module every scheme field in
 *     the CRM picks from. `amc` narrows it to one AMC. NAV and category are
 *     joined from the AMFI feed (scheme_nav) and mfapi catalog (mf_schemes) by
 *     the shared AMFI scheme code, so calculators keep their NAV history.
 *     `masterEmpty: true` tells the picker the firm has not synced its master
 *     yet (Scheme Master → Sync from AMFI).
 *   source=universe — the whole AMFI universe. Only the Scheme Master page uses
 *     it, to ADD a scheme to the master.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { deriveSchemeRisk } from "@/lib/mf/scheme-risk";

export const dynamic = "force-dynamic";

type Row = {
  code: string; name: string; amc: string | null;
  category: string | null; nav: string | null; nav_date: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ");
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const source = searchParams.get("source") === "universe" ? "universe" : "master";
    const amc = (searchParams.get("amc") ?? "").trim();
    if (q.length < 2 && !(source === "master" && amc)) return NextResponse.json({ schemes: [] });
    // Every word must appear, in any order: "hdfc flexi" finds "HDFC Flexi Cap Fund".
    const words = q.split(/\s+/).filter(Boolean).slice(0, 6);

    const out = await withTenant(session.tenantId, async (tx) => {
      if (source === "universe") {
        // scheme_nav (AMFI feed) is the always-populated universe of schemes;
        // mf_schemes (mfapi catalog) enriches it with scheme_category.
        const match = sql.join(words.map((w) => sql`(sn.scheme_name ILIKE ${`%${w}%`} OR sn.amc_name ILIKE ${`%${w}%`})`), sql` AND `);
        const r = await tx.execute(sql`
          SELECT sn.scheme_code AS code, sn.scheme_name AS name,
                 COALESCE(m.fund_house, sn.amc_name) AS amc, m.scheme_category AS category,
                 COALESCE(m.nav, sn.nav)::numeric AS nav, COALESCE(m.nav_date, sn.nav_date) AS nav_date
            FROM scheme_nav sn
            LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
           WHERE ${match}
           ORDER BY length(sn.scheme_name) ASC, sn.scheme_name ASC
           LIMIT ${limit}
        `);
        return { rows: r.rows as Row[], masterEmpty: false };
      }

      const conds = [sql`s.tenant_id = ${session.tenantId}::uuid`, sql`s.is_active`, sql`COALESCE(s.is_closed, false) = false`];
      if (amc) conds.push(sql`s.amc_code = ${amc}`);
      for (const w of words) conds.push(sql`(s.scheme_name ILIKE ${`%${w}%`} OR s.amc_code ILIKE ${`%${w}%`} OR s.scheme_code = ${w})`);
      const r = await tx.execute(sql`
        SELECT s.scheme_code AS code, s.scheme_name AS name,
               COALESCE(a.name, s.amc_code) AS amc,
               COALESCE(s.category, m.scheme_category) AS category,
               COALESCE(m.nav, sn.nav)::numeric AS nav, COALESCE(m.nav_date, sn.nav_date) AS nav_date
          FROM scheme_master s
          LEFT JOIN amc_master a ON a.tenant_id = s.tenant_id AND a.code = s.amc_code
          LEFT JOIN scheme_nav sn ON sn.scheme_code = s.scheme_code
          LEFT JOIN mf_schemes m ON m.scheme_code = s.scheme_code
         WHERE ${sql.join(conds, sql` AND `)}
         ORDER BY COALESCE(s.is_shortlisted, false) DESC, length(s.scheme_name) ASC, s.scheme_name ASC
         LIMIT ${limit}
      `);
      let masterEmpty = false;
      if (r.rows.length === 0) {
        const n = await tx.execute(sql`SELECT 1 FROM scheme_master WHERE tenant_id = ${session.tenantId}::uuid AND is_active LIMIT 1`);
        masterEmpty = n.rows.length === 0;
      }
      return { rows: r.rows as Row[], masterEmpty };
    });

    return NextResponse.json({
      masterEmpty: out.masterEmpty,
      schemes: out.rows.map((r) => ({
        schemeCode: r.code,
        schemeName: r.name,
        amc: r.amc,
        category: r.category,
        nav: r.nav != null ? Number(r.nav) : null,
        navDate: r.nav_date,
        // SEBI riskometer band derived from the scheme category (mfapi has no
        // official riskometer field). null when it can't be inferred.
        risk: deriveSchemeRisk(r.category, r.name),
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
