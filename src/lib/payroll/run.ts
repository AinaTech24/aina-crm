/**
 * Pay runs (pay_runs / pay_run_items, migration 0261): who is paid, their
 * days without pay, the year so far, and the run's life — draft → approved →
 * paid. The arithmetic is lib/payroll/calc.ts; this file only reads and
 * writes. Callers are inside withTenant.
 *
 * - Paid: active team members (and anyone leaving this month) who have a
 *   salary on or before the month's end. Others are listed as "no salary set".
 * - Days without pay: approved UNPAID leave in the month, plus days marked
 *   absent (half a day for half-day) in attendance that no approved leave
 *   covers. The admin can override a person's figure with a reason; a
 *   recalculation keeps the override.
 * - Year so far (for TDS): taxable gross and TDS in this financial year's
 *   earlier approved or paid runs.
 * - Approval is maker-checker: whoever prepared the run cannot approve it,
 *   unless they are the owner (a one-person firm has nobody else).
 * - An approved run is frozen; a paid run is locked for good.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { payRunItems, payRuns, tenants, type PayAdjustment } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { calculatePay, type PayResult } from "./calc";
import { arrearsForMonth, claimsForRun, declarationsForMonth, incentivesForRun, loansForMonth, settleInputsOnPaid } from "./inputs";
import { readPayrollSettings, type PayrollSettings } from "./settings";

type Actor = { tenantId: string; userId: string; isOwner: boolean };

export const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

export function monthBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${period.slice(0, 7)}-01`, end };
}

/** April 1st of the financial year `period` falls in. */
export function fyStart(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

export async function loadPayrollSettings(tx: Tx, tenantId: string): Promise<PayrollSettings> {
  const [t] = await tx.select({ s: tenants.payrollSettings }).from(tenants).where(eq(tenants.id, tenantId));
  return readPayrollSettings(t?.s);
}

export type PayEmployee = {
  userId: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  joinDate: string | null;
  exitDate: string | null;
  monthlyGross: number | null;
  basicOverride: number | null;
  hraOverride: number | null;
  pfEnabled: boolean;
  esiMode: "auto" | "off";
  workState: string | null;
  gender: string | null;
  paymentMode: string;
  hasBank: boolean;
  taxRegime: "new" | "old";
};

/** Everyone payroll should consider for the month, with their salary in force at its end. */
export async function employeesForMonth(tx: Tx, tenantId: string, period: string, settings: PayrollSettings): Promise<PayEmployee[]> {
  const { start, end } = monthBounds(period);
  const rows = (await tx.execute(sql`
    SELECT u.id::text AS user_id, u.name, u.employee_code, u.department, u.joining_date::text AS join_date,
           p.exit_date::text AS exit_date, p.pf_enabled, p.esi_mode, p.work_state, p.gender, p.payment_mode, p.tax_regime,
           (p.bank_account_enc IS NOT NULL) AS has_bank,
           s.monthly_gross, s.basic_override, s.hra_override
      FROM users u
      LEFT JOIN payroll_profiles p ON p.tenant_id = u.tenant_id AND p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT monthly_gross, basic_override, hra_override FROM employee_salaries es
         WHERE es.tenant_id = u.tenant_id AND es.user_id = u.id AND es.effective_from <= ${end}::date
         ORDER BY es.effective_from DESC, es.created_at DESC LIMIT 1
      ) s ON true
     WHERE u.tenant_id = ${tenantId}::uuid AND u.deleted_at IS NULL
       AND NOT (u.roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])
       AND (u.joining_date IS NULL OR u.joining_date <= ${end}::date)
       AND (p.exit_date IS NULL OR p.exit_date >= ${start}::date)
       AND (u.status IN ('active', 'offboarding') OR (p.exit_date IS NOT NULL AND p.exit_date >= ${start}::date))
     ORDER BY u.name`)).rows as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    employeeCode: (r.employee_code as string) ?? null,
    department: (r.department as string) ?? null,
    joinDate: (r.join_date as string) ?? null,
    exitDate: (r.exit_date as string) ?? null,
    monthlyGross: num(r.monthly_gross),
    basicOverride: num(r.basic_override),
    hraOverride: num(r.hra_override),
    pfEnabled: r.pf_enabled == null ? true : Boolean(r.pf_enabled),
    esiMode: r.esi_mode === "off" ? "off" : "auto",
    workState: (r.work_state as string) || settings.defaultState,
    gender: (r.gender as string) ?? null,
    paymentMode: (r.payment_mode as string) ?? "bank",
    hasBank: Boolean(r.has_bank),
    taxRegime: r.tax_regime === "old" ? "old" : "new",
  }));
}

