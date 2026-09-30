/**
 * FY targets, per whole firm, branch or person — ANNUAL figures, one row per
 * fiscal year, in three tables with three vocabularies:
 *
 *   firm     business_targets (Finances → Progress)
 *   branch   annual_targets, scope_type 'branch' (Settings → Targets)
 *   person   kra_targets (Team → Scorecard)
 *
 * Achievement is always FY-to-date against the FY target. A target is only
 * compared with a figure over the SAME book: under a segment, category, AMC or
 * other client filter the answer is null ("Not for a filtered view"), never a
 * percentage of a target that describes the whole book.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cleanIds, hasClientFilter, uuidList, type MetricScope } from "./scope";

export type TargetMetric = "new_clients" | "net_business" | "aum" | "sip_book";

const FIRM_KEY: Partial<Record<TargetMetric, string>> = { new_clients: "new_clients" };
const BRANCH_KEY: Record<TargetMetric, string> = {
  new_clients: "new_clients", net_business: "net_business", aum: "aum", sip_book: "sip_book_addition",
};
const PERSON_KEY: Record<TargetMetric, string> = {
  new_clients: "new_clients", net_business: "mf_business", aum: "aum", sip_book: "sip_book",
};

/** The FY target for the scope's book, or null when none is set or the book is filtered. */
export async function getTarget(tx: Tx, scope: MetricScope, fiscalYear: string, metric: TargetMetric): Promise<number | null> {
  if (hasClientFilter(scope) || scope.amcs?.length) return null;
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  let v: unknown = null;
  if (rms.length && !branches.length) {
    v = (await tx.execute(sql`
      SELECT SUM(annual_target) AS v, COUNT(*) AS n FROM kra_targets
       WHERE tenant_id = ${scope.tenantId}::uuid AND fiscal_year = ${fiscalYear}
         AND metric_key = ${PERSON_KEY[metric]} AND user_id IN (${uuidList(rms)}) AND annual_target > 0
    `)).rows[0];
  } else if (branches.length && !rms.length) {
    v = (await tx.execute(sql`
      SELECT SUM(target_value) AS v, COUNT(*) AS n FROM annual_targets
       WHERE tenant_id = ${scope.tenantId}::uuid AND fiscal_year = ${fiscalYear} AND scope_type = 'branch'
         AND metric_key = ${BRANCH_KEY[metric]} AND scope_id IN (${uuidList(branches)}) AND target_value > 0
    `)).rows[0];
  } else if (!rms.length && !branches.length && FIRM_KEY[metric]) {
    v = (await tx.execute(sql`
      SELECT SUM(annual_target) AS v, COUNT(*) AS n FROM business_targets
       WHERE tenant_id = ${scope.tenantId}::uuid AND fiscal_year = ${fiscalYear}
         AND metric = ${FIRM_KEY[metric]!} AND annual_target > 0
    `)).rows[0];
  }
  const row = v as { v: string | null; n: string | number } | null;
  // Every RM / branch in the slice must have a target, or the sum understates it.
  const want = rms.length || branches.length || 1;
  if (!row || row.v == null || Number(row.n) < want) return null;
  const n = Number(row.v);
  return n > 0 ? n : null;
}

/** Each person's FY target for a metric. */
export async function getTargetsByUser(
  tx: Tx, tenantId: string, fiscalYear: string, metric: TargetMetric,
): Promise<Map<string, number>> {
  const rows = (await tx.execute(sql`
    SELECT user_id, annual_target FROM kra_targets
     WHERE tenant_id = ${tenantId}::uuid AND fiscal_year = ${fiscalYear}
       AND metric_key = ${PERSON_KEY[metric]} AND annual_target > 0
  `)).rows as Array<{ user_id: string; annual_target: string }>;
  return new Map(rows.map((r) => [r.user_id, Number(r.annual_target)]));
}

/** Each branch's FY target for a metric. */
export async function getTargetsByBranch(
  tx: Tx, tenantId: string, fiscalYear: string, metric: TargetMetric,
): Promise<Map<string, number>> {
  const rows = (await tx.execute(sql`
    SELECT scope_id, target_value FROM annual_targets
     WHERE tenant_id = ${tenantId}::uuid AND fiscal_year = ${fiscalYear} AND scope_type = 'branch'
       AND metric_key = ${BRANCH_KEY[metric]} AND target_value > 0 AND scope_id IS NOT NULL
  `)).rows as Array<{ scope_id: string; target_value: string }>;
  return new Map(rows.map((r) => [r.scope_id, Number(r.target_value)]));
}
