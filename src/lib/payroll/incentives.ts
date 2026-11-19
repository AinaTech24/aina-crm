/**
 * Sales incentives (incentive_plans / incentive_statements, migration 0273;
 * docs/PAYROLL_MODULE_DESIGN.md §5). The measure always comes from the CRM,
 * never typed, on the dashboards' own definitions:
 *
 *   net_business       RTA-processed gross − redemption of the person's clients
 *   gross_business     RTA-processed gross investment of the person's clients
 *   net_sip            monthly amount of SIPs registered less stops reported
 *                      (lib/metrics/business.ts)
 *   insurance_premium  annual premium of policies booked in the period with the
 *                      person as the business owner (lib/insurance/book.ts)
 *   new_clients        client records onboarded in the period with the person
 *                      as RM (lib/metrics/new-clients.ts)
 *
 * Incentives count what the RTA processed (the firm's decision of
 * 2026-10-02) — business booked but not yet processed is not paid until it is.
 * No RTA data for the period is not ₹0 of business: the statement says so and
 * pays nothing until the files are imported and it is recalculated.
 *
 * Shape: slabs on achievement of target (%) or on the measure itself; the
 * highest slab reached pays — a % of the measure, a fixed sum, or a sum per
 * unit (new clients) — up to the plan's cap. Targets are the person's KRA
 * targets (Settings → Targets), the annual figure pro-rated to the period.
 *
 * Flow: calculated → approved (payroll.manage) → paid in the next pay run as
 * a taxable earning (lib/payroll/inputs.ts).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { getNetBusiness } from "@/lib/metrics/business";
import { aliveClient } from "@/lib/metrics/scope";
import { onboardedInSql } from "@/lib/metrics/new-clients";
import { STATUS_ISSUED_EXCLUDED, bookedOnSql, inList, ownerSql } from "@/lib/insurance/book";
import { MEASURES, fiscalYearOf, planPeriod, workIncentive, type MeasureKey, type PlanShape } from "./incentive-rules";

export * from "./incentive-rules";

/** The person's figure for the measure in the period; null = no RTA data for it. */
export async function measureFor(tx: Tx, tenantId: string, measure: MeasureKey, userId: string, from: string, to: string): Promise<number | null> {
  if (measure === "net_business" || measure === "gross_business" || measure === "net_sip") {
    const nb = await getNetBusiness(tx, { tenantId, rmIds: [userId] }, { from, to });
    if (!nb.hasData || !nb.current) return null;
    return measure === "net_business" ? nb.current.net : measure === "gross_business" ? nb.current.gross : nb.current.netSip;
  }
  if (measure === "insurance_premium") {
    const r = (await tx.execute(sql`
      SELECT COALESCE(SUM(p.annual_premium), 0)::float AS v
        FROM insurance_policies p
        JOIN investors i ON i.id = p.investor_id
        LEFT JOIN users su ON su.id = p.sold_by_user_id
       WHERE p.tenant_id = ${tenantId}::uuid AND ${ownerSql("p", "i", "su")} = ${userId}::uuid
         AND p.status NOT IN (${inList(STATUS_ISSUED_EXCLUDED)})
         AND ${bookedOnSql("p")} BETWEEN ${from}::date AND ${to}::date`)).rows[0] as { v: number } | undefined;
    return Number(r?.v ?? 0);
  }
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.rm_id = ${userId}::uuid AND ${aliveClient("i")}
       AND ${onboardedInSql({ from, to }, "i")}`)).rows[0] as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/** The person's KRA target for the measure, pro-rated to the period (months ÷ 12). */
export async function targetFor(tx: Tx, tenantId: string, measure: MeasureKey, userId: string, from: string, to: string): Promise<number | null> {
  const key = MEASURES[measure].target;
  if (!key) return null;
  const r = (await tx.execute(sql`
    SELECT annual_target::float AS v FROM kra_targets
     WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND metric_key = ${key} AND fiscal_year = ${fiscalYearOf(from)}`)).rows[0] as { v: number } | undefined;
  if (!r || !(Number(r.v) > 0)) return null;
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return Math.round((Number(r.v) * months) / 12);
}

/**
 * Work out a plan's statements for the period `month` falls in. A statement
 * still "to approve" (or rejected) is recalculated; an approved or paid one
 * is left as it is. Returns how many were written.
 */
export async function calculatePlan(tx: Tx, tenantId: string, planId: string, month: string): Promise<{ written: number; kept: number; start: string; end: string }> {
  const plan = (await tx.execute(sql`
    SELECT id::text, measure, period_kind, slab_on, payout, slabs, cap::float AS cap, roles, user_ids::text[] AS user_ids, active
      FROM incentive_plans WHERE tenant_id = ${tenantId}::uuid AND id = ${planId}::uuid`)).rows[0] as
    | { id: string; measure: MeasureKey; period_kind: string; slab_on: PlanShape["slabOn"]; payout: PlanShape["payout"]; slabs: PlanShape["slabs"] | null; cap: number | null; roles: string[] | null; user_ids: string[] | null; active: boolean }
    | undefined;
  if (!plan) throw Object.assign(new Error("Plan not found"), { status: 404 });
  if (!plan.active) throw Object.assign(new Error("This plan is switched off."), { status: 409 });
  const { start, end } = planPeriod(plan.period_kind === "month" ? "month" : "quarter", month);
  const roles: string[] = plan.roles ?? [];
  const ids: string[] = plan.user_ids ?? [];
  const people = (await tx.execute(sql`
    SELECT u.id::text AS id FROM users u
     WHERE u.tenant_id = ${tenantId}::uuid AND u.deleted_at IS NULL
       AND NOT (u.roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])
       AND (u.status IN ('active', 'offboarding'))
       AND (u.roles && ${sql`ARRAY[${sql.join(roles.length ? roles.map((r) => sql`${r}`) : [sql`''`], sql`, `)}]::text[]`}
            OR u.id::text = ANY(${sql`ARRAY[${sql.join(ids.length ? ids.map((i) => sql`${i}`) : [sql`''`], sql`, `)}]::text[]`}))`)).rows as Array<{ id: string }>;
  const shape: PlanShape = { measure: plan.measure, slabOn: plan.slab_on, payout: plan.payout, slabs: plan.slabs ?? [], cap: plan.cap ?? null };
  let written = 0;
  let kept = 0;
  for (const p of people) {
    const value = await measureFor(tx, tenantId, shape.measure, p.id, start, end);
    const target = await targetFor(tx, tenantId, shape.measure, p.id, start, end);
    const w = workIncentive(shape, value, target);
    const res = (await tx.execute(sql`
      INSERT INTO incentive_statements (tenant_id, plan_id, user_id, period_start, period_end, measure_value, target_value, achievement_pct, amount, working, status)
      VALUES (${tenantId}::uuid, ${planId}::uuid, ${p.id}::uuid, ${start}::date, ${end}::date, ${value}, ${target}, ${w.achievementPct}, ${w.amount},
              ${JSON.stringify({ summary: w.summary, slab: w.slab, capped: w.capped, noData: value == null })}::jsonb, 'calculated')
      ON CONFLICT (tenant_id, plan_id, user_id, period_start) DO UPDATE SET
        period_end = EXCLUDED.period_end, measure_value = EXCLUDED.measure_value, target_value = EXCLUDED.target_value,
        achievement_pct = EXCLUDED.achievement_pct, amount = EXCLUDED.amount, working = EXCLUDED.working,
        status = 'calculated', approved_by = NULL, approved_at = NULL, updated_at = now()
       WHERE incentive_statements.status IN ('calculated', 'rejected')
      RETURNING id`)).rows;
    if (res.length) written += 1;
    else kept += 1;
  }
  return { written, kept, start, end };
}