/** Days without pay per person: unpaid leave, plus absences no approved leave covers. */
export async function lopForMonth(tx: Tx, tenantId: string, period: string): Promise<Map<string, { days: number; why: string }>> {
  const { start, end } = monthBounds(period);
  const rows = (await tx.execute(sql`
    WITH days AS (
      SELECT la.employee_user_id AS uid, d::date AS day, la.leave_type, la.duration
        FROM leave_applications la,
             generate_series(GREATEST(la.from_date, ${start}::date), LEAST(la.to_date, ${end}::date), interval '1 day') d
       WHERE la.tenant_id = ${tenantId}::uuid AND la.status = 'approved'
         AND la.from_date <= ${end}::date AND la.to_date >= ${start}::date
    ),
    unpaid AS (
      SELECT uid, SUM(CASE WHEN duration = 'half_day' THEN 0.5 ELSE 1 END) AS n
        FROM days WHERE leave_type = 'unpaid' GROUP BY uid
    ),
    absent AS (
      SELECT a.employee_user_id AS uid, SUM(CASE WHEN a.status = 'half_day' THEN 0.5 ELSE 1 END) AS n
        FROM attendance a
       WHERE a.tenant_id = ${tenantId}::uuid AND a.attendance_date BETWEEN ${start}::date AND ${end}::date
         AND a.status IN ('absent', 'half_day')
         AND NOT EXISTS (SELECT 1 FROM days d WHERE d.uid = a.employee_user_id AND d.day = a.attendance_date)
       GROUP BY a.employee_user_id
    )
    SELECT COALESCE(u.uid, a.uid)::text AS uid, COALESCE(u.n, 0)::float AS unpaid, COALESCE(a.n, 0)::float AS absent
      FROM unpaid u FULL JOIN absent a ON a.uid = u.uid`)).rows as Array<{ uid: string; unpaid: number; absent: number }>;
  const out = new Map<string, { days: number; why: string }>();
  for (const r of rows) {
    const parts = [r.unpaid ? `${r.unpaid} day${r.unpaid === 1 ? "" : "s"} unpaid leave` : "", r.absent ? `${r.absent} day${r.absent === 1 ? "" : "s"} absent` : ""].filter(Boolean);
    out.set(r.uid, { days: r.unpaid + r.absent, why: parts.join(" + ") });
  }
  return out;
}

/**
 * This financial year before `period`: the opening balance entered on the
 * payroll profile (pay before the firm used CRM payroll) plus the earlier
 * approved / paid runs. TDS is worked on the whole year, so a person with
 * neither, part-way through the year, gets a warning on their payslip.
 */
export async function ytdForMonth(tx: Tx, tenantId: string, period: string): Promise<Map<string, { taxableGross: number; tds: number }>> {
  const fy = fyStart(period);
  const rows = (await tx.execute(sql`
    SELECT uid, SUM(taxable)::float AS taxable, SUM(tds)::float AS tds FROM (
      SELECT i.user_id AS uid, COALESCE((i.result->>'taxableGross')::numeric, i.gross) AS taxable, i.tds
        FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id
       WHERE i.tenant_id = ${tenantId}::uuid AND r.status IN ('approved', 'paid') AND i.on_hold = false
         AND r.period >= ${fy}::date AND r.period < ${period}::date
      UNION ALL
      SELECT p.user_id, COALESCE(p.opening_taxable_gross, 0), COALESCE(p.opening_tds, 0)
        FROM payroll_profiles p
       WHERE p.tenant_id = ${tenantId}::uuid AND p.opening_fy_start = ${fy}::date
    ) x GROUP BY uid`)).rows as Array<{ uid: string; taxable: number; tds: number }>;
  return new Map(rows.map((r) => [String(r.uid), { taxableGross: r.taxable, tds: r.tds }]));
}

