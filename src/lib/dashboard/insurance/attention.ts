/**
 * Needs Insurance Head attention (§45) and today's priorities (§46): the
 * exceptions only, each with a count, the money at stake, the oldest age and
 * who most of it sits with — and a link to exactly those records.
 *
 * Renewal cards read their own rows here (owner and age need the rows); the
 * rest are assembled from the loaders that own them, so a card and its
 * section can never show different numbers.
 */

import { sql } from "drizzle-orm";
import { inList, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { phaseFraction } from "@/lib/dashboard/my/kpis";
import { byDim, loadBiz, userNames } from "./business";
import { fyLabelOf, num, numOrNull, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

export type AttentionCard = {
  key: string; label: string; count: number; amount: number | null; oldestDays: number | null;
  owner: string | null; definition: string; href: string; tone: "bad" | "warn";
};

export type RenewalAttention = {
  due7: { count: number; premium: number; owner: string | null };
  overdue: { count: number; premium: number; oldest: number | null; owner: string | null };
  highRisk: { count: number; premium: number; oldest: number | null; owner: string | null };
};

/** Renewal-side cards: due within 7 days, overdue, and high-premium with no recent contact. */
export async function loadRenewalAttention(tx: Tx, w: InsWindow): Promise<RenewalAttention> {
  const r = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (
           SELECT pol.*, GREATEST(
                    (SELECT MAX(a.occurred_at) FROM activities a WHERE a.tenant_id = ${w.tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = pol.investor_id),
                    (SELECT MAX(m.meeting_date) FROM review_meetings m WHERE m.tenant_id = ${w.tenantId}::uuid AND m.investor_id = pol.investor_id AND m.status = 'completed')
                  ) AS last_contact
             FROM pol
            WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND pol.status IN (${inList(STATUS_IN_FORCE)})
              AND pol.freq <> 'single' AND pol.due IS NOT NULL AND pol.due <= ${w.today}::date + 30
         )
    SELECT COUNT(*) FILTER (WHERE due BETWEEN ${w.today}::date AND ${w.today}::date + 7)::int AS d7_n,
           COALESCE(SUM(inst) FILTER (WHERE due BETWEEN ${w.today}::date AND ${w.today}::date + 7), 0) AS d7_p,
           mode() WITHIN GROUP (ORDER BY owner_id) FILTER (WHERE due BETWEEN ${w.today}::date AND ${w.today}::date + 7) AS d7_o,
           COUNT(*) FILTER (WHERE due < ${w.today}::date)::int AS od_n,
           COALESCE(SUM(inst) FILTER (WHERE due < ${w.today}::date), 0) AS od_p,
           MAX(${w.today}::date - due) FILTER (WHERE due < ${w.today}::date) AS od_old,
           mode() WITHIN GROUP (ORDER BY owner_id) FILTER (WHERE due < ${w.today}::date) AS od_o,
           COUNT(*) FILTER (WHERE inst >= ${w.t.insHighPremium} AND (last_contact IS NULL OR last_contact < now() - interval '30 days'))::int AS hr_n,
           COALESCE(SUM(inst) FILTER (WHERE inst >= ${w.t.insHighPremium} AND (last_contact IS NULL OR last_contact < now() - interval '30 days')), 0) AS hr_p,
           MAX(${w.today}::date - due) FILTER (WHERE inst >= ${w.t.insHighPremium} AND due < ${w.today}::date
                                                 AND (last_contact IS NULL OR last_contact < now() - interval '30 days')) AS hr_old,
           mode() WITHIN GROUP (ORDER BY owner_id) FILTER (WHERE inst >= ${w.t.insHighPremium}
                                                 AND (last_contact IS NULL OR last_contact < now() - interval '30 days')) AS hr_o
      FROM p
  `)).rows[0] as Row | undefined;
  const names = await userNames(tx, [str(r?.d7_o), str(r?.od_o), str(r?.hr_o)]);
  const nameOf = (id: unknown) => (str(id) ? names.get(String(id))?.name ?? null : null);
  return {
    due7: { count: num(r?.d7_n), premium: num(r?.d7_p), owner: nameOf(r?.d7_o) },
    overdue: { count: num(r?.od_n), premium: num(r?.od_p), oldest: numOrNull(r?.od_old), owner: nameOf(r?.od_o) },
    highRisk: { count: num(r?.hr_n), premium: num(r?.hr_p), oldest: numOrNull(r?.hr_old), owner: nameOf(r?.hr_o) },
  };
}

export type BranchGap = { branchId: string; name: string; target: number; expected: number; actual: number };

/**
 * Branches behind their FY insurance target at today's pace, below the firm's
 * near band. Needs a branch "Insurance" target; with phasing off there is no
 * pace, so nothing is judged.
 */
export async function loadBranchGaps(tx: Tx, w: InsWindow): Promise<BranchGap[]> {
  const pace = phaseFraction(w.fyStart, w.today, w.fyStart, w.t.targetPhasing);
  if (pace == null || w.scope.kind === "self") return [];
  const targets = (await tx.execute(sql`
    SELECT t.scope_id::text AS branch_id, b.name, t.target_value AS v FROM annual_targets t JOIN branches b ON b.id = t.scope_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND t.metric_key = 'insurance_business' AND t.scope_type = 'branch'
       AND t.fiscal_year = ${fyLabelOf(w.today)} AND t.target_value > 0
       ${w.scope.kind === "branch" ? sql`AND t.scope_id = ${w.scope.branchId}::uuid` : sql``}
  `)).rows as Row[];
  if (!targets.length) return [];
  const actual = byDim(await loadBiz(tx, { ...w, filter: {} }, [{ k: "fy", from: w.fyStart, to: w.today }], ["branch"]), "fy", "branch");
  return targets.map((t) => {
    const target = num(t.v);
    return { branchId: String(t.branch_id), name: String(t.name), target, expected: target * pace, actual: actual.get(String(t.branch_id))?.total ?? 0 };
  }).filter((g) => g.expected > 0 && g.actual / g.expected < w.t.targetNearFraction)
    .sort((a, b) => (a.actual - a.expected) - (b.actual - b.expected));
}
