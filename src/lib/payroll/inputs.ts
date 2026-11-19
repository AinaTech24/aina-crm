/**
 * What a pay run takes in besides the salary (payroll phase 2, migration
 * 0273): loan and advance EMIs, approved reimbursement claims, approved
 * incentive statements, arrears from back-dated salary revisions, and each
 * person's tax declaration. Callers are inside withTenant; the arithmetic is
 * calc.ts.
 *
 * - A loan's balance is its principal less every instalment recorded on an
 *   approved or paid run (`result.links.loans`), so reopening a run never
 *   recovers twice. Someone leaving this month repays the whole balance.
 * - A claim or incentive is ATTACHED to the draft run that picks it up
 *   (`pay_run_id`); another month's run never takes it. Marking the run paid
 *   marks them paid — except for someone whose salary is on hold, whose
 *   claims and incentives go back to wait for the next run.
 * - Arrears: for each of the last twelve months already approved or paid, the
 *   salary in force NOW for that month (a revision dated back changes it)
 *   against the salary the month was paid on, for the days that month paid,
 *   less arrears already paid for it.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { splitSalary, monthName, type ArrearIn, type LoanIn, type PaidInput } from "./calc";
import type { PayrollSettings } from "./settings";
import { effectiveDeclaration, proofsApply, readDeclaration, readProofs, type Declaration, type TaxRegimeKey } from "./tax";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (v: unknown) => (v == null ? 0 : Number(v));

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** Loan and advance instalments due this month, per person. */
export async function loansForMonth(
  tx: Tx, tenantId: string, period: string, runId: string, exits: Map<string, string | null>
): Promise<Map<string, LoanIn[]>> {
  const rows = (await tx.execute(sql`
    SELECT l.id::text AS id, l.user_id::text AS uid, l.kind, l.principal, l.emi, l.start_period::text AS start,
           COALESCE((
             SELECT SUM((x->>'amount')::numeric)
               FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id,
                    jsonb_array_elements(COALESCE(i.result->'links'->'loans', '[]'::jsonb)) x
              WHERE i.tenant_id = l.tenant_id AND i.user_id = l.user_id AND r.id <> ${runId}::uuid
                AND r.status IN ('approved', 'paid') AND i.on_hold = false AND x->>'id' = l.id::text
           ), 0) AS recovered
      FROM payroll_loans l
     WHERE l.tenant_id = ${tenantId}::uuid AND l.status = 'active' AND l.start_period <= ${period}::date
     ORDER BY l.start_period, l.created_at`)).rows as Array<Record<string, unknown>>;
  const out = new Map<string, LoanIn[]>();
  const monthEnd = endOf(period);
  for (const r of rows) {
    const uid = String(r.uid);
    const outstanding = num(r.principal) - num(r.recovered);
    if (outstanding <= 0.5) continue;
    const exit = exits.get(uid);
    const leaving = !!exit && exit <= monthEnd;
    const amount = leaving ? outstanding : Math.min(num(r.emi), outstanding);
    const label = r.kind === "advance" ? "Salary advance recovery" : "Loan EMI";
    const why = leaving
      ? `Leaving this month — the balance of ${inr(outstanding)} is recovered`
      : `Instalment ${inr(amount)} of ${inr(num(r.principal))}; ${inr(outstanding - amount)} left after this month`;
    push(out, uid, { id: String(r.id), label, amount, why });
  }
  return out;
}

/** Approved claims not yet paid, attached to this run; the rest are let go. */
export async function claimsForRun(tx: Tx, tenantId: string, runId: string, userIds: string[]): Promise<Map<string, PaidInput[]>> {
  const rows = (await tx.execute(sql`
    SELECT id::text AS id, user_id::text AS uid, category, claim_date::text AS d, amount, bill_number
      FROM reimbursement_claims
     WHERE tenant_id = ${tenantId}::uuid AND status = 'approved'
       AND (pay_run_id IS NULL OR pay_run_id = ${runId}::uuid)
     ORDER BY claim_date, created_at`)).rows as Array<Record<string, unknown>>;
  const on = new Set(userIds);
  const out = new Map<string, PaidInput[]>();
  const ids: string[] = [];
  for (const r of rows) {
    const uid = String(r.uid);
    if (!on.has(uid)) continue;
    ids.push(String(r.id));
    push(out, uid, {
      id: String(r.id),
      label: `Reimbursement — ${r.category}`,
      amount: num(r.amount),
      why: `Bill${r.bill_number ? ` ${r.bill_number}` : ""} of ${fmtDate(String(r.d))}, approved; expenses repaid are not taxed`,
    });
  }
  await attach(tx, "reimbursement_claims", tenantId, runId, ids);
  return out;
}

