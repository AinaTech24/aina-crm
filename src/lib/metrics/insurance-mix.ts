/**
 * Insurance business by product, and claims by status, for a period — on the
 * insurance module's own vocabulary (lib/insurance/book.ts), the same as the
 * KPI card's premium (insurance.ts) and the Insurance Team Dashboard:
 *
 *   Premium booked   annual premium of ISSUED policies (not proposed, in
 *                    underwriting or cancelled) whose cover began in the
 *                    period. New vs renewal is details.businessType (renewal
 *                    and portability are renewal; blank is new).
 *   Product          the product group (PRODUCT_GROUPS: Health, Life, Motor …).
 *
 *   Claims           claims INTIMATED in the period (intimation date, else the
 *                    date keyed), by status, with the amount claimed and the
 *                    amount settled. For clients in scope, as the claims
 *                    counts in attention.ts.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  CLAIM_STATUS_LABEL, GROUP_LABEL, STATUS_ISSUED_EXCLUDED, bookedOnSql, groupSql, inList, natureSql,
} from "@/lib/insurance/book";
import { POLICY_FROM, policyWhere } from "./insurance";
import { clientRecordWhere, type MetricPeriod, type MetricScope } from "./scope";

export type PremiumByProductRow = { key: string; label: string; newPremium: number; newPolicies: number; renewalPremium: number; renewalPolicies: number };
export type PremiumByProduct = { hasData: boolean; rows: PremiumByProductRow[]; newPremium: number; renewalPremium: number };

export async function getPremiumByProduct(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<PremiumByProduct> {
  const any = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM insurance_policies WHERE tenant_id = ${scope.tenantId}::uuid) AS ok
  `)).rows[0] as { ok: boolean } | undefined;
  const rows = (await tx.execute(sql`
    SELECT ${groupSql("p")} AS grp,
           COALESCE(SUM(p.annual_premium) FILTER (WHERE ${natureSql("p")} = 'new'), 0) AS new_prem,
           COUNT(*) FILTER (WHERE ${natureSql("p")} = 'new')::int AS new_n,
           COALESCE(SUM(p.annual_premium) FILTER (WHERE ${natureSql("p")} = 'renewal'), 0) AS ren_prem,
           COUNT(*) FILTER (WHERE ${natureSql("p")} = 'renewal')::int AS ren_n
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(scope)} AND p.status NOT IN (${inList(STATUS_ISSUED_EXCLUDED)})
       AND ${bookedOnSql("p")} BETWEEN ${p.from}::date AND ${p.to}::date
     GROUP BY 1
  `)).rows as Array<{ grp: string; new_prem: string; new_n: number; ren_prem: string; ren_n: number }>;
  const out = rows
    .map((r) => ({
      key: r.grp, label: GROUP_LABEL[r.grp] ?? "Unclassified",
      newPremium: Number(r.new_prem), newPolicies: Number(r.new_n),
      renewalPremium: Number(r.ren_prem), renewalPolicies: Number(r.ren_n),
    }))
    .sort((a, b) => (b.newPremium + b.renewalPremium) - (a.newPremium + a.renewalPremium));
  return {
    hasData: !!any?.ok,
    rows: out,
    newPremium: out.reduce((s, r) => s + r.newPremium, 0),
    renewalPremium: out.reduce((s, r) => s + r.renewalPremium, 0),
  };
}

export type ClaimsByStatusRow = { key: string; label: string; count: number; claimed: number; settled: number };
export type ClaimsByStatus = { rows: ClaimsByStatusRow[]; count: number; claimed: number; settled: number };

export async function getClaimsByStatus(tx: Tx, scope: MetricScope, p: MetricPeriod): Promise<ClaimsByStatus> {
  const restricted = (scope.rmIds?.length ?? 0) + (scope.branchIds?.length ?? 0) > 0;
  const rows = (await tx.execute(sql`
    SELECT COALESCE(c.claim_status, 'empty') AS status, COUNT(*)::int AS n,
           COALESCE(SUM(c.claimed_amount), 0) AS claimed, COALESCE(SUM(c.settled_amount), 0) AS settled
      FROM insurance_claims c LEFT JOIN investors i ON i.id = c.investor_id
     WHERE c.tenant_id = ${scope.tenantId}::uuid
       AND COALESCE(c.intimation_date, (c.created_at AT TIME ZONE 'Asia/Kolkata')::date) BETWEEN ${p.from}::date AND ${p.to}::date
       ${restricted ? sql`AND ${clientRecordWhere(scope, "i")}` : sql``}
     GROUP BY 1
  `)).rows as Array<{ status: string; n: number; claimed: string; settled: string }>;
  const order = Object.keys(CLAIM_STATUS_LABEL);
  const out = rows
    .map((r) => ({ key: r.status, label: CLAIM_STATUS_LABEL[r.status] ?? r.status, count: Number(r.n), claimed: Number(r.claimed), settled: Number(r.settled) }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return {
    rows: out,
    count: out.reduce((s, r) => s + r.count, 0),
    claimed: out.reduce((s, r) => s + r.claimed, 0),
    settled: out.reduce((s, r) => s + r.settled, 0),
  };
}
