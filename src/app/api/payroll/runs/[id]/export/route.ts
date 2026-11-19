/**
 * GET /api/payroll/runs/:id/export?kind=register|bank|ecr|esic|variance
 *
 * register: the salary register (every line of every person), CSV. Needs
 *   `payroll.view` or `payroll.manage`.
 * variance: this month against last month (lib/payroll/variance.ts), CSV.
 *   `payroll.view` or `payroll.manage`.
 * bank: name, account number, IFSC, net pay, narration — for a bulk NEFT
 *   upload. Carries full account numbers, so it needs `payroll.manage`, the run
 *   must be approved, and each download is audited. People on hold or paid by
 *   cheque / cash are left out.
 * ecr: the EPFO ECR (version 2) text file — one line per member with PF this
 *   month: UAN, name, gross / EPF / EPS / EDLI wages, the three contributions
 *   and NCP days, "#~#"-separated, no header. People without a UAN are left
 *   out (the run page lists them). `payroll.manage`, approved run, audited.
 * esic: the ESIC monthly contribution sheet as CSV (IP number, name, days
 *   paid, wages, reason code, last working day) for everyone with ESI this
 *   month. `payroll.manage`, approved run, audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns, payrollProfiles, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import type { PayResult } from "@/lib/payroll/calc";
import { ecrLine, esicRow, statutoryOf } from "@/lib/payroll/filings";
import { FLAG_LABEL, variance } from "@/lib/payroll/variance";

export const dynamic = "force-dynamic";

const KINDS = ["register", "bank", "ecr", "esic", "variance"] as const;
type Kind = (typeof KINDS)[number];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

function prevPeriod(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const asked = req.nextUrl.searchParams.get("kind");
    const kind: Kind = asked && (KINDS as readonly string[]).includes(asked) ? (asked as Kind) : "register";
    if (kind === "bank" || kind === "ecr" || kind === "esic") requireCap(session.roles, "payroll.manage", session.permissions);
    else requireAny(session.roles, ["payroll.manage", "payroll.view"], session.permissions);
    const { id } = await params;

    const out = await withTenant(session.tenantId, async (tx) => {
      const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
      if (!run) throw fail("Pay run not found", 404);
      const loadItems = (runId: string) =>
        tx
          .select({ item: payRunItems, name: users.name, code: users.employeeCode, profile: payrollProfiles })
          .from(payRunItems)
          .innerJoin(users, eq(users.id, payRunItems.userId))
          .leftJoin(payrollProfiles, and(eq(payrollProfiles.tenantId, payRunItems.tenantId), eq(payrollProfiles.userId, payRunItems.userId)))
          .where(eq(payRunItems.payRunId, runId))
          .orderBy(asc(users.name));
      const items = await loadItems(id);
      const period = String(run.period);
      const month = period.slice(0, 7);
      const audit = (action: string, people: number) =>
        recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action, entityType: "pay_run", entityId: id, after: { people } });

      if ((kind === "bank" || kind === "ecr" || kind === "esic") && run.status === "draft") {
        throw fail(`Approve the pay run before downloading the ${kind === "bank" ? "bank" : kind.toUpperCase()} file.`, 409);
      }

      if (kind === "bank") {
        const rows: unknown[][] = [["Beneficiary name", "Account number", "IFSC", "Amount", "Narration"]];
        for (const { item, name, profile } of items) {
          if (item.onHold || (profile?.paymentMode ?? "bank") !== "bank" || !profile?.bankAccountEnc) continue;
          rows.push([name, decrypt(profile.bankAccountEnc), profile.ifsc ?? "", Number(item.net).toFixed(2), `Salary ${month}`]);
        }
        await audit("payroll.bank_file", rows.length - 1);
        return { body: csv(rows), name: `salary-bank-${month}.csv`, type: "text/csv" };
      }

      if (kind === "ecr") {
        const lines: string[] = [];
        for (const { item, name, profile } of items) {
          if (item.onHold || !profile?.uan) continue;
          const line = ecrLine(profile.uan, name, item.result as unknown as PayResult);
          if (line) lines.push(line);
        }
        await audit("payroll.ecr_file", lines.length);
        return { body: lines.join("\r\n") + (lines.length ? "\r\n" : ""), name: `pf-ecr-${month}.txt`, type: "text/plain" };
      }

      if (kind === "esic") {
        const rows: unknown[][] = [["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"]];
        for (const { item, name, profile } of items) {
          if (item.onHold) continue;
          const row = esicRow(profile?.esiNumber ?? "", name, item.result as unknown as PayResult, profile?.exitDate ? String(profile.exitDate) : null);
          if (row) rows.push(row);
        }
        await audit("payroll.esic_file", rows.length - 1);
        return { body: csv(rows), name: `esic-${month}.csv`, type: "text/csv" };
      }

      if (kind === "variance") {
        const [prev] = await tx.select({ id: payRuns.id }).from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.period, prevPeriod(period))));
        const toV = (rows: Awaited<ReturnType<typeof loadItems>>) =>
          rows.map(({ item, name }) => ({ userId: item.userId, name, gross: Number(item.gross), net: Number(item.net), onHold: item.onHold }));
        const v = variance(toV(items), prev ? toV(await loadItems(prev.id)) : null);
        const rows: unknown[][] = [["Employee", "Net last month", "Net this month", "Change", "Change %", "Look at"]];
        for (const r of v) rows.push([r.name, r.lastNet ?? "", r.net ?? "", r.change ?? "", r.changePct ?? "", r.flags.map((f) => FLAG_LABEL[f]).join("; ")]);
        return { body: csv(rows), name: `salary-variance-${month}.csv`, type: "text/csv" };
      }

      const rows: unknown[][] = [[
        "Employee", "Code", "Payable days", "Days without pay", "Basic", "HRA", "Special Allowance", "Arrears", "Incentives", "Reimbursements", "Other earnings", "Gross",
        "PF", "ESI", "Professional Tax", "TDS", "Loan recovery", "Other deductions", "Net pay", "Employer PF", "Employer ESI", "Cost to firm", "PF wages", "On hold",
      ]];
      for (const { item, name, code } of items) {
        const r = item.result as unknown as PayResult;
        const sum = (lines: PayResult["earnings"] | undefined, c: string) => (lines ?? []).filter((l) => l.code === c).reduce((t, l) => t + l.amount, 0);
        const erPf = (r.employer ?? []).filter((l) => ["epf", "eps", "edli", "pf_admin"].includes(l.code)).reduce((t, l) => t + l.amount, 0);
        rows.push([
          name, code ?? "", r.payableDays, r.lopDays,
          sum(r.earnings, "basic"), sum(r.earnings, "hra"), sum(r.earnings, "special"), sum(r.earnings, "arrears"), sum(r.earnings, "incentive"), sum(r.earnings, "claim"), sum(r.earnings, "adj"), r.gross,
          sum(r.deductions, "pf"), sum(r.deductions, "esi"), sum(r.deductions, "pt"), sum(r.deductions, "tds"), sum(r.deductions, "loan"), sum(r.deductions, "adj"), r.net,
          erPf, sum(r.employer, "esi_er"), r.employerCost, statutoryOf(r).pfWages, item.onHold ? "Yes" : "",
        ]);
      }
      return { body: csv(rows), name: `salary-register-${month}.csv`, type: "text/csv" };
    });

    return new NextResponse(out.body, {
      headers: {
        "content-type": `${out.type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${out.name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