/** Approved incentive statements not yet paid, attached to this run. */
export async function incentivesForRun(tx: Tx, tenantId: string, runId: string, userIds: string[]): Promise<Map<string, PaidInput[]>> {
  const rows = (await tx.execute(sql`
    SELECT s.id::text AS id, s.user_id::text AS uid, s.amount, s.period_start::text AS ps, s.period_end::text AS pe,
           p.name AS plan, s.working->>'summary' AS summary
      FROM incentive_statements s JOIN incentive_plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'approved' AND s.amount > 0
       AND (s.pay_run_id IS NULL OR s.pay_run_id = ${runId}::uuid)
     ORDER BY s.period_start`)).rows as Array<Record<string, unknown>>;
  const on = new Set(userIds);
  const out = new Map<string, PaidInput[]>();
  const ids: string[] = [];
  for (const r of rows) {
    const uid = String(r.uid);
    if (!on.has(uid)) continue;
    ids.push(String(r.id));
    push(out, uid, {
      id: String(r.id),
      label: `Incentive — ${r.plan}`,
      amount: num(r.amount),
      why: `${periodLabel(String(r.ps), String(r.pe))}: ${r.summary ?? "approved incentive"}`,
    });
  }
  await attach(tx, "incentive_statements", tenantId, runId, ids);
  return out;
}

async function attach(tx: Tx, table: "reimbursement_claims" | "incentive_statements", tenantId: string, runId: string, ids: string[]) {
  const t = sql.raw(table);
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  // NOT IN over an empty list would be NOT IN (NULL) — never true — so let all go explicitly.
  await tx.execute(sql`UPDATE ${t} SET pay_run_id = NULL, updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND pay_run_id = ${runId}::uuid${ids.length ? sql` AND id NOT IN (${list})` : sql``}`);
  if (ids.length) {
    await tx.execute(sql`UPDATE ${t} SET pay_run_id = ${runId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND id IN (${list}) AND (pay_run_id IS DISTINCT FROM ${runId}::uuid)`);
  }
}

type ItemResult = {
  structure?: { gross: number; basic: number };
  baseDays?: number;
  payableDays?: number;
  links?: { arrears?: Array<{ period: string; amount: number }> };
};

type SalaryRow = { uid: string; from: string; gross: number; basic: number | null; hra: number | null; created: string };

/** Arrears per person for months already paid on a salary since revised back-dated. */
export async function arrearsForMonth(tx: Tx, tenantId: string, period: string, runId: string, settings: PayrollSettings): Promise<{ arrears: Map<string, ArrearIn[]>; warnings: Map<string, string[]> }> {
  const items = (await tx.execute(sql`
    SELECT i.user_id::text AS uid, r.period::text AS period, r.id::text AS run_id, i.result
      FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id
     WHERE i.tenant_id = ${tenantId}::uuid AND r.status IN ('approved', 'paid') AND i.on_hold = false
       AND r.id <> ${runId}::uuid AND r.period >= (${period}::date - interval '12 months')
     ORDER BY r.period`)).rows as Array<{ uid: string; period: string; run_id: string; result: ItemResult }>;
  const arrears = new Map<string, ArrearIn[]>();
  const warnings = new Map<string, string[]>();
  if (!items.length) return { arrears, warnings };
  const sal = (await tx.execute(sql`
    SELECT user_id::text AS uid, effective_from::text AS "from", monthly_gross::float AS gross,
           basic_override::float AS basic, hra_override::float AS hra, created_at::text AS created
      FROM employee_salaries WHERE tenant_id = ${tenantId}::uuid`)).rows as SalaryRow[];
  const byUser = new Map<string, SalaryRow[]>();
  for (const s of sal) push(byUser, s.uid, s);

  // Arrears already paid per (person, month).
  const paid = new Map<string, number>();
  for (const it of items) {
    for (const a of (it.result?.links?.arrears ?? []) as Array<{ period: string; amount: number }>) {
      const k = `${it.uid}|${a.period}`;
      paid.set(k, (paid.get(k) ?? 0) + num(a.amount));
    }
  }
  for (const it of items) {
    if (it.period >= period) continue;
    const then = it.result?.structure as { gross: number; basic: number } | undefined;
    if (!then) continue;
    const end = endOf(it.period);
    const now = (byUser.get(it.uid) ?? [])
      .filter((s) => s.from <= end)
      .sort((a, b) => (a.from === b.from ? (a.created < b.created ? 1 : -1) : a.from < b.from ? 1 : -1))[0];
    if (!now) continue;
    const ns = splitSalary({ monthlyGross: now.gross, basicOverride: now.basic, hraOverride: now.hra }, settings);
    const diff = ns.gross - num(then.gross);
    if (Math.abs(diff) < 1) continue;
    const factor = num(it.result?.baseDays) ? num(it.result?.payableDays) / num(it.result?.baseDays) : 1;
    if (diff < 0) {
      push(warnings, it.uid, `The salary for ${monthName(it.period)} was revised down after it was paid (${inr(-diff * factor)} over-paid). Nothing is recovered automatically — add a deduction if it should be.`);
      continue;
    }
    const full = Math.round(diff * factor);
    const due = full - (paid.get(`${it.uid}|${it.period}`) ?? 0);
    if (due < 1) continue;
    const basicDue = Math.round(((ns.basic - num(then.basic)) * factor * due) / full);
    push(arrears, it.uid, {
      period: it.period,
      amount: due,
      basic: Math.max(0, basicDue),
      why: `${monthName(it.period)} was paid on ${inr(num(then.gross))} a month; the salary for it is now ${inr(ns.gross)} (revision from ${fmtDate(now.from)})${factor < 1 ? `, for the ${num(it.result?.payableDays)} of ${num(it.result?.baseDays)} days paid` : ""}`,
    });
  }
  return { arrears, warnings };
}

