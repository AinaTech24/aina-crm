/**
 * Lead pipeline — where the open leads are sitting RIGHT NOW, and which of them
 * have been sitting too long.
 *
 * This is deliberately not the lead funnel. The funnel is a period flow ("of the
 * leads created this month, how far did they get"), which is empty for most of
 * any given month and says nothing about the book as it stands. Occupancy is a
 * snapshot, and it answers the question an owner actually asks on a Monday:
 * where is the pipeline stuck?
 *
 * Three things it does that grouping by the raw `stage` column cannot:
 *
 * 1. NORMALISES the stage. Firms arrive with their own vocabulary — a CSV
 *    import full of `contacted` / `qualified` / `proposal_sent`, or an older
 *    seed — and `normalizeLeadStage` already folds those onto the canonical
 *    stage everywhere else in the app. Grouping by the raw column instead
 *    shows "Contacted" and "Call Done" as two separate bars for one step.
 *
 * 2. ORDERS BY THE PIPELINE, not by count. A pipeline sorted by volume is a bar
 *    chart, not a pipeline; you cannot see where leads pile up.
 *
 * 3. Counts SLA BREACHES per stage, from the `slaDays` the blueprint already
 *    carries. Occupancy alone is a picture; occupancy plus "7 of these are past
 *    their SLA" is a worklist.
 */
import { sql, type SQL } from "drizzle-orm";

import { LEAD_PHASE_STAGES, LEAD_STAGE_ALIASES } from "@/lib/leads/normalize";
import { LEAD_TO_CLIENT_STAGES, stageFlavour } from "@/lib/blueprints/lead_to_client";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

export type LeadStageBucket = {
  key: string;
  name: string;
  count: number;
  /** In this stage longer than the blueprint's SLA for it. */
  overdue: number;
  slaDays: number | null;
  flavour: "default" | "loop" | "terminal_success" | "terminal_failure";
};

export type LeadPipeline = {
  /** Main-path stages, in blueprint order. */
  path: LeadStageBucket[];
  /** Call-back loops — real work, but not forward motion. */
  loops: LeadStageBucket[];
  /** Dead ends, kept out of the path so they can't read as progress. */
  closed: LeadStageBucket[];
  openTotal: number;
  overdueTotal: number;
};

const STAGE_META = new Map(LEAD_TO_CLIENT_STAGES.map((s) => [s.key, s]));

/**
 * `CASE WHEN lower(trim(stage)) IN (…) THEN '<canonical>' … ELSE stage END`,
 * built from the same alias table the TS normaliser uses so the two can't drift.
 * Only aliases that resolve to a lead-phase stage are folded — a lead sitting in
 * a client-phase stage is past this chart and is excluded below anyway.
 */
function canonicalStageSql(): SQL {
  const norm = sql`lower(btrim(coalesce(stage::text, '')))`;
  const byTarget = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(LEAD_STAGE_ALIASES)) {
    if (!(LEAD_PHASE_STAGES as readonly string[]).includes(target)) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), alias]);
  }
  const whens: SQL[] = [];
  for (const [target, aliases] of byTarget) {
    whens.push(sql`WHEN ${norm} IN (${sql.join(aliases.map((a) => sql`${a}`), sql`, `)}) THEN ${target}`);
  }
  // No aliases configured would make this `CASE ELSE … END`, which is invalid.
  if (whens.length === 0) return norm;
  return sql`CASE ${sql.join(whens, sql` `)} ELSE ${norm} END`;
}

/**
 * `CASE key WHEN 'new' THEN 1 … END` — the blueprint's per-stage SLA as SQL, so
 * the breach count is computed where the rows already are.
 */
function slaDaysSql(): SQL {
  const whens = LEAD_PHASE_STAGES.map((key) => {
    const sla = STAGE_META.get(key)?.slaDays;
    // The ::numeric is load-bearing. Every arm is a bind parameter, so there is
    // nothing for Postgres to infer a type from and it settles on text —
    // then `age_days > <text>` fails with "operator does not exist".
    return sla == null ? null : sql`WHEN ${key} THEN ${sla}::numeric`;
  }).filter((w): w is SQL => w !== null);
  if (whens.length === 0) return sql`NULL::numeric`;
  return sql`CASE key ${sql.join(whens, sql` `)} ELSE NULL::numeric END`;
}

export async function loadLeadPipeline(
  tx: Tx,
  opts: { branchId?: string | null; rmId?: string | null } = {}
): Promise<LeadPipeline> {
  const { branchId, rmId } = opts;
  const bBranch: SQL = branchId ? sql`branch_id = ${branchId}::uuid` : sql`TRUE`;
  const bRm: SQL = rmId ? sql`owner_id = ${rmId}::uuid` : sql`TRUE`;
  const canonical = canonicalStageSql();

  // `stage_changed_at` is null for a lead that has never moved, so age falls
  // back to when it arrived — which is exactly the right clock for a lead
  // stuck in "New". The SLA comparison happens in SQL rather than by shipping
  // every lead's age to Node: a firm with a five-figure lead book would
  // otherwise transfer one float per lead to compute a handful of integers.
  // `age > NULL` is NULL for a stage with no SLA, so it simply isn't counted.
  const res = await tx.execute(sql`
    WITH aged AS (
      SELECT ${canonical} AS key,
             EXTRACT(EPOCH FROM (now() - COALESCE(stage_changed_at, created_at))) / 86400
               AS age_days
        FROM leads
       WHERE converted_investor_id IS NULL
         AND ${bBranch} AND ${bRm}
    )
    SELECT key,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE age_days > ${slaDaysSql()})::int AS overdue
      FROM aged
     GROUP BY 1`);

  const counts = new Map<string, { count: number; overdue: number }>();
  for (const r of res.rows as Array<Record<string, unknown>>) {
    counts.set(String(r.key ?? ""), {
      count: Number(r.count) || 0,
      overdue: Number(r.overdue) || 0,
    });
  }

  const buckets: LeadStageBucket[] = LEAD_PHASE_STAGES.map((key) => {
    const meta = STAGE_META.get(key);
    const hit = counts.get(key);
    return {
      key,
      name: meta?.name ?? key,
      count: hit?.count ?? 0,
      overdue: hit?.overdue ?? 0,
      slaDays: meta?.slaDays ?? null,
      flavour: stageFlavour(key),
    };
  });

  const path = buckets.filter((b) => b.flavour === "default");
  const loops = buckets.filter((b) => b.flavour === "loop");
  const closed = buckets.filter(
    (b) => b.flavour === "terminal_success" || b.flavour === "terminal_failure"
  );

  // Won and lost leads are not open pipeline — counting them in the total
  // would make the headline grow every time a lead is closed.
  const open = [...path, ...loops];
  return {
    path,
    loops,
    closed,
    openTotal: open.reduce((a, b) => a + b.count, 0),
    overdueTotal: open.reduce((a, b) => a + b.overdue, 0),
  };
}
