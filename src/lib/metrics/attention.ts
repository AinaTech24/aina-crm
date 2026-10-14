/**
 * The counts behind "Needs attention" — each defined once, and each the row
 * count of the list its link opens:
 *
 *   Reviews overdue        live clients whose next review DATE is before today
 *                          (India) — the Clients list's `review=overdue`.
 *   Clients missing data   live clients missing PAN, date of birth, nominee,
 *                          bank, a verified KYC or a risk profile — the Clients
 *                          list's `needs_data=1` ("Needs attention" filter).
 *   Open complaints        SEBI complaints open, in progress or escalated — the
 *                          Complaint Register's "Open complaints".
 *   Claims open > N days   open insurance claims intimated more than N days ago.
 *   Renewals due           in-force policies whose next premium falls due
 *                          within N days (or is already past due). A
 *                          single-premium policy has nothing to renew and is
 *                          left out, as the Insurance register does.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { STATUS_IN_FORCE, CLAIM_OPEN, inList } from "@/lib/insurance/book";
import { POLICY_FROM, policyWhere } from "./insurance";
import { clientRecordWhere, clientWhere, col, type MetricScope } from "./scope";
import { missingDobSql, needsNomineeSql } from "@/lib/investors/type-rules";

const today = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;

/** Next review date before today, on an investors alias. */
export function reviewOverdueSql(alias = "i"): SQL {
  return sql`${col(alias, "next_review_at")} IS NOT NULL
    AND (${col(alias, "next_review_at")} AT TIME ZONE 'Asia/Kolkata')::date < ${today}`;
}

/** Missing any of the data a client file needs, on an investors alias. */
export function missingDataSql(alias = "i"): SQL {
  const c = (k: string) => col(alias, k);
  return sql`(
    ${c("pan")} IS NULL OR btrim(${c("pan")}) = ''
    OR ${missingDobSql(alias)}
    OR ${needsNomineeSql(alias)}
    OR ${c("bank_account_masked")} IS NULL OR btrim(${c("bank_account_masked")}) = ''
    OR ${c("kyc_status")} IS NULL OR ${c("kyc_status")} NOT IN ('validated', 'registered', 'verified')
    OR ${c("risk_profile")} IS NULL OR ${c("risk_profile_signed_at")} IS NULL
  )`;
}

export async function getReviewsOverdue(tx: Tx, scope: MetricScope): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM investors i WHERE ${clientWhere(scope, "i")} AND ${reviewOverdueSql("i")}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

export async function getClientsMissingData(tx: Tx, scope: MetricScope): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM investors i WHERE ${clientWhere(scope, "i")} AND ${missingDataSql("i")}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

export async function getOpenComplaints(tx: Tx, scope: MetricScope): Promise<number> {
  const restricted = (scope.rmIds?.length ?? 0) + (scope.branchIds?.length ?? 0) > 0;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE sr.tenant_id = ${scope.tenantId}::uuid AND sr.type = 'complaint'
       AND sr.status IN ('open', 'in_progress', 'escalated')
       ${restricted ? sql`AND ${clientRecordWhere(scope, "i")}` : sql``}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** Open claims intimated more than `days` days ago, for clients in scope. */
export async function getClaimsOpenOver(tx: Tx, scope: MetricScope, days: number): Promise<number> {
  const restricted = (scope.rmIds?.length ?? 0) + (scope.branchIds?.length ?? 0) > 0;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM insurance_claims c LEFT JOIN investors i ON i.id = c.investor_id
     WHERE c.tenant_id = ${scope.tenantId}::uuid
       AND COALESCE(c.claim_status, 'empty') IN (${inList(CLAIM_OPEN)})
       AND COALESCE(c.intimation_date, c.created_at::date) < ${today} - ${days}::int
       ${restricted ? sql`AND ${clientRecordWhere(scope, "i")}` : sql``}
  `)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** In-force policies with a premium due within `days` days (or already past due). */
export async function getRenewalsDue(tx: Tx, scope: MetricScope, days: number): Promise<{ due: number; overdue: number }> {
  const r = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE p.next_premium_due_date BETWEEN ${today} AND ${today} + ${days}::int)::int AS due,
      COUNT(*) FILTER (WHERE p.next_premium_due_date < ${today})::int AS overdue
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(scope)} AND p.status IN (${inList(STATUS_IN_FORCE)})
       AND COALESCE(p.premium_frequency, 'annual') <> 'single'
  `)).rows[0] as { due: number; overdue: number } | undefined;
  return { due: Number(r?.due ?? 0), overdue: Number(r?.overdue ?? 0) };
}
