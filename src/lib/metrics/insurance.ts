/**
 * Insurance premium — the KPI card and the Insurance & Claims dashboard, on
 * the insurance module's own vocabulary (lib/insurance/book.ts), so the card
 * and the Insurance page's register agree:
 *
 *   Premium booked in a period   annual premium of ISSUED policies (not
 *                                proposed, in underwriting or cancelled) whose
 *                                cover began in the period
 *                                (COALESCE(risk_cover_start_date, policy_start_date)).
 *   In force                     active, claim filed or claim settled.
 *
 * A policy belongs to an RM through its business owner (the seller when they
 * hold a sales role, else the client's RM) and to a branch through the
 * client's branch (else the branch it was keyed in) — the Insurance module's
 * attribution.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  STATUS_IN_FORCE, STATUS_ISSUED_EXCLUDED, bookedOnSql, branchSql, inList, natureSql, ownerSql,
} from "@/lib/insurance/book";
import { cleanIds, uuidList, type MetricPeriod, type MetricScope } from "./scope";

/** Tenant + the scope's RM / branch on a policies alias `p` (clients `i`, seller `su`, both LEFT JOINed). */
export function policyWhere(scope: MetricScope): SQL {
  const parts: SQL[] = [sql`p.tenant_id = ${scope.tenantId}::uuid`, sql`(i.id IS NULL OR i.deleted_at IS NULL)`];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`${ownerSql("p", "i", "su")} IN (${uuidList(rms)})`);
  if (branches.length) parts.push(sql`${branchSql("p", "i")} IN (${uuidList(branches)})`);
  return sql.join(parts, sql` AND `);
}

export const POLICY_FROM = sql`insurance_policies p
  LEFT JOIN investors i ON i.id = p.investor_id
  LEFT JOIN users su ON su.id = p.sold_by_user_id`;

export type InsurancePremium = {
  /** False when the firm has no policies at all — "—", not ₹0. */
  hasData: boolean;
  premium: number;
  newPremium: number;
  renewalPremium: number;
  policies: number;
  previous: number | null;
};

export async function getInsurancePremium(
  tx: Tx, scope: MetricScope, period: MetricPeriod, previous?: MetricPeriod | null,
): Promise<InsurancePremium> {
  const booked = (p: MetricPeriod) => sql`${bookedOnSql("p")} BETWEEN ${p.from}::date AND ${p.to}::date`;
  const r = (await tx.execute(sql`
    SELECT
      COUNT(*)::int AS any_policy,
      COALESCE(SUM(p.annual_premium) FILTER (WHERE ${booked(period)}), 0) AS premium,
      COALESCE(SUM(p.annual_premium) FILTER (WHERE ${booked(period)} AND ${natureSql("p")} = 'new'), 0) AS new_premium,
      COALESCE(SUM(p.annual_premium) FILTER (WHERE ${booked(period)} AND ${natureSql("p")} = 'renewal'), 0) AS renewal_premium,
      COUNT(*) FILTER (WHERE ${booked(period)})::int AS policies,
      ${previous ? sql`COALESCE(SUM(p.annual_premium) FILTER (WHERE ${booked(previous)}), 0)` : sql`NULL`} AS prev
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(scope)} AND p.status NOT IN (${inList(STATUS_ISSUED_EXCLUDED)})
  `)).rows[0] as Record<string, string | number | null> | undefined;
  return {
    hasData: Number(r?.any_policy ?? 0) > 0,
    premium: Number(r?.premium ?? 0),
    newPremium: Number(r?.new_premium ?? 0),
    renewalPremium: Number(r?.renewal_premium ?? 0),
    policies: Number(r?.policies ?? 0),
    previous: r?.prev == null ? null : Number(r.prev),
  };
}

export type InsuranceInForce = { policies: number; annualPremium: number; sumAssured: number };

export async function getInsuranceInForce(tx: Tx, scope: MetricScope): Promise<InsuranceInForce> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(p.annual_premium), 0) AS prem, COALESCE(SUM(p.sum_assured), 0) AS sa
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(scope)} AND p.status IN (${inList(STATUS_IN_FORCE)})
  `)).rows[0] as Record<string, string | number> | undefined;
  return { policies: Number(r?.n ?? 0), annualPremium: Number(r?.prem ?? 0), sumAssured: Number(r?.sa ?? 0) };
}