/** Work out (or re-work) every person on a DRAFT run and its totals. */
export async function calculateRun(tx: Tx, actor: Actor, runId: string): Promise<void> {
  const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, actor.tenantId), eq(payRuns.id, runId)));
  if (!run) throw fail("Pay run not found", 404);
  if (run.status !== "draft") throw fail("Only a draft pay run can be recalculated.");
  const period = String(run.period);
  const settings = await loadPayrollSettings(tx, actor.tenantId);
  const staff = (await employeesForMonth(tx, actor.tenantId, period, settings)).filter((e) => e.monthlyGross != null);
  const lop = await lopForMonth(tx, actor.tenantId, period);
  const ytd = await ytdForMonth(tx, actor.tenantId, period);
  const existing = new Map((await tx.select().from(payRunItems).where(eq(payRunItems.payRunId, runId))).map((i) => [i.userId, i]));
  const ids = staff.map((e) => e.userId);
  const loans = await loansForMonth(tx, actor.tenantId, period, runId, new Map(staff.map((e) => [e.userId, e.exitDate])));
  const claims = await claimsForRun(tx, actor.tenantId, runId, ids);
  const incentives = await incentivesForRun(tx, actor.tenantId, runId, ids);
  const back = await arrearsForMonth(tx, actor.tenantId, period, runId, settings);
  const decls = await declarationsForMonth(tx, actor.tenantId, period, fyStart(period), settings);

  const totals = { employees: 0, gross: 0, deductions: 0, net: 0, tds: 0, employerCost: 0, pf: 0, esi: 0, pt: 0, onHold: 0, arrears: 0, incentives: 0, claims: 0, loans: 0 };
  const keep = new Set<string>();
  for (const e of staff) {
    const prev = existing.get(e.userId);
    const auto = lop.get(e.userId);
    const lopDays = prev?.lopOverride ? Number(prev.lopDays) : auto?.days ?? 0;
    const adjustments = (prev?.adjustments ?? []) as PayAdjustment[];
    const result: PayResult & { lopWhy?: string; employee: Record<string, unknown> } = {
      ...calculatePay(
        {
          monthlyGross: e.monthlyGross ?? 0,
          basicOverride: e.basicOverride,
          hraOverride: e.hraOverride,
          pfEnabled: e.pfEnabled,
          esiMode: e.esiMode,
          workState: e.workState,
          gender: e.gender,
          joinDate: e.joinDate,
          exitDate: e.exitDate,
        },
        {
          period,
          lopDays,
          adjustments,
          ytd: ytd.get(e.userId) ?? { taxableGross: 0, tds: 0 },
          loans: loans.get(e.userId),
          claims: claims.get(e.userId),
          incentives: incentives.get(e.userId),
          arrears: back.arrears.get(e.userId),
          tax: decls.get(e.userId) ?? { regime: e.taxRegime, declaration: {}, proofsApplied: false },
        },
        settings
      ),
      lopWhy: prev?.lopOverride ? `Set by hand: ${prev.lopReason ?? "no reason given"}` : auto?.why || undefined,
      employee: { name: e.name, employeeCode: e.employeeCode, department: e.department, workState: e.workState, paymentMode: e.paymentMode, hasBank: e.hasBank },
    };
    if (e.paymentMode === "bank" && !e.hasBank) result.warnings.push("No bank account on the payroll profile — add it before paying.");
    for (const w of back.warnings.get(e.userId) ?? []) result.warnings.push(w);
    // Part-way through the year with nothing on record for the months before:
    // TDS assumes nothing was paid, and would be too low.
    const fy = fyStart(period);
    if (period !== fy && !ytd.has(e.userId) && (!e.joinDate || e.joinDate < fy)) {
      result.warnings.push("Nothing is on record for this financial year before this month, so TDS assumes no salary was paid earlier. Enter the year's opening salary and TDS on this person's payroll details.");
    }
    const values = {
      lopDays: String(lopDays),
      result: result as unknown as Record<string, unknown>,
      gross: String(result.gross),
      deductions: String(result.totalDeductions),
      net: String(result.net),
      tds: String(result.tds),
      employerCost: String(result.employerCost),
      updatedAt: new Date(),
    };
    if (prev) await tx.update(payRunItems).set(values).where(eq(payRunItems.id, prev.id));
    else await tx.insert(payRunItems).values({ tenantId: actor.tenantId, payRunId: runId, userId: e.userId, ...values });
    keep.add(e.userId);

    if (prev?.onHold) { totals.onHold += 1; continue; }
    totals.employees += 1;
    totals.gross += result.gross;
    totals.deductions += result.totalDeductions;
    totals.net += result.net;
    totals.tds += result.tds;
    totals.employerCost += result.employerCost;
    const amt = (codes: string[], lines: Array<{ code: string; amount: number }>) => lines.filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.amount, 0);
    totals.pf += amt(["pf"], result.deductions) + amt(["epf", "eps", "edli", "pf_admin"], result.employer);
    totals.esi += amt(["esi"], result.deductions) + amt(["esi_er"], result.employer);
    totals.pt += amt(["pt"], result.deductions);
    totals.arrears += amt(["arrears"], result.earnings);
    totals.incentives += amt(["incentive"], result.earnings);
    totals.claims += amt(["claim"], result.earnings);
    totals.loans += amt(["loan"], result.deductions);
  }
  // Someone no longer on the run (salary removed, left before the month) drops off.
  for (const [uid, item] of existing) if (!keep.has(uid)) await tx.delete(payRunItems).where(eq(payRunItems.id, item.id));

  await tx.update(payRuns).set({ totals, updatedAt: new Date() }).where(eq(payRuns.id, runId));
}

