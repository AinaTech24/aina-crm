import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { employeesForMonth, loadPayrollSettings } from "@/lib/payroll/run";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { RunsTable, StartRun, type RunRow } from "./RunsClient";

export const dynamic = "force-dynamic";

/** Payroll → Pay runs (docs/PAYROLL_MODULE_DESIGN.md). */
export default async function PayrollPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return (
      <div className="mt-6">
        <EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} />
      </div>
    );
  }
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const thisMonth = now.toISOString().slice(0, 7);
  const data = await withTenant(session.tenantId, async (tx) => {
    const runs = await tx.select().from(payRuns).where(eq(payRuns.tenantId, session.tenantId)).orderBy(desc(payRuns.period)).limit(36);
    const settings = await loadPayrollSettings(tx, session.tenantId);
    const staff = await employeesForMonth(tx, session.tenantId, `${thisMonth}-01`, settings);
    return { runs, staff };
  });
  const noSalary = data.staff.filter((e) => e.monthlyGross == null).length;
  const rows: RunRow[] = data.runs.map((r) => ({
    id: r.id,
    period: String(r.period),
    status: r.status,
    employees: Number(r.totals?.employees ?? 0),
    gross: Number(r.totals?.gross ?? 0),
    net: Number(r.totals?.net ?? 0),
    cost: Number(r.totals?.employerCost ?? 0),
  }));
  const manage = canManagePayroll(session);

  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" actions={manage ? <StartRun defaultMonth={thisMonth} /> : undefined} />
      <PayrollTabs active="runs" />
      {noSalary > 0 && (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm">
          {noSalary} team member{noSalary === 1 ? " has" : "s have"} no salary set, so {noSalary === 1 ? "is" : "are"} left off pay runs.{" "}
          <Link href="/dashboard/payroll/employees" className="font-medium text-primary hover:underline">Set salaries</Link>
        </div>
      )}
      <RunsTable rows={rows} />
    </div>
  );
}
