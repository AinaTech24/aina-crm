/**
 * Bulk PROVISIONAL risk profiling from age. SERVER-ONLY.
 *
 * Two passes over the same query so the preview and the apply can never
 * disagree: `planAgeAssignment` decides what would happen to every active
 * client, and `applyAgeAssignment` executes exactly that plan.
 *
 * What it deliberately does NOT touch:
 *   · a client who already has a REAL (client-answered) profile — overwriting a
 *     signed profile with a guess from age is the one thing that would make
 *     this dangerous, so those are skipped and reported, never re-labelled;
 *   · a client with no date of birth — listed as skipped rather than guessed at;
 *   · a MINOR (G-1): a minor account needs its own explicitly verified,
 *     account-specific assessment recorded through the guardian. A category
 *     inferred from the child's age is not that, so minors are left out of
 *     the plan altogether (they are not counted as active clients here).
 *
 * An existing PROVISIONAL profile may be refreshed (the bands changed, or the
 * client had a birthday) — that is the only overwrite, and only when asked for.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { applyRiskCategory, type RiskCategory } from "@/lib/risk-profile/apply";
import { categoryForAge, type AgeBand } from "@/lib/risk-profile/age-bands";
import { clientRiskSql, minorSql } from "@/lib/risk-profile/own-assessment";

export type SkipReason = "no_dob" | "already_profiled" | "unchanged";

export type PlanRow = {
  investorId: string;
  name: string;
  age: number | null;
  current: RiskCategory | null;
  currentProvisional: boolean;
  next: RiskCategory | null;
  skip: SkipReason | null;
};

export type AssignmentPlan = {
  /** Rows that WILL be written. */
  assign: PlanRow[];
  /** Rows deliberately left alone, with the reason. */
  skipped: PlanRow[];
  /** assign-count per category, for the preview bars. */
  byCategory: Record<string, number>;
  counts: { active: number; assign: number; no_dob: number; already_profiled: number; unchanged: number };
};

/**
 * Decide what bulk assignment would do. `refreshProvisional` re-derives clients
 * who already carry a provisional category (bands changed / birthday crossed);
 * without it only never-profiled clients are touched.
 */
export async function planAgeAssignment(
  tx: Tx,
  /** `scope`: the viewer's client data scope over alias `i` (investorScopeSql). */
  opts: { tenantId: string; bands: AgeBand[]; rmId?: string; refreshProvisional?: boolean; scope?: SQL }
): Promise<AssignmentPlan> {
  const rmScope = sql`${opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``}${opts.scope ? sql` AND ${opts.scope}` : sql``}`;
  // A minor's risk is their own assessment, never the guardian's copy (G-1).
  const own = clientRiskSql("i");
  const res = await tx.execute(sql`
    SELECT i.id, i.name, ${own.category} AS risk_profile, ${own.provisional} AS risk_profile_provisional,
           CASE WHEN i.dob IS NULL THEN NULL
                ELSE date_part('year', age(i.dob))::int END AS age
      FROM investors i
     WHERE i.tenant_id = ${opts.tenantId}::uuid
       AND i.status = 'active' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND NOT ${minorSql("i")}${rmScope}
     ORDER BY i.name ASC
  `);

  const assign: PlanRow[] = [];
  const skipped: PlanRow[] = [];
  const byCategory: Record<string, number> = {};
  let noDob = 0, alreadyProfiled = 0, unchanged = 0;

  for (const r of res.rows as any[]) {
    const current = (r.risk_profile ?? null) as RiskCategory | null;
    const currentProvisional = !!r.risk_profile_provisional;
    const age = r.age == null ? null : Number(r.age);
    const base = {
      investorId: String(r.id),
      name: r.name ?? "—",
      age,
      current,
      currentProvisional,
    };

    // A real, client-answered profile is never overwritten from age.
    if (current && !currentProvisional) {
      alreadyProfiled++;
      skipped.push({ ...base, next: null, skip: "already_profiled" });
      continue;
    }
    // A provisional profile is only re-derived when explicitly asked for.
    if (current && currentProvisional && !opts.refreshProvisional) {
      unchanged++;
      skipped.push({ ...base, next: null, skip: "unchanged" });
      continue;
    }
    const next = categoryForAge(age, opts.bands);
    if (!next) {
      noDob++;
      skipped.push({ ...base, next: null, skip: "no_dob" });
      continue;
    }
    if (current === next) {
      unchanged++;
      skipped.push({ ...base, next, skip: "unchanged" });
      continue;
    }
    byCategory[next] = (byCategory[next] ?? 0) + 1;
    assign.push({ ...base, next, skip: null });
  }

  return {
    assign,
    skipped,
    byCategory,
    counts: {
      active: (res.rows as any[]).length,
      assign: assign.length,
      no_dob: noDob,
      already_profiled: alreadyProfiled,
      unchanged,
    },
  };
}

/**
 * Write a plan. Returns the investor ids actually assigned, so the caller can
 * offer to notify exactly those clients and nobody else.
 */
export async function applyAgeAssignment(
  tx: Tx,
  opts: { tenantId: string; plan: AssignmentPlan; userId: string; limit?: number }
): Promise<{ assigned: string[]; failed: Array<{ investorId: string; error: string }> }> {
  const rows = opts.limit ? opts.plan.assign.slice(0, opts.limit) : opts.plan.assign;
  const assigned: string[] = [];
  const failed: Array<{ investorId: string; error: string }> = [];

  for (const row of rows) {
    if (!row.next) continue;
    try {
      await applyRiskCategory({
        tx,
        tenantId: opts.tenantId,
        investorId: row.investorId,
        category: row.next,
        // Pass the CURRENT category only when it is a real profile; a provisional
        // one must be allowed to change, and applyRiskCategory no-ops on a match.
        currentCategory: row.currentProvisional ? null : row.current,
        createdById: opts.userId,
        provisional: true,
        basis: "age_band",
        remarks:
          row.age != null
            ? `Provisional — assigned from age ${row.age}. Awaiting the client's questionnaire.`
            : "Provisional — assigned from age band. Awaiting the client's questionnaire.",
      });
      assigned.push(row.investorId);
    } catch (e: any) {
      failed.push({ investorId: row.investorId, error: String(e?.message ?? "failed") });
    }
  }
  return { assigned, failed };
}