/** Each person's regime and the declaration amounts TDS uses this month. */
export async function declarationsForMonth(
  tx: Tx, tenantId: string, period: string, fy: string, settings: PayrollSettings
): Promise<Map<string, { regime: TaxRegimeKey; declaration: Declaration; proofsApplied: boolean }>> {
  const rows = (await tx.execute(sql`
    SELECT user_id::text AS uid, regime, declared, proofs FROM tax_declarations
     WHERE tenant_id = ${tenantId}::uuid AND fy_start = ${fy}::date AND submitted_at IS NOT NULL`)).rows as Array<Record<string, unknown>>;
  const useProofs = proofsApply(period, settings.proofDeadlineMonth);
  return new Map(
    rows.map((r) => [
      String(r.uid),
      {
        regime: r.regime === "old" ? "old" : "new",
        declaration: effectiveDeclaration(readDeclaration(r.declared), readProofs(r.proofs), useProofs),
        proofsApplied: useProofs,
      },
    ])
  );
}

/** When the run is marked paid: claims and incentives paid; a held person's go back to wait; repaid loans close. */
export async function settleInputsOnPaid(tx: Tx, tenantId: string, runId: string): Promise<void> {
  for (const table of ["reimbursement_claims", "incentive_statements"] as const) {
    const t = sql.raw(table);
    await tx.execute(sql`UPDATE ${t} x SET pay_run_id = NULL, updated_at = now()
       WHERE x.tenant_id = ${tenantId}::uuid AND x.pay_run_id = ${runId}::uuid
         AND EXISTS (SELECT 1 FROM pay_run_items i WHERE i.pay_run_id = ${runId}::uuid AND i.user_id = x.user_id AND i.on_hold)`);
    await tx.execute(sql`UPDATE ${t} SET status = 'paid', updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND pay_run_id = ${runId}::uuid AND status = 'approved'`);
  }
  await tx.execute(sql`
    UPDATE payroll_loans l SET status = 'closed', updated_at = now()
     WHERE l.tenant_id = ${tenantId}::uuid AND l.status = 'active'
       AND l.principal <= COALESCE((
         SELECT SUM((x->>'amount')::numeric)
           FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id,
                jsonb_array_elements(COALESCE(i.result->'links'->'loans', '[]'::jsonb)) x
          WHERE i.tenant_id = l.tenant_id AND i.user_id = l.user_id AND r.status = 'paid'
            AND i.on_hold = false AND x->>'id' = l.id::text
       ), 0) + 0.5`);
}

function endOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export function periodLabel(start: string, end: string): string {
  return start.slice(0, 7) === end.slice(0, 7) ? monthName(start) : `${monthName(start)} – ${monthName(end)}`;
}
