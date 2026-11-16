/**
 * GET /api/payroll/runs/:id/export?kind=register|bank — CSV.
 *
 * register: the salary register (every line of every person). Needs
 *   `payroll.view` or `payroll.manage`.
 * bank: name, account number, IFSC, net pay, narration — for a bulk NEFT
 *   upload. Carries full account numbers, so it needs `payroll.manage`, the run
 *   must be approved, and each download is audited. People on hold or paid by
 *   cheque / cash are left out.
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

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const kind = req.nextUrl.searchParams.get("kind") === "bank" ? "bank" : "register";
    if (kind === "bank") requireCap(session.roles, "payroll.manage", session.permissions);
    else requireAny(session.roles, ["payroll.manage", "payroll.view"], session.permissions);
    const { id } = await params;

    const out = await withTenant(session.tenantId, async (tx) => {
      const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
      if (!run) throw Object.assign(new Error("Pay run not found"), { status: 404 });
      const items = await tx
        .select({ item: payRunItems, name: users.name, code: users.employeeCode, profile: payrollProfiles })
        .from(payRunItems)
        .innerJoin(users, eq(users.id, payRunItems.userId))
        .leftJoin(payrollProfiles, and(eq(payrollProfiles.tenantId, payRunItems.tenantId), eq(payrollProfiles.userId, payRunItems.userId)))
        .where(eq(payRunItems.payRunId, id))
        .orderBy(asc(users.name));
      const month = String(run.period).slice(0, 7);

      if (kind === "bank") {
        if (run.status === "draft") throw Object.assign(new Error("Approve the pay run before downloading the bank file."), { status: 409 });
        const rows: unknown[][] = [["Beneficiary name", "Account number", "IFSC", "Amount", "Narration"]];
        for (const { item, name, profile } of items) {
          if (item.onHold || (profile?.paymentMode ?? "bank") !== "bank" || !profile?.bankAccountEnc) continue;
          rows.push([name, decrypt(profile.bankAccountEnc), profile.ifsc ?? "", Number(item.net).toFixed(2), `Salary ${month}`]);
        }
        await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.bank_file", entityType: "pay_run", entityId: id, after: { people: rows.length - 1 } });
        return { body: csv(rows), name: `salary-bank-${month}.csv` };
      }

      const rows: unknown[][] = [[
        "Employee", "Code", "Payable days", "Days without pay", "Basic", "HRA", "Special Allowance", "Other earnings", "Gross",
        "PF", "ESI", "Professional Tax", "TDS", "Other deductions", "Net pay", "Employer PF", "Employer ESI", "Cost to firm", "On hold",
      ]];
      for (const { item, name, code } of items) {
        const r = item.result as unknown as PayResult;
        const sum = (lines: PayResult["earnings"] | undefined, c: string) => (lines ?? []).filter((l) => l.code === c).reduce((t, l) => t + l.amount, 0);
        const erPf = (r.employer ?? []).filter((l) => ["epf", "eps", "edli", "pf_admin"].includes(l.code)).reduce((t, l) => t + l.amount, 0);
        rows.push([
          name, code ?? "", r.payableDays, r.lopDays,
          sum(r.earnings, "basic"), sum(r.earnings, "hra"), sum(r.earnings, "special"), sum(r.earnings, "adj"), r.gross,
          sum(r.deductions, "pf"), sum(r.deductions, "esi"), sum(r.deductions, "pt"), sum(r.deductions, "tds"), sum(r.deductions, "adj"), r.net,
          erPf, sum(r.employer, "esi_er"), r.employerCost, item.onHold ? "Yes" : "",
        ]);
      }
      return { body: csv(rows), name: `salary-register-${month}.csv` };
    });

    return new NextResponse(out.body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${out.name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
