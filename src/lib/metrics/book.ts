/**
 * The client book cut four ways — category (A–D), client type, status and KYC
 * — each for the whole live book AND for the clients onboarded in the period,
 * side by side, so "our book is 40% category A" and "this year's new clients
 * are mostly D" can be read off one card.
 *
 *   Whole book        live clients (clientWhere): not deleted, merged or closed.
 *                     The STATUS cut is the exception: it counts every client
 *                     record (clientRecordWhere), because Closed is a status.
 *   Onboarded         client records whose onboarding date (India) falls in the
 *                     period — the new-clients definition (new-clients.ts).
 *
 * Client TYPE is derived, not stored — the Insurance Team Dashboard's rule
 * (lib/dashboard/insurance/window.ts): a corporate or company investor is
 * Corporate; the primary investor of a family is its Family head; anyone else
 * in a family is a Family member; everyone else is an Individual.
 *
 * A blank field is a record gap: "Uncategorised" and "Not recorded" are their
 * own rows, never folded into a real value.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, clientWhere, col, type MetricPeriod, type MetricScope } from "./scope";
import { onboardedInSql } from "./new-clients";

export type BookDimension = "category" | "type" | "status" | "kyc";

export const CLIENT_TYPE_LABEL: Record<string, string> = {
  head: "Family head",
  member: "Family member",
  individual: "Individual",
  corporate: "Corporate",
};

export const CLIENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  redemption_risk: "Redemption risk",
  dormant: "Dormant",
  inactive: "Inactive",
  closed: "Closed",
  none: "Not recorded",
};

export const KYC_STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  validated: "Validated",
  registered: "Registered",
  pending: "Pending",
  hold: "On hold",
  rejected: "Rejected",
  expired: "Expired",
  re_kyc_required: "Re-KYC required",
  none: "Not recorded",
};

/** Family head / member / individual / corporate, over an investors alias. */
export function clientTypeSql(tenantId: string, alias = "i"): SQL {
  return sql`CASE WHEN ${col(alias, "investor_category")} IN ('corporate', 'company', 'llp', 'partnership', 'aop_boi') THEN 'corporate'
    WHEN ${col(alias, "id")} IN (SELECT f.primary_investor_id FROM families f
      WHERE f.tenant_id = ${tenantId}::uuid AND f.primary_investor_id IS NOT NULL) THEN 'head'
    WHEN ${col(alias, "family_id")} IS NOT NULL THEN 'member'
    ELSE 'individual' END`;
}

function keySql(dim: BookDimension, tenantId: string): SQL {
  switch (dim) {
    case "category":
      return sql`COALESCE(NULLIF(upper(btrim(COALESCE(i.client_category, ''))), ''), 'NONE')`;
    case "type":
      return clientTypeSql(tenantId, "i");
    case "status":
      // `exited` is the legacy spelling of `closed`.
      return sql`CASE WHEN i.status = 'exited' THEN 'closed' ELSE COALESCE(NULLIF(i.status, ''), 'none') END`;
    case "kyc":
      return sql`COALESCE(NULLIF(i.kyc_status, ''), 'none')`;
  }
}

function labelOf(dim: BookDimension, key: string): string {
  if (dim === "category") return key === "NONE" ? "Uncategorised" : `Category ${key}`;
  if (dim === "type") return CLIENT_TYPE_LABEL[key] ?? key;
  if (dim === "status") return CLIENT_STATUS_LABEL[key] ?? key;
  return KYC_STATUS_LABEL[key] ?? key;
}

/** Display order: the dimension's natural order, unknown values last. */
const ORDER: Record<BookDimension, string[]> = {
  category: ["A", "B", "C", "D", "NONE"],
  type: ["head", "member", "individual", "corporate"],
  status: ["active", "redemption_risk", "dormant", "inactive", "closed", "none"],
  kyc: ["verified", "validated", "registered", "pending", "hold", "re_kyc_required", "expired", "rejected", "none"],
};

export type BookRow = { key: string; label: string; count: number; aum: number; newCount: number; newAum: number };
export type BookBreakdown = { rows: BookRow[]; total: number; totalAum: number; newTotal: number };

export async function getBookBreakdown(
  tx: Tx, scope: MetricScope, dim: BookDimension, period: MetricPeriod,
): Promise<BookBreakdown> {
  const key = keySql(dim, scope.tenantId);
  const book = dim === "status" ? clientRecordWhere(scope, "i") : clientWhere(scope, "i");
  const rows = (await tx.execute(sql`
    SELECT ${key} AS key,
           COUNT(*) FILTER (WHERE ${book})::int AS n,
           COALESCE(SUM(COALESCE(i.aum, 0)) FILTER (WHERE ${book}), 0) AS aum,
           COUNT(*) FILTER (WHERE ${onboardedInSql(period, "i")})::int AS new_n,
           COALESCE(SUM(COALESCE(i.aum, 0)) FILTER (WHERE ${onboardedInSql(period, "i")}), 0) AS new_aum
      FROM investors i
     WHERE ${clientRecordWhere(scope, "i")}
     GROUP BY 1
  `)).rows as Array<{ key: string; n: number; aum: string; new_n: number; new_aum: string }>;
  const order = ORDER[dim];
  const out: BookRow[] = rows
    .map((r) => ({
      key: r.key, label: labelOf(dim, r.key),
      count: Number(r.n), aum: Number(r.aum), newCount: Number(r.new_n), newAum: Number(r.new_aum),
    }))
    .filter((r) => r.count || r.newCount)
    .sort((a, b) => {
      const ia = order.indexOf(a.key); const ib = order.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.count - a.count;
    });
  return {
    rows: out,
    total: out.reduce((s, r) => s + r.count, 0),
    totalAum: out.reduce((s, r) => s + r.aum, 0),
    newTotal: out.reduce((s, r) => s + r.newCount, 0),
  };
}
