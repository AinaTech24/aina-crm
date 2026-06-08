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
import { fetchNavAll, parseNavAll, type NavRecord } from "@/lib/finance/nav-feed";

export const dynamic = "force-dynamic";
// Fetching + parsing the ~8MB AMFI feed and upserting ~12k rows can take a while
// on a cold catalog; give the manual sync room (honoured by hosts that read it).
export const maxDuration = 300;

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit");

    // 0. Is the shared AMFI universe present? It's the source the per-tenant
    //    catalog is copied from.
    const navCount = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`SELECT COUNT(*)::int AS n FROM scheme_nav`);
      return Number((r.rows[0] as any)?.n ?? 0);
    });

    // 0b. Empty → fetch the live AMFI feed now (network OUTSIDE the transaction).
    let navRecords: NavRecord[] = [];
    if (navCount === 0) {
      const body = await fetchNavAll();
      navRecords = parseNavAll(body);
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // 0c. Seed the shared universe from the freshly-fetched AMFI feed (batched).
      let navSeeded = 0;
      if (navRecords.length) {
        const BATCH = 500;
        for (let i = 0; i < navRecords.length; i += BATCH) {
          const batch = navRecords.slice(i, i + BATCH);
          const values = sql.join(
            batch.map(
              (r) => sql`(${r.schemeCode}, ${r.isin}, ${r.schemeName}, ${r.amcName}, ${r.nav}, ${r.navDate}, now())`
            ),
            sql`, `
          );
          await tx.execute(sql`
            INSERT INTO scheme_nav (scheme_code, isin, scheme_name, amc_name, nav, nav_date, updated_at)
            VALUES ${values}
            ON CONFLICT (scheme_code) DO UPDATE SET
              isin = EXCLUDED.isin,
              scheme_name = EXCLUDED.scheme_name,
              amc_name = EXCLUDED.amc_name,
              nav = EXCLUDED.nav,
              nav_date = EXCLUDED.nav_date,
              updated_at = now()
          `);
        }
        navSeeded = navRecords.length;
      }

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

      // 2. Scheme master — the AMFI universe, with mfapi category + a coarse bucket.
      const res = await tx.execute(sql`
        INSERT INTO scheme_master
          (id, tenant_id, amc_code, scheme_code, scheme_name, category, coarse_category, is_active, created_at, updated_at)
        SELECT gen_random_uuid(), ${session.tenantId}::uuid,
               COALESCE(NULLIF(TRIM(sn.amc_name), ''), m.fund_house, 'Unknown'),
               sn.scheme_code, sn.scheme_name, m.scheme_category,
               CASE
                 WHEN m.scheme_category ILIKE '%liquid%' OR m.scheme_category ILIKE '%overnight%' OR m.scheme_category ILIKE '%money market%' THEN 'liquid'
                 WHEN m.scheme_category ILIKE '%hybrid%' OR m.scheme_category ILIKE '%balanced%' THEN 'hybrid'
                 WHEN m.scheme_category ILIKE '%equity%' OR m.scheme_category ILIKE '%elss%' OR m.scheme_category ILIKE '%index%' THEN 'equity'
                 WHEN m.scheme_category ILIKE '%debt%' OR m.scheme_category ILIKE '%bond%' OR m.scheme_category ILIKE '%gilt%' OR m.scheme_category ILIKE '%duration%' THEN 'debt'
                 WHEN m.scheme_category ILIKE '%gold%' OR m.scheme_category ILIKE '%silver%' OR m.scheme_category ILIKE '%commodit%' THEN 'commodity'
                 WHEN m.scheme_category ILIKE '%international%' OR m.scheme_category ILIKE '%global%' THEN 'international'
                 ELSE 'other'
               END,
               true, now(), now()
        FROM scheme_nav sn
        LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
        WHERE sn.scheme_code IS NOT NULL AND sn.scheme_name IS NOT NULL AND TRIM(sn.scheme_name) <> ''
        ON CONFLICT (tenant_id, amc_code, scheme_code) DO UPDATE
          SET scheme_name = EXCLUDED.scheme_name,
              category = COALESCE(EXCLUDED.category, scheme_master.category),
              coarse_category = COALESCE(scheme_master.coarse_category, EXCLUDED.coarse_category),
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
