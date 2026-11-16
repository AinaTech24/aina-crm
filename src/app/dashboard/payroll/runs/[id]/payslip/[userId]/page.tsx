import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canViewPayroll } from "@/lib/payroll/access";
import type { PayResult } from "@/lib/payroll/calc";
import { Payslip, monthLabel } from "@/components/payroll/PayrollShared";
import { PrintButton } from "@/components/payroll/PrintButton";

export const dynamic = "force-dynamic";

/** One person's payslip on a pay run, with the reason for every line. */
export default async function RunPayslipPage({ params }: { params: Promise<{ id: string; userId: string }> }) {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const { id, userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
    if (!run) return null;
    const [item] = await tx.select().from(payRunItems).where(and(eq(payRunItems.payRunId, id), eq(payRunItems.userId, userId)));
    const [t] = await tx.select({ name: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId));
    return item ? { run, item, firm: t?.name ?? "" } : null;
  });
  if (!data) notFound();
  const result = data.item.result as unknown as PayResult & { employee?: { name?: string; employeeCode?: string; department?: string; workState?: string }; lopWhy?: string };
  const period = String(data.run.period);
  return (
    <div className="max-w-3xl space-y-5">
      <div className="print:hidden">
        <PageHeaderCard
          title={`Payslip — ${result.employee?.name ?? ""}`}
          breadcrumb={[{ label: "Payroll", href: "/dashboard/payroll" }, { label: monthLabel(period), href: `/dashboard/payroll/runs/${id}` }, { label: result.employee?.name ?? "Payslip" }]}
          actions={<PrintButton />}
        />
      </div>
      {(result.warnings?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm space-y-1 print:hidden">
          {result.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {result.lopWhy && <p className="text-sm text-muted-foreground print:hidden">Days without pay: {result.lopWhy}.</p>}
      <Payslip firm={data.firm} period={period} employee={{ name: result.employee?.name ?? "", employeeCode: result.employee?.employeeCode, department: result.employee?.department, workState: result.employee?.workState }} result={result} />
    </div>
  );
}
