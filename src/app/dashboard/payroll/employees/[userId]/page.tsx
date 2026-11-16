import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { employeeSalaries, payrollProfiles, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { loadPayrollSettings } from "@/lib/payroll/run";
import { EmployeePayForm } from "./EmployeePayForm";

export const dynamic = "force-dynamic";

/** One person's payroll profile, salary history and a live payslip preview. */
export default async function PayrollEmployeePage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const [u] = await tx
      .select({ name: users.name, code: users.employeeCode, department: users.department, joiningDate: users.joiningDate })
      .from(users)
      .where(and(eq(users.tenantId, session.tenantId), eq(users.id, userId)));
    if (!u) return null;
    const [p] = await tx.select().from(payrollProfiles).where(and(eq(payrollProfiles.tenantId, session.tenantId), eq(payrollProfiles.userId, userId)));
    const history = await tx
      .select()
      .from(employeeSalaries)
      .where(and(eq(employeeSalaries.tenantId, session.tenantId), eq(employeeSalaries.userId, userId)))
      .orderBy(desc(employeeSalaries.effectiveFrom), desc(employeeSalaries.createdAt));
    const settings = await loadPayrollSettings(tx, session.tenantId);
    return { u, p, history, settings };
  });
  if (!data) notFound();
  const { u, p, history, settings } = data;

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeaderCard title={u.name} breadcrumb={[{ label: "Payroll", href: "/dashboard/payroll/employees" }, { label: u.name }]} />
      <EmployeePayForm
        userId={userId}
        canManage={canManagePayroll(session)}
        settings={settings}
        joiningDate={u.joiningDate ? String(u.joiningDate) : null}
        profile={{
          panLast4: p?.panLast4 ?? null,
          uan: p?.uan ?? "",
          pfNumber: p?.pfNumber ?? "",
          esiNumber: p?.esiNumber ?? "",
          bankName: p?.bankName ?? "",
          bankLast4: p?.bankAccountLast4 ?? null,
          ifsc: p?.ifsc ?? "",
          paymentMode: (p?.paymentMode as "bank" | "cheque" | "cash") ?? "bank",
          workState: p?.workState ?? settings.defaultState,
          gender: p?.gender ?? "",
          pfEnabled: p?.pfEnabled ?? true,
          esiMode: (p?.esiMode as "auto" | "off") ?? "auto",
          exitDate: p?.exitDate ? String(p.exitDate) : "",
          openingFyStart: p?.openingFyStart ? String(p.openingFyStart) : null,
          openingTaxableGross: p?.openingTaxableGross != null ? Number(p.openingTaxableGross) : null,
          openingTds: p?.openingTds != null ? Number(p.openingTds) : null,
        }}
        history={history.map((h) => ({
          id: h.id,
          effectiveFrom: String(h.effectiveFrom),
          monthlyGross: Number(h.monthlyGross),
          basicOverride: h.basicOverride != null ? Number(h.basicOverride) : null,
          hraOverride: h.hraOverride != null ? Number(h.hraOverride) : null,
          note: h.note,
        }))}
      />
    </div>
  );
}