export async function createRun(tx: Tx, actor: Actor, period: string): Promise<string> {
  const [dup] = await tx.select({ id: payRuns.id }).from(payRuns).where(and(eq(payRuns.tenantId, actor.tenantId), eq(payRuns.period, period)));
  if (dup) return dup.id;
  const [run] = await tx.insert(payRuns).values({ tenantId: actor.tenantId, period, preparedBy: actor.userId }).returning({ id: payRuns.id });
  await calculateRun(tx, actor, run.id);
  await recordAudit(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, action: "payroll.run_created", entityType: "pay_run", entityId: run.id, after: { period } });
  return run.id;
}

export async function setRunStatus(tx: Tx, actor: Actor, runId: string, action: "approve" | "reopen" | "paid", paidOn?: string): Promise<void> {
  const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, actor.tenantId), eq(payRuns.id, runId)));
  if (!run) throw fail("Pay run not found", 404);
  const now = new Date();
  if (action === "approve") {
    if (run.status !== "draft") throw fail("Only a draft pay run can be approved.");
    if (run.preparedBy === actor.userId && !actor.isOwner) throw fail("The person who prepared the pay run cannot approve it — ask the owner or another payroll manager.", 403);
    await tx.update(payRuns).set({ status: "approved", approvedBy: actor.userId, approvedAt: now, updatedAt: now }).where(eq(payRuns.id, runId));
  } else if (action === "reopen") {
    if (run.status !== "approved") throw fail("Only an approved, unpaid pay run can be reopened.");
    await tx.update(payRuns).set({ status: "draft", approvedBy: null, approvedAt: null, updatedAt: now }).where(eq(payRuns.id, runId));
  } else {
    if (run.status !== "approved") throw fail("Approve the pay run before marking it paid.");
    await tx.update(payRuns).set({ status: "paid", paidBy: actor.userId, paidAt: now, paidOn: paidOn ?? now.toISOString().slice(0, 10), updatedAt: now }).where(eq(payRuns.id, runId));
    await settleInputsOnPaid(tx, actor.tenantId, runId);
  }
  await recordAudit(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, action: `payroll.run_${action}`, entityType: "pay_run", entityId: runId, after: { period: run.period, paidOn } });
}
