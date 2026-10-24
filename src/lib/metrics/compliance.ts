/**
 * Compliance figures — the Compliance dashboard, on the same definitions as
 * the Risk Profiles page, the Clients list's data-gap filters and the
 * Complaint Register.
 *
 *   Expiries      what lapses in the next 30 / 60 / 90 days: bank mandates,
 *                 SIP end dates, CKYC, FATCA, insurance premiums, the firm's
 *                 own registrations. Forward-looking only — anything already
 *                 past its date is today's work (Needs attention), not a forecast.
 *   Gaps          active clients missing a nominee, a verified KYC, PAN–Aadhaar
 *                 linking, or marketing consent; risk profiles due / not done.
 *   Complaints    open SEBI complaints by age against the 21-day clock.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { activeClientSql } from "./clients";
import { getRiskProfileCounts } from "./risk";
import { clientRecordWhere, clientWhere, cleanIds, type MetricScope } from "./scope";
import { inOrder } from "./in-order";
import { needsNomineeSql, panAadhaarGapSql } from "@/lib/investors/type-rules";

const today = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

function buckets(dateCol: SQL): SQL {
  return sql`
    COUNT(*) FILTER (WHERE ${dateCol} BETWEEN ${today} AND ${today} + 30)::int AS d30,
    COUNT(*) FILTER (WHERE ${dateCol} > ${today} + 30 AND ${dateCol} <= ${today} + 60)::int AS d60,
    COUNT(*) FILTER (WHERE ${dateCol} > ${today} + 60 AND ${dateCol} <= ${today} + 90)::int AS d90`;
}

export type ExpiryRow = { key: string; label: string; consequence: string; href: string; d30: number; d60: number; d90: number };

const EXPIRY_META: Record<string, { label: string; consequence: string; href: string }> = {
  mandate: { label: "Bank mandate", consequence: "Renew before the SIP debit bounces", href: "/dashboard/sips" },
  sip_end: { label: "SIP end date", consequence: "The SIP simply stops", href: "/dashboard/reports/sip-expiry" },
  ckyc: { label: "CKYC validity", consequence: "Transactions are rejected at the RTA", href: "/dashboard/reports/kyc-tracker" },
  fatca: { label: "FATCA declaration", consequence: "The folio is frozen for fresh purchases", href: "/dashboard/reports/kyc-tracker" },
  premium: { label: "Insurance premium", consequence: "The policy lapses and cover is lost", href: "/dashboard/insurance/renewals" },
  registration: { label: "ARN / registration", consequence: "The firm cannot transact once it expires", href: "/dashboard/legal-registrations" },
};

export async function getExpiryPipeline(tx: Tx, scope: MetricScope): Promise<ExpiryRow[]> {
  const live = clientWhere(scope, "i");
  const firmWide = !cleanIds(scope.rmIds).length && !cleanIds(scope.branchIds).length;
  const res = await tx.execute(sql`
    SELECT 'mandate' AS key, ${buckets(sql`m.expires_at::date`)}
      FROM mandates m JOIN investors i ON i.id = m.investor_id
     WHERE m.tenant_id = ${scope.tenantId}::uuid AND ${live} AND COALESCE(m.status, '') <> 'cancelled'
    UNION ALL
    SELECT 'sip_end', ${buckets(sql`s.end_date`)}
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${scope.tenantId}::uuid AND ${live} AND s.status = 'active'
    UNION ALL
    SELECT 'ckyc', ${buckets(sql`i.ckyc_expiry_at`)} FROM investors i WHERE ${live}
    UNION ALL
    SELECT 'fatca', ${buckets(sql`i.fatca_expiry_at`)} FROM investors i WHERE ${live}
    UNION ALL
    SELECT 'premium', ${buckets(sql`p.next_premium_due_date`)}
      FROM insurance_policies p JOIN investors i ON i.id = p.investor_id
     WHERE p.tenant_id = ${scope.tenantId}::uuid AND ${live} AND p.status IN ('active', 'claim_filed', 'claim_settled')
    ${firmWide ? sql`
    UNION ALL
    SELECT 'registration', ${buckets(sql`r.expiry_at::date`)}
      FROM legal_registrations r WHERE r.tenant_id = ${scope.tenantId}::uuid` : sql``}
  `);
  return (res.rows as Array<{ key: string; d30: number; d60: number; d90: number }>)
    .map((r) => ({ key: r.key, ...EXPIRY_META[r.key], d30: Number(r.d30), d60: Number(r.d60), d90: Number(r.d90) }))
    .filter((r) => r.label)
    .sort((a, b) => b.d30 - a.d30 || b.d60 + b.d90 - (a.d60 + a.d90));
}

export type ComplianceGap = { key: string; label: string; count: number; href: string };

export async function getComplianceGaps(tx: Tx, scope: MetricScope): Promise<ComplianceGap[]> {
  const base = sql`${clientWhere(scope, "i")} AND ${activeClientSql("i")}`;
  const [risk, r] = await inOrder(
    () => getRiskProfileCounts(tx, scope),
    () => tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${needsNomineeSql("i")})::int AS nominee,
        COUNT(*) FILTER (WHERE i.kyc_status IS NULL OR i.kyc_status NOT IN ('validated', 'registered', 'verified'))::int AS kyc,
        COUNT(*) FILTER (WHERE ${panAadhaarGapSql("i")})::int AS pan_aadhaar,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM consents c WHERE c.investor_id = i.id AND c.scope IN ('marketing', 'all') AND c.status = 'granted' AND c.revoked_at IS NULL
        ))::int AS consent
        FROM investors i WHERE ${base}
    `),
  );
  const g = r.rows[0] as Record<string, number> | undefined;
  const q = (extra: string) => {
    const p = new URLSearchParams(extra);
    // The same clients the counts are taken over: live AND active.
    p.set("alive", "1");
    p.set("status", "active,redemption_risk");
    if (scope.rmIds?.length) p.set("rm", scope.rmIds.join(","));
    if (scope.branchIds?.length) p.set("branch", scope.branchIds.join(","));
    return `/dashboard/investors?${p.toString()}`;
  };
  const rp = (filter: string) => {
    const p = new URLSearchParams({ filter });
    if (scope.rmIds?.length) p.set("rm", scope.rmIds.join(","));
    if (scope.branchIds?.length) p.set("branch", scope.branchIds.join(","));
    return `/dashboard/risk-profiles?${p.toString()}`;
  };
  return [
    { key: "risk_due", label: "Risk profile due or expired", count: risk.needsAction, href: rp("due,expired") },
    { key: "risk_none", label: "No risk profile", count: risk.not_profiled, href: rp("not_profiled") },
    { key: "risk_awaiting", label: "Risk profile awaiting client confirmation", count: risk.awaiting, href: rp("awaiting") },
    { key: "nominee", label: "Nominee missing", count: Number(g?.nominee ?? 0), href: q("gaps=nominee") },
    { key: "kyc", label: "KYC not verified", count: Number(g?.kyc ?? 0), href: q("gaps=kyc") },
    { key: "pan_aadhaar", label: "PAN not linked to Aadhaar", count: Number(g?.pan_aadhaar ?? 0), href: q("gaps=pan_aadhaar") },
    { key: "consent", label: "No marketing consent on record", count: Number(g?.consent ?? 0), href: q("gaps=marketing_consent") },
  ];
}

export type ComplaintAgeing = { d7: number; d14: number; d21: number; over21: number; total: number };

/** Open complaints by days since they were raised, against SEBI's 21-day clock. */
export async function getComplaintAgeing(tx: Tx, scope: MetricScope): Promise<ComplaintAgeing> {
  const restricted = cleanIds(scope.rmIds).length + cleanIds(scope.branchIds).length > 0;
  const age = sql`(${today} - (sr.created_at AT TIME ZONE 'Asia/Kolkata')::date)`;
  const r = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE ${age} <= 7)::int AS d7,
           COUNT(*) FILTER (WHERE ${age} BETWEEN 8 AND 14)::int AS d14,
           COUNT(*) FILTER (WHERE ${age} BETWEEN 15 AND 21)::int AS d21,
           COUNT(*) FILTER (WHERE ${age} > 21)::int AS over21,
           COUNT(*)::int AS total
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE sr.tenant_id = ${scope.tenantId}::uuid AND sr.type = 'complaint'
       AND sr.status IN ('open', 'in_progress', 'escalated')
       ${restricted ? sql`AND ${clientRecordWhere(scope, "i")}` : sql``}
  `)).rows[0] as ComplaintAgeing | undefined;
  return {
    d7: Number(r?.d7 ?? 0), d14: Number(r?.d14 ?? 0), d21: Number(r?.d21 ?? 0),
    over21: Number(r?.over21 ?? 0), total: Number(r?.total ?? 0),
  };
}
