/**
 * Leads — ONE stage list and ONE conversion rate.
 *
 * The stages are the Leads board's columns (LEAD_PIPELINE in
 * lib/leads/stages.ts): New → Contacted → Meeting Scheduled → Meeting Done →
 * Proposal Sent → Won / Lost. Every stored value maps to exactly one of them —
 * loop stages and imported vocabularies fold into their column, a lead that
 * has been converted or has moved on into onboarding counts as Won, and the
 * insurance branch's "Not proceeded" counts as Lost. There is no "Qualified"
 * and no "Converted" bucket anywhere.
 *
 * Conversion = Won ÷ (Won + Lost + open), over the SAME leads the stage counts
 * are taken over, so the rate always matches the Won count beside it.
 *
 * A deleted lead is `lost_reason = '__deleted__'` (leads have no deleted_at);
 * it is never counted.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { LEAD_PIPELINE } from "@/lib/leads/stages";
import { expandLeadSources } from "@/lib/leads/sources";
import { cleanIds, col, textList, uuidList, type MetricPeriod, type MetricScope } from "./scope";

export const LEAD_OPEN_KEYS = ["new", "call_done", "meeting_scheduled", "meeting_done", "proposal_sent"] as const;
export const LEAD_WON_KEY = "won_lead";
export const LEAD_LOST_KEY = "not_qualified";

/** Tenant + not deleted + the scope (owner / branch / lead source), on a leads alias. */
export function leadWhere(scope: MetricScope, alias = "l"): SQL {
  const parts: SQL[] = [
    sql`${col(alias, "tenant_id")} = ${scope.tenantId}::uuid`,
    sql`${col(alias, "lost_reason")} IS DISTINCT FROM '__deleted__'`,
  ];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`${col(alias, "owner_id")} IN (${uuidList(rms)})`);
  if (branches.length) {
    // A lead belongs to the branch it was captured in, or — where that was
    // never recorded — its owner's branch (lib/dashboard/my/window.ts).
    parts.push(sql`(${col(alias, "branch_id")} IN (${uuidList(branches)})
      OR (${col(alias, "branch_id")} IS NULL AND ${col(alias, "owner_id")} IN (
        SELECT id FROM users WHERE tenant_id = ${scope.tenantId}::uuid AND branch_id IN (${uuidList(branches)}))))`);
  }
  // Client Referral also matches the old "Existing Client Reference" value.
  if (scope.leadSources?.length) parts.push(sql`${col(alias, "source")} IN (${textList(expandLeadSources(scope.leadSources))})`);
  return sql.join(parts, sql` AND `);
}

/**
 * The board column a lead sits in, as SQL. Built from LEAD_PIPELINE so the
 * dashboard and the board cannot disagree about a single stored value.
 */
export function leadStageKeySql(alias = "l"): SQL {
  const stage = sql`lower(btrim(COALESCE(${col(alias, "stage")}::text, '')))`;
  const whens = LEAD_PIPELINE.map(
    (c) => sql`WHEN ${stage} IN (${textList([...c.members])}) THEN ${c.key}`,
  );
  return sql`CASE
    WHEN ${col(alias, "converted_investor_id")} IS NOT NULL THEN ${LEAD_WON_KEY}
    ${sql.join(whens, sql` `)}
    WHEN ${stage} = 'insurance_lost' THEN ${LEAD_LOST_KEY}
    WHEN ${stage} = '' THEN 'new'
    ELSE ${LEAD_WON_KEY} END`;
  // ELSE: every value not on the board is a client-phase stage (documents,
  // KYC, UCC, mandate, first transaction, the insurance branch) — a lead that
  // was won and is being onboarded.
}

/** The lead is still open (not won, not lost). */
export function leadOpenSql(alias = "l"): SQL {
  return sql`(${leadStageKeySql(alias)}) IN (${textList([...LEAD_OPEN_KEYS])})`;
}

/** India date a lead was created on. */
export function leadCreatedInSql(p: MetricPeriod, alias = "l"): SQL {
  return sql`(${col(alias, "created_at")} AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${p.from}::date AND ${p.to}::date`;
}

export type LeadStageCounts = {
  /** Count per board column key, every column present. */
  byStage: Record<string, number>;
  open: number;
  won: number;
  lost: number;
  total: number;
  /** Won ÷ total, as a fraction; null when there are no leads. */
  conversion: number | null;
};

/**
 * Leads by board column. With a period, over the leads CREATED in it — so the
 * period filter moves every number and a drill-down to the list (created in
 * the same dates) shows the same rows.
 */
export async function getLeadStageCounts(
  tx: Tx, scope: MetricScope, period?: MetricPeriod | null,
): Promise<LeadStageCounts> {
  const rows = (await tx.execute(sql`
    SELECT ${leadStageKeySql("l")} AS key, COUNT(*)::int AS n
      FROM leads l
     WHERE ${leadWhere(scope, "l")}${period ? sql` AND ${leadCreatedInSql(period, "l")}` : sql``}
     GROUP BY 1
  `)).rows as Array<{ key: string; n: number }>;
  return summariseLeadCounts(rows.map((r) => ({ key: r.key, n: Number(r.n) })));
}

/** Pure: fold per-column counts into the summary. Exported for the tests. */
export function summariseLeadCounts(rows: Array<{ key: string; n: number }>): LeadStageCounts {
  const byStage: Record<string, number> = Object.fromEntries(LEAD_PIPELINE.map((c) => [c.key, 0]));
  for (const r of rows) byStage[r.key] = (byStage[r.key] ?? 0) + r.n;
  const open = LEAD_OPEN_KEYS.reduce((s, k) => s + (byStage[k] ?? 0), 0);
  const won = byStage[LEAD_WON_KEY] ?? 0;
  const lost = byStage[LEAD_LOST_KEY] ?? 0;
  const total = open + won + lost;
  return { byStage, open, won, lost, total, conversion: total > 0 ? won / total : null };
}

export type OpenLeads = {
  /** Open leads now, whatever their age. */
  open: number;
  /** Open leads whose next follow-up is today or earlier (India date). */
  followUpDue: number;
};

export async function getOpenLeads(tx: Tx, scope: MetricScope): Promise<OpenLeads> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS open,
           COUNT(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL
             AND (l.next_follow_up_at AT TIME ZONE 'Asia/Kolkata')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS due
      FROM leads l
     WHERE ${leadWhere(scope, "l")} AND ${leadOpenSql("l")}
  `)).rows[0] as { open: number; due: number } | undefined;
  return { open: Number(r?.open ?? 0), followUpDue: Number(r?.due ?? 0) };
}
