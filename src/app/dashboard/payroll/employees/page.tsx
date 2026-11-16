import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canViewPayroll } from "@/lib/payroll/access";
import { employeesForMonth, loadPayrollSettings } from "@/lib/payroll/run";
import { stateName } from "@/lib/payroll/statutory";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";

export const dynamic = "force-dynamic";

/** Payroll → Employees: who has a salary, where they work, PF / ESI and bank. */
export default async function PayrollEmployeesPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const month = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
  const staff = await withTenant(session.tenantId, async (tx) => employeesForMonth(tx, session.tenantId, `${month}-01`, await loadPayrollSettings(tx, session.tenantId)));
  const rows: EmpRow[] = staff.map((e) => ({
    userId: e.userId,
    name: e.name,
    code: e.employeeCode,
    gross: e.monthlyGross,
    state: stateName(e.workState),
    pf: e.pfEnabled,
    esi: e.esiMode === "auto",
    bank: e.paymentMode !== "bank" || e.hasBank,
  }));
  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="employees" />
      <EmployeesTable rows={rows} />
    </div>
  );
}
