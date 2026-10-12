/**
 * POST /api/schemes/sync — populate this firm's per-tenant Scheme Master (and AMC
 * Master) from the platform-shared AMFI universe (`scheme_nav`) + mfapi category
 * detail (`mf_schemes`). Idempotent — re-running upserts, never duplicates.
 *
 * Self-seeding: the shared `scheme_nav` table is normally filled by the daily
 * background NAV worker. If that worker hasn't run yet on this deployment (so the
 * shared table is empty), this route fetches the LIVE AMFI NAVAll feed itself and
 * populates `scheme_nav` first — so "Sync from AMFI" genuinely works on its own,
 * not only after the worker has seeded the catalog. (scheme_nav has no RLS, so it
 * can be written inside the tenant transaction without needing ALLOW_SYSTEM_TX.)
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { fetchNavAll, importNavAll } from "@/lib/finance/nav-feed";
import { planSql, coarseSql } from "@/lib/schemes/classify";

export const dynamic = "force-dynamic";
// Fetching + parsing the ~8MB AMFI feed and upserting ~12k rows can take a while
// on a cold catalog; give the manual sync room (honoured by hosts that read it).
export const maxDuration = 300;

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);

    // 0. Is the shared AMFI universe present AND carrying the scheme-type/category
    //    metadata? A catalog seeded before that metadata existed has rows but no
    //    scheme_type — re-fetch so the new fields (type/category/reinvest-ISIN)
    //    backfill rather than staying NULL until the nightly NAV worker runs.
    const { n: navCount, typed } = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT COUNT(*)::int AS n, COUNT(scheme_type)::int AS typed FROM scheme_nav`
      );
      const row = r.rows[0] as any;
      return { n: Number(row?.n ?? 0), typed: Number(row?.typed ?? 0) };
    });

    // 0b. Empty OR un-enriched → fetch the live AMFI feed now (network OUTSIDE
    //     the transaction). The upsert below then backfills the new columns.
    // Through the one validated, provenance-recorded path (Phase 3I): layout
    // checked column by column, an older file never overwrites a newer NAV,
    // the import recorded in amfi_feed_imports.
    let navSeeded = 0;
    if (navCount === 0 || typed === 0) {
      const body = await fetchNavAll();
      const imp = await importNavAll(body, { source: "download", sourceRef: "schemes/sync", by: session.userId });
      if (imp.status === "rejected") return NextResponse.json({ error: `The AMFI feed was refused: ${imp.reason}` }, { status: 502 });
      navSeeded = imp.written;
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // 1. AMC master — one row per distinct AMC name in the shared catalog.
      await tx.execute(sql`
        INSERT INTO amc_master (id, tenant_id, code, name, created_at, updated_at)
        SELECT gen_random_uuid(), ${session.tenantId}::uuid, amc, amc, now(), now()
        FROM (
          SELECT DISTINCT COALESCE(NULLIF(TRIM(sn.amc_name), ''), m.fund_house) AS amc
          FROM scheme_nav sn
          LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
        ) a
        WHERE amc IS NOT NULL AND amc <> ''
        ON CONFLICT (tenant_id, code) DO NOTHING
      `);

      // 2. Scheme master — the AMFI universe. Category prefers mfapi's detail but
      //    falls back to the AMFI section-header category (so the WHOLE universe is
      //    classified, not just the mfapi-matched subset). Plan and coarse
      //    category come from lib/schemes/classify (shared with the Scheme
      //    Master page); option from the scheme name; is_closed from the AMFI
      //    scheme structure.
      const res = await tx.execute(sql`
        INSERT INTO scheme_master
          (id, tenant_id, amc_code, scheme_code, scheme_name, category, sub_category,
           coarse_category, plan, "option", is_closed, is_active, created_at, updated_at)
        SELECT gen_random_uuid(), ${session.tenantId}::uuid,
               COALESCE(NULLIF(TRIM(sn.amc_name), ''), m.fund_house, 'Unknown'),
               sn.scheme_code, sn.scheme_name,
               COALESCE(m.scheme_category, sn.scheme_category),
               sn.scheme_category,
               ${coarseSql(sql`COALESCE(m.scheme_category, sn.scheme_category, '')`, sql`sn.scheme_name`)},
               ${planSql(sql`sn.scheme_name`, sql`COALESCE(m.scheme_category, sn.scheme_category)`)},
               CASE WHEN sn.scheme_name ILIKE '%reinvest%' THEN 'idcw_reinvest'
                    WHEN sn.scheme_name ILIKE '%idcw%' OR sn.scheme_name ILIKE '%dividend%' OR sn.scheme_name ILIKE '%payout%' THEN 'idcw_payout'
                    WHEN sn.scheme_name ILIKE '%growth%' THEN 'growth' ELSE NULL END,
               (sn.scheme_type IS NOT NULL AND sn.scheme_type NOT ILIKE 'open%'),
               true, now(), now()
        FROM scheme_nav sn
        LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
        WHERE sn.scheme_code IS NOT NULL AND sn.scheme_name IS NOT NULL AND TRIM(sn.scheme_name) <> ''
        ON CONFLICT (tenant_id, amc_code, scheme_code) DO UPDATE
          SET scheme_name = EXCLUDED.scheme_name,
              category = COALESCE(EXCLUDED.category, scheme_master.category),
              sub_category = COALESCE(EXCLUDED.sub_category, scheme_master.sub_category),
              -- A category someone set by hand is kept; a blank or "other"
              -- one takes the better mapping.
              coarse_category = CASE WHEN scheme_master.coarse_category IS NULL OR scheme_master.coarse_category = 'other'
                                     THEN EXCLUDED.coarse_category ELSE scheme_master.coarse_category END,
              -- A stored plan wins (named in the scheme, or set by hand); the
              -- derived one only fills a blank.
              plan = COALESCE(scheme_master.plan, EXCLUDED.plan),
              "option" = COALESCE(EXCLUDED."option", scheme_master."option"),
              is_closed = EXCLUDED.is_closed,
              updated_at = now()
      `);

      const totalRow = (await tx.execute(
        sql`SELECT COUNT(*)::int AS n FROM scheme_master WHERE tenant_id = ${session.tenantId}::uuid`
      )).rows[0] as any;
      return { synced: (res as any).rowCount ?? 0, total: Number(totalRow?.n ?? 0), navSeeded };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
