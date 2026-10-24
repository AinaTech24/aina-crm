/**
 * GET /api/reports/data-hygiene
 *
 * Quick data-quality scan across the tenant's investor master. Returns
 * counts of clients missing each critical field — drives the "Data gaps"
 * tile on the Owner Cockpit and powers the deep-link to the filtered
 * Clients list where the user can bulk-fix.
 *
 * Cheap query: one SELECT with COUNT(*) FILTER (...) — single index
 * scan on investors(tenant_id, status). Tested fine to 100K clients.
 *
 * Each gap row has:
 *   - key   — machine identifier
 *   - label — human label
 *   - count — number of investors missing this field
 *   - href  — link to the Clients list pre-filtered to the bad rows
 *   - severity — "high" if compliance-relevant (PAN, KYC), else "medium"
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { missingDobSql, needsNomineeSql, panAadhaarGapSql } from "@/lib/investors/type-rules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      // One round-trip — Postgres aggregates with FILTER are very cheap
      // on an indexed table even at 5M clients.
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE pan IS NULL OR pan = '')             AS pan_missing,
          COUNT(*) FILTER (WHERE phone IS NULL OR phone = '')         AS phone_missing,
          COUNT(*) FILTER (WHERE email IS NULL OR email = '')         AS email_missing,
          COUNT(*) FILTER (WHERE ${missingDobSql("")})                AS dob_missing,
          COUNT(*) FILTER (WHERE ${needsNomineeSql("")})              AS nominee_missing,
          COUNT(*) FILTER (WHERE bank_account_masked IS NULL
                              OR bank_account_masked = '')            AS bank_missing,
          COUNT(*) FILTER (WHERE risk_profile IS NULL
                              OR risk_profile_signed_at IS NULL)      AS risk_missing,
          COUNT(*) FILTER (WHERE kyc_status != 'verified')             AS kyc_unverified,
          COUNT(*) FILTER (WHERE rm_id IS NULL)                       AS rm_missing,
          COUNT(*) FILTER (WHERE ${panAadhaarGapSql("")}) AS pan_aadhaar_unlinked,
          COUNT(*)                                                    AS total
        FROM investors
        WHERE status IN ('active', 'dormant') AND deleted_at IS NULL
      `);
      // Per-branch split for the same gaps. Grouped once rather than ten
      // times; branches are few, so this stays a cheap second round-trip.
      const b = await tx.execute(sql`
        SELECT
          COALESCE(br.name, 'Unassigned branch')                       AS branch,
          COUNT(*) FILTER (WHERE i.pan IS NULL OR i.pan = '')          AS pan_missing,
          COUNT(*) FILTER (WHERE i.phone IS NULL OR i.phone = '')      AS phone_missing,
          COUNT(*) FILTER (WHERE i.email IS NULL OR i.email = '')      AS email_missing,
          COUNT(*) FILTER (WHERE ${missingDobSql("i")})                AS dob_missing,
          COUNT(*) FILTER (WHERE ${needsNomineeSql("i")})              AS nominee_missing,
          COUNT(*) FILTER (WHERE i.bank_account_masked IS NULL
                              OR i.bank_account_masked = '')           AS bank_missing,
          COUNT(*) FILTER (WHERE i.risk_profile IS NULL
                              OR i.risk_profile_signed_at IS NULL)     AS risk_missing,
          COUNT(*) FILTER (WHERE i.kyc_status != 'verified')           AS kyc_unverified,
          COUNT(*) FILTER (WHERE i.rm_id IS NULL)                      AS rm_missing,
          COUNT(*) FILTER (WHERE i.pan_aadhaar_link_status = 'not_linked'
                              OR i.pan_aadhaar_link_status IS NULL)    AS pan_aadhaar_unlinked,
          COUNT(*)                                                     AS total
        FROM investors i
        LEFT JOIN branches br ON br.id = i.branch_id
        WHERE i.status IN ('active', 'dormant') AND i.deleted_at IS NULL
        GROUP BY 1
        ORDER BY 1
      `);
      return { totals: r.rows[0] as any, byBranch: b.rows as any[] };
    });

    const { totals, byBranch } = rows;
    const total = Number(totals?.total ?? 0);
    const cap = (n: any) => Number(n ?? 0);

    /**
     * "Mumbai 122 · Madurai 252" for one gap column. Branches with nothing
     * missing are dropped — naming a branch that is already clean is noise,
     * and on a single-branch firm this collapses to nothing at all.
     */
    const splitFor = (col: string) =>
      byBranch
        .map((b) => ({ branch: String(b.branch), count: Number(b[col] ?? 0) }))
        .filter((x) => x.count > 0)
        .sort((a, b2) => b2.count - a.count);
    /**
     * Per-branch completeness, weighted across the five fields a firm is
     * actually judged on: KYC, nominee, risk profile, DOB and PAN. Each branch
     * scores (filled / possible) across those five, so one branch with 1,155
     * clients and one with 216 are directly comparable.
     */
    const COMPLETENESS_COLS = [
      "kyc_unverified",
      "nominee_missing",
      "risk_missing",
      "dob_missing",
      "pan_missing",
    ] as const;
    const completeness = byBranch
      .map((b) => {
        const clients = Number(b.total ?? 0);
        if (clients === 0) return null;
        const possible = clients * COMPLETENESS_COLS.length;
        const missing = COMPLETENESS_COLS.reduce((sum, c) => sum + Number(b[c] ?? 0), 0);
        return {
          branch: String(b.branch),
          clients,
          pct: Math.round(((possible - missing) / possible) * 100),
        };
      })
      .filter((x): x is { branch: string; clients: number; pct: number } => x !== null)
      .sort((a, b2) => b2.clients - a.clients);

    const gaps = [
      {
        key: "pan",
        label: "Missing PAN",
        count: cap(totals.pan_missing),
        href: "/dashboard/investors?gaps=pan",
        severity: "high",
        branches: splitFor("pan_missing"),
      },
      {
        key: "pan_aadhaar",
        label: "PAN-Aadhaar unlinked",
        count: cap(totals.pan_aadhaar_unlinked),
        href: "/dashboard/investors?gaps=pan_aadhaar",
        severity: "high",
        branches: splitFor("pan_aadhaar_unlinked"),
      },
      {
        key: "phone",
        label: "Missing phone",
        count: cap(totals.phone_missing),
        href: "/dashboard/investors?gaps=phone",
        severity: "medium",
        branches: splitFor("phone_missing"),
      },
      {
        key: "email",
        label: "Missing email",
        count: cap(totals.email_missing),
        href: "/dashboard/investors?gaps=email",
        severity: "medium",
        branches: splitFor("email_missing"),
      },
      {
        key: "dob",
        label: "Missing DOB",
        count: cap(totals.dob_missing),
        href: "/dashboard/investors?gaps=dob",
        severity: "high",
        branches: splitFor("dob_missing"),
      },
      {
        key: "nominee",
        label: "No nominee",
        count: cap(totals.nominee_missing),
        href: "/dashboard/investors?gaps=nominee",
        severity: "high",
        branches: splitFor("nominee_missing"),
      },
      {
        key: "bank",
        label: "No bank on file",
        count: cap(totals.bank_missing),
        href: "/dashboard/investors?gaps=bank",
        severity: "medium",
        branches: splitFor("bank_missing"),
      },
      {
        key: "risk_profile",
        label: "No risk profile",
        count: cap(totals.risk_missing),
        href: "/dashboard/investors?gaps=risk_profile",
        severity: "high",
        branches: splitFor("risk_missing"),
      },
      {
        key: "kyc",
        label: "KYC not verified",
        count: cap(totals.kyc_unverified),
        href: "/dashboard/investors?kyc=pending,expired,not_started",
        severity: "high",
        branches: splitFor("kyc_unverified"),
      },
      {
        key: "rm",
        label: "Unassigned (no RM)",
        count: cap(totals.rm_missing),
        href: "/dashboard/investors?gaps=rm",
        severity: "medium",
        branches: splitFor("rm_missing"),
      },
    ].filter((g) => g.count > 0);

    return NextResponse.json({ total, gaps , completeness});
  } catch (err: any) {
    return handleApiError(err);
  }
}
